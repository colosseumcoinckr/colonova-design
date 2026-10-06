/**
 * 업데이트 줄 한 줄의 판정(PLAN-UI U12) — 앱 · Claude Code · Codex 가 같은
 * 판정을 지나 같은 모양으로 선다. 문장은 labels.ts(L.update)를 인자로 받는다:
 * 시험이 src 에서 곧장 읽는 순수 모듈이라 형제를 부르지 않기 때문이다
 * (journey.ts 와 같은 규칙). `최신이에요` 초록 표식은 문장이 아니라 그림이라
 * 부르는 쪽(state === "latest")이 단다.
 */
import { hasNewerVersion, plainDotted } from "./version.ts";

/** 상태 필드 — `DaemonStatus.providers[]` 한 행과 `agentUpdates` 한 칸을 합친 모양. */
export interface UpdateToolInput {
  /** 프로바이더 id — `claude` · `codex` (앱 줄은 부르는 쪽이 이름을 붙인다). */
  id: string;
  /** 현재 버전(모르면 null — 앱은 확인 전까지 모른다). */
  version: string | null;
  /** 확인해 둔 새 버전 — 모르면 null. */
  latestVersion: string | null;
  /** 이 실행의 업데이트 지금 — 없으면 키가 없다. */
  phase?: "pending" | "running" | "done" | "failed";
  /** 단계에 들어선 시각(ISO). */
  at?: string;
  /** 끝난 업데이트가 깐 버전. */
  versionAfter?: string;
  /** 실패의 한국어 한 줄. */
  detail?: string;
}

/** 줄의 상태 — 오른쪽 끝에 무엇이 서는지가 이 값으로 정해진다. */
export type UpdateRowState = "latest" | "available" | "pending" | "running" | "failed" | "unknown";

export interface UpdateRowCopy {
  state: UpdateRowState;
  /** 왼쪽의 판정 문장 — `2.1.4 → 2.2.0 있어요` · `2.1.4` · `현재 2.1.4`. */
  version: string;
  /** 판정 아래의 한 줄 — `11:27에 업데이트했어요` · 미루기 문장 · 실패의 이유. */
  note: string | null;
  /** 오른쪽 끝의 단추. */
  action: "update" | "retry" | "none";
}

/** 판정 문장에 쓰는 칸 — `L.update` 가 구조적으로 채운다. */
export interface UpdateRowLabels {
  available: (from: string, to: string) => string;
  doneAt: (time: string) => string;
  deferred: string;
  current: (version: string) => string;
}

/** `11:27` — 목업의 hhmm 과 같은 24시간 넉 자리. */
export function hhmm(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** 한 도구의 줄 판정 — 상태에서만 나온다. */
export function updateRowCopy(tool: UpdateToolInput, t: UpdateRowLabels): UpdateRowCopy {
  const current = plainDotted(tool.version);
  const latest = plainDotted(tool.latestVersion);
  if (tool.phase === "running")
    return { state: "running", version: current ?? "", note: null, action: "none" };
  if (tool.phase === "pending")
    return { state: "pending", version: current ?? "", note: t.deferred, action: "none" };
  if (tool.phase === "failed")
    return { state: "failed", version: current ?? "", note: tool.detail ?? null, action: "retry" };
  if (tool.phase === "done") {
    const version = plainDotted(tool.versionAfter) ?? current ?? latest ?? "";
    const time = tool.at ? hhmm(tool.at) : "";
    return {
      state: "latest",
      version,
      note: time ? t.doneAt(time) : null,
      action: "none",
    };
  }
  if (current && latest && hasNewerVersion(tool.version, tool.latestVersion))
    return {
      state: "available",
      version: t.available(current, latest),
      note: null,
      action: "update",
    };
  if (current && latest) return { state: "latest", version: current, note: null, action: "none" };
  // 최신 버전을 아직 모르는 줄 — 「현재 2.1.4」 만 보인다(PLAN-UI P1).
  return {
    state: "unknown",
    version: current ? t.current(current) : "",
    note: null,
    action: "none",
  };
}

/** 홈의 `방금 있던 일` 한 줄 — 도구가 AI 프로그램을 새 버전으로 바꿨다(U12 · J6). */
export interface AgentUpdateEvent {
  id: string;
  text: string;
  /** 끝난 시각(ms) — 줄의 순서와 `n분 전` 이 읽는다. */
  at: number;
}

/**
 * `DaemonStatus.agentUpdates` 에서 끝난(done) 업데이트만 한 줄씩 — 이름은 프로바이더
 * 목록의 `label`(없으면 id), 버전을 모르는 끝은 줄이 서지 않는다. 최신이 맨 위.
 */
export function agentUpdateEvents(
  updates: Partial<Record<string, { phase: string; at: string; version?: string }>> | undefined,
  providers: ReadonlyArray<{ id: string; label: string }> | undefined,
  doneEvent: (name: string, version: string) => string,
): AgentUpdateEvent[] {
  if (!updates) return [];
  return Object.entries(updates)
    .flatMap(([id, state]) => {
      if (state?.phase !== "done" || !state.version) return [];
      const name = providers?.find((provider) => provider.id === id)?.label ?? id;
      return [
        {
          id,
          text: doneEvent(name, plainDotted(state.version) ?? state.version),
          at: Date.parse(state.at) || 0,
        },
      ];
    })
    .sort((a, b) => b.at - a.at);
}

// ---------------------------------------------------------------------------
// 업데이트 쪽의 앱 줄과 요약 띠(2026-10-06 설정 손질 · S7)
// ---------------------------------------------------------------------------

/**
 * 앱 줄의 걸음 — 데스크톱 다리(`selfUpdate`)를 두 번 누르는 길이 그대로 걸음이 된다. 첫 누름은
 * 내려받고 검증하는 데까지(오래 걸린다)이고, 준비가 끝난 뒤의 누름이 곧 재시작 동의다 —
 * 그래서 준비됨에는 이름 있는 단추(`지금 다시 시작`)가 서야 한다. 세션이 돌고 있으면 두 걸음
 * 모두 끝나는 순간으로 미뤄진다.
 */
export type AppUpdatePhase =
  | "idle"
  | "downloading"
  | "deferred"
  | "ready"
  | "restarting"
  | "restartDeferred";

/**
 * `selfUpdate()` 의 답을 걸음으로 읽는다 — 모양은 desktop/src/app-updates.ts 의 `install()`.
 * 실패하면 첫 걸음은 처음으로, 재시작은 준비됨으로 돌아간다(준비해 둔 것은 그대로 남아 있다).
 * 개발 실행의 `planned` 와 모르는 모양은 아무 일도 없었던 것으로 둔다.
 */
export function selfUpdateOutcome(
  result: unknown,
  from: "start" | "restart",
): { phase: AppUpdatePhase; error: string | null } {
  const back: AppUpdatePhase = from === "start" ? "idle" : "ready";
  if (typeof result !== "object" || result === null) return { phase: back, error: null };
  const reply = result as Record<string, unknown>;
  if (reply.error) return { phase: back, error: String(reply.error) };
  if (reply.deferred === true) {
    return { phase: from === "start" ? "deferred" : "restartDeferred", error: null };
  }
  if (reply.prepared === true) return { phase: "ready", error: null };
  if ("started" in reply) return { phase: "restarting", error: null };
  return { phase: back, error: null };
}

/** 앱 줄이 읽는 상태 — 부르는 쪽이 훅의 값을 그대로 건넨다. */
export interface AppRowInput {
  phase: AppUpdatePhase;
  /** 쪽을 열 때의 조용한 확인 — pending 이면 아직 모른다. */
  probe: "pending" | "done" | "failed";
  /** 피드의 답 — 확인이 닿지 않았으면 null. */
  check: { updateAvailable: boolean; version: string } | null;
  /** 이 컴퓨터에서 앱이 스스로 바뀔 수 있나(mac · Windows) — 아니면 릴리스 페이지로 보낸다. */
  canSelfUpdate: boolean;
  /** 내려받은 뒤 `나중에` 를 눌렀다 — 재촉이 조용해진다. */
  snoozed: boolean;
  /** 이번 누름이 실패로 끝났다 — 다시 시도를 내놓는다. */
  failed: boolean;
}

export type AppRowState =
  | "checking"
  | "failed"
  | "latest"
  | "available"
  | "updateFailed"
  | "downloading"
  | "deferred"
  | "ready"
  | "restarting"
  | "restartDeferred";

export interface AppRowCopy {
  state: AppRowState;
  /** 이름 아래 첫 줄 — 버전 · 지금 하는 일. */
  line: string;
  /** 첫 줄 아래의 덧말. */
  note: string | null;
  /** 오른쪽 주 단추 — `link` 는 릴리스 페이지로 가는 링크. */
  action: "none" | "update" | "retry" | "restart" | "link";
  /** 작은 `나중에` 를 내놓는가. */
  later: boolean;
  /** 줄 아래의 진행 막대. */
  bar: boolean;
}

/** 앱 줄의 문장 — `L.update` 가 구조적으로 채우고, `downloading` 은 온보딩의 단계 말을 빌린다. */
export interface AppRowLabels {
  appAvailable: (to: string) => string;
  appFlow: string;
  appDeferred: string;
  appReady: string;
  appRestartDeferred: string;
  appBusy: string;
  appRestart: string;
  rowCheckFailed: string;
  checking: string;
  downloading: string;
}

/**
 * 앱 줄 한 줄의 판정 — 걸음(phase)이 먼저고, 걸음이 쉬는 동안(idle)에는 조용한 확인의 답이 말한다.
 * 내려받는 동안의 줄이 「다시 시작하는 중」이던 거짓과, 준비가 끝난 뒤의 두 번째 누름이 경고 없이
 * 앱을 닫던 일을 이 표가 막는다(2026-10-06 설정 손질 · S7).
 */
export function appRowCopy(input: AppRowInput, t: AppRowLabels): AppRowCopy {
  const none = { note: null, action: "none", later: false, bar: false } as const;
  switch (input.phase) {
    case "downloading":
      return { ...none, state: "downloading", line: t.downloading, bar: true };
    case "restarting":
      return { ...none, state: "restarting", line: t.appBusy, note: t.appRestart, bar: true };
    case "ready":
      return {
        ...none,
        state: "ready",
        line: t.appReady,
        action: "restart",
        later: !input.snoozed,
      };
    case "restartDeferred":
      return { ...none, state: "restartDeferred", line: t.appReady, note: t.appRestartDeferred };
    case "deferred":
      return {
        ...none,
        state: "deferred",
        line: t.appAvailable(input.check?.version ?? ""),
        note: t.appDeferred,
      };
    default:
      break;
  }
  if (input.probe === "pending") return { ...none, state: "checking", line: t.checking };
  if (input.probe === "failed" || input.check === null) {
    return { ...none, state: "failed", line: t.rowCheckFailed };
  }
  if (!input.check.updateAvailable) {
    return { ...none, state: "latest", line: input.check.version };
  }
  const line = t.appAvailable(input.check.version);
  if (!input.canSelfUpdate) return { ...none, state: "available", line, action: "link" };
  if (input.failed) {
    return { ...none, state: "updateFailed", line, action: "retry" };
  }
  return { ...none, state: "available", line, note: t.appFlow, action: "update" };
}

/** 요약 띠가 세는 한 줄의 모양 — 앱 줄과 AI 줄이 같은 말로 건넨다. */
export type SummaryRow =
  | "available"
  | "latest"
  | "unknown"
  | "running"
  | "pending"
  | "failed"
  | "ready";

export type UpdateSummaryKind =
  | "none"
  | "checking"
  | "updating"
  | "available"
  | "failed"
  | "unknown"
  | "latest";

export interface UpdateSummary {
  kind: UpdateSummaryKind;
  /** 새 버전이 서 있는 줄의 수 — 내려받는 중 · 준비됨 · 미뤄 둔 것도 센다. */
  count: number;
  /** 확인이 닿지 않은 줄의 수. */
  failed: number;
}

/**
 * 쪽 맨 위 띠의 말 — 줄들의 상태에서 파생한다(저장해 둔 문장은 상태보다 늦게 늙는다).
 * 확인할 줄이 없으면 「모두 최신」이라 말하지 않고, 최신인지 모르는 줄만 있어도 그렇다
 * (2026-10-04 ux-review 의 거짓 안심을 이어 막는다). 우선순위: 확인 중 · 업데이트 중 · 새 버전 ·
 * 확인 실패 · 아직 모름 · 최신.
 */
export function updateSummary(input: {
  checking: boolean;
  rows: readonly SummaryRow[];
  checkFailed: number;
}): UpdateSummary {
  const { checking, rows, checkFailed } = input;
  const count = rows.filter(
    (row) => row === "available" || row === "ready" || row === "pending" || row === "failed",
  ).length;
  const base = { count, failed: checkFailed };
  if (checking) return { kind: "checking", ...base };
  if (rows.length === 0) return { kind: "none", count: 0, failed: 0 };
  if (rows.includes("running")) return { kind: "updating", ...base };
  if (count > 0) return { kind: "available", ...base };
  if (checkFailed > 0) return { kind: "failed", ...base };
  if (rows.includes("unknown")) return { kind: "unknown", ...base };
  return { kind: "latest", ...base };
}

/**
 * 앱 줄을 요약 띠가 세는 모양으로 — 확인이 닿지 않은 줄(`failed`)은 새 버전을 모르는 줄이라
 * 새 버전으로 세지 않고(실패의 수는 따로 건넨다), 내려받는 중 · 다시 시작하는 중은 도는 일이다.
 */
export function appSummaryRow(state: AppRowState): SummaryRow {
  switch (state) {
    case "latest":
      return "latest";
    case "available":
    case "updateFailed":
      return "available";
    case "downloading":
    case "restarting":
      return "running";
    case "deferred":
    case "restartDeferred":
      return "pending";
    case "ready":
      return "ready";
    default:
      return "unknown";
  }
}
