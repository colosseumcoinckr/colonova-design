import { useEffect, useState } from "react";
import { heldPhase, MAKING_HOLD_MS, type MakingPhase } from "./making";

/**
 * 단계 말이 최소 `MAKING_HOLD_MS` 는 산다 — 몇 초 사이에 도구 묶음이 바뀌어도 말이 깜빡이지 않는다. 상태 줄의 알약과
 * 대화 칸의 진행 줄이 같은 규칙을 쓴다(2026-10-06 UX 점검). 시간이 차면 지금의 단계로 곧장 갈아입는다.
 *
 * `on` 이 꺼져 있는 동안은 보이던 말을 얼려 둔다(알약의 체크 600ms 에도 말이 그대로다). 다시 켜질 때는 처음부터
 * 센다 — 지난 턴의 말이 새 턴의 첫 화면에 한 번 비치지 않도록, 켜지는 그 렌더에서 곧장 비운다.
 */
export function useHeldPhase(phase: MakingPhase, on: boolean): MakingPhase {
  const [word, setWord] = useState<{ phase: MakingPhase; at: number } | null>(null);
  const [wasOn, setWasOn] = useState(on);
  if (on !== wasOn) {
    setWasOn(on);
    if (on) setWord(null);
  }
  useEffect(() => {
    if (!on) return;
    setWord((prev) => heldPhase(prev, phase, Date.now()));
  }, [phase, on]);
  useEffect(() => {
    if (!on || word === null || word.phase === phase) return;
    const wait = Math.max(0, MAKING_HOLD_MS - (Date.now() - word.at));
    // 타이머가 1ms 일찍 깨도 시간은 찼다 — 그 시각으로 셈해 말이 다음 바뀜까지 묶이지 않게.
    const timer = window.setTimeout(
      () =>
        setWord((prev) =>
          heldPhase(prev, phase, Math.max(Date.now(), (prev?.at ?? 0) + MAKING_HOLD_MS)),
        ),
      wait,
    );
    return () => window.clearTimeout(timer);
  }, [word, phase, on]);
  return word?.phase ?? phase;
}
