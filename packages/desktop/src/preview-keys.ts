/**
 * 미리보기 키 넘김의 순수 판정(2026-11-12 UI 조사 U-180). electron 을 부르지
 * 않는다 — 시험이 곧장 읽는다(`preview-keys.test.ts`). 실제 붙이는 곳은
 * `preview-view.ts` 의 `before-input-event` 다(D71).
 */

/** 게스트의 `before-input-event` 가 건네는 입력 — Electron `Input` 의 얼굴. */
export interface PreviewKeyInput {
  type: string;
  key: string;
  isComposing: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  control: boolean;
}

/** 앱 창으로 건너가는 키 봉투 — 웹(PreviewFrame)이 같은 모양으로 되살린다. */
export interface PreviewKeyEnvelope {
  key: string;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  control: boolean;
  composing: boolean;
}

/**
 * 넘길 키를 고른다. 못 넘기는 것은 null — 키는 게스트 안에서 끝난다.
 *
 * 조합 중(isComposing)인 키는 어떤 것이든 게스트에 남긴다: 한글 조합을 끊는
 * Esc 가 찍기 · 겹판 닫기로 새어 가는 것을 막는다(U-180). 조합이 아닌
 * Esc 와 웹 지도의 코드(⌘K · ⌘, · ⌘S · ⌘/ · ⌘⇧P · ⌘L)는 예전처럼 넘긴다 —
 * control 은 Windows/Linux 의 ⌘ 자리로 같은 수정자로 본다(D71).
 * 봉투에는 alt 와 조합 여부를 실은다 — 받는 쪽 재생이 잃지 않게(U-180).
 */
export function forwardPreviewKey(input: PreviewKeyInput): PreviewKeyEnvelope | null {
  if (input.type !== "keyDown") return null;
  if (input.isComposing) return null;
  const mod = input.meta || input.control;
  const forward =
    input.key === "Escape" ||
    (mod &&
      (input.key === "k" ||
        input.key === "K" ||
        input.key === "l" ||
        input.key === "L" ||
        input.key === "," ||
        input.key === "/" ||
        input.key === "s" ||
        input.key === "S" ||
        ((input.key === "p" || input.key === "P") && input.shift)));
  if (!forward) return null;
  return {
    key: input.key,
    meta: input.meta,
    shift: input.shift,
    alt: input.alt,
    control: input.control,
    composing: input.isComposing,
  };
}
