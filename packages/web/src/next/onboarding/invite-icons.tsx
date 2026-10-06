import { AlertTriangle, Check, type LucideIcon, MailOpen, Trash2 } from "lucide-react";

/**
 * 초대 확인판의 그림 — `next/ui/icons.tsx` 와 같은 규칙(장식이라 aria-hidden, 이름은 단추가 단다).
 * 머리의 그림은 단계의 기운(안내 · 성공 · 주의 · 실패)을 따라 바뀐다(2026-10-06 겹판 손질).
 */
function make(Glyph: LucideIcon, size: number, strokeWidth = 1.8) {
  return function Icon() {
    return <Glyph className="nx-i" size={size} strokeWidth={strokeWidth} aria-hidden="true" />;
  };
}

/** 머리 — 초대 파일이 열린다(안내). */
export const InviteMailIcon = make(MailOpen, 17);
/** 머리 — 가져왔다(성공). */
export const InviteCheckIcon = make(Check, 17, 2.6);
/** 머리 — 일부만 · 연결하지 못했다(주의 · 실패). */
export const InviteAlertIcon = make(AlertTriangle, 17);
/** 파일 정리 — OS 휴지통. */
export const TrashIcon = make(Trash2, 15);
/** 결과의 순간의 큰 체크 — 선이 그려지는 모션은 CSS 가 path 에 건다. */
export const BigCheckIcon = make(Check, 28, 2.6);
