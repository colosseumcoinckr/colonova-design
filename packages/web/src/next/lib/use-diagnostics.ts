import { useCallback } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { DEV } from "../labels";
import { diagnosticsText } from "./diagnostics-text";

/**
 * 진단 복사의 글을 지금 모은다(2026-10-07 베타 준비 분석) — 데몬에 요약을 묻고(받지 못하면 마지막 상태로 대신한다),
 * 웹이 아는 것(연결 · 프로토콜 · 준비 단계 · 준비 실패의 종류)을 곁들여 한 덩어리 글로 짠다. 설정의 `개발자용` 쪽과 준비
 * 실패 카드의 `담당자에게 보낼 내용 복사` 가 함께 쓴다. `failureKind` 는 준비 실패 카드에서만 넘긴다(`RepoErrorKind`).
 */
export function useDiagnosticsText(
  daemon: Daemon,
): (failureKind?: string | null) => Promise<string> {
  const { api, status, connection, repo } = daemon;
  const repoPhase = repo?.phase ?? null;
  return useCallback(
    async (failureKind = null) => {
      const summary = await api.diagnosticsSummary().catch(() => null);
      return diagnosticsText(
        {
          at: new Date().toISOString(),
          summary,
          status,
          web: {
            connected: connection === "open",
            protocolVersion: status?.protocolVersion ?? null,
            repoPhase,
            failureKind,
          },
        },
        DEV,
      );
    },
    [api, status, connection, repoPhase],
  );
}
