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
import type { DaemonLogger } from "../dist/log.js";
import type { RestTransport } from "../dist/rest-transport.js";

/**
 * 화면 제안 판정의 실패 알림과 다시 시도 시험(2026-11-03 A안 1A-2 · 작업 D2) — 판정이 던지면 답에
 * `mismatchFailed` 가 서고, `draft.mismatchRetry` 가 지금 초안으로 판정을 다시 돌려 카드를 세우거나
 * 표시를 걷는 것, 토글 끔이면 판정 호출 자체가 없는 것을 본다. 임시 rig 는 draft-compare.test 의 꼴.
 */

const SITE = "colosseum.atlassian.net";
const ROOT_ID = "9";
const PAGE_ID = "123";
const KEY = `p-${PAGE_ID}`;
const NOW = new Date("2026-11-03T01:00:00Z");

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
    const { promise, resolve } = Promise.withResolvers<void>();
    setImmediate(resolve);
    await promise;
  }
  assert.fail(`조건이 끝내 맞지 않았다: ${what}`);
}

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

/** 정책을 바꾸는 생성의 가짜 답 — 화면 제안 판정이 뒤따르게 하는 조건(policy). */
const policyEditAnswer = (): DraftAiAnswer => ({
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
});

interface Rig {
  service: DraftService;
  calls: DraftAiRequest[];
  messages: ServerMessage[];
  home: string;
  cleanup(): void;
}

function rig(impl: AiImpl, settings: Record<string, string> = {}): Rig {
  const home = mkdtempSync(join(tmpdir(), "mismatch-retry-"));
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
  const logger: DaemonLogger = {
    info() {},
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
        key === "confluenceSite:demo"
          ? SITE
          : key === "confluenceRootId:demo"
            ? ROOT_ID
            : (settings[key] ?? null),
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
    importNow: async () => ({ imported: 0, skipped: 0, capped: false }),
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
    messages,
    home,
    cleanup() {
      rmSync(home, { recursive: true, force: true });
    },
  };
}
/** 정책 고침의 묻기 → 답이 대화에 남을 때까지 기다려 마지막 assistant 말을 돌려준다. */
async function askAndSettle(rig1: Rig) {
  await rig1.service.open(PAGE_ID);
  const { messageId } = rig1.service.ask(KEY, "비밀번호를 10자 이상으로", []);
  await until(
    () =>
      rig1.service
        .thread(KEY)
        .messages.some((one) => one.role === "assistant" && one.messageId === messageId),
    "답이 대화에 남는다",
  );
  return messageId;
}

const compareCalls = (rig1: Rig) =>
  rig1.calls.filter((one) => one.prompt.includes("[화면과 맞춰 보기]")).length;

test("판정이 던지면 답에 mismatchFailed 가 선다 — 조용히 삼키지 않는다", async () => {
  const rig1 = rig(async (request) => {
    if (request.prompt.includes("[화면과 맞춰 보기]")) {
      throw new Error("판정이 끊겼다");
    }
    return policyEditAnswer();
  });
  try {
    const messageId = await askAndSettle(rig1);
    assert.equal(compareCalls(rig1), 1);
    const last = rig1.service.thread(KEY).messages.at(-1);
    assert.equal(last?.messageId, messageId);
    assert.equal(last?.mismatchFailed, true);
    assert.equal(last?.mismatch, undefined);
  } finally {
    rig1.cleanup();
  }
});

test("다시 시도 — 어긋남이 남아 있으면 카드가 서고 실패 표시는 걷힌다", async () => {
  let fail = true;
  const rig1 = rig(async (request) => {
    if (request.prompt.includes("[화면과 맞춰 보기]")) {
      if (fail) throw new Error("판정이 끊겼다");
      return compareAnswer();
    }
    return policyEditAnswer();
  });
  try {
    const messageId = await askAndSettle(rig1);
    fail = false;
    assert.deepEqual(await rig1.service.mismatchRetry(KEY, messageId), { ok: true });
    await until(() => compareCalls(rig1) === 2, "판정이 다시 돈다");
    const last = rig1.service.thread(KEY).messages.at(-1);
    assert.deepEqual(last?.mismatch?.rows, [COMPARE_ROW]);
    assert.equal(last?.mismatchFailed, undefined);
    // 대화 저장 뒤의 방송 — #generate 와 같은 draft.ai done 길.
    await until(
      () =>
        rig1.messages.some(
          (one) => one.type === "draft.ai" && one.phase === "done" && one.messageId === messageId,
        ),
      "대화 갱신 방송",
    );
  } finally {
    rig1.cleanup();
  }
});

test("다시 시도 — 같다고 판정하면 카드와 실패 표시 둘 다 걷힌다", async () => {
  let fail = true;
  const rig1 = rig(async (request) => {
    if (request.prompt.includes("[화면과 맞춰 보기]")) {
      if (fail) throw new Error("판정이 끊겼다");
      return {
        reply: "어긋남이 없다.",
        summary: "",
        ops: [],
        sdkSessionId: null,
        compare: { rows: [], partial: false },
      };
    }
    return policyEditAnswer();
  });
  try {
    const messageId = await askAndSettle(rig1);
    fail = false;
    assert.deepEqual(await rig1.service.mismatchRetry(KEY, messageId), { ok: true });
    const last = rig1.service.thread(KEY).messages.at(-1);
    assert.equal(last?.mismatch, undefined);
    assert.equal(last?.mismatchFailed, undefined);
  } finally {
    rig1.cleanup();
  }
});

test("다시 시도 — 또 실패하면 표시가 그대로 남는다", async () => {
  const rig1 = rig(async (request) => {
    if (request.prompt.includes("[화면과 맞춰 보기]")) {
      throw new Error("판정이 끊겼다");
    }
    return policyEditAnswer();
  });
  try {
    const messageId = await askAndSettle(rig1);
    assert.deepEqual(await rig1.service.mismatchRetry(KEY, messageId), { ok: true });
    assert.equal(compareCalls(rig1), 2);
    const last = rig1.service.thread(KEY).messages.at(-1);
    assert.equal(last?.mismatchFailed, true);
    assert.equal(last?.mismatch, undefined);
  } finally {
    rig1.cleanup();
  }
});

test("다시 시도 — 실패 표시 없는 답은 사람 말 오류로 거절한다", async () => {
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
    const messageId = await askAndSettle(rig1);
    await assert.rejects(rig1.service.mismatchRetry(KEY, messageId), /다시 볼 것이 없어요/);
    // 판정은 한 번도 돌지 않았다 — 거절이 호출을 일으키지 않는다.
    assert.equal(compareCalls(rig1), 0);
  } finally {
    rig1.cleanup();
  }
});

test("토글 끔 — 정책 고침이 들어가도 판정을 한 번도 부르지 않는다", async () => {
  const rig1 = rig(async () => policyEditAnswer(), { planLoop: "off" });
  try {
    const messageId = await askAndSettle(rig1);
    assert.equal(compareCalls(rig1), 0, "판정 호출 0 — 추가 토큰이 들지 않는다");
    const last = rig1.service.thread(KEY).messages.at(-1);
    assert.equal(last?.messageId, messageId);
    assert.equal(last?.mismatch, undefined);
    assert.equal(last?.mismatchFailed, undefined);
  } finally {
    rig1.cleanup();
  }
});
