/**
 * AI 리뷰어의 줄 코멘트 (2026-10-14 사용자 결정) — Codex · Claude 같은 AI 가 요청에 다는 코멘트도 AI 가 반영한다.
 *
 * 봇 행은 목록 읽기가 거른다(PLAN L9 — CI 봇의 말에 AI 가 반응하지 않게). 이 표에 있는 로그인이 쓴 **줄 코멘트의
 * 첫 글**만 그 거름을 지난다. 리뷰 본문 · 요청 코멘트는 지나지 않는다 — 조직 레포에서 확인한 모양(2026-10-14)에서
 * Codex 의 리뷰 본문과 요약 코멘트는 정해진 안내 문구이고, Claude 의 것은 줄 코멘트를 다시 요약한 글이다. 스레드의
 * 답글은 지나지 않는다 — 우리 답장에 AI 리뷰어가 다시 답하면 고리가 된다.
 */

/** 로그인 → 카드와 반영 턴이 부르는 이름. Codex · Claude 는 조직 레포에서 확인했고, 나머지는 널리 쓰는 AI 리뷰어다. */
const AI_REVIEWERS: Readonly<Record<string, string>> = {
  "chatgpt-codex-connector[bot]": "Codex",
  "claude[bot]": "Claude",
  "copilot-pull-request-reviewer[bot]": "Copilot",
  "coderabbitai[bot]": "CodeRabbit",
  "cursor[bot]": "Cursor",
  "gemini-code-assist[bot]": "Gemini",
};

/** 줄 코멘트 행이 AI 리뷰어의 첫 글이면 그 이름, 아니면 null. */
export function aiReviewerOf(row: Record<string, any>): string | null {
  const name = AI_REVIEWERS[String(row.user?.login ?? "")];
  if (name === undefined) return null;
  if (row.in_reply_to_id !== undefined && row.in_reply_to_id !== null) return null;
  return name;
}

/**
 * 봇이 꾸밈에 쓰는 HTML 태그 — Codex 의 배지 · 접힘 · 시각 태그만 걷는다. 아무 `<…>` 나 걷으면 코드의 타입
 * 인자(`Promise<void>`)와 JSX(`<Button />` · `<span>`)가 사라져 AI 가 받는 의견이 코드를 잘못 말한다.
 */
const DECORATION_TAG = /<\/?(?:sub|sup|details|summary|br|relative-time)\b[^>]*>/gi;

/**
 * AI 리뷰 글을 반영 턴에 실을 모양으로 — 배지 그림(`![P2 Badge](…)`)은 `[P2]` 로, 꾸밈 태그와 굵은 글씨 표시는 걷고,
 * 반응을 청하는 꼬리 줄(`Useful? React with 👍 / 👎.`)은 지운다. 첫 글이 커밋 제목(`코멘트 반영 — …`)이 되므로
 * 표시 문자가 남지 않게 한다.
 */
export function aiReviewText(body: string): string {
  return body
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt: string) => {
      const label = alt.replace(/\s*badge\s*$/i, "").trim();
      return label === "" ? "" : `[${label}]`;
    })
    .replace(DECORATION_TAG, "")
    .replace(/\*\*/g, "")
    .replace(/^[ \t]*Useful\? React with .*$/gim, "")
    .replace(/(\S)[ \t]{2,}/g, "$1 ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
