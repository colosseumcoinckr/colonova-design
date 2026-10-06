import { Check, Copy, ExternalLink, Globe, type LucideIcon } from "lucide-react";

/**
 * 기능 제안 판의 그림 — `next/ui/icons.tsx` 와 같은 규칙(장식이라 aria-hidden, 이름은 단추가 단다).
 * 이 판에서만 쓰는 것을 여기에 둔다(2026-10-06 겹판 손질).
 */
function make(Glyph: LucideIcon, size: number, strokeWidth = 1.8) {
  return function Icon() {
    return <Glyph className="nx-i" size={size} strokeWidth={strokeWidth} aria-hidden="true" />;
  };
}

/** 공개 고지의 앞 그림 — 누구나 본다는 뜻. */
export const GlobeIcon = make(Globe, 16);
/** 브라우저가 열리는 링크의 꼬리. */
export const LinkOutIcon = make(ExternalLink, 13, 2);
export const CopyIcon = make(Copy, 13, 2);
/** 세 점 안의 작은 체크 — 지난 단계. */
export const StepCheckIcon = make(Check, 10, 3.4);
/** 접수의 순간의 큰 체크 — 선이 그려지는 모션은 CSS 가 path 에 건다. */
export const BigCheckIcon = make(Check, 28, 2.6);
