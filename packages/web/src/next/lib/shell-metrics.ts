/**
 * 셸의 칸 폭 계산 — 순수 함수만 산다(단위 시험이 src 에서 곧장 읽는다). 대화 칸 · 미리보기 칸이 줄어들
 * 수 있는 가장 좁은 폭은 사이드바의 상한도 정한다: 사이드바를 넓혀도 두 칸이 이만큼은 남는다.
 */

/** 대화 칸의 가장 좁은 폭(U1). */
export const CHAT_MIN = 320;
/** 미리보기 칸의 가장 좁은 폭 — 이보다 좁으면 화면이 읽히지 않는다. */
export const PREVIEW_MIN = 360;
/** 끌어 바꾸기 전 사이드바의 폭 — CSS(`--nx-side-w` 의 기본값)와 같다. */
export const SIDEBAR_DEFAULT = 264;

export interface WidthBounds {
  readonly min: number;
  readonly max: number;
}

/**
 * 창 폭에 맞춘 사이드바의 한도 — `limits`(설정이 정한 절대 한도) 안에서, 두 칸이 쓸 자리(`CHAT_MIN +
 * PREVIEW_MIN`)를 뺀 만큼까지. 창이 아주 좁아도 아래 한도는 지킨다(그 폭 밑은 서랍이 맡는다).
 * 한도는 인자로 받는다 — 이 파일이 형제 모듈을 부르지 않아야 단위 시험이 src 에서 곧장 읽는다.
 */
export function sidebarBounds(windowWidth: number, limits: WidthBounds): WidthBounds {
  const room = windowWidth - CHAT_MIN - PREVIEW_MIN;
  return { min: limits.min, max: Math.max(limits.min, Math.min(limits.max, room)) };
}

/** 한도 안으로 — 정수 픽셀로 다듬는다. */
export function clampWidth(value: number, bounds: WidthBounds): number {
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, value)));
}
