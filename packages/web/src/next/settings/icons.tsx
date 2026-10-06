import {
  Bell,
  CircleArrowDown,
  CircleCheck,
  Info,
  Link2,
  type LucideIcon,
  Palette,
  Sparkles,
  TriangleAlert,
  Wrench,
} from "lucide-react";

/**
 * 설정 왼쪽 목록의 그림 — `next/ui/icons.tsx` 와 같은 규칙(굵기 1.8, 장식이므로
 * aria-hidden). 이 대화상자에만 쓰는 것을 여기에 둔다.
 */
function make(Glyph: LucideIcon, size = 16, strokeWidth = 1.8) {
  return function Icon() {
    return <Glyph className="nx-i" size={size} strokeWidth={strokeWidth} aria-hidden="true" />;
  };
}

export const AiPageIcon = make(Sparkles);
export const ThemePageIcon = make(Palette);
export const NotifyPageIcon = make(Bell);
export const ConnectPageIcon = make(Link2);
export const UpdatePageIcon = make(CircleArrowDown);
export const DevPageIcon = make(Wrench);

/** 쪽 위 띠의 그림 — 새 버전 · 확인 못 함 · 최신 · 안내(2026-10-06 설정 손질). 색은 띠가 입힌다. */
export const BandDownIcon = make(CircleArrowDown, 16);
export const BandAlertIcon = make(TriangleAlert, 16);
export const BandOkIcon = make(CircleCheck, 16);
export const BandInfoIcon = make(Info, 16);
