/**
 * atomic 분할의 검사 — 중간 커밋의 트리를 클론 밖 임시 폴더에 펼치고, 그
 * 스냅샷의 package.json 이 선언한 `check`(없으면 `typecheck`) 스크립트를
 * 잠금파일이 말하는 매니저로 돌린다. 지원하지 않는 레포는 `unavailable` —
 * 분할 성공으로 읽히면 안 된다.
 *
 * 규칙:
 * - 살아 있는 워킹 트리 · HEAD · 인덱스는 건드리지 않는다. 임시 GIT_INDEX_FILE
 *   에 `read-tree` 하고 `checkout-index --prefix` 로 펼친다. `checkout-index`
 *   는 차선의 쓰기 판정에 걸리므로 호출자가 차선을 쥐고 있어야 한다.
 * - 설치 · 네트워크는 돌리지 않는다. 검사 명령은 스냅샷이 선언한 것만이고,
 *   `pnpm_config_verify_deps_before_run=false` 로 매니저의 자동 설치도 막는다
 *   (repoCommandEnv 와 같은 규율).
 * - node_modules 는 살아 있는 클론의 것에 심볼릭 링크로 연결한다 — 링크 목표는
 *   기존 node_modules 뿐이고, 링크를 따라가는 검사가 그 안을 고칠 수 있다는
 *   한계는 감수한다(새 설치 대비의 타협).
 * - 결과 캐시는 하지 않는다 — 같은 트리라도 링크된 node_modules 내용이
 *   달라질 수 있어 맥락이 정확하다고 말할 수 없다.
 * - 출력(경로 · 내용)은 돌려주지 않는다 — 상태와 고정 코드만.
 * - timeoutMs 는 Git 펼치기와 검사 자식에 함께 적용한다. 상한 뒤에는
 *   프로세스 그룹을 끝내고 close 를 확인한 뒤 임시 폴더를 거둔다.
 */
import { type ChildProcess, spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { run, shellPlan } from "./child.js";
import { currentPlatform, resolvePnpmExecutable } from "./environment.js";
import { realpathBestEffort } from "./paths.js";
import { killTree } from "./preview-claim.js";
import { repoCommandEnv, workspacePackageJsons } from "./repo-bringup.js";
import type { RepoCore } from "./repo-core.js";

export type AtomicCheckStatus = "passed" | "failed" | "unavailable";

/** reason 의 고정 목록 — 숫자 · 코드 밖의 것(경로 · 출력)은 실리지 않는다. */
export type AtomicCheckReason =
  /** package.json 이 없거나 check/typecheck 스크립트가 없다. */
  | "no-check-script"
  /** 잠금파일이 없어 매니저를 고를 수 없다. */
  | "no-dependency-lock"
  /** 매니저 실행 파일을 찾지 못했다. */
  | "no-package-manager"
  /** 검사가 쓸 위치가 스냅샷 폴더 밖으로 새어 나간다. */
  | "checkout-escape"
  /** 트리를 펼치는 git 단계가 실패했다. */
  | "snapshot-error"
  /** 재사용할 모듈이 검사 사본 대신 살아 있는 프로젝트 소스를 가리킨다. */
  | "workspace-links"
  /** 검사 명령이 0이 아닌 코드로 끝났다. */
  | "check-failed"
  /** 총 시간 상한을 넘겼다. */
  | "check-timeout";

export interface AtomicCheckResult {
  status: AtomicCheckStatus;
  reason?: AtomicCheckReason;
  /** 벽시계 경과 — 실패 원인 판독의 재료. */
  ms: number;
}

export interface AtomicCheckInput {
  core: RepoCore;
  /** 검사할 트리 — 트리 · 커밋 · ref 어느 것이든 read-tree 가 받는 꼴. */
  tree: string;
  /** Git 펼치기와 검사 명령의 총 예산. 기본 2분. */
  timeoutMs?: number;
  /**
   * 스냅샷을 펼칠 임시 공간의 부모 — 클론 밖의 프로젝트 임시 자리.
   * 없으면 운영체제 임시 폴더(클론 밖은 지켜진다).
   */
  tmpRoot?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/** repo-config 의 LOCKFILES 와 같은 표 — 스냅샷 기준으로 다시 읽는다. */
const LOCKFILES: ReadonlyArray<readonly [string, "pnpm" | "npm" | "yarn" | "bun"]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["package-lock.json", "npm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
];

/** 검사 불가를 이미 아는 경우에는 Haiku 분류 비용도 쓰지 않는다. */
export async function atomicCheckPreflight(
  core: RepoCore,
  tree: string,
): Promise<AtomicCheckReason | null> {
  try {
    const listing = Buffer.from(
      await core.git(
        ["ls-tree", "-z", tree, "--", "package.json", ...LOCKFILES.map(([file]) => file)],
        core.root,
        {},
        true,
      ),
      "base64",
    ).toString("utf8");
    const files = new Set(
      listing
        .split("\0")
        .filter((row) => row.startsWith("100644 ") || row.startsWith("100755 "))
        .map((row) => row.slice(row.indexOf("\t") + 1)),
    );
    if (!files.has("package.json")) return "no-check-script";
    const raw = Buffer.from(
      await core.git(["show", `${tree}:package.json`], core.root, {}, true),
      "base64",
    ).toString("utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    if (
      ![parsed?.scripts?.check, parsed?.scripts?.typecheck].some(
        (value) => typeof value === "string" && value.trim() !== "",
      )
    )
      return "no-check-script";
    if (!LOCKFILES.some(([file]) => files.has(file))) return "no-dependency-lock";
    return null;
  } catch {
    return "snapshot-error";
  }
}

/**
 * 스냅샷 package.json 의 검사 스크립트 이름 — check 먼저, 없으면 typecheck.
 * 읽기 전에 파일이 폴더 안에 있는지 본다: 커밋된 symlink 가 클론 밖을
 * 가리키는 package.json 은 읽지 않는다(잠금파일도 lockedManager 안에서
 * 같은 판정을 거친다).
 */
function checkScriptName(workDir: string): string | null {
  if (!insideWork(workDir, join(workDir, "package.json"))) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(workDir, "package.json"), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const scripts = (parsed as Record<string, unknown>).scripts;
    if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return null;
    const table = scripts as Record<string, unknown>;
    if (typeof table.check === "string") return "check";
    if (typeof table.typecheck === "string") return "typecheck";
    return null;
  } catch {
    return null;
  }
}

/** 스냅샷의 잠금파일이 말하는 매니저 — repo-config 와 같은 우선순위. 없으면 null. */
function lockedManager(workDir: string): "pnpm" | "npm" | "yarn" | "bun" | null {
  for (const [file, manager] of LOCKFILES) {
    const path = join(workDir, file);
    if (existsSync(path) && insideWork(workDir, path)) return manager;
  }
  return null;
}

/** 파일(혹은 symlink)의 실제 자리가 스냅샷 폴더 안인가 — 밖을 가리키는 링크는 거짓. */
function insideWork(workDir: string, path: string): boolean {
  const realWork = realpathBestEffort(workDir);
  const real = realpathBestEffort(path);
  return real === realWork || real.startsWith(realWork + sep);
}

/**
 * 검사가 쓸 자리 — 스냅샷의 각 package.json 곁에 살아 있는 클론의
 * node_modules 를 심볼릭 링크로 잇는다. 스냅샷이 node_modules 를 추적하는
 * 자리나, 이미 뭔가 있는 자리는 건드리지 않는다.
 */
function linkDependencyTrees(core: RepoCore, workDir: string): boolean {
  const packageDirs = ["", ...workspacePackageJsons(workDir).map((p) => dirname(p))];
  for (const dir of packageDirs) {
    const liveModules = join(core.root, dir, "node_modules");
    if (!existsSync(liveModules)) continue;
    // pnpm workspace 링크를 그대로 쓰면 중간 사본 대신 마지막 작업 파일을
    // 읽을 수 있다. 그 결과를 중간 상태의 검사 통과로 기록하지 않는다.
    const entries = readdirSync(liveModules).flatMap((name) => {
      const path = join(liveModules, name);
      return name.startsWith("@") && lstatSync(path).isDirectory()
        ? readdirSync(path).map((child) => join(path, child))
        : [path];
    });
    const root = realpathBestEffort(core.root);
    if (
      entries.some((path) => {
        if (!lstatSync(path).isSymbolicLink()) return false;
        const real = realpathBestEffort(path);
        return (
          real.startsWith(root + sep) &&
          !real
            .slice(root.length + 1)
            .split(sep)
            .includes("node_modules")
        );
      })
    )
      return false;
    const target = join(workDir, dir, "node_modules");
    if (existsSync(target) || lstatSync(target, { throwIfNoEntry: false }) !== undefined) continue;
    mkdirSync(dirname(target), { recursive: true });
    // junction 은 POSIX 에서 무시되고 Windows 디렉터리 링크를 관리자 없이 만든다.
    symlinkSync(liveModules, target, "junction");
  }
  return true;
}

/** 매니저의 실행 파일을 찾는다 — 설치하러 가지 않고 이미 있는 것만 쓴다. */
async function managerExecutable(manager: string): Promise<string | null> {
  if (manager === "pnpm") return await resolvePnpmExecutable();
  const windows = currentPlatform() === "win32";
  const name = windows ? `${manager}.cmd` : manager;
  try {
    const { stdout } = await run(windows ? "where" : "which", [name]);
    return (
      stdout
        .split(/\r?\n/)
        .find((line) => line.trim() !== "")
        ?.trim() ?? null
    );
  } catch {
    return null;
  }
}

/**
 * work 약속의 결과 — 끝날 때까지 기다린 뒤 경과만 본다. 방치(race)하지
 * 않는다: checkout-index 같은 git 자식이 아직 쓰고 있는 폴더를 finally
 * 에서 지우면, 그 자식이 지워진 자리에 다시 쓰며 폴더를 되살린다.
 * deadline 을 넘기면 "timeout" — 호출자가 다음 단계를 시작하지 않는다.
 */
async function afterDeadline<T>(work: Promise<T>, deadline: number): Promise<T | "timeout"> {
  const value = await work;
  return Date.now() >= deadline ? "timeout" : value;
}

/** 검사 자식의 결과 — 출력은 거두지 않는다(규칙: 경로 · 내용 X). */
type CheckOutcome =
  | { kind: "exit"; code: number | null }
  | { kind: "spawn-error" }
  | { kind: "timeout" };

/**
 * 스냅샷 트리 하나를 검사한다. 결과가 `passed` 일 때만 그 트리는 검증된
 * 커밋이다 — `failed` 와 `unavailable` 은 둘 다 증명이 아니다.
 *
 * 이 함수는 git 쓰기 판정에 걸리는 명령(checkout-index)을 쓰므로 호출자가
 * 차선을 쥐고 부른다(또는 차선 작업 안에서 부른다).
 */
export async function validateAtomicTree(input: AtomicCheckInput): Promise<AtomicCheckResult> {
  const started = Date.now();
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = started + timeoutMs;
  const env = repoCommandEnv(process.env);
  const parent = input.tmpRoot ?? tmpdir();

  let tempDir: string | null = null;
  try {
    // state(임시 인덱스)와 checkout(펼친 트리)은 나눈다 — 레포에 `index`
    // 같은 추적 파일이 있어도 인덱스 파일과 이름이 부딪히지 않게.
    tempDir = mkdtempSync(join(parent, "atomic-check-"));
    const indexFile = join(tempDir, "state", "index");
    const work = join(tempDir, "checkout");
    mkdirSync(dirname(indexFile), { recursive: true });
    mkdirSync(work, { recursive: true });
    const gitEnv = { GIT_INDEX_FILE: indexFile };
    const git = (args: string[], binary = false) =>
      afterDeadline(
        input.core.git(args, input.core.root, gitEnv, binary, Math.max(1, deadline - Date.now())),
        deadline,
      );

    // 스냅샷 펼치기 — 임시 인덱스에 트리를 싣고 그 인덱스대로 파일만 쓴다.
    // 워킹 트리 · HEAD · 진짜 인덱스는 건드리지 않는다.
    if ((await git(["read-tree", input.tree])) === "timeout") {
      return { status: "failed", reason: "check-timeout", ms: Date.now() - started };
    }
    // -z 목록은 큰 레포에서 1MB 꼬리 자르기에 걸리므로 bytes 로 읽어 푼다.
    const listing = await git(["ls-files", "-z"], true);
    if (listing === "timeout") {
      return { status: "failed", reason: "check-timeout", ms: Date.now() - started };
    }
    const files = Buffer.from(listing, "base64")
      .toString("utf8")
      .split("\0")
      .filter((path) => path !== "");
    if ((await git(["checkout-index", "-f", "-a", `--prefix=${work}${sep}`])) === "timeout") {
      return { status: "failed", reason: "check-timeout", ms: Date.now() - started };
    }

    // checkout 대상이 폴더 밖으로 새는지 — git 이 쓰는 경로의 부모가 모두
    // 스냅샷 폴더 안에 있어야 한다(잎이 symlink 면 git 이 파일 자체로 쓴다).
    const realWork = realpathBestEffort(work);
    const escapes = files.some((path) => {
      const realParent = realpathBestEffort(dirname(join(work, path)));
      return realParent !== realWork && !realParent.startsWith(realWork + sep);
    });
    if (escapes)
      return { status: "unavailable", reason: "checkout-escape", ms: Date.now() - started };

    const script = checkScriptName(work);
    if (script === null) {
      return { status: "unavailable", reason: "no-check-script", ms: Date.now() - started };
    }
    const manager = lockedManager(work);
    if (manager === null) {
      return { status: "unavailable", reason: "no-dependency-lock", ms: Date.now() - started };
    }
    const executable = await afterDeadline(managerExecutable(manager), deadline);
    if (executable === "timeout") {
      return { status: "failed", reason: "check-timeout", ms: Date.now() - started };
    }
    if (executable === null) {
      return { status: "unavailable", reason: "no-package-manager", ms: Date.now() - started };
    }

    try {
      if (!linkDependencyTrees(input.core, work)) {
        return { status: "unavailable", reason: "workspace-links", ms: Date.now() - started };
      }
    } catch {
      // 링크를 못 만들면 의존성이 다른 상태다 — 검사하지 않은 것으로 둔다.
      return { status: "unavailable", reason: "snapshot-error", ms: Date.now() - started };
    }

    if (deadline - Date.now() <= 0) {
      return { status: "failed", reason: "check-timeout", ms: Date.now() - started };
    }
    const outcome = await runManager(executable, script, work, env, deadline);
    const ms = Date.now() - started;
    if (outcome.kind === "timeout") return { status: "failed", reason: "check-timeout", ms };
    if (outcome.kind === "spawn-error") {
      return { status: "unavailable", reason: "no-package-manager", ms };
    }
    return outcome.code === 0
      ? { status: "passed", ms }
      : { status: "failed", reason: "check-failed", ms };
  } catch {
    return Date.now() >= deadline
      ? { status: "failed", reason: "check-timeout", ms: Date.now() - started }
      : { status: "unavailable", reason: "snapshot-error", ms: Date.now() - started };
  } finally {
    // 성공 · 실패 · 예외 어디로 끝나도 임시 폴더는 거둔다 — 링크만 지워지고
    // 링크가 가리키던 클론의 node_modules 는 그대로다.
    if (tempDir !== null) rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * `<manager> run <script>` 를 스냅샷 폴더에서 돌린다 — 실행 파일은 resolve
 * 된 절대 경로 그대로 쓴다(매니저 이름으로 다시 찾지 않는다). 벽시계 상한을
 * 넘기면 트리째 끝내고, 자식이 실제로 닫힐 때까지 기다린 뒤에야 timeout 을
 * 돌린다 — 호출자의 폴더 청소가 살아 있는 자식과 겹치지 않게.
 * 출력은 흡수만 하고 버린다(로그에 내용 X). POSIX 에서는 detached 로
 * 프로세스 그룹을 만들어 killTree 가 그룹을 친다.
 */
function runManager(
  executable: string,
  script: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  deadline: number,
): Promise<CheckOutcome> {
  const windows = currentPlatform() === "win32";
  const plan = shellPlan(currentPlatform(), executable, ["run", script]);
  const { promise, resolve } = Promise.withResolvers<CheckOutcome>();
  let child: ChildProcess;
  try {
    child = spawn(plan.command, plan.args, {
      cwd,
      env,
      shell: plan.shell,
      detached: !windows,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch {
    resolve({ kind: "spawn-error" });
    return promise;
  }
  let settled = false;
  const finish = (outcome: CheckOutcome) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(outcome);
  };
  const timer = setTimeout(
    () => {
      try {
        killTree(child, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      // kill 을 요청했을 뿐 아직 닫히지 않았다 — close 가 와야 timeout 확정.
      timeoutConfirmed = true;
    },
    Math.max(1, deadline - Date.now()),
  );
  timer.unref();
  let timeoutConfirmed = false;
  // 파이프가 차면 자식이 멈춘다 — 내용은 버리되 흡수는 한다.
  child.stdout?.resume();
  child.stderr?.resume();
  child.once("error", () => finish({ kind: "spawn-error" }));
  child.once("close", (code) =>
    finish(timeoutConfirmed ? { kind: "timeout" } : { kind: "exit", code }),
  );
  return promise;
}
