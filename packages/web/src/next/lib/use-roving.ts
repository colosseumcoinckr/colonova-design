import { type FocusEvent, type KeyboardEvent, useRef, useState } from "react";
import { rovingStop, rovingTarget } from "./roving";

/**
 * 라디오 군의 로빙 탭 순서(2026-10-06 겹판 조사) — 군 전체가 Tab 정지 하나이고, 안에서는
 * ← ↑ → ↓ Home End 로 걷는다. 모델 칩 팝의 AI · 모델 · 생각 시간 세 줄이 같은 손을 쓴다.
 *
 * 쓰는 법: 군을 감싼 상자에 `group` 을, 칸마다 `item(index)` 를 펼친다. Tab 이 닿는 칸은 고른
 * 칸(`selected`)이고, 화살표로 초점을 옮기면 그 칸이 Tab 이 닿는 칸이 된다 — 그래야 Shift+Tab 이
 * 군을 벗어난다. 초점이 군 밖으로 나가면 다시 고른 칸으로 돌아온다.
 *
 * `onStep` 은 화살표로 칸을 옮긴 직후에 불린다. 고른 자리가 곧 초점인 군(AI · 생각 시간 — 팝이
 * 닫히지 않는 가벼운 선택)은 여기서 고르고, 줄을 눌러야 고르는 군(모델 — 고르면 팝이 닫힌다)은
 * 넘기지 않는다: 훑는 것만으로 모델이 바뀌면 안 된다.
 */
export function useRoving<T extends HTMLElement>({
  count,
  selected,
  onStep,
}: {
  /** 군의 칸 수. */
  count: number;
  /** 고른 칸의 차례 — 없으면 -1(첫 칸이 Tab 이 닿는 칸). */
  selected: number;
  onStep?: (index: number) => void;
}) {
  const nodes = useRef<Array<T | null>>([]);
  // 손이 옮겨 둔 칸 — 없으면 고른 칸이 Tab 이 닿는 칸이다.
  const [at, setAt] = useState<number | null>(null);
  const stop = rovingStop(count, selected, at);
  const focusAt = (index: number) => nodes.current[index]?.focus();
  return {
    /** 칸을 차례로 걷어 초점을 옮긴다 — 군 밖(거르는 칸 …)에서 군으로 들어올 때. */
    focusAt,
    /** 군을 감싼 상자에 펼친다. */
    group: {
      onBlur: (event: FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setAt(null);
      },
    },
    /** 칸 하나에 펼친다. */
    item: (index: number) => ({
      ref: (node: T | null) => {
        nodes.current[index] = node;
      },
      tabIndex: index === stop ? 0 : -1,
      onFocus: () => setAt(index),
      onKeyDown: (event: KeyboardEvent<T>) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const to = rovingTarget(event.key, index, count);
        if (to === null) return;
        event.preventDefault();
        focusAt(to);
        onStep?.(to);
      },
    }),
  };
}
