/**
 * 문서 코멘트의 선로 모양(2026-10-23 · 최종 구현 계획 F4 · 작업 D2a) — 바닥글 · 인라인 코멘트의
 * 만들기 · 답글 · 수정 · 해결. 코멘트는 정본인 Confluence 에 기록한다(정본 계획 §9). 실사이트
 * 쓰기는 발행 게이트(COLONOVA_DESIGN_CONFLUENCE_PUBLISH=1)가 켜졌을 때만 열린다.
 */

import { z } from "zod";

/** 문서 코멘트 한 번의 결과 — `unknown` 은 적용됐는지 모른다(자동 재전송 없음 — 정본 계획 §9). */
export interface DocCommentResult {
  commandId: string;
  state: "applied" | "failed" | "unknown";
  /** 적용됐을 때의 코멘트 id — 실패 · 모름은 null 이다. */
  commentId: string | null;
  detail: string;
}

// ---------------------------------------------------------------------------
// 선로 요청의 검사(2026-10-23 · 작업 D2a) — 소켓 입구에서 doc.comment.* 요청의 모양과 한계값을 좁힌다.
// ---------------------------------------------------------------------------

/** 명령의 신원 — messages.ts 의 `withId` 와 같은 모양(응답 상관이자 멱등 키). */
const withId = { id: z.string().min(1) };

/** Confluence 페이지의 id — 숫자 1~20자(doc-ops.ts 의 검사와 같은 모양). */
const pageIdSchema = z.string().regex(/^\d{1,20}$/);

/** 문서 코멘트 명령의 열쇠 — 소문자 UUID(같은 명령의 재전송이 두 번 만들지 않게 하는 멱등 키). */
const commandIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

/** 코멘트의 종류 — 바닥글이거나 본문 문장에 얹힌 인라인이다. */
const kindSchema = z.enum(["footer", "inline"]);

/** 코멘트 본문의 맨 글 — 1~10,000자. 마크다운은 해석하지 않는다(작업 D2a). */
const textSchema = z.string().min(1).max(10000);

/** 코멘트 · 답글의 대상 id — Confluence 의 코멘트 id 문자열이다. */
const commentIdSchema = z.string().min(1).max(64);

/**
 * 문서 코멘트 선로의 요청 스키마 — messages.ts 의 클라이언트 합집합 끝에 펼쳐 넣는다.
 * 요청 필드의 한계값은 이 한 곳에 둔다.
 */
export const docCommentClientMessageSchemas = [
  z.object({
    ...withId,
    type: z.literal("doc.comment.create"),
    pageId: pageIdSchema,
    commandId: commandIdSchema,
    text: textSchema,
    /**
     * 사람이 고른 문장 — 있으면 인라인, 없으면 바닥글이다(정본 계획 §9). `selection` 은
     * 원문에서 문장을, `index` 는 같은 문장이 여럿일 때 몇 번째인지 가른다.
     */
    anchor: z
      .object({
        selection: z.string().min(1).max(500),
        index: z.number().int().min(0),
      })
      .optional(),
  }),
  z.object({
    ...withId,
    type: z.literal("doc.comment.reply"),
    pageId: pageIdSchema,
    commandId: commandIdSchema,
    parentId: commentIdSchema,
    kind: kindSchema,
    text: textSchema,
  }),
  z.object({
    ...withId,
    type: z.literal("doc.comment.update"),
    pageId: pageIdSchema,
    commandId: commandIdSchema,
    commentId: commentIdSchema,
    kind: kindSchema,
    /** 코멘트의 현재 판 — 어긋나면 다른 곳에서 바뀐 것이다(정본 계획 §9). */
    version: z.number().int().min(1),
    text: textSchema,
  }),
  // 해결은 인라인의 몫이다 — 바닥글은 스레드 전체가 곧 상태다(정본 계획 §9 · 작업 D2a).
  z.object({
    ...withId,
    type: z.literal("doc.comment.resolve"),
    pageId: pageIdSchema,
    commandId: commandIdSchema,
    commentId: commentIdSchema,
    version: z.number().int().min(1),
    resolved: z.boolean(),
  }),
] as const;
