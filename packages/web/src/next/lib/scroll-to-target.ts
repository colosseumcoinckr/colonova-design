/** 2026-11-12 UI 조사 U-194 — 사용자의 동작 줄이기를 따른다. */
export function scrollBehavior(reduced: boolean): ScrollBehavior {
  return reduced ? "auto" : "smooth";
}

export function scrollToTarget(
  target: Pick<Element, "scrollIntoView"> | null,
  options: Omit<ScrollIntoViewOptions, "behavior"> = {},
): void {
  target?.scrollIntoView({
    ...options,
    behavior: scrollBehavior(
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    ),
  });
}
