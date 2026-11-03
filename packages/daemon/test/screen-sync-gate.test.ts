import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { DraftBlockView, PlanSync, ServerMessage } from "@colonova-design/protocol";
import { writeConfluenceLedger } from "../dist/confluence-ledger.js";
import { confluenceMirrorLedger } from "../dist/confluence-mirror.js";
import { MemoryCredentialStore } from "../dist/credentials.js";
import type { DraftAiAnswer, DraftAiRequest, DraftAiRunner } from "../dist/draft-ai.js";
import { DraftPublisher } from "../dist/draft-publish.js";
import type { ScreenSyncInverse } from "../dist/draft-service.js";
import { DraftService } from "../dist/draft-service.js";
import { DraftStore } from "../dist/draft-store.js";
import type { DaemonLogger } from "../dist/log.js";
import { appendPlanRefs, type PlanRefEntry } from "../dist/plan-refs.js";
import type { RestTransport } from "../dist/rest-transport.js";
import {
  liveEntries,
  readSyncLines,
  ScreenPlanSync,
  type ScreenTurn,
  screenSyncFile,
} from "../dist/screen-plan-sync.js";

/**
 * 같이 고치기 게이트 시험(2026-11-03 A안 1A-1 · 1A-2) — 진짜 초안 서비스와 지휘를 붙여 본다: 판정은
 * 변경안만 남기고(pending), 곁줄의 고치기 · 건너뛰기 · 기획서 탭의 채택이 넣는다. 전체 실패 카드 ·
 * 설정 토글 · 화면 되돌리기의 기다림 걷기도 함께 본다. 합성 문서만 쓰고 실사이트는 두드리지 않는다.
 */

const SITE = "colosseum.atlassian.net";
const ROOT_ID = "9";
const PAGE_ID = "123";
const KEY = `p-${PAGE_ID}`;
const NOW = new Date("2026-11-03T01:00:00Z");

const STORAGE = `<h2>로그인 흐름</h2>
<p>첫 문단이다.</p>
<p>둘째 문단이다.</p>`;

const PAGE2_ID = "456";
const KEY2 = `p-${PAGE2_ID}`;
const STORAGE2 = `<h2>결제 흐름</h2>
<p>결제 문단이다.</p>`;
const silent: DaemonLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as DaemonLogger;

/** 문단 블록의 글 — 보기가 문단이 아니면 null 이다(단언 대신 좁힌다). */
function paragraphText(block: { view: DraftBlockView } | undefined): string | null {
  const view = block?.view;
  return view?.kind === "paragraph" ? view.text : null;
}

const ref = (sessionId: string, pageId: string): PlanRefEntry => ({
  at: "2026-11-03T00:00:00Z",
  sessionId,
  ref: {
    title: "테스트 문서",
    pageId,
    docKey: null,
    url: null,
    version: 1,
    revision: null,
    published: true,
    sections: [],
  },
});

interface Rig {
  service: DraftService;
  sync: ScreenPlanSync;
  store: DraftStore;
  emitted: PlanSync[];
  aiCalls: DraftAiRequest[];
  settledCalls: Array<{
    slug: string;
    docKey: string;
    proposalId: string;
    outcome: "adopted" | "rejected";
    opIds: string[];
    inverse: ScreenSyncInverse[];
  }>;
  root: string;
  home: string;
  cleanup(): void;
}

/**
 * 진짜 초안 서비스 위에 지휘를 얹은 리그 — 사본 · 원장 · 가짜 AI(판정 답을 정해 준다) · 기록된 전송 ·
 * 연결 레포 폴더를 만든다. `ai` 의 인자는 몇 번째 판정 호출인가다.
 */
function gateRig(ai: (call: number) => DraftAiAnswer, options?: { loopOn?: () => boolean }): Rig {
  const home = mkdtempSync(join(tmpdir(), "sync-gate-"));
  const root = join(home, "demo");
  const repoRoot = join(home, "repo");
  mkdirSync(join(root, "confluence", "COLO"), { recursive: true });
  mkdirSync(repoRoot);
  writeConfluenceLedger(confluenceMirrorLedger(root), {
    site: SITE,
    roots: [ROOT_ID],
    lastSyncAt: null,
    pages: {
      [PAGE_ID]: {
        path: "COLO/login",
        title: "로그인 화면",
        version: 1,
        sections: [],
        comments: null,
      },
      [PAGE2_ID]: {
        path: "COLO/pay",
        title: "결제 화면",
        version: 1,
        sections: [],
        comments: null,
      },
    },
    folders: {},
    unsupported: {},
  });
  const credentials = new MemoryCredentialStore();
  void credentials.save("confluence-pat", "me@example.com\ntok");
  const served: Record<string, unknown> = {
    [`/wiki/api/v2/pages/${PAGE_ID}?body-format=storage`]: {
      id: PAGE_ID,
      title: "로그인 화면",
      spaceId: "SP1",
      version: { number: 1, createdAt: "2026-11-03T00:00:00Z" },
      parentId: null,
      body: { storage: { value: STORAGE, representation: "storage" } },
    },
    [`/wiki/api/v2/pages/${PAGE2_ID}?body-format=storage`]: {
      id: PAGE2_ID,
      title: "결제 화면",
      spaceId: "SP1",
      version: { number: 1, createdAt: "2026-11-03T00:00:00Z" },
      parentId: null,
      body: { storage: { value: STORAGE2, representation: "storage" } },
    },
    "/wiki/rest/api/user/current": { accountId: "acct-1", displayName: "합성 사람" },
  };
  const transport: RestTransport = {
    async request(input) {
      const json = served[input.url];
      if (json === undefined) return { status: 404, body: Buffer.from("{}", "utf8") };
      return { status: 200, body: Buffer.from(JSON.stringify(json), "utf8") };
    },
  };
  const messages: ServerMessage[] = [];
  const emitted: PlanSync[] = [];
  const settledCalls: Rig["settledCalls"] = [];
  const aiCalls: DraftAiRequest[] = [];
  const runner: DraftAiRunner = async (request) => {
    aiCalls.push(request);
    return ai(aiCalls.length);
  };
  const service = new DraftService({
    registry: { activeSlug: () => "demo", paths: () => ({ root }) },
    machineSetting: {
      get: (key) => (key === "confluenceSite:demo" ? SITE : null),
    },
    credentials,
    claudeExecutable: () => "/usr/local/bin/claude",
    broadcast: (message) => messages.push(message),
    logger: silent,
    ai: runner,
    publisher: new DraftPublisher(),
    onScreenProposal: (input) => {
      settledCalls.push(input);
      sync.onProposalSettled(input);
    },
    now: () => NOW,
    transport: () => transport,
  });
  const sync = new ScreenPlanSync({
    drafts: service,
    paths: () => ({ root, repoRoot }),
    connected: () => true,
    titleOf: (_slug, pageId) =>
      pageId === PAGE_ID ? "로그인 화면" : pageId === PAGE2_ID ? "결제 화면" : null,
    emit: (_turn, value) => emitted.push(structuredClone(value)),
    ...(options?.loopOn !== undefined ? { loopOn: options.loopOn } : {}),
    logger: silent,
    now: () => NOW,
  });
  return {
    service,
    sync,
    store: new DraftStore(join(root, "plans"), () => NOW),
    emitted,
    aiCalls,
    settledCalls,
    root,
    home,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

/** 한 문단을 고치는 판정 답 — 걸음 하나(replace)와 한 줄 요약. */
const changeAnswer = (text: string, sdk: string): DraftAiAnswer => ({
  reply: "고쳤다.",
  summary: "비밀번호 규칙",
  ops: [
    {
      opId: "op-1",
      type: "replace",
      blockId: "b1",
      view: { kind: "paragraph", text },
    },
  ],
  sdkSessionId: sdk,
});

const turn = (requestId: string, sha = "c1"): ScreenTurn => ({
  slug: "demo",
  sessionId: "s1",
  requestId,
  request: "비밀번호를 10자 이상으로",
  screens: [{ route: "/signup", title: "회원가입" }],
  files: ["src/signup.tsx"],
  sha,
});

/** pending 문서가 든 끝 카드가 설 때까지 미세 쉼(자지 않는다) — 그 변경안의 열쇠를 돌려준다. */
async function pendingCard(rig: Rig): Promise<string> {
  for (let i = 0; i < 500; i += 1) {
    const last = rig.emitted.at(-1);
    const doc = last?.docs.find((row) => row.outcome === "pending");
    if (last?.phase === "done" && doc !== undefined) {
      const proposalId = doc.proposalId ?? "";
      assert.notEqual(proposalId, "");
      return proposalId;
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setImmediate(resolve);
    await promise;
  }
  assert.fail("pending 카드가 서지 않았다");
}

/** 없는 연결을 묻는 카드 뒤의 고르기로 pending 카드를 만든다. */
async function gate(rig: Rig, requestId: string, sha = "c1"): Promise<string> {
  await rig.sync.onSaved(turn(requestId, sha));
  assert.equal(rig.emitted.at(-1)?.ask !== undefined, true);
  await rig.sync.pick("demo", "s1", requestId, PAGE_ID);
  return await pendingCard(rig);
}

test("게이트 — 판정은 변경안만 남기고 초안은 그대로다 · 고치기가 넣으면 기록과 카드가 선다", async () => {
  const rig = gateRig(() => changeAnswer("10자 이상이다.", "sess-1"));
  try {
    await gate(rig, "r1");
    // 누름 없이는 초안이 안 바뀐다 — 변경안 기록에만 화면 표시가 남는다.
    assert.equal(paragraphText((await rig.service.get(KEY)).blocks[1]), "첫 문단이다.");
    assert.equal(rig.store.proposals(KEY)[0]?.origin, "screen");
    // 고치기 — 초안에 들어가고 entry 줄이 생기고 카드가 adopted 다.
    assert.deepEqual(await rig.sync.apply("demo", "s1", "r1", KEY), { ok: true });
    const card = rig.emitted.at(-1);
    assert.equal(card?.docs[0]?.outcome, "adopted");
    const entryId = card?.docs[0]?.entryId ?? "";
    assert.notEqual(entryId, "");
    assert.equal(paragraphText((await rig.service.get(KEY)).blocks[1]), "10자 이상이다.");
    // 곁줄 되돌리기가 지금처럼 돈다 — 고친 문단이 그 전으로.
    assert.deepEqual(await rig.sync.undo("demo", entryId), { restored: 1, kept: 0 });
    assert.equal(paragraphText((await rig.service.get(KEY)).blocks[1]), "첫 문단이다.");
    assert.equal(rig.emitted.at(-1)?.docs[0]?.outcome, "undone");
  } finally {
    rig.cleanup();
  }
});

test("게이트 — 판정 뒤 사람이 다른 블록을 고쳤으면 고치기는 넣을 수 있는 걸음만 넣는다", async () => {
  const rig = gateRig(() => ({
    reply: "두 곳을 고쳤다.",
    summary: "두 문단",
    ops: [
      {
        opId: "op-1",
        type: "replace",
        blockId: "b1",
        view: { kind: "paragraph", text: "AI 첫 문단." },
      },
      {
        opId: "op-2",
        type: "replace",
        blockId: "b2",
        view: { kind: "paragraph", text: "AI 둘째 문단." },
      },
    ],
    sdkSessionId: "sess-2",
  }));
  try {
    await gate(rig, "r1");
    // 판정과 누름 사이에 사람이 다른 블록을 고쳤다 — 개정이 올라간다.
    const view = await rig.service.get(KEY);
    await rig.service.edit(KEY, view.revision, [
      { type: "set", blockId: "b2", view: { kind: "paragraph", text: "사람이 고쳤다." } },
    ]);
    assert.deepEqual(await rig.sync.apply("demo", "s1", "r1", KEY), { ok: true });
    const card = rig.emitted.at(-1);
    assert.equal(card?.docs[0]?.outcome, "adopted");
    assert.equal(card?.docs[0]?.changes, 1);
    assert.equal(card?.docs[0]?.kept, 1);
    const after = await rig.service.get(KEY);
    assert.equal(paragraphText(after.blocks[1]), "AI 첫 문단.");
    assert.equal(paragraphText(after.blocks[2]), "사람이 고쳤다.");
    // 이미 들어간 변경안에 다시 고치기 — 사람 말 오류.
    await assert.rejects(rig.sync.apply("demo", "s1", "r1", KEY), /기다리는 고침을 찾지 못했어요/);
  } finally {
    rig.cleanup();
  }
});

test("게이트 — 건너뛰기는 변경안을 걷고 decline 줄을 남긴다 · 같은 짝은 연결로만 다시 오지 않는다", async () => {
  const rig = gateRig(() => changeAnswer("10자 이상이다.", "sess-3"));
  try {
    await gate(rig, "r1");
    assert.deepEqual(await rig.sync.skip("demo", "s1", "r1", KEY), { ok: true });
    assert.equal(rig.emitted.at(-1)?.docs[0]?.outcome, "declined");
    // 변경안의 열린 걸음은 걷혔고, 기록에 decline 줄이 생겼다.
    assert.deepEqual(
      rig.store.proposals(KEY)[0]?.ops.map((op) => op.state),
      ["rejected"],
    );
    const declines = readSyncLines(screenSyncFile(rig.root)).filter(
      (line) => line.kind === "decline",
    );
    assert.equal(declines.length, 1);
    assert.deepEqual(declines[0]?.kind === "decline" ? declines[0].routes : [], ["/signup"]);
    // 걷힌 변경안에 고치기 — 사람 말 오류.
    await assert.rejects(rig.sync.apply("demo", "s1", "r1", KEY), /기다리는 고침을 찾지 못했어요/);
    // 같은 화면이 또 보관되면 — 연결로만 이어진 같은 문서는 대상이 아니다(판정 호출 없음).
    const callsBefore = rig.aiCalls.length;
    await rig.sync.onSaved(turn("r2"));
    assert.equal(rig.aiCalls.length, callsBefore);
    // 같은 문서를 근거로 보낸 요청은 건너뛰기와 상관없이 대상이다.
    appendPlanRefs(join(rig.root, "plans", "refs.jsonl"), [ref("s1", PAGE_ID)]);
    await rig.sync.onSaved(turn("r3"));
    await pendingCard(rig);
    assert.equal(rig.aiCalls.length, callsBefore + 1);
  } finally {
    rig.cleanup();
  }
});

test("게이트 — 같은 문서의 카드 두 장이 각자 정해지고, 새 지휘(재시작)에서도 넣을 수 있다", async () => {
  const rig = gateRig((call) => changeAnswer(`판정 ${call} 번째 문단.`, `sess-${call}`));
  try {
    await gate(rig, "r1");
    // 둘째 요청 — 첫 카드가 만든 연결로 곧장 대상이 된다.
    await rig.sync.onSaved(turn("r2"));
    await pendingCard(rig);
    // 둘째는 걷고, 첫째는 새 지휘로 넣는다(재시작 — 카드 · 변경안 · origin 모두 파일에서 온다).
    assert.deepEqual(await rig.sync.skip("demo", "s1", "r2", KEY), { ok: true });
    const restart = new ScreenPlanSync({
      drafts: rig.service,
      paths: () => ({ root: rig.root, repoRoot: join(rig.home, "repo") }),
      connected: () => true,
      titleOf: () => "로그인 화면",
      emit: (_turn, value) => rig.emitted.push(structuredClone(value)),
      logger: silent,
      now: () => NOW,
    });
    assert.deepEqual(await restart.apply("demo", "s1", "r1", KEY), { ok: true });
    assert.equal(rig.emitted.at(-1)?.docs[0]?.outcome, "adopted");
    assert.equal(paragraphText((await rig.service.get(KEY)).blocks[1]), "판정 1 번째 문단.");
  } finally {
    rig.cleanup();
  }
});

test("게이트 — 판정이 못 도는 실패는 카드로 말하고 다시 시도가 돈다", async () => {
  let failOnce = true;
  const rig = gateRig(() => changeAnswer("10자 이상이다.", "sess-5"));
  try {
    // 근거가 있어야 대상이 생긴다 — 연결 파일 대신 근거 기록으로.
    appendPlanRefs(join(rig.root, "plans", "refs.jsonl"), [ref("s1", PAGE_ID)]);
    const fragile = new ScreenPlanSync({
      drafts: rig.service,
      paths: () => {
        if (failOnce) {
          failOnce = false;
          throw new Error("경로를 읽지 못했다");
        }
        return { root: rig.root, repoRoot: join(rig.home, "repo") };
      },
      connected: () => true,
      titleOf: () => "로그인 화면",
      emit: (_turn, value) => rig.emitted.push(structuredClone(value)),
      logger: silent,
      now: () => NOW,
    });
    await fragile.onSaved(turn("r1"));
    const failed = rig.emitted.at(-1);
    assert.deepEqual(failed?.failure, { kind: "sync" });
    assert.deepEqual(failed?.docs, []);
    // 다시 시도 — 같은 턴으로 다시 돌고, 이번엔 대상 고르기까지 간다.
    assert.deepEqual(await fragile.retry("demo", "s1", "r1"), { ok: true });
    await pendingCard(rig);
    assert.equal(rig.aiCalls.length, 1);
  } finally {
    rig.cleanup();
  }
});

test("게이트 — 설정이 꺼지면 자동 판정은 한 번도 불리지 않는다 · 연결은 쌓이고 고르기는 돈다", async () => {
  let loopOn = true;
  const rig = gateRig(() => changeAnswer("10자 이상이다.", "sess-6"), {
    loopOn: () => loopOn,
  });
  try {
    // 켜져 있을 때 — 없는 연결을 묻는 카드가 서고, 고르면 연결과 변경안이 생긴다.
    await gate(rig, "r1");
    assert.equal(
      JSON.parse(readFileSync(join(rig.home, "repo", "plans-map.json"), "utf8")).links[0].pageId,
      PAGE_ID,
    );
    const callsOn = rig.aiCalls.length;
    // 꺼짐 — 연결로 대상이 될 문서가 있어도 자동 판정은 돌지 않고 카드도 서지 않는다.
    loopOn = false;
    const emittedBefore = rig.emitted.length;
    await rig.sync.onSaved(turn("r2"));
    assert.equal(rig.aiCalls.length, callsOn);
    assert.equal(rig.emitted.length, emittedBefore);
    // 사람이 고르는 길은 토글과 상관없이 돈다 — 카드가 필요하니 켠 뒤 묻고 끈다.
    loopOn = true;
    await rig.sync.onSaved({
      ...turn("r3"),
      screens: [{ route: "/other", title: "다른 화면" }],
    });
    loopOn = false;
    await rig.sync.pick("demo", "s1", "r3", PAGE_ID);
    await pendingCard(rig);
    assert.equal(rig.aiCalls.length, callsOn + 1);
  } finally {
    rig.cleanup();
  }
});

test("게이트 — 되돌림 지점 뒤의 기다리는 카드는 걷히고 그 줄이 사라진다", async () => {
  const rig = gateRig(() => changeAnswer("10자 이상이다.", "sess-7"));
  try {
    const proposalId = await gate(rig, "r1", "c1");
    // 되돌림 지점(c0)보다 뒤의 보관(c1)에 묶인 기다리는 카드 — 변경안이 걷히고 줄이 사라진다.
    assert.equal(await rig.sync.undoAfterRestore("demo", ["c2", "c1", "c0"], "c0"), 0);
    assert.equal(rig.emitted.at(-1)?.docs[0]?.outcome, "unchanged");
    assert.deepEqual(
      rig.store.proposals(KEY)[0]?.ops.map((op) => op.state),
      ["rejected"],
    );
    await assert.rejects(
      rig.service.screenSyncApply({ slug: "demo", docKey: KEY, proposalId }),
      /변경안을 찾지 못했어요/,
    );
  } finally {
    rig.cleanup();
  }
});

test("게이트 — 기획서 탭의 채택 · 걷기도 기록과 카드를 맞춘다", async () => {
  const rig = gateRig(() => changeAnswer("10자 이상이다.", "sess-8"));
  try {
    const proposalId = await gate(rig, "r1");
    const view = await rig.service.get(KEY);
    const adopted = await rig.service.adopt(KEY, proposalId, ["op-1"], view.revision);
    assert.equal(paragraphText(adopted.blocks[1]), "10자 이상이다.");
    // 알림이 opIds · 되돌릴 재료를 싣고, 기록(entry 줄)과 카드가 맞춰진다.
    assert.equal(rig.settledCalls[0]?.outcome, "adopted");
    assert.deepEqual(rig.settledCalls[0]?.opIds, ["op-1"]);
    assert.equal(rig.settledCalls[0]?.inverse.length, 1);
    const card = rig.emitted.at(-1);
    assert.equal(card?.docs[0]?.outcome, "adopted");
    const entryId = card?.docs[0]?.entryId ?? "";
    assert.equal(liveEntries(readSyncLines(screenSyncFile(rig.root))).length, 1);
    assert.deepEqual(await rig.sync.undo("demo", entryId), { restored: 1, kept: 0 });
    assert.equal(paragraphText((await rig.service.get(KEY)).blocks[1]), "첫 문단이다.");
    // 걷기 — 두 번째 판정의 변경안을 기획서 탭에서 걷으면 카드의 줄이 사라진다(unchanged).
    await rig.sync.onSaved(turn("r2", "c2"));
    await pendingCard(rig);
    const second = rig.store.proposals(KEY).at(-1)?.proposalId ?? "";
    await rig.service.reject(KEY, second);
    assert.equal(rig.settledCalls.at(-1)?.outcome, "rejected");
    assert.equal(rig.emitted.at(-1)?.docs[0]?.outcome, "unchanged");
  } finally {
    rig.cleanup();
  }
});

test("게이트 — 카드 줄이 여럿일 때 화면 복원은 마지막 카드만 다시 선다(옛 모양 되살리기 없음)", async () => {
  const rig = gateRig((call) => changeAnswer(`판정 ${call} 번째 문단.`, `sess-${call}`));
  try {
    // 한 요청에 이어진 문서 둘 — 카드 한 장에 기다리는 줄 둘(같은 (sessionId, requestId) 묶음).
    writeFileSync(
      join(rig.home, "repo", "plans-map.json"),
      JSON.stringify({
        format: 1,
        links: [
          { pageId: PAGE_ID, route: "/signup" },
          { pageId: PAGE2_ID, route: "/signup" },
        ],
      }),
    );
    await rig.sync.onSaved(turn("r1", "c1"));
    const card = rig.emitted.at(-1);
    assert.deepEqual(
      card?.docs.map((doc) => doc.outcome),
      ["pending", "pending"],
    );
    // 한 문서를 넣으면 같은 요청의 카드 줄이 하나 더 쌓인다 — 복원은 이 마지막 줄만 본다.
    assert.deepEqual(await rig.sync.apply("demo", "s1", "r1", KEY), { ok: true });
    assert.equal(rig.emitted.at(-1)?.docs[0]?.outcome, "adopted");
    const undone = await rig.sync.undoAfterRestore("demo", ["c2", "c1", "c0"], "c0");
    assert.equal(undone, 1);
    const last = rig.emitted.at(-1);
    assert.equal(last?.docs.find((doc) => doc.docKey === KEY)?.outcome, "undone");
    assert.equal(last?.docs.find((doc) => doc.docKey === KEY2)?.outcome, "unchanged");
    // 마지막 카드 줄이 옛 모양으로 되살아나지 않는다 — 기록의 끝도 같은 모양.
    const onDisk = readSyncLines(screenSyncFile(rig.root))
      .filter((line) => line.kind === "card")
      .at(-1);
    assert.equal(
      onDisk?.kind === "card" ? onDisk.sync.docs.find((doc) => doc.docKey === KEY)?.outcome : null,
      "undone",
    );
    // 걸음 둘 다 정해졌다 — 되돌린 것은 거절로, 걷힌 것도 거절로.
    assert.deepEqual(
      rig.store.proposals(KEY)[0]?.ops.map((op) => op.state),
      ["rejected"],
    );
    assert.deepEqual(
      rig.store.proposals(KEY2)[0]?.ops.map((op) => op.state),
      ["rejected"],
    );
  } finally {
    rig.cleanup();
  }
});

test("게이트 — 줄에 든 고치기도 화면 복원이 함께 되돌린다(초안이 그 전으로)", async () => {
  const rig = gateRig(() => changeAnswer("10자 이상이다.", "sess-q"));
  try {
    await gate(rig, "r1", "c1");
    // 고치기를 줄에 넣고 끝나기 전에 복원을 부른다 — 고치기가 먼저 쓴 entry 도 되돌림이 담는다.
    const applying = rig.sync.apply("demo", "s1", "r1", KEY);
    const restored = rig.sync.undoAfterRestore("demo", ["c2", "c1", "c0"], "c0");
    await applying;
    assert.equal(await restored, 1);
    assert.equal(paragraphText((await rig.service.get(KEY)).blocks[1]), "첫 문단이다.");
    assert.equal(rig.emitted.at(-1)?.docs[0]?.outcome, "undone");
  } finally {
    rig.cleanup();
  }
});

test("게이트 — 전부 오래된 고치기 뒤에도 기획서 탭의 걷기가 카드를 맞춘다", async () => {
  const rig = gateRig(() => changeAnswer("10자 이상이다.", "sess-p"));
  try {
    const proposalId = await gate(rig, "r1");
    // 사람이 그 블록을 고쳐 모든 걸음이 오래됐다 — 고치기는 proposed 로 돌아오고 열쇠는 남는다.
    const view = await rig.service.get(KEY);
    await rig.service.edit(KEY, view.revision, [
      { type: "set", blockId: "b1", view: { kind: "paragraph", text: "사람이 먼저 고쳤다." } },
    ]);
    assert.deepEqual(await rig.sync.apply("demo", "s1", "r1", KEY), { ok: true });
    const card = rig.emitted.at(-1);
    assert.equal(card?.docs[0]?.outcome, "proposed");
    assert.equal(card?.docs[0]?.proposalId, proposalId);
    // 기획서 탭에서 그 변경안을 걷으면 카드의 줄이 사라진다(unchanged) — 열쇠가 남아 있어 찾는다.
    await rig.service.reject(KEY, proposalId);
    assert.equal(rig.settledCalls.at(-1)?.outcome, "rejected");
    assert.equal(rig.emitted.at(-1)?.docs[0]?.outcome, "unchanged");
  } finally {
    rig.cleanup();
  }
});
