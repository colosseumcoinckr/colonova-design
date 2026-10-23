import { type LucideIcon, Monitor } from "lucide-react";

/**
 * 홈의 그림 — `ui/icons.tsx` 와 같은 선 굵기 · 크기 규칙. 칸마다 제 파일을
 * 두어 단계들이 한 파일을 함께 고치지 않게 했다(chat/icons.tsx 와 같은 모양). 모두 장식(aria-hidden)이다.
 */
function make(Glyph: LucideIcon, size: number, strokeWidth = 1.8) {
  return function Icon() {
    return <Glyph className="nx-i" size={size} strokeWidth={strokeWidth} aria-hidden="true" />;
  };
}

/** `화면` 시작 카드 머리의 그림 — 기획서 카드의 문서 그림(16px)과 같은 크기다(2026-10-23 화면 전면 재설계 §3.6). */
export const ScreenCardIcon = make(Monitor, 16);
