/**
 * 턴 통계 (AI 작업 시간 측정, 2026-09-20): 한 턴이 끝날 때마다 사실 한 줄을
 * `~/.colonova-design/logs/turn-stats-YYYY-MM-DD.jsonl` 에 남긴다.
 *
 * 무엇이 턴을 느리게 하는지는 측정이 먼저다 — 방향 잡기 tool call 수,
 * 브라우저 확인, 게이트 재시작, 컨텍스트 크기. 같은 날 네 필드가 갈라 들었다:
 * `firstEditMs`(방향 잡기: 첫 편집까지), `waitMs`(사람이 카드 앞에서 기다린
 * 시간 — durationMs 에서 갈라 낸다), `scanMs`(보내기 문에서 핀 강화가 걸린
 * 시간), `sincePrevTurnMs`(이전 턴 종료 뒤 재보내기의 틈 — 교정 턴의 재료).
 * 게이트는 turn.end 뒤에야 판정이 나오므로 턴 행이 아닌 제 행(kind
 * "gateset")으로 내려앉는다. 이 측정은 `undo.jsonl` 과 같은 결이다: 종류와
 * 숫자만 남고, 사용자의 말·화면·파일 이름은 조금도 남지 않는다. 로그가 도구를
 * 죽일 수는 없다 — 무엇을 써도 조용히 삼킨다.
 */

import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  ChatEvent,
  DiagnosticsPercentiles,
  DiagnosticsTurnStats,
  TurnFailureStage,
} from "@colonova-design/protocol";
import { type BrowserFailKind, isBrowserToolName } from "./browser-tools.js";
import { daemonLogDir } from "./log.js";
import { STATS_EDIT_TOOLS, STATS_EXEC_TOOLS, STATS_READ_TOOLS } from "./tool-names.js";
import { editPathsOf } from "./tool-paths.js";
import { classifyFailure } from "./turn-retry.js";

/** 보존 일수 — 데몬 하루 로그와 같은 창. */
const RETENTION_DAYS = 7;
const FILE_PREFIX = "turn-stats-";
const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;
/** contextUsage 류의 부가 조회가 기록 자체를 지연시키지 않게 하는 상한. */
const CONTEXT_READ_MS = 800;
/** 문에서 잰 강화 시간이 턴에 얹히는 유효기간 — 잃어낸 보내기가 나중 턴에 몰래 붙는 것을 막는다. */
const SCAN_TTL_MS = 10 * 60 * 1000;
/** 세션마다 물려둘 수 있는 강화 시간의 수 — 대기 줄이 길어져도 첫 턴의 것만 산다. */
const MAX_QUEUED_SCANS = 4;

/**
 * 도구 이름 → 통계 묶음. 프로바이더마다 이름이 다르니 두 표의 합(tool-names.ts)을
 * 읽는다.
 */
const READ_TOOLS = STATS_READ_TOOLS;
const EDIT_TOOLS = STATS_EDIT_TOOLS;
const EXEC_TOOLS = STATS_EXEC_TOOLS;

/** 한 턴의 측정 — 세션이 말을 내놓는 순간 태어나 turn.end 에서 한 줄이 된다. */
interface InFlight {
  kind: "user" | "comments" | "brief" | "gate";
  pins: number;
  images: number;
  files: number;
  gate: boolean;
  read: number;
  edit: number;
  exec: number;
  browser: number;
  other: number;
  /** user.echo 를 본 데몬 시계(ms) — firstEditMs 의 시작점. */
  startedAt: number;
  /** 첫 text.delta 가 뜬 시각 — 첫 글자까지의 대기(TTFT). 없던 턴은 null. */
  firstDeltaAt: number | null;
  /** 첫 편집 도구가 뜬 시각 — 편집이 없던 턴은 null. */
  firstEditAt: number | null;
  /** 핀 턴이 에이전트에 실어 보낸 말의 바이트 — 핀 페이로드의 크기. 핀 턴만 값이 있다. */
  pinBytes: number | null;
  /** 카드 대기(waiting_*)의 누적(ms) — 서버가 구간을 밀어 온다. */
  waitMs: number;
  /** 보내기 문에서 잰 핀 강화 시간 — 시작 때 물려받는다. */
  scanMs: number | null;
  /** 이전 턴이 끝난 뒤 이 턴까지의 틈(ms) — 첫 턴은 null. */
  sincePrevTurnMs: number | null;
  /** 보내기 문이 알아낸 클론 경로 — 후보 비교의 정규화 기준(2026-09-22). */
  cwd: string | null;
  /** 핀의 파일 후보(절대경로) — 후보가 없는 턴은 null(비교 자체가 성립하지 않는다). */
  candidates: Set<string> | null;
  /** 에이전트가 후보 파일을 실제로 편집했는가 — 후보가 있던 턴만 true/false. */
  pinHit: boolean | null;
  /** 브라우저 도구에 쓴 시간의 합(ms) — 중계(noteBrowserOp)만 잰다:
   *  세 프로바이더가 같은 자리를 지나고, 사건 기반 측정과 겹쳐 두 번
   *  세지 않는다. 측정이 하나도 없으면 null. */
  browserMs: number | null;
  /** 브라우저 op 실패 종류의 수 — 실패가 없던 턴은 null. */
  browserFail: Partial<Record<BrowserFailKind, number>> | null;
  /** screen_check 가 로그인 화면으로 튕긴 화면의 수(2026-10-07) — 횟수만, 주소 · 경로는 아니다. */
  loginWall: number;
}

/** The turn row as it lands in the file — numbers and kinds only. */
interface TurnStatsRow {
  at: string;
  sessionId: string;
  project: string | null;
  provider: string | null;
  model: string | null;
  effort: string | null;
  kind: "user" | "comments" | "brief" | "gate";
  pins: number;
  images: number;
  files: number;
  durationMs: number | null;
  isError: boolean;
  subtype: string;
  numTurns: number | null;
  tools: { read: number; edit: number; exec: number; browser: number; other: number };
  gate: boolean;
  contextTokens: number | null;
  /** user.echo → 첫 편집 도구 — 방향 잡기 비용. 없으면 null. */
  firstEditMs: number | null;
  /** user.echo → 첫 text.delta — 첫 글자까지의 대기(TTFT). 없으면 null. */
  firstDeltaMs: number | null;
  /** 핀 턴이 에이전트에게 실어 보낸 말의 바이트 — 핀 페이로드의 크기. 핀 턴만. */
  pinBytes: number | null;
  /** 실패한 턴의 단계 — 실패 문장의 최선 분류(계정류 `account` 는 2026-10-07 에 더했다). 성공 턴은 null. */
  failure: TurnFailureStage | null;
  /** 카드 대기(waiting_*)의 누적 — durationMs 에 섞인 사람 시간. */
  waitMs: number;
  /** 보내기 문에서 핀 강화(파일 후보)가 걸린 시간 — 핀 턴만 값이 있다. */
  scanMs: number | null;
  /** 이전 턴 종료 직후의 재보내기라면 작은 수 — 교정 턴의 재료. */
  sincePrevTurnMs: number | null;
  /** 핀의 후보 파일을 에이전트가 편집했는가(2026-09-22) — 후보가 없던 턴은 null.
   *  경로는 남기지 않는다: 사용자의 말이 사는 곳에 파일 경로가 끼어들지 않는다. */
  pinHit: boolean | null;
  /** 브라우저 도구에 쓴 시간의 합 — 측정이 없던 턴은 null. */
  browserMs: number | null;
  /** 브라우저 op 실패 종류의 수 — 0인 종류는 칸에서 뺀다(비면 생략). */
  browserFail?: Partial<Record<BrowserFailKind, number>>;
  /** 이 턴의 screen_check 가 로그인 화면으로 튕긴 화면의 수(2026-10-07 베타 준비 분석) — 없으면 칸이 없다. */
  loginWall?: number;
  /**
   * 이 턴이 쓴 토큰(2026-10-02, claude.dev 「What a task costs」의 네 변수 가운데 셋 —
   * 턴 수는 numTurns 가 이미 센다). `input` 은 캐시를 뺀 새 입력, `cacheRead` 는 캐시에서
   * 읽은 입력, `cacheWrite` 는 캐시에 적은 입력(모르는 프로바이더는 null), `output` 은
   * 생각을 포함한 출력. 프로바이더가 알려 주지 않은 턴은 null.
   */
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number | null } | null;
  /** 이 턴의 추정 비용(USD, 정가 기준 — 구독에서는 일의 양을 재는 눈금이지 청구서가 아니다). 모르면 null. */
  costUsd: number | null;
  /** 입력 가운데 캐시에서 읽은 비율(0..1, 소수 셋째 자리) — "다른 어떤 설정도 입력 비용을 이만큼 움직이지 않는다". 입력이 없거나 모르면 null. */
  cacheHitRate: number | null;
}

/** 턴이 끝난 뒤 게이트의 한 바퀴 — 판정이 turn.end 뒤에야 나오므로 제 행이다. */
interface TurnGateRow {
  at: string;
  sessionId: string;
  project: string | null;
  kind: "gateset";
  gateMs: number;
  /** 게이트가 다시 열어 본 화면 수 — dedupe·origin 필터를 통과한 수다(2026-09-22). */
  screens: number;
  reopened: boolean;
  /** 게이트가 돌지 못한 이유 — once(이미 걸었다) · no-driver · no-screens ·
   *  no-preview · busy · broken. 돌았으면 없다(2026-09-22). */
  skipped?: string;
  /** 문제 화면의 내역 — unsettled·blank 화면 수와 문제 줄 합계(slice 전). */
  unsettled?: number;
  blank?: number;
  /** 휴대폰 폭에서 문서가 옆으로 밀린 화면 수(2026-09-29). */
  overflow?: number;
  /** 새 접근성 문제(이름 없는 컨트롤 · 너무 흐린 글자)가 있던 화면 수(2026-09-29). */
  a11y?: number;
  consoleLines?: number;
  netLines?: number;
  /** D3 재시도로 구제된 화면 수. */
  rescued?: number;
  /** 열었더니 로그인 화면이었던 화면 수(2026-10-07) — 확인한 화면으로도 문제로도 세지 않은 것. 횟수만. */
  loginWall?: number;
  /** 바뀐 파일에서 되짚은 화면 수(PLAN-HARNESS §3.B B-4) — 0 이면 싣지 않는다. */
  fallback?: number;
  /** 게이트의 타입 검사(PLAN-HARNESS §3.D D-5) — 이번에 바뀐 TypeScript 파일의
   *  오류 수와 검사 시간(ms). 검사를 돌렸으면 0 도 싣는다(돌리지 않은 게이트와
   *  오류 0 인 게이트를 가른다). */
  typeErrors?: number;
  typeMs?: number;
}

/** 하루 파일의 한 줄 — 턴 행이거나 게이트 행. */
export type TurnStatsFileRow = TurnStatsRow | TurnGateRow;

/** 세션의 부가 사실 — 서버가 아는 것을 통계만의 좁은 창으로 내어준다. */
export interface TurnStatsDeps {
  /** 이 세션이 사는 프로젝트의 slug — 없으면 null. */
  projectOf(sessionId: string): string | null;
  /** 프로바이더·모델·노력 — 없음은 null 로 솔직히. */
  chipsOf(sessionId: string): {
    provider: string | null;
    model: string | null;
    effort: string | null;
  };
  /** 턴 끝의 컨텍스트 사용량 — 못 읽으면 null. */
  contextTokens(sessionId: string): Promise<number | null>;
}

function freshTurn(text: string): InFlight {
  // 마커 턴의 종류 — readTurn 까지 갈 것 없이, 첫 줄의 표식 접두만 본다.
  const kind = text.startsWith("<!-- colonova-design:comments ")
    ? "comments"
    : text.startsWith("<!-- colonova-design:gate ")
      ? "gate"
      : text.startsWith("<!-- colonova-design:")
        ? "brief"
        : "user";
  return {
    kind,
    pins: 0,
    images: 0,
    files: 0,
    gate: false,
    read: 0,
    edit: 0,
    exec: 0,
    browser: 0,
    other: 0,
    startedAt: Date.now(),
    firstDeltaAt: null,
    firstEditAt: null,
    pinBytes: kind === "comments" ? Buffer.byteLength(text, "utf8") : null,
    waitMs: 0,
    scanMs: null,
    sincePrevTurnMs: null,
    cwd: null,
    candidates: null,
    pinHit: null,
    browserMs: null,
    browserFail: null,
    loginWall: 0,
  };
}

/**
 * turn.end 의 usage → 행의 세 칸. 캐시 적중률의 분모는 입력 전체(새 입력 + 캐시 읽기 +
 * 캐시 쓰기)다 — 캐시 쓰기를 모르는 프로바이더(Codex)는 0 으로 세어 비율이 조금 후해진다.
 */
function usageColumns(
  usage: (ChatEvent & { kind: "turn.end" })["usage"],
): Pick<TurnStatsRow, "tokens" | "costUsd" | "cacheHitRate"> {
  if (usage === undefined) return { tokens: null, costUsd: null, cacheHitRate: null };
  const denominator = usage.input + usage.cacheRead + (usage.cacheWrite ?? 0);
  return {
    tokens: {
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
    },
    costUsd: usage.costUsd,
    cacheHitRate:
      denominator > 0 ? Math.round((usage.cacheRead / denominator) * 1000) / 1000 : null,
  };
}

/** 하루 치 파일 정리 — 데몬 로그와 같은 판정, 이 파일의 접두만 담당한다. */
function prune(dir: string, today: Date): void {
  const horizon = today.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(FILE_PREFIX)) continue;
    const day = name.slice(FILE_PREFIX.length);
    if (!DAY_FILE.test(day)) continue;
    const parsed = Date.parse(day.slice(0, "YYYY-MM-DD".length));
    if (Number.isNaN(parsed) || parsed >= horizon) continue;
    try {
      rmSync(join(dir, name));
    } catch {
      // 다음 쓰기가 다시 후보로 올린다.
    }
  }
}

// ---------------------------------------------------------------------------
// 최근 7일 요약 (2026-10-07 베타 준비 분석) — 진단 복사의 재료
// ---------------------------------------------------------------------------

/** 요약의 창(일) — 보존 일수와 같다. */
const SUMMARY_DAYS = RETENTION_DAYS;
/** 턴 행의 종류 — 이 밖(`gateset` 등)은 턴이 아니다. */
const TURN_KINDS: ReadonlySet<string> = new Set(["user", "comments", "brief", "gate"]);
/** 실패 단계의 사전 — 프로토콜의 `TurnFailureStage` 와 같다. */
const FAILURE_STAGES: ReadonlySet<string> = new Set([
  "length",
  "auth",
  "account",
  "limit",
  "stream",
  "other",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 0 이상의 유한한 수만 숫자로 읽는다 — 손상된 줄의 문자열 · 음수 · NaN 은 값이 아니다. */
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** 가까운 순위(nearest-rank) 분위수 — 정렬된 값에서 `ceil(p/100 · n)` 번째. 값이 없으면 null. */
function nearestRank(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] ?? null;
}

function percentiles(values: readonly number[]): DiagnosticsPercentiles {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, p50: nearestRank(sorted, 50), p90: nearestRank(sorted, 90) };
}

/**
 * 턴 통계 줄들을 최근 7일의 요약 하나로 접는다 — 순수 함수(입력은 파일의 줄들). 게이트 행(`gateset`) ·
 * 읽을 수 없는 줄 · 창 밖의 행은 건너뛴다. 프로젝트 · 세션 · 경로는 행에 있어도 요약에 옮기지 않는다
 * (읽는 칸이 정해져 있다 — 진단은 종류와 숫자뿐이다).
 *
 * 분위수는 **사람이 보낸 턴(`user` · `comments`) 가운데 끝까지 답한 것**만 센다 — 중지한 턴 · 실패한
 * 턴 · 도구가 연 턴(`brief` · `gate`)은 `첫 요청에서 화면이 바뀌기까지` 와 뜻이 다르다. 턴 · 실패 ·
 * 도구 호출 · 핀의 셈은 모든 턴 행이다.
 */
export function summarizeTurnStats(lines: readonly string[], now: Date): DiagnosticsTurnStats {
  const horizon = now.getTime() - SUMMARY_DAYS * 24 * 60 * 60 * 1000;
  const byKind = { user: 0, comments: 0, brief: 0, gate: 0 };
  const failures: Partial<Record<TurnFailureStage, number>> = {};
  let turns = 0;
  let failed = 0;
  let pinTurns = 0;
  let toolSum = 0;
  let toolTurns = 0;
  const firstEdit: number[] = [];
  const firstDelta: number[] = [];
  const duration: number[] = [];
  for (const line of lines) {
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(row)) continue;
    const kind = row.kind;
    if (typeof kind !== "string" || !TURN_KINDS.has(kind)) continue;
    const at = typeof row.at === "string" ? Date.parse(row.at) : Number.NaN;
    if (!Number.isFinite(at) || at < horizon) continue;
    turns += 1;
    byKind[kind as keyof typeof byKind] += 1;
    const isError = row.isError === true;
    if (isError) {
      failed += 1;
      // 단계가 없는(옛 행 · 모르는 값) 실패는 `other` 로 센다 — 실패는 어느 칸에든 든다.
      const stage =
        typeof row.failure === "string" && FAILURE_STAGES.has(row.failure)
          ? (row.failure as TurnFailureStage)
          : "other";
      failures[stage] = (failures[stage] ?? 0) + 1;
    }
    if ((count(row.pins) ?? 0) > 0) pinTurns += 1;
    if (isRecord(row.tools)) {
      toolSum += (["read", "edit", "exec", "browser", "other"] as const).reduce(
        (sum, key) => sum + (count((row.tools as Record<string, unknown>)[key]) ?? 0),
        0,
      );
      toolTurns += 1;
    }
    if ((kind === "user" || kind === "comments") && !isError && row.subtype !== "interrupted") {
      const edit = count(row.firstEditMs);
      if (edit !== null) firstEdit.push(edit);
      const delta = count(row.firstDeltaMs);
      if (delta !== null) firstDelta.push(delta);
      const total = count(row.durationMs);
      if (total !== null) duration.push(total);
    }
  }
  return {
    days: SUMMARY_DAYS,
    turns,
    byKind,
    failed,
    failures,
    pinTurns,
    avgToolCalls: toolTurns === 0 ? null : Math.round((toolSum / toolTurns) * 10) / 10,
    firstEditMs: percentiles(firstEdit),
    firstDeltaMs: percentiles(firstDelta),
    durationMs: percentiles(duration),
  };
}

/**
 * 요약이 읽을 파일 이름들 — `turn-stats-YYYY-MM-DD.jsonl` 가운데 창 안의 날짜(경계의 하루는 포함: 행은
 * 제 시각으로 다시 걸러진다). 보존 정리가 아직 못 지운 7일 밖의 파일은 읽지 않는다. 순수 함수.
 */
export function turnStatsFilesWithin(names: readonly string[], now: Date): string[] {
  const horizonDay = new Date(now.getTime() - SUMMARY_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return names
    .filter((name) => {
      if (!name.startsWith(FILE_PREFIX)) return false;
      const day = name.slice(FILE_PREFIX.length);
      return DAY_FILE.test(day) && day.slice(0, 10) >= horizonDay;
    })
    .sort();
}

/**
 * 로그 폴더의 턴 통계를 읽어 최근 7일 요약을 만든다 — 폴더가 없거나 파일이 하나도 없으면 턴 0 의
 * 요약이다(`아직 턴이 없다` 도 답이다). 한 파일을 못 읽어도 나머지로 만든다. 읽는 일만 하고
 * 쓰지 않는다.
 */
export function readTurnStatsSummary(options?: { dir?: string; now?: Date }): DiagnosticsTurnStats {
  const dir = options?.dir ?? daemonLogDir();
  const now = options?.now ?? new Date();
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    // 폴더가 없으면 읽을 것도 없다.
  }
  const lines: string[] = [];
  for (const name of turnStatsFilesWithin(names, now)) {
    try {
      lines.push(...readFileSync(join(dir, name), "utf8").split("\n"));
    } catch {
      // 한 파일을 못 읽어도 나머지로 요약한다.
    }
  }
  return summarizeTurnStats(lines, now);
}

/** 측정의 임자 — 서버가 세션 사건을 흘려 보내는 창구. */
export class TurnStats {
  private readonly flying = new Map<string, InFlight>();
  /** 보내기 문에서 잰 핀 강화 — 시간과 함께 후보(절대경로)와 클론 경로를
   *  물려준다(2026-09-22). 턴 시작(user.echo) 때 하나씩 소비된다. */
  private readonly scans = new Map<
    string,
    Array<{ at: number; ms: number; cwd: string | null; candidates: string[] | null }>
  >();
  /** 세션의 마지막 turn.end 정산 시각 — 다음 턴의 sincePrevTurnMs 의 짝. */
  private readonly lastEndAt = new Map<string, number>();

  constructor(
    private readonly deps: TurnStatsDeps,
    private readonly options?: { dir?: string; now?: () => Date },
  ) {}

  /** 세션 사건 하나 — 필요한 것만 골라 먹고 나머지는 그냥 흘린다. */
  observe(sessionId: string, event: ChatEvent): void {
    if (event.kind === "user.echo") {
      // 턴의 시작: deliver 직후의 메아리. 핀 턴이면 마커 첫 줄에서 핀 수만
      // 센다 — 본문은 읽지 않는다(사용자의 말이 거기 산다).
      const turn = freshTurn(event.text);
      const firstLine = event.text.split("\n", 1)[0] ?? "";
      if (firstLine.startsWith("<!-- colonova-design:comments ")) {
        try {
          const marker = JSON.parse(
            firstLine.slice(
              "<!-- colonova-design:comments ".length,
              firstLine.length - " -->".length,
            ),
          ) as { items?: unknown };
          turn.pins = Array.isArray(marker.items) ? marker.items.length : 0;
        } catch {
          turn.pins = 0;
        }
      }
      turn.images = event.images;
      turn.files = event.files?.length ?? 0;
      // 보내기 문에서 잰 강화(시간·후보·경로)와 이전 턴과의 틈을 여기서 묻는다
      // — 대기 줄이 여러 건이면 먼저 들어온 쪽이 먼저 나가므로 줄의 머리가 이
      // 턴의 것이다.
      const scan = this.takeScan(sessionId);
      turn.scanMs = scan?.ms ?? null;
      turn.cwd = scan?.cwd ?? null;
      turn.candidates =
        scan?.candidates !== null && scan?.candidates !== undefined && scan.candidates.length > 0
          ? new Set(scan.candidates)
          : null;
      // 후보가 있던 턴은 이 미터가 성립한다 — 비적중도 답이다(false). 후보가
      // 없으면 비교 자체가 성립하지 않으므로 null 로 솔직하다.
      turn.pinHit = turn.candidates !== null ? false : null;
      const prevEnd = this.lastEndAt.get(sessionId);
      turn.sincePrevTurnMs = prevEnd === undefined ? null : Math.max(0, Date.now() - prevEnd);
      this.flying.set(sessionId, turn);
      return;
    }
    // 첫 글자의 시각 — TTFT. 사람이 보내기를 누른 뒤 첫 답이 오기까지의
    // 대기를 잰다(user.echo 가 아니라 도착한 첫 delta 기준).
    if (event.kind === "text.delta") {
      const turn = this.flying.get(sessionId);
      if (turn !== undefined && turn.firstDeltaAt === null) turn.firstDeltaAt = Date.now();
      return;
    }
    if (event.kind === "tool.start") {
      const turn = this.flying.get(sessionId);
      if (turn === undefined) return;
      if (isBrowserToolName(event.name)) turn.browser += 1;
      else if (READ_TOOLS[event.name] === true) turn.read += 1;
      else if (EDIT_TOOLS[event.name] === true) turn.edit += 1;
      else if (EXEC_TOOLS[event.name] === true) turn.exec += 1;
      else turn.other += 1;
      // 첫 편집의 시각 — 방향 잡기(읽기만 하던 구간)가 끝난 자리다.
      if (turn.firstEditAt === null && EDIT_TOOLS[event.name] === true)
        turn.firstEditAt = event.startedAt ?? Date.now();
      // 핀의 후보를 에이전트가 실제로 편집했는가(2026-09-22) — 후보가 있는
      // 턴만. 세 프로바이더의 도구 모양이 다르니 경로 뽑기는 tool-paths 가
      // 한다. 절대경로로 정규화해 비교한다(후보는 클론 루트 기준, 도구 경로는
      // 절대 또는 cwd 상대). 경로는 기록하지 않는다.
      if (turn.candidates !== null && EDIT_TOOLS[event.name] === true) {
        for (const path of editPathsOf(event.input)) {
          if (turn.candidates.has(resolve(turn.cwd ?? process.cwd(), path))) {
            turn.pinHit = true;
            break;
          }
        }
      }
      return;
    }
    if (event.kind === "turn.end") {
      this.settle(sessionId, event).catch(() => undefined);
    }
  }

  /** 게이트가 이 세션의 턴을 다시 열었다 — 그 턴의 사실에 새긴다. */
  noteGate(sessionId: string): void {
    const turn = this.flying.get(sessionId);
    if (turn !== undefined) turn.gate = true;
  }

  /** 보내기 문에서 핀 강화가 걸린 시간 — 후보와 클론 경로도 함께 물려준다
   *  (2026-09-22). 턴이 시작될 때 소비된다. */
  noteScan(sessionId: string, ms: number, info?: { cwd?: string; candidates?: string[] }): void {
    const queue = this.scans.get(sessionId) ?? [];
    const now = Date.now();
    // 문에서 잰 것이 오래 묵으면 턴에 얹지 않는다 — 잃어낸 보내기의 시간을
    // 나중 턴에 몰래 붙이는 일이 이 줄이 막는 거짓말이다.
    while (queue.length > 0 && now - (queue[0]?.at ?? now) > SCAN_TTL_MS) queue.shift();
    queue.push({
      at: now,
      ms,
      cwd: info?.cwd ?? null,
      candidates: info?.candidates ?? null,
    });
    if (queue.length > MAX_QUEUED_SCANS) queue.shift();
    this.scans.set(sessionId, queue);
  }

  private takeScan(
    sessionId: string,
  ): { at: number; ms: number; cwd: string | null; candidates: string[] | null } | null {
    const queue = this.scans.get(sessionId);
    if (queue === undefined) return null;
    const head = queue.shift();
    if (queue.length === 0) this.scans.delete(sessionId);
    if (head === undefined) return null;
    return Date.now() - head.at > SCAN_TTL_MS ? null : head;
  }

  /** 카드 대기의 한 구간(waiting_* 에 머문 시간) — 도는 턴에 더한다. */
  noteWait(sessionId: string, ms: number): void {
    const turn = this.flying.get(sessionId);
    if (turn !== undefined) turn.waitMs += ms;
  }

  /** 브라우저 중계 op 한 번 (PLAN-MCP M-8) — 도는 턴에 시간과 실패 종류를
   *  더한다. 중계가 잰 시간이라 세 프로바이더가 같은 자리를 지난다 — 턴
   *  간 비교의 잣자리다. 세션에 도는 턴이 없으면 조용히 흘린다. */
  noteBrowserOp(sessionId: string, op: { op: string; ms: number; fail?: BrowserFailKind }): void {
    const turn = this.flying.get(sessionId);
    if (turn === undefined) return;
    turn.browserMs = (turn.browserMs ?? 0) + Math.max(0, op.ms);
    if (op.fail !== undefined) {
      const counts = turn.browserFail ?? {};
      counts[op.fail] = (counts[op.fail] ?? 0) + 1;
      turn.browserFail = counts;
    }
  }

  /** screen_check 가 로그인 화면으로 튕긴 화면(2026-10-07 베타 준비 분석) — 도는 턴에 횟수만 더한다.
   *  세션에 도는 턴이 없으면 조용히 흘린다. */
  noteLoginWall(sessionId: string, count: number): void {
    const turn = this.flying.get(sessionId);
    if (turn !== undefined && count > 0) turn.loginWall += count;
  }

  /** 게이트의 한 바퀴 — 턴 행과는 따로 한 줄로 내려앉는다. 판정 상세와
   *  못 돈 이유(skipped)까지: 못 센 침묵과 통과가 같은 소리를 내지 않게. */
  noteGateCheck(
    sessionId: string,
    outcome: {
      ms: number;
      screens: number;
      reopened: boolean;
      skipped?: string;
      unsettled?: number;
      blank?: number;
      overflow?: number;
      a11y?: number;
      consoleLines?: number;
      netLines?: number;
      rescued?: number;
      loginWall?: number;
      fallback?: number;
      typeErrors?: number;
      typeMs?: number;
    },
  ): void {
    const row: TurnGateRow = {
      at: new Date().toISOString(),
      sessionId,
      project: this.deps.projectOf(sessionId),
      kind: "gateset",
      gateMs: outcome.ms,
      screens: outcome.screens,
      reopened: outcome.reopened,
      ...(outcome.skipped !== undefined ? { skipped: outcome.skipped } : {}),
      ...(outcome.unsettled !== undefined ? { unsettled: outcome.unsettled } : {}),
      ...(outcome.blank !== undefined ? { blank: outcome.blank } : {}),
      ...(outcome.overflow !== undefined ? { overflow: outcome.overflow } : {}),
      ...(outcome.a11y !== undefined ? { a11y: outcome.a11y } : {}),
      ...(outcome.consoleLines !== undefined ? { consoleLines: outcome.consoleLines } : {}),
      ...(outcome.netLines !== undefined ? { netLines: outcome.netLines } : {}),
      ...(outcome.rescued !== undefined ? { rescued: outcome.rescued } : {}),
      ...(outcome.loginWall !== undefined && outcome.loginWall > 0
        ? { loginWall: outcome.loginWall }
        : {}),
      ...(outcome.fallback !== undefined && outcome.fallback > 0
        ? { fallback: outcome.fallback }
        : {}),
      ...(outcome.typeErrors !== undefined ? { typeErrors: outcome.typeErrors } : {}),
      ...(outcome.typeMs !== undefined ? { typeMs: outcome.typeMs } : {}),
    };
    this.write(row);
  }

  /** turn.end 의 정산 — 컨텍스트 읽기를 기다린 뒤 한 줄로 묶는다. */
  private async settle(sessionId: string, event: ChatEvent & { kind: "turn.end" }): Promise<void> {
    const turn = this.flying.get(sessionId);
    this.flying.delete(sessionId);
    if (turn === undefined) return;
    const context = await Promise.race([
      this.deps.contextTokens(sessionId).catch(() => null),
      new Promise<null>((resolve) => {
        const timer = setTimeout(() => resolve(null), CONTEXT_READ_MS);
        timer.unref();
      }),
    ]);
    const chips = this.deps.chipsOf(sessionId);
    const row: TurnStatsRow = {
      at: new Date().toISOString(),
      sessionId,
      project: this.deps.projectOf(sessionId),
      provider: chips.provider,
      model: chips.model,
      effort: chips.effort,
      kind: turn.kind,
      pins: turn.pins,
      images: turn.images,
      files: turn.files,
      durationMs: event.durationMs,
      isError: event.isError,
      subtype: event.subtype,
      numTurns: event.numTurns,
      tools: {
        read: turn.read,
        edit: turn.edit,
        exec: turn.exec,
        browser: turn.browser,
        other: turn.other,
      },
      gate: turn.gate,
      contextTokens: context,
      firstEditMs:
        turn.firstEditAt === null ? null : Math.max(0, turn.firstEditAt - turn.startedAt),
      firstDeltaMs:
        turn.firstDeltaAt === null ? null : Math.max(0, turn.firstDeltaAt - turn.startedAt),
      pinBytes: turn.pinBytes,
      failure: event.isError ? classifyFailure(event.resultText, event.errorCode) : null,
      waitMs: turn.waitMs,
      scanMs: turn.scanMs,
      sincePrevTurnMs: turn.sincePrevTurnMs,
      pinHit: turn.pinHit,
      browserMs: turn.browserMs,
      ...(turn.browserFail !== null ? { browserFail: turn.browserFail } : {}),
      ...(turn.loginWall > 0 ? { loginWall: turn.loginWall } : {}),
      ...usageColumns(event.usage),
    };
    this.lastEndAt.set(sessionId, Date.now());
    this.write(row);
  }

  private write(row: TurnStatsFileRow): void {
    try {
      const dir = this.options?.dir ?? daemonLogDir();
      const now = this.options?.now?.() ?? new Date();
      const day = now.toISOString().slice(0, 10);
      mkdirSync(dir, { recursive: true });
      prune(dir, now);
      appendFileSync(join(dir, `${FILE_PREFIX}${day}.jsonl`), `${JSON.stringify(row)}\n`);
    } catch {
      // 통계가 도구를 죽이는 일은 없다.
    }
  }
}
