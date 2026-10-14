/**
 * 다음 말 제안(2026-10-14 사용자 요청) — AI 가 답을 마치면 데몬이 이어 물어볼 만한 말 한 문장을
 * 준다(`SessionView.suggestion`, PLAN D99). 빈 입력창에 옅게 띄우고 Tab 이 그 말을 입력창에 넣는다 —
 * 보내지는 않으니 고쳐서 보낸다. 순수 — `next-say.test.ts` 가 src 에서 곧장 읽는다.
 */

export interface GhostInput {
  /** 데몬이 준 제안 — 한 번 뜨고, 보내면 데몬 쪽 보기에서 사라진다. */
  suggestion: string | null | undefined;
  /** 입력창의 글 — 한 글자라도 있으면 제안은 물러난다(옅은 글자는 빈 칸에서만 보인다). */
  text: string;
  /** 첨부나 핀이 담겨 있으면 말할 것이 이미 정해진 길이다. */
  attachments: number;
  pins: number;
  /** AI 가 일하는 동안 — 지난 답에 붙은 제안은 지나간 말이다. */
  running: boolean;
  /** 보낼 수 없는 때(연결이 끊김). */
  locked: boolean;
  /** 사용자가 `esc` 로 숨기거나 보낸 제안 — 같은 말은 다시 뜨지 않는다. */
  dismissed: string | null;
}

/** 지금 입력창에 옅게 띄울 제안 — 띄울 수 없으면 null. */
export function ghostText(input: GhostInput): string | null {
  const text = input.suggestion?.trim();
  if (!text) return null;
  if (input.text !== "" || input.attachments > 0 || input.pins > 0) return null;
  if (input.running || input.locked) return null;
  if (input.dismissed === text) return null;
  return text;
}

/**
 * 제안을 입력창에 넣는 키 — 수정키 없는 Tab 만. ⇧Tab 은 거꾸로 가는 초점의 것이고, ⌥ · ⌃ · ⌘
 * 가 붙은 Tab 은 창 · 앱 전환의 것이다.
 */
export function isAcceptKey(event: {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return (
    event.key === "Tab" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
  );
}
