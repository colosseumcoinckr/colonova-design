import type { ReactNode, RefObject } from "react";
import { L } from "../../labels";
import { CloseIcon } from "../../ui/icons";

/**
 * 문서 판의 서랍 껍데기(2026-10-31 D · 2026-11-12 초안 머리에서도 같은 서랍 — B8) — 코멘트 · 이어진
 * 화면이 읽는 문서와 초안 편집기에서 같은 판으로 열린다(`.nx-plans` 의 오른쪽 가장자리에서 나온다).
 * 닫기는 Esc(서랍 안의 단추에서 올라온 것)와 ✕ 한 길이다.
 */
export function DocDrawer({
  label,
  closeRef,
  onClose,
  children,
}: {
  /** 서랍의 이름 — 머리의 제목과 낭독 이름이 같다(`코멘트 N개` · `이어진 화면`). */
  label: string;
  /** 열리면 초점이 오는 닫기 단추의 참조. */
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: 안의 단추에서 올라온 Esc로 서랍을 접는다
    <aside
      className="nx-pl-drawer"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      aria-label={label}
    >
      <header className="nx-pl-drawer-hd">
        <h3>{label}</h3>
        <button
          type="button"
          className="nx-ibtn nx-ibtn--sm"
          aria-label={L.plans.drawerClose}
          ref={closeRef}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="nx-pl-drawer-body">{children}</div>
    </aside>
  );
}
