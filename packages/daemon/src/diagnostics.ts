/**
 * 진단 한 덩어리 (2026-10-07 베타 준비 분석) — 베타 테스터가 `막혔어요` 를 담당자에게 붙여 넣을 때
 * 한 번에 건넬 사실들. 앱 버전 · OS · 도구 · AI 종류와 요금제 종류 · 프로토콜 버전 · 최근 7일 턴 통계
 * 요약 · 최근 오류의 종류를 모은다.
 *
 * 약속은 하나다 — **종류 · 숫자 · 버전만**. 사용자의 말 · 파일 경로 · 이메일 · 조직 이름 · 프로젝트
 * 이름과 주소 · 토큰은 어느 칸에도 오지 않는다. 입력에는 날것(이메일 · 실행 파일 경로 · 프로젝트
 * 이름이 든 줄)이 와도 되고, `buildDiagnosticsSummary` 가 칸마다 읽을 것만 읽어 싣는다 — 시험이 독이 든
 * 입력으로 지킨다. 도구의 버전은 숫자와 점만 싣는다: 한국어 Windows 에서 자식 프로세스가 CP949 로 낸
 * 줄은 UTF-8 로 읽으면 깨지는데, 숫자만 골라 싣는 한 그 깨짐이 복사 글에 섞일 길이 없다.
 *
 * 순수한 부분(`buildDiagnosticsSummary` · `summarizeLogErrors` · `versionDigits`)과 파일 · 프로세스를
 * 읽는 부분(`collectDiagnostics`)을 갈라 두었다. 읽는 일만 하고 쓰지 않는다.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { arch as osArch, release as osRelease } from "node:os";
import { join } from "node:path";
import type {
  DiagnosticsErrorKind,
  DiagnosticsSummary,
  DiagnosticsTool,
  DiagnosticsTurnStats,
} from "@colonova-design/protocol";
import { PROTOCOL_VERSION } from "@colonova-design/protocol";
import { run } from "./child.js";
import {
  currentPlatform,
  resolveGitExecutable,
  resolveNodeVersion,
  resolvePnpmExecutable,
} from "./environment.js";
import { daemonLogDir, sanitizeText } from "./log.js";
import { windowsBashPath } from "./onboarding.js";
import { readTurnStatsSummary } from "./turn-stats.js";

/** 요약의 창 — 데몬 로그의 보존 일수와 같다. */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** 로그에서 읽을 파일 수와 파일당 꼬리 — 최근 며칠의 끝자락이면 충분하다. */
const LOG_FILES = 3;
const LOG_TAIL_CHARS = 1_000_000;
/** 오류 종류의 상한. */
const ERROR_KINDS = 5;
/** 도구 버전을 묻는 자식 하나의 시간 상한 — 진단이 멈춰 서지 않게. */
const PROBE_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// 순수: 걸러서 싣는 작은 읽기들
// ---------------------------------------------------------------------------

/**
 * 버전 문자열에서 숫자와 점만 — `git version 2.45.1.windows.1` → `2.45.1`, `v24.1.0` → `24.1.0`,
 * `2.1.292 (Claude Code)` → `2.1.292`. 숫자 묶음이 둘 이상인 첫 조각만 읽으므로 깨진 글자 ·
 * 경로 · 이름은 어떻게 섞여 있어도 나오지 않는다. 없으면 null.
 */
export function versionDigits(text: unknown): string | null {
  if (typeof text !== "string") return null;
  return /\d+(?:\.\d+){1,3}/.exec(text)?.[0] ?? null;
}

/** 소문자 · 숫자 · `_` `-` 만의 짧은 식별자만 통과 — 그 밖은 `other`(이름이나 경로가 새지 않게). */
function safeWord(value: unknown, max = 24): string | null {
  if (typeof value !== "string" || value === "") return null;
  const lower = value.toLowerCase();
  return new RegExp(`^[a-z0-9_-]{1,${max}}$`).test(lower) ? lower : "other";
}

/** CLI 의 `authMethod` 가 쓰는 말들 — `claude auth status` 의 JSON(번들 CLI 2.1.292 에서 읽음). */
const AUTH_KINDS: ReadonlySet<string> = new Set([
  "claude.ai",
  "api_key",
  "api_key_helper",
  "oauth_token",
  "third_party",
  "none",
]);

function authKind(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return AUTH_KINDS.has(value) ? value : "other";
}

function tool(present: boolean, version: unknown): DiagnosticsTool {
  return { present, version: present ? versionDigits(version) : null };
}

/** 상태 한 장에서 진단이 읽는 칸들 — 이 밖의 칸(이메일 · 실행 파일 경로 · 프로젝트 …)은 읽지 않는다. */
export interface DiagnosticsStatusFacts {
  claudeVersion: string | null;
  claudeExecutable: string | null;
  loggedIn: boolean;
  authMethod: string | null;
  subscriptionType: string | null;
  providers: Array<{
    id: string;
    available: boolean;
    version: string | null;
    loggedIn: boolean | null;
  }>;
}

/** 날것의 상태(`unknown`)에서 읽을 칸만 방어적으로 읽는다 — 모양이 달라도 던지지 않는다. */
export function statusFactsOf(value: unknown): DiagnosticsStatusFacts {
  const status = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const str = (key: string): string | null =>
    typeof status[key] === "string" ? (status[key] as string) : null;
  const providers = Array.isArray(status.providers)
    ? status.providers.flatMap((entry: unknown) => {
        if (typeof entry !== "object" || entry === null) return [];
        const row = entry as Record<string, unknown>;
        const id = safeWord(row.id);
        if (id === null || id === "other") return [];
        return [
          {
            id,
            available: row.available === true,
            version: typeof row.version === "string" ? row.version : null,
            loggedIn: typeof row.loggedIn === "boolean" ? row.loggedIn : null,
          },
        ];
      })
    : [];
  return {
    claudeVersion: str("claudeVersion"),
    claudeExecutable: str("claudeExecutable"),
    loggedIn: status.loggedIn === true,
    authMethod: str("authMethod"),
    subscriptionType: str("subscriptionType"),
    providers,
  };
}

/** 도구 탐지의 날 결과 — 버전은 날 문자열이어도 된다(숫자만 골라 싣는다). */
export interface RawTools {
  node: { present: boolean; version?: string | null };
  git: { present: boolean; version?: string | null };
  pnpm: { present: boolean; version?: string | null };
  bash: boolean;
}

export interface DiagnosticsInput {
  now: Date;
  appVersion: string | null | undefined;
  platform: string;
  osRelease: string | null | undefined;
  arch: string;
  nodeVersion: string | null | undefined;
  protocolVersion: number;
  tools: RawTools;
  status: DiagnosticsStatusFacts;
  turnStats: DiagnosticsTurnStats | null;
  /** 데몬 로그의 최근 줄들(`daemon-YYYY-MM-DD.log`) — 오류의 종류만 읽는다. */
  logLines: readonly string[];
}

/**
 * 모은 사실을 진단 요약으로 조립한다 — 순수 함수. 칸마다 읽을 것만 읽어 싣고(위의 작은 읽기들),
 * 입력에 이메일 · 경로 · 프로젝트 이름이 들어 있어도 출력에는 한 글자도 오지 않는다.
 */
export function buildDiagnosticsSummary(input: DiagnosticsInput): DiagnosticsSummary {
  const { status } = input;
  const ai =
    status.providers.length > 0
      ? status.providers.map((provider) => ({
          id: provider.id,
          present: provider.available,
          version: provider.available ? versionDigits(provider.version) : null,
          loggedIn: provider.loggedIn,
        }))
      : [
          {
            id: "claude",
            present: status.claudeExecutable !== null,
            version: status.claudeExecutable !== null ? versionDigits(status.claudeVersion) : null,
            loggedIn: status.claudeExecutable !== null ? status.loggedIn : null,
          },
        ];
  return {
    at: input.now.toISOString(),
    appVersion: versionDigits(input.appVersion),
    os: {
      platform: safeWord(input.platform, 12) ?? "other",
      release: versionDigits(input.osRelease),
      arch: safeWord(input.arch, 12) ?? "other",
    },
    protocolVersion: Number.isFinite(input.protocolVersion) ? input.protocolVersion : 0,
    nodeVersion: versionDigits(input.nodeVersion),
    tools: {
      node: tool(input.tools.node.present, input.tools.node.version),
      git: tool(input.tools.git.present, input.tools.git.version),
      pnpm: tool(input.tools.pnpm.present, input.tools.pnpm.version),
      bash: { present: input.tools.bash, version: null },
    },
    ai,
    account: { method: authKind(status.authMethod), plan: safeWord(status.subscriptionType) },
    turnStats: input.turnStats,
    errors: summarizeLogErrors(input.logLines, input.now),
  };
}

/**
 * 데몬 시작 로그의 환경 칸(2026-10-07) — 로그 한 줄이 어느 앱 · 어느 OS 의 것인지 말하게 한다. 베타의
 * 로그를 받은 담당자가 앱 버전 · OS · 아키텍처 · Node 메이저를 로그만 보고 안다. 숫자와 이름뿐이고
 * 경로 · 사용자 이름은 없다(진단 요약과 같은 걸러 읽기). 순수.
 */
export function startupLogFields(input: {
  appVersion: string | null | undefined;
  platform: string;
  osRelease: string | null | undefined;
  arch: string;
  nodeVersion: string;
}): Record<string, string | number | null> {
  const major = Number.parseInt(input.nodeVersion, 10);
  return {
    appVersion: versionDigits(input.appVersion),
    platform: safeWord(input.platform, 12) ?? "other",
    osRelease: versionDigits(input.osRelease),
    arch: safeWord(input.arch, 12) ?? "other",
    nodeMajor: Number.isFinite(major) ? major : null,
  };
}

// ---------------------------------------------------------------------------
// 순수: 로그의 오류 종류
// ---------------------------------------------------------------------------

/** 오류 종류 뒤에 덧붙여도 되는 식별자 — 요청 종류 · 단계 · 오류 이름 같은 짧은 영문 낱말. */
const KIND_ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,39}$/;
/**
 * 종류 안에 남을 수 없는 낱말 — 경로 · 이메일 자리표시 · 홈 표식 · 긴 16진수 · 긴 토큰. 긴 토큰의 하한은
 * 24자다(옛 41자는 `maskSecretShapes` 가 모르는 모양의 토큰 — 24~40자 — 을 지나게 했다, 2026-10-08 검토
 * FIX1). 종류의 낱말은 짧은 식별자다 — 데몬의 경고 · 오류 문장에서 24자 이상인 낱말을 찾지 못했다.
 */
const UNSAFE_TOKEN = /[\\/@~{}]|^[0-9a-f]{8,}$|^\S{24,}$/i;
const KIND_CHARS = 60;

/**
 * 로그 한 줄의 메시지 머리 — 첫 줄만, 정화를 한 번 더 지나고(데몬 로그는 쓸 때 이미 눌러 닫지만
 * 읽는 쪽도 믿지 않는다), 경로 · 이메일 · 긴 id 같은 낱말은 걷어낸다. 남는 것이 없으면 null.
 * 선택 칸은 안전한 식별자만 뒤에 붙인다: `type`(요청 종류) · `stage` · `what` · `mode` · `err.name`.
 */
function errorKindOf(message: string, fieldsJson: string | undefined): string | null {
  const firstLine = sanitizeText(message).split(" ⏎ ")[0] ?? "";
  const words = firstLine
    .split(/\s+/)
    .filter((word) => word !== "" && !UNSAFE_TOKEN.test(word))
    .join(" ")
    .slice(0, KIND_CHARS)
    .trim();
  if (words === "") return null;
  const extras: string[] = [];
  if (fieldsJson !== undefined) {
    try {
      const fields = JSON.parse(fieldsJson) as unknown;
      if (typeof fields === "object" && fields !== null) {
        const record = fields as Record<string, unknown>;
        for (const key of ["type", "stage", "what", "mode"]) {
          const value = record[key];
          if (typeof value === "string" && KIND_ID.test(value)) extras.push(value);
        }
        const err = record.err;
        if (typeof err === "object" && err !== null) {
          const name = (err as Record<string, unknown>).name;
          if (typeof name === "string" && KIND_ID.test(name)) extras.push(name);
        }
      }
    } catch {
      // 잘린 줄의 선택 칸은 없는 것으로 읽는다.
    }
  }
  return [words, ...extras].join(" · ");
}

/**
 * 로그의 줄들(`<ISO>\t<level>\t<message>[\t<json>]`)에서 최근 7일의 오류 · 경고 종류를 센다 — 순수.
 * 같은 종류(메시지 머리 + 안전한 식별자)는 하나로 모아 횟수와 마지막 시각을 싣고, 오류가 경고보다
 * 먼저, 각각 최근 순으로 `limit` 개까지. 읽을 수 없는 줄(잘린 머리 · 모르는 단계)은 건너뛴다.
 */
export function summarizeLogErrors(
  lines: readonly string[],
  now: Date,
  limit: number = ERROR_KINDS,
): DiagnosticsErrorKind[] {
  const horizon = now.getTime() - WINDOW_MS;
  const groups = new Map<string, DiagnosticsErrorKind & { lastMs: number }>();
  for (const line of lines) {
    const [stamp, level, message, fieldsJson] = line.split("\t");
    if (level !== "error" && level !== "warn") continue;
    const ms = Date.parse(stamp ?? "");
    if (!Number.isFinite(ms) || ms < horizon) continue;
    const kind = errorKindOf(message ?? "", fieldsJson);
    if (kind === null) continue;
    const key = `${level}\u0000${kind}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { level, kind, count: 1, lastAt: "", lastMs: ms });
    } else {
      group.count += 1;
      group.lastMs = Math.max(group.lastMs, ms);
    }
  }
  return [...groups.values()]
    .sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1) || b.lastMs - a.lastMs)
    .slice(0, Math.max(0, limit))
    .map(({ lastMs, ...rest }) => ({ ...rest, lastAt: new Date(lastMs).toISOString() }));
}

// ---------------------------------------------------------------------------
// 읽기: 프로세스 · 파일
// ---------------------------------------------------------------------------

/** 데몬 로그 파일 이름 — `daemon-YYYY-MM-DD.log`(log.ts 와 같은 모양). */
const LOG_FILE = /^daemon-(\d{4}-\d{2}-\d{2})\.log$/;

/** 창 안의 최근 로그 파일 이름들 — 새것부터 `LOG_FILES` 개. 순수. */
export function recentLogFiles(names: readonly string[], now: Date): string[] {
  const horizonDay = new Date(now.getTime() - WINDOW_MS).toISOString().slice(0, 10);
  return names
    .flatMap((name) => {
      const day = LOG_FILE.exec(name)?.[1];
      return day !== undefined && day >= horizonDay ? [{ name, day }] : [];
    })
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, LOG_FILES)
    .map((entry) => entry.name);
}

function readRecentLogLines(dir: string, now: Date): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const lines: string[] = [];
  for (const name of recentLogFiles(names, now)) {
    try {
      const text = readFileSync(join(dir, name), "utf8");
      lines.push(...text.slice(-LOG_TAIL_CHARS).split("\n"));
    } catch {
      // 한 파일을 못 읽어도 나머지로 센다.
    }
  }
  return lines;
}

/** 실행 파일에 `--version` 을 물어 날 글을 돌려준다 — 못 읽으면 null. Windows 의 `.cmd` 만 셸을 지난다. */
async function versionText(executable: string): Promise<string | null> {
  const shell = currentPlatform() === "win32" && /\.(?:cmd|bat)$/i.test(executable);
  try {
    const { stdout } = await run(shell ? `"${executable}"` : executable, ["--version"], {
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
      shell,
    });
    return stdout;
  } catch {
    return null;
  }
}

async function probeTools(): Promise<RawTools> {
  const [node, git, pnpm] = await Promise.all([
    resolveNodeVersion().catch(() => null),
    resolveGitExecutable().catch(() => null),
    resolvePnpmExecutable().catch(() => null),
  ]);
  const [gitText, pnpmText] = await Promise.all([
    git === null ? Promise.resolve(null) : versionText(git),
    pnpm === null ? Promise.resolve(null) : versionText(pnpm),
  ]);
  return {
    node: { present: node !== null, version: node?.version ?? null },
    git: { present: git !== null, version: gitText },
    pnpm: { present: pnpm !== null, version: pnpmText },
    bash:
      currentPlatform() === "win32"
        ? windowsBashPath(process.env) !== null
        : existsSync("/bin/bash"),
  };
}

export interface DiagnosticsDeps {
  /** 데몬의 상태 한 장(`status()`) — 날것이어도 된다. 못 읽으면 AI 칸만 비어 돌아간다. */
  status: () => Promise<unknown>;
  /** 앱 버전 — 데스크톱이 데몬에 넘긴 값. */
  appVersion?: () => string | null;
  now?: () => Date;
  /** 로그 폴더 — 시험이 임시 폴더를 넣는 길. 생략하면 `daemonLogDir()`. */
  logDir?: string;
}

/** 진단 요약을 모은다 — `diagnostics.summary` 요청의 답. 읽기뿐이다. */
export async function collectDiagnostics(deps: DiagnosticsDeps): Promise<DiagnosticsSummary> {
  const now = deps.now?.() ?? new Date();
  const logDir = deps.logDir ?? daemonLogDir();
  const [status, tools] = await Promise.all([deps.status().catch(() => null), probeTools()]);
  let turnStats: DiagnosticsTurnStats | null = null;
  try {
    turnStats = readTurnStatsSummary({ dir: logDir, now });
  } catch {
    turnStats = null;
  }
  return buildDiagnosticsSummary({
    now,
    appVersion: deps.appVersion?.() ?? null,
    platform: process.platform,
    osRelease: osRelease(),
    arch: osArch(),
    nodeVersion: process.versions.node,
    protocolVersion: PROTOCOL_VERSION,
    tools,
    status: statusFactsOf(status),
    turnStats,
    logLines: readRecentLogLines(logDir, now),
  });
}
