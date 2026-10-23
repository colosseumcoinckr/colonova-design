import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  type DraftRecord,
  DraftStaleError,
  DraftStore,
  type ProposalRecord,
  type PublishIntentRecord,
  type ThreadRecord,
} from "../dist/draft-store.js";

/**
 * 초안 저장소 (2026-10-23 · 작업 A2) — 만들기 · 개정 걸고 저장하기 · 관용 읽기 · 지우기 ·
 * 발행 의도의 불변 본문 · 경로 열쇠 검사 · 한 줄로 세운 작업을 임시 폴더에서 본다.
 */

const KEY = "p-123";
const BASE_XML = "<p>기준 원문</p>\n";

/** 시험가 직접 놓아주는 문 — 실제 시계를 쓰지 않고 작업을 세워 둔다. */
function gate(): { wait: Promise<void>; release: () => void } {
  let release: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

function newRoot(): string {
  return mkdtempSync(join(tmpdir(), "draft-store-"));
}

function makeDraft(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    format: 1,
    docKey: KEY,
    kind: "existing",
    site: "https://colosseum.atlassian.net",
    pageId: "123",
    spaceId: "COLO",
    parent: { id: "9", type: "page", title: "기획 루트" },
    title: "로그인 화면 기획",
    baseTitle: "로그인 화면",
    baseVersion: 4,
    baseFetchedAt: "2026-10-23T09:00:00.000Z",
    revision: 3,
    state: "editing",
    frame: [{ raw: "<h2>화면 흐름</h2>" }, { slot: "main" }],
    blocks: [
      {
        id: "b0",
        slot: "main",
        kind: "paragraph",
        xml: "<p>첫 문단</p>",
        baseFingerprint: "0123456789abcdef",
      },
    ],
    observedVersion: null,
    pendingCommandId: null,
    createdAt: "2026-10-23T09:00:00.000Z",
    updatedAt: "2026-10-23T09:30:00.000Z",
    ...overrides,
  };
}

function makeProposal(): ProposalRecord {
  return {
    proposalId: "pr-1",
    threadId: "t-1",
    createdAt: "2026-10-23T09:01:00.000Z",
    draftRevision: 3,
    baseVersion: 4,
    summary: "첫 문단을 다듬는다",
    ops: [
      {
        opId: "op-1",
        type: "replace",
        blockId: "b0",
        view: { kind: "paragraph", text: "다듬은 문단" },
        state: "open",
        baseFingerprint: "0123456789abcdef",
      },
      {
        opId: "op-2",
        type: "insert",
        afterBlockId: "b0",
        view: { kind: "heading", level: 2, text: "새 절" },
        state: "open",
        baseFingerprint: null,
      },
      {
        opId: "op-3",
        type: "delete",
        blockId: "b1",
        state: "rejected",
        baseFingerprint: "fedcba9876543210",
      },
      { opId: "op-4", type: "title", title: "다듬은 제목", state: "open", baseFingerprint: null },
    ],
  };
}

function makeThread(): ThreadRecord {
  return {
    format: 1,
    threadId: "t-1",
    docKey: KEY,
    sdkSessionId: "sdk-1",
    messages: [
      {
        messageId: "m-1",
        role: "user",
        text: "첫 문단을 다듬어 줘",
        at: "2026-10-23T09:00:00.000Z",
        refs: [{ pageId: "123", title: "로그인 화면", version: 4, sections: ["화면 흐름"] }],
      },
      {
        messageId: "m-2",
        role: "assistant",
        text: "이렇게 다듬어 보았다",
        at: "2026-10-23T09:01:00.000Z",
        proposalId: "pr-1",
        reads: [{ pageId: "555", title: "가입 화면", version: null }],
      },
    ],
  };
}

const INTENT_ID = "0b1f8f2e-1111-4222-8333-444455556666";

function makeIntent(overrides: Partial<PublishIntentRecord> = {}): PublishIntentRecord {
  return {
    format: 1,
    commandId: INTENT_ID,
    docKey: KEY,
    kind: "update",
    site: "https://colosseum.atlassian.net",
    pageId: "123",
    spaceId: "COLO",
    parentId: "9",
    title: "로그인 화면 기획",
    baseVersion: 4,
    targetVersion: 5,
    bodyFingerprint: "abcdef0123456789",
    stage: { notation: "0.9", reason: "초안 단계 발행" },
    confirmedAt: "2026-10-23T10:00:00.000Z",
    state: "sending",
    result: null,
    ...overrides,
  };
}

test("초안을 만들고 읽고 기준 원문을 읽는다 — 이미 있으면 거절한다", () => {
  const root = newRoot();
  try {
    const store = new DraftStore(root);
    const saved = store.create(makeDraft(), BASE_XML);
    assert.deepEqual(store.read(KEY), saved);
    assert.equal(store.readBase(KEY), BASE_XML);
    assert.throws(() => store.create(makeDraft(), null), /초안이 이미 있습니다/);
    // 기준 원문 없는 초안 — base 파일을 만들지 않는다.
    store.create(makeDraft({ docKey: "p-5" }), null);
    assert.equal(store.readBase("p-5"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("save 는 개정을 한 올리고 주입한 시계로 updatedAt 을 적는다 — 기대 개정이 다르면 draft.stale 이다", () => {
  const root = newRoot();
  try {
    let tick = 0;
    const store = new DraftStore(root, () => new Date(++tick * 1_000));
    store.create(makeDraft(), null);
    const edited = makeDraft({
      blocks: [
        {
          id: "b0",
          slot: "main",
          kind: "paragraph",
          xml: "<p>고친 문단</p>",
          baseFingerprint: null,
        },
      ],
    });
    const saved = store.save(edited, 3);
    assert.equal(saved.revision, 4);
    assert.equal(saved.updatedAt, "1970-01-01T00:00:01.000Z");
    const reread = store.read(KEY);
    assert.equal(reread?.revision, 4);
    assert.equal(reread?.blocks[0]?.xml, "<p>고친 문단</p>");
    // 디스크는 벌써 4 — 기대 3 은 어긋난 것이다.
    assert.throws(
      () => store.save(edited, 3),
      (error: unknown) => {
        assert.ok(error instanceof DraftStaleError);
        assert.equal(error.code, "draft.stale");
        return true;
      },
    );
    assert.throws(() => store.save(makeDraft({ docKey: "p-7" }), 0), /초안이 없습니다/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("깨진 파일은 읽지 않는다 — read 는 null 이고 list 는 건너뛴다", () => {
  const root = newRoot();
  try {
    mkdirSync(join(root, "drafts"), { recursive: true });
    writeFileSync(join(root, "drafts", "p-11.json"), "{ 깨진 json");
    writeFileSync(
      join(root, "drafts", "p-12.json"),
      JSON.stringify({ ...makeDraft({ docKey: "p-12" }), format: 2 }),
    );
    const missingTitle = makeDraft({ docKey: "p-13" }) as Record<string, unknown>;
    delete missingTitle.title;
    writeFileSync(join(root, "drafts", "p-13.json"), JSON.stringify(missingTitle));
    // 모르는 필드는 무시한다 — 살아 남는다.
    const withJunk = makeDraft({ docKey: "p-14" }) as Record<string, unknown>;
    withJunk.unknownField = { whatever: true };
    writeFileSync(join(root, "drafts", "p-14.json"), JSON.stringify(withJunk));
    const store = new DraftStore(root);
    assert.equal(store.read("p-11"), null);
    assert.equal(store.read("p-12"), null);
    assert.equal(store.read("p-13"), null);
    assert.equal(store.read("p-999"), null);
    assert.deepEqual(store.read("p-14"), makeDraft({ docKey: "p-14" }));
    assert.deepEqual(
      store.list().map((draft) => draft.docKey),
      ["p-14"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("list 는 updatedAt 이 늦은 초안부터 돌려준다", () => {
  const root = newRoot();
  try {
    const store = new DraftStore(root);
    store.create(makeDraft({ docKey: "p-1", updatedAt: "2026-10-23T09:00:00.000Z" }), null);
    store.create(makeDraft({ docKey: "p-2", updatedAt: "2026-10-23T10:00:00.000Z" }), null);
    store.create(makeDraft({ docKey: "p-3", updatedAt: "2026-10-23T09:30:00.000Z" }), null);
    assert.deepEqual(
      store.list().map((draft) => draft.docKey),
      ["p-2", "p-3", "p-1"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remove 는 초안 · 기준 · 변경안 · 대화를 지우고 발행 의도는 남긴다", () => {
  const root = newRoot();
  try {
    const store = new DraftStore(root);
    store.create(makeDraft(), BASE_XML);
    store.saveProposals(KEY, [makeProposal()]);
    store.saveThread(makeThread());
    store.saveIntent(makeIntent(), "<p>확인한 본문</p>");
    store.remove(KEY);
    assert.equal(store.read(KEY), null);
    assert.equal(store.readBase(KEY), null);
    assert.deepEqual(store.proposals(KEY), []);
    assert.equal(store.thread(KEY), null);
    // 발행 의도는 불변 기록이다.
    assert.equal(store.intent(INTENT_ID)?.state, "sending");
    assert.equal(store.intentBody(INTENT_ID), "<p>확인한 본문</p>");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("변경안과 대화는 그대로 왕복한다", () => {
  const root = newRoot();
  try {
    const store = new DraftStore(root);
    assert.deepEqual(store.proposals(KEY), []);
    assert.equal(store.thread(KEY), null);
    store.saveProposals(KEY, [makeProposal()]);
    store.saveThread(makeThread());
    assert.deepEqual(store.proposals(KEY), [makeProposal()]);
    assert.deepEqual(store.thread(KEY), makeThread());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("발행 의도 — 본문은 처음 한 번만 쓰이고 상태와 결과는 다시 쓴다", () => {
  const root = newRoot();
  try {
    const store = new DraftStore(root);
    store.saveIntent(makeIntent({ state: "sending" }), "<p>확인한 본문</p>");
    store.saveIntent(
      makeIntent({
        state: "applied",
        result: { pageId: "123", version: 5, at: "2026-10-23T10:05:00.000Z" },
      }),
      "<p>다르게 고친 본문 — 무시되어야 한다</p>",
    );
    const intent = store.intent(INTENT_ID);
    assert.equal(intent?.state, "applied");
    assert.deepEqual(intent?.result, { pageId: "123", version: 5, at: "2026-10-23T10:05:00.000Z" });
    assert.equal(store.intentBody(INTENT_ID), "<p>확인한 본문</p>");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("intents 는 confirmedAt 이 늦은 의도부터 돌려준다 — 본문 없는 의도도 기록된다", () => {
  const root = newRoot();
  try {
    const store = new DraftStore(root);
    const first = `${INTENT_ID.slice(0, -1)}1`;
    const second = `${INTENT_ID.slice(0, -1)}2`;
    const third = `${INTENT_ID.slice(0, -1)}3`;
    store.saveIntent(
      makeIntent({ commandId: first, confirmedAt: "2026-10-23T10:00:00.000Z" }),
      "<p/></p>",
    );
    store.saveIntent(
      makeIntent({ commandId: second, confirmedAt: "2026-10-23T11:00:00.000Z" }),
      "<p/></p>",
    );
    store.saveIntent(makeIntent({ commandId: third, confirmedAt: "2026-10-23T09:00:00.000Z" }));
    assert.deepEqual(
      store.intents().map((intent) => intent.commandId),
      [second, first, third],
    );
    assert.equal(store.intentBody(third), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("잘못된 초안 열쇠와 명령 아이디는 거절한다 — 경로가 되지 못하게", () => {
  const root = newRoot();
  try {
    const store = new DraftStore(root);
    const badKeys = ["../x", "p-abc", "n-ABCDEF0123456789ABCDEF0123456789", ""];
    for (const badKey of badKeys) {
      assert.throws(() => store.read(badKey));
      assert.throws(() => store.readBase(badKey));
      assert.throws(() => store.replaceBase(badKey, BASE_XML));
      assert.throws(() => store.create(makeDraft({ docKey: badKey }), null));
      assert.throws(() => store.save(makeDraft({ docKey: badKey }), 1));
      assert.throws(() => store.remove(badKey));
      assert.throws(() => store.proposals(badKey));
      assert.throws(() => store.saveProposals(badKey, []));
      assert.throws(() => store.thread(badKey));
      assert.throws(() =>
        store.saveThread({
          format: 1,
          threadId: "t-1",
          docKey: badKey,
          sdkSessionId: null,
          messages: [],
        }),
      );
      assert.throws(() => store.withLock(badKey, () => 1));
    }
    const badCommandIds = ["not-a-uuid", "0B1F8F2E-AAAA-4BBB-8CCC-DDDDEEEE0000", ""];
    for (const badCommandId of badCommandIds) {
      assert.throws(() => store.intent(badCommandId));
      assert.throws(() => store.intentBody(badCommandId));
      assert.throws(() => store.saveIntent(makeIntent({ commandId: badCommandId })));
    }
    assert.throws(() => store.saveIntent(makeIntent({ docKey: "../x" })));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("withLock 은 같은 열쇠의 작업을 차례로 세운다 — 앞 작업이 놓이기 전까지 뒤가 시작하지 않는다", async () => {
  const root = newRoot();
  try {
    const store = new DraftStore(root);
    const order: string[] = [];
    const entered = gate();
    const { wait, release } = gate();
    const first = store.withLock(KEY, async () => {
      order.push("앞 시작");
      entered.release();
      await wait;
      order.push("앞 끝");
    });
    // 앞 작업이 아직 서 있다 — 뒤 작업을 줄세운다.
    const second = store.withLock(KEY, () => {
      order.push("뒤 시작");
    });
    await entered.wait;
    assert.deepEqual(order, ["앞 시작"]);
    release();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["앞 시작", "앞 끝", "뒤 시작"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("withLock 은 앞 작업이 던져도 다음 작업을 돌린다", async () => {
  const root = newRoot();
  try {
    const store = new DraftStore(root);
    const first = store.withLock(KEY, () => {
      throw new Error("앞의 실패");
    });
    const second = store.withLock(KEY, () => 7);
    await assert.rejects(first, /앞의 실패/);
    assert.equal(await second, 7);
    // 사슬은 아직 산다 — 다음 작업도 곧바로 돈다.
    assert.equal(await store.withLock(KEY, () => "다음"), "다음");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("withLock 은 다른 열쇠를 서로 기다리게 하지 않는다", async () => {
  const root = newRoot();
  try {
    const store = new DraftStore(root);
    const order: string[] = [];
    const { wait, release } = gate();
    let slowDone = false;
    const slow = store.withLock("p-1", async () => {
      await wait;
      slowDone = true;
    });
    const quick = store.withLock("p-2", () => {
      order.push("빠른 끝");
    });
    await quick;
    // 느린 작업이 아직 서 있어도 다른 열쇠의 작업은 끝난다.
    assert.deepEqual(order, ["빠른 끝"]);
    assert.equal(slowDone, false);
    release();
    await slow;
    assert.equal(slowDone, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("원자 쓰기 — 쓰고 나면 어느 폴더에도 임시 파일이 남지 않는다", () => {
  const root = newRoot();
  try {
    const store = new DraftStore(root);
    store.create(makeDraft(), BASE_XML);
    store.save(makeDraft(), 3);
    store.saveProposals(KEY, [makeProposal()]);
    store.saveThread(makeThread());
    store.saveIntent(makeIntent(), "<p>확인한 본문</p>");
    for (const folder of ["drafts", "proposals", "threads", "intents"]) {
      const names = readdirSync(join(root, folder));
      const leftovers = names.filter((name) => name.includes(".tmp-"));
      assert.deepEqual(leftovers, [], `${folder} 에 임시 파일이 남았다`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("맨 앞에 넣는 걸음(앵커 null)도 변경안 왕복에서 살아남는다", () => {
  const root = newRoot();
  try {
    const store = new DraftStore(root);
    const proposal = makeProposal();
    proposal.ops.push({
      opId: "op-5",
      type: "insert",
      afterBlockId: null,
      view: { kind: "paragraph", text: "맨 앞 문단" },
      state: "open",
      baseFingerprint: null,
    });
    store.saveProposals(KEY, [proposal]);
    const read = store.proposals(KEY)[0];
    assert.ok(read !== undefined);
    const first = read.ops.find((op) => op.opId === "op-5");
    assert.ok(first !== undefined && first.type === "insert");
    assert.equal(first.afterBlockId, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ————— 기준을 바꾸면 열린 걸음이 오래됨이 된다(2026-10-23 · 작업 B10) —————

const NEW_BASE_XML = "<p>새 기준 원문</p>\n";

/** 둘째 변경안 — 채택 · 열림 · 이미 오래됨 · 거절이 한 변경안에 섞여 있다. */
function makeSecondProposal(): ProposalRecord {
  return {
    proposalId: "pr-2",
    threadId: "t-1",
    createdAt: "2026-10-23T09:05:00.000Z",
    draftRevision: 4,
    baseVersion: 4,
    summary: "둘째 변경안",
    ops: [
      {
        opId: "op-5",
        type: "replace",
        blockId: "b0",
        view: { kind: "paragraph", text: "채택한 문단" },
        state: "adopted",
        baseFingerprint: "0123456789abcdef",
      },
      {
        opId: "op-6",
        type: "delete",
        blockId: "b1",
        state: "open",
        baseFingerprint: "fedcba9876543210",
      },
      {
        opId: "op-7",
        type: "insert",
        afterBlockId: null,
        view: { kind: "paragraph", text: "맨 앞 문단" },
        state: "open",
        baseFingerprint: null,
      },
      {
        opId: "op-8",
        type: "title",
        title: "이미 오래된 제목",
        state: "stale",
        baseFingerprint: null,
      },
      {
        opId: "op-9",
        type: "insert",
        afterBlockId: "b0",
        view: { kind: "heading", level: 3, text: "거절한 절" },
        state: "rejected",
        baseFingerprint: null,
      },
    ],
  };
}

/** 열린 걸음만 오래됨으로 바꾼 같은 변경안 — 다른 필드는 그대로여야 한다는 기대치다. */
function withOpenOpsStale(proposal: ProposalRecord): ProposalRecord {
  return {
    ...proposal,
    ops: proposal.ops.map((op) => (op.state === "open" ? { ...op, state: "stale" as const } : op)),
  };
}

test("replaceBase — 그 초안의 열린 걸음만 오래됨으로 바꾸고 채택 · 거절 · 이미 오래된 걸음은 그대로 둔다", () => {
  const root = newRoot();
  try {
    const store = new DraftStore(root);
    store.create(makeDraft(), BASE_XML);
    store.create(makeDraft({ docKey: "p-5" }), BASE_XML);
    store.saveProposals(KEY, [makeProposal(), makeSecondProposal()]);
    store.saveProposals("p-5", [makeProposal()]);

    store.replaceBase(KEY, NEW_BASE_XML);

    assert.equal(store.readBase(KEY), NEW_BASE_XML);
    // 열린 걸음은 모두 오래됨 — 채택 · 거절 · 이미 오래된 걸음의 상태는 그대로다.
    assert.deepEqual(
      store.proposals(KEY).map((proposal) => proposal.ops.map((op) => [op.opId, op.state])),
      [
        [
          ["op-1", "stale"],
          ["op-2", "stale"],
          ["op-3", "rejected"],
          ["op-4", "stale"],
        ],
        [
          ["op-5", "adopted"],
          ["op-6", "stale"],
          ["op-7", "stale"],
          ["op-8", "stale"],
          ["op-9", "rejected"],
        ],
      ],
    );
    // 상태 말고는 한 필드도 바뀌지 않는다 — 변경안 머리 · 걸음의 대상 · 보기 · 기준 지문이다.
    assert.deepEqual(store.proposals(KEY), [
      withOpenOpsStale(makeProposal()),
      withOpenOpsStale(makeSecondProposal()),
    ]);
    // 다른 초안의 변경안과 기준은 건드리지 않는다.
    assert.deepEqual(store.proposals("p-5"), [makeProposal()]);
    assert.equal(store.readBase("p-5"), BASE_XML);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("replaceBase — 변경안이 없으면 변경안 파일을 만들지 않고 열린 걸음이 없으면 내용을 바꾸지 않는다", () => {
  const root = newRoot();
  try {
    const store = new DraftStore(root);
    store.create(makeDraft(), BASE_XML);
    store.replaceBase(KEY, NEW_BASE_XML);
    assert.equal(store.readBase(KEY), NEW_BASE_XML);
    assert.equal(existsSync(join(root, "proposals", `${KEY}.json`)), false);
    assert.deepEqual(store.proposals(KEY), []);
    // 열린 걸음이 하나도 없는 변경안 — 기준이 바뀌어도 파일의 내용이 그대로다.
    const settled = makeSecondProposal();
    settled.ops = settled.ops.filter((op) => op.state !== "open");
    store.saveProposals(KEY, [settled]);
    const file = join(root, "proposals", `${KEY}.json`);
    const before = readFileSync(file, "utf8");
    store.replaceBase(KEY, BASE_XML);
    assert.equal(readFileSync(file, "utf8"), before);
    assert.equal(store.readBase(KEY), BASE_XML);
    assert.deepEqual(
      store.proposals(KEY)[0]?.ops.map((op) => [op.opId, op.state]),
      [
        ["op-5", "adopted"],
        ["op-8", "stale"],
        ["op-9", "rejected"],
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
