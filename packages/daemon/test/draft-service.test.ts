import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  DraftBlockView,
  DraftPublishPreview,
  DraftPublishResult,
  DraftRefInput,
  ServerMessage,
} from "@colonova-design/protocol";
import { writeConfluenceLedger } from "../dist/confluence-ledger.js";
import { confluenceMirrorLedger } from "../dist/confluence-mirror.js";
import { MemoryCredentialStore } from "../dist/credentials.js";
import type { DraftAiAnswer, DraftAiRequest, DraftAiRunner } from "../dist/draft-ai.js";
import {
  composeDraftBody,
  type DraftPublishContext,
  DraftPublisher,
} from "../dist/draft-publish.js";
import { DraftService } from "../dist/draft-service.js";
import {
  type DraftRecord,
  DraftStaleError,
  DraftStore,
  type PublishIntentRecord,
} from "../dist/draft-store.js";
import type { DaemonLogger } from "../dist/log.js";
import { readPlanRef } from "../dist/plan-refs.js";
import type { RestTransport } from "../dist/rest-transport.js";
import { blockFingerprint } from "../dist/storage-blocks.js";

/**
 * 초안 서비스 시험(2026-10-23 · 작업 B2) — 임시 폴더의 가짜 프로젝트 · 기획서 사본(원장과 파생
 * 마크다운), 기록된 전송, 가짜 AI, 가짜 발행기로 열기 · 만들기 · 고치기 · 묻기 · 채택 · 발행
 * 묶음을 본다. 합성 문서만 쓰고, 실사이트는 절대 두드리지 않는다.
 */

const SITE = "colosseum.atlassian.net";
const ROOT_ID = "9";
const PAGE_ID = "123";
const KEY = `p-${PAGE_ID}`;
const NOW = new Date("2026-10-23T01:00:00Z");

const STORAGE = `<h2>로그인 흐름</h2>
<p>첫 문단이다.</p>
<p>둘째 문단이다.</p>`;

const TEMPLATE_STORAGE = `<p>틀의 문단이다.</p>`;

const MACRO_STORAGE = `<p>앞 문단이다.</p>
<ac:structured-macro ac:name="info"><ac:rich-text-body><p>안 문단이다.</p></ac:rich-text-body></ac:structured-macro>`;

// 제목 안의 매크로 — 투영은 토큰 ⟦t1⟧ 으로 자리를 지키고, 파생 마크다운은 자리 표시로 내려앉는다.
const TOKEN_STORAGE = `<h2>알림 절 <ac:structured-macro ac:name="info"><ac:rich-text-body><p>매크로 몸이다.</p></ac:rich-text-body></ac:structured-macro></h2><p>알림 절의 몸이다.</p><h2>다른 절</h2><p>다른 절의 몸이다.</p>`;

const readPageUrl = (id: string) => `/wiki/api/v2/pages/${id}?body-format=storage`;
const WHOAMI_URL = "/wiki/rest/api/user/current";

const pageJson = (id: string, title: string, storage: string, version: number) => ({
  id,
  title,
  spaceId: "SP1",
  version: { number: version, createdAt: "2026-10-23T00:00:00Z" },
  parentId: null,
  body: { storage: { value: storage, representation: "storage" } },
});

/** 조건이 맞아떨어질 때까지 미세 쉼 — 도는 생성의 방송을 기다린다(자지 않는다). */
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`조건이 끝내 맞지 않았다: ${what}`);
}

type AiImpl = (
  request: DraftAiRequest,
  callbacks: {
    onText(text: string): void;
    onRead(absPath: string): void;
  },
) => Promise<DraftAiAnswer>;

/** 문단 블록의 글 — 보기가 문단이 아니면 null 이다(단언 대신 좁힌다). */
function paragraphText(block: { view: DraftBlockView } | undefined): string | null {
  const view = block?.view;
  return view?.kind === "paragraph" ? view.text : null;
}

function fakeAi(impl: AiImpl): { runner: DraftAiRunner; calls: DraftAiRequest[] } {
  const calls: DraftAiRequest[] = [];
  return {
    calls,
    runner: async (request, callbacks) => {
      calls.push(request);
      return await impl(request, callbacks);
    },
  };
}

/** 발행기의 가짜 — 서명은 그대로 두고 자리와 방송만 본다. */
class FakePublisher extends DraftPublisher {
  readonly seen: DraftPublishContext[] = [];

  override async preview(_ctx: DraftPublishContext, docKey: string): Promise<DraftPublishPreview> {
    this.seen.push(_ctx);
    return {
      docKey,
      kind: "update",
      pageId: PAGE_ID,
      title: "로그인 화면",
      titleChanged: false,
      parent: null,
      baseVersion: 4,
      remoteVersion: 4,
      draftRevision: 0,
      changes: { changed: 0, inserted: 0, deleted: 0, protectedRemoved: [] },
      stage: { current: null, closed: false, required: false },
      blockers: [],
      checkedAt: NOW.toISOString(),
    };
  }

  override async publish(
    ctx: DraftPublishContext,
    input: { docKey: string; commandId: string; expectedRevision: number },
  ): Promise<DraftPublishResult> {
    this.seen.push(ctx);
    const record = ctx.store.read(input.docKey);
    if (record !== null) {
      ctx.store.save({ ...record, state: "publishing" }, input.expectedRevision);
    }
    return {
      commandId: input.commandId,
      docKey: input.docKey,
      state: "applied",
      pageId: PAGE_ID,
      version: 5,
      detail: "",
    };
  }

  override async recheck(ctx: DraftPublishContext, commandId: string): Promise<DraftPublishResult> {
    this.seen.push(ctx);
    const intent = ctx.store.intent(commandId);
    const docKey = intent?.docKey ?? KEY;
    const record = ctx.store.read(docKey);
    if (record !== null && record.state !== "published") {
      ctx.store.save({ ...record, state: "published" }, record.revision);
    }
    return {
      commandId,
      docKey,
      state: "applied",
      pageId: intent?.pageId ?? PAGE_ID,
      version: intent?.targetVersion ?? 5,
      detail: "",
    };
  }

  override async close(ctx: DraftPublishContext, commandId: string): Promise<DraftPublishResult> {
    this.seen.push(ctx);
    const intent = ctx.store.intent(commandId);
    return {
      commandId,
      docKey: intent?.docKey ?? KEY,
      state: "closed-unconfirmed",
      pageId: intent?.pageId ?? PAGE_ID,
      version: intent?.targetVersion ?? 5,
      detail: "",
    };
  }

  override async rebase(ctx: DraftPublishContext, docKey: string): Promise<DraftRecord> {
    this.seen.push(ctx);
    const record = ctx.store.read(docKey);
    if (record === null) throw new Error("초안이 없습니다");
    return record;
  }

  override async resolve(
    ctx: DraftPublishContext,
    input: { docKey: string; blockId: string; choice: "mine" | "theirs" },
  ): Promise<DraftRecord> {
    this.seen.push(ctx);
    const record = ctx.store.read(input.docKey);
    if (record === null) throw new Error("초안이 없습니다");
    return record;
  }
}

const CMD_A = "1a2b3c4d-5e6f-4a1b-8c9d-00000000000a";
const CMD_B = "1a2b3c4d-5e6f-4a1b-8c9d-00000000000b";

/** 발행 의도의 씨앗 — 디스크에 남는 sending 의도를 합성 값으로 만든다(2026-10-23 작업 B7). */
const makeIntent = (overrides: Partial<PublishIntentRecord> = {}): PublishIntentRecord => ({
  format: 1,
  commandId: CMD_A,
  docKey: KEY,
  kind: "update",
  site: SITE,
  pageId: PAGE_ID,
  spaceId: "SP1",
  parentId: null,
  title: "로그인 화면",
  baseVersion: 4,
  targetVersion: 5,
  bodyFingerprint: "0123456789abcdef",
  stage: null,
  confirmedAt: NOW.toISOString(),
  state: "sending",
  result: null,
  ...overrides,
});

/**
 * 전송을 붙잡아 두는 발행기 가짜 — 진짜 발행기와 같은 모양으로 의도(sending)와 잠금
 * (publishing · pendingCommandId)를 남긴 뒤 놓아줄 때까지 기다린다(2026-10-23 작업 B7).
 */
class HoldingPublisher extends DraftPublisher {
  readonly #gate = Promise.withResolvers<void>();

  letGo(): void {
    this.#gate.resolve();
  }

  override async publish(
    ctx: DraftPublishContext,
    input: { docKey: string; commandId: string; expectedRevision: number },
  ): Promise<DraftPublishResult> {
    const record = ctx.store.read(input.docKey);
    if (record !== null) {
      ctx.store.saveIntent(makeIntent({ commandId: input.commandId }), STORAGE);
      ctx.store.save(
        { ...record, state: "publishing", pendingCommandId: input.commandId },
        input.expectedRevision,
      );
    }
    await this.#gate.promise;
    const locked = ctx.store.read(input.docKey);
    if (locked !== null) {
      ctx.store.save({ ...locked, state: "editing", pendingCommandId: null }, locked.revision);
    }
    return {
      commandId: input.commandId,
      docKey: input.docKey,
      state: "applied",
      pageId: PAGE_ID,
      version: 5,
      detail: "",
    };
  }
}

interface Rig<P extends DraftPublisher = FakePublisher> {
  service: DraftService;
  store: DraftStore;
  home: string;
  readRoot: string;
  requests: string[];
  messages: ServerMessage[];
  infos: Array<{ message: string; fields: unknown }>;
  publisher: P;
  cleanup(): void;
}

function rig<P extends DraftPublisher = FakePublisher>(
  runner: DraftAiRunner,
  publisher: P = new FakePublisher() as P,
  home: string = mkdtempSync(join(tmpdir(), "draft-service-")),
  options?: { cloneRoot?: (slug: string) => string | null },
): Rig<P> {
  // 기획서 사본 — 프로젝트 폴더 아래 confluence/ 다. 클론은 아예 없다(2026-10-23 · 기획서 사본 이동 계획 §1 D1).
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
      "55": {
        path: "COLO/macro",
        title: "매크로 문서",
        version: 2,
        sections: [],
        comments: null,
      },
      "77": {
        path: "COLO/template",
        title: "틀 문서",
        version: 1,
        sections: [],
        comments: null,
      },
      "66": {
        path: "COLO/token",
        title: "알림 문서",
        version: 7,
        sections: [],
        comments: null,
      },
    },
    folders: { "50": { path: "COLO/가지", title: "가지 폴더" } },
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
      "첫 절의 몸이다.",
      "",
      "## 다음 절",
      "",
      "다음 절의 몸이다.",
      "",
    ].join("\n"),
  );
  // 꾸밈이 든 머리말의 문서 — 굵게 · 링크 · 자리 표시 · 이스케이프가 절 이름에 섞여 있다.
  writeFileSync(
    join(readRoot, "COLO", "token.md"),
    [
      "---",
      "confluence:",
      '  pageId: "66"',
      '  space: "SP1"',
      '  title: "알림 문서"',
      "  version: 7",
      "---",
      "",
      "## **굵은** 로그인 [화면](https://colosseum.example/login) [Confluence 매크로: info] [첨부: flow.png]",
      "",
      "머리말 절의 몸이다.",
      "",
      "## 경로와 \\*이스케이프\\* 절",
      "",
      "이스케이프 절의 몸이다.",
      "",
      "## 다음 절",
      "",
      "다음 절의 몸이다.",
      "",
    ].join("\n"),
  );
  const served: Record<string, unknown> = {
    [readPageUrl(PAGE_ID)]: pageJson(PAGE_ID, "로그인 화면", STORAGE, 4),
    [readPageUrl(ROOT_ID)]: pageJson(ROOT_ID, "8.8 합성 뿌리", "<h1>머리말이다.</h1>", 3),
    [readPageUrl("77")]: pageJson("77", "틀 문서", TEMPLATE_STORAGE, 1),
    [readPageUrl("55")]: pageJson("55", "매크로 문서", MACRO_STORAGE, 2),
    [readPageUrl("66")]: pageJson("66", "알림 문서", TOKEN_STORAGE, 7),
    [WHOAMI_URL]: { accountId: "acct-1", displayName: "합성 사람" },
  };
  const requests: string[] = [];
  const transport: RestTransport = {
    async request(input) {
      requests.push(`${input.method} ${input.url}`);
      const json = served[input.url];
      if (json === undefined) return { status: 404, body: Buffer.from("{}", "utf8") };
      return { status: 200, body: Buffer.from(JSON.stringify(json), "utf8") };
    },
  };
  const setting: Record<string, string> = {
    "confluenceSite:demo": SITE,
    "confluenceRootId:demo": ROOT_ID,
  };
  const credentials = new MemoryCredentialStore();
  void credentials.save("confluence-pat", "me@example.com\ntok");
  const messages: ServerMessage[] = [];
  const infos: Array<{ message: string; fields: unknown }> = [];
  const logger: DaemonLogger = {
    info: (message, fields) => infos.push({ message, fields }),
    warn() {},
    error() {},
  };
  const service = new DraftService({
    registry: { activeSlug: () => "demo", paths: (slug) => ({ root: join(home, slug) }) },
    machineSetting: { get: (key) => setting[key] ?? null },
    credentials,
    claudeExecutable: () => "/usr/local/bin/claude",
    broadcast: (message) => messages.push(message),
    logger,
    ai: runner,
    publisher,
    now: () => NOW,
    transport: () => transport,
    ...(options?.cloneRoot !== undefined ? { cloneRoot: options.cloneRoot } : {}),
  });
  return {
    service,
    store: new DraftStore(join(home, "demo", "plans"), () => NOW),
    home,
    readRoot,
    requests,
    messages,
    infos,
    publisher,
    cleanup() {
      rmSync(home, { recursive: true, force: true });
    },
  };
}

const changedMessages = (
  messages: ServerMessage[],
): Array<Extract<ServerMessage, { type: "draft.changed" }>> =>
  messages.filter(
    (message): message is Extract<ServerMessage, { type: "draft.changed" }> =>
      message.type === "draft.changed",
  );

const aiMessages = (
  messages: ServerMessage[],
): Array<Extract<ServerMessage, { type: "draft.ai" }>> =>
  messages.filter(
    (message): message is Extract<ServerMessage, { type: "draft.ai" }> =>
      message.type === "draft.ai",
  );

test("열기 — 원격을 읽어 초안을 만들고 다시 열면 같은 초안이다", async () => {
  const { service, requests, messages, cleanup } = rig(
    fakeAi(async () => ({
      reply: "",
      summary: "",
      ops: [],
      sdkSessionId: null,
    })).runner,
  );
  try {
    const view = await service.open(PAGE_ID);
    assert.equal(view.docKey, KEY);
    assert.equal(view.kind, "existing");
    assert.equal(view.revision, 0);
    assert.equal(view.state, "editing");
    assert.equal(view.baseVersion, 4);
    assert.equal(view.baseTitle, "로그인 화면");
    assert.deepEqual(
      view.blocks.map((block) => [block.id, block.view.kind, block.status, block.editable]),
      [
        ["b0", "heading", "same", true],
        ["b1", "paragraph", "same", true],
        ["b2", "paragraph", "same", true],
      ],
    );
    assert.deepEqual(view.stage, { notation: null, closed: false });
    // 문서 읽기는 한 번이다 — 다시 열면 저장된 초안으로 돌아간다.
    assert.equal(requests.filter((url) => url.includes(readPageUrl(PAGE_ID))).length, 1);
    const again = await service.open(PAGE_ID);
    assert.deepEqual(
      again.blocks.map((block) => block.id),
      ["b0", "b1", "b2"],
    );
    assert.equal(requests.filter((url) => url.includes(readPageUrl(PAGE_ID))).length, 1);
    const broadcast = changedMessages(messages);
    assert.equal(broadcast.length, 1);
    assert.deepEqual(broadcast[0], {
      type: "draft.changed",
      docKey: KEY,
      revision: 0,
      state: "editing",
    });
  } finally {
    cleanup();
  }
});

test("열기 — 범위 밖 문서는 거절한다", async () => {
  const { service, cleanup } = rig(
    fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null })).runner,
  );
  try {
    await assert.rejects(service.open("999"), /기획서 목록에 없는 문서/);
  } finally {
    cleanup();
  }
});

test("만들기 — 빈 새 문서 · 틀 문서 · 범위 밖 부모", async () => {
  const { service, cleanup } = rig(
    fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null })).runner,
  );
  try {
    const empty = await service.create({ title: "새 기획", parentId: ROOT_ID, parentType: "page" });
    assert.equal(empty.kind, "new");
    assert.match(empty.docKey, /^n-[0-9a-f]{32}$/);
    assert.equal(empty.pageId, null);
    assert.equal(empty.baseVersion, null);
    assert.deepEqual(empty.blocks, []);
    assert.deepEqual(empty.parent, { id: ROOT_ID, type: "page", title: "8.8 합성 뿌리" });
    const template = await service.create({
      title: "틀로 만든 기획",
      parentId: "50",
      parentType: "folder",
      templatePageId: "77",
    });
    assert.deepEqual(template.parent, { id: "50", type: "folder", title: "가지 폴더" });
    assert.equal(template.blocks.length, 1);
    for (const block of template.blocks) {
      assert.match(block.id, /^n[0-9a-f]{12}$/);
      assert.equal(block.status, "new");
      assert.equal(block.view.kind, "paragraph");
    }
    const summaries = await service.list();
    assert.equal(summaries.length, 2);
    // 틀 문서의 블록은 모두 새 블록이라 요약에 섞인다. 같은 때에 만든 두 초안의 순서는 정해지지 않으니
    // 순서 없이 견준다(2026-10-23 오케스트레이터 — 시각이 같으면 파일 순서가 섞인다).
    assert.deepEqual(
      summaries.map((row) => row.changedBlocks).sort((a, b) => a - b),
      [0, 1],
    );
    await assert.rejects(
      service.create({ title: "범위 밖", parentId: "999", parentType: "page" }),
      /기획서 목록에 없는 자리/,
    );
  } finally {
    cleanup();
  }
});

test("고치기 — 걸음들과 전부 거절 · 개정 어긋남 · 보존 · 잠김", async () => {
  const { service, store, cleanup } = rig(
    fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null })).runner,
  );
  try {
    await service.open(PAGE_ID);
    // set — 한 블록만 바뀐다.
    const set = await service.edit(KEY, 0, [
      { type: "set", blockId: "b1", view: { kind: "paragraph", text: "고친 문단이다." } },
    ]);
    assert.equal(set.revision, 1);
    assert.equal(set.blocks[1]?.status, "changed");
    assert.equal(set.blocks[0]?.status, "same");
    // insert — 맨 앞의 새 블록(b1 은 앞서 바뀐 채로 남는다).
    const inserted = await service.edit(KEY, 1, [
      { type: "insert", afterBlockId: null, view: { kind: "paragraph", text: "새 문단이다." } },
    ]);
    assert.deepEqual(
      inserted.blocks.map((block) => [block.id.slice(0, 1), block.status]),
      [
        ["n", "new"],
        ["b", "same"],
        ["b", "changed"],
        ["b", "same"],
      ],
    );
    // delete — 고침 · 새 블록 · 지움이 요약에 함께 섞인다(1 + 1 + 1).
    await service.edit(KEY, 2, [{ type: "delete", blockId: "b2" }]);
    const summary = (await service.list()).find((row) => row.docKey === KEY);
    assert.equal(summary?.changedBlocks, 3);
    // move — 새 블록을 b1 뒤로.
    const moved = await service.edit(KEY, 3, [
      { type: "move", blockId: inserted.blocks[0]?.id ?? "", afterBlockId: "b1" },
    ]);
    assert.equal(moved.blocks[2]?.id, inserted.blocks[0]?.id);
    // revert — b1 은 기준 원문으로 돌아간다.
    const reverted = await service.edit(KEY, 4, [{ type: "revert", blockId: "b1" }]);
    assert.equal(reverted.blocks[1]?.status, "same");
    assert.equal(paragraphText(reverted.blocks[1]), "첫 문단이다.");
    // title — 단계 표기가 읽힌다.
    const titled = await service.edit(KEY, 5, [{ type: "title", title: "로그인 흐름 v0.9" }]);
    assert.equal(titled.title, "로그인 흐름 v0.9");
    assert.deepEqual(titled.stage, { notation: "0.9", closed: false });
    // 하나라도 맞지 않으면 전부 거절이다.
    const before = await service.get(KEY);
    await assert.rejects(
      service.edit(KEY, 6, [
        { type: "set", blockId: "b1", view: { kind: "paragraph", text: "묻힐 문단이다." } },
        { type: "set", blockId: "b999", view: { kind: "paragraph", text: "없는 블록이다." } },
      ]),
      /블록을 찾지 못했습니다/,
    );
    const after = await service.get(KEY);
    assert.equal(after.revision, before.revision);
    assert.equal(paragraphText(after.blocks[1]), "첫 문단이다.");
    // 개정이 다르면 draft.stale 코드로 거절이다.
    await assert.rejects(
      service.edit(KEY, 0, [{ type: "title", title: "어긋난 제목이다." }]),
      (error: unknown) => {
        if (!(error instanceof DraftStaleError)) return false;
        assert.equal(error.code, "draft.stale");
        return true;
      },
    );
    // 발행 중인 초안은 잠긴다.
    const record = store.read(KEY);
    assert.ok(record !== null);
    store.save({ ...record, state: "publishing" }, record.revision);
    await assert.rejects(
      service.edit(KEY, record.revision + 1, [{ type: "title", title: "잠긴 제목이다." }]),
      /발행이 도는 동안에는/,
    );
  } finally {
    cleanup();
  }
});

test("고치기 — 보존 블록의 set 은 거절이다", async () => {
  const { service, cleanup } = rig(
    fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null })).runner,
  );
  try {
    await service.open("55");
    const view = await service.get("p-55");
    const preserved = view.blocks.find((block) => !block.editable);
    assert.ok(preserved !== undefined);
    assert.equal(preserved.view.kind, "preserved");
    await assert.rejects(
      service.edit("p-55", 0, [
        { type: "set", blockId: preserved.id, view: { kind: "paragraph", text: "고쳐 보렴." } },
      ]),
      /보존 블록은 고칠 수 없습니다/,
    );
  } finally {
    cleanup();
  }
});

test("버리기 — 결과를 기다리는 초안은 거절이고 편집 중인 초안은 지운다", async () => {
  const { service, store, cleanup } = rig(
    fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null })).runner,
  );
  try {
    await service.open(PAGE_ID);
    // 발행 결과가 미확정인 초안 — 확인 전에는 버릴 수 없다(2026-10-23 · 검토 발견 4).
    const locked = store.read(KEY);
    assert.ok(locked !== null);
    store.save(
      {
        ...locked,
        state: "result-unknown",
        pendingCommandId: "0b1f8f2e-1111-4222-8333-444455556666",
      },
      locked.revision,
    );
    await assert.rejects(service.discard(KEY), /발행 결과를 확인하기 전에는/);
    assert.ok(store.read(KEY) !== null);
    // 종료로 잠금이 풀린 뒤에는 버릴 수 있다.
    const freed = store.read(KEY);
    assert.ok(freed !== null);
    store.save({ ...freed, state: "editing", pendingCommandId: null }, freed.revision);
    assert.deepEqual(await service.discard(KEY), { discarded: true });
    assert.equal(store.read(KEY), null);
  } finally {
    cleanup();
  }
});

test("묻기 — 클론 뿌리 의존이 디렉터리를 돌려주면 AI 요청에 extraRoots 로 실린다", async () => {
  const ai = fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null }));
  const home = mkdtempSync(join(tmpdir(), "draft-service-"));
  const rig1 = rig(ai.runner, new FakePublisher(), home, {
    cloneRoot: (slug) => join(home, slug, "repo"),
  });
  try {
    mkdirSync(join(rig1.home, "demo", "repo"), { recursive: true });
    await rig1.service.open(PAGE_ID);
    rig1.service.ask(KEY, "첫 문단을 다듬어 줘", []);
    await until(
      () => aiMessages(rig1.messages).some((message) => message.phase === "done"),
      "done 방송",
    );
    assert.deepEqual(ai.calls[0]?.extraRoots, [join(rig1.home, "demo", "repo")]);
  } finally {
    rig1.cleanup();
  }
});

test("묻기 — 클론 뿌리 의존이 없거나 null 을 돌려주면 AI 요청에 extraRoots 키가 없다", async () => {
  const absent = fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null }));
  const rigAbsent = rig(absent.runner);
  const nullish = fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null }));
  const rigNull = rig(nullish.runner, undefined, undefined, {
    cloneRoot: () => null,
  });
  try {
    await rigAbsent.service.open(PAGE_ID);
    rigAbsent.service.ask(KEY, "첫 문단을 다듬어 줘", []);
    await until(
      () => aiMessages(rigAbsent.messages).some((message) => message.phase === "done"),
      "done 방송",
    );
    assert.equal(absent.calls[0]?.extraRoots, undefined);
    assert.ok(!("extraRoots" in (absent.calls[0] ?? {})));

    await rigNull.service.open(PAGE_ID);
    rigNull.service.ask(KEY, "첫 문단을 다듬어 줘", []);
    await until(
      () => aiMessages(rigNull.messages).some((message) => message.phase === "done"),
      "done 방송",
    );
    assert.ok(!("extraRoots" in (nullish.calls[0] ?? {})));
  } finally {
    rigAbsent.cleanup();
    rigNull.cleanup();
  }
});

test("묻기 — 고른 모델 · 생각 시간이 AI 요청에 실리고 안 골랐으면 키가 없다(2026-10-26)", async () => {
  const picked = fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null }));
  const rigPicked = rig(picked.runner);
  try {
    await rigPicked.service.open(PAGE_ID);
    rigPicked.service.ask(KEY, "다듬어 줘", [], { model: "claude-opus-5", effort: "high" });
    await until(
      () => aiMessages(rigPicked.messages).some((message) => message.phase === "done"),
      "done 방송",
    );
    assert.equal(picked.calls[0]?.model, "claude-opus-5");
    assert.equal(picked.calls[0]?.effort, "high");
  } finally {
    rigPicked.cleanup();
  }

  const bare = fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null }));
  const rigBare = rig(bare.runner);
  try {
    await rigBare.service.open(PAGE_ID);
    rigBare.service.ask(KEY, "다듬어 줘", []);
    await until(
      () => aiMessages(rigBare.messages).some((message) => message.phase === "done"),
      "done 방송",
    );
    assert.ok(!("model" in (bare.calls[0] ?? {})));
    assert.ok(!("effort" in (bare.calls[0] ?? {})));
  } finally {
    rigBare.cleanup();
  }
});

test("묻기 — 실행기가 실제 경로 표기로 읽음을 알려도 읽은 근거가 남는다(2026-10-23 · 검토 R1)", async () => {
  const ai = fakeAi(async (request, callbacks) => {
    // 사본 뿌리가 심볼릭 링크 뒤에 있으면 실행기는 실제 경로(realpath) 표기로 알린다.
    callbacks.onRead(realpathSync(join(request.readRoot, "COLO", "login.md")));
    return { reply: "다듬었다.", summary: "다듬기", ops: [], sdkSessionId: null };
  });
  const holder = mkdtempSync(join(tmpdir(), "draft-service-real-"));
  mkdirSync(join(holder, "real"));
  symlinkSync(join(holder, "real"), join(holder, "link"), "dir");
  const rig1 = rig(ai.runner, new FakePublisher(), join(holder, "link"));
  try {
    await rig1.service.open(PAGE_ID);
    rig1.service.ask(KEY, "첫 문단을 다듬어 줘", []);
    await until(
      () => aiMessages(rig1.messages).some((message) => message.phase === "done"),
      "done 방송",
    );
    const readBroadcast = aiMessages(rig1.messages).find((message) => message.phase === "read");
    assert.deepEqual(readBroadcast?.read, { pageId: PAGE_ID, title: "로그인 화면", version: 4 });
    const thread = rig1.service.thread(KEY);
    assert.deepEqual(thread.messages[1]?.reads, [
      { pageId: PAGE_ID, title: "로그인 화면", version: 4 },
    ]);
  } finally {
    rig1.cleanup();
    rmSync(holder, { recursive: true, force: true });
  }
});

test("묻기 — 사람 메시지 · AI 답 · 변경안 · 방송 순서 · 절 잘라 내기", async () => {
  const ai = fakeAi(async (request, callbacks) => {
    assert.equal(request.resume, null);
    callbacks.onText("다듬는다");
    callbacks.onText("다듬는다 보강했다");
    callbacks.onRead(join(request.readRoot, "COLO", "login.md"));
    // prompt 는 절만 실어 온다 — 잘라 낸 절의 몸만 보인다.
    assert.match(request.prompt, /첫 절의 몸이다\./);
    assert.doesNotMatch(request.prompt, /다음 절의 몸이다\./);
    return {
      reply: "첫 문단을 다듬었다.",
      summary: "첫 문단 다듬기",
      ops: [
        {
          opId: "op-1",
          type: "replace",
          blockId: "b1",
          view: { kind: "paragraph", text: "AI가 고친 문단이다." },
        },
      ],
      sdkSessionId: "sess-1",
    };
  });
  const rig1 = rig(ai.runner);
  try {
    await rig1.service.open(PAGE_ID);
    const refs: DraftRefInput[] = [{ pageId: PAGE_ID, sections: ["로그인 흐름"] }];
    const reply = rig1.service.ask(KEY, "첫 문단을 다듬어 줘", refs);
    assert.equal(typeof reply.threadId, "string");
    await until(
      () => aiMessages(rig1.messages).some((message) => message.phase === "done"),
      "done 방송",
    );
    assert.deepEqual(
      aiMessages(rig1.messages).map((message) => message.phase),
      ["started", "text", "text", "read", "done"],
    );
    // 읽기 뿌리는 프로젝트 폴더의 기획서 사본이다 — AI 의 읽기는 그 안에 갇힌다.
    assert.equal(ai.calls[0]?.readRoot, join(rig1.home, "demo", "confluence"));
    const readBroadcast = aiMessages(rig1.messages).find((message) => message.phase === "read");
    assert.deepEqual(readBroadcast?.read, { pageId: PAGE_ID, title: "로그인 화면", version: 4 });
    const doneBroadcast = aiMessages(rig1.messages).find((message) => message.phase === "done");
    assert.equal(typeof doneBroadcast?.proposalId, "string");
    const thread = rig1.service.thread(KEY);
    assert.equal(thread.running, false);
    assert.equal(thread.messages.length, 2);
    assert.equal(thread.messages[0]?.role, "user");
    assert.deepEqual(thread.messages[0]?.refs, [
      { pageId: PAGE_ID, title: "로그인 화면", version: 4, sections: ["로그인 흐름"] },
    ]);
    const assistant = thread.messages[1];
    assert.equal(assistant?.role, "assistant");
    assert.equal(assistant?.proposalId, doneBroadcast?.proposalId);
    assert.deepEqual(assistant?.reads, [{ pageId: PAGE_ID, title: "로그인 화면", version: 4 }]);
    assert.deepEqual(
      thread.proposals[0]?.ops.map((op) => [op.type, op.state]),
      [["replace", "open"]],
    );
    // 채택 — 블록이 바뀌고 개정이 오른다.
    const adopted = await rig1.service.adopt(
      KEY,
      thread.proposals[0]?.proposalId ?? "",
      ["op-1"],
      0,
    );
    assert.equal(adopted.revision, 1);
    assert.equal(adopted.blocks[1]?.status, "changed");
    assert.equal(paragraphText(adopted.blocks[1]), "AI가 고친 문단이다.");
    const after = rig1.service.thread(KEY);
    assert.equal(after.proposals[0]?.ops[0]?.state, "adopted");
  } finally {
    rig1.cleanup();
  }
});

test("사본만 있으면 클론 없이도 문서를 열고 근거 스냅샷을 만든다(2026-10-23 · 기획서 사본 이동)", async () => {
  const ai = fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null }));
  const rig1 = rig(ai.runner);
  try {
    const opened = await rig1.service.open(PAGE_ID);
    assert.equal(opened.title, "로그인 화면");
    const snapshot = rig1.service.snapshot({ pageId: PAGE_ID, sections: ["로그인 흐름"] });
    assert.equal(snapshot.ref.pageId, PAGE_ID);
    const text = Buffer.from(snapshot.attachment.data, "base64").toString("utf8");
    assert.match(text, /첫 절의 몸이다\./);
    assert.doesNotMatch(text, /다음 절의 몸이다\./);
    // 프로젝트 폴더에는 사본과 기획 데이터만 산다 — 클론 폴더는 아예 없다.
    assert.deepEqual(readdirSync(join(rig1.home, "demo")).sort(), ["confluence", "plans"]);
  } finally {
    rig1.cleanup();
  }
});

test("기획 AI 의 읽기 뿌리 — 사본이 있으면 사본 뿌리, 없으면 임시 폴더다(2026-10-23 · 기획서 사본 이동)", async () => {
  const withMirror = fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null }));
  const rig1 = rig(withMirror.runner);
  try {
    await rig1.service.open(PAGE_ID);
    rig1.service.ask(KEY, "뭘 볼 수 있지", []);
    await until(
      () => aiMessages(rig1.messages).some((message) => message.phase === "done"),
      "사본 자리 done 방송",
    );
    assert.equal(withMirror.calls[0]?.readRoot, join(rig1.home, "demo", "confluence"));
  } finally {
    rig1.cleanup();
  }
  // 사본이 없는 자리 — 첫 가져오기 전이다. 읽기 뿌리는 임시 폴더고 생성이 끝나면 거둔다.
  const bare = fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null }));
  const rig2 = rig(bare.runner);
  try {
    rmSync(join(rig2.home, "demo", "confluence"), { recursive: true, force: true });
    const created = await rig2.service.create({
      title: "새 문서",
      parentId: ROOT_ID,
      parentType: "page",
    });
    rig2.service.ask(created.docKey, "뭘 볼 수 있지", []);
    await until(
      () => aiMessages(rig2.messages).some((message) => message.phase === "done"),
      "임시 자리 done 방송",
    );
    const readRoot = bare.calls[0]?.readRoot ?? "";
    assert.notEqual(readRoot, join(rig2.home, "demo", "confluence"));
    assert.match(readRoot, /draft-ai-/);
    assert.equal(existsSync(readRoot), false);
  } finally {
    rig2.cleanup();
  }
});

test("묻기 — 근거 문서의 파생 마크다운이 없으면 거절이고 AI 를 부르지 않는다", async () => {
  const ai = fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null }));
  const rig1 = rig(ai.runner);
  try {
    await rig1.service.open(PAGE_ID);
    // 원장은 55 번 문서를 알지만 사본에 파생 마크다운이 없다 — 사본을 다시 받기 전의 꼴이다.
    // 문서 전체를 근거로 골랐을 때.
    await assert.rejects(
      Promise.resolve().then(() =>
        rig1.service.ask(KEY, "매크로 문서를 다듬어 줘", [{ pageId: "55" }]),
      ),
      /기획서 본문을 읽지 못했어요/,
    );
    // 절을 골랐을 때도 같은 급의 거절이다.
    await assert.rejects(
      Promise.resolve().then(() =>
        rig1.service.ask(KEY, "매크로 문서의 절을 다듬어 줘", [
          { pageId: "55", sections: ["주의"] },
        ]),
      ),
      /기획서 본문을 읽지 못했어요/,
    );
    // AI 는 한 번도 불리지 않았고 사람의 말도 대화에 남지 않는다.
    assert.equal(ai.calls.length, 0);
    assert.deepEqual(rig1.service.thread(KEY).messages, []);
    assert.deepEqual(aiMessages(rig1.messages), []);
  } finally {
    rig1.cleanup();
  }
});

test("묻기 — 맞지 않는 걸음은 버려지고 수만 로그에 남는다", async () => {
  const ai = fakeAi(async (_request, _callbacks) => ({
    reply: "몇 개는 버렸다.",
    summary: "반쪽 변경안",
    ops: [
      {
        opId: "op-bad-block",
        type: "replace",
        blockId: "b999",
        view: { kind: "paragraph", text: "없다." },
      },
      {
        opId: "op-bad-after",
        type: "insert",
        afterBlockId: "b999",
        view: { kind: "paragraph", text: "앞이 없다." },
      },
      { opId: "op-bad-kind", type: "mangle" },
      {
        opId: "op-good-insert",
        type: "insert",
        afterBlockId: null,
        view: { kind: "paragraph", text: "새 문단이다." },
      },
    ],
    sdkSessionId: "sess-2",
  }));
  const rig1 = rig(ai.runner);
  try {
    await rig1.service.open(PAGE_ID);
    rig1.service.ask(KEY, "문단을 더해 줘", []);
    await until(
      () => aiMessages(rig1.messages).some((message) => message.phase === "done"),
      "done 방송",
    );
    const thread = rig1.service.thread(KEY);
    assert.deepEqual(
      thread.proposals[0]?.ops.map((op) => op.type),
      ["insert"],
    );
    assert.deepEqual(rig1.infos, [{ message: "기획 AI 변경안 거절", fields: { count: 3 } }]);
  } finally {
    rig1.cleanup();
  }
});

test("묻기 — 실패는 error 문장과 failed 방송으로 끝난다", async () => {
  const rig1 = rig(
    fakeAi(async () => {
      throw new Error("기획 AI 가 답을 읽지 못했습니다.");
    }).runner,
  );
  try {
    await rig1.service.open(PAGE_ID);
    rig1.service.ask(KEY, "뭘 해 볼까", []);
    await until(
      () => aiMessages(rig1.messages).some((message) => message.phase === "failed"),
      "failed 방송",
    );
    const thread = rig1.service.thread(KEY);
    assert.equal(thread.messages[1]?.error, "기획 AI 가 답을 읽지 못했습니다.");
    assert.equal(thread.proposals.length, 0);
  } finally {
    rig1.cleanup();
  }
});

test("묻기 — cancel 은 cancelled 방송으로 끝내고 변경안이 생기지 않는다", async () => {
  const rig1 = rig((request) => {
    const { promise, reject } = Promise.withResolvers<DraftAiAnswer>();
    request.signal.addEventListener("abort", () => reject(new Error("중단됨")), { once: true });
    return promise;
  });
  try {
    await rig1.service.open(PAGE_ID);
    rig1.service.ask(KEY, "오래 걸리는 질문이다", []);
    assert.equal(rig1.service.thread(KEY).running, true);
    // 도는 중의 두 번째 물기는 거절이다.
    await assert.rejects(
      Promise.resolve().then(() => rig1.service.ask(KEY, "또 물어 본다", [])),
      /이미 도는 질문/,
    );
    const cancelled = rig1.service.cancel(KEY);
    assert.deepEqual(cancelled, { cancelled: true });
    await until(
      () => aiMessages(rig1.messages).some((message) => message.phase === "cancelled"),
      "cancelled 방송",
    );
    assert.equal(rig1.service.thread(KEY).proposals.length, 0);
    assert.equal(rig1.service.thread(KEY).running, false);
    assert.deepEqual(rig1.service.cancel(KEY), { cancelled: false });
  } finally {
    rig1.cleanup();
  }
});

test("대화 보기 — 사람이 고친 블록의 걸음은 stale 다", async () => {
  const ai = fakeAi(async () => ({
    reply: "고쳐 보았다.",
    summary: "첫 문단 다듬기",
    ops: [
      {
        opId: "op-1",
        type: "replace",
        blockId: "b1",
        view: { kind: "paragraph", text: "AI 문단이다." },
      },
    ],
    sdkSessionId: "sess-3",
  }));
  const rig1 = rig(ai.runner);
  try {
    await rig1.service.open(PAGE_ID);
    rig1.service.ask(KEY, "다듬어 줘", []);
    await until(
      () => aiMessages(rig1.messages).some((message) => message.phase === "done"),
      "done 방송",
    );
    // 사람이 같은 블록을 고친다 — 걸음은 stale 다.
    await rig1.service.edit(KEY, 0, [
      { type: "set", blockId: "b1", view: { kind: "paragraph", text: "사람이 고친 문단이다." } },
    ]);
    const thread = rig1.service.thread(KEY);
    assert.equal(thread.proposals[0]?.ops[0]?.state, "stale");
    // stale 걸음의 채택은 적용되지 않고 stale 로 표시된다 — 개정도 오르지 않는다.
    const view = await rig1.service.adopt(KEY, thread.proposals[0]?.proposalId ?? "", ["op-1"], 1);
    assert.equal(view.revision, 1);
    assert.equal(paragraphText(view.blocks[1]), "사람이 고친 문단이다.");
    assert.equal(rig1.service.thread(KEY).proposals[0]?.ops[0]?.state, "stale");
  } finally {
    rig1.cleanup();
  }
});

test("채택 — 일부만 채택하고 남은 걸음은 열린 채로 둔다", async () => {
  const ai = fakeAi(async () => ({
    reply: "세 걸음이다.",
    summary: "제목과 문단",
    ops: [
      { opId: "op-title", type: "title", title: "AI가 지은 제목이다." },
      {
        opId: "op-insert",
        type: "insert",
        afterBlockId: "b2",
        view: { kind: "paragraph", text: "덧붙는 문단이다." },
      },
    ],
    sdkSessionId: "sess-4",
  }));
  const rig1 = rig(ai.runner);
  try {
    await rig1.service.open(PAGE_ID);
    rig1.service.ask(KEY, "제목을 지어 줘", []);
    await until(
      () => aiMessages(rig1.messages).some((message) => message.phase === "done"),
      "done 방송",
    );
    const thread = rig1.service.thread(KEY);
    const proposalId = thread.proposals[0]?.proposalId ?? "";
    // 첫 채택 — 제목만. 남은 걸음은 열려 있고, 반복 채택은 두 번 적용하지 않는다.
    const first = await rig1.service.adopt(KEY, proposalId, ["op-title"], 0);
    assert.equal(first.revision, 1);
    assert.equal(first.title, "AI가 지은 제목이다.");
    assert.equal(rig1.service.thread(KEY).proposals[0]?.ops[0]?.state, "adopted");
    assert.equal(rig1.service.thread(KEY).proposals[0]?.ops[1]?.state, "open");
    const repeated = await rig1.service.adopt(KEY, proposalId, ["op-title"], 1);
    assert.equal(repeated.revision, 1);
    // 나머지 채택 — 문단이 붙는다.
    const second = await rig1.service.adopt(KEY, proposalId, ["op-insert"], 1);
    assert.equal(second.revision, 2);
    assert.equal(second.blocks[3]?.status, "new");
    // 거절 — 열린 걸음은 이미 없고, 상태는 그대로다.
    const threadView = await rig1.service.reject(KEY, proposalId);
    assert.deepEqual(
      threadView.proposals[0]?.ops.map((op) => op.state),
      ["adopted", "adopted"],
    );
  } finally {
    rig1.cleanup();
  }
});

test("거절 — 열린 걸음을 rejected 로 두고 초안은 그대로다", async () => {
  const ai = fakeAi(async () => ({
    reply: "지운다.",
    summary: "둘째 문단 지우기",
    ops: [{ opId: "op-del", type: "delete", blockId: "b2" }],
    sdkSessionId: "sess-5",
  }));
  const rig1 = rig(ai.runner);
  try {
    await rig1.service.open(PAGE_ID);
    rig1.service.ask(KEY, "둘째 문단을 지워 줘", []);
    await until(
      () => aiMessages(rig1.messages).some((message) => message.phase === "done"),
      "done 방송",
    );
    const view = await rig1.service.get(KEY);
    const threadView = await rig1.service.reject(
      KEY,
      rig1.service.thread(KEY).proposals[0]?.proposalId ?? "",
    );
    assert.deepEqual(
      threadView.proposals[0]?.ops.map((op) => op.state),
      ["rejected"],
    );
    const after = await rig1.service.get(KEY);
    assert.equal(after.revision, view.revision);
    assert.deepEqual(
      after.blocks.map((block) => block.id),
      ["b0", "b1", "b2"],
    );
  } finally {
    rig1.cleanup();
  }
});

test("발행 묶음 — 자리를 만들어 발행기로 넘기고 바뀜만 방송한다", async () => {
  const rig1 = rig(
    fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null })).runner,
  );
  const previous = process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH;
  process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH = "1";
  const commandId = "0f0e0d0c-0b0a-4009-8008-000102030405";
  const closingId = "00000000-0000-4000-8000-000000000009";
  try {
    await rig1.service.open(PAGE_ID);
    const preview = await rig1.service.publishPreview(KEY);
    assert.equal(preview.docKey, KEY);
    // 자리 — 스위치 · 뿌리 · 클라이언트 · 계정이 실린다.
    const ctx = rig1.publisher.seen.at(-1);
    assert.equal(ctx?.enabled, true);
    assert.equal(ctx?.rootId, ROOT_ID);
    assert.equal(ctx?.client === null, false);
    assert.equal(ctx?.accountId, "acct-1");
    // 발행 — 상태가 바뀌어 방송이 나간다.
    const result = await rig1.service.publish({ docKey: KEY, commandId, expectedRevision: 0 });
    assert.equal(result.state, "applied");
    const broadcast = changedMessages(rig1.messages).at(-1);
    assert.deepEqual(broadcast, {
      type: "draft.changed",
      docKey: KEY,
      revision: 1,
      state: "publishing",
    });
    // 다시 보기 — 명령의 의도가 있고 초안이 바뀌면 방송이 나간다.
    rig1.store.saveIntent({
      format: 1,
      commandId,
      docKey: KEY,
      kind: "update",
      site: SITE,
      pageId: PAGE_ID,
      spaceId: "SP1",
      parentId: null,
      title: "로그인 화면",
      baseVersion: 4,
      targetVersion: 5,
      bodyFingerprint: "0123456789abcdef",
      stage: null,
      confirmedAt: NOW.toISOString(),
      state: "sending",
      result: null,
    });
    await rig1.service.publishRecheck(commandId);
    const applied = changedMessages(rig1.messages).at(-1);
    assert.deepEqual(applied, {
      type: "draft.changed",
      docKey: KEY,
      revision: 2,
      state: "published",
    });
    // 종료 — 바뀜이 없으면 방송이 나가지 않는다.
    rig1.store.saveIntent({
      format: 1,
      commandId: closingId,
      docKey: KEY,
      kind: "update",
      site: SITE,
      pageId: PAGE_ID,
      spaceId: "SP1",
      parentId: null,
      title: "로그인 화면",
      baseVersion: 4,
      targetVersion: 5,
      bodyFingerprint: "0123456789abcdef",
      stage: null,
      confirmedAt: NOW.toISOString(),
      state: "applied",
      result: null,
    });
    const before = changedMessages(rig1.messages).length;
    const closed = await rig1.service.publishClose(closingId);
    assert.equal(closed.state, "closed-unconfirmed");
    assert.equal(changedMessages(rig1.messages).length, before);
  } finally {
    if (previous === undefined) delete process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH;
    else process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH = previous;
    rig1.cleanup();
  }
});

test("발행 묶음 — 스위치가 꺼진 자리와 끊긴 재정렬도 발행기로 간다", async () => {
  const rig1 = rig(
    fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null })).runner,
  );
  try {
    await rig1.service.open(PAGE_ID);
    await rig1.service.publishPreview(KEY);
    const ctx = rig1.publisher.seen.at(-1);
    assert.equal(ctx?.enabled, false);
    const rebased = await rig1.service.rebase(KEY);
    assert.equal(rebased.docKey, KEY);
    const resolved = await rig1.service.resolve(KEY, "b1", "mine");
    assert.equal(resolved.docKey, KEY);
  } finally {
    rig1.cleanup();
  }
});

test("근거 스냅샷 — 가져온 문서는 판 · 주소 · 절 자르기를 싣는다", () => {
  const rig1 = rig(
    fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null })).runner,
  );
  try {
    const whole = rig1.service.snapshot({ pageId: PAGE_ID });
    assert.equal(whole.attachment.mediaType, "text/markdown");
    assert.equal(whole.attachment.name, "기획서 · 로그인 화면 · 판 4.md");
    const text = Buffer.from(whole.attachment.data, "base64").toString("utf8");
    assert.deepEqual(readPlanRef(text), {
      title: "로그인 화면",
      pageId: PAGE_ID,
      docKey: null,
      url: `https://${SITE}/wiki/pages/viewpage.action?pageId=${PAGE_ID}`,
      version: 4,
      revision: null,
      published: true,
      sections: [],
    });
    assert.ok(text.includes("# 로그인 화면"));
    assert.ok(text.includes("판 4 기준"));
    assert.ok(text.includes("첫 절의 몸이다."));
    assert.ok(text.includes("다음 절의 몸이다."));
    // 절 고름 — 그 절만 싣고 근거 기록에는 절이 남는다.
    const sliced = rig1.service.snapshot({ pageId: PAGE_ID, sections: ["로그인 흐름"] });
    const slicedText = Buffer.from(sliced.attachment.data, "base64").toString("utf8");
    assert.ok(slicedText.includes("첫 절의 몸이다."));
    assert.ok(!slicedText.includes("다음 절의 몸이다."));
    assert.deepEqual(sliced.ref.sections, ["로그인 흐름"]);
  } finally {
    rig1.cleanup();
  }
});

test("근거 스냅샷 — 범위 밖 문서와 본문이 없는 문서는 거절이다", () => {
  const rig1 = rig(
    fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null })).runner,
  );
  try {
    assert.throws(() => rig1.service.snapshot({ pageId: "999" }), /기획서 목록에 없습니다/);
    // 원장에는 있지만 파생 마크다운이 없는 문서(매크로 문서)다.
    assert.throws(() => rig1.service.snapshot({ pageId: "55" }), /본문을 읽지 못했습니다/);
  } finally {
    rig1.cleanup();
  }
});

test("근거 스냅샷 — 초안은 미발행 · 개정 · 기준 판을 싣는다", async () => {
  const rig1 = rig(
    fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null })).runner,
  );
  try {
    await rig1.service.open(PAGE_ID);
    await rig1.service.edit(KEY, 0, [{ type: "title", title: "로그인 화면 v0.9" }]);
    const snap = rig1.service.snapshot({ docKey: KEY });
    assert.equal(snap.attachment.name, "기획서 · 로그인 화면 v0.9 · 초안 개정 1.md");
    const text = Buffer.from(snap.attachment.data, "base64").toString("utf8");
    assert.deepEqual(readPlanRef(text), {
      title: "로그인 화면 v0.9",
      pageId: PAGE_ID,
      docKey: KEY,
      url: `https://${SITE}/wiki/pages/viewpage.action?pageId=${PAGE_ID}`,
      version: 4,
      revision: 1,
      published: false,
      sections: [],
    });
    assert.ok(text.includes("아직 발행하지 않은 초안 · 개정 1"));
    // 본문은 초안의 것 — 기준 원문의 문단이 파생 마크다운으로 온다.
    assert.ok(text.includes("첫 문단이다."));
    // 문서와 초안을 함께 · 아무도 싣지 않은 요청은 거절이다.
    assert.throws(() => rig1.service.snapshot({ pageId: PAGE_ID, docKey: KEY }), /하나만 골라/);
    assert.throws(() => rig1.service.snapshot({}), /하나만 골라/);
    assert.throws(() => rig1.service.snapshot({ docKey: "p-404" }), /열려 있는 초안이 없습니다/);
  } finally {
    rig1.cleanup();
  }
});

test("근거 스냅샷 — 꾸밈이 든 머리말의 절을 이름으로 고른다", () => {
  const rig1 = rig(
    fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null })).runner,
  );
  try {
    // 굵게 · 링크 · 자리 표시가 든 머리말 — 글만 실은 요청 이름과 같은 절이다(웹 검토 R2 의 1).
    const sliced = rig1.service.snapshot({ pageId: "66", sections: ["굵은 로그인 화면"] });
    const text = Buffer.from(sliced.attachment.data, "base64").toString("utf8");
    assert.ok(text.includes("머리말 절의 몸이다."));
    assert.ok(!text.includes("이스케이프 절의 몸이다."));
    assert.ok(!text.includes("다음 절의 몸이다."));
    assert.deepEqual(sliced.ref.sections, ["굵은 로그인 화면"]);
    // 이스케이프가 든 머리말도 한 정규화로 견준다 — 표지를 벗긴 이름이면 충분하다.
    const escaped = rig1.service.snapshot({ pageId: "66", sections: ["경로와 *이스케이프* 절"] });
    const escapedText = Buffer.from(escaped.attachment.data, "base64").toString("utf8");
    assert.ok(escapedText.includes("이스케이프 절의 몸이다."));
    assert.ok(!escapedText.includes("머리말 절의 몸이다."));
  } finally {
    rig1.cleanup();
  }
});

test("근거 스냅샷 — 토큰이 든 초안 머리말도 이름으로 고른다", async () => {
  const rig1 = rig(
    fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null })).runner,
  );
  try {
    await rig1.service.open("66");
    // 제목 안의 매크로는 투영에서 토큰 ⟦t1⟧ 이 된다 — 웹은 토큰을 벗긴 이름을 보내고,
    // 파생 마크다운 머리말은 자리 표시를 실린 채다. 둘 다 한 정규화로 같은 절이다.
    for (const sections of [["알림 절"], ["알림 절 ⟦t1⟧"]]) {
      const snap = rig1.service.snapshot({ docKey: "p-66", sections });
      const text = Buffer.from(snap.attachment.data, "base64").toString("utf8");
      assert.ok(text.includes("알림 절의 몸이다."));
      assert.ok(!text.includes("다른 절의 몸이다."));
      assert.deepEqual(snap.ref.sections, sections);
    }
  } finally {
    rig1.cleanup();
  }
});

test("근거 스냅샷 — 못 찾은 절은 문서 전체 대신 거절이다", () => {
  const rig1 = rig(
    fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null })).runner,
  );
  try {
    // 없는 절 하나면 첨부를 만들지 않고 오류로 거절한다(2026-10-23 · 웹 검토 R2 의 1).
    assert.throws(
      () => rig1.service.snapshot({ pageId: "66", sections: ["없는 절"] }),
      /고른 절을 문서에서 찾지 못했어요/,
    );
    // 하나라도 못 찾으면 거절 — 찾은 절만 싣는 일이 없다.
    assert.throws(
      () => rig1.service.snapshot({ pageId: "66", sections: ["굵은 로그인 화면", "없는 절"] }),
      /고른 절을 문서에서 찾지 못했어요/,
    );
    // 절을 고르지 않으면 지금처럼 문서 전체다.
    const whole = rig1.service.snapshot({ pageId: "66" });
    const text = Buffer.from(whole.attachment.data, "base64").toString("utf8");
    assert.ok(text.includes("머리말 절의 몸이다."));
    assert.ok(text.includes("다음 절의 몸이다."));
  } finally {
    rig1.cleanup();
  }
});

test("재시작 뒤 물려받은 발행은 읽는 길에서 result-unknown 으로 풀리고 다시 보내지 않는다", async () => {
  // 시드 — 첫 삶의 데몬이 발행 답을 받기 전에 멈춘 모양을 디스크에 남긴다.
  const first = rig(
    fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null })).runner,
  );
  // 재시작 — 같은 폴더의 새 서비스에 진짜 발행기를 심는다(2026-10-23 작업 B7).
  const reborn = rig(
    fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null })).runner,
    new DraftPublisher(),
    first.home,
  );
  const puts = () => reborn.requests.filter((row) => row.startsWith("PUT")).length;
  try {
    await first.service.open(PAGE_ID);
    const stuck = first.store.read(KEY);
    assert.ok(stuck);
    first.store.saveIntent(makeIntent(), composeDraftBody(stuck));
    first.store.save({ ...stuck, state: "publishing", pendingCommandId: CMD_A }, stuck.revision);

    // 목록 — 잠긴 초안을 result-unknown 으로 옮겨 저장하고 의도도 unknown 이 된다.
    const summaries = await reborn.service.list();
    assert.equal(summaries.find((row) => row.docKey === KEY)?.state, "result-unknown");
    assert.equal(first.store.intent(CMD_A)?.state, "unknown");
    const moved = first.store.read(KEY);
    assert.equal(moved?.state, "result-unknown");
    assert.equal(moved?.pendingCommandId, CMD_A);
    assert.deepEqual(reborn.infos.at(-1), { message: "멈춘 발행 초안 회복", fields: { count: 1 } });
    assert.deepEqual(changedMessages(reborn.messages).at(-1), {
      type: "draft.changed",
      docKey: KEY,
      // 시드의 잠금 저장(1) 뒤 회복의 저장이므로 2다.
      revision: 2,
      state: "result-unknown",
    });
    assert.equal(puts(), 0); // 회복은 다시 보내지 않는다

    // 결과 다시 확인 — 원격이 아직 기준 판이라 적용되지 않음으로 정해지고 잠금이 풀린다.
    const rechecked = await reborn.service.publishRecheck(CMD_A);
    assert.equal(rechecked.state, "not-applied");
    const freed = await reborn.service.get(KEY);
    assert.equal(freed.state, "editing");
    assert.equal(freed.pendingCommandId, null);
    assert.equal(first.store.intent(CMD_A)?.state, "not-applied");
    assert.equal(puts(), 0);

    // 재전송 없이 종료 — 다시 멈춘 초안을 get 이 풀고 close 로 닫는다.
    const again = first.store.read(KEY);
    assert.ok(again);
    first.store.saveIntent(makeIntent({ commandId: CMD_B }), composeDraftBody(again));
    first.store.save({ ...again, state: "publishing", pendingCommandId: CMD_B }, again.revision);
    const view = await reborn.service.get(KEY);
    assert.equal(view.state, "result-unknown");
    const closed = await reborn.service.publishClose(CMD_B);
    assert.equal(closed.state, "closed-unconfirmed");
    const done = await reborn.service.get(KEY);
    assert.equal(done.state, "editing");
    assert.equal(done.pendingCommandId, null);
    assert.equal(first.store.intent(CMD_B)?.state, "closed-unconfirmed");
    assert.equal(puts(), 0);
  } finally {
    first.cleanup();
    reborn.cleanup();
  }
});

test("도는 발행 중의 읽기는 publishing 초안을 그대로 돌려준다", async () => {
  const publisher = new HoldingPublisher();
  const rig1 = rig(
    fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null })).runner,
    publisher,
  );
  try {
    await rig1.service.open(PAGE_ID);
    const rev = (await rig1.service.get(KEY)).revision;
    const sending = rig1.service.publish({ docKey: KEY, commandId: CMD_A, expectedRevision: rev });
    await until(() => rig1.store.read(KEY)?.state === "publishing", "발행이 초안을 잠갔다");
    // 이 프로세스의 도는 발행 — 읽어도 잠금과 의도가 그대로다.
    const mid = await rig1.service.get(KEY);
    assert.equal(mid.state, "publishing");
    assert.equal(mid.pendingCommandId, CMD_A);
    assert.equal(rig1.store.intent(CMD_A)?.state, "sending");
    publisher.letGo();
    assert.equal((await sending).state, "applied");
    const after = await rig1.service.get(KEY);
    assert.equal(after.state, "editing");
    assert.equal(after.pendingCommandId, null);
  } finally {
    rig1.cleanup();
  }
});

// ————— 발행 뒤 재구성의 회귀(2026-10-23 · 작업 B9) — 진짜 발행기와 흐르는 원격 거울 —————

const REBUILD_TITLE = "합성 재구성 v0.8";
const REBUILD_STORAGE = [
  "<h2>합성 재구성의 머리말</h2>",
  "<p>첫 문단이다.</p>",
  "<p>둘째 문단이다.</p>",
  "<ul><li>목록 첫 항이다.</li><li>목록 둘째 항이다.</li></ul>",
  "<p>마지막 문단이다.</p>",
].join("\n");

/** 발행 뒤의 자리 번호(b0…)와 블록 바이트 — 넣고 · 빼고 · 옮긴 발행의 기대치다. */
const REBUILD_PUBLISHED = [
  "<p>맨 앞의 새 문단이다.</p>",
  "<h2>합성 재구성의 머리말</h2>",
  "\n<p>첫 문단이다.</p>",
  "\n<ul><li>목록 첫 항이다.</li><li>목록 둘째 항이다.</li></ul>",
  "\n<p>마지막 문단이다.</p>",
];

interface RebuildRig {
  service: DraftService;
  store: DraftStore;
  mirror: { title: string; version: number; storage: string };
  putBodies: string[];
  messages: ServerMessage[];
  cleanup(): void;
}
/** 재구성 시험의 자리 — 진짜 발행기가 흐르는 원격 거울(mirror)로 발행 · 재구성 · 다시 맞추기를 본다. */
function rebuildRig(runner: DraftAiRunner): RebuildRig {
  const home = mkdtempSync(join(tmpdir(), "draft-rebuild-"));
  const readRoot = join(home, "demo", "confluence");
  mkdirSync(join(readRoot, "COLO"), { recursive: true });
  writeConfluenceLedger(confluenceMirrorLedger(join(home, "demo")), {
    site: SITE,
    roots: [ROOT_ID],
    lastSyncAt: null,
    pages: {
      [PAGE_ID]: {
        path: "COLO/rebuild",
        title: REBUILD_TITLE,
        version: 4,
        sections: [],
        comments: null,
      },
    },
    folders: {},
    unsupported: {},
  });
  writeFileSync(join(readRoot, "COLO", "rebuild.md"), `# ${REBUILD_TITLE}\n\n합성 본문이다.\n`);
  const mirror = { title: REBUILD_TITLE, version: 4, storage: REBUILD_STORAGE };
  const putBodies: string[] = [];
  const transport: RestTransport = {
    async request(input) {
      if (input.method === "PUT" && input.url === `/wiki/api/v2/pages/${PAGE_ID}`) {
        const parsed = JSON.parse(new TextDecoder().decode(input.body ?? new Uint8Array())) as {
          title?: string;
          version?: { number?: number };
          body?: { value?: string };
        };
        mirror.title = parsed.title ?? mirror.title;
        mirror.version = parsed.version?.number ?? mirror.version + 1;
        mirror.storage = parsed.body?.value ?? mirror.storage;
        putBodies.push(mirror.storage);
        return {
          status: 200,
          body: Buffer.from(
            JSON.stringify({
              id: PAGE_ID,
              title: mirror.title,
              version: { number: mirror.version },
            }),
            "utf8",
          ),
        };
      }
      if (input.method === "GET") {
        if (input.url === readPageUrl(PAGE_ID)) {
          return {
            status: 200,
            body: Buffer.from(
              JSON.stringify(pageJson(PAGE_ID, mirror.title, mirror.storage, mirror.version)),
              "utf8",
            ),
          };
        }
        if (input.url === WHOAMI_URL) {
          return {
            status: 200,
            body: Buffer.from(
              JSON.stringify({ accountId: "acct-1", displayName: "합성 사람" }),
              "utf8",
            ),
          };
        }
        if (input.url === `/wiki/api/v2/pages/${PAGE_ID}/ancestors?limit=250`) {
          return {
            status: 200,
            body: Buffer.from(JSON.stringify({ results: [{ id: ROOT_ID }] }), "utf8"),
          };
        }
        if (input.url === `/wiki/api/v2/pages/${PAGE_ID}/operations`) {
          return {
            status: 200,
            body: Buffer.from(
              JSON.stringify({ operations: [{ operation: "update", targetType: "page" }] }),
              "utf8",
            ),
          };
        }
        if (input.url === `/wiki/api/v2/pages/${PAGE_ID}?get-draft=true&body-format=storage`) {
          return {
            status: 200,
            body: Buffer.from(
              JSON.stringify({
                id: PAGE_ID,
                status: "current",
                version: { number: mirror.version },
                body: { storage: { value: "", representation: "storage" } },
              }),
              "utf8",
            ),
          };
        }
      }
      return { status: 404, body: Buffer.from("{}", "utf8") };
    },
  };
  const setting: Record<string, string> = {
    "confluenceSite:demo": SITE,
    "confluenceRootId:demo": ROOT_ID,
  };
  const credentials = new MemoryCredentialStore();
  void credentials.save("confluence-pat", "me@example.com\ntok");
  const messages: ServerMessage[] = [];
  const service = new DraftService({
    registry: { activeSlug: () => "demo", paths: (slug) => ({ root: join(home, slug) }) },
    machineSetting: { get: (key) => setting[key] ?? null },
    credentials,
    claudeExecutable: () => "/usr/local/bin/claude",
    broadcast: (message) => messages.push(message),
    logger: { info() {}, warn() {}, error() {} },
    ai: runner,
    publisher: new DraftPublisher(),
    now: () => NOW,
    transport: () => transport,
  });
  return {
    service,
    store: new DraftStore(join(home, "demo", "plans"), () => NOW),
    mirror,
    putBodies,
    messages,
    cleanup() {
      rmSync(home, { recursive: true, force: true });
    },
  };
}

test("발행 뒤 재구성 — 넣고 · 빼고 · 옮긴 발행 뒤에 초안은 새 기준의 자리 번호로 다시 선다", async () => {
  const previous = process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH;
  process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH = "1";
  const rig1 = rebuildRig(
    fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null })).runner,
  );
  try {
    await rig1.service.open(PAGE_ID);
    const edited = await rig1.service.edit(KEY, 0, [
      {
        type: "insert",
        afterBlockId: null,
        view: { kind: "paragraph", text: "맨 앞의 새 문단이다." },
      },
      { type: "move", blockId: "b1", afterBlockId: "b2" },
      { type: "delete", blockId: "b2" },
    ]);
    assert.equal(edited.revision, 1);
    assert.match(edited.blocks[0]?.id ?? "", /^n[0-9a-f]{12}$/);
    const applied = await rig1.service.publish({
      docKey: KEY,
      commandId: CMD_A,
      expectedRevision: 1,
    });
    assert.equal(applied.state, "applied");
    assert.equal(applied.version, 5);
    const view = await rig1.service.get(KEY);
    assert.equal(view.state, "published");
    assert.equal(view.baseVersion, 5);
    // 블록 id 는 새 기준의 자리 번호다 — 넣은 n… 아이디도 옮기기 전의 옛 아이디도 남지 않는다.
    assert.deepEqual(
      view.blocks.map((block) => [block.id, block.view.kind, block.status]),
      [
        ["b0", "paragraph", "same"],
        ["b1", "heading", "same"],
        ["b2", "paragraph", "same"],
        ["b3", "list", "same"],
        ["b4", "paragraph", "same"],
      ],
    );
    // 초안의 바이트는 발행된 기준과 같다 — 보낸 본문이 원격에 그대로 적용됐다.
    assert.equal(rig1.store.readBase(KEY), rig1.putBodies[0]);
    assert.deepEqual(
      (rig1.store.read(KEY)?.blocks ?? []).map((block) => block.xml),
      REBUILD_PUBLISHED,
    );
    // 요약 — 바뀐 수 0(기준에서 빠진 블록 0을 포함해)이다.
    const summaries = await rig1.service.list();
    assert.deepEqual(
      summaries.map((row) => [row.docKey, row.changedBlocks, row.state]),
      [[KEY, 0, "published"]],
    );
    // 미리보기 — 고치지 않았으니 nothing-to-publish 다.
    const preview = await rig1.service.publishPreview(KEY);
    assert.deepEqual(preview.blockers, ["nothing-to-publish"]);
    // 되돌리기 — 새 기준의 자리 번호로 찾은 블록이 발행된 내용으로 돌아온다.
    const touched = await rig1.service.edit(KEY, view.revision, [
      { type: "set", blockId: "b2", view: { kind: "paragraph", text: "되돌릴 고침이다." } },
    ]);
    assert.equal(touched.blocks[2]?.id, "b2");
    assert.equal(touched.blocks[2]?.status, "changed");
    const reverted = await rig1.service.edit(KEY, touched.revision, [
      { type: "revert", blockId: "b2" },
    ]);
    assert.equal(reverted.blocks[2]?.id, "b2");
    assert.equal(reverted.blocks[2]?.status, "same");
    const record = rig1.store.read(KEY);
    assert.ok(record);
    assert.equal(record.blocks[2]?.xml, "\n<p>첫 문단이다.</p>");
    // 되돌린 뒤에도 바꿀 것이 없다.
    const settled = await rig1.service.publishPreview(KEY);
    assert.deepEqual(settled.blockers, ["nothing-to-publish"]);
  } finally {
    if (previous === undefined) delete process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH;
    else process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH = previous;
    rig1.cleanup();
  }
});

test("발행 뒤 재구성 — 발행 전의 AI 변경안은 발행 뒤에 채택하면 오래됨으로 거절된다", async () => {
  const ai = fakeAi(async () => ({
    reply: "첫 문단을 다듬고 둘째 문단을 지운다.",
    summary: "발행 전 변경안",
    ops: [
      {
        opId: "op-fix",
        type: "replace",
        blockId: "b1",
        view: { kind: "paragraph", text: "AI가 다듬은 첫 문단이다." },
      },
      { opId: "op-cut", type: "delete", blockId: "b2" },
    ],
    sdkSessionId: "sess-rebuild",
  }));
  const previous = process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH;
  process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH = "1";
  const rig1 = rebuildRig(ai.runner);
  try {
    await rig1.service.open(PAGE_ID);
    rig1.service.ask(KEY, "첫 문단을 다듬고 둘째 문단을 지워 줘", []);
    await until(
      () => aiMessages(rig1.messages).some((message) => message.phase === "done"),
      "done 방송",
    );
    const proposalId = rig1.service.thread(KEY).proposals[0]?.proposalId ?? "";
    // 발행 전 — 지금 초안과 맞으니 열린 걸음이다.
    assert.deepEqual(
      rig1.service.thread(KEY).proposals[0]?.ops.map((op) => op.state),
      ["open", "open"],
    );
    await rig1.service.edit(KEY, 0, [
      {
        type: "insert",
        afterBlockId: null,
        view: { kind: "paragraph", text: "맨 앞의 새 문단이다." },
      },
      { type: "move", blockId: "b1", afterBlockId: "b2" },
      { type: "delete", blockId: "b2" },
    ]);
    const applied = await rig1.service.publish({
      docKey: KEY,
      commandId: CMD_A,
      expectedRevision: 1,
    });
    assert.equal(applied.state, "applied");
    // 대화를 다시 읽으면 — 발행된 초안의 자리 번호에서 이미 오래됨으로 보인다.
    assert.deepEqual(
      rig1.service.thread(KEY).proposals[0]?.ops.map((op) => op.state),
      ["stale", "stale"],
    );
    const view = await rig1.service.get(KEY);
    const refused = await rig1.service.adopt(KEY, proposalId, ["op-fix", "op-cut"], view.revision);
    // 아무것도 적용되지 않았다 — 이제 머리말인 b1 에 AI 문단이 가지 않는다.
    assert.deepEqual(
      refused.blocks.map((block) => [block.id, block.status]),
      [
        ["b0", "same"],
        ["b1", "same"],
        ["b2", "same"],
        ["b3", "same"],
        ["b4", "same"],
      ],
    );
    assert.equal(paragraphText(refused.blocks[1]), null);
    const record = rig1.store.read(KEY);
    assert.ok(record);
    assert.equal(record.revision, view.revision); // 적용이 없으니 개정도 그대로다
    assert.ok(record.blocks.every((block) => !block.xml.includes("AI가")));
  } finally {
    if (previous === undefined) delete process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH;
    else process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH = previous;
    rig1.cleanup();
  }
});

test("발행 뒤 재구성 — 발행 뒤 원격이 다른 블록만 바꾸면 다시 맞추기는 충돌 없이 그 블록만 따른다", async () => {
  const previous = process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH;
  process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH = "1";
  const rig1 = rebuildRig(
    fakeAi(async () => ({ reply: "", summary: "", ops: [], sdkSessionId: null })).runner,
  );
  try {
    await rig1.service.open(PAGE_ID);
    await rig1.service.edit(KEY, 0, [
      {
        type: "insert",
        afterBlockId: null,
        view: { kind: "paragraph", text: "맨 앞의 새 문단이다." },
      },
      { type: "move", blockId: "b1", afterBlockId: "b2" },
      { type: "delete", blockId: "b2" },
    ]);
    const applied = await rig1.service.publish({
      docKey: KEY,
      commandId: CMD_A,
      expectedRevision: 1,
    });
    assert.equal(applied.state, "applied");
    // 원격이 목록 블록만 바꾼 다음 판 — 초안은 발행 뒤의 기준 그대로다.
    rig1.mirror.version = 6;
    rig1.mirror.storage = (rig1.store.readBase(KEY) ?? "").replace(
      "<li>목록 첫 항이다.</li>",
      "<li>원격이 바꾼 첫 항이다.</li>",
    );
    const rebased = await rig1.service.rebase(KEY);
    assert.equal(rebased.state, "editing");
    assert.equal(rebased.baseVersion, 6);
    assert.ok(rebased.blocks.every((block) => block.theirs === undefined));
    assert.deepEqual(
      rebased.blocks.map((block) => [block.id, block.status]),
      [
        ["b0", "same"],
        ["b1", "same"],
        ["b2", "same"],
        ["b3", "same"],
        ["b4", "same"],
      ],
    );
    const record = rig1.store.read(KEY);
    assert.ok(record);
    // 목록 블록만 원격 것으로 — 나머지는 발행된 본문의 바이트 그대로다.
    assert.ok((record.blocks[3]?.xml ?? "").includes("원격이 바꾼 첫 항이다."));
    assert.equal(record.blocks[2]?.xml, "\n<p>첫 문단이다.</p>");
    assert.equal(rig1.store.readBase(KEY), rig1.mirror.storage);
  } finally {
    if (previous === undefined) delete process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH;
    else process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH = previous;
    rig1.cleanup();
  }
});

// ————— 변경안이 오래됨이 되는 때의 회귀(2026-10-23 · 작업 B10) —————
// 생성 중에 사람이 초안을 고쳤거나(물을 때와 저장할 때의 개정이 다르다) 기준이 바뀌었으면(다시 맞추기 · 발행)
// 변경안의 걸음은 오래됨이다. 저장 표시는 디스크의 변경안으로 본다 — 대화 보기는 열린 걸음을 지금 초안과 다시
// 대 보고 오래됨으로 보이게 하므로, 보기만 보면 저장 표시가 빠져도 가려진다.

/**
 * 답을 붙잡아 두는 가짜 AI — 시험이 `release` 로 놓아 줄 때까지 생성이 선 채로 돈다. 그 사이에 사람이 초안을
 * 고치게 해 「물을 때의 초안」과 「저장할 때의 초안」을 갈라 놓는다.
 */
function heldAi(): {
  runner: DraftAiRunner;
  calls: DraftAiRequest[];
  release(answer: DraftAiAnswer): void;
} {
  const calls: DraftAiRequest[] = [];
  const gate = Promise.withResolvers<DraftAiAnswer>();
  return {
    calls,
    release: (answer) => gate.resolve(answer),
    runner: async (request) => {
      calls.push(request);
      return await gate.promise;
    },
  };
}

/** done 방송이 `count` 번 나갈 때까지 기다린다. */
const untilDone = (messages: ServerMessage[], count = 1): Promise<void> =>
  until(
    () => aiMessages(messages).filter((message) => message.phase === "done").length >= count,
    "done 방송",
  );

/** 디스크에 적힌 변경안의 걸음 상태 — 대화 보기가 아니라 저장된 값이다. */
const storedOps = (store: DraftStore, proposalIndex = 0): Array<[string, string]> =>
  (store.proposals(KEY)[proposalIndex]?.ops ?? []).map((op) => [op.opId, op.state]);

/** 대화 보기의 걸음 상태 — 열린 걸음은 지금 초안과 다시 대 본 값이다. */
const viewedOps = (service: DraftService, proposalIndex = 0): Array<[string, string]> =>
  (service.thread(KEY).proposals[proposalIndex]?.ops ?? []).map((op) => [op.opId, op.state]);

/** 첫 문단 바꾸기 · 둘째 문단 뒤에 덧붙이기 · 제목 바꾸기 — 머리말(b0)과 b3 이후는 겨누지 않는다. */
const threeSteps = (sdkSessionId: string): DraftAiAnswer => ({
  reply: "세 걸음으로 고쳐 보았다.",
  summary: "문단 · 덧붙임 · 제목",
  ops: [
    {
      opId: "op-fix",
      type: "replace",
      blockId: "b1",
      view: { kind: "paragraph", text: "AI가 다듬은 첫 문단이다." },
    },
    {
      opId: "op-add",
      type: "insert",
      afterBlockId: "b2",
      view: { kind: "paragraph", text: "AI가 덧붙인 문단이다." },
    },
    { opId: "op-title", type: "title", title: "AI가 지은 제목이다." },
  ],
  sdkSessionId,
});

test("변경안 — 묻는 사이에 사람이 다른 블록을 고치면 놓인 변경안의 걸음은 모두 오래됨으로 저장된다", async () => {
  const ai = heldAi();
  const rig1 = rig(ai.runner);
  try {
    await rig1.service.open(PAGE_ID);
    rig1.service.ask(KEY, "첫 문단을 다듬고 문단을 덧붙여 줘", []);
    await until(() => ai.calls.length === 1, "생성이 AI 를 불렀다");
    // 생성이 도는 사이 — 사람이 걸음이 겨누지 않는 블록(머리말 b0)을 고친다.
    const edited = await rig1.service.edit(KEY, 0, [
      {
        type: "set",
        blockId: "b0",
        view: { kind: "heading", level: 2, text: "사람이 고친 머리말이다." },
      },
    ]);
    assert.equal(edited.revision, 1);
    ai.release(threeSteps("sess-held-other"));
    await untilDone(rig1.messages);
    // 디스크의 걸음은 처음부터 오래됨이다 — 걸음이 겨눈 블록은 그대로여도 초안의 개정이 달라졌다.
    assert.deepEqual(storedOps(rig1.store), [
      ["op-fix", "stale"],
      ["op-add", "stale"],
      ["op-title", "stale"],
    ]);
    // 변경안은 물을 때의 개정(0)을 단다 — 지금 초안은 이미 1 이다.
    const proposal = rig1.store.proposals(KEY)[0];
    assert.equal(proposal?.draftRevision, 0);
    // 대화 보기도 같다 — 제목 걸음은 지문으로 오래됨을 가릴 수 없으니 저장 표시가 보이는 것이다.
    assert.deepEqual(viewedOps(rig1.service), [
      ["op-fix", "stale"],
      ["op-add", "stale"],
      ["op-title", "stale"],
    ]);
    // 오래된 변경안도 대화에 달린다 — 사람이 보고 판단한다.
    const doneBroadcast = aiMessages(rig1.messages).find((message) => message.phase === "done");
    assert.equal(doneBroadcast?.proposalId, proposal?.proposalId);
    // 생성이 초안을 건드리지 않았다 — 사람의 고침만 남는다.
    const view = await rig1.service.get(KEY);
    assert.equal(view.revision, 1);
    assert.equal(view.title, "로그인 화면");
    assert.deepEqual(view.blocks[0]?.view, {
      kind: "heading",
      level: 2,
      text: "사람이 고친 머리말이다.",
    });
    assert.equal(paragraphText(view.blocks[1]), "첫 문단이다.");
    // 오래된 걸음은 채택해도 적용되지 않는다 — 겨눈 블록이 그대로여도(2026-10-23 오케스트레이터 · 검토 B10 결함 1).
    const adopted = await rig1.service.adopt(
      KEY,
      proposal?.proposalId ?? "",
      ["op-fix", "op-add", "op-title"],
      1,
    );
    assert.equal(adopted.revision, 1);
    assert.equal(adopted.title, "로그인 화면");
    assert.deepEqual(storedOps(rig1.store), [
      ["op-fix", "stale"],
      ["op-add", "stale"],
      ["op-title", "stale"],
    ]);
  } finally {
    rig1.cleanup();
  }
});

test("변경안 — 묻는 사이에 초안을 버리면 생성은 대화 · 변경안을 남기지 않는다(다시 연 초안은 깨끗하다)", async () => {
  const ai = heldAi();
  const rig1 = rig(ai.runner);
  try {
    await rig1.service.open(PAGE_ID);
    rig1.service.ask(KEY, "첫 문단을 다듬어 줘", []);
    await until(() => ai.calls.length === 1, "생성이 AI 를 불렀다");
    await rig1.service.discard(KEY);
    ai.release(threeSteps("sess-held-discard"));
    await until(
      () => aiMessages(rig1.messages).some((message) => message.phase === "cancelled"),
      "버려진 초안의 생성은 취소로 끝난다",
    );
    assert.deepEqual(rig1.store.proposals(KEY), []);
    assert.equal(rig1.store.thread(KEY), null);
    // 다시 연 초안에는 옛 대화 · 변경안이 붙지 않는다.
    await rig1.service.open(PAGE_ID);
    assert.deepEqual(rig1.store.proposals(KEY), []);
    const thread = rig1.service.thread(KEY);
    assert.deepEqual(thread.proposals, []);
    // 도는 생성의 표식이 풀렸다 — 다시 연 같은 문서에서 다시 물을 수 있다(2026-10-23 마감 점검).
    await until(() => rig1.service.thread(KEY).running === false, "도는 생성의 표식이 풀린다");
    const again = rig1.service.ask(KEY, "다시 물어 본다", []);
    assert.ok(again.messageId.length > 0);
    ai.release(threeSteps("sess-held-again"));
    await until(
      () => aiMessages(rig1.messages).filter((message) => message.phase === "done").length >= 1,
      "다시 물은 생성이 끝난다",
    );
  } finally {
    rig1.cleanup();
  }
});

test("변경안 — 묻는 사이에 사람이 AI 가 고칠 그 블록을 고치면 그 걸음은 오래됨이고 채택해도 적용되지 않는다", async () => {
  const ai = heldAi();
  const rig1 = rig(ai.runner);
  try {
    await rig1.service.open(PAGE_ID);
    // 물을 때의 첫 문단 — 걸음의 기준 지문은 이 블록의 것이어야 한다.
    const askedXml = rig1.store.read(KEY)?.blocks[1]?.xml ?? "";
    rig1.service.ask(KEY, "첫 문단을 다듬어 줘", []);
    await until(() => ai.calls.length === 1, "생성이 AI 를 불렀다");
    // 생성이 도는 사이 — 사람이 AI 가 고칠 바로 그 블록을 먼저 고친다.
    const edited = await rig1.service.edit(KEY, 0, [
      {
        type: "set",
        blockId: "b1",
        view: { kind: "paragraph", text: "사람이 먼저 고친 첫 문단이다." },
      },
    ]);
    assert.equal(edited.revision, 1);
    ai.release({
      reply: "첫 문단을 다듬었다.",
      summary: "첫 문단 다듬기",
      ops: [
        {
          opId: "op-same",
          type: "replace",
          blockId: "b1",
          view: { kind: "paragraph", text: "AI가 다듬은 첫 문단이다." },
        },
      ],
      sdkSessionId: "sess-held-same",
    });
    await untilDone(rig1.messages);
    // 저장된 걸음은 오래됨이다.
    assert.deepEqual(storedOps(rig1.store), [["op-same", "stale"]]);
    assert.deepEqual(viewedOps(rig1.service), [["op-same", "stale"]]);
    // 걸음은 물을 때의 초안으로 검사된다 — 기준 지문이 사람이 고치기 전 블록의 것이지 지금 블록의 것이 아니다.
    // 지금 블록의 지문이 실렸다면 AI 의 옛 내용이 사람의 고침 위에 채택될 수 있다.
    const nowXml = rig1.store.read(KEY)?.blocks[1]?.xml ?? "";
    assert.notEqual(nowXml, askedXml);
    const proposal = rig1.store.proposals(KEY)[0];
    assert.equal(proposal?.ops[0]?.baseFingerprint, blockFingerprint(askedXml));
    assert.notEqual(proposal?.ops[0]?.baseFingerprint, blockFingerprint(nowXml));
    // 채택해도 적용되지 않는다 — 사람의 글이 남고 개정도 그대로다.
    const refused = await rig1.service.adopt(
      KEY,
      proposal?.proposalId ?? "",
      ["op-same"],
      edited.revision,
    );
    assert.equal(refused.revision, edited.revision);
    assert.equal(paragraphText(refused.blocks[1]), "사람이 먼저 고친 첫 문단이다.");
    assert.equal(rig1.store.read(KEY)?.revision, edited.revision);
    assert.equal(rig1.store.read(KEY)?.blocks[1]?.xml, nowXml);
    assert.deepEqual(storedOps(rig1.store), [["op-same", "stale"]]);
  } finally {
    rig1.cleanup();
  }
});

test("변경안 — 묻는 사이에 아무도 초안을 고치지 않으면 걸음은 열린 채 저장되고 채택하면 적용된다", async () => {
  const ai = heldAi();
  const rig1 = rig(ai.runner);
  try {
    await rig1.service.open(PAGE_ID);
    rig1.service.ask(KEY, "첫 문단을 다듬고 문단을 덧붙여 줘", []);
    await until(() => ai.calls.length === 1, "생성이 AI 를 불렀다");
    // 붙잡아 둔 동안 읽기만 한다 — 개정은 그대로다.
    assert.equal((await rig1.service.get(KEY)).revision, 0);
    ai.release(threeSteps("sess-held-calm"));
    await untilDone(rig1.messages);
    assert.deepEqual(storedOps(rig1.store), [
      ["op-fix", "open"],
      ["op-add", "open"],
      ["op-title", "open"],
    ]);
    assert.deepEqual(viewedOps(rig1.service), [
      ["op-fix", "open"],
      ["op-add", "open"],
      ["op-title", "open"],
    ]);
    // 채택 — 세 걸음이 한 번에 적용되고 개정이 한 오른다.
    const adopted = await rig1.service.adopt(
      KEY,
      rig1.store.proposals(KEY)[0]?.proposalId ?? "",
      ["op-fix", "op-add", "op-title"],
      0,
    );
    assert.equal(adopted.revision, 1);
    assert.equal(paragraphText(adopted.blocks[1]), "AI가 다듬은 첫 문단이다.");
    assert.equal(adopted.blocks.length, 4);
    assert.equal(paragraphText(adopted.blocks[3]), "AI가 덧붙인 문단이다.");
    assert.equal(adopted.blocks[3]?.status, "new");
    assert.equal(adopted.title, "AI가 지은 제목이다.");
    assert.deepEqual(storedOps(rig1.store), [
      ["op-fix", "adopted"],
      ["op-add", "adopted"],
      ["op-title", "adopted"],
    ]);
  } finally {
    rig1.cleanup();
  }
});

test("변경안 — 다시 맞추기 뒤에는 그 전의 열린 걸음이 모두 오래됨으로 저장되고 이어서 받은 변경안은 열린 채다", async () => {
  let asked = 0;
  const ai = fakeAi(async () => {
    asked += 1;
    if (asked === 1) return threeSteps("sess-rebase-1");
    return {
      reply: "마지막 문단을 다듬었다.",
      summary: "마지막 문단 다듬기",
      ops: [
        {
          opId: "op-last",
          type: "replace",
          blockId: "b4",
          view: { kind: "paragraph", text: "AI가 다듬은 마지막 문단이다." },
        },
      ],
      sdkSessionId: "sess-rebase-2",
    };
  });
  const rig1 = rebuildRig(ai.runner);
  try {
    await rig1.service.open(PAGE_ID);
    rig1.service.ask(KEY, "첫 문단을 다듬고 문단을 덧붙여 줘", []);
    await untilDone(rig1.messages);
    // 다시 맞추기 전 — 지금 초안과 맞는 열린 걸음이다.
    assert.deepEqual(storedOps(rig1.store), [
      ["op-fix", "open"],
      ["op-add", "open"],
      ["op-title", "open"],
    ]);
    // 원격이 걸음이 겨누지 않는 목록 블록만 바꾼 다음 판이다.
    rig1.mirror.version = 5;
    rig1.mirror.storage = REBUILD_STORAGE.replace(
      "<li>목록 첫 항이다.</li>",
      "<li>원격이 바꾼 첫 항이다.</li>",
    );
    const rebased = await rig1.service.rebase(KEY);
    assert.equal(rebased.state, "editing");
    assert.equal(rebased.baseVersion, 5);
    // 걸음이 겨눈 블록은 그대로다 — 지문으로는 맞아 보여도 기준이 바뀌었으니 디스크의 걸음은 오래됨이다.
    assert.equal(paragraphText(rebased.blocks[1]), "첫 문단이다.");
    assert.equal(rig1.store.readBase(KEY), rig1.mirror.storage);
    assert.deepEqual(storedOps(rig1.store), [
      ["op-fix", "stale"],
      ["op-add", "stale"],
      ["op-title", "stale"],
    ]);
    assert.deepEqual(viewedOps(rig1.service), [
      ["op-fix", "stale"],
      ["op-add", "stale"],
      ["op-title", "stale"],
    ]);
    // 새 기준에서 물어 받은 변경안은 열린 채 저장된다 — 그 사이에 바뀐 것이 없고 앞 변경안은 그대로 오래됨이다.
    rig1.service.ask(KEY, "마지막 문단을 다듬어 줘", []);
    await untilDone(rig1.messages, 2);
    assert.deepEqual(storedOps(rig1.store, 1), [["op-last", "open"]]);
    assert.deepEqual(storedOps(rig1.store, 0), [
      ["op-fix", "stale"],
      ["op-add", "stale"],
      ["op-title", "stale"],
    ]);
    const adopted = await rig1.service.adopt(
      KEY,
      rig1.store.proposals(KEY)[1]?.proposalId ?? "",
      ["op-last"],
      rebased.revision,
    );
    assert.equal(adopted.revision, rebased.revision + 1);
    assert.equal(paragraphText(adopted.blocks[4]), "AI가 다듬은 마지막 문단이다.");
  } finally {
    rig1.cleanup();
  }
});

test("변경안 — 발행이 적용되면 그 전의 열린 걸음이 모두 오래됨으로 저장된다", async () => {
  const ai = fakeAi(async () => threeSteps("sess-publish"));
  const previous = process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH;
  process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH = "1";
  const rig1 = rebuildRig(ai.runner);
  try {
    await rig1.service.open(PAGE_ID);
    rig1.service.ask(KEY, "첫 문단을 다듬고 문단을 덧붙여 줘", []);
    await untilDone(rig1.messages);
    // 발행 전 — 지금 초안과 맞는 열린 걸음이다.
    assert.deepEqual(storedOps(rig1.store), [
      ["op-fix", "open"],
      ["op-add", "open"],
      ["op-title", "open"],
    ]);
    // 사람이 걸음이 겨누지 않는 마지막 문단만 고쳐 발행한다 — 넣고 · 빼고 · 옮기지 않으니 블록 번호는 그대로다.
    const edited = await rig1.service.edit(KEY, 0, [
      {
        type: "set",
        blockId: "b4",
        view: { kind: "paragraph", text: "사람이 고친 마지막 문단이다." },
      },
    ]);
    const applied = await rig1.service.publish({
      docKey: KEY,
      commandId: CMD_A,
      expectedRevision: edited.revision,
    });
    assert.equal(applied.state, "applied");
    assert.equal(rig1.putBodies.length, 1);
    // 발행이 기준을 옮겼다 — 초안은 발행본 기준이고 블록 번호는 그대로다.
    const view = await rig1.service.get(KEY);
    assert.equal(view.state, "published");
    assert.equal(view.baseVersion, 5);
    assert.deepEqual(
      view.blocks.map((block) => block.id),
      ["b0", "b1", "b2", "b3", "b4"],
    );
    // 걸음이 겨눈 블록은 지문으로도 그대로다 — 그래도 기준이 바뀌었으니 디스크의 걸음은 오래됨이다.
    const record = rig1.store.read(KEY);
    assert.ok(record);
    assert.equal(
      blockFingerprint(record.blocks[1]?.xml ?? ""),
      rig1.store.proposals(KEY)[0]?.ops[0]?.baseFingerprint,
    );
    assert.deepEqual(storedOps(rig1.store), [
      ["op-fix", "stale"],
      ["op-add", "stale"],
      ["op-title", "stale"],
    ]);
    assert.deepEqual(viewedOps(rig1.service), [
      ["op-fix", "stale"],
      ["op-add", "stale"],
      ["op-title", "stale"],
    ]);
  } finally {
    if (previous === undefined) delete process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH;
    else process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH = previous;
    rig1.cleanup();
  }
});
