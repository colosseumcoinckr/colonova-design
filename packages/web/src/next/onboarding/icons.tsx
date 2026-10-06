import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  FolderOpen,
  Globe,
  type LucideIcon,
  Mail,
  Sparkles,
  Upload,
  Wrench,
  X,
} from "lucide-react";

/**
 * 처음 한 번 · 초대 확인판의 그림 — `next/ui/icons.tsx` 와 같은 규칙(굵기 1.8,
 * 장식이므로 aria-hidden). 이 판에만 쓰는 것을 여기에 둔다.
 */
function make(Glyph: LucideIcon, size: number, strokeWidth = 1.8) {
  return function Icon() {
    return <Glyph className="nx-i" size={size} strokeWidth={strokeWidth} aria-hidden="true" />;
  };
}

export const CloseIcon = make(X, 16, 2);
export const UploadIcon = make(Upload, 20);
export const CopyIcon = make(Copy, 14);
export const AlertIcon = make(AlertTriangle, 13, 1.8);
export const FolderIcon = make(FolderOpen, 14);

// 2026-10-06 온보딩 손질 — 카드 머리의 타일이 입는 그림. 항목의 뜻을 말한다(도구 · AI · 초대).
export const WrenchIcon = make(Wrench, 16);
export const SparklesIcon = make(Sparkles, 16);
export const MailIcon = make(Mail, 16);
/** 로그인이 브라우저에서 돌아오기를 기다리는 동안의 타일 그림. */
export const GlobeIcon = make(Globe, 16);
/** 통과한 타일의 체크 — 통과의 순간에 선이 그려진다(onboarding.css 의 dasharray 24). */
export const TileCheckIcon = make(Check, 16, 2.4);
/** 링 가운데 로고에 붙는 끝의 체크. */
export const SealCheckIcon = make(Check, 12, 3);
/**
 * `초대 파일이 아직 없나요?` · `브라우저가 열리지 않았나요?` 의 접힘 화살 — 펼치면 돈다. 돌리는 것은
 * 그림이 아니라 감싼 span(`nx-ob-caret`)이다: 공용 `.nx-i` 를 건드리면 같은 파일의 다른 `.nx-i`
 * 규칙과 특이성이 엇갈린다.
 */
export function Caret() {
  return (
    <span className="nx-ob-caret">
      <ChevronRight className="nx-i" size={13} strokeWidth={2.2} aria-hidden="true" />
    </span>
  );
}
