import { L } from "../../labels.ts";
import type { PlanCommentRow } from "../plans-list.ts";

/**
 * 문서 코멘트 쓰기의 순수 조립(2026-10-23 · 최종 구현 계획 F4 · 작업 D2b) — 코멘트 줄의 묶음 · 단추 ·
 * 인라인 닻 판정 · 실패의 말 · 글자 수를 잰다. 시험이 src 에서 곧장 읽으므로 구성 요소를 부르지 않고,
 * 문장은 `labels.ts` 를 확장자와 함께 읽는다(doc-actions-model.ts 와 같은 모양).
 */

/** 코멘트의 종류 — 답글이 매달릴 스레드의 자리(문서 아래 · 본문 문장)를 정한다. */
export type CommentKind = "footer" | "inline";

/** 코멘트 명령의 종류 — 적용됨의 알림 한 줄이 문장을 고른다. */
export type CommentOp = "create" | "reply" | "update" | "resolve";

/** 맨 위 줄과 그 답글 — 순서는 받은 순서를 지킨다. */
export interface CommentThread {
  top: PlanCommentRow;
  replies: PlanCommentRow[];
}

/** 줄이 인라인인가 — kind 가 없는 옛 줄은 닻 문장의 유무로 가른다. */
function isInlineRow(row: PlanCommentRow): boolean {
  return row.kind === "inline" || (row.kind === null && row.anchor !== null);
}

/**
 * 코멘트 묶음 — 맨 위 코멘트(부모 없음) 아래에 답글을 들여 놓는다. 부모가 목록에 없는 답글은 바닥글이면
 * 맨 위 줄로 세우고(부모를 잃어도 글은 남는다) 인라인이면 숨긴다(해결된 스레드에 매달린 답글이다).
 */
export function commentThreads(comments: PlanCommentRow[]): CommentThread[] {
  const byId = new Map<string, PlanCommentRow>();
  for (const row of comments) {
    if (row.id !== null) byId.set(row.id, row);
  }

  // 부모를 따라 올라가 스레드의 뿌리 — 목록에 없는 부모에서 멈춘다(도는 부모는 다시 만나지 않게).
  const rootOf = (row: PlanCommentRow): PlanCommentRow => {
    let current = row;
    const seen = new Set<string>();
    while (current.parentId !== null) {
      if (current.id !== null) {
        if (seen.has(current.id)) break;
        seen.add(current.id);
      }
      const parent = byId.get(current.parentId);
      if (parent === undefined) break;
      current = parent;
    }
    return current;
  };

  const threads: CommentThread[] = [];
  const threadOf = new Map<string, CommentThread>();
  for (const row of comments) {
    // 뿌리가 스레드로 서는가 — 부모 없는 줄은 서고, 부모를 잃은 답글은 바닥글이면 서고 인라인이면 숨는다.
    if (rootOf(row) !== row || (row.parentId !== null && isInlineRow(row))) continue;
    const thread: CommentThread = { top: row, replies: [] };
    threads.push(thread);
    if (row.id !== null) threadOf.set(row.id, thread);
  }
  for (const row of comments) {
    const root = rootOf(row);
    if (root === row) continue;
    // 숨은 뿌리(해결된 인라인 스레드)에 매달린 답글도 함께 숨는다.
    const thread = root.id === null ? undefined : threadOf.get(root.id);
    if (thread === undefined) continue;
    thread.replies.push(row);
  }
  return threads;
}

/** 줄마다 설 단추의 종류 — 답글 · 고치기 · 해결 순으로 선다. */
export type CommentAction = "reply" | "edit" | "resolve";

/**
 * 줄마다 설 단추 — 답글은 맨 위 줄만, 고치기는 앱에서 고쳐도 잃는 것이 없는 줄만, 해결은 인라인 맨 위
 * 줄만. id 나 version 이 없는 줄(옛 데몬)에는 아무 단추도 서지 않는다.
 */
export function commentActions(row: PlanCommentRow, top: boolean): CommentAction[] {
  const actions: CommentAction[] = [];
  if (row.id === null || row.kind === null || row.version === null) return actions;
  if (top) actions.push("reply");
  if (row.editable) actions.push("edit");
  if (top && row.kind === "inline") actions.push("resolve");
  return actions;
}

/** 닻 판정이 막힌 이유 — 안내 문장과 붙는다. */
export type InlineAnchorFailReason = "empty" | "multi-block" | "too-long" | "repeated";

/** 닻 판정 — 통과하면 보낼 재료, 막히면 다시 고르게 하는 이유다. */
export type InlineAnchorCheck =
  | { ok: false; reason: InlineAnchorFailReason }
  | { ok: true; selection: string; index: 0 };

/** 닻 문장의 길이 한계 — 선로의 요청 검사와 같은 수다(500자). */
const ANCHOR_MAX = 500;

/** 공백의 꼴을 하나로 — 연속 공백 · 줄바꿈 · nbsp 는 공백 하나다(데몬의 셈과 같은 눈). */
function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 겹치지 않게 센 나온 수 — 데몬의 anchorCount 와 같은 셈법이다. */
function countIn(haystack: string, needle: string): number {
  let count = 0;
  for (
    let at = haystack.indexOf(needle);
    at !== -1;
    at = haystack.indexOf(needle, at + needle.length)
  ) {
    count += 1;
  }
  return count;
}

/**
 * 인라인 닻 판정 — 앞뒤 공백을 벗기고, 줄바꿈이 들었으면 한 문단 안에서 고르게, 500자를 넘으면 짧게
 * 고르게 한다. 본문 글에서 공백의 꼴을 하나로 본 뒤 문장이 겹치지 않게 나온 수가 1이면 통과다. 데몬도
 * 원문에서 다시 세므로 여기서 1이어도 원문이 바뀌면 막힌다.
 */
export function inlineAnchor(bodyText: string, selection: string): InlineAnchorCheck {
  const trimmed = selection.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  if (/[\n\r]/.test(trimmed)) return { ok: false, reason: "multi-block" };
  if (trimmed.length > ANCHOR_MAX) return { ok: false, reason: "too-long" };
  if (countIn(squash(bodyText), squash(trimmed)) !== 1) {
    return { ok: false, reason: "repeated" };
  }
  return { ok: true, selection: trimmed, index: 0 };
}

/** 실패의 말 — 첫째 줄과 작은 둘째 줄. */
export interface CommentFailLine {
  line: string;
  sub: string | null;
}

/**
 * 실패의 말 — 데몬이 보낸 기계 이름을 사람의 말로 바꾼다. 모르는 이름은 실패의 한 줄에 받은 글을 작은
 * 둘째 줄로 보인다(받은 글이 빈 경우 둘째 줄이 없다).
 */
export function commentFailLine(detail: string): CommentFailLine {
  const known = L.comments.reason[detail as keyof typeof L.comments.reason];
  if (known !== undefined) return { line: known, sub: null };
  const text = detail.trim();
  return { line: L.comments.failed, sub: text === "" ? null : text };
}

/** 코멘트 본문의 글자 수 상한 — 선로의 요청 검사와 같은 수다(10,000자). */
const TEXT_MAX = 10000;
/** 남은 수를 보이기 시작하는 수 — 9,000자를 넘으면. */
const TEXT_WARN = 9000;

/** 입력의 글자 수 — 남은 글자 안내와 보낼 수 있음. */
export interface ComposerCount {
  note: string | null;
  sendable: boolean;
}

/**
 * 입력의 글자 수 — 9,000자를 넘으면 남은 수를, 상한을 넘으면 넘은 수를 보인다. 빈 글 · 공백뿐 · 상한
 * 넘음은 보낼 수 없다.
 */
export function composerCount(text: string): ComposerCount {
  if (text.length > TEXT_MAX) {
    return { note: L.comments.countOver(text.length - TEXT_MAX), sendable: false };
  }
  const sendable = text.trim() !== "";
  if (text.length > TEXT_WARN) {
    return { note: L.comments.count(TEXT_MAX - text.length), sendable };
  }
  return { note: null, sendable };
}
