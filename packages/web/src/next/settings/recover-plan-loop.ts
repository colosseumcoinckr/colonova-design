// 2026-11-12 UI 조사 U-120 — 저장 응답 뒤 방송을 기다리되 조회 실패도 잠금을 끝낸다.
const BROADCAST_WAIT_MS = 1500;
const REFRESH_WAIT_MS = 5000;

export function recoverPlanLoop(refresh: () => Promise<void>, settle: (ok: boolean) => void) {
  let cancelled = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const finish = (ok: boolean) => {
    if (cancelled) return;
    cancelled = true;
    clearTimeout(deadline);
    settle(ok);
  };
  const wait = setTimeout(() => {
    deadline = setTimeout(() => finish(false), REFRESH_WAIT_MS);
    void Promise.resolve()
      .then(refresh)
      .then(
        () => finish(true),
        () => finish(false),
      );
  }, BROADCAST_WAIT_MS);
  return () => {
    cancelled = true;
    clearTimeout(wait);
    clearTimeout(deadline);
  };
}
