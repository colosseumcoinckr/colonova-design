import { useCallback, useEffect, useRef, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import { useDiagnosticsText } from "./use-diagnostics";
import type { ToastNote } from "./use-shell-nav";

/**
 * 도움말 메뉴의 `문제가 생겼어요 — 진단 복사`(2026-10-08 베타 준비 분석) — 데스크톱 메뉴가 신호를 보내면 설정의 개발자용 쪽과
 * 같은 진단 글을 모아 클립보드에 쓰고 토스트 한 줄로 알린다. 셸(NextShell) 바로 아래에 둔다: 막힌 사람이 가장 먼저 만나는
 * 첫 실행의 체크리스트에는 작업 틀(Workspace)이 없어, 작업 틀의 토스트에 달면 그 화면에서는 메뉴가 아무 일도 하지 않는다.
 * 복사가 막히면(창에 초점이 없을 때 따위) 한 번 더 누르라고 말한다.
 */
export function useReportCopy(daemon: Daemon): { toast: ToastNote | null; dismiss: () => void } {
  // 진단 글을 모으는 함수는 상태가 방송될 때마다 새로 생긴다 — 구독은 한 번이라 ref 로 늘 새것을 쥔다.
  const buildReport = useDiagnosticsText(daemon);
  const build = useRef(buildReport);
  build.current = buildReport;
  const [toast, setToast] = useState<ToastNote | null>(null);
  const seq = useRef(0);
  const say = useCallback((text: string) => {
    seq.current += 1;
    setToast({ text, seq: seq.current });
  }, []);
  const dismiss = useCallback(() => setToast(null), []);
  useEffect(() => {
    const bridge = window.colonovaDesignDesktop;
    if (!bridge?.onCopyReport) return;
    return bridge.onCopyReport(() => {
      void (async () => {
        try {
          await navigator.clipboard.writeText(await build.current());
          say(L.help.reportCopied);
        } catch {
          say(L.help.reportFailed);
        }
      })();
    });
  }, [say]);
  return { toast, dismiss };
}
