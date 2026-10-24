import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MemoryCredentialStore } from "../dist/credentials.js";
import { confluenceHandlers } from "../dist/requests/confluence.js";

/**
 * 문서 읽기의 코멘트 줄 시험(2026-10-23 · 작업 E2) — confluenceHandlers 의 doc.read 를 임시
 * fixture 폴더(COLONOVA_DESIGN_CONFLUENCE_FIXTURE · confluence-connect.test.ts 의 선례)로
 * 돌린다. 코멘트 본문은 맨 글로 풀리고, 내 것 · 고칠 수 있는지가 줄마다 붙는다. 합성 이름 ·
 * 합성 문장만 쓰고 실사이트는 두드리지 않는다.
 */

const SITE = "colosseum.atlassian.net";
const PAGE_ID = "123";
const ME_ID = "acc-me";
const OTHER_ID = "acc-other";
const MENTION_ID = "acc-mention";
const PAGE_URL = `/wiki/api/v2/pages/${PAGE_ID}?body-format=storage`;
const FOOTER_URL = `/wiki/api/v2/pages/${PAGE_ID}/footer-comments?body-format=storage&limit=100`;
const INLINE_URL = `/wiki/api/v2/pages/${PAGE_ID}/inline-comments?body-format=storage&limit=100`;
const WHO_URL = "/wiki/rest/api/user/current";
const userUrl = (accountId: string): string => `/wiki/api/v2/users/${accountId}`;

/** 기록 쌍 한 세트 — 이름은 사람이 읽고, cite 는 어느 엔드포인트인지 말한다. */
function fixture(
  name: string,
  url: string,
  status: number,
  json: unknown,
): Record<string, unknown> {
  return {
    name,
    cite: url,
    request: { method: "GET", url },
    response: { status, json },
  };
}

/** 코멘트 한 줄의 응답 모양 — 실제 v2 처럼 작성자 · 만든 때는 판(version)이 싣는다(2026-10-24). */
function commentRow(
  id: string,
  authorId: string,
  version: number,
  storage: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    version: { number: version, authorId, createdAt: "2026-10-23T00:00:00Z" },
    body: { storage: { value: storage, representation: "storage" } },
    parentId: null,
    ...extra,
  };
}

/** 문서 · 코멘트의 기본 기록 쌍 — 시험이 who · footer 만 갈아 끼운다. */
function basePairs(
  overrides: { who?: Record<string, unknown>; footer?: Record<string, unknown> } = {},
): Array<Record<string, unknown>> {
  return [
    fixture("문서 읽기", PAGE_URL, 200, {
      id: PAGE_ID,
      title: "합성 문서",
      spaceId: "SP1",
      version: { number: 7 },
      parentId: "9",
      body: {
        storage: { value: "<h2>합성 머리</h2><p>합성 문단</p>", representation: "storage" },
      },
    }),
    overrides.footer ??
      fixture("바닥글 목록", FOOTER_URL, 200, {
        results: [
          commentRow("f1", ME_ID, 2, "<p>내가 쓴 바닥글</p>"),
          commentRow(
            "f2",
            OTHER_ID,
            1,
            `<p>보자 <ac:link><ri:user ri:account-id="${MENTION_ID}"/></ac:link> 도 같은 말</p>`,
          ),
        ],
      }),
    fixture("인라인 목록", INLINE_URL, 200, {
      results: [
        commentRow("i1", OTHER_ID, 1, "<p>풀린 지적</p>", {
          resolutionStatus: "resolved",
          inlineProperties: { selection: "풀린 지적" },
        }),
        commentRow("i2", ME_ID, 3, "<p><strong>굵은 지적</strong></p>", {
          inlineProperties: { selection: "굵은 지적" },
        }),
      ],
    }),
    fixture("작성자 이름 — 나", userUrl(ME_ID), 200, { displayName: "나작성자" }),
    fixture("작성자 이름 — 다른이", userUrl(OTHER_ID), 200, { displayName: "다른이" }),
    fixture("멘션 이름", userUrl(MENTION_ID), 200, { displayName: "합성이름" }),
    overrides.who ?? fixture("연결 확인", WHO_URL, 200, { accountId: ME_ID, displayName: "나" }),
  ];
}

/** doc.read 답의 코멘트 한 줄 — requests/confluence.ts 의 DocReadComment 모양(소스 밖 지역 정의). */
interface DocReadCommentRow {
  author: string;
  body: string;
  createdAt: string | null;
  anchorText: string | null;
  id?: string;
  kind?: "footer" | "inline";
  version?: number | null;
  parentId?: string | null;
  resolved?: boolean;
  mine?: boolean;
  editable?: boolean;
}

/** doc.read 의 답 — 파생 마크다운 · 절과 코멘트 줄(읽기 실패면 null). */
interface DocReadReply {
  markdown: string;
  sections: Array<{ heading: string; macro: boolean }>;
  comments: DocReadCommentRow[] | null;
}

interface Rig {
  read(pageId: string): Promise<DocReadReply>;
  cleanup(): void;
}

/** 문서 읽기 한 벌 — 가짜 의존과 임시 fixture 폴더. env 는 시험이 끝나면 되돌린다. */
function rig(pairs: Array<Record<string, unknown>>): Rig {
  const home = mkdtempSync(join(tmpdir(), "doc-read-comments-"));
  const fixtureDir = join(home, "fixtures");
  mkdirSync(fixtureDir);
  writeFileSync(join(fixtureDir, "fixtures.json"), JSON.stringify(pairs));
  const setting: Record<string, string> = { "confluenceSite:demo": SITE };
  const credentials = new MemoryCredentialStore();
  void credentials.save("confluence-pat", "me@example.com\ntok");
  const deps = {
    registry: { activeSlug: () => "demo", paths: (slug: string) => ({ root: join(home, slug) }) },
    machineSetting: { get: (key: string) => setting[key] ?? null, set() {} },
    credentials,
    fleet: {},
    confluence: {},
  };
  const handlers = confluenceHandlers(deps as unknown as Parameters<typeof confluenceHandlers>[0]);
  const previous = process.env.COLONOVA_DESIGN_CONFLUENCE_FIXTURE;
  process.env.COLONOVA_DESIGN_CONFLUENCE_FIXTURE = fixtureDir;
  return {
    read: (pageId: string) =>
      handlers["doc.read"]({ id: "r1", type: "doc.read", pageId }) as Promise<DocReadReply>,
    cleanup() {
      if (previous === undefined) delete process.env.COLONOVA_DESIGN_CONFLUENCE_FIXTURE;
      else process.env.COLONOVA_DESIGN_CONFLUENCE_FIXTURE = previous;
      rmSync(home, { recursive: true, force: true });
    },
  };
}

test("문서 읽기의 코멘트 — 맨 글 본문과 내 것 · 고칠 수 있음이 줄마다 붙는다", async () => {
  const rig1 = rig(basePairs());
  try {
    const reply = await rig1.read(PAGE_ID);
    assert.ok(reply.comments !== null);
    // 풀린 인라인(i1)은 빠지고, 바닥글 둘 · 인라인 하나가 남는다.
    assert.deepEqual(reply.comments, [
      {
        author: "나작성자",
        body: "내가 쓴 바닥글",
        createdAt: "2026-10-23T00:00:00Z",
        anchorText: null,
        id: "f1",
        kind: "footer",
        version: 2,
        parentId: null,
        resolved: false,
        mine: true,
        editable: true,
      },
      {
        author: "다른이",
        body: "보자 @합성이름 도 같은 말",
        createdAt: "2026-10-23T00:00:00Z",
        anchorText: null,
        id: "f2",
        kind: "footer",
        version: 1,
        parentId: null,
        resolved: false,
        mine: false,
        editable: false,
      },
      {
        author: "나작성자",
        body: "굵은 지적",
        createdAt: "2026-10-23T00:00:00Z",
        anchorText: "굵은 지적",
        id: "i2",
        kind: "inline",
        version: 3,
        parentId: null,
        resolved: false,
        mine: true,
        // 서식이 든 본문은 맨 글로 고치면 잃는다 — 내 것이어도 고칠 수 없다(2026-10-23 규칙).
        editable: false,
      },
    ]);
  } finally {
    rig1.cleanup();
  }
});

test("연결 확인이 막히면 아무것도 내 것이 아니다 — 문서 읽기는 이긴다", async () => {
  const rig2 = rig(
    basePairs({ who: fixture("연결 확인", WHO_URL, 401, { message: "Unauthorized" }) }),
  );
  try {
    const reply = await rig2.read(PAGE_ID);
    assert.ok(reply.comments !== null);
    assert.equal(reply.comments.length, 3);
    for (const row of reply.comments) {
      assert.equal(row.mine, false);
      assert.equal(row.editable, false);
    }
  } finally {
    rig2.cleanup();
  }
});

test("코멘트 목록을 읽지 못하면 코멘트는 null 이고 문서 읽기는 이긴다", async () => {
  const rig3 = rig(
    basePairs({ footer: fixture("바닥글 목록", FOOTER_URL, 500, { message: "합성 장애" }) }),
  );
  try {
    const reply = await rig3.read(PAGE_ID);
    assert.equal(reply.comments, null);
    assert.ok(reply.markdown.length > 0);
  } finally {
    rig3.cleanup();
  }
});
