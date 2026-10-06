import { useCallback, useEffect, useRef, useState } from "react";
import { modalCloseMs } from "../onboarding/motion";

/**
 * 겹판이 닫히는 동안의 움직임 — `begin()` 이 `closing` 을 세우고(뿌리에 `--out` 클래스),
 * 열림의 거꾸로가 끝나는 뒤에 `finish` 를 부른다. 움직임을 끈 창은 기다리지 않고 곧바로
 * `finish`. 설정 · 피드백 · 초대 확인판이 각자 복붙하던 타이머를 한 곳으로 모았다
 * (2026-10-06 겹판 손질).
 *
 * `begin()` 은 닫는 중에 다시 불려도 한 번만 닫는다. `finish` 는 매 렌더의 최신 것을 쓴다 —
 * 닫기 직전에 바뀐 상태(저장 안 한 글)를 클로저가 놓치지 않는다.
 */
export function useClosing(finish: () => void): { closing: boolean; begin: () => void } {
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | null>(null);
  const latest = useRef(finish);
  latest.current = finish;
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const begin = useCallback(() => {
    if (timer.current !== null) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    const wait = modalCloseMs(reduced);
    if (wait === 0) {
      latest.current();
      return;
    }
    setClosing(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setClosing(false);
      latest.current();
    }, wait);
  }, []);
  return { closing, begin };
}
