/** 2026-11-12 UI 조사 U-131 · U-196 — 팝 · 모달 · 영역 이동의 공통 초점 후보. */
export const FOCUSABLE =
  'a[href], button, input, select, textarea, details > summary, [tabindex]:not([tabindex="-1"])';

export function visibleFocusable(element: HTMLElement, tabStop = true): boolean {
  return (
    (!tabStop || element.tabIndex >= 0) &&
    !element.matches(':disabled, [disabled], [aria-disabled="true"]') &&
    !element.closest('[inert], [hidden], [aria-hidden="true"]') &&
    element.getClientRects().length > 0 &&
    !["hidden", "collapse"].includes(getComputedStyle(element).visibility)
  );
}

export function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) =>
    visibleFocusable(element),
  );
}

/** autoFocus 로 들어온 초점을 지킨다. 명시한 처음 초점만 그보다 앞선다. */
export function seedModalFocus(panel: HTMLElement, initial?: HTMLElement | null): void {
  if (initial && panel.contains(initial) && visibleFocusable(initial, false)) initial.focus();
  else if (!panel.contains(document.activeElement)) panel.focus();
}
