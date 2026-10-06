import type { ReactNode } from "react";
import { L } from "../../next/labels";

/**
 * The one draggable column boundary. Drawn over the 1px border the
 * adjacent columns already paint. A separator, not a button: pointer drag for
 * the mouse, ←/→ in 24px steps with Enter back to the default (Home/End to the
 * narrowest/widest) for the keyboard, double-click back to the default.
 * `active` is the drag in flight — the only time the boundary shows
 * a line of its own.
 *
 * `side` says which column the width belongs to and therefore which way the
 * boundary hangs off it: the preview sits on the right (the boundary pinned
 * `right: width`, drag leftward to widen); the sidebar sits on the left —
 * mirrored, so the arrow pointing where the boundary actually moves is the
 * one that widens.
 */
export function Splitter({
  side,
  width,
  bounds,
  label,
  active,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onNudge,
  onReset,
}: {
  side: "left" | "right";
  width: number;
  bounds: { readonly min: number; readonly max: number };
  label: string;
  active: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  /** Nudge the column by px; positive means the drag direction (widen). */
  onNudge: (delta: number) => void;
  onReset: () => void;
}): ReactNode {
  return (
    <div
      className={`planner__split planner__split--${side === "right" ? "preview" : "sidebar"}${active ? " planner__split--drag" : ""}`}
      style={side === "right" ? { right: width } : { left: width }}
      role="separator"
      aria-orientation="vertical"
      // 접근 이름에 되돌림 힌트를 붙인다 — 더블클릭만 보면 키보드의 길이 숨는다
      // (2026-10-04 ux-review).
      aria-label={`${label} · ${L.shell.chatWidthReset}`}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={width}
      aria-valuetext={L.shell.pixels(width)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          // Each side widens toward its own outer edge: the preview's boundary
          // travels left, the sidebar's travels right.
          const widens = side === "right" ? "ArrowLeft" : "ArrowRight";
          onNudge(event.key === widens ? 24 : -24);
          event.preventDefault();
        } else if (event.key === "Enter") {
          // 더블클릭의 되돌림을 키보드에도 — role=separator 가 스스로 약속한 조작
          // (2026-10-04 ux-review).
          onReset();
          event.preventDefault();
        } else if (event.key === "Home" || event.key === "End") {
          // Home 은 가장 좁게, End 는 가장 넓게 — 분리봉의 표준 끝값.
          onNudge(event.key === "Home" ? bounds.min - width : bounds.max - width);
          event.preventDefault();
        }
      }}
      onDoubleClick={onReset}
    />
  );
}
