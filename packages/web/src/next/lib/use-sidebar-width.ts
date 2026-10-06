import { type PointerEvent, useEffect, useState } from "react";
import { SIDEBAR_WIDTH_BOUNDS } from "../../lib/settings";
import { clampWidth, SIDEBAR_DEFAULT, sidebarBounds, type WidthBounds } from "./shell-metrics";

export interface SidebarWidth {
  /** 지금 그리는 폭 — 창이 좁아 한도에 눌린 값이다. */
  width: number;
  bounds: WidthBounds;
  /** 경계를 끌고 있는가 — 열 전체가 `col-resize` 로 얼어붙는 동안. */
  dragging: boolean;
  /** `Splitter` 에 그대로 펼친다. */
  split: {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
    onNudge: (delta: number) => void;
    onReset: () => void;
  };
}

/**
 * 사이드바 폭의 끌기 · 키보드 조절(2026-10-06). 끄는 동안은 이 훅의 상태만 바꾸고 놓는 순간 한 번
 * 저장한다 — 포인터가 움직일 때마다 설정을 쓰지 않는다. 키보드 한 걸음과 되돌림은 곧바로 저장한다.
 * 저장은 설정의 `layout.sidebarWidth`(null 은 `끌어 본 적 없음` — 기본 폭)로 간다.
 */
export function useSidebarWidth(
  stored: number | null,
  save: (width: number | null) => void,
): SidebarWidth {
  const [width, setWidth] = useState(stored ?? SIDEBAR_DEFAULT);
  const [drag, setDrag] = useState<{ startX: number; startWidth: number } | null>(null);
  // 창이 줄면 상한이 내려온다 — 두 칸이 쓸 자리를 먼저 지킨다.
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const bounds = sidebarBounds(windowWidth, SIDEBAR_WIDTH_BOUNDS);
  const shown = clampWidth(width, bounds);

  return {
    width: shown,
    bounds,
    dragging: drag !== null,
    split: {
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* 이미 떠난 포인터 — 창 안의 끌기는 그대로 된다 */
        }
        setDrag({ startX: event.clientX, startWidth: shown });
      },
      onPointerMove: (event) => {
        if (!drag) return;
        // 단추를 놓은 줄 모르고 이어진 이동(창 밖에서 놓음)은 끌기의 끝이다.
        if (event.buttons === 0) {
          setDrag(null);
          save(shown);
          return;
        }
        setWidth(clampWidth(drag.startWidth + (event.clientX - drag.startX), bounds));
      },
      onPointerUp: (event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (drag) save(shown);
        setDrag(null);
      },
      onNudge: (delta) => {
        const next = clampWidth(shown + delta, bounds);
        setWidth(next);
        save(next);
      },
      onReset: () => {
        setWidth(SIDEBAR_DEFAULT);
        save(null);
      },
    },
  };
}
