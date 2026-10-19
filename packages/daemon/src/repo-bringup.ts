// Bring-up: clone → config → install → preview. Owns the preview
// process itself (startPreview/killPreview), plus the install short-circuit
// and the bring-up error taxonomy.
import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { RepoErrorKind, RepoStatus } from "@colonova-design/protocol";
import { extraPathPrefix, sanitizeRepoAgentSettings, trustWorkspace } from "./claude-trust.js";
import { mergeNpmrc, npmrcPath } from "./credentials.js";
import {
  currentPlatform,
  detectsRegistryAuthFailure,
  resolvePnpmExecutable,
} from "./environment.js";
import { createFileLogger } from "./log.js";
import {
  daemonOwnedPorts,
  descendantPids,
  descendantsOf,
  killPidTree,
  killTree,
  commandLineMentions,
  pidCommandLines,
  pidListeningPorts,
  probePreviewUrl,
  processSnapshot,
} from "./preview-claim.js";
import { warmTrackedFiles } from "./tree-warm.js";
import { detectPreview } from "./preview-detection.js";
import {
  PREVIEW_COMMAND_UNKNOWN,
  type RepoConfig,
  resolveRepoConfig,
  scopeOf,
} from "./repo-config.js";
import {
  COMMAND_STALL_MS,
  COMMANDS_UNAPPROVED_DETAIL,
  detailOf,
  GATE_OUTPUT_TAIL_LINES,
  INSTALL_MARKER,
  PNPM_MISSING_DETAIL,
  PreviewPortUndetectedError,
  READY_TIMEOUT_MS,
  RECOVER_CONFLICT_DETAIL,
  REFRESH_CONFLICT_DETAIL,
  REGISTRY_AUTH_DETAIL,
  REPO_URL_MISSING_DETAIL,
  type RepoCore,
  redact,
} from "./repo-core.js";

export class BringUp {
  constructor(private readonly core: RepoCore) {}

  /** C5: 서버가 저절로 꺼졌을 때 남은 저절로 다시 켜기 시도 수. */
  private previewRestarts = 0;

  /** 도는 중인 작업 폴더 데우기 — 같은 일을 걹쳐 띄우지 않는다. */
  private warming: Promise<void> | null = null;

  /**
   * Windows: 클론의 추적 파일을 함께 열어 둔다(tree-warm.ts, 2026-10-20). 기다리지 않는다 —
   * 최신화 · 설치 · 미리보기 기동과 함께 돌아야 뒤의 명령이 덕을 본다. macOS 는 무동작이다.
   */
  private warmTree(): void {
    if (this.warming !== null) return;
    this.warming = warmTrackedFiles(this.core.root)
      .then((result) => {
        if (result) createFileLogger().info("작업 폴더 데우기", result);
      })
      .catch(() => undefined)
      .finally(() => {
        this.warming = null;
      });
  }

  // -------------------------------------------------------------------------
  // Bootstrap
  // -------------------------------------------------------------------------

  async bootstrap(): Promise<RepoStatus> {
    try {
      if (!this.core.url) {
        this.core.setPhase("missing", REPO_URL_MISSING_DETAIL);
        return this.core.snapshot();
      }

      // PLAN-UI U8: 처음 여는 프로젝트의 준비 — 아래의 전환 울타리가 설치까지는
      // 배경에서 잇게 한다.
      const firstPrep = !this.core.isCloned();
      // 단계별 시간(2026-10-20) — 끝의 "준비 시간" 한 줄이 느린 단계를 말한다.
      const spans: Record<string, number> = {};
      const started = performance.now();
      let mark = started;
      const lap = (name: string) => {
        const now = performance.now();
        spans[name] = Math.round(now - mark);
        mark = now;
      };
      // 최신화 전의 단계 — 활성이 아닌 프로젝트는 아래 울타리에서 나가므로 그때 되돌린다.
      const before = this.core.phase;
      if (firstPrep) {
        await this.killPreview();
        this.core.setPhase("cloning", null);
        this.clearBringUpDebris();
        // The clean url: the PAT travels in the environment (gitAuthEnv),
        // so neither `.git/config` nor `ps` ever sees it.
        // clone 만 차선에 태운다(PLAN L1) — bootstrap 전체가 줄을 잡으면
        // 설치와 미리보기 기동이 몇 분씩 다른 git 손을 막는다.
        const cloneArgs = ["clone", this.core.url, this.core.root];
        await this.core.lane.run("hygiene", () =>
          this.core.git(cloneArgs, dirname(this.core.root)),
        );
        trustWorkspace(this.core.root);
        sanitizeRepoAgentSettings(this.core.root);
        // 갓 체크아웃한 파일은 모두 처음 읽힌다 — 설치의 사전 생성 스크립트가 덕을 본다.
        this.warmTree();
      } else {
        // 활성 프로젝트만 — 떠난 프로젝트의 최신화는 미리보기를 켜지 않는다.
        if (this.core.active) this.warmTree();
        this.core.setPhase("pulling", null);
        await this.core.scrubOriginCredential();
        // Already cloned: 최신화, not a blind ff. Unsaved work survives the
        // move off-cycle, and a conflict left by an earlier run resurfaces
        // with its Korean reason instead of a raw git error.
        await this.core.refreshFromRemote();
        // 원격이 .claude/settings.json 을 갱신해 권한 확장이 돌아왔을 수
        // 있다 — 클론 길에서와 같은 칼을 다시 댄다(이미 깨끗하면 무동작).
        sanitizeRepoAgentSettings(this.core.root);
      }
      lap(firstPrep ? "cloneMs" : "pullMs");

      // 설정이 못 읽는 것(명령 없음 · 깨진 JSON)은 그대로 오류 카드로 —
      // AI 에게 해결 요청이 이 레포를 고치는 길이다.
      const config = resolveRepoConfig(this.core.root);
      this.core.config = config;
      // The one gate the wire cannot skip: a repo nobody has vouched for
      // stops here, after the clone but before any command it declares runs.
      // 저장's check and 넘기기's build wait behind a planner's button press
      // already — install and preview are the ones that run unattended.
      // The verdict names WHAT runs: the approval is one button, so the card
      // must show the sentences it is about to execute — the planner reads the
      // verdict, a reviewer reads the evidence.
      if (!this.core.commandsApproved) {
        throw new Error(
          `${COMMANDS_UNAPPROVED_DETAIL} 실행하려는 명령 — 설치: ${config.install ?? "(선언되지 않음)"} · 미리보기: ${config.preview.command}`,
        );
      }
      // The switch race's fence: a bring-up this project no longer owns
      // stops here — install and preview are the unattended side effects,
      // and a late finisher would otherwise kill the port the project the
      // planner switched TO just started serving on. 처음 여는 프로젝트의
      // 설치는 예외다(PLAN-UI U8): 포트를 만지지 않는 설치를 배경에서 끝내
      // 두면 돌아왔을 때 미리보기 켜기만 남는다 — 미리보기는 startPreview 의
      // 울타리가 여전히 막고, 준비는 디스크의 ready 로 앉는다.
      if (!this.core.active && !firstPrep) {
        // 떠난 프로젝트의 최신화는 여기서 끝난다. pulling 을 그대로 두면 사이드바가
        // 그 프로젝트를 「준비 중」으로 계속 부른다(2026-09-25 콜드 리뷰 N2) —
        // 최신화 전 단계로 돌아가고, 그것도 진행 단계였다면 ready 로 앉는다.
        const settled = before === "pulling" || before === "cloning" ? "ready" : before;
        this.core.setPhase(settled, null);
        return this.core.snapshot();
      }
      const installed = await this.installIfNeeded(config);
      lap("installMs");

      /**
       * Count once the clone is on disk and checked out. Without this the
       * chip reads zero after every restart — the count only moves on a
       * 화면 turn otherwise, and a planner who closed the app mid-cycle would
       * come back to a rail that says there is nothing to save.
       */
      await this.core.refreshPendingChanges();
      lap("countMs");

      // Up to date and still serving: restarting the preview would only flip
      // the UI out of `ready` for no gain.
      if (!installed && this.core.preview && (await this.isServing())) {
        this.core.setPhase("ready", null);
        return this.core.snapshot();
      }
      await this.startPreview(config);
      lap("previewMs");
      createFileLogger().info("준비 시간", {
        firstPrep,
        installed,
        ...spans,
        totalMs: Math.round(performance.now() - started),
      });
      this.core.setPhase("ready", null);
    } catch (error) {
      this.core.setPhase("error", detailOf(error, this.core.pat), this.bringUpErrorKind(error));
    }
    return this.core.snapshot();
  }

  /**
   * A bring-up that died between creating the folder and finishing the clone
   * leaves the root with files but no `.git` — every later sync reads it as
   * uncloned, and `git clone` refuses a non-empty destination (128) until a
   * human deletes the folder by hand. Everything in it is a partial copy of
   * the remote, so clearing it is a re-clone, not a loss (the same trade the
   * url move already makes). A real clone has `.git` and is never touched.
   */
  private clearBringUpDebris(): void {
    if (this.core.isCloned() || !existsSync(this.core.root)) return;
    rmSync(this.core.root, { recursive: true, force: true });
  }

  /**
   * 설치가 최신인가 (PLAN L3 15행 · 단계 9) — 감독자의 installStale 이 읽는다.
   *
   * 이 판 전에는 호출자가 없었다: 유일한 독자였던 온보딩의 project 게이트가
   * 기계 전체의 게이트 넷으로 줄며(d4a7b493) 사라졌고, 준비(installIfNeeded)와
   * 최신화(pull)는 해시만 보는 dependenciesMoved 를 읽었다. 단계 2 가 감독자의
   * 15행에 이 함수를 이었지만 재설치 조치가 부르는 준비는 여전히 해시만 봐서,
   * node_modules 가 지워진 클론은 틱마다 재설치를 부르고도 설치하지 않았다.
   * 이제 두 자리가 같은 판정(installStale)을 읽는다.
   */
  installUpToDate(): boolean {
    const config = this.core.repoConfig();
    if (!config?.install) return true;
    return !installStale(this.core.root);
  }

  // -------------------------------------------------------------------------
  // Command runner (install/check/build)
  // -------------------------------------------------------------------------

  /**
   * Runs `install` only when the dependency set moved, the clone is fresh,
   * or the installed tree is gone (installStale). The identity is a content
   * hash of the manifest and lockfiles, recorded inside `.git/` so it belongs
   * to this clone alone.
   */
  private async installIfNeeded(config: RepoConfig): Promise<boolean> {
    if (!config.install) return false;
    if (!installStale(this.core.root)) return false;

    this.core.setPhase("installing", null);
    // The repo declares its private registry; the daemon holds the PAT. The
    // credential goes ONLY into the user-level npmrc — the clone's tree is
    // committed and pushed, so a clone-level .npmrc would publish the PAT.
    if (config.registry && this.core.pat) {
      mergeNpmrc(npmrcPath(), [
        {
          key: `${scopeOf(config.registry)}:registry`,
          value: `https://${config.registry.host}/`,
        },
        { key: `//${config.registry.host}/:_authToken`, value: this.core.pat },
      ]);
    }
    await this.runCommand(config.install, "install");
    // 설치가 트리를 남기지 않았으면(의존성 없는 레포의 npm · yarn 처럼) 그렇게
    // 적어 둔다 — 없으면 installStale 이 "트리 없음" 을 영영 낡음으로 읽어
    // 감독자의 15행이 틱마다 같은 설치를 다시 돌린다.
    const noTree = !installedTreeExists(this.core.root);
    writeFileSync(
      join(this.core.root, ".git", INSTALL_MARKER),
      noTree ? `${this.dependencyHash()}\n${NO_TREE_FLAG}\n` : this.dependencyHash(),
    );
    return true;
  }

  private dependencyHash(): string {
    return dependencyHash(this.core.root);
  }

  dependenciesMoved(): boolean {
    return readInstallMarker(this.core.root)?.hash !== this.dependencyHash();
  }

  private async runCommand(command: string, label: string): Promise<void> {
    await this.requirePnpmIfReferenced(command);
    // 다섯 분을 기다리는 검사는 검사가 아니다 — `COLONOVA_DESIGN_COMMAND_STALL_MS`
    // 가 e2e 를 초 단위로 그 문 앞에 세운다.
    const stall = Number(process.env.COLONOVA_DESIGN_COMMAND_STALL_MS) || COMMAND_STALL_MS;
    const result = await this.core.capture(command, this.spawnOptions(), [], stall);
    if (result.code === 0) return;
    if (result.stalled) {
      const waited =
        stall < 60_000 ? `${Math.round(stall / 1000)}초` : `${Math.round(stall / 60_000)}분`;
      throw new Error(
        redact(
          `${label} 명령이 ${waited} 동안 아무 말도 하지 않아 중단했습니다 — 네트워크나 패키지 저장소가 응답하지 않는 것으로 보입니다.\n마지막으로 한 말: ${result.lastLine || "(없음)"}`,
          this.core.pat,
        ),
      );
    }
    if (detectsRegistryAuthFailure(result.output)) throw new Error(REGISTRY_AUTH_DETAIL);
    // The tail, not just the last line: a gate failure is handed to the agent,
    // whose fix starts where the first error line points.
    const tail = result.output
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-GATE_OUTPUT_TAIL_LINES)
      .join("\n");
    throw new Error(
      redact(`${label} 명령이 실패했습니다 (exit ${result.code})\n${tail}`, this.core.pat),
    );
  }

  /** A colonova-design command may or may not need pnpm; only demand it when it does. */
  private async requirePnpmIfReferenced(command: string): Promise<void> {
    if (!/\bpnpm\b/.test(command)) return;
    if (!(await resolvePnpmExecutable())) throw new Error(PNPM_MISSING_DETAIL);
  }

  // -------------------------------------------------------------------------
  // Preview server
  // -------------------------------------------------------------------------
  private async startPreview(config: RepoConfig): Promise<void> {
    // Second fence, closer to the metal: the window between bootstrap's gate
    // and this spawn is exactly where a fast B→C switch lands. An inactive
    // project must not START a server of its own past the switch (the one it
    // already has stays warm — the server's switch fence decides that one).
    if (!this.core.active) return;
    await this.killPreview();
    await this.reclaimStalePreview();
    this.core.setPhase("starting", null);
    const { command } = config.preview;
    await this.requirePnpmIfReferenced(command);

    // The dev server picks its own free port and the verdict below reads
    // where it landed — first the address the server printed, then the
    // process tree's LISTEN sockets.
    const child = spawn(command, { windowsHide: true, ...this.spawnOptions() });
    this.core.preview = child;
    this.core.previewEpoch += 1;
    // 다음 생의 bring-up 이 이 트리를 거둘 수 있게 — .git 아래는 워크트리를
    // 더럽히지 않는다. 동기 쓰기: 스폰 직후의 hard-die 도 기록을 남기게.
    if (child.pid) {
      try {
        writeFileSync(
          join(this.core.root, ".git", "colonova-design-preview.pid"),
          String(child.pid),
        );
      } catch {
        // 기록에 실패해도 서버는 뜬다 — 좀비 정리만 다음 기회로 넘어간다.
      }
    }
    /** Last output line, so an exit can quote what the command actually said. */
    let lastLine: string | null = null;
    /** The recent output tail — a failed detection quotes it as evidence. */
    const tail: string[] = [];
    /** URLs the server printed, normalized to loopback — the detection's first candidates. */
    const urlCandidates = new Set<string>();
    const absorb = (chunk: Buffer) => {
      for (const raw of String(chunk).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        lastLine = line;
        tail.push(line);
        if (tail.length > GATE_OUTPUT_TAIL_LINES) tail.shift();
        const candidate = previewUrlCandidate(line);
        if (candidate) urlCandidates.add(candidate);
      }
      if (lastLine) this.core.setProgressLine(lastLine);
    };
    child.stdout?.on("data", absorb);
    child.stderr?.on("data", absorb);

    child.once("exit", (code, signal) => {
      if (this.core.preview !== child) return; // stop() already took it down
      this.core.preview = null;
      this.core.previewUrl = null;
      const how = signal ? `signal ${signal}` : `exit ${code}`;
      // The command's own last line is what says WHY; an exit code alone
      // sends the planner to a terminal they were promised they would not need.
      const detail = lastLine
        ? `미리보기 서버가 종료되었습니다 (${how}) — ${lastLine}`
        : `미리보기 서버가 종료되었습니다 (${how})`;
      // C5: 사람보다 도구가 먼저 다시 켠다 — 카드는 재시도 문장으로 말하고,
      // 다 못 켤 때 비로소 실패 문장이 선다(그때부터는 D4 가 대화로 넘긴다).
      void this.restartPreview(detail);
    });

    try {
      this.core.previewUrl = await this.detectPreviewUrl(child, urlCandidates, tail);
      // 살아 남은 서버 — 다음 죽음은 다시 두 번의 기회를 가진다.
      this.previewRestarts = 0;
    } catch (error) {
      // 늦게라도 뜰 예정이던 서버를 죽은 것으로 선고한 채 두면, 실제로는 살아
      // 포트를 쥔 유령이 남는다 (실사 목격). 선고가 서면 서버도 내려야 한다.
      await this.killPreview();
      throw error;
    }
  }

  /**
   * 준비 판정: 서버가 찍은 URL 을 먼저 믿고, 출력이 없으면 프로세스 트리의
   * LISTEN 소켓에서 찾는다. HTML 응답이 곧 미리보기다 — API 전용 포트가 함께
   * 뜨는 레포에서도 화면을 서는 쪽을 고른다. 끝까지 못 찾으면
   * port-undetected 로 던져 AI 가 서버 출력을 고치게 한다.
   */
  private async detectPreviewUrl(
    child: ChildProcess,
    urlCandidates: Set<string>,
    tail: string[],
  ): Promise<string> {
    const result = await detectPreview({
      candidates: () => [...new Set([...urlCandidates].flatMap(loopbackUrlVariants))],
      scan: async (signal) => {
        const pids = [
          ...(child.pid ? [child.pid] : []),
          ...(await descendantPids(child.pid ?? -1, signal)),
        ];
        if (signal.aborted) return [];
        // 데몬이 물려준 리스너는 미리보기 후보에서 뺀다.
        return (await pidListeningPorts(pids, signal)).filter(
          (port) => !daemonOwnedPorts.has(port),
        );
      },
      probe: probePreviewUrl,
      active: () => this.core.preview === child,
      timeoutMs: READY_TIMEOUT_MS,
    });
    createFileLogger().info("미리보기 감지", result.metrics);
    if (this.core.preview !== child) {
      throw new Error(this.core.detail ?? "미리보기 서버가 시작되지 않았습니다");
    }
    if (result.url !== null) return result.url;
    throw new PreviewPortUndetectedError(
      `미리보기 서버는 시작됐지만 어느 주소에서 듣는지 찾지 못했습니다 — ` +
        `서버가 뜬 주소를 출력하게 해 주세요 (예: \`Local: http://localhost:PORT\`).` +
        (tail.length > 0 ? `\n마지막 출력:\n${tail.slice(-10).join("\n")}` : ""),
    );
  }

  /** Ready means the port is open *and* the app answers, not just listening. */
  private async isServing(): Promise<boolean> {
    const url = this.core.previewUrl;
    if (url === null) return false;
    // 살아 있는 서버의 느린 응답을 죽음으로 읽으면 멀쩡한 미리보기를 다시 띄운다(Windows 2026-10-19).
    return (await probePreviewUrl(url, undefined, 15_000)) !== null;
  }

  async killPreview(): Promise<void> {
    const child = this.core.preview;
    if (!child) return;
    this.core.preview = null;
    this.core.previewUrl = null;

    const { promise: exited, resolve } = Promise.withResolvers<void>();
    child.once("exit", () => resolve());
    killTree(child, "SIGTERM");
    const hard = setTimeout(() => killTree(child, "SIGKILL"), 3_000);
    await exited;
    clearTimeout(hard);
  }

  /**
   * 데몬이 hard-die 하면 detached 미리보기 트리는 살아 남아 포트를 계속 쥔다
   * — 손에 핸들이 없는 다음 생의 killPreview 는 그 좀비를 못 거둔다 (실사:
   * 오래된 next dev 가 3000 을 쥔 채 새 서버가 엉뚱한 포트로 새는 꼴). 마지막
   * spawn 의 pid 기록(.git 아래 — 워크트리를 더럽히지 않는다)이 가리키는
   * 트리의 명령줄이 이 클론을 말하면 우리 것임이 확실하므로 거둔다.
   *
   * Windows(2026-10-19 실측): 부모가 죽어도 자식은 함께 죽지 않는다 — 앱이 강제로 꺼지면
   * next dev 가 남아 포트와 `.next/dev/lock` 을 쥐고, 새 서버는 매번 곧장 끝나 준비가 멈췄다.
   * 옛 코드는 명령줄 앵커가 없어 Windows 를 건너뛰었다. 이제 PowerShell CIM 으로 명령줄을 읽고,
   * 클론 경로를 말하는 프로세스만 하나하나 `taskkill /T /F` 한다. 셸(cmd)이 먼저 죽어 기록된
   * pid 가 사라졌어도 고아가 된 자식이 남기 때문이고, 재활용된 pid 의 남의 프로세스는 건드리지 않는다.
   */
  private async reclaimStalePreview(): Promise<void> {
    const pidFile = join(this.core.root, ".git", "colonova-design-preview.pid");
    let recorded = 0;
    try {
      recorded = Number(readFileSync(pidFile, "utf8").trim());
    } catch {
      return;
    }
    if (!Number.isInteger(recorded) || recorded <= 1) return;
    const platform = currentPlatform();
    // Windows 는 표와 명령줄을 PowerShell 한 번으로 읽는다 — 두 번 띄우면 기동이 약 4.5초 늦었다
    // (processSnapshotCommand 의 주석, 2026-10-20).
    let tree: number[];
    let lines: Map<number, string>;
    if (platform === "win32") {
      const snapshot = await processSnapshot();
      tree = [recorded, ...descendantsOf(snapshot.children, recorded)];
      lines = snapshot.commandLines;
    } else {
      tree = [recorded, ...(await descendantPids(recorded).catch(() => []))];
      lines = await pidCommandLines(tree);
    }
    const mine = tree.filter((pid) => {
      const line = lines.get(pid);
      return line !== undefined && commandLineMentions(line, this.core.root, platform);
    });
    if (mine.length === 0) {
      // 기록이 남의 것이 됐다(pid 재활용 등) — 지워 다음 생이 다시 판단하게.
      rmSync(pidFile, { force: true });
      return;
    }
    const windows = platform === "win32";
    // POSIX 는 그룹째(기록된 pid 가 그룹 리더), Windows 는 우리 것으로 확인된 프로세스마다.
    const targets = windows ? mine : [recorded];
    const killAll = (signal: NodeJS.Signals) => {
      for (const pid of targets) killPidTree(pid, signal);
    };
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    killAll("SIGTERM");
    const hard = setTimeout(() => killAll("SIGKILL"), 3_000);
    // 프로세스 소멸 대기 — 포트가 풀려야 다음 스폰이 그 자리를 얻는다.
    const settled = Promise.withResolvers<void>();
    const poll = setInterval(() => {
      if (!targets.some(alive)) {
        clearInterval(poll);
        clearTimeout(hard);
        settled.resolve();
      }
    }, 100);
    const giveUp = setTimeout(() => {
      clearInterval(poll);
      settled.resolve();
    }, 8_000);
    await settled.promise;
    clearInterval(poll);
    clearTimeout(giveUp);
    clearTimeout(hard);
    rmSync(pidFile, { force: true });
  }

  private spawnOptions(): SpawnOptions {
    const windows = currentPlatform() === "win32";
    return {
      cwd: this.core.root,
      // The repo's commands are strings ("pnpm dev"), so a shell parses
      // them. `detached` on POSIX puts the tree in one process group we can
      // signal together when the preview must stop.
      shell: true,
      detached: !windows,
      stdio: ["ignore", "pipe", "pipe"],
      env: repoCommandEnv(process.env),
    };
  }

  /**
   * Why a bring-up failed, from the constants this class itself threw (PLAN
   * D41) — the same words `classifyError` used to substring-match on the web
   * side, now decided where the throw happened.
   */
  private bringUpErrorKind(error: unknown): RepoErrorKind {
    const message = error instanceof Error ? error.message : String(error);
    // The refusal names the commands it blocks (the card shows the evidence),
    // so the sentence CONTINUES past the constant — prefix, not equality.
    if (message.startsWith(COMMANDS_UNAPPROVED_DETAIL)) return "commands";
    if (error instanceof PreviewPortUndetectedError) return "port-undetected";
    // PREVIEW_COMMAND_UNKNOWN 은 preview.command 를 말하므로 아래의 포트·
    // 미리보기 매칭보다 먼저 읽는다 — 명령 부재는 설정 문제가 아니라 레포의
    // scripts 문제다.
    if (message === PREVIEW_COMMAND_UNKNOWN) return "no-preview-command";
    if (message === PNPM_MISSING_DETAIL) return "pnpm-missing";
    if (message === REGISTRY_AUTH_DETAIL) return "registry-auth";
    // D96: 최신화 충돌의 한 줄은 정확히 이 상수로 던져지므로, 같은 상수로
    // 읽는다 — 오류 카드가 "AI에게 해결 요청" 을 보여 줄 수 있는 근거.
    if (
      message === REFRESH_CONFLICT_DETAIL ||
      message === RECOVER_CONFLICT_DETAIL ||
      message.includes("충돌한 파일")
    ) {
      return "conflict";
    }
    // 미리보기 자리의 실패도 미리보기 카드로 — AI 가 서버를 고치는 길.
    if (message.includes("미리보기 서버") || message.includes("미리보기 명령을 찾지 못했습니다")) {
      return "preview";
    }
    return this.core.isCloned() ? "install" : "clone";
  }

  /**
   * C5: 미리보기가 저절로 꺼지면 도구가 먼저 다시 켠다 — 두 번까지, 5 초
   * 간격. 다시 켜는 동안 상태는 `화면을 다시 켜는 중` 으로 시작한다(웹의
   * 중단 카드가 이 접두를 스핀너로 읽는다 — 계약). 두 번을 다 쓰면 원래
   * 실패 문장을 내려놓는다: 그 실패를 대화로 넘기는 것은 fleet 의 몫(D4)이지
   * 이 자리에서 다시 도는 것이 아니다.
   */
  private async restartPreview(detail: string): Promise<void> {
    if (this.previewRestarts >= 2) {
      this.core.setPhase("error", detail, "preview");
      return;
    }
    this.previewRestarts += 1;
    this.core.setPhase("error", `화면을 다시 켜는 중 — ${detail}`, "preview");
    await sleep(5_000);
    // 기다리는 사이 누군가(전환 · 동기화)가 이미 다시 켰다 — 중복으로 켜지
    // 않는다. 이미 켜진 쪽의 성공이 횟수를 초기화한다.
    if (this.core.preview) return;
    try {
      await this.bootstrap();
    } catch {
      // bootstrap 은 스스로 phase 를 적는다 — 여기서 할 말이 없다.
    }
  }
}

/**
 * 레포의 명령(설치 · 미리보기)이 물려받는 환경 — spawnOptions 가 쓰는 조립을
 * 순수 함수로 떼어 시험이 읽는다.
 */
export function repoCommandEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...base,
    // The preview must never inherit a key that would bill API credit.
    ANTHROPIC_API_KEY: undefined,
    // The desktop app bundles portable Node/pnpm (and MinGit on Windows)
    // in its resources; those binaries win over whatever the planner's
    // machine happens to have — or not have — on PATH.
    PATH: extraPathPrefix(base.COLONOVA_DESIGN_EXTRA_PATH, base),
    // 콜드 리뷰 N1 (2026-09-25, PLAN-UI 9.3 D1): pnpm 11 은 run 앞에서
    // 스스로 설치를 돌린다(기본값 verify-deps-before-run: "install") —
    // 락파일 없는 레포에서 `pnpm dev` 하나로 pnpm-lock.yaml · node_modules/
    // 가 생겨, 아무 것도 만들지 않은 사용자의 변경으로 보관되어 올라간다.
    // 설치는 도구의 installIfNeeded 가 알아서 돌리므로 run 앞의 자동 설치는
    // 끈다. pnpm 11.20 실험 및 dist 소스의 설정 읽기로 확인한 끄는 값 —
    // pnpm 은 이 키를 pnpm_config_ 접두사로만 읽는다(npm_config_ 는 무시된다).
    pnpm_config_verify_deps_before_run: "false",
  };
}

/**
 * 서버 출력 한 줄에서 미리보기 후보 URL 을 뽑는다. 스킴 있는 URL 은 루프백·
 * 와일드카드 호스트만 받는다 — Network 주소는 소켓 스캔이 같은 포트를 잡는다.
 * 루프백 철자(localhost·127.0.0.1·[::1])는 서버가 찍은 그대로 둔다: 어느
 * 패밀리에 바인드했는지는 프로브가 가린다. 와일드카드(0.0.0.0·[::])만 그
 * 패밀리의 루프백으로 옮긴다 — 그 주소는 연결할 수 있는 주소가 아니다.
 * `localhost:3000` 같은 bare host:port 는 http 로 본다. 서버가 찍은
 * 경로(`/app` 같은)는 그대로 둔다 — 루트가 아닌 곳에서 서는 앱도 있으므로.
 */
function previewUrlCandidate(line: string): string | null {
  const hit = /https?:\/\/[^\s"'<>)\]]+/.exec(line);
  if (hit) {
    try {
      const url = new URL(hit[0]);
      const host = url.hostname;
      const wildcard = host === "0.0.0.0" || host === "[::]";
      if (LOOPBACK_URL_HOSTS[host] === true || wildcard) {
        if (wildcard) url.hostname = host === "0.0.0.0" ? "127.0.0.1" : "[::1]";
        // 루트 주소는 선언 경로와 같은 철자로 — 끝의 / 는 붙이지 않는다.
        if (url.pathname === "/" && url.search === "" && url.hash === "") {
          return `${url.protocol}//${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`;
        }
        return url.toString();
      }
    } catch {
      // Not a URL after all — fall through to the bare host:port check.
    }
  }
  const bare =
    /(?:^|\s)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{1,5})(?:\/[\s"'<>)\]]*)?/.exec(line);
  if (bare) return `http://${bare[1] === "0.0.0.0" ? "127.0.0.1" : bare[1]}:${bare[2]}`;
  return null;
}

/** URL 호스트로 받아들이는 루프백 철자 — URL 파서는 [::1] 의 괄호를 유지한다. */
const LOOPBACK_URL_HOSTS: Record<string, true> = {
  localhost: true,
  "127.0.0.1": true,
  "[::1]": true,
};

/**
 * 후보 URL 의 프로브 대상들 — 원래 철자에다, 루프백이면 다른 패밀리의 같은
 * 포트를 덧붙인다. `localhost` 는 어느 한 패밀리로만 풀릴 수 있으므로 명시적
 * 127.0.0.1·[::1] 둘 다를 더한다. 루프백이 아닌 주소는 그대로 하나다.
 */
function loopbackUrlVariants(url: string): string[] {
  const variants = [url];
  try {
    const parsed = new URL(url);
    const extra =
      parsed.hostname === "localhost"
        ? ["127.0.0.1", "[::1]"]
        : parsed.hostname === "127.0.0.1"
          ? ["[::1]"]
          : parsed.hostname === "[::1]"
            ? ["127.0.0.1"]
            : [];
    for (const hostname of extra) {
      const copy = new URL(url);
      copy.hostname = hostname;
      variants.push(copy.toString());
    }
  } catch {
    // Not a parseable URL — probe it as printed.
  }
  return variants;
}

/**
 * 설치의 정체 (PLAN L3 15행 · 단계 9) — 매니페스트와 락파일, 그리고
 * 워크스페이스 패키지들의 package.json 내용 해시.
 *
 * 옛 넷(package.json · pnpm · npm · yarn 락파일)은 없어도 늘 해시에 들어가고,
 * 새로 더한 재료(bun 락파일 · 워크스페이스 패키지)는 있을 때만 들어간다 — 그
 * 재료가 없는 레포의 해시가 옛 표식과 같아야, 이 판으로 올라가는 순간 모든
 * 프로젝트가 한꺼번에 다시 설치하지 않는다. 경로는 `/` 로 적어 기계마다 같다.
 */
export function dependencyHash(root: string): string {
  const hash = createHash("sha256");
  for (const file of ["package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"]) {
    const path = join(root, file);
    hash.update(file);
    hash.update(existsSync(path) ? readFileSync(path) : Buffer.alloc(0));
  }
  for (const file of ["bun.lock", "bun.lockb", ...workspacePackageJsons(root)]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    hash.update(file);
    hash.update(readFileSync(path));
  }
  return hash.digest("hex").slice(0, 16);
}

/** 표식의 둘째 줄 — 설치는 끝났지만 트리(node_modules · .pnp)를 남기지 않았다. */
const NO_TREE_FLAG = "no-tree";

/** 설치된 의존성 트리가 디스크에 있는가 — node_modules, 또는 Yarn PnP 의 로더. */
function installedTreeExists(root: string): boolean {
  return ["node_modules", ".pnp.cjs", ".pnp.js"].some((name) => existsSync(join(root, name)));
}

/** `.git/` 안의 설치 표식 — 첫 줄이 해시, 둘째 줄이 트리 없음 표시(선택). */
function readInstallMarker(root: string): { hash: string; noTree: boolean } | null {
  try {
    const [hash = "", flag = ""] = readFileSync(join(root, ".git", INSTALL_MARKER), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim());
    return { hash, noTree: flag === NO_TREE_FLAG };
  } catch {
    return null;
  }
}

/**
 * 설치가 낡았는가 (PLAN L3 15행 · 단계 9) — 해시가 움직였거나, 해시가 같아도
 * 설치된 트리가 지워졌다. 지워진 설치는 해시가 기억하지 못한다(사람이
 * node_modules 를 지웠거나, 청소 도구가 걷었거나). 설치가 애초에 트리를
 * 남기지 않은 레포는 표식이 그렇게 말하므로 낡음이 아니다.
 */
export function installStale(root: string): boolean {
  const marker = readInstallMarker(root);
  if (marker === null || marker.hash !== dependencyHash(root)) return true;
  return !marker.noTree && !installedTreeExists(root);
}

/**
 * 워크스페이스 선언의 글롭 — pnpm-workspace.yaml 의 packages 목록과
 * package.json 의 workspaces(배열 또는 `{ packages }`). 읽지 못하는 선언은
 * 빈 목록이다 — 깨진 package.json 은 루트 해시가 이미 본다. `!` 로 시작하는
 * 글롭은 빼는 규칙으로 그대로 남긴다.
 */
export function workspaceGlobs(pnpmWorkspace: string | null, packageJson: string | null): string[] {
  const globs: string[] = [];
  const push = (value: string) => {
    const glob = value.trim().replace(/^(['"])(.*)\1$/, "$2");
    if (glob !== "") globs.push(glob);
  };
  if (pnpmWorkspace !== null) {
    // YAML 파서를 싣지 않는다 — 최상위 `packages:` 아래의 목록만 읽으면 된다.
    let inside = false;
    for (const raw of pnpmWorkspace.split(/\r?\n/)) {
      const line = raw.replace(/\s+#.*$/, "");
      if (line.trim() === "" || line.trim().startsWith("#")) continue;
      if (/^\S/.test(line)) {
        const flow = /^packages\s*:\s*\[(.*)\]\s*$/.exec(line);
        if (flow) for (const item of (flow[1] ?? "").split(",")) push(item);
        inside = flow === null && /^packages\s*:\s*$/.test(line);
        continue;
      }
      const item = inside ? /^\s+-\s*(.+)$/.exec(line) : null;
      if (item) push(item[1] ?? "");
    }
  }
  if (packageJson !== null) {
    try {
      const declared = JSON.parse(packageJson)?.workspaces;
      const list: unknown = Array.isArray(declared) ? declared : declared?.packages;
      if (Array.isArray(list)) {
        for (const item of list) if (typeof item === "string") push(item);
      }
    } catch {
      // 깨진 package.json — 워크스페이스는 없는 것으로.
    }
  }
  return [...new Set(globs)];
}

/** 글롭 한 마디 — `*` 는 `/` 없는 아무 글자, 나머지는 글자 그대로. */
function segmentMatches(pattern: string, name: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${source}$`).test(name);
}

/** 글롭이 루트 상대 폴더를 담는가 — `*` 는 한 마디, `**` 는 여러 마디(없음 포함). */
export function globMatchesDir(glob: string, dir: string): boolean {
  const pattern = glob.replace(/^\.\//, "").split("/").filter(Boolean);
  const path = dir.split("/").filter(Boolean);
  const match = (i: number, j: number): boolean => {
    if (i === pattern.length) return j === path.length;
    const part = pattern[i] ?? "";
    if (part === "**") return match(i + 1, j) || (j < path.length && match(i, j + 1));
    return j < path.length && segmentMatches(part, path[j] ?? "") && match(i + 1, j + 1);
  };
  return match(0, 0);
}

/** 글롭을 펼칠 때 들어가지 않는 폴더 — 설치물과 저장소 속. */
const WORKSPACE_SKIP = new Set(["node_modules", ".git"]);
/** `**` 가 내려가는 깊이의 상한 — 틱마다 읽는 판정이 큰 레포를 다 걷지 않게. */
const WORKSPACE_MAX_DEPTH = 6;

/**
 * 워크스페이스 선언이 담는 패키지의 package.json — 루트 상대, 정렬. 글롭은
 * 글자 그대로의 앞마디에서부터만 펼친다: 감독자가 틱마다 이 판정을 읽으므로
 * 레포 전체를 걷지 않는다. node_modules · .git 안과 심볼릭 링크는 보지 않는다.
 */
export function workspacePackageJsons(root: string): string[] {
  const read = (file: string): string | null => {
    try {
      return readFileSync(join(root, file), "utf8");
    } catch {
      return null;
    }
  };
  const globs = workspaceGlobs(read("pnpm-workspace.yaml"), read("package.json"));
  const excludes = globs.filter((glob) => glob.startsWith("!")).map((glob) => glob.slice(1));
  const found = new Set<string>();
  const childDirs = (rel: string): string[] => {
    try {
      return readdirSync(join(root, rel), { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() && !WORKSPACE_SKIP.has(entry.name) && !entry.name.startsWith("."),
        )
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  };
  const under = (rel: string, name: string) => (rel === "" ? name : `${rel}/${name}`);
  const walk = (parts: string[], rel: string, i: number, depth: number): void => {
    if (i === parts.length) {
      if (rel === "" || excludes.some((glob) => globMatchesDir(glob, rel))) return;
      if (existsSync(join(root, rel, "package.json"))) found.add(`${rel}/package.json`);
      return;
    }
    const part = parts[i] ?? "";
    if (part === "**") {
      walk(parts, rel, i + 1, depth);
      if (depth < WORKSPACE_MAX_DEPTH) {
        for (const name of childDirs(rel)) walk(parts, under(rel, name), i, depth + 1);
      }
    } else if (part.includes("*")) {
      for (const name of childDirs(rel)) {
        if (segmentMatches(part, name)) walk(parts, under(rel, name), i + 1, depth + 1);
      }
    } else if (part !== ".." && !WORKSPACE_SKIP.has(part)) {
      try {
        if (lstatSync(join(root, rel, part)).isDirectory()) {
          walk(parts, under(rel, part), i + 1, depth + 1);
        }
      } catch {
        // 선언된 폴더가 없다 — 담을 것이 없다.
      }
    }
  };
  for (const glob of globs) {
    if (glob.startsWith("!")) continue;
    walk(
      glob
        .replace(/^\.\//, "")
        .split("/")
        .filter((part) => part !== "" && part !== "."),
      "",
      0,
      0,
    );
  }
  return [...found].sort();
}
