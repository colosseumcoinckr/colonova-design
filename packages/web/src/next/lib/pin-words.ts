/**
 * 핀을 보낼 때의 두 가지 한계(2026-10-06 UX 점검) — 둘 다 말없이 지나가던 것이다.
 *
 * - **사진은 앞 여섯 곳까지.** 핀의 찍은 그림은 한 턴에 앞 여섯 장만 함께 간다(데몬이 앞 여섯 장을 카드
 *   썸네일로 쓴다). 일곱째 핀부터는 그림 없이 자리(글자 · 경로 · 좌표)만 가는데, 사용자는 모든 핀에 사진이 붙는 줄
 *   안다 — 핀 줄 아래에서 한 번 말한다.
 * - **말이 없는 핀은 보내지 않는다.** 핀은 어디를 가리키는지만 말하고 무엇을 할지는 문장이 정한다("고쳐 줘"면
 *   고치고 "이게 뭐야?" 면 설명한다). 입력창의 글도 핀 메모도 비어 있으면 AI 는 무엇을 바꿀지 알 길이 없어
 *   한 턴을 되묻는 데 쓴다 — 보내기 전에 한 줄로 묻는 편이 싸다.
 */

/** 한 턴에 그림으로 함께 가는 핀의 수. 일곱째부터는 자리만 간다. */
export const PIN_SHOT_MAX = 6;

/** 그림 없이 가는 핀의 수 — 0 이면 알릴 것이 없다. */
export function pinsBeyondShots(pinCount: number): number {
  return Math.max(0, pinCount - PIN_SHOT_MAX);
}

/** 핀이 있는데 말이 어디에도 없다 — 입력창의 글과 모든 핀 메모가 비었다. */
export function pinsWordless(text: string, pins: ReadonlyArray<{ note: string }>): boolean {
  return pins.length > 0 && text.trim() === "" && pins.every((pin) => pin.note.trim() === "");
}
