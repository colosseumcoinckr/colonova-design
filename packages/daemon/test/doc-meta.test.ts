import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { attachmentDownloadPath } from "../dist/confluence-client.js";
import { writeConfluenceLedger } from "../dist/confluence-ledger.js";
import { confluenceMirrorLedger } from "../dist/confluence-mirror.js";
import { MemoryCredentialStore } from "../dist/credentials.js";
import {
  DocMeta,
  findAttachment,
  labelNameProblem,
  mirrorPlainText,
  searchDocs,
  snippetAround,
} from "../dist/doc-meta.js";
import type { DaemonLogger } from "../dist/log.js";
import type { RestTransport } from "../dist/rest-transport.js";

/**
 * 문서의 곁 시험(2026-10-30 사용자 요청) — 첨부 받기 · 라벨 게이트 · 멱등 · 범위 · 판 기록 · 본문 찾기.
 * 임시 폴더의 가짜 프로젝트와 기록된 전송만 쓴다 — 실사이트는 두드리지 않는다(doc-comments.test.ts 양식).
 */

const SITE = "colosseum.atlassian.net";
const ROOT_ID = "9";
const PAGE_ID = "123";
const commandId = (n: number): string =>
  `0b1e5f5a-6c7d-4e8f-9a0b-1c2d3e4f5a${n.toString(16).padStart(2, "0")}`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function rig() {
  const home = mkdtempSync(join(tmpdir(), "doc-meta-"));
  const mirror = join(home, "demo", "confluence");
  mkdirSync(join(mirror, "COLO"), { recursive: true });
  writeConfluenceLedger(confluenceMirrorLedger(join(home, "demo")), {
    site: SITE,
    roots: [ROOT_ID],
    lastSyncAt: null,
    pages: {
      [PAGE_ID]: {
        path: "COLO/login",
        title: "로그인 화면",
        version: 4,
        sections: [],
        comments: null,
      },
      "124": { path: "COLO/noshow", title: "노쇼 정책", version: 2, sections: [], comments: null },
    },
    folders: {},
    unsupported: {},
  });
  writeFileSync(
    join(mirror, "COLO", "login.md"),
    '---\nconfluence:\n  pageId: "123"\n  title: "로그인 화면"\n  version: 4\n---\n\n# 로그인\n\n비밀번호를 **다섯 번** 틀리면 잠근다.\n',
  );
  writeFileSync(
    join(mirror, "COLO", "noshow.md"),
    '---\nconfluence:\n  pageId: "124"\n  title: "노쇼 정책"\n  version: 2\n---\n\n예약 시간에 오지 않으면 [노쇼](https://x.example) 로 센다.\n',
  );
  const served: Record<string, { status?: number; json?: unknown; bytes?: Buffer }> = {
    [`GET /wiki/api/v2/pages/${PAGE_ID}/attachments?limit=100`]: {
      json: {
        results: [
          {
            id: "att1",
            title: "흐름도.png",
            mediaType: "image/png",
            fileSize: PNG.byteLength,
            downloadLink: `/download/attachments/${PAGE_ID}/flow.png?version=1&api=v2`,
          },
          {
            id: "att2",
            title: "큰파일.zip",
            mediaType: "application/zip",
            fileSize: 50 * 1024 * 1024,
            downloadLink: `/download/attachments/${PAGE_ID}/big.zip?version=1`,
          },
        ],
      },
    },
    [`GET /wiki/download/attachments/${PAGE_ID}/flow.png?version=1&api=v2`]: { bytes: PNG },
    [`POST /wiki/rest/api/content/${PAGE_ID}/label`]: { json: { results: [] } },
    [`DELETE /wiki/rest/api/content/${PAGE_ID}/label?name=old`]: { status: 204 },
    [`GET /wiki/api/v2/pages/${PAGE_ID}/versions?limit=50&sort=-modified-date`]: {
      json: {
        results: [
          {
            number: 3,
            authorId: "u1",
            createdAt: "2026-10-29T00:00:00Z",
            message: "고침",
            minorEdit: false,
          },
          {
            number: 4,
            authorId: "u1",
            createdAt: "2026-10-30T00:00:00Z",
            message: "",
            minorEdit: true,
          },
        ],
      },
    },
    "GET /wiki/api/v2/users/u1": { json: { displayName: "김기획" } },
    [`GET /wiki/api/v2/pages/${PAGE_ID}?version=3&body-format=storage`]: {
      json: {
        id: PAGE_ID,
        title: "로그인 화면",
        version: { number: 3 },
        body: {
          storage: {
            value:
              '<ac:structured-macro ac:name="note"><ac:rich-text-body><p>옛 메모</p></ac:rich-text-body></ac:structured-macro>',
          },
        },
      },
    },
  };
  const calls: Call[] = [];
  const transport: RestTransport = {
    async request(input) {
      const text = input.body ? new TextDecoder().decode(input.body) : "";
      calls.push({
        method: input.method,
        url: input.url,
        body: text === "" ? undefined : JSON.parse(text),
      });
      const route = served[`${input.method} ${input.url}`];
      if (route === undefined) return { status: 404, body: Buffer.from("{}", "utf8"), headers: {} };
      return {
        status: route.status ?? 200,
        body:
          route.bytes ??
          (route.status === 204
            ? Buffer.alloc(0)
            : Buffer.from(JSON.stringify(route.json ?? {}), "utf8")),
        headers: route.bytes ? { "content-type": "image/png" } : {},
      };
    },
  };
  const credentials = new MemoryCredentialStore();
  void credentials.save("confluence-pat", "me@example.com\ntok");
  const setting: Record<string, string> = {
    "confluenceSite:demo": SITE,
    "confluenceRootId:demo": ROOT_ID,
  };
  const logs: Array<{ message: string; data: unknown }> = [];
  const logger: DaemonLogger = {
    info(message: string, data?: unknown) {
      logs.push({ message, data });
    },
    warn() {},
    error() {},
  } as DaemonLogger;
  const meta = new DocMeta({
    registry: { activeSlug: () => "demo", paths: (slug: string) => ({ root: join(home, slug) }) },
    machineSetting: { get: (key: string) => setting[key] ?? null },
    credentials,
    logger,
    transport: () => transport,
    now: () => new Date("2026-10-30T01:00:00Z"),
  });
  return {
    meta,
    calls,
    served,
    logs,
    plansRoot: join(home, "demo", "plans"),
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

function gate(on: boolean): void {
  if (on) process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH = "1";
  else delete process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH;
}

test("첨부 받는 주소 — /download 는 /wiki 아래로, 다른 길과 .. 은 받지 않는다", () => {
  assert.equal(
    attachmentDownloadPath("/download/attachments/1/a.png?version=2"),
    "/wiki/download/attachments/1/a.png?version=2",
  );
  assert.equal(
    attachmentDownloadPath("https://x.atlassian.net/wiki/download/attachments/1/a.png"),
    "/wiki/download/attachments/1/a.png",
  );
  assert.equal(attachmentDownloadPath("/wiki/rest/api/user/current"), null);
  assert.equal(attachmentDownloadPath("/download/../rest/api/x"), null);
  assert.equal(attachmentDownloadPath("https://evil.example/steal"), null);
});

test("첨부 받기 — 이름으로 찾아 base64 로 건넨다, 10MB 넘는 것은 받지 않는다", async () => {
  const { meta, calls, logs, cleanup } = rig();
  try {
    const got = await meta.attachment(PAGE_ID, "흐름도.png");
    assert.equal(got.tooLarge, false);
    assert.equal(got.mediaType, "image/png");
    assert.deepEqual(Buffer.from(got.data, "base64"), PNG);
    // 목록은 기억한다 — 두 번째 그림은 목록을 다시 읽지 않는다.
    const big = await meta.attachment(PAGE_ID, "큰파일.zip");
    assert.equal(big.tooLarge, true);
    assert.equal(big.data, "");
    assert.equal(calls.filter((call) => call.url.includes("/attachments?")).length, 1);
    assert.equal(calls.filter((call) => call.url.includes("big.zip")).length, 0);
    // 자격은 헤더로만 — 로그에는 수만, 파일 이름은 없다.
    assert.ok(!JSON.stringify(logs).includes("흐름도"));
    await assert.rejects(meta.attachment(PAGE_ID, "없는.png"));
  } finally {
    cleanup();
  }
});

test("첨부 찾기는 NFC 로 맞춘다 — 맥에서 올린 한글 파일 이름", () => {
  const nfd = "흐름도.png".normalize("NFD");
  const found = findAttachment(
    [{ id: "1", title: nfd, mediaType: null, size: null, downloadLink: null, createdAt: null }],
    "흐름도.png",
  );
  assert.equal(found?.id, "1");
});

test("라벨 이름 — 빈칸 · 금지 글자 · 길이", () => {
  assert.equal(labelNameProblem("정책"), null);
  assert.equal(labelNameProblem("v0-8"), null);
  assert.equal(labelNameProblem(""), "empty");
  assert.equal(labelNameProblem("두 단어"), "invalid-char");
  assert.equal(labelNameProblem("a:b"), "invalid-char");
  assert.equal(labelNameProblem("x".repeat(256)), "too-long");
});

test("라벨 — 게이트가 꺼졌으면 실패다, 원격을 두드리지 않고 기록도 남지 않는다", async () => {
  const { meta, calls, plansRoot, cleanup } = rig();
  try {
    gate(false);
    const result = await meta.labelAdd({ pageId: PAGE_ID, commandId: commandId(1), label: "정책" });
    assert.deepEqual(result, {
      commandId: commandId(1),
      state: "failed",
      detail: "publish-disabled",
    });
    assert.equal(calls.length, 0);
    assert.ok(!existsSync(join(plansRoot, "label-ops", `${commandId(1)}.json`)));
  } finally {
    cleanup();
  }
});

test("라벨 — 더하기는 작은 글자로 global 에, 빼기는 이름을 쿼리로, 같은 명령은 한 번만", async () => {
  const { meta, calls, plansRoot, cleanup } = rig();
  try {
    gate(true);
    const added = await meta.labelAdd({
      pageId: PAGE_ID,
      commandId: commandId(2),
      label: "Policy",
    });
    assert.equal(added.state, "applied");
    assert.deepEqual(calls[0]?.body, [{ prefix: "global", name: "policy" }]);
    const again = await meta.labelAdd({
      pageId: PAGE_ID,
      commandId: commandId(2),
      label: "Policy",
    });
    assert.deepEqual(again, added);
    assert.equal(calls.length, 1);
    const removed = await meta.labelRemove({
      pageId: PAGE_ID,
      commandId: commandId(3),
      label: "old",
    });
    assert.equal(removed.state, "applied");
    assert.equal(calls[1]?.method, "DELETE");
    const record = JSON.parse(
      readFileSync(join(plansRoot, "label-ops", `${commandId(3)}.json`), "utf8"),
    );
    assert.equal(record.result.state, "applied");
    // 같은 아이디의 다른 명령은 거절한다.
    await assert.rejects(
      meta.labelRemove({ pageId: PAGE_ID, commandId: commandId(2), label: "policy" }),
    );
  } finally {
    gate(false);
    cleanup();
  }
});

test("라벨 — 범위 밖 문서 · 못 쓰는 이름은 보내지 않는다", async () => {
  const { meta, calls, cleanup } = rig();
  try {
    gate(true);
    const outside = await meta.labelAdd({ pageId: "999", commandId: commandId(4), label: "x" });
    assert.equal(outside.detail, "out-of-scope");
    const invalid = await meta.labelAdd({ pageId: PAGE_ID, commandId: commandId(5), label: "a:b" });
    assert.equal(invalid.detail, "label-invalid");
    assert.equal(calls.length, 0);
  } finally {
    gate(false);
    cleanup();
  }
});

test("라벨 — 보낸 기록만 남은 명령은 결과를 모른다고 답하고 다시 보내지 않는다", async () => {
  const { meta, calls, plansRoot, cleanup } = rig();
  try {
    gate(true);
    const file = join(plansRoot, "label-ops", `${commandId(6)}.json`);
    mkdirSync(join(plansRoot, "label-ops"), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        format: 1,
        commandId: commandId(6),
        op: "add",
        pageId: PAGE_ID,
        createdAt: "2026-10-30T00:00:00Z",
        result: null,
      }),
    );
    const result = await meta.labelAdd({ pageId: PAGE_ID, commandId: commandId(6), label: "x" });
    assert.equal(result.state, "unknown");
    assert.equal(calls.length, 0);
  } finally {
    gate(false);
    cleanup();
  }
});

test("판 기록 — 최근 것부터, 쓴 사람의 이름을 한 번만 묻는다 · 옛 판은 보기 블록으로", async () => {
  const { meta, calls, cleanup } = rig();
  try {
    const { versions } = await meta.versions(PAGE_ID);
    assert.deepEqual(
      versions.map((one) => [one.number, one.author, one.minorEdit]),
      [
        [4, "김기획", true],
        [3, "김기획", false],
      ],
    );
    assert.equal(calls.filter((call) => call.url.startsWith("/wiki/api/v2/users/")).length, 1);
    const old = await meta.versionRead(PAGE_ID, 3);
    assert.equal(old.version, 3);
    assert.deepEqual(old.view, [
      {
        t: "panel",
        tone: "note",
        title: null,
        blocks: [{ t: "p", children: [{ t: "text", text: "옛 메모" }] }],
      },
    ]);
  } finally {
    cleanup();
  }
});

test("본문 찾기 — 사본의 본문에서 찾고 미리 보기 글을 준다, 제목만 맞는 문서는 빼다", () => {
  const { meta, logs, cleanup } = rig();
  try {
    const hits = meta.search("다섯").results;
    assert.deepEqual(
      hits.map((hit) => hit.pageId),
      [PAGE_ID],
    );
    assert.ok(hits[0]?.snippet.includes("다섯 번"));
    // 링크 주소가 아니라 글이 맞는다.
    assert.deepEqual(
      meta.search("노쇼").results.map((hit) => hit.pageId),
      ["124"],
    );
    assert.deepEqual(meta.search("x.example").results, []);
    // 제목에만 있는 말은 본문 찾기에 들지 않는다.
    assert.deepEqual(meta.search("화면").results, []);
    // 로그에는 수만 — 찾는 말은 없다.
    assert.ok(!JSON.stringify(logs).includes("다섯"));
  } finally {
    cleanup();
  }
});

test("본문 찾기의 조각 — 머리말 떼기 · 표식 걷기 · 순서 · 말줄임", () => {
  assert.equal(
    mirrorPlainText(
      '---\nconfluence:\n  title: "t"\n---\n\n# 제목\n\n| a | b |\n| --- | --- |\n**굵게** [글](https://x)',
    ),
    "제목 a b 굵게 글",
  );
  const long = `${"가".repeat(100)}목표${"나".repeat(200)}`;
  const snippet = snippetAround(long, 100, 2);
  assert.ok(snippet.startsWith("…") && snippet.endsWith("…") && snippet.includes("목표"));
  const ranked = searchDocs(
    [
      { pageId: "1", title: "하나", text: "사과" },
      { pageId: "2", title: "사과 정책", text: "사과 배" },
      { pageId: "3", title: "셋", text: "사과 배" },
    ],
    "사과 배",
  );
  assert.deepEqual(
    ranked.map((hit) => hit.pageId),
    ["2", "3"],
  );
});
