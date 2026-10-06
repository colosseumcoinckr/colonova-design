import { useEffect, useState } from "react";
import { startOfDay } from "./thread-groups";

/**
 * 지금이 속한 날의 자정(ms) — 자정이 지나면 갈아 끼워 날짜 묶음이 저절로 한 칸씩 밀린다.
 * 자는 동안 지난 자정은 타이머가 놓칠 수 있으니 창이 다시 보일 때도 한 번 맞춰 본다.
 */
export function useToday(): number {
  const [today, setToday] = useState(() => startOfDay(Date.now()));
  useEffect(() => {
    const sync = () =>
      setToday((prev) => (startOfDay(Date.now()) === prev ? prev : startOfDay(Date.now())));
    const timer = window.setTimeout(sync, startOfDay(today, 1) - Date.now() + 1000);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [today]);
  return today;
}
