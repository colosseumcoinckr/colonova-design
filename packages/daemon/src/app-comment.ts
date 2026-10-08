/**
 * 앱이 남긴 코멘트의 표식 (2026-10-07 베타 준비 분석) — 같은 토큰으로 개발자가 직접 단 코멘트와 앱이 남긴
 * 코멘트를 가른다.
 *
 * 앱이 PR · 이슈에 쓰는 글(개발자 알림 · 코멘트 자동 답장 · 사용자의 `답하기` · `한마디` · 반려 이유 청구)은 모두
 * 토큰 주인의 이름으로 올라간다. 옛 감독자는 로그인명이 토큰 주인과 같은 코멘트를 통째로 건너뛰어 되먹임을
 * 막았는데, 개발자가 자기 토큰을 그대로 쓴 연결(초대 파일을 직접 만든 팀)에서는 개발자의 코멘트도 함께 건너뛰어
 * 반영 루프가 조용히 멈췄다. 이제 건너뛰는 것은 「토큰 주인이 썼고 앱이 쓴 글」 뿐이다.
 *
 * 앱이 쓴 글의 표식은 본문 끝의 숨은 HTML 주석 한 줄이다 — GitHub 이 그리지 않으므로 사람은 보지 못하고, 코멘트를
 * 고쳐 쓰는 알림(`[OK] 해결됨 — …`)에서도 살아남는다. 표식을 다는 자리는 GitHub 클라이언트의 쓰기 문 셋
 * (`commentOnIssue` · `replyToPullComment` · `updateIssueComment`) 한 곳이라, 앞으로 코멘트를 쓰는 곳이 늘어도
 * 표식이 빠지지 않는다.
 */

/** 앱이 쓴 코멘트의 표식 — 본문 끝에 한 줄. */
export const APP_COMMENT_MARK = "<!-- colonova-design:app -->";

/** 표식을 찾는 접두 — 뒤에 무엇이 붙어도(이후 판의 종류 이름) 앱의 글이다. */
const APP_COMMENT_PREFIX = "<!-- colonova-design:app";

/** 본문 끝에 표식을 단다 — 이미 있으면 그대로(고쳐 쓰는 코멘트가 표식을 두 번 달지 않는다). */
export function markAppComment(body: string): string {
  return hasAppMark(body) ? body : `${body}\n\n${APP_COMMENT_MARK}`;
}

/** 본문에 앱의 표식이 있는가 — 글이 아닌 값은 아니다. */
export function hasAppMark(body: unknown): boolean {
  return typeof body === "string" && body.includes(APP_COMMENT_PREFIX);
}

/**
 * 표식이 생기기 전의 앱이 남긴 글인가 (열린 요청에 남은 옛 코멘트용) — 문장이 앱만 쓰는 모양일 때만 참이다:
 * 개발자 알림은 `[ColoNova Design] ` 로 열고(해결되면 `[OK] 해결됨 — ` 이 앞에 붙는다), 자동 답장 · 한마디는
 * `— ColoNova Design 이 <이름> 님 대신 남김` 줄로 닫고, 반려 이유 청구는 고정 문장이다. 사람이 우연히 이 모양으로
 * 쓸 일은 없다. 사용자가 `답하기` 로 쓴 옛 글은 가를 단서가 없어 개발자의 말로 읽힌다 — 열린 요청 하나에 한두 줄이고
 * 라운드 한 번을 쓸 뿐이다. 쓰는 곳은 `isOwnAppComment` 뿐이라 토큰 주인이 쓴 글에만 겹쳐 쓴다.
 */
export function looksLikeLegacyAppComment(body: unknown): boolean {
  if (typeof body !== "string") return false;
  const text = body.trim();
  const opened = text.startsWith("[OK] 해결됨 — ") ? text.slice("[OK] 해결됨 — ".length) : text;
  if (opened.startsWith("[ColoNova Design] ") && opened.includes("작업이 막혔습니다")) return true;
  if (
    text === "반려 이유를 남겨 주시면 AI 가 반영해 새 요청으로 다시 보냅니다. — ColoNova Design"
  ) {
    return true;
  }
  const last = text.split(/\r?\n/).findLast((line) => line.trim() !== "") ?? "";
  return /^— ColoNova Design 이 .+ 님 대신 남김$/.test(last.trim());
}

/** 앱이 쓴 글인가 — 표식이 있거나, 표식 이전의 앱이 쓴 모양이다. */
export function appAuthored(body: unknown): boolean {
  return hasAppMark(body) || looksLikeLegacyAppComment(body);
}

/**
 * 감독자가 개발자의 말로 읽지 않을 코멘트인가 — **토큰 주인이 쓴 것 AND 앱이 쓴 것**이다. 토큰 주인이 표식 없이 쓴
 * 글은 개발자의 말이다. `mine` 을 모르면(whoAmI 실패) 아무것도 건너뛰지 않는다 — 옛 규칙과 같다.
 */
export function isOwnAppComment(
  row: { user?: { login?: unknown } | null; body?: unknown },
  mine: string | null,
): boolean {
  if (mine === null || mine === "") return false;
  if (String(row.user?.login ?? "") !== mine) return false;
  return appAuthored(row.body);
}
