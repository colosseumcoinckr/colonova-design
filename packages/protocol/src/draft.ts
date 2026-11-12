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
import type { DocBlock } from "./doc-view.js";
import { effortLevelSchema } from "./shared.js";

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
  /** 보존 블록의 같은 판 원문을 읽기 전용으로 그린다(2026-11-11 독립 검토 수정). */
  preview?: DocBlock[];
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
  /**
   * 제목이 기준과 다르다(2026-11-12 기획자 체험) — 블록이 그대로여도 발행할 것이 있다. 목록의 초안 점이
   * 바뀐 블록 수만 보고 사라지지 않게 한다. 옛 데몬은 싣지 않는다(선택 필드).
   */
  titleChanged?: boolean;
  baseVersion: number | null;
  observedVersion: number | null;
  updatedAt: string;
  /** 들어갈 자리의 이름(2026-10-31 E) — 아직 Confluence 에 없는 새 문서 초안이 사이드바의 그 자리에 흐린 줄로 서게 한다. */
  parentTitle?: string | null;
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
  /**
   * AI 고침이 바로 초안에 들어간 때(2026-10-31 기획서 칸 개선 2단계 — 채택 없이 바로 반영). 없으면
   * 걸음이 변경안으로 남아 사람이 고르는 몫이다.
   */
  appliedAt?: string;
  /** 바로 반영에서 들어간 걸음 수. */
  appliedOps?: number;
  /** 바로 반영하지 못하고 남은 걸음 수 — 사람이 고치던 블록의 걸음이다. */
  keptOps?: number;
  /** 바로 반영을 되돌릴 수 있는가 — 그 뒤 사람이 고친 블록이 있으면 꺼진다(같이 고치기와 같은 판정). */
  undoable?: boolean;
  /**
   * 화면 요청이 낸 변경안(2026-11-03 A안 1A-1 — 같이 고치기 게이트). 곁줄 카드와 같은 변경안 하나다 — 어느 쪽에서
   * 넣든 걷든 같이 고치기 기록(되돌리기의 재료)이 함께 남는다.
   */
  origin?: "screen";
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
  /**
   * 화면 요청에서 온 말(user) — 같이 고치기(2026-10-30 사용자 결정)가 남긴 기록이다. 글은 그 화면 요청이고, 대화는
   * 「화면 요청에서 같이 고쳤어요」로 그린다.
   */
  origin?: "screen";
  /**
   * 화면 제안 카드(2026-11-02 · 같이 고치기 UX 계획 C8) — 정책을 바꾼 고침이 초안에 들어간 뒤 화면이 옛 규칙이면
   * 답 아래에 선다. 손은 `화면을 기획서대로`(사람이 보낸다)와 `안 받기` 뿐이다 — 되돌리기는 판에 이미 있다.
   */
  mismatch?: { rows: DraftMismatchRow[] };
  /**
   * 화면 제안의 판정이 실패했다(2026-11-03 A안 1A-2 — 조용한 실패 알림). 답 아래에 실패 한 줄과 `다시 시도`
   * (`draft.mismatchRetry`)가 선다. 다시 시도가 카드를 세우거나 같다고 판정하면 이 표시는 걷힌다.
   */
  mismatchFailed?: true;
}

export interface DraftThread {
  docKey: string;
  threadId: string;
  messages: DraftMessage[];
  proposals: DraftProposal[];
  running: boolean;
}

// ————— 판 고르기(2026-10-31 기획서 칸 개선 2단계) — 초안의 지난 판을 읽고 되돌린다 —————

/** 초안 판의 만든 이 — 판 고르기 줄에 사람의 말로 그린다. */
export type DraftRevisionOrigin = "person" | "ai" | "screen" | "system";

/** 초안 판 한 줄 — 문서 판 머리의 판 고르기 목록의 재료. */
export interface DraftRevisionSummary {
  revision: number;
  at: string;
  origin: DraftRevisionOrigin;
  /** 만든 이의 이름 — AI 가 만든 판은 대화 이름이고, 나머지는 null(웹이 종류의 말로 그린다). */
  label: string | null;
  /** 이 판이 기준에서 바꾼 것 — 고침 · 새로 · 지움 수. */
  changes: { changed: number; inserted: number; deleted: number };
  state: DraftState;
}

/** `draft.revision` 의 답 — 옛 판의 읽기 전용 모습. */
export interface DraftRevisionView {
  docKey: string;
  revision: number;
  at: string;
  origin: DraftRevisionOrigin;
  label: string | null;
  title: string;
  blocks: DraftBlock[];
}

// ————— 기획 대화 목록(2026-10-31 기획서 칸 개선 3단계) — 대화가 문서를 옮겨 다닌다 —————

/** 기획 대화 한 줄 — 사이드바의 기획 대화 목록의 재료. */
export interface DraftConversationSummary {
  threadId: string;
  /** 대화의 이름 — 첫 말에서 짓는다(첫 말의 머리). */
  title: string;
  /** 지금 다루는 문서 — 아직 문서에 붙지 않은 대화는 null. */
  docKey: string | null;
  docTitle: string;
  at: string;
  messageCount: number;
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

/** 기획 대화의 열쇠 — 소문자 UUID. 대화 기록 파일의 이름이 되므로 모양을 좁힌다. */
const threadIdSchema = z
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
    /** 이어 가는 대화(2026-10-31 3단계) — 없으면 이 문서의 대화를 이어 받고, null 이면 새 기획 대화를 만든다. */
    threadId: threadIdSchema.nullable().optional(),
    text: z.string().min(1).max(8_000),
    refs: z.array(refInputSchema).max(20),
    /** 기획 AI 의 모델 · 생각 시간(2026-10-26 사용자 요청) — 화면 대화의 칩과 같은 값. 없으면 CLI 기본. */
    model: z.string().min(1).max(200).optional(),
    effort: effortLevelSchema.optional(),
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
    /** 골라 읽는 대화(2026-11-03) — 사이드바 목록의 줄이 옛 대화를 다시 연다. 없으면 이 문서의 최신 대화. */
    threadId: threadIdSchema.optional(),
  }),
  /** 기획 대화의 이름 바꾸기(2026-11-03) — 첫 말의 머리로 지은 자동 제목을 사람이 고친다. 답은 `DraftConversationSummary`. */
  z.object({
    ...withId,
    type: z.literal("draft.threadRename"),
    threadId: threadIdSchema,
    title: z.string().min(1).max(200),
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
  /**
   * 화면 제안 판정의 `다시 시도`(2026-11-03 A안 1A-2) — `mismatchFailed` 가 선 답의 판정을 지금 초안으로 다시 돈다.
   * 답은 `{ ok: true }` — 결과는 대화 갱신 방송으로 온다(답의 `mismatch` 가 서거나 실패 표시가 걷힌다).
   */
  z.object({
    ...withId,
    type: z.literal("draft.mismatchRetry"),
    docKey: z.string().regex(DRAFT_KEY_PATTERN),
    messageId: z.string().min(1).max(200),
  }),
  snapshotSchema,
  refsSchema,
  /**
   * 같이 고친 초안 되돌리기(2026-10-30 사용자 결정 · 같이 고치기 계획 §5) — 화면 요청이 고친 기획서 초안의 블록을
   * 그 전으로 돌린다. 그 뒤 사람이 고친 블록은 그대로 둔다. 답은 `DraftSyncUndoResult`.
   */
  z.object({ ...withId, type: z.literal("draft.syncUndo"), entryId: z.string().uuid() }),
  /**
   * 이어진 기획서가 없던 화면 요청에 문서를 고른다(같이 고치기 계획 §3) — 그 턴의 화면과 문서를 잇고 같이 고치기를
   * 다시 돈다. 결과는 대화의 `plans.synced` 로 온다.
   */
  z.object({
    ...withId,
    type: z.literal("draft.syncPick"),
    sessionId: z.string().min(1).max(200),
    requestId: z.string().min(1).max(200),
    pageId: pageIdSchema,
  }),
  /**
   * 같이 고치기 게이트(2026-11-03 A안 1A-1) — 곁줄 카드 「초안을 고칠까요?」의 `고치기`. 그 요청 · 그 문서의 기다리는
   * 변경안(`pending`)을 초안에 넣고 되돌리기 기록을 남긴다. 결과는 대화의 `plans.synced` 로 다시 온다. 답은 `{ ok: true }`.
   */
  z.object({
    ...withId,
    type: z.literal("draft.syncApply"),
    sessionId: z.string().min(1).max(200),
    requestId: z.string().min(1).max(200),
    docKey: z.string().regex(DRAFT_KEY_PATTERN),
  }),
  /**
   * 같은 카드의 `건너뛰기` — 기다리는 변경안을 걷고 그 문서와 화면의 짝을 기억해 다음부터 연결로는 다시 묻지 않는다.
   * 근거로 보낸 문서는 기억과 상관없이 다시 본다. 답은 `{ ok: true }`.
   */
  z.object({
    ...withId,
    type: z.literal("draft.syncSkip"),
    sessionId: z.string().min(1).max(200),
    requestId: z.string().min(1).max(200),
    docKey: z.string().regex(DRAFT_KEY_PATTERN),
  }),
  /**
   * 같이 고치기 전체가 실패한 카드(`PlanSync.failure`)의 `다시 시도`(2026-11-03 A안 1A-2). 그 요청으로 처음부터 다시
   * 돈다. 답은 `{ ok: true }` — 결과는 `plans.synced` 로 온다.
   */
  z.object({
    ...withId,
    type: z.literal("draft.syncRetry"),
    sessionId: z.string().min(1).max(200),
    requestId: z.string().min(1).max(200),
  }),
  /**
   * 초안 판 목록(2026-10-31 2단계) — 문서 판 머리의 판 고르기가 읽는다. 답은 새것부터의
   * `DraftRevisionSummary[]` 다.
   */
  z.object({
    ...withId,
    type: z.literal("draft.revisions"),
    docKey: z.string().regex(DRAFT_KEY_PATTERN),
  }),
  /** 옛 판의 읽기 전용 모습 — 판 고르기에서 앞 판을 볼 때. */
  z.object({
    ...withId,
    type: z.literal("draft.revision"),
    docKey: z.string().regex(DRAFT_KEY_PATTERN),
    revision: revisionSchema,
  }),
  /**
   * AI 고침 되돌리기(2026-10-31 2단계) — 바로 반영된 변경안의 판 직전으로 돌린다. 그 사이 사람이 고친
   * 블록은 남긴다(같이 고치기의 되돌리기와 같은 판정). 답은 `DraftSyncUndoResult`.
   */
  z.object({
    ...withId,
    type: z.literal("draft.undo"),
    docKey: z.string().regex(DRAFT_KEY_PATTERN),
    proposalId: z.string().min(1),
  }),
  /** 고른 옛 판으로 되돌리기 — 판 고르기의 `이 판으로 되돌리기`. 답은 새 `DraftView`. */
  z.object({
    ...withId,
    type: z.literal("draft.revisionRestore"),
    docKey: z.string().regex(DRAFT_KEY_PATTERN),
    revision: revisionSchema,
  }),
  /** 기획 대화 목록(2026-10-31 3단계) — 사이드바 위 묶음이 읽는다. 답은 `DraftConversationSummary[]`. */
  z.object({ ...withId, type: z.literal("draft.threads") }),
  /** 대화가 다룰 문서를 옮긴다(2026-10-31 3단계) — 문서 판이 그 문서로 따라 간다. */
  z.object({
    ...withId,
    type: z.literal("draft.threadMove"),
    threadId: threadIdSchema,
    docKey: z.string().regex(DRAFT_KEY_PATTERN),
  }),
  /** 기획 대화를 지운다(2026-10-31 3단계) — 이 컴퓨터의 기록만 지우고 초안은 남는다. */
  z.object({ ...withId, type: z.literal("draft.threadDelete"), threadId: threadIdSchema }),
  /**
   * 화면과 맞춰 보기(2026-11-02 · 같이 고치기 UX 계획 C7) — 문서 하나와 지금 화면을 읽어 어긋난 곳을 목록으로
   * 돌려준다. 판정만 돌고 초안 · 화면 어디에도 쓰지 않는다 — 손을 눌렀을 때만 그 방향으로 간다. 답은 `DraftCompareResult`.
   */
  z.object({ ...withId, type: z.literal("draft.compare"), pageId: pageIdSchema }),
  /**
   * 어긋남 카드 안 받기(같은 계획 §2 의 손 하나) — 이 화면 · 문서 짝의 카드를 다시 띄우지 않는다. C1 의 거부
   * 신호와 같은 저장이다(프로젝트 데이터 `plans/`).
   */
  z.object({
    ...withId,
    type: z.literal("draft.compareDecline"),
    pageId: pageIdSchema,
    screenName: z.string().min(1).max(200),
  }),
  /**
   * 같이 고친 기록 도출(같은 계획 C4) — 이 화면 대화에서 같이 고쳐진 문서들. 기획서 탭의 `초안에서 바뀐 곳`
   * 묶음이 읽는다. 답은 `{ docs: DraftSyncDocRow[] }`.
   */
  z.object({
    ...withId,
    type: z.literal("draft.syncDocs"),
    sessionId: z.string().min(1).max(200),
  }),
  /**
   * 이 문서가 같이 고침으로 닿은 화면(같은 계획 C4) — `이 문서의 화면` 서랍이 연결 파일 줄과 함께 보인다.
   * 답은 `{ screens: DraftSyncScreenRow[] }`.
   */
  z.object({ ...withId, type: z.literal("draft.syncScreens"), pageId: pageIdSchema }),
] as const;

/** `draft.syncUndo` 의 답 — 돌린 블록 수와, 사람이 그 뒤 고쳐 둔 블록 수. */
export interface DraftSyncUndoResult {
  restored: number;
  kept: number;
}

// ————— 화면과 맞춰 보기(2026-11-02 · 같이 고치기 UX 계획 C7 · C8) — 어긋남 카드의 재료 —————

/** 어긋남 한 줄 — 한 문서의 한 절 · 한 규칙에서 기획서와 화면의 말이 다르다. */
export interface DraftMismatchRow {
  /** 절 머리 — 규칙이 사는 절. */
  section: string;
  /** 기획서 쪽 말 — 정본은 초안 우선이라 어느 판인지 카드의 출처 줄이 말한다(같은 계획 §2). */
  plan: string;
  /** 화면 쪽 말 — 사람이 보는 모습으로만. */
  screen: string;
  /** 화면의 이름 — 사람이 읽는 제목. */
  screenName: string;
}

/** `draft.compare` 의 답 — 판정만 돌려주고 초안 · 화면 어디에도 쓰지 않는다. */
export interface DraftCompareResult {
  docKey: string | null;
  pageId: string | null;
  title: string;
  /** 기획서 쪽 말을 어느 판에서 읽었는지 — 카드의 출처 줄에 선다. */
  source: string;
  /** 어긋난 줄 — 비면 지금 화면과 같다. */
  rows: DraftMismatchRow[];
  /** 절 상한에 걸려 앞의 절만 봤다는 한 줄 안내 — 아니면 null. */
  note: string | null;
}

/** `draft.syncDocs` 의 답 한 줄 — 이 화면 대화에서 같이 고쳐진 문서. */
export interface DraftSyncDocRow {
  pageId: string | null;
  docKey: string;
  title: string;
  /** 초안에 들어간 걸음 수. */
  changes: number;
  /** 걸음이 닿은 절 머리 — `보기` 가 스크롤 · 하이라이트할 자리(못 찾으면 문서 맨 위). */
  sections: string[];
  at: string;
}

/** `draft.syncScreens` 의 답 한 줄 — 이 문서가 같이 고침으로 닿은 화면. */
export interface DraftSyncScreenRow {
  route: string;
  title: string | null;
  at: string;
}
