import type { ChatEvent } from "@colonova-design/protocol";
import { readTurn } from "@colonova-design/protocol";

/**
 * AI 가 읽는 턴 글의 꼬리 한 줄 — 사용자가 이 말을 보낼 때 미리보기가 보여 주던 화면(베타 준비 분석
 * 2026-10-07, 베타 가설 ②). 비개발자의 첫 요청은 `이 화면에서 버튼 크게 해 줘` 처럼 맥락을 생략하는데,
 * 보던 화면(`session.send` 의 `viewing`)은 수정 전 사진을 고르는 데만 쓰여서 AI 는 `이 화면` 이 어느
 * 화면인지 몰랐다.
 *
 * 꼬리는 **AI 에게 가는 글에만** 붙는다 — 세션이 CLI 로 말을 내려놓는 자리(`deliver` · `steer`)에서 한
 * 번. 사용자의 말(`HeldSend.text`)은 그대로라서 에코 · 대화 제목 · 보관(커밋) 제목 · 턴 통계 ·
 * 되돌리기 요약은 이 줄을 모른다. 벤더 대화록에는 꼬리가 든 글이 남으므로, 다시 연 대화의 에코는
 * `stripReplayedViewing` 이 한 번 떼어 준다(`session-manager.history`).
 *
 * 경로만 싣는다 — 쿼리와 해시는 떼고(값에 사용자의 것이 섞일 수 있다), 로그 · 턴 통계에는 남기지
 * 않는다(사용자 서비스의 주소 경로라 통계에 싣지 않는 규칙).
 */

/** 꼬리 줄의 머리 — 싣는 쪽과 떼는 쪽이 같은 말을 읽는다. */
const HEAD = "[지금 사용자가 보는 화면: ";
/** 앞의 빈 줄까지 한 덩이로 뗀다 — 꼬리를 붙이던 모양(`글 + 빈 줄 + 꼬리`)의 역이다. */
const LINE = /(?:\n\n)?\[지금 사용자가 보는 화면: [^\]\n]*\]/g;
/** 경로 한 줄의 상한 — 이보다 길면 화면 주소가 아니라 값이 섞인 것으로 보고 싣지 않는다. */
const MAX_PATH_LENGTH = 200;

/**
 * 선로의 `viewing.path` 를 꼬리에 실을 경로로 — 미리보기 안의 경로(`/` 로 시작, 외부 주소 · 빈 값 ·
 * 공백이나 제어 문자가 든 값은 아님)만 통과한다. 꼬리의 `]` 와 헷갈리지 않게 대괄호는 퍼센트로 쓴다.
 */
export function viewingPathOf(viewing: { path: string } | undefined): string | null {
  const path = viewing?.path.split(/[?#]/, 1)[0]?.trim() ?? "";
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (path.length > MAX_PATH_LENGTH || /[\s\p{Cc}]/u.test(path)) return null;
  return path.replace(/\[/g, "%5B").replace(/\]/g, "%5D");
}

/**
 * 사용자의 말 뒤에 보던 화면 한 줄을 붙인다. 붙이지 않는 때:
 * - 보던 화면이 없거나(홈에서 보냄 · 링크 너머 외부 화면 · 미리보기 서버 없음) 경로가 아니다.
 * - 이 턴이 이미 화면을 직접 가리킨다(`pinned` — 핀이 더 정확하다). 기계가 쓴 턴(표식)도 같다.
 * - 말이 비었다(그림만 보냄) — 말이 없는 글의 첫 줄이 꼬리가 되어 제목이 되는 일을 막는다.
 * - 말이 `/` 로 시작한다 — 슬래시 명령의 인자가 꼬리가 된다.
 */
export function withViewingLine(
  text: string,
  viewing: { path: string } | undefined,
  pinned: boolean,
): string {
  if (pinned) return text;
  const path = viewingPathOf(viewing);
  if (path === null) return text;
  if (text.trim() === "" || text.trimStart().startsWith("/")) return text;
  if (readTurn(text).marker !== null) return text;
  return `${text}\n\n${HEAD}${path}]`;
}

/** 글에서 꼬리 줄을 뗀다 — 사용자가 보는 말로 되돌린다. */
export function stripViewingLine(text: string): string {
  return text.replace(LINE, "");
}

/**
 * 다시 연 대화의 재생에서 사용자 말의 꼬리를 뗀다 — 벤더 대화록은 AI 가 받은 글 그대로라, 그대로 두면
 * 말풍선 끝에 `[지금 사용자가 보는 화면: …]` 이 사용자의 말처럼 보인다.
 */
export function stripReplayedViewing(events: ChatEvent[]): ChatEvent[] {
  return events.map((event) =>
    event.kind === "user.echo" && event.text.includes(HEAD)
      ? { ...event, text: stripViewingLine(event.text) }
      : event,
  );
}
