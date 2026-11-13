/**
 * 문서 관리(휴지통 이동 · 복구 · 복제 · 위치 옮기기)의 선로 모양(2026-10-23 · 최종 구현 계획
 * F4 · 작업 D1a). 영구 삭제는 제공하지 않는다 — 휴지통 이동이 지우기의 끝이다(정본 계획 §9).
 * 미발행 초안이 있는 문서는 자동 정리하지 않고, 삭제된 문서를 자동 재생성하지도 않는다.
 */

import { z } from "zod";

/** 문서 관리의 종류 — 휴지통 이동 · 복구 · 복제 · 위치 옮기기. */
export type DocOpKind = "trash" | "restore" | "copy" | "move";

/** 미리보기가 세우는 막는 이유 — 화면은 이유마다 다음 행동을 세운다. */
export type DocOpBlocker =
  | "publish-disabled"
  | "remote-missing"
  | "out-of-scope"
  | "no-permission"
  /** 알림일 뿐 막지는 않는다 — 초안은 사람이 버린다(정본 계획 §9). */
  | "has-draft"
  | "not-trashed-here"
  | "same-parent";

/** 문서 관리 미리보기 — 원격 대상과 자식 영향 범위를 확인한 답(정본 계획 §9). */
export interface DocOpPreview {
  op: DocOpKind;
  pageId: string;
  title: string;
  /** 직접 아이 문서의 수 — 휴지통 이동은 아이까지 같이 간다. 읽지 못하면 null 이다. */
  childCount: number | null;
  /** 이 문서의 미발행 로컬 초안이 있는가 — trash · move 의 알림이다. */
  hasDraft: boolean;
  /** 옮길 · 복제할 부모의 원장 정보 — 부모가 원장에 없으면 null 이다. */
  target: { id: string; type: "page" | "folder"; title: string } | null;
  blockers: DocOpBlocker[];
  checkedAt: string;
}

/** 문서 관리의 결과 — `unknown` 은 적용됐는지 모른다(자동 재전송 없음 — 정본 계획 §9). */
export interface DocOpResult {
  commandId: string;
  op: DocOpKind;
  state: "applied" | "failed" | "unknown";
  /** 복제가 적용되면 새 문서의 id 다. 그 밖의 실패 · 모름은 null 이다. */
  pageId: string | null;
  detail: string;
}

/** 이 앱이 휴지통으로 옮긴 문서 한 줄 — 복구는 이 목록에 있을 때만 열린다. */
export interface DocTrashEntry {
  pageId: string;
  title: string;
  parentId: string | null;
  trashedAt: string;
}

// ---------------------------------------------------------------------------
// 선로 요청의 검사(2026-10-23 · 작업 D1a) — 소켓 입구에서 doc.* 요청의 모양과 한계값을 좁힌다.
// ---------------------------------------------------------------------------

/** 명령의 신원 — messages.ts 의 `withId` 와 같은 모양(응답 상관이자 멱등 키). */
const withId = { id: z.string().min(1) };

/** Confluence 페이지 · 폴더의 id — 숫자 1~20자. */
const pageIdSchema = z.string().regex(/^\d{1,20}$/);

/** 문서 관리 명령의 열쇠 — 소문자 UUID(같은 명령의 재전송이 두 번 쓰지 않게 하는 멱등 키). */
const commandIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

/**
 * 문서 관리 선로의 요청 스키마 — messages.ts 의 클라이언트 합집합 끝에 펼쳐 넣는다.
 * 요청 필드의 한계값은 이 한 곳에 둔다.
 */
export const docOpClientMessageSchemas = [
  z.object({
    ...withId,
    type: z.literal("doc.op.preview"),
    op: z.enum(["trash", "restore", "copy", "move"]),
    pageId: pageIdSchema,
    parentId: pageIdSchema.optional(),
  }),
  z.object({
    ...withId,
    type: z.literal("doc.trash"),
    pageId: pageIdSchema,
    commandId: commandIdSchema,
  }),
  z.object({
    ...withId,
    type: z.literal("doc.restore"),
    pageId: pageIdSchema,
    commandId: commandIdSchema,
  }),
  z.object({
    ...withId,
    type: z.literal("doc.copy"),
    pageId: pageIdSchema,
    commandId: commandIdSchema,
    title: z.string().min(1).max(255),
    parentId: pageIdSchema,
  }),
  z.object({
    ...withId,
    type: z.literal("doc.move"),
    pageId: pageIdSchema,
    commandId: commandIdSchema,
    parentId: pageIdSchema,
  }),
  z.object({ ...withId, type: z.literal("doc.trashed") }),
] as const;
