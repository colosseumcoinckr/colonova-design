import type { UpdateCheckResult } from "@colonova-design/protocol";
import { useEffect, useRef, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import {
  type AppRowCopy,
  type AppUpdatePhase,
  appRowCopy,
  appSummaryRow,
  type SummaryRow,
  selfUpdateOutcome,
  type UpdateRowCopy,
  type UpdateSummary,
  updateRowCopy,
  updateSummary,
} from "../lib/update-row";

/** 업데이트 쪽의 상태와 손 — 앱 줄의 걸음 · AI 줄 · `지금 확인` · 자동 설치 스위치(2026-10-06 설정 손질 · S7). */
export type AgentId = "claude" | "codex";

export interface AgentUpdateRow {
  id: AgentId;
  label: string;
  /** 깔려 있는가 — 버전을 아는 것만 확인 · 업데이트의 대상이다. */
  installed: boolean;
  copy: UpdateRowCopy;
  /** 업데이트 요청이 닿지 않았을 때의 말. */
  error: string | null;
}

export interface UpdatesModel {
  /** 데스크톱 앱에서만 앱 줄이 선다. */
  hasApp: boolean;
  app: AppRowCopy;
  /** 앱 줄의 실패 — 데스크톱이 돌려준 원문. */
  appError: string | null;
  agents: AgentUpdateRow[];
  summary: UpdateSummary;
  checking: boolean;
  /** 마지막으로 확인이 닿은 시각(ms). */
  lastCheckedAt: number | null;
  checkNow: () => void;
  startApp: () => void;
  restartApp: () => void;
  snoozeApp: () => void;
  runAgent: (id: AgentId) => void;
  auto: { on: boolean; error: string | null; set: (next: boolean) => void };
}

const AGENTS: readonly AgentId[] = ["claude", "codex"];

export function useUpdates(daemon: Daemon): UpdatesModel {
  const status = daemon.status;
  const providers = status?.providers ?? [];
  const desktop = window.colonovaDesignDesktop ?? null;
  const hasApp = Boolean(desktop?.updateCheck);

  // ── 앱 줄 — 쪽을 열자마자 조용히 확인한다(`지금 확인` 을 누르기 전에는 이름만 덩그러니 서 있었다).
  const [appCheck, setAppCheck] = useState<UpdateCheckResult | null>(null);
  const [appProbe, setAppProbe] = useState<"pending" | "done" | "failed">("pending");
  const [appPhase, setAppPhase] = useState<AppUpdatePhase>("idle");
  const [appError, setAppError] = useState<string | null>(null);
  const [snoozed, setSnoozed] = useState(false);

  // ── 확인 — 실패는 「새 버전 없음」과 다른 답이라 따로 센다(2026-10-04 ux-review).
  const [checking, setChecking] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [checkFailedIds, setCheckFailedIds] = useState<readonly string[]>([]);
  // 확인 답이 알려 준 최신 버전 — 상태 방송이 따라올 때까지의 다리라, 「모두 최신이에요」가 한 번 비치지 않게 한다.
  const [replyLatest, setReplyLatest] = useState<Record<string, string>>({});
  const [agentError, setAgentError] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    if (!desktop?.updateCheck) return;
    let live = true;
    desktop
      .updateCheck()
      .then((result) => {
        if (result && typeof result === "object" && "error" in result && result.error) {
          throw new Error(String(result.error));
        }
        if (!live) return;
        setAppCheck(result);
        setAppProbe("done");
        setLastCheckedAt(Date.now());
      })
      .catch(() => {
        if (live) setAppProbe("failed");
      });
    return () => {
      live = false;
    };
  }, [desktop]);

  // 방송이 새 최신 버전을 실어 오면 다리는 내려놓는다.
  const latestSignature = providers
    .map((provider) => `${provider.id}:${provider.latestVersion ?? ""}`)
    .join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: 서명이 바뀔 때만 다리를 걷는다.
  useEffect(() => {
    setReplyLatest({});
  }, [latestSignature]);

  const installedIds = AGENTS.filter((id) =>
    providers.some((provider) => provider.id === id && provider.version),
  );

  const agents: AgentUpdateRow[] = AGENTS.map((id) => {
    const provider = providers.find((entry) => entry.id === id);
    const state = status?.agentUpdates?.[id];
    const copy = updateRowCopy(
      {
        id,
        version: provider?.version ?? null,
        latestVersion: replyLatest[id] ?? provider?.latestVersion ?? null,
        ...(state ? { phase: state.phase, at: state.at } : {}),
        ...(state?.version ? { versionAfter: state.version } : {}),
        ...(state?.detail ? { detail: state.detail } : {}),
      },
      L.update,
    );
    return {
      id,
      label: provider?.label ?? id,
      installed: Boolean(provider?.version),
      copy,
      error: agentError?.id === id ? agentError.text : null,
    };
  });

  const canSelfUpdate =
    (desktop?.platform === "darwin" || desktop?.platform === "win32") &&
    Boolean(appCheck?.url && appCheck.sha256);
  const app = appRowCopy(
    {
      phase: appPhase,
      probe: appProbe,
      check: appCheck
        ? { updateAvailable: appCheck.updateAvailable, version: appCheck.version }
        : null,
      canSelfUpdate,
      snoozed,
      failed: appError !== null && appPhase === "idle",
    },
    { ...L.update, downloading: L.onboarding.installSteps.download },
  );

  const rows: SummaryRow[] = [
    ...(hasApp ? [appSummaryRow(app.state)] : []),
    ...agents.filter((row) => row.installed).map((row): SummaryRow => row.copy.state),
  ];
  const checkFailed = checkFailedIds.length + (hasApp && appProbe === "failed" ? 1 : 0);
  const summary = updateSummary({
    checking: checking || (hasApp && appProbe === "pending"),
    rows,
    checkFailed,
  });

  const checkNow = async () => {
    if (checking) return;
    setChecking(true);
    const failedIds: string[] = [];
    const found: Record<string, string> = {};
    let reached = 0;
    const jobs: Array<Promise<void>> = installedIds.map((id) =>
      daemon.api
        .agentUpdate(id, true)
        .then((reply) => {
          reached += 1;
          if (reply.latestVersion) found[id] = reply.latestVersion;
        })
        .catch(() => {
          failedIds.push(id);
        }),
    );
    if (desktop?.updateCheck) {
      jobs.push(
        desktop
          .updateCheck()
          .then((result) => {
            if (result && typeof result === "object" && "error" in result && result.error) {
              throw new Error(String(result.error));
            }
            setAppCheck(result);
            setAppProbe("done");
            reached += 1;
          })
          .catch(() => {
            // 실패한 재확인은 낡은 답을 부정한다 — 「최신」이 옆에 남지 않게 확인 못 함으로 되돌린다.
            setAppCheck(null);
            setAppProbe("failed");
          }),
      );
    }
    await Promise.all(jobs);
    setReplyLatest((prev) => ({ ...prev, ...found }));
    setCheckFailedIds(failedIds);
    if (reached > 0) setLastCheckedAt(Date.now());
    setChecking(false);
  };

  const startApp = async () => {
    if (!desktop?.selfUpdate || appPhase !== "idle") return;
    setAppError(null);
    setSnoozed(false);
    setAppPhase("downloading");
    try {
      const outcome = selfUpdateOutcome(await desktop.selfUpdate(), "start");
      setAppPhase(outcome.phase);
      setAppError(outcome.error);
    } catch (error) {
      setAppPhase("idle");
      setAppError(error instanceof Error ? error.message : String(error));
    }
  };

  // 준비가 끝난 뒤의 누름이 곧 재시작 동의다 — 이름 있는 단추(`지금 다시 시작`)로만 닿는다.
  const restartApp = async () => {
    if (!desktop?.selfUpdate || appPhase !== "ready") return;
    setAppError(null);
    setAppPhase("restarting");
    try {
      const outcome = selfUpdateOutcome(await desktop.selfUpdate(), "restart");
      setAppPhase(outcome.phase);
      setAppError(outcome.error);
    } catch (error) {
      setAppPhase("ready");
      setAppError(error instanceof Error ? error.message : String(error));
    }
  };

  const runAgent = (id: AgentId) => {
    setAgentError(null);
    void daemon.api
      .agentUpdate(id)
      .catch((error) =>
        setAgentError({ id, text: error instanceof Error ? error.message : String(error) }),
      );
  };

  // ── 자동 설치 스위치 — 방송을 기다리지 않고 먼저 움직이고, 실패하면 되돌린다.
  const statusAuto = status?.agentAutoUpdate ?? true;
  const [autoPending, setAutoPending] = useState<boolean | null>(null);
  const [autoError, setAutoError] = useState<string | null>(null);
  const autoTimer = useRef<number | null>(null);
  useEffect(() => {
    if (autoPending !== null && statusAuto === autoPending) setAutoPending(null);
  }, [statusAuto, autoPending]);
  useEffect(
    () => () => {
      if (autoTimer.current !== null) window.clearTimeout(autoTimer.current);
    },
    [],
  );
  const setAuto = (next: boolean) => {
    if (autoTimer.current !== null) window.clearTimeout(autoTimer.current);
    setAutoError(null);
    setAutoPending(next);
    void daemon.api
      .machineSet(undefined, next)
      // 방송이 곧 따라오지만, 오지 않아도 낙관 값이 영원히 서 있지 않게 한참 뒤에 내려놓는다.
      .then(() => {
        autoTimer.current = window.setTimeout(() => setAutoPending(null), 4000);
      })
      .catch(() => {
        setAutoPending(null);
        setAutoError(L.update.autoFailed);
      });
  };

  return {
    hasApp,
    app,
    appError,
    agents,
    summary,
    checking,
    lastCheckedAt,
    checkNow: () => void checkNow(),
    startApp: () => void startApp(),
    restartApp: () => void restartApp(),
    snoozeApp: () => setSnoozed(true),
    runAgent,
    auto: { on: autoPending ?? statusAuto, error: autoError, set: setAuto },
  };
}
