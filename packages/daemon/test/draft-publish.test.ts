import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  ConfluenceClient,
  ConfluencePage,
  ConfluenceRead,
  ConfluenceWrite,
} from "../dist/confluence-client.js";
import {
  composeDraftBody,
  type DraftPublishContext,
  DraftPublisher,
  publishedTextMatches,
} from "../dist/draft-publish.js";
import {
  type DraftRecord,
  type DraftRecordBlock,
  DraftStore,
  type PublishIntentRecord,
} from "../dist/draft-store.js";
import {
  blockFingerprint,
  newBlockXml,
  parseStorage,
  renderBlock,
  serializeStorage,
} from "../dist/storage-blocks.js";

/**
 * 발행 엔진 시험(2026-10-23 · 작업 B3) — 임시 폴더의 DraftStore 와 시험 안의 가짜 클라이언트로
 * 돈다. 합성 저장 포맷만 쓴다. 본문 구성 · 미리보기의 막는 이유 · 발행의 의도 영속과 결과 ·
 * 재검사 · 종료 · 다시 맞추기 · 고르기를 본다. 실사이트에 요청하지 않는다.
 */

const KEY = "p-123";
const NEW_KEY = "n-0123456789abcdef0123456789abcdef";
const PAGE_ID = "123";
const SITE = "https://colosseum.atlassian.net";
const ACCOUNT = "acc-7";
const CMD = "0b1f8f2e-1111-4222-8333-444455556666";
const T0 = Date.parse("2026-10-23T12:00:00.000Z");

const BASE_XML = [
  "<h2>로그인 화면 기획</h2>",
  "<p>첫 문단이다. 이메일을 입력받는다.</p>",
  '<ac:structured-macro ac:name="info"><ac:parameter ac:name="title">참고</ac:parameter><ac:plain-text-body><![CDATA[가입 정책을 따른다]]></ac:plain-text-body></ac:structured-macro>',
  '<p>상태 <ac:structured-macro ac:name="status"><ac:parameter ac:name="title">진행</ac:parameter><ac:parameter ac:name="body">돌아가는 중</ac:parameter></ac:structured-macro> 표시</p>',
].join("\n");

// ————— 시계 · 밑그림 —————

let nowMs = T0;
const clock = (): Date => new Date(nowMs);
const iso = (ms: number): string => new Date(ms).toISOString();

function reset(): void {
  nowMs = T0;
}

/** 기준 원문을 초안 블록으로 옮긴다 — 기준 지문을 심어 둔다. */
function baseBlocks(xml: string): DraftRecordBlock[] {
  return parseStorage(xml).blocks.map((block) => ({
    id: block.id,
    slot: block.slot,
    kind: block.kind,
    xml: block.xml,
    baseFingerprint: blockFingerprint(block.xml),
  }));
}

function makeDraft(overrides: Partial<DraftRecord> = {}): DraftRecord {
  const doc = parseStorage(BASE_XML);
  return {
    format: 1,
    docKey: KEY,
    kind: "existing",
    site: SITE,
    pageId: PAGE_ID,
    spaceId: "COLO",
    parent: { id: "9", type: "page", title: "기획 루트" },
    title: "로그인 화면 v0.8",
    baseTitle: "로그인 화면 v0.8",
    baseVersion: 4,
    baseFetchedAt: iso(T0),
    revision: 3,
    state: "editing",
    frame: doc.frame,
    blocks: baseBlocks(BASE_XML),
    observedVersion: null,
    pendingCommandId: null,
    createdAt: iso(T0),
    updatedAt: iso(T0),
    ...overrides,
  };
}

function setup(
  draft: DraftRecord,
  baseXml: string | null,
): {
  root: string;
  store: DraftStore;
  publisher: DraftPublisher;
  ctx(overrides?: Partial<DraftPublishContext>): DraftPublishContext;
} {
  const root = mkdtempSync(join(tmpdir(), "draft-publish-"));
  const store = new DraftStore(root, clock);
  store.create(draft, baseXml);
  const publisher = new DraftPublisher();
  return {
    root,
    store,
    publisher,
    ctx: (overrides: Partial<DraftPublishContext> = {}) => ({
      store,
      client: null,
      rootId: "9",
      enabled: true,
      accountId: ACCOUNT,
      now: clock,
      ...overrides,
    }),
  };
}

function keep(t: { after(hook: () => unknown): unknown }, root: string): void {
  t.after(() => rmSync(root, { recursive: true, force: true }));
}

// ————— 가짜 원격 — 시험 안의 손잡이만 가진 객체를 클라이언트로 단언해 넘긴다 —————

interface MirrorPage {
  id: string;
  title: string;
  version: number;
  storage: string;
  parentId: string | null;
  updatedAt: string | null;
  authorId: string | null;
  draftStatus: string | null;
  draftStorage: string | null;
}

function mirrorOf(overrides: Partial<MirrorPage> = {}): MirrorPage {
  return {
    id: PAGE_ID,
    title: "로그인 화면 v0.8",
    version: 4,
    storage: BASE_XML,
    parentId: "9",
    updatedAt: iso(T0 - 60_000),
    authorId: ACCOUNT,
    draftStatus: null,
    draftStorage: null,
    ...overrides,
  };
}

/** 없는 손잡이를 부르면 실패한다 — 실제 클라이언트가 아니라는 사실을 숨기지 않는다. */
function fakeClient(handlers: Record<string, unknown>): ConfluenceClient {
  return new Proxy(handlers, {
    get(target, prop) {
      if (typeof prop === "string" && !(prop in target)) {
        throw new Error(`가짜 클라이언트에 없는 손잡이: ${prop}`);
      }
      return Reflect.get(target, prop);
    },
  }) as unknown as ConfluenceClient;
}

type UpdateInput = {
  pageId: string;
  title: string;
  storage: string;
  version: number;
  message?: string;
};
type CreateInput = { spaceId: string; parentId: string | null; title: string; storage: string };
type DraftRead = { status: string | null; version: number | null; storage: string | null };
type TitleRow = {
  id: string;
  title: string;
  parentId: string | null;
  version: number | null;
  createdAt: string | null;
};

function clientOver(
  mirror: MirrorPage,
  hooks: {
    updatePage?: (input: UpdateInput) => Promise<ConfluenceWrite<{ id: string; version: number }>>;
    createPage?: (
      input: CreateInput,
    ) => Promise<ConfluenceWrite<{ id: string; version: number; title: string }>>;
    readDraft?: () => Promise<ConfluenceRead<DraftRead>>;
    pageOperations?: () => Promise<
      ConfluenceRead<Array<{ operation: string; targetType: string }>>
    >;
    pageAncestors?: () => Promise<ConfluenceRead<string[]>>;
    findPagesByTitle?: () => Promise<ConfluenceRead<TitleRow[]>>;
  } = {},
): ConfluenceClient {
  return fakeClient({
    readPage: async (pageId: string): Promise<ConfluenceRead<ConfluencePage>> =>
      pageId === mirror.id
        ? { readable: true, value: { ...mirror } }
        : { readable: false, reason: "unavailable", detail: "문서 읽기에 실패했습니다" },
    readDraft:
      hooks.readDraft ??
      (async (): Promise<ConfluenceRead<DraftRead>> => ({
        readable: true,
        value: { status: mirror.draftStatus, version: null, storage: mirror.draftStorage },
      })),
    pageOperations:
      hooks.pageOperations ??
      (async (): Promise<ConfluenceRead<Array<{ operation: string; targetType: string }>>> => ({
        readable: true,
        value: [
          { operation: "update", targetType: "page" },
          { operation: "delete", targetType: "page" },
        ],
      })),
    pageAncestors:
      hooks.pageAncestors ??
      (async (): Promise<ConfluenceRead<string[]>> => ({ readable: true, value: ["9"] })),
    findPagesByTitle:
      hooks.findPagesByTitle ??
      (async (): Promise<ConfluenceRead<TitleRow[]>> => ({ readable: true, value: [] })),
    updatePage:
      hooks.updatePage ??
      (async (input: UpdateInput): Promise<ConfluenceWrite<{ id: string; version: number }>> => {
        mirror.version = input.version;
        mirror.title = input.title;
        mirror.storage = input.storage;
        mirror.updatedAt = iso(clock().getTime());
        mirror.authorId = ACCOUNT;
        return { written: true, value: { id: mirror.id, version: input.version } };
      }),
    createPage:
      hooks.createPage ??
      (async (
        input: CreateInput,
      ): Promise<ConfluenceWrite<{ id: string; version: number; title: string }>> => {
        mirror.id = "777";
        mirror.title = input.title;
        mirror.storage = input.storage;
        mirror.version = 1;
        mirror.parentId = input.parentId;
        mirror.updatedAt = iso(clock().getTime());
        mirror.authorId = ACCOUNT;
        return { written: true, value: { id: mirror.id, version: 1, title: input.title } };
      }),
  });
}

/** 결과를 잃은 발행 — unknown 답을 내고 초안을 잠근다. 재검사 · 종료 시험의 밑그림이다. */
async function unknownPublish() {
  const blocks = baseBlocks(BASE_XML).map((block) =>
    block.id === "b1" ? { ...block, xml: "<p>고친 첫 문단</p>" } : block,
  );
  const s = setup(makeDraft({ blocks }), BASE_XML);
  const mirror = mirrorOf();
  const client = clientOver(mirror, {
    updatePage: async () => ({
      written: false,
      reason: "unknown",
      detail: "문서 갱신의 결과를 알 수 없습니다 — Confluence에 닿지 못했습니다",
    }),
  });
  const result = await s.publisher.publish(s.ctx({ client }), {
    docKey: KEY,
    commandId: CMD,
    expectedRevision: 3,
  });
  assert.equal(result.state, "unknown");
  return { s, mirror };
}

/** 결과를 잃은 새 문서 발행 — create 의 재검사 시험의 밑그림이다. */
async function unknownCreate() {
  const draft = makeDraft({
    docKey: NEW_KEY,
    kind: "new",
    pageId: null,
    baseVersion: null,
    baseTitle: null,
    title: "새 기획 문서",
  });
  const s = setup(draft, null);
  const client = clientOver(mirrorOf(), {
    createPage: async () => ({
      written: false,
      reason: "unknown",
      detail: "문서 만들기의 결과를 알 수 없습니다 — Confluence에 닿지 못했습니다",
    }),
  });
  const result = await s.publisher.publish(s.ctx({ client }), {
    docKey: NEW_KEY,
    commandId: CMD,
    expectedRevision: 3,
  });
  assert.equal(result.state, "unknown");
  return s;
}

// ————— 발행 본문 —————

test("발행 본문: 고치지 않은 초안의 본문은 기준 원문과 바이트까지 같다", (t) => {
  reset();
  const s = setup(makeDraft(), BASE_XML);
  keep(t, s.root);
  const draft = s.store.read(KEY);
  assert.ok(draft);
  assert.equal(composeDraftBody(draft), BASE_XML);
});

test("발행 본문: 블록 하나를 고친 본문은 그 블록만 다르다", (t) => {
  reset();
  const doc = parseStorage(BASE_XML);
  const second = doc.blocks[1];
  assert.ok(second);
  const rendered = renderBlock(second, { kind: "paragraph", text: "고친 첫 문단" });
  assert.ok(rendered.ok);
  const expected = serializeStorage({
    frame: doc.frame,
    blocks: doc.blocks.map((block, index) =>
      index === 1 ? { ...block, xml: rendered.xml } : block,
    ),
  });
  const draft = makeDraft({
    blocks: baseBlocks(BASE_XML).map((block) =>
      block.id === "b1" ? { ...block, xml: rendered.xml } : block,
    ),
  });
  const s = setup(draft, BASE_XML);
  keep(t, s.root);
  const read = s.store.read(KEY);
  assert.ok(read);
  assert.equal(composeDraftBody(read), expected);
  assert.notEqual(expected, BASE_XML);
  assert.ok(expected.includes("고친 첫 문단"));
});

// ————— 발행 본문의 글 대조 —————

test("글 대조: 속성 · 공백 · 엔티티 · 태그 배치가 다르면 같은 글로 본다", () => {
  const sent = [
    "<h2>로그인 화면 기획</h2>",
    "<p>첫 문단이다 &amp; 이메일을 입력받는다.</p>",
    "<table><tbody><tr><td>항목</td><td>값</td></tr></tbody></table>",
  ].join("\n");
  const reshaped = [
    '<h2 id="sec">로그인 화면 기획</h2>',
    "<p>첫 문단이다 &#38;  이메일을 입력받는다.</p>",
    "<table><tbody><tr><td >항목</td><td>값</td></tr></tbody></table>",
  ].join("");
  assert.equal(publishedTextMatches(sent, reshaped), true);
  // nbsp 도 공백의 한 꼴이다.
  assert.equal(publishedTextMatches("<p>a b</p>", "<p>a&nbsp;&nbsp;b</p>"), true);
  // 빈 문서끼리는 같다.
  assert.equal(publishedTextMatches("", ""), true);
});

test("글 대조: 글이 다르거나 블록 경계가 공백이면 다르다", () => {
  assert.equal(publishedTextMatches("<p>첫 문단</p>", "<p>다른 문단</p>"), false);
  // 문단 경계와 공백은 다른 글이다 — 두 문단이 한 문단이 되지 않는다.
  assert.equal(publishedTextMatches("<p>a</p><p>b</p>", "<p>a b</p>"), false);
  // CDATA 속 글은 그대로 둔다 — 속 글이 다르면 다르다.
  const cdata = (text: string): string =>
    `<ac:structured-macro ac:name="info"><ac:plain-text-body><![CDATA[${text}]]></ac:plain-text-body></ac:structured-macro>`;
  assert.equal(
    publishedTextMatches(cdata("가입 정책을 따른다"), cdata("가입  정책을 따른다")),
    false,
  );
  assert.equal(
    publishedTextMatches(cdata("가입 정책을 따른다"), cdata("가입 정책을 따른다")),
    true,
  );
});

test("글 대조: 문서 끝의 블록 경계와 이름 엔티티는 같은 글로 본다(2차 검토 R3 발견 2)", () => {
  // Confluence 가 저장하며 얹히는 꼴 — 빈 문단 · 문단 감싸기 · 엔티티 꼴.
  assert.equal(publishedTextMatches("", "<p><br /></p>"), true);
  assert.equal(publishedTextMatches("본문", "<p>본문</p>"), true);
  assert.equal(publishedTextMatches("<p>감싼</p>", "<p><br /></p><p>감싼</p><p><br /></p>"), true);
  assert.equal(
    publishedTextMatches("<p>™ ± ½ 40°</p>", "<p>&trade; &plusmn; &frac12; 40&deg;</p>"),
    true,
  );
  assert.equal(
    publishedTextMatches("<p>Äöß ©→</p>", "<p>&Auml;&ouml;&szlig; &copy;&rarr;</p>"),
    true,
  );
  // 모르는 이름 엔티티는 양쪽이 같은 표지일 때만 같다 — 한쪽이 글자면 다른 글이다.
  assert.equal(publishedTextMatches("<p>&unheard;</p>", "<p>&unheard;</p>"), true);
  assert.equal(publishedTextMatches("<p>&unheard;</p>", "<p>™</p>"), false);
  // 문서 끝의 빈 문단은 감싼 꼴이다 — 문단 끝의 줄바꿈도 같은 글로 본다.
  assert.equal(publishedTextMatches("<p>a</p>", "<p>a<br /></p>"), true);
});

// ————— 미리보기 —————

test("미리보기: 바뀐 수와 지워진 보존 블록과 사라진 토큰을 센다", async (t) => {
  reset();
  const blocks = baseBlocks(BASE_XML);
  const first = blocks.find((block) => block.id === "b1");
  const status = blocks.find((block) => block.id === "b3");
  assert.ok(first && status);
  const editedFirst = renderBlock(first, { kind: "paragraph", text: "고친 첫 문단" });
  const editedStatus = renderBlock(status, { kind: "paragraph", text: "상태 표시" });
  assert.ok(editedFirst.ok && editedStatus.ok);
  const kept = blocks
    .filter((block) => block.id !== "b2") // 보존 매크로 블록을 지운다
    .map((block) =>
      block.id === "b1"
        ? { ...block, xml: editedFirst.xml }
        : block.id === "b3"
          ? { ...block, xml: editedStatus.xml } // 상태 매크로 토큰을 뺀다
          : block,
    );
  const fresh = newBlockXml({ kind: "paragraph", text: "새로 넣은 문단" });
  assert.ok(fresh.ok);
  const at = kept.findIndex((block) => block.id === "b3") + 1;
  kept.splice(at, 0, {
    id: "n001122334455",
    slot: "main",
    kind: "paragraph",
    xml: fresh.xml,
    baseFingerprint: null,
  });
  const s = setup(makeDraft({ blocks: kept, title: "로그인 화면 v0.9" }), BASE_XML);
  keep(t, s.root);
  const preview = await s.publisher.preview(s.ctx({ client: clientOver(mirrorOf()) }), KEY);
  assert.equal(preview.kind, "update");
  assert.deepEqual(preview.changes, {
    changed: 2,
    inserted: 1,
    deleted: 1,
    protectedRemoved: ["macro:status", "macro:info"],
  });
  assert.equal(preview.titleChanged, true);
  assert.equal(preview.baseVersion, 4);
  assert.equal(preview.remoteVersion, 4);
  assert.equal(preview.draftRevision, 3);
  assert.deepEqual(preview.stage, { current: "0.9", closed: false, required: false });
  assert.deepEqual(preview.blockers, []);
  assert.equal(preview.checkedAt, iso(T0));
});

test("미리보기: 1.0 이상 제목이면 개정 발행 확인이 필요하다", async (t) => {
  reset();
  const draft = makeDraft({ title: "로그인 화면 v1.0", baseTitle: "로그인 화면 v0.8" });
  const s = setup(draft, BASE_XML);
  keep(t, s.root);
  const preview = await s.publisher.preview(s.ctx({ client: clientOver(mirrorOf()) }), KEY);
  assert.deepEqual(preview.stage, { current: "1.0", closed: true, required: true });
  assert.deepEqual(preview.blockers, []);
});

test("미리보기: 발행이 꺼져 있으면 publish-disabled 이 선다", async (t) => {
  reset();
  const s = setup(makeDraft(), BASE_XML);
  keep(t, s.root);
  const preview = await s.publisher.preview(
    s.ctx({ enabled: false, client: clientOver(mirrorOf()) }),
    KEY,
  );
  assert.ok(preview.blockers.includes("publish-disabled"));
});

test("미리보기: 바꿀 것이 없으면 nothing-to-publish 이 선다", async (t) => {
  reset();
  const s = setup(makeDraft(), BASE_XML);
  keep(t, s.root);
  const preview = await s.publisher.preview(s.ctx({ client: clientOver(mirrorOf()) }), KEY);
  assert.deepEqual(preview.blockers, ["nothing-to-publish"]);
});

test("미리보기: 원격이 더 새 판이면 remote-newer 가 서고 초안에 표시한다", async (t) => {
  reset();
  const s = setup(makeDraft(), BASE_XML);
  keep(t, s.root);
  const preview = await s.publisher.preview(
    s.ctx({ client: clientOver(mirrorOf({ version: 7 })) }),
    KEY,
  );
  assert.ok(preview.blockers.includes("remote-newer"));
  const draft = s.store.read(KEY);
  assert.ok(draft);
  assert.equal(draft.observedVersion, 7);
});

test("미리보기: 원격에 다른 미발행 초안이 있으면 remote-draft 가 선다", async (t) => {
  reset();
  const s = setup(makeDraft(), BASE_XML);
  keep(t, s.root);
  const preview = await s.publisher.preview(
    s.ctx({
      client: clientOver(mirrorOf({ draftStatus: "draft", draftStorage: "<p>임시 저장</p>" })),
    }),
    KEY,
  );
  assert.ok(preview.blockers.includes("remote-draft"));
});

test("미리보기: 원격 초안을 판정할 수 없으면 remote-draft-unknown 이 선다", async (t) => {
  reset();
  const s = setup(makeDraft(), BASE_XML);
  keep(t, s.root);
  const client = clientOver(mirrorOf(), {
    readDraft: async () => ({
      readable: false,
      reason: "unavailable",
      detail: "초안 읽기에 실패했습니다",
    }),
  });
  const preview = await s.publisher.preview(s.ctx({ client }), KEY);
  assert.ok(preview.blockers.includes("remote-draft-unknown"));
});

test("미리보기: 고칠 권한이 없으면 no-permission 이 선다", async (t) => {
  reset();
  const s = setup(makeDraft(), BASE_XML);
  keep(t, s.root);
  const client = clientOver(mirrorOf(), {
    pageOperations: async () => ({ readable: true, value: [] }),
  });
  const preview = await s.publisher.preview(s.ctx({ client }), KEY);
  assert.ok(preview.blockers.includes("no-permission"));
});

test("미리보기: 기준 페이지 아래가 아니면 out-of-scope 가 선다", async (t) => {
  reset();
  const s = setup(makeDraft(), BASE_XML);
  keep(t, s.root);
  const client = clientOver(mirrorOf(), {
    pageAncestors: async () => ({ readable: true, value: ["42"] }),
  });
  const preview = await s.publisher.preview(s.ctx({ client }), KEY);
  assert.ok(preview.blockers.includes("out-of-scope"));
});

test("미리보기: 뿌리 설정이 없으면 out-of-scope 로 막는다", async (t) => {
  reset();
  const s = setup(makeDraft(), BASE_XML);
  keep(t, s.root);
  const preview = await s.publisher.preview(
    s.ctx({ client: clientOver(mirrorOf()), rootId: null }),
    KEY,
  );
  assert.ok(preview.blockers.includes("out-of-scope"));
  const fresh = makeDraft({
    docKey: NEW_KEY,
    kind: "new",
    pageId: null,
    baseVersion: null,
    baseTitle: null,
    title: "새 기획 문서",
  });
  s.store.create(fresh, null);
  const createPreview = await s.publisher.preview(
    s.ctx({ client: clientOver(mirrorOf()), rootId: null }),
    NEW_KEY,
  );
  assert.ok(createPreview.blockers.includes("out-of-scope"), "새 문서 갈래도 닫는다");
});

test("미리보기: 충돌이 남아 있으면 conflict-open 이 선다", async (t) => {
  reset();
  const blocks = baseBlocks(BASE_XML).map((block) =>
    block.id === "b1" ? { ...block, theirsXml: "<p>원격 판</p>" } : block,
  );
  const s = setup(makeDraft({ blocks }), BASE_XML);
  keep(t, s.root);
  const preview = await s.publisher.preview(s.ctx({ client: clientOver(mirrorOf()) }), KEY);
  assert.ok(preview.blockers.includes("conflict-open"));
});

test("미리보기: 결과를 기다리는 명령이 있으면 pending-command 가 선다", async (t) => {
  reset();
  const s = setup(makeDraft({ pendingCommandId: CMD }), BASE_XML);
  keep(t, s.root);
  const preview = await s.publisher.preview(s.ctx({ client: clientOver(mirrorOf()) }), KEY);
  assert.ok(preview.blockers.includes("pending-command"));
});

// ————— 발행 —————

test("발행: 성공하면 의도가 보내기 전에 저장되고 초안이 발행본 기준으로 옮겨진다", async (t) => {
  reset();
  const blocks = baseBlocks(BASE_XML).map((block) =>
    block.id === "b1" ? { ...block, xml: "<p>고친 첫 문단</p>" } : block,
  );
  const s = setup(makeDraft({ blocks }), BASE_XML);
  keep(t, s.root);
  const mirror = mirrorOf();
  const probe: {
    count: number;
    intent: PublishIntentRecord | null;
    body: string | null;
    input: UpdateInput | null;
  } = { count: 0, intent: null, body: null, input: null };
  const client = clientOver(mirror, {
    updatePage: async (input) => {
      probe.count += 1;
      probe.intent = s.store.intent(CMD);
      probe.body = s.store.intentBody(CMD);
      probe.input = input;
      mirror.version = input.version;
      mirror.title = input.title;
      mirror.storage = input.storage;
      mirror.updatedAt = iso(clock().getTime());
      mirror.authorId = ACCOUNT;
      return { written: true, value: { id: mirror.id, version: input.version } };
    },
  });
  const result = await s.publisher.publish(s.ctx({ client }), {
    docKey: KEY,
    commandId: CMD,
    expectedRevision: 3,
    stage: { notation: "1.0", reason: "1.0 런칭" },
  });
  assert.equal(result.state, "applied");
  assert.equal(result.pageId, PAGE_ID);
  assert.equal(result.version, 5);
  // 보내는 순간 의도와 본문이 먼저 저장돼 있었다
  assert.equal(probe.count, 1);
  assert.ok(probe.intent);
  assert.equal(probe.intent.state, "sending");
  assert.equal(probe.intent.targetVersion, 5);
  assert.equal(probe.intent.title, "로그인 화면 v1.0");
  assert.ok(probe.body);
  // 판 번호는 기준 + 1 이고, 제목은 단계 표기를 바꾸고 판 메모를 실었다
  assert.ok(probe.input);
  assert.equal(probe.input.version, 5);
  assert.equal(probe.input.title, "로그인 화면 v1.0");
  assert.equal(probe.input.message, "1.0 런칭");
  // 성공 뒤 초안은 발행본 기준이다
  const after = s.store.read(KEY);
  assert.ok(after);
  assert.equal(after.state, "published");
  assert.equal(after.pendingCommandId, null);
  assert.equal(after.title, "로그인 화면 v1.0");
  assert.equal(after.baseTitle, "로그인 화면 v1.0");
  assert.equal(after.baseVersion, 5);
  assert.equal(after.observedVersion, null);
  assert.equal(s.store.readBase(KEY), probe.body);
  for (const block of after.blocks) {
    assert.equal(block.baseFingerprint, blockFingerprint(block.xml));
  }
  const intent = s.store.intent(CMD);
  assert.ok(intent);
  assert.equal(intent.state, "applied");
  assert.deepEqual(intent.result, { pageId: PAGE_ID, version: 5, at: iso(T0) });
  // 이어지는 미리보기는 바꿀 것이 없다
  const preview = await s.publisher.preview(s.ctx({ client: clientOver(mirror) }), KEY);
  assert.deepEqual(preview.changes, { changed: 0, inserted: 0, deleted: 0, protectedRemoved: [] });
});

test("발행: 적용된 판의 원격 본문이 새 기준이다 — 속성 꼴이 다시 맞추기에서 가짜 충돌이 되지 않는다", async (t) => {
  reset();
  const blocks = baseBlocks(BASE_XML).map((block) =>
    block.id === "b1" ? { ...block, xml: "<p>고친 첫 문단</p>" } : block,
  );
  const s = setup(makeDraft({ blocks }), BASE_XML);
  keep(t, s.root);
  const mirror = mirrorOf();
  // Confluence 가 저장하며 속성을 얹는 꼴 — 글은 같고 바이트는 다르다.
  const rewritten = (body: string): string =>
    body.replace("<p>고친 첫 문단</p>", '<p data-cheese="x">고친 첫 문단</p>');
  const client = clientOver(mirror, {
    updatePage: async (input) => {
      mirror.version = input.version;
      mirror.storage = rewritten(input.storage);
      mirror.updatedAt = iso(clock().getTime());
      mirror.authorId = ACCOUNT;
      return { written: true, value: { id: mirror.id, version: input.version } };
    },
  });
  const result = await s.publisher.publish(s.ctx({ client }), {
    docKey: KEY,
    commandId: CMD,
    expectedRevision: 3,
  });
  assert.equal(result.state, "applied");
  // 새 기준은 원격 본문이다 — 보낸 본문이 아니다.
  const sent = s.store.intentBody(CMD);
  assert.ok(sent);
  assert.equal(s.store.readBase(KEY), rewritten(sent));
  const after = s.store.read(KEY);
  assert.ok(after);
  for (const block of after.blocks) {
    assert.equal(block.baseFingerprint, blockFingerprint(block.xml));
  }
  // 이어지는 미리보기는 바꿀 것이 없다.
  const preview = await s.publisher.preview(s.ctx({ client: clientOver(mirror) }), KEY);
  assert.deepEqual(preview.blockers, ["nothing-to-publish"]);
  // 원격이 다른 블록(머리말)만 바꾼 다음 판 — 다시 맞추기에 충돌이 없다.
  mirror.version = 6;
  mirror.storage = rewritten(sent).replace(
    "<h2>로그인 화면 기획</h2>",
    '<h2 id="r">바뀐 머리말</h2>',
  );
  const rebased = await s.publisher.rebase(s.ctx({ client: clientOver(mirror) }), KEY);
  assert.equal(rebased.state, "editing");
  assert.ok(rebased.blocks.every((block) => block.theirsXml === undefined));
  assert.equal(rebased.baseVersion, 6);
  assert.equal(s.store.readBase(KEY), mirror.storage);
});

test("발행: 적용된 판의 읽기가 실패하거나 판이 다르면 보낸 본문이 기준이다", async (t) => {
  reset();
  const edit = (rows: DraftRecordBlock[]): DraftRecordBlock[] =>
    rows.map((block) => (block.id === "b1" ? { ...block, xml: "<p>고친 첫 문단</p>" } : block));
  // Confluence 가 저장하며 속성을 얹는 꼴 — 글은 같고 바이트는 다르다.
  const rewritten = (body: string): string =>
    body.replace("<p>고친 첫 문단</p>", '<p data-cheese="x">고친 첫 문단</p>');

  // 1) 읽기 실패 — 보내고 나서 원격 문서가 사라졌다.
  const first = setup(makeDraft({ blocks: edit(baseBlocks(BASE_XML)) }), BASE_XML);
  keep(t, first.root);
  let sent = false;
  const gone = mirrorOf();
  const clientGone = fakeClient({
    readPage: async (pageId: string): Promise<ConfluenceRead<ConfluencePage>> =>
      sent || pageId !== gone.id
        ? { readable: false, reason: "unavailable", detail: "문서 읽기에 실패했습니다" }
        : { readable: true, value: { ...gone } },
    readDraft: async () => ({
      readable: true,
      value: { status: null, version: null, storage: null },
    }),
    pageOperations: async () => ({
      readable: true,
      value: [{ operation: "update", targetType: "page" }],
    }),
    pageAncestors: async () => ({ readable: true, value: ["9"] }),
    findPagesByTitle: async () => ({ readable: true, value: [] }),
    updatePage: async (input: UpdateInput) => {
      sent = true;
      gone.version = input.version;
      gone.storage = rewritten(input.storage);
      return { written: true, value: { id: gone.id, version: input.version } };
    },
  });
  const failedRead = await first.publisher.publish(first.ctx({ client: clientGone }), {
    docKey: KEY,
    commandId: CMD,
    expectedRevision: 3,
  });
  assert.equal(failedRead.state, "applied");
  const sentFirst = first.store.intentBody(CMD);
  assert.ok(sentFirst);
  assert.equal(first.store.readBase(KEY), sentFirst, "읽기에 실패하면 보낸 본문이 기준이다");

  // 2) 판이 다르다 — 남이 곧바로 다음 판을 얹었다. 읽은 본문이 아닌 보낸 본문이 기준이다.
  const second = setup(makeDraft({ blocks: edit(baseBlocks(BASE_XML)) }), BASE_XML);
  keep(t, second.root);
  let bumpedSent = false;
  const bumped = mirrorOf();
  const clientBumped = fakeClient({
    readPage: async (pageId: string): Promise<ConfluenceRead<ConfluencePage>> =>
      pageId !== bumped.id
        ? { readable: false, reason: "unavailable", detail: "문서 읽기에 실패했습니다" }
        : {
            readable: true,
            // 보내고 나서 읽으면 판이 둘 더 올라 있다 — 읽은 판(7)은 적용된 판(5)이 아니다.
            value: { ...bumped, version: bumpedSent ? bumped.version + 2 : bumped.version },
          },
    readDraft: async () => ({
      readable: true,
      value: { status: null, version: null, storage: null },
    }),
    pageOperations: async () => ({
      readable: true,
      value: [{ operation: "update", targetType: "page" }],
    }),
    pageAncestors: async () => ({ readable: true, value: ["9"] }),
    findPagesByTitle: async () => ({ readable: true, value: [] }),
    updatePage: async (input: UpdateInput) => {
      bumpedSent = true;
      bumped.version = input.version;
      bumped.storage = rewritten(input.storage);
      bumped.updatedAt = iso(clock().getTime());
      bumped.authorId = ACCOUNT;
      return { written: true, value: { id: bumped.id, version: input.version } };
    },
  });
  const newer = await second.publisher.publish(second.ctx({ client: clientBumped }), {
    docKey: KEY,
    commandId: CMD,
    expectedRevision: 3,
  });
  assert.equal(newer.state, "applied");
  assert.equal(newer.version, 5);
  const sentSecond = second.store.intentBody(CMD);
  assert.ok(sentSecond);
  assert.notEqual(sentSecond, rewritten(sentSecond));
  assert.equal(second.store.readBase(KEY), sentSecond, "판이 다르면 보낸 본문이 기준이다");
});

test("발행: 같은 명령을 다시 보내면 두 번 보내지 않고 저장된 결과를 돌려준다", async (t) => {
  reset();
  const blocks = baseBlocks(BASE_XML).map((block) =>
    block.id === "b1" ? { ...block, xml: "<p>고친 첫 문단</p>" } : block,
  );
  const s = setup(makeDraft({ blocks }), BASE_XML);
  keep(t, s.root);
  const mirror = mirrorOf();
  const probe = { count: 0, input: null as UpdateInput | null };
  const client = clientOver(mirror, {
    updatePage: async (input) => {
      probe.count += 1;
      probe.input = input;
      mirror.version = input.version;
      mirror.storage = input.storage;
      mirror.updatedAt = iso(clock().getTime());
      mirror.authorId = ACCOUNT;
      return { written: true, value: { id: mirror.id, version: input.version } };
    },
  });
  const first = await s.publisher.publish(s.ctx({ client }), {
    docKey: KEY,
    commandId: CMD,
    expectedRevision: 3,
  });
  assert.equal(first.state, "applied");
  assert.ok(probe.input);
  assert.equal("message" in probe.input, false); // 단계가 없으면 판 메모를 생략한다
  const again = await s.publisher.publish(s.ctx({ client }), {
    docKey: KEY,
    commandId: CMD,
    expectedRevision: 999,
  });
  assert.equal(again.state, "applied");
  assert.equal(again.version, 5);
  assert.equal(probe.count, 1);
});

test("발행: 같은 명령 아이디로 다른 초안을 발행하면 오류다", async (t) => {
  reset();
  const blocks = baseBlocks(BASE_XML).map((block) =>
    block.id === "b1" ? { ...block, xml: "<p>고친 첫 문단</p>" } : block,
  );
  const s = setup(makeDraft({ blocks }), BASE_XML);
  keep(t, s.root);
  const mirror = mirrorOf();
  const probe = { count: 0 };
  const client = clientOver(mirror, {
    updatePage: async (input) => {
      probe.count += 1;
      mirror.version = input.version;
      mirror.storage = input.storage;
      mirror.updatedAt = iso(clock().getTime());
      mirror.authorId = ACCOUNT;
      return { written: true, value: { id: mirror.id, version: input.version } };
    },
  });
  const first = await s.publisher.publish(s.ctx({ client }), {
    docKey: KEY,
    commandId: CMD,
    expectedRevision: 3,
  });
  assert.equal(first.state, "applied");
  // 다른 초안을 같은 명령 아이디로 발행한다 — 문서 A 의 결과를 돌려주지 않는다.
  const other = makeDraft({ docKey: "p-456", pageId: "456", revision: 0 });
  s.store.create(other, BASE_XML);
  await assert.rejects(
    s.publisher.publish(s.ctx({ client: clientOver(mirrorOf({ id: "456" })) }), {
      docKey: "p-456",
      commandId: CMD,
      expectedRevision: 0,
    }),
    /이미 다른 초안의 발행에/,
  );
  assert.equal(probe.count, 1, "두 번째 문서는 보내지 않는다");
});

test("발행: 표기 없는 제목은 그대로 보낸다", async (t) => {
  reset();
  const blocks = baseBlocks(BASE_XML).map((block) =>
    block.id === "b1" ? { ...block, xml: "<p>고친 첫 문단</p>" } : block,
  );
  const s = setup(makeDraft({ blocks, title: "로그인 화면", baseTitle: "로그인 화면" }), BASE_XML);
  keep(t, s.root);
  const mirror = mirrorOf();
  const probe = { input: null as UpdateInput | null };
  const client = clientOver(mirror, {
    updatePage: async (input) => {
      probe.input = input;
      mirror.version = input.version;
      mirror.storage = input.storage;
      mirror.updatedAt = iso(clock().getTime());
      mirror.authorId = ACCOUNT;
      return { written: true, value: { id: mirror.id, version: input.version } };
    },
  });
  const result = await s.publisher.publish(s.ctx({ client }), {
    docKey: KEY,
    commandId: CMD,
    expectedRevision: 3,
    stage: { notation: "1.0", reason: "1.0 런칭" },
  });
  assert.equal(result.state, "applied");
  assert.ok(probe.input);
  assert.equal(probe.input.title, "로그인 화면");
});

test("발행: 409 면 충돌로 돌아가고 원격의 새 판을 본다", async (t) => {
  reset();
  const blocks = baseBlocks(BASE_XML).map((block) =>
    block.id === "b1" ? { ...block, xml: "<p>고친 첫 문단</p>" } : block,
  );
  const s = setup(makeDraft({ blocks }), BASE_XML);
  keep(t, s.root);
  const mirror = mirrorOf();
  const client = clientOver(mirror, {
    updatePage: async () => {
      mirror.version = 5;
      mirror.authorId = "acc-other";
      return {
        written: false,
        reason: "conflict",
        detail: "문서 갱신에 실패했습니다 — 다른 사람이 먼저 문서를 바꿨다(409)",
      };
    },
  });
  const result = await s.publisher.publish(s.ctx({ client }), {
    docKey: KEY,
    commandId: CMD,
    expectedRevision: 3,
  });
  assert.equal(result.state, "conflict");
  const after = s.store.read(KEY);
  assert.ok(after);
  assert.equal(after.state, "editing");
  assert.equal(after.pendingCommandId, null);
  assert.equal(after.observedVersion, 5);
  const intent = s.store.intent(CMD);
  assert.ok(intent);
  assert.equal(intent.state, "conflict");
});

test("발행: 결과를 모르면 초안은 잠긴 채 result-unknown 으로 남는다", async (t) => {
  reset();
  const { s } = await unknownPublish();
  keep(t, s.root);
  const after = s.store.read(KEY);
  assert.ok(after);
  assert.equal(after.state, "result-unknown");
  assert.equal(after.pendingCommandId, CMD);
  const intent = s.store.intent(CMD);
  assert.ok(intent);
  assert.equal(intent.state, "unknown");
});

test("발행: 개정이 다르면 보내지 않고 실패다", async (t) => {
  reset();
  const s = setup(makeDraft(), BASE_XML);
  keep(t, s.root);
  const probe = { count: 0 };
  const client = clientOver(mirrorOf(), {
    updatePage: async (input) => {
      probe.count += 1;
      return { written: true, value: { id: PAGE_ID, version: input.version } };
    },
  });
  const result = await s.publisher.publish(s.ctx({ client }), {
    docKey: KEY,
    commandId: CMD,
    expectedRevision: 2,
  });
  assert.equal(result.state, "failed");
  assert.equal(probe.count, 0);
  assert.equal(s.store.intent(CMD), null);
  const draft = s.store.read(KEY);
  assert.ok(draft);
  assert.equal(draft.state, "editing");
  assert.equal(draft.revision, 3);
});

test("발행: 검사가 하나라도 남으면 보내지 않는다", async (t) => {
  reset();
  const s = setup(makeDraft(), BASE_XML);
  keep(t, s.root);
  const probe = { count: 0 };
  const client = clientOver(mirrorOf(), {
    updatePage: async (input) => {
      probe.count += 1;
      return { written: true, value: { id: PAGE_ID, version: input.version } };
    },
  });
  const result = await s.publisher.publish(s.ctx({ enabled: false, client }), {
    docKey: KEY,
    commandId: CMD,
    expectedRevision: 3,
  });
  assert.equal(result.state, "failed");
  assert.equal(result.detail, "publish-disabled");
  assert.equal(probe.count, 0);
  assert.equal(s.store.intent(CMD), null);
});

test("발행: 1.0 이상인데 단계가 없으면 보내지 않고 실패다", async (t) => {
  reset();
  const blocks = baseBlocks(BASE_XML).map((block) =>
    block.id === "b1" ? { ...block, xml: "<p>고친 첫 문단</p>" } : block,
  );
  const s = setup(
    makeDraft({ blocks, title: "로그인 화면 v1.0", baseTitle: "로그인 화면 v1.0" }),
    BASE_XML,
  );
  keep(t, s.root);
  const probe = { count: 0 };
  const client = clientOver(mirrorOf(), {
    updatePage: async (input) => {
      probe.count += 1;
      return { written: true, value: { id: PAGE_ID, version: input.version } };
    },
  });
  const result = await s.publisher.publish(s.ctx({ client }), {
    docKey: KEY,
    commandId: CMD,
    expectedRevision: 3,
  });
  assert.equal(result.state, "failed");
  assert.ok(result.detail.includes("단계"));
  assert.equal(probe.count, 0);
  assert.equal(s.store.intent(CMD), null);
});

test("발행: 새 문서는 만들어지고 초안에 페이지가 연결된다", async (t) => {
  reset();
  const draft = makeDraft({
    docKey: NEW_KEY,
    kind: "new",
    pageId: null,
    baseVersion: null,
    baseTitle: null,
    title: "새 기획 문서",
  });
  const s = setup(draft, null);
  keep(t, s.root);
  const before = s.store.read(NEW_KEY);
  assert.ok(before);
  const body = composeDraftBody(before);
  const client = clientOver(mirrorOf(), {
    createPage: async (input) => ({
      written: true,
      value: { id: "777", version: 1, title: input.title },
    }),
  });
  const result = await s.publisher.publish(s.ctx({ client }), {
    docKey: NEW_KEY,
    commandId: CMD,
    expectedRevision: 3,
  });
  assert.equal(result.state, "applied");
  assert.equal(result.pageId, "777");
  const after = s.store.read(NEW_KEY);
  assert.ok(after);
  assert.equal(after.pageId, "777");
  assert.equal(after.kind, "new");
  assert.equal(after.baseVersion, 1);
  assert.equal(after.state, "published");
  assert.equal(s.store.readBase(NEW_KEY), body);
  const intent = s.store.intent(CMD);
  assert.ok(intent);
  assert.equal(intent.kind, "create");
  assert.equal(intent.parentId, "9");
  assert.equal(intent.targetVersion, null);
});

// ————— 재검사 —————

test("재검사: 판과 작성자와 시각이 맞고 본문의 글도 같으면 적용으로 본다", async (t) => {
  reset();
  const { s, mirror } = await unknownPublish();
  keep(t, s.root);
  mirror.version = 5;
  mirror.authorId = ACCOUNT;
  mirror.updatedAt = iso(T0 + 60_000);
  // 원격의 새 판은 내가 보낸 본문이다.
  mirror.storage = s.store.intentBody(CMD) ?? "";
  const result = await s.publisher.recheck(s.ctx({ client: clientOver(mirror) }), CMD);
  assert.equal(result.state, "applied");
  assert.equal(result.version, 5);
  const after = s.store.read(KEY);
  assert.ok(after);
  assert.equal(after.state, "published");
  assert.equal(after.pendingCommandId, null);
  assert.equal(after.baseVersion, 5);
  assert.equal(s.store.readBase(KEY), s.store.intentBody(CMD));
  for (const block of after.blocks) {
    assert.equal(block.baseFingerprint, blockFingerprint(block.xml));
  }
});

test("재검사: 판 · 작성자 · 시각이 맞아도 본문이 다르면 모른 채로 둔다", async (t) => {
  reset();
  const { s, mirror } = await unknownPublish();
  keep(t, s.root);
  mirror.version = 5;
  mirror.authorId = ACCOUNT;
  mirror.updatedAt = iso(T0 + 60_000);
  // 같은 계정이 창 안에 완전히 다른 본문으로 판 5 를 만들었다 — 내가 보낸 것이 아니다.
  mirror.storage = "<h2>남이 쓴 문서</h2><p>전혀 다른 본문이다.</p>";
  const result = await s.publisher.recheck(s.ctx({ client: clientOver(mirror) }), CMD);
  assert.equal(result.state, "unknown");
  assert.equal(result.detail, "원격의 새 판 본문이 보낸 것과 달라 발행 여부를 판정하지 못했다");
  const after = s.store.read(KEY);
  assert.ok(after);
  assert.equal(after.state, "result-unknown");
  assert.equal(after.pendingCommandId, CMD);
  assert.equal(after.baseVersion, 4);
  assert.equal(s.store.readBase(KEY), BASE_XML, "초안의 기준은 그대로다");
  const intent = s.store.intent(CMD);
  assert.ok(intent);
  assert.equal(intent.state, "unknown");
});

test("재검사: 본문이 꼴만 다르면(속성 · 공백 · 엔티티) 적용으로 본다", async (t) => {
  reset();
  const { s, mirror } = await unknownPublish();
  keep(t, s.root);
  const sent = s.store.intentBody(CMD);
  assert.ok(sent);
  mirror.version = 5;
  mirror.authorId = ACCOUNT;
  mirror.updatedAt = iso(T0 + 60_000);
  // Confluence 가 저장하며 바꾸는 꼴 — 속성 · 공백 · 엔티티다. 글은 같다.
  mirror.storage = sent
    .replace("<p>고친 첫 문단</p>", '<p class="x">고친  첫 문단</p>')
    .replace("<h2>로그인 화면 기획</h2>", '<h2 id="h">\n로그인 화면 기획</h2>');
  const result = await s.publisher.recheck(s.ctx({ client: clientOver(mirror) }), CMD);
  assert.equal(result.state, "applied");
  const after = s.store.read(KEY);
  assert.ok(after);
  assert.equal(after.state, "published");
});

test("재검사: 보낸 본문이 남아 있지 않으면 판정하지 않는다", async (t) => {
  reset();
  const { s, mirror } = await unknownPublish();
  keep(t, s.root);
  rmSync(join(s.root, "intents", `${CMD}.body.xml`));
  mirror.version = 5;
  mirror.authorId = ACCOUNT;
  mirror.updatedAt = iso(T0 + 60_000);
  const result = await s.publisher.recheck(s.ctx({ client: clientOver(mirror) }), CMD);
  assert.equal(result.state, "unknown");
  assert.equal(result.detail, "보낸 본문이 남아 있지 않아 발행 여부를 판정하지 못했다");
});

test("재검사: 원격이 아직 기준 판이면 미적용으로 잠금을 푼다", async (t) => {
  reset();
  const { s, mirror } = await unknownPublish();
  keep(t, s.root);
  const result = await s.publisher.recheck(s.ctx({ client: clientOver(mirror) }), CMD);
  assert.equal(result.state, "not-applied");
  const after = s.store.read(KEY);
  assert.ok(after);
  assert.equal(after.state, "editing");
  assert.equal(after.pendingCommandId, null);
  const intent = s.store.intent(CMD);
  assert.ok(intent);
  assert.equal(intent.state, "not-applied");
});

test("재검사: 새 판의 작성자가 다르면 모른 채로 둔다", async (t) => {
  reset();
  const { s, mirror } = await unknownPublish();
  keep(t, s.root);
  mirror.version = 5;
  mirror.authorId = "acc-other";
  mirror.updatedAt = iso(T0 + 60_000);
  const result = await s.publisher.recheck(s.ctx({ client: clientOver(mirror) }), CMD);
  assert.equal(result.state, "unknown");
  const after = s.store.read(KEY);
  assert.ok(after);
  assert.equal(after.state, "result-unknown");
  assert.equal(after.pendingCommandId, CMD);
});

test("재검사: 작성자를 알 수 없으면 모른 채로 둔다", async (t) => {
  reset();
  const { s, mirror } = await unknownPublish();
  keep(t, s.root);
  mirror.version = 5;
  mirror.authorId = null;
  mirror.updatedAt = iso(T0 + 60_000);
  const result = await s.publisher.recheck(s.ctx({ client: clientOver(mirror) }), CMD);
  assert.equal(result.state, "unknown");
});

test("재검사: 새 판이 확인 전에 만들어진 판이면 모른 채로 둔다", async (t) => {
  reset();
  const { s, mirror } = await unknownPublish();
  keep(t, s.root);
  mirror.version = 5;
  mirror.authorId = ACCOUNT;
  mirror.updatedAt = iso(T0 - 10 * 60_000);
  const result = await s.publisher.recheck(s.ctx({ client: clientOver(mirror) }), CMD);
  assert.equal(result.state, "unknown");
});

test("재검사: 새 문서는 읽어 작성자와 본문이 같아야 적용이다", async (t) => {
  reset();
  const s = await unknownCreate();
  keep(t, s.root);
  const mirror = mirrorOf({ id: "777", version: 1, storage: s.store.intentBody(CMD) ?? "" });
  const client = clientOver(mirror, {
    findPagesByTitle: async () => ({
      readable: true,
      value: [
        { id: "777", title: "새 기획 문서", parentId: "9", version: 1, createdAt: iso(T0 + 1) },
      ],
    }),
  });
  const result = await s.publisher.recheck(s.ctx({ client }), CMD);
  assert.equal(result.state, "applied");
  const after = s.store.read(NEW_KEY);
  assert.ok(after);
  assert.equal(after.pageId, "777");
  assert.equal(after.state, "published");
});

test("재검사: 새 문서의 작성자가 다르면 모른 채로 둔다", async (t) => {
  reset();
  const s = await unknownCreate();
  keep(t, s.root);
  const mirror = mirrorOf({
    id: "777",
    version: 1,
    authorId: "acc-other",
    storage: s.store.intentBody(CMD) ?? "",
  });
  const client = clientOver(mirror, {
    findPagesByTitle: async () => ({
      readable: true,
      value: [
        { id: "777", title: "새 기획 문서", parentId: "9", version: 1, createdAt: iso(T0 + 1) },
      ],
    }),
  });
  const result = await s.publisher.recheck(s.ctx({ client }), CMD);
  assert.equal(result.state, "unknown");
  assert.equal(result.detail, "새 문서의 작성자를 가릴 수 없어 발행 여부를 판정하지 못했다");
  const after = s.store.read(NEW_KEY);
  assert.ok(after);
  assert.equal(after.state, "result-unknown");
  assert.equal(after.pageId, null);
});

test("재검사: 새 문서의 본문이 다르면 모른 채로 둔다", async (t) => {
  reset();
  const s = await unknownCreate();
  keep(t, s.root);
  const mirror = mirrorOf({
    id: "777",
    version: 1,
    storage: "<p>남이 같은 제목으로 만든 문서다.</p>",
  });
  const client = clientOver(mirror, {
    findPagesByTitle: async () => ({
      readable: true,
      value: [
        { id: "777", title: "새 기획 문서", parentId: "9", version: 1, createdAt: iso(T0 + 1) },
      ],
    }),
  });
  const result = await s.publisher.recheck(s.ctx({ client }), CMD);
  assert.equal(result.state, "unknown");
  assert.equal(result.detail, "원격의 새 문서 본문이 보낸 것과 달라 발행 여부를 판정하지 못했다");
  const after = s.store.read(NEW_KEY);
  assert.ok(after);
  assert.equal(after.state, "result-unknown");
  assert.equal(after.pageId, null);
});

test("재검사: 새 문서가 없으면 미적용이다", async (t) => {
  reset();
  const s = await unknownCreate();
  keep(t, s.root);
  const result = await s.publisher.recheck(s.ctx({ client: clientOver(mirrorOf()) }), CMD);
  assert.equal(result.state, "not-applied");
  const after = s.store.read(NEW_KEY);
  assert.ok(after);
  assert.equal(after.state, "editing");
});

test("재검사: 같은 제목의 새 문서가 여럿이면 모른 채로 둔다", async (t) => {
  reset();
  const s = await unknownCreate();
  keep(t, s.root);
  const row: TitleRow = {
    id: "777",
    title: "새 기획 문서",
    parentId: "9",
    version: 1,
    createdAt: iso(T0 + 1),
  };
  const client = clientOver(mirrorOf(), {
    findPagesByTitle: async () => ({ readable: true, value: [row, { ...row, id: "778" }] }),
  });
  const result = await s.publisher.recheck(s.ctx({ client }), CMD);
  assert.equal(result.state, "unknown");
});

// ————— 종료 —————

test("종료: 재전송 없이 끝내면 잠금이 풀린다", async (t) => {
  reset();
  const { s } = await unknownPublish();
  keep(t, s.root);
  const result = await s.publisher.close(s.ctx({ client: clientOver(mirrorOf()) }), CMD);
  assert.equal(result.state, "closed-unconfirmed");
  const after = s.store.read(KEY);
  assert.ok(after);
  assert.equal(after.state, "editing");
  assert.equal(after.pendingCommandId, null);
  const intent = s.store.intent(CMD);
  assert.ok(intent);
  assert.equal(intent.state, "closed-unconfirmed");
  const again = await s.publisher.close(s.ctx({ client: null }), CMD);
  assert.equal(again.state, "closed-unconfirmed");
});

// ————— 다시 맞추기 —————

const REBASE_BASE = [
  "<h2>머리말</h2>",
  "<p>양쪽 다 그대로 둔 문단</p>",
  "<p>원격이 고친 문단</p>",
  "<p>내가 고친 문단</p>",
  "<p>둘 다 고친 문단</p>",
  "<p>내가 지우고 원격이 고친 문단</p>",
  "<p>원격이 지운 문단</p>",
  "<p>양쪽 그대로 끝 문단</p>",
].join("\n");

const REBASE_REMOTE = [
  "<h2>머리말</h2>",
  "<p>양쪽 다 그대로 둔 문단</p>",
  "<p>원격이 고친 문단 새 판</p>",
  "<p>내가 고친 문단</p>",
  "<p>둘 다 고친 문단 원격 판</p>",
  "<p>살아난 원격 판</p>",
  "<p>양쪽 그대로 끝 문단</p>",
  "<p>원격이 새로 넣은 문단</p>",
].join("\n");

/** 다시 맞추기의 밑그림 — 원격이 바꾼 문서와 내가 고친 초안을 세팅하고 맞춘 뒤를 돌려준다. */
async function rebaseSetup() {
  const doc = parseStorage(REBASE_BASE);
  const mine = baseBlocks(REBASE_BASE)
    .filter((block) => block.id !== "b5" && block.id !== "b6") // 내가 블록 둘을 지웠다
    .map((block) => {
      if (block.id === "b3") return { ...block, xml: "<p>내가 고친 문단 내 판</p>" };
      if (block.id === "b4") return { ...block, xml: "<p>둘 다 고친 문단 내 판</p>" };
      return block;
    });
  const fresh = newBlockXml({ kind: "paragraph", text: "내가 새로 넣은 문단" });
  assert.ok(fresh.ok);
  const at = mine.findIndex((block) => block.id === "b3") + 1;
  mine.splice(at, 0, {
    id: "naabbccddeeff",
    slot: "main",
    kind: "paragraph",
    xml: fresh.xml,
    baseFingerprint: null,
  });
  const s = setup(makeDraft({ frame: doc.frame, blocks: mine }), REBASE_BASE);
  const mirror = mirrorOf({ version: 7, storage: REBASE_REMOTE });
  const rebased = await s.publisher.rebase(s.ctx({ client: clientOver(mirror) }), KEY);
  return { s, rebased };
}

test("다시 맞추기: 원격 최신본을 새 기준으로 삼고 부딪친 블록을 충돌로 남긴다", async (t) => {
  reset();
  const { s, rebased } = await rebaseSetup();
  keep(t, s.root);
  assert.equal(rebased.state, "conflict");
  assert.equal(rebased.baseVersion, 7);
  assert.equal(rebased.observedVersion, null);
  assert.equal(rebased.baseTitle, mirrorOf().title);
  assert.equal(s.store.readBase(KEY), REBASE_REMOTE);
  const rows = rebased.blocks.map((block) => ({
    id: block.id,
    xml: block.xml,
    theirs: block.theirsXml,
  }));
  assert.deepEqual(rows, [
    { id: "b0", xml: "<h2>머리말</h2>", theirs: undefined },
    { id: "b1", xml: "\n<p>양쪽 다 그대로 둔 문단</p>", theirs: undefined },
    // 원격만 바꾼 블록은 원격을 따른다 — 원문 바이트까지 온다
    { id: "b2", xml: "\n<p>원격이 고친 문단 새 판</p>", theirs: undefined },
    // 나만 바꾼 블록은 내 것을 지킨다
    { id: "b3", xml: "<p>내가 고친 문단 내 판</p>", theirs: undefined },
    // 내 새 블록은 그대로다
    { id: "naabbccddeeff", xml: "<p>내가 새로 넣은 문단</p>", theirs: undefined },
    // 둘 다 바꾼 블록은 충돌이고 원격 원문이 붙는다
    {
      id: "b4",
      xml: "<p>둘 다 고친 문단 내 판</p>",
      theirs: "\n<p>둘 다 고친 문단 원격 판</p>",
    },
    // 내가 지우고 원격이 바꾼 블록은 빈 글의 충돌로 되살아난다
    { id: "b5", xml: "", theirs: "\n<p>살아난 원격 판</p>" },
    // 원격이 지운 블록은 빠지고, 원격이 그대로 둔 블록의 아이디는 원격의 것이다
    { id: "b6", xml: "\n<p>양쪽 그대로 끝 문단</p>", theirs: undefined },
    // 원격이 새로 넣은 블록은 원격 순서의 자리에 들어간다
    { id: "b7", xml: "\n<p>원격이 새로 넣은 문단</p>", theirs: undefined },
  ]);
});

// ————— 고르기 —————

test("고르기: 내 것을 고르면 원격 자리가 비고 충돌이 남는다", async (t) => {
  reset();
  const { s } = await rebaseSetup();
  keep(t, s.root);
  const resolved = await s.publisher.resolve(s.ctx({ client: null }), {
    docKey: KEY,
    blockId: "b4",
    choice: "mine",
  });
  const row = resolved.blocks.find((block) => block.id === "b4");
  assert.ok(row);
  assert.equal(row.xml, "<p>둘 다 고친 문단 내 판</p>");
  assert.equal(row.theirsXml, undefined);
  assert.equal(resolved.state, "conflict");
});

test("고르기: 원격을 고르면 그 원문이 되고 마지막 충돌이 풀리면 편집으로 돌아간다", async (t) => {
  reset();
  const { s } = await rebaseSetup();
  keep(t, s.root);
  const first = await s.publisher.resolve(s.ctx({ client: null }), {
    docKey: KEY,
    blockId: "b4",
    choice: "theirs",
  });
  const row = first.blocks.find((block) => block.id === "b4");
  assert.ok(row);
  assert.equal(row.xml, "\n<p>둘 다 고친 문단 원격 판</p>");
  assert.equal(row.theirsXml, undefined);
  assert.equal(first.state, "conflict");
  const last = await s.publisher.resolve(s.ctx({ client: null }), {
    docKey: KEY,
    blockId: "b5",
    choice: "theirs",
  });
  assert.equal(last.state, "editing");
});

test("고르기: 빈 글을 고르면 블록이 빠진다", async (t) => {
  reset();
  const { s } = await rebaseSetup();
  keep(t, s.root);
  const resolved = await s.publisher.resolve(s.ctx({ client: null }), {
    docKey: KEY,
    blockId: "b5",
    choice: "mine",
  });
  assert.equal(
    resolved.blocks.some((block) => block.id === "b5"),
    false,
  );
  assert.equal(resolved.state, "conflict"); // 아직 b4 가 남았다
  const last = await s.publisher.resolve(s.ctx({ client: null }), {
    docKey: KEY,
    blockId: "b4",
    choice: "mine",
  });
  assert.equal(last.state, "editing");
});

test("고르기: 충돌이 아닌 블록은 고를 수 없다", async (t) => {
  reset();
  const { s } = await rebaseSetup();
  keep(t, s.root);
  await assert.rejects(
    s.publisher.resolve(s.ctx({ client: null }), { docKey: KEY, blockId: "b0", choice: "mine" }),
    /충돌 중인 블록이 아닙니다/,
  );
});

// ————— 발행 뒤 재구성의 회귀(2026-10-23 · 작업 B9) — 넣고 · 빼고 · 옮긴 뒤의 발행 —————

const FIVE_XML = [
  "<h2>합성 재구성의 머리말</h2>",
  "<p>첫 문단이다.</p>",
  "<p>둘째 문단이다.</p>",
  "<ul><li>목록 첫 항이다.</li><li>목록 둘째 항이다.</li></ul>",
  "<p>마지막 문단이다.</p>",
].join("\n");

/**
 * 재구성 시험의 밑그림 — 맨 앞에 새 블록을 넣고, 가운데(둘째 문단)를 지우고, 첫 · 둘째 문단의
 * 자리를 바꾼 초안이다. 발행 뒤의 자리 번호(b0…)는 발행 전의 블록 id 와 전부 어긋난다.
 */
function shuffledFive(): DraftRecord {
  const doc = parseStorage(FIVE_XML);
  const fresh = newBlockXml({ kind: "paragraph", text: "맨 앞의 새 문단이다." });
  assert.ok(fresh.ok);
  const blocks = baseBlocks(FIVE_XML);
  blocks.unshift({
    id: "na11bb22cc33",
    slot: "main",
    kind: "paragraph",
    xml: fresh.xml,
    baseFingerprint: null,
  });
  const first = blocks.findIndex((block) => block.id === "b1");
  const [moved] = blocks.splice(first, 1);
  assert.ok(moved);
  const anchor = blocks.findIndex((block) => block.id === "b2");
  blocks.splice(anchor + 1, 0, moved);
  const gone = blocks.findIndex((block) => block.id === "b2");
  blocks.splice(gone, 1);
  return makeDraft({ frame: doc.frame, blocks });
}

test("발행 뒤 재구성: 넣고 · 빼고 · 옮긴 발행 뒤에 초안은 새 기준의 자리 번호로 다시 선다", async (t) => {
  reset();
  const s = setup(shuffledFive(), FIVE_XML);
  keep(t, s.root);
  const mirror = mirrorOf({ storage: FIVE_XML });
  const result = await s.publisher.publish(s.ctx({ client: clientOver(mirror) }), {
    docKey: KEY,
    commandId: CMD,
    expectedRevision: 3,
  });
  assert.equal(result.state, "applied");
  assert.equal(result.version, 5);
  const after = s.store.read(KEY);
  assert.ok(after);
  assert.equal(after.state, "published");
  // 블록 id 는 새 기준의 자리 번호다 — 넣은 n… 아이디도 옮기기 전의 옛 아이디도 남지 않는다.
  assert.deepEqual(
    after.blocks.map((block) => [block.id, block.kind]),
    [
      ["b0", "paragraph"],
      ["b1", "heading"],
      ["b2", "paragraph"],
      ["b3", "list"],
      ["b4", "paragraph"],
    ],
  );
  // 모든 블록이 발행본 기준과 같다 — 바뀐 블록도 기준에서 빠진 블록도 없다.
  for (const block of after.blocks) {
    assert.equal(block.baseFingerprint, blockFingerprint(block.xml));
  }
  assert.deepEqual(
    after.blocks.map((block) => block.xml),
    parseStorage(mirror.storage).blocks.map((block) => block.xml),
  );
  // 이어지는 미리보기 — 바꿀 것이 없다.
  const preview = await s.publisher.preview(s.ctx({ client: clientOver(mirror) }), KEY);
  assert.deepEqual(preview.blockers, ["nothing-to-publish"]);
  assert.deepEqual(preview.changes, { changed: 0, inserted: 0, deleted: 0, protectedRemoved: [] });
});

test("발행 뒤 재구성: 원격이 저장하며 바꾼 본문이 초안의 바이트다 — 다음 발행에 고치지 않은 블록은 원격 바이트 그대로 나간다", async (t) => {
  reset();
  const s = setup(shuffledFive(), FIVE_XML);
  keep(t, s.root);
  const mirror = mirrorOf({ storage: FIVE_XML });
  // Confluence 가 저장하며 문단마다 local-id 속성을 얹는 꼴 — 글은 같고 바이트는 다르다.
  const reshape = (body: string): string => {
    let seen = 0;
    return body.replace(/<p>/g, () => {
      seen += 1;
      return `<p local-id="r${seen}">`;
    });
  };
  const client = clientOver(mirror, {
    updatePage: async (input) => {
      mirror.version = input.version;
      mirror.title = input.title;
      mirror.storage = reshape(input.storage);
      mirror.updatedAt = iso(clock().getTime());
      mirror.authorId = ACCOUNT;
      return { written: true, value: { id: mirror.id, version: input.version } };
    },
  });
  const result = await s.publisher.publish(s.ctx({ client }), {
    docKey: KEY,
    commandId: CMD,
    expectedRevision: 3,
  });
  assert.equal(result.state, "applied");
  const sent = s.store.intentBody(CMD);
  assert.ok(sent);
  assert.notEqual(mirror.storage, sent); // 원격이 저장하며 꼴을 바꿨다
  const after = s.store.read(KEY);
  assert.ok(after);
  // 초안의 블록 바이트는 원격 본문의 그것이다 — Confluence 가 바꾼 꼴을 그대로 따른다.
  assert.deepEqual(
    after.blocks.map((block) => block.xml),
    parseStorage(mirror.storage).blocks.map((block) => block.xml),
  );
  for (const block of after.blocks) {
    assert.equal(block.baseFingerprint, blockFingerprint(block.xml));
  }
  // 블록 하나만 고친 뒤의 본문 — 나머지 블록은 원격 바이트 그대로 나간다.
  const target = after.blocks[2];
  assert.ok(target);
  const edited = renderBlock(target, { kind: "paragraph", text: "하나만 고쳤다" });
  assert.ok(edited.ok);
  const touched = s.store.save(
    {
      ...after,
      blocks: after.blocks.map((block, index) =>
        index === 2 ? { ...block, xml: edited.xml } : block,
      ),
    },
    after.revision,
  );
  assert.equal(
    composeDraftBody(touched),
    // renderBlock 은 블록의 태그 꼴(속성 · 앞 공백)을 지키고 속 글만 바꾼다 — 나머지는 원격 바이트 그대로다.
    mirror.storage.replace("첫 문단이다.", "하나만 고쳤다"),
  );
});

test("발행 뒤 재구성: 적용 판의 읽기가 막히면 보낸 본문의 자리 번호로 다시 선다", async (t) => {
  reset();
  const s = setup(shuffledFive(), FIVE_XML);
  keep(t, s.root);
  const mirror = mirrorOf({ storage: FIVE_XML });
  let rereadFailed = false;
  const client = fakeClient({
    readPage: async (): Promise<ConfluenceRead<ConfluencePage>> =>
      rereadFailed
        ? { readable: false, reason: "unavailable", detail: "문서 읽기에 실패했습니다" }
        : { readable: true, value: { ...mirror } },
    readDraft: async (): Promise<ConfluenceRead<DraftRead>> => ({
      readable: true,
      value: { status: null, version: null, storage: null },
    }),
    pageOperations: async (): Promise<
      ConfluenceRead<Array<{ operation: string; targetType: string }>>
    > => ({ readable: true, value: [{ operation: "update", targetType: "page" }] }),
    pageAncestors: async (): Promise<ConfluenceRead<string[]>> => ({
      readable: true,
      value: ["9"],
    }),
    findPagesByTitle: async (): Promise<ConfluenceRead<TitleRow[]>> => ({
      readable: true,
      value: [],
    }),
    updatePage: async (
      input: UpdateInput,
    ): Promise<ConfluenceWrite<{ id: string; version: number }>> => {
      mirror.version = input.version;
      mirror.storage = input.storage;
      mirror.updatedAt = iso(clock().getTime());
      mirror.authorId = ACCOUNT;
      rereadFailed = true; // 응답 뒤의 재읽기가 막힌다 — 원격 읽기 실패의 꼴이다
      return { written: true, value: { id: mirror.id, version: input.version } };
    },
  });
  const result = await s.publisher.publish(s.ctx({ client }), {
    docKey: KEY,
    commandId: CMD,
    expectedRevision: 3,
  });
  assert.equal(result.state, "applied");
  const sent = s.store.intentBody(CMD);
  assert.ok(sent);
  // 새 기준은 보낸 본문이다 — 원격을 못 읽었으니.
  assert.equal(s.store.readBase(KEY), sent);
  const after = s.store.read(KEY);
  assert.ok(after);
  assert.deepEqual(
    after.blocks.map((block) => block.id),
    ["b0", "b1", "b2", "b3", "b4"],
  );
  assert.deepEqual(
    after.blocks.map((block) => block.xml),
    parseStorage(sent).blocks.map((block) => block.xml),
  );
  for (const block of after.blocks) {
    assert.equal(block.baseFingerprint, blockFingerprint(block.xml));
  }
});
