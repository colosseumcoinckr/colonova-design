import { useCallback, useEffect, useRef, useState } from "react";

/** 복사했다는 답이 단추에 머무는 시간 — 정산 줄(`SettleLine`)의 복사 단추와 같은 길이다. */
export const COPIED_MS = 1500;

/**
 * 복사한 뒤의 짧은 답(2026-10-06 겹판 손질) — 단추의 글자가 `복사했어요` 로 바뀌었다가 1.5초 뒤 돌아온다.
 * 옛 문제 문장의 복사 단추는 `복사했어요` 로 영영 남아, 다시 눌러도 달라지는 것이 없었다.
 *
 * `copy(text)` 가 클립보드에 쓰고, 닿으면 `copied` 를 켠다 — 낭독은 부르는 쪽이 `copied` 로 `role="status"` 칸에
 * 문장을 싣는다(보이는 글자가 바뀌어도 낭독기는 모른다). 연달아 눌러도 시간은 마지막 복사부터 센다. 클립보드가
 * 막힌 곳이면 `onFail` 이 불린다(부르는 쪽이 토스트로 말한다).
 */
export function useCopied(
  onFail?: () => void,
  ms: number = COPIED_MS,
): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  const fail = useRef(onFail);
  fail.current = onFail;
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const copy = useCallback(
    (text: string) => {
      const done = () => {
        setCopied(true);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          timer.current = null;
          setCopied(false);
        }, ms);
      };
      // 클립보드가 없는 환경은 던지지 않고 실패로 말한다.
      try {
        void navigator.clipboard.writeText(text).then(done, () => fail.current?.());
      } catch {
        fail.current?.();
      }
    },
    [ms],
  );
  return { copied, copy };
}
