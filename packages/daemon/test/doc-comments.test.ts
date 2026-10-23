import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeConfluenceLedger } from "../dist/confluence-ledger.js";
import { confluenceLedgerFile } from "../dist/confluence-sync.js";
import { MemoryCredentialStore } from "../dist/credentials.js";
import { DocComments } from "../dist/doc-comments.js";
import type { DaemonLogger } from "../dist/log.js";
import type { RestTransport } from "../dist/rest-transport.js";

/**
 * 문서 코멘트 서비스 시험(2026-10-23 · 작업 D2a) — 임시 폴더의 가짜 프로젝트 · 가짜 클론(원장),
 * 기록된 전송으로 게이트 · 범위 · 인라인 닻 · 판 대조 · 멱등 · 모르는 결과를 본다. 합성 문장만
 * 쓰고, 실사이트는 절대 두드리지 않는다(doc-ops.test.ts 양식).
 */

const SITE = "colosseum.atlassian.net";
const ROOT_ID = "9";
const PAGE_ID = "123";
const COMMAND_ID = "0b1e5f5a-6c7d-4e8f-9a0b-1c2d3e4f5a6b";
const NOW = new Date("2026-10-23T01:00:00Z");

/**
 * 명령 아이디의 이형 — 한 시험 안의 여러 보내기는 서로 다른 명령이어야 한다.
 * 같은 아이디는 기록 재전송이니, 보내기의 수만큼 이형이 필요하다.
 */
const commandId = (n: number): string =>
  `0b1e5f5a-6c7d-4e8f-9a0b-1c2d3e4f5a${n.toString(16).padStart(2, "0")}`;
/** 원문에 두 번 나오는 합성 문장 — 두 번 이상이면 모호해서 잇지 않는다(2026-10-23 규칙). */
const SENTENCE = "데이터 모델 SSoT";
/** 원문에 딱 한 번 나오는 합성 문장 — 한 번일 때만 잇는다(2026-10-23 규칙). */
const UNIQUE = "고유한 합성 문장";
const PAGE_STORAGE = `<p>이 문서는 ${SENTENCE} 를 다룬다.</p><ac:structured-macro ac:name="info"/><p>다시 ${SENTENCE} 를 짚는다.</p><p>${UNIQUE} 를 잇는다.</p>`;

const readPageUrl = `/wiki/api/v2/pages/${PAGE_ID}?body-format=storage`;
const footerListUrl = `/wiki/api/v2/pages/${PAGE_ID}/footer-comments?body-format=storage&limit=100`;
const inlineListUrl = `/wiki/api/v2/pages/${PAGE_ID}/inline-comments?body-format=storage&limit=100`;
const footerPostUrl = "/wiki/api/v2/footer-comments";
const inlinePostUrl = "/wiki/api/v2/inline-comments";

const commentJson = (id: string, version: number, extra: Record<string, unknown> = {}) => ({
  id,
  authorId: "5f0",
  version: { number: version },
  body: { storage: { value: `${id} 의 합성 코멘트`, representation: "storage" } },
  createdAt: "2026-10-23T00:00:00Z",
  ...extra,
});

interface Call {
  method: string;
  url: string;
  body: unknown;
}

interface Rig {
  comments: DocComments;
  calls: Call[];
  served: Record<string, { status?: number; json?: unknown }>;
  plansRoot: string;
  recordFile: string;
  cleanup(): void;
}

function rig(): Rig {
  const home = mkdtempSync(join(tmpdir(), "doc-comments-"));
  const cloneRoot = join(home, "clone");
  mkdirSync(join(cloneRoot, "docs", "plans"), { recursive: true });
  writeConfluenceLedger(confluenceLedgerFile(cloneRoot), {
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
    },
    folders: {},
    unsupported: {},
  });
  const served: Record<string, { status?: number; json?: unknown }> = {
    [`GET ${readPageUrl}`]: {
      json: {
        id: PAGE_ID,
        title: "로그인 화면",
        spaceId: "SP1",
        version: { number: 4 },
        parentId: ROOT_ID,
        body: { storage: { value: PAGE_STORAGE, representation: "storage" } },
      },
    },
    [`GET ${footerListUrl}`]: {
      json: {
        results: [commentJson("41", 2), commentJson("42", 1, { parentId: "41" })],
      },
    },
    [`GET ${inlineListUrl}`]: {
      json: { results: [commentJson("32", 3)] },
    },
    [`POST ${footerPostUrl}`]: { json: { id: "71" } },
    [`POST ${inlinePostUrl}`]: { json: { id: "72" } },
    "PUT /wiki/api/v2/footer-comments/41": { json: { id: "41" } },
    "PUT /wiki/api/v2/inline-comments/32": { json: { id: "32" } },
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
        body: Buffer.from(JSON.stringify(route.json ?? {}), "utf8"),
        headers: {},
      };
    },
  };
  const credentials = new MemoryCredentialStore();
  void credentials.save("confluence-pat", "me@example.com\ntok");
  const setting: Record<string, string> = {
    "confluenceSite:demo": SITE,
    "confluenceRootId:demo": ROOT_ID,
  };
  const logger: DaemonLogger = { info() {}, warn() {}, error() {} };
  const comments = new DocComments({
    registry: { activeSlug: () => "demo", paths: (slug) => ({ root: join(home, slug) }) },
    machineSetting: { get: (key) => setting[key] ?? null },
    credentials,
    workspaceRoot: () => cloneRoot,
    logger,
    transport: () => transport,
    now: () => NOW,
  });
  const plansRoot = join(home, "demo", "plans");
  return {
    comments,
    calls,
    served,
    plansRoot,
    recordFile: join(plansRoot, "comment-ops", `${COMMAND_ID}.json`),
    cleanup() {
      rmSync(home, { recursive: true, force: true });
    },
  };
}

/** 발행 게이트 — 켜고 끄는 것은 시험이 정한다. */
function gate(on: boolean): void {
  if (on) process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH = "1";
  else delete process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH;
}

test("게이트가 꺼졌으면 코멘트는 실패다 — 원격을 두드리지 않고 기록도 남지 않는다", async () => {
  const { comments, calls, plansRoot, cleanup } = rig();
  try {
    gate(false);
    const result = await comments.create({
      pageId: PAGE_ID,
      commandId: COMMAND_ID,
      text: "합성 코멘트",
    });
    assert.equal(result.state, "failed");
    assert.equal(result.detail, "publish-disabled");
    assert.equal(result.commentId, null);
    assert.equal(calls.length, 0);
    assert.ok(!existsSync(join(plansRoot, "comment-ops", `${COMMAND_ID}.json`)));
  } finally {
    gate(false);
    cleanup();
  }
});

test("범위 밖의 문서 — 원장에 없는 문서는 out-of-scope 로 막힌다", async () => {
  const { comments, calls, cleanup } = rig();
  try {
    gate(true);
    const result = await comments.create({
      pageId: "999",
      commandId: COMMAND_ID,
      text: "합성 코멘트",
    });
    assert.equal(result.state, "failed");
    assert.equal(result.detail, "out-of-scope");
    assert.equal(calls.length, 0);
  } finally {
    gate(false);
    cleanup();
  }
});

test("바닥글 만들기 — 한 번 쓰고, 같은 명령의 재전송은 저장된 결과로 답한다", async () => {
  const { comments, calls, recordFile, cleanup } = rig();
  try {
    gate(true);
    const first = await comments.create({
      pageId: PAGE_ID,
      commandId: COMMAND_ID,
      text: "합성 코멘트\n둘째 줄",
    });
    assert.equal(first.state, "applied");
    assert.equal(first.commentId, "71");
    // 줄마다 문단이고 꺾쇠는 이스케이프다 — 마크다운은 해석하지 않는다(작업 D2a).
    assert.deepEqual(calls[0], {
      method: "POST",
      url: footerPostUrl,
      body: {
        pageId: PAGE_ID,
        body: { representation: "storage", value: "<p>합성 코멘트</p><p>둘째 줄</p>" },
      },
    });
    const saved = JSON.parse(readFileSync(recordFile, "utf8")) as {
      result: { state: string } | null;
    };
    assert.equal(saved.result?.state, "applied");

    const again = await comments.create({
      pageId: PAGE_ID,
      commandId: COMMAND_ID,
      text: "합성 코멘트\n둘째 줄",
    });
    assert.deepEqual(again, first);
    // 두 번 만들지 않는다 — 같은 명령의 POST 는 하나뿐이다(정본 계획 §9).
    assert.equal(calls.length, 1);
  } finally {
    gate(false);
    cleanup();
  }
});

test("인라인 만들기 — 한 번 나오는 문장만 count 1 · index 0 으로 잇는다", async () => {
  const { comments, calls, cleanup } = rig();
  try {
    gate(true);
    const result = await comments.create({
      pageId: PAGE_ID,
      commandId: COMMAND_ID,
      text: "합성 코멘트",
      anchor: { selection: UNIQUE, index: 0 },
    });
    assert.equal(result.state, "applied");
    assert.equal(result.commentId, "72");
    const post = calls.find((row) => row.url === inlinePostUrl);
    assert.ok(post !== undefined);
    // 보내는 닻은 언제 count 1 · index 0 이다 — 몇 번째는 믿지 않는다(2026-10-23 규칙).
    assert.deepEqual(post.body, {
      pageId: PAGE_ID,
      body: { representation: "storage", value: "<p>합성 코멘트</p>" },
      inlineCommentProperties: {
        textSelection: UNIQUE,
        textSelectionMatchCount: 1,
        textSelectionMatchIndex: 0,
      },
    });
  } finally {
    gate(false);
    cleanup();
  }
});

test("같은 commandId 의 다른 코멘트 명령 — 남의 기록을 돌려주지 않고 오류다", async () => {
  const { comments, calls, cleanup } = rig();
  try {
    gate(true);
    const first = await comments.create({
      pageId: PAGE_ID,
      commandId: COMMAND_ID,
      text: "합성 코멘트",
    });
    assert.equal(first.state, "applied");
    // 다른 문서의 같은 아이디 — 오류이지 문서 A 의 결과가 아니다.
    await assert.rejects(
      comments.create({ pageId: ROOT_ID, commandId: COMMAND_ID, text: "다른 문서 코멘트" }),
      /이미 다른 코멘트 명령에/,
    );
    // 다른 종류의 같은 아이디도 오류이다.
    await assert.rejects(
      comments.reply({
        pageId: PAGE_ID,
        commandId: COMMAND_ID,
        parentId: "41",
        kind: "footer",
        text: "답글",
      }),
      /이미 다른 코멘트 명령에/,
    );
    assert.equal(calls.length, 1, "두 번째 보내기는 없다");
  } finally {
    gate(false);
    cleanup();
  }
});

test("바뀐 문장과 모호한 자리 — anchor-missing · anchor-ambiguous 로 다시 고르게 한다", async () => {
  const { comments, calls, plansRoot, cleanup } = rig();
  try {
    gate(true);
    const missing = await comments.create({
      pageId: PAGE_ID,
      commandId: COMMAND_ID,
      text: "합성 코멘트",
      anchor: { selection: "사라진 합성 문장", index: 0 },
    });
    assert.equal(missing.state, "failed");
    assert.equal(missing.detail, "anchor-missing");

    // 두 번 나오는 문장은 index 가 무엇이든 모호하다(2026-10-23 규칙).
    for (const index of [0, 1]) {
      const ambiguous = await comments.create({
        pageId: PAGE_ID,
        commandId: COMMAND_ID,
        text: "합성 코멘트",
        anchor: { selection: SENTENCE, index },
      });
      assert.equal(ambiguous.state, "failed");
      assert.equal(ambiguous.detail, "anchor-ambiguous");
    }

    // 한 번 나오는 문장도 index 1 은 모호하다 — 보내는 닻은 index 0 뿐이다(2026-10-23 규칙).
    const nonzero = await comments.create({
      pageId: PAGE_ID,
      commandId: COMMAND_ID,
      text: "합성 코멘트",
      anchor: { selection: UNIQUE, index: 1 },
    });
    assert.equal(nonzero.state, "failed");
    assert.equal(nonzero.detail, "anchor-ambiguous");

    // 보내지 않았다 — 문장을 세는 읽기는 있어도 POST 는 없고, 기록도 없다.
    assert.ok(calls.every((row) => row.method === "GET"));
    assert.ok(!existsSync(join(plansRoot, "comment-ops", `${COMMAND_ID}.json`)));
  } finally {
    gate(false);
    cleanup();
  }
});

test("답글 — 부모가 자리를 정하고, 인라인 답글에는 닻이 없다", async () => {
  const { comments, calls, cleanup } = rig();
  try {
    gate(true);
    const footerReply = await comments.reply({
      pageId: PAGE_ID,
      commandId: commandId(1),
      parentId: "41",
      kind: "footer",
      text: "합성 답글",
    });
    assert.equal(footerReply.state, "applied");
    const footerPost = calls.find((row) => row.url === footerPostUrl);
    assert.deepEqual(footerPost?.body, {
      parentCommentId: "41",
      body: { representation: "storage", value: "<p>합성 답글</p>" },
    });

    const inlineReply = await comments.reply({
      pageId: PAGE_ID,
      commandId: commandId(2),
      parentId: "32",
      kind: "inline",
      text: "합성 답글",
    });
    assert.equal(inlineReply.state, "applied");
    const inlinePost = calls.find((row) => row.url === inlinePostUrl);
    assert.deepEqual(inlinePost?.body, {
      parentCommentId: "32",
      body: { representation: "storage", value: "<p>합성 답글</p>" },
    });
  } finally {
    gate(false);
    cleanup();
  }
});

test("수정 — 같은 판이면 쓰고, 다른 판과 없는 코멘트는 거절이다", async () => {
  const { comments, calls, cleanup } = rig();
  try {
    gate(true);
    const same = await comments.update({
      pageId: PAGE_ID,
      commandId: commandId(1),
      commentId: "41",
      kind: "footer",
      version: 2,
      text: "고친 코멘트",
    });
    assert.equal(same.state, "applied");
    assert.equal(same.commentId, "41");
    const put = calls.find((row) => row.url === "/wiki/api/v2/footer-comments/41");
    assert.deepEqual(put?.body, {
      version: { number: 3 },
      body: { representation: "storage", value: "<p>고친 코멘트</p>" },
    });

    const stale = await comments.update({
      pageId: PAGE_ID,
      commandId: commandId(2),
      commentId: "41",
      kind: "footer",
      version: 1,
      text: "고친 코멘트",
    });
    assert.equal(stale.state, "failed");
    assert.equal(stale.detail, "comment-changed");

    const absent = await comments.update({
      pageId: PAGE_ID,
      commandId: commandId(3),
      commentId: "99",
      kind: "footer",
      version: 1,
      text: "고친 코멘트",
    });
    assert.equal(absent.state, "failed");
    assert.equal(absent.detail, "comment-missing");
    // 거절의 몫은 보내지 않는다 — PUT 은 한 번뿐이다.
    assert.equal(calls.filter((row) => row.method === "PUT").length, 1);
  } finally {
    gate(false);
    cleanup();
  }
});

test("해결과 다시 열기 — 인라인만이고 본문은 지금 판 그대로다", async () => {
  const { comments, calls, cleanup } = rig();
  try {
    gate(true);
    const resolved = await comments.resolve({
      pageId: PAGE_ID,
      commandId: commandId(1),
      commentId: "32",
      version: 3,
      resolved: true,
    });
    assert.equal(resolved.state, "applied");
    assert.equal(resolved.commentId, "32");
    const put = calls.find((row) => row.url === "/wiki/api/v2/inline-comments/32");
    assert.deepEqual(put?.body, {
      version: { number: 4 },
      body: { representation: "storage", value: "32 의 합성 코멘트" },
      resolved: true,
    });

    const reopened = await comments.resolve({
      pageId: PAGE_ID,
      commandId: commandId(2),
      commentId: "32",
      version: 3,
      resolved: false,
    });
    assert.equal(reopened.state, "applied");
    const reopenedPut = calls.filter((row) => row.url === "/wiki/api/v2/inline-comments/32");
    assert.equal(reopenedPut.length, 2);
    const reopenedBody = reopenedPut[1]?.body;
    assert.ok(
      typeof reopenedBody === "object" && reopenedBody !== null && "resolved" in reopenedBody,
    );
    assert.equal(reopenedBody.resolved, false);

    // 바닥글은 해결의 대상이 아니다 — 인라인 목록에 없는 것이다.
    const footerId = await comments.resolve({
      pageId: PAGE_ID,
      commandId: commandId(3),
      commentId: "41",
      version: 2,
      resolved: true,
    });
    assert.equal(footerId.state, "failed");
    assert.equal(footerId.detail, "comment-missing");
  } finally {
    gate(false);
    cleanup();
  }
});

test("모르는 결과 — 다시 보내지 않고, 같은 명령은 저장된 모름으로 답한다", async () => {
  const { comments, calls, served, cleanup } = rig();
  try {
    gate(true);
    served[`POST ${footerPostUrl}`] = { status: 500, json: {} };
    const first = await comments.create({
      pageId: PAGE_ID,
      commandId: COMMAND_ID,
      text: "합성 코멘트",
    });
    assert.equal(first.state, "unknown");
    assert.equal(first.commentId, null);
    // 원격이 돌아왔어도 재전송은 않는다 — 적용 여부는 사람이 Confluence 에서 본다.
    served[`POST ${footerPostUrl}`] = { json: { id: "71" } };
    const again = await comments.create({
      pageId: PAGE_ID,
      commandId: COMMAND_ID,
      text: "합성 코멘트",
    });
    assert.equal(again.state, "unknown");
    assert.equal(calls.length, 1);
  } finally {
    gate(false);
    cleanup();
  }
});

test("보내기만 남은 기록 — 모름으로 답하고 다시 보내지 않는다", async () => {
  const { comments, calls, plansRoot, cleanup } = rig();
  try {
    gate(true);
    mkdirSync(join(plansRoot, "comment-ops"), { recursive: true });
    writeFileSync(
      join(plansRoot, "comment-ops", `${COMMAND_ID}.json`),
      `${JSON.stringify({
        format: 1,
        commandId: COMMAND_ID,
        op: "create",
        pageId: PAGE_ID,
        createdAt: NOW.toISOString(),
        result: null,
      })}\n`,
    );
    const result = await comments.create({
      pageId: PAGE_ID,
      commandId: COMMAND_ID,
      text: "합성 코멘트",
    });
    assert.equal(result.state, "unknown");
    assert.match(result.detail, /보낸 기록만/);
    assert.equal(calls.length, 0);
  } finally {
    gate(false);
    cleanup();
  }
});

test("서식이 든 코멘트의 수정 — comment-not-plain 으로 막고 PUT 을 보내지 않는다", async () => {
  const { comments, calls, served, cleanup } = rig();
  try {
    gate(true);
    served[`GET ${footerListUrl}`] = {
      json: {
        results: [
          commentJson("43", 2, {
            body: { storage: { value: "<p><strong>굵게</strong></p>", representation: "storage" } },
          }),
        ],
      },
    };
    const result = await comments.update({
      pageId: PAGE_ID,
      commandId: COMMAND_ID,
      commentId: "43",
      kind: "footer",
      version: 2,
      text: "고친 코멘트",
    });
    assert.equal(result.state, "failed");
    assert.equal(result.detail, "comment-not-plain");
    // 맨 글로 덮으면 잃는 것이 있다 — 원격을 고치지 않는다(2026-10-23 규칙).
    assert.ok(!calls.some((row) => row.method === "PUT"));
  } finally {
    gate(false);
    cleanup();
  }
});

test("빈 본문의 해결 — comment-unreadable 로 멈추고 PUT 을 보내지 않는다", async () => {
  const { comments, calls, served, cleanup } = rig();
  try {
    gate(true);
    served[`GET ${inlineListUrl}`] = {
      json: {
        results: [
          commentJson("33", 1, { body: { storage: { value: "", representation: "storage" } } }),
        ],
      },
    };
    const result = await comments.resolve({
      pageId: PAGE_ID,
      commandId: COMMAND_ID,
      commentId: "33",
      version: 1,
      resolved: true,
    });
    assert.equal(result.state, "failed");
    assert.equal(result.detail, "comment-unreadable");
    // 읽지 못한 본문을 빈 글로 덮지 않게 멈춘다(2026-10-23 규칙).
    assert.ok(!calls.some((row) => row.method === "PUT"));
  } finally {
    gate(false);
    cleanup();
  }
});
