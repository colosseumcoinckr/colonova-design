/**
 * 에이전트 설치 진행기 (1단계): Claude Code 의 설치를 데몬이 끝까지
 * 지켜본다. 옛 길(startClaudeInstall)은 설치 스크립트를 파이프로 흘려 받았다 —
 * 네트워크가 막혀 빈 입력을 받은 bash 가 종료 코드 0 을 내는 세계에서 실패를
 * 성공으로 셌다. 여기서는 스크립트를 파일로 받아 실행하고, 끝은 종료 코드와
 * 실행 파일의 실존이 함께 판정한다(0 인데 파일이 없으면 실패). 진행 줄과 끝은
 * 방송으로만 나간다(onboarding.install.progress · done). 관리자 권한은 한 줄도
 * 없다 — Claude 의 설치 스크립트는 사용자 홈 안에서 끝난다.
 */

import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentInstallKind } from "@colonova-design/protocol";
import { withoutAppSecrets, withoutSelfUpdate } from "./agent-env.js";
import { resolveClaudeExecutable } from "./environment.js";
import type { SpawnLike } from "./onboarding.js";

/** 설치 전체의 시간 상한 — 넘으면 자식을 끊고 실패로 끝낸다. */
const INSTALL_TIMEOUT_MS = 15 * 60_000;
/** 설치 스크립트를 받는 시간 상한 — 파일로 받아야 실패 코드가 제대로 나온다. */
const SCRIPT_FETCH_TIMEOUT_MS = 30_000;
/** 진행 줄 방송의 최소 간격 — 1단계 실측에서 4 초에 19 번 나가는 것을 막는다. */
const PROGRESS_MIN_INTERVAL_MS = 1_000;

const CLAUDE_INSTALL_SH = "https://claude.ai/install.sh";
const CLAUDE_INSTALL_PS1 = "https://claude.ai/install.ps1";

const ALREADY_RUNNING = "설치가 이미 진행 중이에요 — 잠시만 기다려 주세요.";
const CLAUDE_STARTED = "Claude Code 설치를 시작했어요 — 진행 상황을 보여 드릴게요.";
const CLAUDE_UPDATE_STARTED = "Claude Code 업데이트를 시작했어요 — 진행 상황을 보여 드릴게요.";
const INSTALL_TIMEOUT_DETAIL =
  "설치가 너무 오래 걸려 멈췄어요 — 네트워크를 확인하고 다시 시도해 주세요.";
const MISSING_EXECUTABLE = "설치가 끝났지만 실행 파일을 찾지 못했어요 — 다시 시도해 주세요.";

export interface AgentInstallEvents {
  onProgress(line: string): void;
  /**
   * 설치의 끝. ok 일 때 executable 은 성공 판정에 쓴 그 경로다 — 데몬이 시작 때
   * 한 번 푼 경로를 이 값으로 갱신한다.
   */
  onDone(ok: boolean, detail: string, executable?: string | null): void;
}

/** 시험 구멍 — env · 자식 실행 · 해석을 갈아 끼워 실제 설치 없이 검증한다. */
export interface AgentInstallDeps {
  env?: NodeJS.ProcessEnv;
  platform?: string;
  fetchLike?: typeof fetch;
  spawnLike?: SpawnLike;
  resolveClaude?: () => Promise<string | null>;
  /** 전체 시간 상한(시험용 주입) — 기본 15 분. */
  timeoutMs?: number;
  /** 진행 줄 방송의 최소 간격(시험용 주입) — 기본 1 초(1단계 실측 보완). */
  progressIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// 진행 줄 다듬기 — 순수 함수
// ---------------------------------------------------------------------------

/** ANSI 이스케이프(색 이상의 CSI 전부)를 지운다. */
export function stripAnsiCodes(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI 이스케이프 시퀀스(\u001b[…m)를 벗기는 게 목적이다.
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/**
 * PATH 안내 문단의 표식들 — 앱은 절대 경로로 CLI 를 찾으므로 화면에 올리지
 * 않는다. 실측: mac 설치 스크립트가 이 문단을 두 번 내며, 머리 줄
 * `⚠ Setup notes:` 부터가 그 문단의 시작이다(1단계 실측 보완).
 */
const PATH_GUIDANCE_MARKERS = ["not in your path", "shell config", "export path", "setup notes"];

/**
 * 출력의 마지막 의미 있는 한 줄. ANSI 를 지우고, 빈 줄과 PATH 안내 문단을
 * 버린다. includePartialLastLine 이 false 면 줄이 완결된(개행까지 온) 것만
 * 본다 — 진행 방송이 미완의 마지막 줄을 두 번 울리지 않게 하는 소재.
 */
export function meaningfulInstallLine(
  output: string,
  includePartialLastLine = true,
): string | null {
  const complete = includePartialLastLine ? output : output.slice(0, output.lastIndexOf("\n") + 1);
  const lines = stripAnsiCodes(complete)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const meaningful = lines.filter((line) => {
    const low = line.toLowerCase();
    return !PATH_GUIDANCE_MARKERS.some((marker) => low.includes(marker));
  });
  return meaningful.at(-1) ?? null;
}

// ---------------------------------------------------------------------------
// 실패 분류 — 순수 함수
// ---------------------------------------------------------------------------

export type InstallFailureReason = "network" | "policy" | "disk" | "other";
export interface InstallFailure {
  reason: InstallFailureReason;
  detail: string;
}

/** curl 이 스스로 고백하는 네트워크 실패의 종료 코드(6 해석 실패 · 7 연결 · 28 시간초과). */
const CURL_NETWORK_EXIT_CODES = new Set([6, 7, 28]);
const NETWORK_MARKERS = [
  "could not resolve",
  "failed to connect",
  "failed to get latest version",
  "unable to connect",
  "the remote name could not be resolved",
  "timed out",
];
const POLICY_MARKERS = [
  "running scripts is disabled",
  "executionpolicy",
  "constrainedlanguage",
  "access is denied",
  "is blocked",
  "applocker",
];
const DISK_MARKERS = ["no space left", "not enough space", "enospc"];

/** IT 담당자에게 그대로 보낼 복사용 한 줄 — policy 분류의 detail 뒤에 붙는다. */
const POLICY_COPY_LINE =
  "ColoNova Design 이 Claude Code 를 사용자 폴더에 설치하려고 해요(https://claude.ai/install.ps1 또는 install.sh). 이 설치를 허용해 주세요.";

/**
 * 설치 실패를 네 가지로 나눠 한국어 문장을 만든다. platform 은 curl 종료 코드의
 * 해석에만 쓴다 — PowerShell 은 같은 숫자를 다른 뜻으로 쓰므로 win32 에서는
 * 문장만 본다.
 */
export function classifyInstallFailure(
  output: string,
  exitCode: number | null,
  platform: string,
): InstallFailure {
  const text = output.toLowerCase();
  if (
    (platform !== "win32" && exitCode !== null && CURL_NETWORK_EXIT_CODES.has(exitCode)) ||
    NETWORK_MARKERS.some((marker) => text.includes(marker))
  ) {
    return { reason: "network", detail: "인터넷 연결을 확인한 뒤 다시 시도해 주세요." };
  }
  if (
    POLICY_MARKERS.some((marker) => text.includes(marker)) ||
    /\b403\b/.test(text) ||
    text.includes("forbidden")
  ) {
    return {
      reason: "policy",
      detail: `회사 PC 정책이 설치를 막은 것 같아요. 아래 문장을 IT 담당자에게 보내 주세요.\n${POLICY_COPY_LINE}`,
    };
  }
  if (DISK_MARKERS.some((marker) => text.includes(marker))) {
    return {
      reason: "disk",
      detail: "디스크 공간이 부족해요 — 공간을 비운 뒤 다시 시도해 주세요.",
    };
  }
  const last = meaningfulInstallLine(output);
  return {
    reason: "other",
    detail: last
      ? `설치가 실패했어요 — 다시 시도해 주세요.\n${last.slice(0, 200)}`
      : "설치가 실패했어요 — 다시 시도해 주세요.",
  };
}

/** fetch 실패의 즉답 — classify 의 network 판정 그대로(문장의 둘째 근거지). */
const NETWORK_FAILURE: InstallFailure = classifyInstallFailure("", null, "darwin");

// ---------------------------------------------------------------------------
// 자식 실행 — 진행 줄을 뽑으며 끝을 기다린다
// ---------------------------------------------------------------------------

interface ChildOutcome {
  exitCode: number | null;
  output: string;
}

/**
 * stdio 파이프로 자식을 띄워 끝까지 지켜본다. 완결된 줄의 마지막 의미 있는
 * 한 줄이 바뀔 때만 onLine 을 부른다(같은 줄의 반복은 다시 보내지 않는다).
 */
function runInstallChild(
  spawnLike: SpawnLike,
  command: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; signal: AbortSignal; onLine?: (line: string) => void },
): Promise<ChildOutcome> {
  const { promise, resolve: resolveRun } = Promise.withResolvers<ChildOutcome>();
  let child: ReturnType<SpawnLike>;
  try {
    child = spawnLike(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: opts.env,
      signal: opts.signal,
    });
  } catch (error) {
    resolveRun({ exitCode: null, output: String(error) });
    return promise;
  }
  let output = "";
  let lastLine: string | null = null;
  const feed = (chunk: Buffer | string) => {
    output += String(chunk);
    const line = meaningfulInstallLine(output, false);
    if (line && line !== lastLine) {
      lastLine = line;
      opts.onLine?.(line);
    }
  };
  child.stdout?.on("data", feed);
  child.stderr?.on("data", feed);
  child.once("error", (error: Error) => {
    resolveRun({ exitCode: null, output: `${output}${output ? "\n" : ""}${String(error)}` });
  });
  child.once("close", (code) => resolveRun({ exitCode: code, output }));
  return promise;
}

// ---------------------------------------------------------------------------
// 설치 진행기 — 종류마다 하나씩만 돈다
// ---------------------------------------------------------------------------

interface InstallFlowContext {
  env: NodeJS.ProcessEnv;
  platform: string;
  fetchLike: typeof fetch;
  spawnLike: SpawnLike;
  signal: AbortSignal;
  progress(line: string): void;
}

export class AgentInstall {
  private readonly running = new Map<AgentInstallKind, { cancel(): void }>();

  constructor(private readonly deps: AgentInstallDeps = {}) {}

  isRunning(kind: AgentInstallKind): boolean {
    return this.running.has(kind);
  }

  start(
    kind: AgentInstallKind,
    events: AgentInstallEvents,
  ): { started: boolean; guidance: string } {
    if (this.running.has(kind)) return { started: false, guidance: ALREADY_RUNNING };
    const controller = new AbortController();
    let cancelled = false;
    // 진행 줄의 방송은 1 초에 한 번 이하(1단계 실측 보완): 그 사이 온 줄은
    // 마지막 것만 기억해 두었다가 간격이 차면 나간다.
    const intervalMs = this.deps.progressIntervalMs ?? PROGRESS_MIN_INTERVAL_MS;
    let lastSentAt = 0;
    let pendingLine: string | null = null;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    const dropPending = () => {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      pendingLine = null;
    };
    const flushPending = () => {
      if (cancelled) {
        dropPending();
        return;
      }
      const line = pendingLine;
      dropPending();
      if (line) {
        lastSentAt = Date.now();
        events.onProgress(line);
      }
    };
    const ctx: InstallFlowContext = {
      env: this.deps.env ?? process.env,
      platform: this.deps.platform ?? process.platform,
      fetchLike: this.deps.fetchLike ?? fetch,
      spawnLike: this.deps.spawnLike ?? spawn,
      signal: controller.signal,
      progress: (line) => {
        if (cancelled || !line) return;
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          pendingTimer = null;
        }
        if (Date.now() - lastSentAt >= intervalMs) {
          pendingLine = null;
          lastSentAt = Date.now();
          events.onProgress(line);
          return;
        }
        pendingLine = line;
        pendingTimer = setTimeout(() => flushPending(), intervalMs - (Date.now() - lastSentAt));
        pendingTimer.unref?.();
      },
    };
    const entry = {
      cancel: () => {
        cancelled = true;
        dropPending();
        controller.abort();
      },
    };
    this.running.set(kind, entry);
    const timer = setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      dropPending();
      controller.abort();
      this.running.delete(kind);
      events.onDone(false, INSTALL_TIMEOUT_DETAIL);
    }, this.deps.timeoutMs ?? INSTALL_TIMEOUT_MS);
    timer.unref?.();
    const finish = (ok: boolean, detail: string, executable?: string | null) => {
      clearTimeout(timer);
      if (cancelled) return;
      // 끝의 문장보다 먼저, 스로틀에 붙들린 마지막 진행 줄을 내보낸다.
      flushPending();
      if (cancelled) return;
      this.running.delete(kind);
      events.onDone(ok, detail, executable);
    };
    // 업데이트(PLAN-UI U12)는 설치와 같은 길을 탄다 — 다른 것은 끝의 문장과
    // 설치 스크립트에 건네는 `latest` 뿐이다.
    const update = kind === "update-claude";
    void this.installClaude(ctx, update).then(
      (result) => finish(result.ok, result.detail, result.executable),
      (error) => finish(false, classifyInstallFailure(String(error), null, ctx.platform).detail),
    );
    return { started: true, guidance: update ? CLAUDE_UPDATE_STARTED : CLAUDE_STARTED };
  }

  /** 진행 중인 설치를 모두 끊는다 — 재시작의 앞단계와 데몬 종료가 부른다. */
  stop(): void {
    for (const entry of this.running.values()) entry.cancel();
    this.running.clear();
  }

  // -------------------------------------------------------------------
  // Claude Code — 설치 스크립트를 파일로 받아 실행한다
  // -------------------------------------------------------------------

  private async installClaude(
    ctx: InstallFlowContext,
    update = false,
  ): Promise<{ ok: boolean; detail: string; executable?: string | null }> {
    // 업데이트는 스크립트에 `latest` 를 건넨다 — 확인(agent-update.ts)이 읽는
    // 것과 같은 `latest` 파일의 버전이 깔리게. 설치는 스크립트의 기본 그대로.
    const target = update ? ["latest"] : [];
    // 시험용 대체: 스크립트 대신 이 명령을 셸로 실행한다(검수자가 성공·실패·
    // 느린 진행을 흉내 낸다). 실기 실행에서는 비어 있다. 대상은 sh 에서 $1,
    // Windows(PowerShell)에서 $args[0] 이다. `-Command` 는 뒤 인자를 명령 글에 이어 붙일 뿐
    // 위치 인자를 주지 않는다 — 명령을 스크립트 블록으로 감싸 대상을 건넌다(2026-10-19).
    const override = ctx.env.COLONOVA_DESIGN_CLAUDE_INSTALL_CMD;
    let scriptPath: string | null = null;
    let command: string;
    let args: string[];
    if (override) {
      [command, args] =
        ctx.platform === "win32"
          ? ["powershell", ["-NoProfile", "-Command", `& {\n${override}\n}`, ...target]]
          : ["sh", ["-c", override, "sh", ...target]];
    } else {
      const url = ctx.platform === "win32" ? CLAUDE_INSTALL_PS1 : CLAUDE_INSTALL_SH;
      let script: string;
      try {
        script = await fetchText(url, ctx);
      } catch {
        // fetch 실패는 곧바로 네트워크 실패 — 자식을 띄우지 않는다.
        return { ok: false, detail: NETWORK_FAILURE.detail };
      }
      // 빈 몸통을 받은 bash 는 0 으로 정상 종료한다 — 실패를 성공으로 세는 옛
      // 함정이므로 역시 시작하지 않는다.
      if (script.trim().length === 0) return { ok: false, detail: NETWORK_FAILURE.detail };
      const ext = ctx.platform === "win32" ? "ps1" : "sh";
      scriptPath = join(
        tmpdir(),
        `colonova-claude-install-${process.pid}-${Math.random().toString(36).slice(2)}.${ext}`,
      );
      // Windows PowerShell 5.1 은 BOM 없는 .ps1 을 시스템 코드 페이지(한국어 Windows 는 CP949)로 읽는다.
      // 스크립트에 `✔` 같은 비 ASCII 글자가 하나만 들어도 따옴표가 먹혀 파싱이 깨졌다
      // (InvalidEndOfLine, 2026-10-19 Windows 시험). UTF-8 BOM 을 붙이면 5.1 과 7 이 모두 UTF-8 로 읽는다.
      await writeFile(
        scriptPath,
        ext === "ps1" && !script.startsWith("\uFEFF") ? `\uFEFF${script}` : script,
        "utf8",
      );
      // 정책 우회(-ExecutionPolicy Bypass)는 이 프로세스의 이 실행 범위만 —
      // 관리자도 시스템 설정도 필요 없다.
      command = ctx.platform === "win32" ? "powershell" : "bash";
      args =
        ctx.platform === "win32"
          ? [
              "-NoProfile",
              "-NonInteractive",
              "-ExecutionPolicy",
              "Bypass",
              "-Command",
              windowsScriptCommand(scriptPath, update ? ["-Target", "latest"] : []),
            ]
          : [scriptPath, ...target];
    }
    try {
      const outcome = await runInstallChild(ctx.spawnLike, command, args, {
        // 설치가 부르는 `claude install` 도 Claude 자식이다 — 자기 업데이트를
        // 끄고 앱의 자격도 거른다(2026-10-23 · 최종 구현 계획 F0).
        env: withoutSelfUpdate(withoutAppSecrets(ctx.env)),
        signal: ctx.signal,
        onLine: ctx.progress,
      });
      if (outcome.exitCode !== 0) {
        return {
          ok: false,
          detail: classifyInstallFailure(outcome.output, outcome.exitCode, ctx.platform).detail,
        };
      }
      // 성공 판정에 쓴 경로를 그대로 흘려 보낸다 — 데몬이 시작 때 푼 경로를
      // 이 값으로 갱신해야 로그인 버튼이 방금 설치한 CLI 를 안다.
      const executable = await (this.deps.resolveClaude ?? resolveClaudeExecutable)();
      return executable
        ? {
            ok: true,
            detail: update
              ? "Claude Code 를 새 버전으로 바꿨어요."
              : "Claude Code 설치가 끝났어요.",
            executable,
          }
        : { ok: false, detail: MISSING_EXECUTABLE };
    } finally {
      if (scriptPath) await rm(scriptPath, { force: true }).catch(() => undefined);
    }
  }
}

/**
 * Windows 설치 스크립트의 실행 문장. 출력 인코딩을 UTF-8 로 정한 뒤 스크립트를 부르고 그 종료 코드로 끝낸다.
 * `-File` 로 부르면 콘솔이 없는 자식의 출력이 시스템 코드 페이지(한국어 Windows 는 CP949)로 나와,
 * 데몬이 UTF-8 로 읽을 때 `✔` 는 `?` 가 되고 PowerShell 의 한국어 오류 문장은 깨졌다(2026-10-19 실측).
 * 스크립트 첫 줄에 넣을 수는 없다 — install.ps1 은 param 블록으로 시작한다. 종료 코드는 `exit N` ·
 * throw · 정상 끝에서 `-File` 과 같다. 다른 것은 마지막 네이티브 명령이 실패한 채 정상으로 끝나는
 * 경우뿐인데, install.ps1 은 그 코드를 받아 스스로 exit 한다.
 */
export function windowsScriptCommand(scriptPath: string, args: readonly string[]): string {
  // 작은따옴표 안은 글자 그대로다 — 작은따옴표만 두 번 쓴다. `-Target` 같은 이름은 그대로 둔다.
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const words = args.map((value) => (value.startsWith("-") ? value : quote(value)));
  return [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    ["&", quote(scriptPath), ...words].join(" "),
    "exit $LASTEXITCODE",
  ].join("\n");
}

/** 설치 스크립트 받기 — 실패는 곧바로 네트워크 실패다. */
async function fetchText(url: string, ctx: InstallFlowContext): Promise<string> {
  const response = await ctx
    .fetchLike(url, {
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(SCRIPT_FETCH_TIMEOUT_MS)]),
    })
    .catch(() => null);
  if (!response?.ok) throw new Error("network");
  return await response.text();
}
