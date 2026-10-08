/**
 * 데몬의 첫 시작 — electron 을 모르는 순수 절차라 가짜 서버로 시험한다(`daemon-start.test.ts`).
 * main.ts 가 서버 만들기(`makeServer`)를 넘기고, 이 함수가 포트를 정한다.
 */

/**
 * 저장 포트를 쓸 수 없을 때 임시 포트로 물러나도 되는 실패인가. 점유(EADDRINUSE)와 접근 거부(EACCES)
 * 둘이다 — Windows 는 Hyper-V · WSL · Docker 가 예약한 포트 대역(`netsh int ipv4 show excludedportrange
 * protocol=tcp`)을 EACCES 로 막는데, 그 대역은 재부팅마다 바뀐다. 어제 잘 뜬 저장 포트가 오늘 대역에
 * 들어가면 물러나지 못하는 앱은 시작 실패 상자를 영구히 반복했다(2026-10-07, 베타 준비 분석 — 코드로
 * 확실한 것, 실기 확인은 베타 Windows 세션). 저장 포트가 없으면(처음 실행 · 임시 포트) 물러날 곳이
 * 없으므로 늘 거짓이다.
 */
export function canFallBackToEphemeral(error: unknown, storedPort: number | null): boolean {
  if (storedPort === null) return false;
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
  return code === "EADDRINUSE" || code === "EACCES";
}

/**
 * 저장 포트로 먼저 뜨고, 그 자리를 쓸 수 없으면 임시 포트로 물러난다(`canFallBackToEphemeral`).
 * 그 밖의 실패는 그대로 던진다 — bootApp 이 오류 상자로 바꾼다. 물러난 임시 포트는 호출자가 다시
 * 저장해 다음 실행이 같은 자리로 수렴한다.
 */
export async function startDaemonServer<S extends { start(): Promise<unknown> }>(
  makeServer: (port: number) => S,
  storedPort: number | null,
): Promise<S> {
  let server = makeServer(storedPort ?? 0);
  try {
    await server.start();
  } catch (error) {
    if (!canFallBackToEphemeral(error, storedPort)) throw error;
    server = makeServer(0);
    await server.start();
  }
  return server;
}
