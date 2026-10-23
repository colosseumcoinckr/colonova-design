/**
 * 기획서 초안 — AI 와 함께 쓰고 Confluence 에 발행하는 기획 작업의 선로 모양(2026-10-23 · 최종 구현 계획
 * F1 · F2). 공식본은 Confluence 이고 초안은 이 기계의 작업 자료다. 이름의 `draft` 는 요금제의 `plan` 과
 * 섞이지 않게 고른 말이다.
 *
 * 편집 단위는 블록이다. 저장 포맷(XHTML)을 블록으로 나누고, 사람과 AI 는 블록의 투영(BlockView)만
 * 고친다. 투영의 글은 좁은 마크다운(`**굵게**` · `*기울임*` · `` `코드` `` · `[글](주소)`)이고, 투영이
 * 담지 못하는 인라인 조각(매크로 · 멘션 · 이미지 · 코멘트 닻)은 `⟦이름⟧` 토큰으로 자리만 남긴다.
 * 코멘트 닻은 감싼 글을 `⟦c1⟧글⟦/c1⟧` 처럼 연다 · 닫는다. 토큰을 지우면 그 조각을 지우는 것이다.
 *
 * 프로토콜 판은 올리지 않는다 — 요청은 선택적으로 더하고, 옛 웹은 모르는 방송을 흘린다.
 */

import { z } from "zod";

/** 초안의 열쇠 — 기존 문서는 `p-<페이지 id>`, 새 문서는 `n-<32자 소문자 16진>`. 경로에도 쓰여 모양을 좁힌다. */
export const DRAFT_KEY_PATTERN = /^(?:p-\d{1,20}|n-[0-9a-f]{32})$/;

export function isDraftKey(value: string): boolean {
  return DRAFT_KEY_PATTERN.test(value);
}

/** 블록의 투영 — 사람과 AI 가 고치는 모양. `preserved` 는 고칠 수 없고 자리만 보인다. */
export type DraftBlockView =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; rows: DraftTableRow[] }
  /** label 은 기계 이름(예: "macro:info", "image", "list:nested", "table:merged") — 웹이 사람의 말로 바꾼다. */
  | { kind: "preserved"; label: string };

export interface DraftTableRow {
  cells: DraftTableCell[];
}

export interface DraftTableCell {
  header: boolean;
  /** 셀 안의 문단은 `\n` 으로 나눈다. 셀 전체를 담지 못하면 셀 글이 토큰 하나다. */
  text: string;
}

/** 블록 한 줄의 처지 — 기준 원문과 같은가, 고쳤는가, 새로 넣었는가, 원격과 부딪쳤는가. */
export type DraftBlockStatus = "same" | "changed" | "new" | "conflict";

export interface DraftBlock {
  id: string;
  view: DraftBlockView;
  /** false 면 보존 전용 — 매크로 · 병합 셀이 있는 표 · 중첩 목록 등(G2 실측 전의 v1 경계). */
  editable: boolean;
  /**
   * 토큰 이름 → 조각의 기계 이름(예: "t1" → "macro:info", "c1" → "comment-anchor"). 사람의 말은 웹이
   * `labels.ts` 에서 고른다 — 데몬은 사용자 문장을 만들지 않는다.
   */
  tokens: Record<string, string>;
  status: DraftBlockStatus;
  /** 충돌일 때 원격 쪽의 투영 — 사람이 고른다. */
  theirs?: DraftBlockView;
}

/**
 * 초안의 처지. `publishing` 은 전송 중(편집 · 채택이 잠긴다), `conflict` 는 원격과 부딪쳐 고를 블록이
 * 남은 상태, `result-unknown` 은 전송 결과를 확인하지 못한 상태(자동 재전송 없음), `published` 는
 * 확인된 발행 뒤, `closed-unconfirmed` 는 사람이 `재전송 없이 종료` 를 고른 상태다.
 */
export type DraftState =
  | "editing"
  | "publishing"
  | "conflict"
  | "result-unknown"
  | "published"
  | "closed-unconfirmed";

export interface DraftParent {
  id: string;
  type: "page" | "folder";
  title: string;
}

/** 업무 단계 표기 — 제목의 `v0.8` 같은 원문 표기. Confluence 정수 판과 다르다. */
export interface DraftStage {
  /** 제목에서 읽은 표기(예: "0.8", "1.01") — 못 읽으면 null. */
  notation: string | null;
  /** 1.0 이상인가 — 발행이 개정 발행이 된다(새 표기와 사유를 사람이 정한다). */
  closed: boolean;
}

/**
 * 제목의 업무 단계 표기를 읽는다 — 마지막 `v<숫자>(.<숫자>)*` 를 쓴다(앞이 글자면 표기가 아니다).
 * 첫 마디가 1 이상이면 CLOSED 이후다(1.0 런칭 스펙 · 1.01+ 개정). 표기는 안내와 추가 확인에만 쓴다.
 */
export function draftStageOf(title: string): DraftStage {
  const matches = [...title.matchAll(/(?:^|[^A-Za-z])[vV](\d+(?:\.\d+)*)/g)];
  const notation = matches.at(-1)?.[1] ?? null;
  if (notation === null) return { notation: null, closed: false };
  const major = Number.parseInt(notation.split(".")[0] ?? "0", 10);
  return { notation, closed: Number.isFinite(major) && major >= 1 };
}

export interface DraftView {
  docKey: string;
  kind: "existing" | "new";
  pageId: string | null;
  site: string;
  title: string;
  baseTitle: string | null;
  /** 편집 기준 판 — 새 문서는 null. 가져오기로 바뀌지 않는다. */
  baseVersion: number | null;
  /** 초안 개정 — 편집 · 채택마다 1 오른다. 바꾸는 요청은 이 값을 기대값으로 싣는다. */
  revision: number;
  state: DraftState;
  blocks: DraftBlock[];
  parent: DraftParent | null;
  stage: DraftStage;
  /** 원격에 기준보다 새 게시본이 있다고 본 판 — 없으면 null. */
  observedVersion: number | null;
  /** 결과를 기다리거나 확인하지 못한 발행 명령 — 없으면 null. */
  pendingCommandId: string | null;
  updatedAt: string;
}

export interface DraftSummary {
  docKey: string;
  pageId: string | null;
  title: string;
  revision: number;
  state: DraftState;
  /** 기준과 다른 블록 수(고침 · 새 블록 · 지움). */
  changedBlocks: number;
  baseVersion: number | null;
  observedVersion: number | null;
  updatedAt: string;
}

/** 사람이 초안을 고치는 한 걸음 — 여러 걸음을 한 요청에 싣고, 하나라도 맞지 않으면 전부 거절한다. */
export type DraftEdit =
  | { type: "set"; blockId: string; view: DraftBlockView }
  | { type: "insert"; afterBlockId: string | null; view: DraftBlockView }
  | { type: "delete"; blockId: string }
  | { type: "move"; blockId: string; afterBlockId: string | null }
  | { type: "revert"; blockId: string }
  | { type: "title"; title: string };

/** AI 에 함께 줄 근거 문서 — 가져온 기획서(페이지 id)와, 필요하면 그 안의 절 머리말. */
export interface DraftRefInput {
  pageId: string;
  sections?: string[];
}

export type DraftOpState = "open" | "adopted" | "rejected" | "stale";

/** AI 변경안의 한 걸음 — 채택하기 전에는 초안에 닿지 않는다. */
export type DraftOp =
  | { opId: string; type: "replace"; blockId: string; view: DraftBlockView; state: DraftOpState }
  | {
      opId: string;
      type: "insert";
      afterBlockId: string | null;
      view: DraftBlockView;
      state: DraftOpState;
    }
  | { opId: string; type: "delete"; blockId: string; state: DraftOpState }
  | { opId: string; type: "title"; title: string; state: DraftOpState };

export interface DraftProposal {
  proposalId: string;
  createdAt: string;
  /** 만들 때의 초안 개정 — 지금 개정과 다르면 채택 때 블록마다 다시 대 본다. */
  draftRevision: number;
  summary: string;
  ops: DraftOp[];
}

export interface DraftReadRef {
  pageId: string;
  title: string;
  version: number | null;
}

export interface DraftMessage {
  messageId: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  proposalId?: string;
  /** 사람이 고른 근거(user) — 보낸 범위가 화면에 남는다. */
  refs?: Array<DraftReadRef & { sections?: string[] }>;
  /** AI 가 범위 안 캐시에서 스스로 찾아 읽은 문서(assistant). */
  reads?: DraftReadRef[];
  error?: string;
}

export interface DraftThread {
  docKey: string;
  threadId: string;
  messages: DraftMessage[];
  proposals: DraftProposal[];
  running: boolean;
}

/** 발행을 막는 이유 — 화면은 이유마다 다음 행동을 세운다. */
export type DraftPublishBlocker =
  | "publish-disabled"
  | "nothing-to-publish"
  | "remote-newer"
  | "remote-draft"
  | "remote-draft-unknown"
  | "remote-missing"
  | "no-permission"
  | "out-of-scope"
  | "conflict-open"
  | "pending-command"
  | "unsupported-change";

export interface DraftPublishPreview {
  docKey: string;
  kind: "update" | "create";
  pageId: string | null;
  title: string;
  titleChanged: boolean;
  parent: DraftParent | null;
  baseVersion: number | null;
  remoteVersion: number | null;
  draftRevision: number;
  changes: { changed: number; inserted: number; deleted: number; protectedRemoved: string[] };
  /** required 면 확인 창이 새 단계 표기와 사유를 받아야 보낸다(1.0 이상 — 개정 발행). */
  stage: { current: string | null; closed: boolean; required: boolean };
  blockers: DraftPublishBlocker[];
  checkedAt: string;
}

export type DraftPublishState =
  | "applied"
  | "conflict"
  | "unknown"
  | "not-applied"
  | "failed"
  | "closed-unconfirmed";

export interface DraftPublishResult {
  commandId: string;
  docKey: string;
  state: DraftPublishState;
  pageId: string | null;
  version: number | null;
  detail: string;
}

/**
 * 화면 작업의 기획 근거 — 스냅샷이 굳은 순간의 문서 · 절 · 판(2026-10-23 · 최종 구현 계획 F3).
 * 작업 중 가져오기가 돌거나 문서를 고쳐도 이 기록은 바뀌지 않고, 제출 때 PR 본문의
 * `### 기획 근거` 절의 재료가 된다. 초안 본문은 실지 않는다.
 */
export interface DraftPlanRef {
  title: string;
  /** 가져온 문서의 페이지 id — 초안에도 기존 공식본이 있으면 채운다. */
  pageId: string | null;
  /** 초안의 열쇠 — 가져온 문서는 null. */
  docKey: string | null;
  /** 공식본을 Confluence 에서 여는 주소 — 새 문서 초안은 null. */
  url: string | null;
  /** 기준 공식본의 판 — 아직 발행하지 않은 새 초안은 null. */
  version: number | null;
  /** 스냅샷 당시의 초안 개정 — 가져온 문서는 null. */
  revision: number | null;
  published: boolean;
  /** 사람이 고른 절의 머리말 — 문서 전체면 빈 목록. */
  sections: string[];
}

/** `draft.snapshot` 의 답 — 입력창 첨부로 붙는 마크다운 한 장과 근거 기록. */
export interface DraftSnapshot {
  attachment: { name: string; mediaType: "text/markdown"; data: string };
  ref: DraftPlanRef;
}

/** `draft.refs` 의 답 한 줄 — 언제 그 근거가 대화에 붙었는가. 제목 · 판 · 절뿐이고 본문은 없다. */
export interface DraftRefEntry {
  at: string;
  ref: DraftPlanRef;
}

/** 초안이 바뀌었다 — 다른 창도 다시 읽는다. */
export interface DraftChangedMessage {
  type: "draft.changed";
  docKey: string;
  revision: number;
  state: DraftState;
}

/** AI 생성의 진행 — 설명은 누적한 마지막 판이 온다. 중단 · 실패한 생성의 변경안은 생기지 않는다. */
export interface DraftAiMessage {
  type: "draft.ai";
  docKey: string;
  threadId: string;
  messageId: string;
  phase: "started" | "text" | "read" | "done" | "failed" | "cancelled";
  text?: string;
  read?: DraftReadRef;
  proposalId?: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// 선로 요청의 검사(2026-10-23 · 최종 구현 계획 F1) — 소켓 입구에서 draft.* 요청의 모양과 한계값을 좁힌다.
// ---------------------------------------------------------------------------

/** 명령의 신원 — messages.ts 의 `withId` 와 같은 모양(응답 상관이자 멱등 키). */
const withId = { id: z.string().min(1) };

/** Confluence 페이지 · 폴더의 id — 숫자 1~20자. */
const pageIdSchema = z.string().regex(/^\d{1,20}$/);

/** 발행 명령의 열쇠 — 소문자 UUID(재전송이 같은 발행을 두 번 하지 않게 하는 멱등 키). */
const commandIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

/** 초안 개정 — 편집 · 채택마다 1 오르는 판. */
const revisionSchema = z.number().int().min(0);

/** 블록의 열쇠 — 기준의 `b<n>` 이나 새 블록의 `n<12자 소문자 16진>`. */
const blockIdSchema = z.string().min(1).max(64);

/** 투영 글의 상한 — 인라인 조각은 토큰 `⟦…⟧` 으로 자리를 지키므로 한 블록의 글은 짧다. */
const blockTextSchema = z.string().max(20_000);

/** 표 셀의 투영 — 셀 안의 문단은 `\n` 으로 나눈다. */
const tableCellSchema = z.object({ header: z.boolean(), text: blockTextSchema });

/** 블록의 투영 — 사람과 AI 가 고치는 모양(종류로 나뉜 합집합). */
const blockViewSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("heading"),
    level: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ]),
    text: blockTextSchema,
  }),
  z.object({ kind: z.literal("paragraph"), text: blockTextSchema }),
  z.object({
    kind: z.literal("list"),
    ordered: z.boolean(),
    items: z.array(blockTextSchema).max(500),
  }),
  z.object({
    kind: z.literal("table"),
    rows: z.array(z.object({ cells: z.array(tableCellSchema).max(50) })).max(500),
  }),
  /** label 은 기계 이름이다 — 사람의 말로 바꾸는 곳은 웹(labels.ts)이다. */
  z.object({ kind: z.literal("preserved"), label: z.string().max(100) }),
]);

/** 사람이 초안을 고치는 한 걸음 — 종류로 나뉜 합집합, 하나라도 어긋나면 요청 전체가 거절된다. */
const editSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set"), blockId: blockIdSchema, view: blockViewSchema }),
  z.object({
    type: z.literal("insert"),
    afterBlockId: blockIdSchema.nullable(),
    view: blockViewSchema,
  }),
  z.object({ type: z.literal("delete"), blockId: blockIdSchema }),
  z.object({
    type: z.literal("move"),
    blockId: blockIdSchema,
    afterBlockId: blockIdSchema.nullable(),
  }),
  z.object({ type: z.literal("revert"), blockId: blockIdSchema }),
  z.object({ type: z.literal("title"), title: z.string().min(1).max(255) }),
]);

/** AI 에 함께 줄 근거 문서 — 가져온 기획서(페이지 id)와 필요하면 그 안의 절 머리말. */
const refInputSchema = z.object({
  pageId: pageIdSchema,
  sections: z.array(z.string().max(200)).max(20).optional(),
});

/** 근거 절의 고름 — 문서 안의 머리말 제목(최대 20개, 각 200자). */
const sectionsSchema = z.array(z.string().max(200)).max(20);

/**
 * 근거 스냅샷(2026-10-23 · 최종 구현 계획 F3) — 가져온 문서(pageId)와 초안(docKey)
 * 중 정확히 하나를 고른다. 답은 입력창 첨부로 붙는 마크다운 한 장이다.
 */
const snapshotSchema = z
  .object({
    ...withId,
    type: z.literal("draft.snapshot"),
    pageId: pageIdSchema.optional(),
    docKey: z.string().regex(DRAFT_KEY_PATTERN).optional(),
    sections: sectionsSchema.optional(),
  })
  .refine((value) => (value.pageId !== undefined) !== (value.docKey !== undefined), {
    message: "pageId 와 docKey 중 정확히 하나를 싣는다",
  });

/**
 * 근거 줄의 요청(2026-10-23 · 최종 구현 계획 F3) — 화면 대화가 지금까지 삼은 근거를
 * 대화 id 로 묻는다. 답은 최근 것이 앞의 `DraftRefEntry[]` 다(상한은 데몬이 정한다).
 */
const refsSchema = z.object({
  ...withId,
  type: z.literal("draft.refs"),
  sessionId: z.string().min(1).max(200),
});

/**
 * 초안 선로의 요청 스키마(공통 계약 §3 표) — messages.ts 의 클라이언트 합집합 끝에 펼쳐 넣는다.
 * 요청 필드의 한계값은 이 한 곳에 둔다.
 */
export const draftClientMessageSchemas = [
  z.object({ ...withId, type: z.literal("draft.list") }),
  z.object({ ...withId, type: z.literal("draft.open"), pageId: pageIdSchema }),
  z.object({
    ...withId,
    type: z.literal("draft.create"),
    title: z.string().min(1).max(255),
    parentId: pageIdSchema,
    parentType: z.enum(["page", "folder"]),
    templatePageId: pageIdSchema.optional(),
  }),
  z.object({
    ...withId,
    type: z.literal("draft.get"),
    docKey: z.string().regex(DRAFT_KEY_PATTERN),
  }),
  z.object({
    ...withId,
    type: z.literal("draft.edit"),
    docKey: z.string().regex(DRAFT_KEY_PATTERN),
    expectedRevision: revisionSchema,
    edits: z.array(editSchema).min(1).max(200),
  }),
  z.object({
    ...withId,
    type: z.literal("draft.discard"),
    docKey: z.string().regex(DRAFT_KEY_PATTERN),
  }),
  z.object({
    ...withId,
    type: z.literal("draft.ask"),
    docKey: z.string().regex(DRAFT_KEY_PATTERN),
    text: z.string().min(1).max(8_000),
    refs: z.array(refInputSchema).max(20),
  }),
  z.object({
    ...withId,
    type: z.literal("draft.cancel"),
    docKey: z.string().regex(DRAFT_KEY_PATTERN),
  }),
  z.object({
    ...withId,
    type: z.literal("draft.thread"),
    docKey: z.string().regex(DRAFT_KEY_PATTERN),
  }),
  z.object({
    ...withId,
    type: z.literal("draft.adopt"),
    docKey: z.string().regex(DRAFT_KEY_PATTERN),
    proposalId: z.string().min(1),
    opIds: z.array(z.string().min(1).max(64)).min(1).max(200),
    expectedRevision: revisionSchema,
  }),
  z.object({
    ...withId,
    type: z.literal("draft.reject"),
    docKey: z.string().regex(DRAFT_KEY_PATTERN),
    proposalId: z.string().min(1),
    opIds: z.array(z.string().min(1).max(64)).max(200).optional(),
  }),
  z.object({
    ...withId,
    type: z.literal("draft.publish.preview"),
    docKey: z.string().regex(DRAFT_KEY_PATTERN),
  }),
  z.object({
    ...withId,
    type: z.literal("draft.publish"),
    docKey: z.string().regex(DRAFT_KEY_PATTERN),
    commandId: commandIdSchema,
    expectedRevision: revisionSchema,
    stage: z
      .object({ notation: z.string().min(1).max(32), reason: z.string().min(1).max(500) })
      .optional(),
  }),
  z.object({ ...withId, type: z.literal("draft.publish.recheck"), commandId: commandIdSchema }),
  z.object({ ...withId, type: z.literal("draft.publish.close"), commandId: commandIdSchema }),
  z.object({
    ...withId,
    type: z.literal("draft.rebase"),
    docKey: z.string().regex(DRAFT_KEY_PATTERN),
  }),
  z.object({
    ...withId,
    type: z.literal("draft.resolve"),
    docKey: z.string().regex(DRAFT_KEY_PATTERN),
    blockId: blockIdSchema,
    choice: z.enum(["mine", "theirs"]),
  }),
  snapshotSchema,
  refsSchema,
] as const;
