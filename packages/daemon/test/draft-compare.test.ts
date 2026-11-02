import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ServerMessage } from "@colonova-design/protocol";
import { writeConfluenceLedger } from "../dist/confluence-ledger.js";
import { confluenceMirrorLedger } from "../dist/confluence-mirror.js";
import { MemoryCredentialStore } from "../dist/credentials.js";
import type { DraftAiAnswer, DraftAiRequest, DraftAiRunner } from "../dist/draft-ai.js";
import { DraftService } from "../dist/draft-service.js";
import { DraftStore } from "../dist/draft-store.js";
import type { DaemonLogger } from "../dist/log.js";
import { appendCompareDecline } from "../dist/plan-compare.js";
import type { RestTransport } from "../dist/rest-transport.js";

/**
 * 화면과 맞춰 보기의 서비스 시험(2026-11-02 · 같이 고치기 UX 계획 C7 · C8 · C4) — 판정만 돌고
 * 초안 · 화면 어디에도 쓰지 않는 것, 기획서 쪽 말의 정본(초안 우선), 안 받은 짝 걷기, 정책 고침 뒤의
 * 화면 제안 카드와 핑퐁 막기, 같이 고친 기록 도출의 절 풀기를 본다. draft-service.test 와 같은 감각의
 * 임시 rig 다 — 합성 문서만 쓰고 실사이트는 두드리지 않는다.
 */

const SITE = "colosseum.atlassian.net";
const ROOT_ID = "9";
const PAGE_ID = "123";
const KEY = `p-${PAGE_ID}`;
const NOW = new Date("2026-11-02T01:00:00Z");

const STORAGE = `<h2>로그인 흐름</h2>
<p>첫 문단이다.</p>
<p>둘째 문단이다.</p>`;

const readPageUrl = (id: string) => `/wiki/api/v2/pages/${id}?body-format=storage`;

const pageJson = (id: string, title: string, storage: string, version: number) => ({
  id,
  title,
  spaceId: "SP1",
  version: { number: version, createdAt: "2026-11-02T00:00:00Z" },
  parentId: null,
  body: { storage: { value: storage, representation: "storage" } },
});

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`조건이 끝내 맞지 않았다: ${what}`);
}

type AiImpl = (request: DraftAiRequest) => Promise<DraftAiAnswer>;

const COMPARE_ROW = {
  section: "로그인 흐름",
  plan: "8자 이상이다.",
  screen: "10자 이상이다.",
  screenName: "회원가입",
};

/** 맞춰 보기의 가짜 답 — 판정 프롬프트에만 붙는다. */
const compareAnswer = (): DraftAiAnswer => ({
  reply: "어긋남을 찾았다.",
  summary: "",
  ops: [],
  sdkSessionId: null,
  compare: { rows: [COMPARE_ROW], partial: false },
});

function rig(impl: AiImpl) {
  const home = mkdtempSync(join(tmpdir(), "draft-compare-"));
  const readRoot = join(home, "demo", "confluence");
  mkdirSync(join(readRoot, "COLO"), { recursive: true });
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
    },
    folders: {},
    unsupported: {},
  });
  writeFileSync(
    join(readRoot, "COLO", "login.md"),
    [
      "---",
      "confluence:",
      `  pageId: "${PAGE_ID}"`,
      '  space: "SP1"',
      '  title: "로그인 화면"',
      "  version: 4",
      "---",
      "",
      "## 로그인 흐름",
      "",
      "첫 문단이다.",
      "",
    ].join("\n"),
  );
  const served: Record<string, unknown> = {
    [readPageUrl(PAGE_ID)]: pageJson(PAGE_ID, "로그인 화면", STORAGE, 4),
  };
  const transport: RestTransport = {
    async request(input) {
      const json = served[input.url];
      if (json === undefined) return { status: 404, body: Buffer.from("{}", "utf8") };
      return { status: 200, body: Buffer.from(JSON.stringify(json), "utf8") };
    },
  };
  const messages: ServerMessage[] = [];
  const infos: Array<{ message: string; fields: unknown }> = [];
  const logger: DaemonLogger = {
    info: (message, fields) => infos.push({ message, fields }),
    warn() {},
    error() {},
  };
  const calls: DraftAiRequest[] = [];
  const runner: DraftAiRunner = async (request) => {
    calls.push(request);
    return await impl(request);
  };
  const service = new DraftService({
    registry: { activeSlug: () => "demo", paths: (slug) => ({ root: join(home, slug) }) },
    machineSetting: {
      get: (key) =>
        key === "confluenceSite:demo" ? SITE : key === "confluenceRootId:demo" ? ROOT_ID : null,
    },
    credentials: (() => {
      const store = new MemoryCredentialStore();
      void store.save("confluence-pat", "me@example.com\ntok");
      return store;
    })(),
    claudeExecutable: () => "/usr/local/bin/claude",
    broadcast: (message) => messages.push(message),
    logger,
    ai: runner,
    publisher: {
      async publish() {
        throw new Error("발행은 이 시험에서 안 돈다");
      },
      async recheck() {
        throw new Error("nope");
      },
      async close() {
        throw new Error("nope");
      },
      enabled: false,
    },
    now: () => NOW,
    transport: () => transport,
  });
  return {
    service,
    calls,
    home,
    infos,
    cleanup() {
      rmSync(home, { recursive: true, force: true });
    },
  };
}

test("맞춰 보기 — 초안이 없으면 공식본 사본으로 판정하고 초안을 만들지 않는다", async () => {
  const rig1 = rig(async (request) => {
    assert.match(request.prompt, /\[화면과 맞춰 보기\]/);
    assert.match(request.prompt, /Confluence 판 4/);
    assert.equal(request.resume, null);
    return compareAnswer();
  });
  try {
    const result = await rig1.service.compare(PAGE_ID);
    assert.equal(result.docKey, null);
    assert.equal(result.pageId, PAGE_ID);
    assert.equal(result.title, "로그인 화면");
    assert.equal(result.source, "Confluence 판 4");
    assert.deepEqual(result.rows, [COMPARE_ROW]);
    assert.equal(result.note, null);
    // 판정만 돌았다 — 초안은 생기지 않는다(같은 계획 C1 의 규칙과 같은 감각).
    assert.equal((await rig1.service.list()).length, 0);
  } finally {
    rig1.cleanup();
  }
});

test("맞춰 보기 — 초안이 있으면 초안이 정본이다(계획 §2) · 안 받은 짝은 걷는다", async () => {
  const rig1 = rig(async (request) => {
    if (request.prompt.includes("[화면과 맞춰 보기]")) {
      assert.match(request.prompt, /초안 개정 0/);
      return compareAnswer();
    }
    return { reply: "", summary: "", ops: [], sdkSessionId: null };
  });
  try {
    await rig1.service.open(PAGE_ID);
    appendCompareDecline(join(rig1.home, "demo"), PAGE_ID, "회원가입", NOW.toISOString());
    const declined = await rig1.service.compare(PAGE_ID);
    assert.equal(declined.docKey, KEY);
    assert.equal(declined.source, "초안 개정 0");
    assert.equal(declined.rows.length, 0, "안 받은 화면 · 문서 짝의 줄은 다시 오지 않는다");
  } finally {
    rig1.cleanup();
  }
});

test("화면 제안 — 정책을 바꾼 고침 뒤에 답 아래 카드가 선다", async () => {
  const rig1 = rig(async (request) => {
    if (request.prompt.includes("[화면과 맞춰 보기]")) return compareAnswer();
    return {
      reply: "비밀번호 길이를 고쳤다.",
      summary: "비밀번호 길이",
      ops: [
        {
          opId: "op-1",
          type: "replace",
          blockId: "b1",
          view: { kind: "paragraph", text: "10자 이상이다." },
        },
      ],
      sdkSessionId: "sess-a",
      policy: true,
    };
  });
  try {
    await rig1.service.open(PAGE_ID);
    rig1.service.ask(KEY, "비밀번호를 10자 이상으로", []);
    await until(() => rig1.calls.length >= 2, "화면 견주기까지 두 번의 호출");
    await until(() => {
      const last = rig1.service.thread(KEY).messages.at(-1);
      return last?.role === "assistant" && last.text !== "";
    }, "답이 대화에 남는다");
    const last = rig1.service.thread(KEY).messages.at(-1);
    assert.deepEqual(last?.mismatch?.rows, [COMPARE_ROW]);
  } finally {
    rig1.cleanup();
  }
});

test("화면 제안 — 꾸밈 고침(policy 없음)에는 견주기를 돌리지 않는다", async () => {
  const rig1 = rig(async () => ({
    reply: "문구만 다듬었다.",
    summary: "문구",
    ops: [
      {
        opId: "op-1",
        type: "replace",
        blockId: "b1",
        view: { kind: "paragraph", text: "다듬은 문장." },
      },
    ],
    sdkSessionId: "sess-b",
  }));
  try {
    await rig1.service.open(PAGE_ID);
    rig1.service.ask(KEY, "문구를 다듬어 줘", []);
    await until(
      () =>
        rig1.service
          .thread(KEY)
          .messages.some((one) => one.role === "assistant" && one.text !== ""),
      "답이 대화에 남는다",
    );
    assert.equal(rig1.calls.filter((one) => one.prompt.includes("[화면과 맞춰 보기]")).length, 0);
    const last = rig1.service.thread(KEY).messages.at(-1);
    assert.equal(last?.mismatch, undefined);
  } finally {
    rig1.cleanup();
  }
});

test("화면 제안 — 같이 고치기가 넣은 고침에는 카드를 띄우지 않는다(핑퐁 막기)", async () => {
  const rig1 = rig(async (request) => {
    if (request.prompt.includes("[화면과 맞춰 보기]")) return compareAnswer();
    return {
      reply: "고쳤다.",
      summary: "비밀번호 길이",
      ops: [
        {
          opId: "op-1",
          type: "replace",
          blockId: "b1",
          view: { kind: "paragraph", text: "10자 이상이다." },
        },
      ],
      sdkSessionId: "sess-c",
      policy: true,
    };
  });
  try {
    const result = await rig1.service.screenSync({
      slug: "demo",
      pageId: PAGE_ID,
      docKey: null,
      displayText: "비밀번호를 10자 이상으로",
      promptText: "[화면 요청에서 같이 고치기] …",
    });
    assert.equal(result.outcome, "adopted");
    // 정책 고침이 들어갔어도 견주기는 돌지 않는다 — autoApply 길이 아니므로(계획 §2).
    assert.equal(rig1.calls.filter((one) => one.prompt.includes("[화면과 맞춰 보기]")).length, 0);
    const last = rig1.service.thread(KEY).messages.at(-1);
    assert.equal(last?.mismatch, undefined);
  } finally {
    rig1.cleanup();
  }
});

test("기록 도출 — 걸음의 열쇠가 닿은 절을 풀어 돌려준다(C4)", async () => {
  const rig1 = rig(async () => ({
    reply: "고쳤다.",
    summary: "비밀번호 길이",
    ops: [
      {
        opId: "op-1",
        type: "replace",
        blockId: "b1",
        view: { kind: "paragraph", text: "10자 이상이다." },
      },
    ],
    sdkSessionId: "sess-d",
  }));
  try {
    const result = await rig1.service.screenSync({
      slug: "demo",
      pageId: PAGE_ID,
      docKey: null,
      displayText: "비밀번호를 10자 이상으로",
      promptText: "[화면 요청에서 같이 고치기] …",
    });
    // 기록은 지휘(screen-plan-sync)가 남긴다 — 여기서는 같은 모양으로 직접 쓴다.
    mkdirSync(join(rig1.home, "demo", "plans"), { recursive: true });
    writeFileSync(
      join(rig1.home, "demo", "plans", "screen-sync.jsonl"),
      `${JSON.stringify({
        kind: "entry",
        entryId: "e1",
        at: NOW.toISOString(),
        slug: "demo",
        sessionId: "s1",
        requestId: "r1",
        sha: null,
        docKey: KEY,
        title: "로그인 화면",
        proposalId: result.proposalId,
        opIds: result.opIds,
        inverse: [],
      })}\n`,
    );
    const { docs } = rig1.service.syncDocs("s1");
    assert.equal(docs.length, 1);
    assert.equal(docs[0]?.docKey, KEY);
    assert.equal(docs[0]?.pageId, PAGE_ID);
    assert.equal(docs[0]?.changes, 1);
    assert.deepEqual(docs[0]?.sections, ["로그인 흐름"]);
    // 다른 대화의 기록은 세지 않는다.
    assert.equal(rig1.service.syncDocs("s-other").docs.length, 0);
  } finally {
    rig1.cleanup();
  }
});
