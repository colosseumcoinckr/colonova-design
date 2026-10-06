/**
 * 설정 껍데기의 순수 판정 — 닫기 보호 · 이름 칸의 Esc · 쪽을 옮기는 방향(2026-10-06 설정 손질 · S0).
 * 시험이 src 에서 곧장 읽는 순수 모듈이라 형제를 부르지 않는다.
 */

export type CloseVerdict = "close" | "save" | "wait";

/**
 * 지금 닫아도 되나 — 이름 칸의 저장이 닫기와 겹치는 일을 가른다. 닫으면서 쏜 저장이 언마운트 뒤에
 * 실패하면 그 실패가 말해질 곳이 없다. 저장이 도는 중이면 끝나길 기다리고(`wait`), 칸에 저장하지
 * 않은 글이 있으면 먼저 저장하고(`save`), 아니면 곧바로 닫는다(`close`). `warned` 는 이 글의 저장이
 * 닫기 때문에 실패해 창을 열어 둔 채 말해 준 적이 있다는 뜻이다 — 그 뒤의 닫기는 그대로 닫는다.
 * 사용자를 닫히지 않는 창에 가두지 않는다. (칸을 벗어나며 쏜 저장의 실패는 말해 준 것이 아니다 —
 * 그 순간 사용자의 눈은 닫기 단추에 있다.)
 */
export function closeGuard(input: {
  dirty: boolean;
  saving: boolean;
  warned: boolean;
}): CloseVerdict {
  if (input.saving) return "wait";
  if (input.dirty && !input.warned) return "save";
  return "close";
}

/** 이름 칸에서 Esc — 바뀐 글이 있으면 첫 Esc 는 되돌리고, 둘째 Esc 가 창을 닫는다. */
export function nameEscape(dirty: boolean): "revert" | "close" {
  return dirty ? "revert" : "close";
}

/**
 * 쪽을 옮길 때 새 쪽이 들어오는 방향 — 목록에서 아래 쪽으로 가면 아래에서 올라오고(`down`), 위
 * 쪽으로 가면 위에서 내려온다(`up`). 같은 쪽 · 모르는 쪽은 움직이지 않는다(`none`).
 */
export function pageDirection<T>(order: readonly T[], from: T, to: T): "down" | "up" | "none" {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0 || a === b) return "none";
  return b > a ? "down" : "up";
}
