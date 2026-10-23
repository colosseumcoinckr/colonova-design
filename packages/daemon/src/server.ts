export { daemonOwnedPorts } from "./preview-claim.js";

import { timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { arch, homedir, release } from "node:os";
import {
  type ClientMessage,
  composeAttention,
  type GateChecked,
  PROTOCOL_VERSION,
  type ProjectSummary,
  parseClientMessage,
  readTurn,
  type ServerMessage,
  type SessionState,
} from "@colonova-design/protocol";
import { type WebSocket, WebSocketServer } from "ws";
import type { Diagnostic } from "./agent/driver.js";
import { ClaudeDriver } from "./agent/drivers/claude/driver.js";
import { DriverRegistry } from "./agent/registry.js";
import { AgentInstall } from "./agent-install.js";
import { AgentUpdates } from "./agent-update.js";
import { CommandDedupe } from "./command-dedupe.js";
import { ConfluenceSync } from "./confluence-sync.js";
import {
  type CredentialStore,
  createCredentialStore,
  migratePlaintextSecrets,
  migrateProjectPats,
} from "./credentials.js";
import { screensOfTurn } from "./cycle-screens.js";
import { DeveloperNotice, describeProblem } from "./developer-notice.js";
import { startupLogFields } from "./diagnostics.js";
import { RequestRouter } from "./dispatch.js";
import { DocComments } from "./doc-comments.js";
import { DocOps } from "./doc-ops.js";
import { createDraftAiRunner } from "./draft-ai.js";
import { DraftPublisher } from "./draft-publish.js";
import { DraftService } from "./draft-service.js";
import { EditAnnouncer } from "./edit-screens.js";
import { buildStatus, resolveClaudeExecutable } from "./environment.js";
import { Escalation } from "./escalation.js";
import { ensureGitGuardHooks } from "./git-guard.js";
import { parseRepoSlug } from "./github.js";
import { GitHubBridge } from "./github-bridge.js";
import { expiryJudgement, expiryNoticeStep } from "./github-expiry.js";
import { HandoffPreviews } from "./handoff-preview.js";
import { createFileLogger, type DaemonLogger } from "./log.js";
import { MachineTurns } from "./machine-provider.js";
import { MachineSetting } from "./machine-setting.js";
import { type DaemonNotice, noticeForState } from "./notices.js";
import { AgentLogin } from "./onboarding.js";
import { realpathBestEffort } from "./paths.js";
import { PlanTracker } from "./plan-tracker.js";
import { daemonOwnedPorts } from "./preview-claim.js";
import type { PreviewDriverFactory } from "./preview-driver.js";
import { PreviewDrivers } from "./preview-drivers.js";
import { ProjectFleet, type ProjectWorkspaces } from "./project-fleet.js";
import { ProjectRegistry } from "./projects.js";
import { QueueStore } from "./queue-store.js";
import { repoSettingsWarning, sanitizeRepoAgentSettings, trustWorkspace } from "./repo.js";
import { scopeOf } from "./repo-config.js";
import { routesForFiles } from "./route-index.js";
import { readScreenMap } from "./screen-map.js";
import { asPlannerFacingError, NEW_SESSION_TITLE } from "./session.js";
import { SessionManager } from "./session-manager.js";
import { appendTape, readTape } from "./session-tape.js";
import { TurnActivity } from "./turn-activity.js";
import { TurnStats } from "./turn-stats.js";
import { serveWeb } from "./web-static.js";

// The host's notice type (notices.ts) — re-exported so
// `@colonova-design/daemon/server` stays the one import a host needs.
export type { DaemonNotice } from "./notices.js";
// The desktop builds its drivers against these (게이트 재배선 + 인앱 브라우저
// 2단계) — exported here so `@colonova-design/daemon/server` stays the one import
// a host needs.
export type {
  BrowserActionReport,
  BrowserDriver,
  BrowserDriverFactory,
  PreviewA11y,
  PreviewArrival,
  PreviewAxNode,
  PreviewCapture,
  PreviewConsoleLine,
  PreviewDriver,
  PreviewDriverFactory,
  PreviewOpenOptions,
  PreviewOpenResult,
  PreviewOverflow,
  PreviewViewport,
} from "./preview-driver.js";

/**
 * 커미티 B1 (2026-09-15): 열린 넘김 폴링 주기. 슬라이스 4 (2026-09-19) 가
 * 10분 → 2분으로 줄였다: 인증 요청 5000/시 예산에서 프로젝트당 분당 1회
 * 미만이라 "한 사람·한 대·한 구독" 규모에 여유가 있고, 반영 알림이 실제
 * 병합에서 늦게 도착하는 일은 이제 사용자 경험의 문제였다.
 */
const HANDOFF_POLL_MS = 2 * 60_000;
export interface DaemonConfig {
  host: string;
  port: number;
  /** Shared secret a client must present. Generated on first run. */
  token: string;
  claudeExecutable?: string;
  /**
   * 개발 실행인가 — 개발 전용 면(`DaemonStatus.dev`)을 연다. 프로바이더 목록은
   * 이 값과 무관하게 Claude Code 하나다. 데스크톱은 `!app.isPackaged`,
   * CLI 는 `COLONOVA_DESIGN_DEV_AGENTS=1`. 패키징된 앱은 절대 켜지 않는다.
   */
  devAgents?: boolean;
  /**
   * Where the web UI's built files live. When set, the daemon serves them
   * itself — the desktop app is one process serving one origin, no pairing
   * screen. The browser dev path (separate vite server + pasted ws url)
   * keeps working when this is unset.
   */
  webDist?: string;
  /** Credential store; the desktop app injects its safeStorage-backed one. */
  credentialStore?: CredentialStore;
  /**
   * 사용자가 돌아와야 하는 순간의 갈고리 — 턴이 끝났을 때, AI 가 확인을
   * 기다릴 때, 게이트가 실패했을 때. 데몬은 의미만 건넨다; 그것을 OS 알림으로
   * 그릴지는 받는 쪽(데스크톱 앱)의 몫이므로, 브라우저 개발 경로는 이 갈고리
   * 없이도 온전하다.
   */
  onNotice?: (notice: DaemonNotice) => void;
  /**
   * 데몬의 파일 로그 싱크. 지정하지 않으면 `~/.colonova-design/logs` 의 하루
   * 파일 로거를 스스로 만든다 — 데스크톱 앱이 in-process 로 데몬을 키우므로
   * console 은 아무에게도 닿지 않고, 흔적은 파일로만 남는다.
   */
  logger?: DaemonLogger;
  /**
   * The desktop's preview-window driver (게이트 재배선). When a host injects
   * it, the screen gate re-opens the screens a turn pointed at, and the
   * 화면 캡처 button works; without it — the browser dev path — neither
   * exists.
   */
  previewDriverFactory?: PreviewDriverFactory;
  /** 앱 버전 — 진단과 사용자 의견에 싣는다. */
  appVersion?: string;
}

/**
 * The provider registry's contents — registration order is the picker order
 * (registry.ts). Claude Code 하나다 — Codex 는 뺐다(2026-10-20 사용자 요청). 레지스트리는
 * 그대로 둔다: 세션 · 목록 · 계정 읽기가 공급자 이름으로 갈라지는 길이 이 자리를 지난다.
 * 함수로 떼어 둔 이유는 하나다: 어느 실행이 어떤 프로바이더 목록을 받는지를 데몬을
 * 띄우지 않고 잠그기 위해서다.
 */
export function registerAgentDrivers(
  registry: DriverRegistry,
  options: { claudeExecutable: () => string | null },
): void {
  registry.register(new ClaudeDriver(options.claudeExecutable));
}

/** Desktop reset runs before a daemon starts. Only conversations for this clone are erased. */
export async function eraseProjectConversations(cwd: string): Promise<void> {
  const drivers = new DriverRegistry();
  registerAgentDrivers(drivers, { claudeExecutable: () => null });
  for (const driver of drivers.all()) await driver.store?.deleteAll?.(cwd);
}

export class DaemonServer {
  private readonly clients = new Set<WebSocket>();
  /**
   * 명령 멱등 답변(command-dedupe.ts) — 같은 id 의 실행은 한 번. 웹의
   * 재전송(타임아웃 뒤 · 재접속 뒤)이 같은 명령을 두 번 실행하지 않게 하는
   * 데몬 쪽 절반이고, 웹의 절반은 같은 id 를 다시 보내는 것이다.
   */
  private readonly dedupe = new CommandDedupe();
  private readonly manager: SessionManager;
  private readonly logger: DaemonLogger;
  private readonly credentials: CredentialStore;
  /**
   * The project registry and one live workspace per project the daemon has
   * touched this run. Only the ACTIVE project runs a preview server — two
   * repos may declare the same `preview.port` — but a project the planner
   * switched away from keeps its clone.
   */
  private registry!: ProjectRegistry;
  /**
   * What "the repo" currently means — one live workspace per project, the
   * switch, the announces, the handoff poll (project-fleet.ts). Built in
   * `start()` once the registry exists.
   */
  private fleet!: ProjectFleet;
  /** The wire's request table (dispatch.ts) — built in `start()` beside the fleet. */
  private router!: RequestRouter;
  /** 기획서(Confluence) 가져오기의 몸 — start() 가 만들고 stop() 이 내려놓는다. */
  private confluence!: ConfluenceSync;
  /** 기획 초안의 몸 — start() 가 만들고 stop() 이 도는 생성을 끊는다(2026-10-23 작업 B2). */
  private drafts: DraftService | null = null;
  /** 커미티 B1 (2026-09-15): 열린 넘김 폴링 타이머 — stop() 이 끊는다. */
  private handoffTimer: NodeJS.Timeout | null = null;
  /**
   * The machine-wide GitHub credential: token lifecycle, picker cache, one
   * transport (github-bridge.ts). The fixture env var is read inside.
   */
  private readonly github: GitHubBridge;
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly agentDrivers = new DriverRegistry();
  private claudeExecutable: string | null = null;
  /**
   * 방금 설치가 푼 claude 경로를 심는다(2026-09-24) — 드라이버·상태·fleet 이
   * 읽는 자리가 이 필드 하나라, 갈아끼우는 것만으로 재시작 없이 새 CLI 가
   * 보인다. 설치 진행기의 성공 판정이 푼 경로를 그대로 받는다.
   */
  private adoptClaudeExecutable(path: string | null): void {
    this.claudeExecutable = path;
  }

  /** onboarding.check 의 방어 — 풀린 적 없는(null) 경로를 한 번 다시 푼다. */
  private async refreshClaudeExecutable(): Promise<void> {
    if (this.claudeExecutable !== null) return;
    const resolved = await resolveClaudeExecutable(this.config.claudeExecutable);
    if (resolved) this.claudeExecutable = resolved;
  }
  /** 기계 잔일 담당의 설정 — 설정창의 machine.set 이 쓰고 machine.json 에 산다. */
  private readonly machineSetting = new MachineSetting();
  /** 기계 잔일(저장 메모 · 넘기기 초안)의 담당 — 레지스트리와 설정에서 고른다. */
  private readonly machineTurns = new MachineTurns(this.agentDrivers, () =>
    this.machineSetting.get("provider"),
  );
  /** 터미널 없는 에이전트 로그인(P1-1) — 데몬이 파이프로 몰고 방송한다. */
  private readonly agentLogin = new AgentLogin();
  /** 에이전트 설치 진행기(1단계) — Claude Code 의 설치를 끝까지 지켜본다. */
  private readonly agentInstall = new AgentInstall();
  /**
   * 에이전트 업데이트(PLAN-UI U12) — 새 버전 확인과, 도는 작업이 없을 때의
   * 설치. 설치는 위의 진행기를 그대로 탄다.
   */
  private readonly agentUpdates = new AgentUpdates({
    installer: this.agentInstall,
    busy: () => this.manager.anyBusy(),
    setting: this.machineSetting,
    currentVersion: async (agent) => {
      const diagnostic = await this.agentDrivers.get(agent)?.isAvailable();
      return diagnostic?.ok ? (diagnostic.version ?? null) : null;
    },
    adoptClaudeExecutable: (path) => this.adoptClaudeExecutable(path),
    broadcast: (message) => this.broadcast(message),
    announce: () => void this.status().then((status) => this.broadcast({ type: "status", status })),
    notice: (notice) => this.config.onNotice?.(notice),
    log: (message, fields) => this.logger.info(message, fields),
  });
  /** 턴 종료 뒤 실제 변경이 있을 때 한 번 보관한다(2026-10-20 사용자 요청). */
  private readonly autoSaveDue = new Set<string>();
  /** 이번 턴의 화면 연결. 브라우저 재검사 없이 모아 보관 성공 뒤 기록한다. */
  private readonly screenMapDue = new Map<string, string[]>();
  /**
   * Aborted the moment `stop()` begins. Unattended CLI probes ride it: a CLI
   * that never answers must not hold the process open for the probe's full
   * grace after the daemon is down — the offline suites each paid that grace
   * at exit, and the desktop's quit waited on it too.
   */
  private readonly closing = new AbortController();
  /** The one shutdown, shared by every caller that asks for it. */
  private stopping: Promise<void> | null = null;
  /**
   * The account's plan limits and the CLI's model catalog (plan-tracker.ts) —
   * account-wide, cached on disk across restarts, rebroadcast on change.
   */
  private readonly plans: PlanTracker;
  /**
   * The preview driver each session received and the screen-gate's verdict
   * state (preview-drivers.ts, PLAN D61·D56).
   */
  private readonly drivers: PreviewDrivers;
  /**
   * 시점 빌드 재현: the handed-off moment's worktree
   * build — one at a time, for the active project's open handoff. Its
   * lifetime is this server's to enforce: the conversation that opened it
   * reaps it on close (onState below), the daemon reaps it on stop, and the
   * store's own idle timer catches the window that never said goodbye.
   */
  private readonly handoffPreviews = new HandoffPreviews(
    () => {
      const active = this.activeOrNull();
      if (!active) return null;
      return {
        slug: active.slug,
        repoRoot: active.paths.repoRoot,
        projectRoot: active.paths.root,
        previewCommand: active.repo.repoConfig()?.preview.command ?? null,
        handoff: active.repo.currentHandoff,
        // 워크트리를 움직이는 git 이 활성 프로젝트의 차선에 서는 길 (PLAN L1)
        // — 같은 .git 을 쓰는 다른 손과 한 줄로.
        inLane: (job) => active.repo.laneRun("preview", job),
      };
    },
    (message) => this.logger.info(message),
  );
  /**
   * 세션별 최근 running 진입 시각 — 완료 알림에 태울 턴의 길이(알림 시점
   * 정책의 "오래 걸린 턴")를 재는 시계. 대기 후 재개는 시계를 다시 놓는다.
   *
   * 화면의 진행 시계(`Session.turnStartedAt`)와 헷갈리지 않게 이름이 다르다:
   * 그쪽은 요청 하나가 시작한 시각을 카드 앞의 기다림까지 포함해 끝까지 든다.
   */
  private readonly notifyClockAt = new Map<string, number>();
  /**
   * 카드 대기의 시계 (턴 통계): waiting_permission·waiting_question 진입에
   * 놓고 벗어날 때 구간을 통계에 더한다 — durationMs 에 섞인 사람 대기를
   * waitMs 로 갈라 내는 재료다.
   */
  private readonly waitClockAt = new Map<string, number>();
  /**
   * 대기 줄의 디스크 절반 (PLAN D86 의 확장): the wait rooms' mirror and the
   * lost room's keeper, keyed by session id under the run dir.
   */
  private readonly queueStore = new QueueStore();
  /** 세션에 하나씩 물려주는 디스크 손잡이 — Session 이 자기 id 로 부른다. */
  private readonly queueDiskFor = (sessionId: string) => this.queueStore.for(sessionId);
  /** 슬라이스 5: 개발자 에스컬레이션 — 환경 실패를 웹훅으로 흘리는 문. */
  private readonly escalation: Escalation;
  /** 개발자 알림 (PLAN L11) — GitHub 우선, Slack 보조의 배달기. */
  private readonly developerNotice: DeveloperNotice;
  /** 기계 주의의 since — GitHub 만료 · 에이전트 로그아웃이 처음 선 시각. */
  private githubExpiredAt: string | null = null;
  private agentLoggedOutAt: string | null = null;
  /** 로그인 만료로 멈춰 기다리는 대화 — 로그인이 돌아오면 한 번 다시 보낸다 (L12). */
  private readonly loginWatchers = new Map<string, NodeJS.Timeout>();
  /** 턴 통계 (AI 작업 시간 측정) — 종류와 숫자만 남기는 하루 JSONL. */
  private readonly stats: TurnStats;
  /** 라이브감(2026-10-08) — AI 가 지금 고치는 화면을 턴당 화면당 한 번 알린다. 선로 전용, 로그에 남기지 않는다. */
  private readonly editAnnouncer: EditAnnouncer;
  /**
   * 증분 타입 검사 (PLAN-HARNESS §3.C) — `repo_diagnostics` 의 몸. 첫 턴의
   * prewarm 이 가장 느린 첫 검사를 AI 가 생각하는 동안 끝낸다.
   */

  constructor(private readonly config: DaemonConfig) {
    this.credentials = config.credentialStore ?? createCredentialStore();
    this.logger = config.logger ?? createFileLogger();
    this.escalation = new Escalation(this.credentials, this.logger);
    this.github = new GitHubBridge({
      credentials: this.credentials,
      claudeExecutableOverride: () => this.config.claudeExecutable,
      // Every live workspace re-arms at once; a project the planner has not
      // touched this run gets the token when it is next activated.
      onToken: (pat) => {
        for (const workspaces of this.fleet.workspaces.values()) {
          workspaces.repo.setPat(pat);
          // PLAN-UI U13: 인증으로 막혔던 제출은 새 코드로 곧바로 다시 간다.
          if (pat) workspaces.supervisor.retrySubmitNow();
          // 연결 코드에서 멈춘 준비도 새 코드로 곧바로 다시 돈다(2026-10-20).
          if (pat && workspaces.bringUpAuth !== null) {
            void workspaces.repo.sync().catch(() => undefined);
          }
        }
      },
      // 데몬이 본 GitHub 401(또는 그 뒤의 회복) — 판정이 바뀔 때만 status 를
      // 다시 방송한다. 웹의 만료 카드는 이 방송 하나로 열리고 닫힌다.
      onAuthChange: () => {
        // 개발자 알림 (PLAN L11): 토큰 만료는 AI 가 못 고친다 — 기계 전체의
        // 문제로 개발자에게 간다. 회복은 같은 키의 resolve 가 거둔다.
        if (this.github.authExpired) {
          this.githubExpiredAt ??= new Date().toISOString();
          void this.developerNotice.raise({
            key: "github:auth",
            slug: null,
            ...describeProblem("github:auth"),
          });
        } else {
          this.githubExpiredAt = null;
          void this.developerNotice.resolve("github:auth", null);
        }
        void this.status().then((status) => this.broadcast({ type: "status", status }));
      },
      // 연결 코드의 만료 예정(U17) — 머리글에서 읽은 값이 바뀔 때만 온다.
      // machine.json 에 견줘 두므로 다시 켠 직후 첫 관찰 전에도 설정 줄이 답한다.
      onExpiryChange: (iso) => {
        this.machineSetting.set("githubTokenExpiresAt", iso);
        this.noteTokenExpiry(iso);
      },
    });
    // 개발자 알림 (PLAN L11) — GitHub 우선, Slack 보조. 프로젝트 알림의 상태는
    // 그 프로젝트의 감독자 원장(cycle.json notices)에 적힌다.
    this.developerNotice = new DeveloperNotice({
      github: () => this.github.client(),
      githubAuthExpired: () => this.github.authExpired,
      repoSlug: (slug) => {
        const url = this.registry.get(slug)?.repo.url;
        return url ? parseRepoSlug(url) : null;
      },
      project: (slug) => {
        const project = this.registry.get(slug);
        if (!project) return null;
        const workspaces = this.fleet?.workspaces.get(slug);
        return {
          name: project.name,
          reviewers: project.reviewers ?? [],
          openPr: workspaces?.repo.currentHandoff?.number ?? null,
        };
      },
      authorName: () => this.machineSetting.get("authorName"),
      slack: this.escalation,
      store: (slug) => this.fleet?.workspaces.get(slug)?.supervisor ?? null,
      logger: this.logger,
    });
    registerAgentDrivers(this.agentDrivers, {
      claudeExecutable: () => this.claudeExecutable,
    });
    this.manager = new SessionManager(
      {
        onEvent: (sessionId, event) => {
          this.turnActivity.get(sessionId)?.observe(event);
          if (event.kind === "turn.end") {
            const prompt = this.turnPrompts.get(sessionId);
            const workspace = this.workspaceOfSession(sessionId);
            if (prompt && workspace) {
              try {
                // 대화록 위치는 재생 때 맞춘다. 보내기 앞에서 공급자 기록을 읽지 않는다.
                appendTape(workspace.paths.root, {
                  sessionId,
                  afterTurn: 0,
                  matchByText: true,
                  durationMs: event.durationMs,
                  event: { kind: "user.echo", text: prompt.text, images: 0, requestId: prompt.id },
                });
              } catch {
                this.logger.info("Turn record unavailable");
              }
              this.turnPrompts.delete(sessionId);
            }
          }
          if (event.kind === "turn.end")
            this.turnEnds.set(
              sessionId,
              event.subtype === "interrupted"
                ? "interrupted"
                : event.isError
                  ? "failed"
                  : "success",
            );
          // 턴 통계 — 아래의 return 들보다 먼저: 모든 사건이 새겨져야 한다.
          this.stats.observe(sessionId, event);
          // 라이브감(2026-10-08): 편집 도구가 끝난 파일이 알려진 화면 하나에 이어지면 `session.editing` 으로 알린다.
          this.editAnnouncer.observe(sessionId, event);
          this.broadcast({ type: "session.event", sessionId, event });
          // 한도가 움직였다 (PLAN D100): 요금 칩이 2분 뒤에야 진실을 말하면,
          // 계획자는 이미 막힌 뒤에 그 사실을 안다. 다음 읽기를 앞당긴다 —
          // 이벤트를 보낸 계정의 provider로.
          if (event.kind === "ratelimit") {
            this.plans.noteRateLimit(this.manager.get(sessionId)?.provider ?? "claude");
            return;
          }
          // D1: 답변에 적힌 하이퍼링크도 이 턴의 게이트 입력이다 — 사람이
          // 누를 링크가 죽어 있으면 그것을 발견하는 쪽은 다시 사용자다.
          // navigate 가 그렇듯 답변의 preview 주소를 notePinned 에 모으고,
          // origin 판별·중복 접기는 runGate 가 한다.
          if (event.kind === "text.done") {
            for (const url of linksOf(event.text)) this.drivers.notePinned(sessionId, url);
          }
          // 감독(2026-09-19): 턴이 답을 냈다 — 자동 재개의 상한은 돌려놓는다.
          // PLAN L12(단계 0): 되살리기 예산은 성공한 턴의 끝에서만 지운다 —
          // 닫힘(forget)과 갈라 놓아 교체 close 가 셈을 못 지운다.
          // 슬라이스 2: 답을 낸 턴이 자동 브리프가 연 턴이면 저장까지 정산한다.
          // 중지는 사람의 뜻 — 반쯤 고쳐진 화면을 저장하지 않는다.
          // P2-1: 답을 낸 턴은 자동 저장의 후보다 — 표만 올리고, 커밋은 아래
          // onState 의 idle 에서 치른다(게이트가 있었다면 그 뒤에).
          if (event.kind === "turn.end" && !event.isError && event.subtype !== "interrupted") {
            this.router?.settleReviveBudget(sessionId);
            // 그 프로젝트에서 턴이 답을 냈다 — 턴 자기치유의 개발자 알림
            // (turn:failed · revive:exhausted)을 거둔다 (PLAN L12). 같은
            // 프로젝트의 다른 대화가 낸 답도 푼다: 알림은 프로젝트의 것이다.
            void this.router?.settleProjectTurns(sessionId);
            this.autoSaveDue.add(sessionId);
            void this.fleet.settleAutoSave(sessionId);
            return;
          }
        },
        onState: (sessionId, state, detail) => {
          // 파일 로그의 뼈대: 턴이 언제 시작해 언제 어떤 상태로 내려앉았는지.
          this.logger.info("세션 상태", { sessionId, state, ...(detail ? { detail } : {}) });
          // 완료 알림에 태울 턴의 길이: running 진입에 시계를 놓고 idle 에서 회수한다.
          // 대기 뒤 재개는 시계를 다시 놓는다 — 그때의 일이 그때의 완료를 말한다.
          // (화면의 진행 시계는 다른 질문에 답한다 — 아래 `startedAt` 을 보라.)
          let turnDurationMs: number | undefined;
          if (state === "running") {
            // 이 시계는 `running` 의 것이 맞다: 카드를 기다렸다 재개한 일은
            // 그때부터 다시 재는 것이 완료 알림의 "오래 걸린 턴" 정의다
            // (화면의 진행 시계는 Session.turnStartedAt 이 따로 든다).
            this.notifyClockAt.set(sessionId, Date.now());
          } else if (state === "idle") {
            const startedAt = this.notifyClockAt.get(sessionId);
            this.notifyClockAt.delete(sessionId);
            turnDurationMs = startedAt === undefined ? undefined : Date.now() - startedAt;
          } else if (state === "closed") {
            this.notifyClockAt.delete(sessionId);
          }
          // 라이브감: 턴이 내려앉았거나 세션이 닫혔으면 알린 화면의 장부를 버린다(turn.end 를 못 본 끝까지 덮는다).
          if (state === "idle" || state === "error" || state === "closed") {
            this.editAnnouncer.forget(sessionId);
          }
          // 카드 대기의 시계 (턴 통계): waiting_* 진입에 놓고 벗어날 때 구간을
          // 통계에 더한다. 세션이 닫혀도 else 가 지우므로 시계는 남지 않는다.
          if (state === "waiting_permission" || state === "waiting_question") {
            this.waitClockAt.set(sessionId, Date.now());
          } else {
            const waitSince = this.waitClockAt.get(sessionId);
            if (waitSince !== undefined) {
              this.waitClockAt.delete(sessionId);
              this.stats.noteWait(sessionId, Date.now() - waitSince);
            }
          }
          // 진행 시계 (화면의 `n분 n초`): 시작을 창이 아니라 세션이 들고 있으므로
          // 새로고침해도 두 번째 창에서도 같은 초를 센다. 도는 턴이 없는 세션의
          // 시계는 null 이라 그 상태에는 붙지 않는다.
          const startedAt = this.manager.get(sessionId)?.turnStartedAt ?? null;
          this.broadcast({
            type: "session.state",
            sessionId,
            state,
            ...(detail ? { detail } : {}),
            ...(startedAt === null ? {} : { startedAt }),
          });
          // 미뤄 둔 에이전트 업데이트(PLAN-UI U12) — 마지막 턴이 내려앉는 순간 깐다.
          this.agentUpdates.settle();
          // A turn that just finished is the one moment the clone can have
          // gained files nobody has saved (PLAN D8). Counting here — rather
          // than on a timer — is what lets the top bar say 저장 the instant
          // the agent stops, and say nothing at all while it is still writing.
          // The count belongs to the session's OWN project, not the active
          // one: a turn finishing in B while the planner reads A must move
          // B's number (D14).
          if (state !== "running") {
            void this.workspaceOfSession(sessionId)?.repo.refreshPendingChanges();
          }
          // The tree's child row reads this session's state (PLAN D59): the
          // clone's threads are stale the moment it moves.
          const sessionWorkspaces = this.workspaceOfSession(sessionId);
          if (sessionWorkspaces) {
            this.manager.invalidateThreads(realpathBestEffort(sessionWorkspaces.paths.repoRoot));
            this.refreshThreads();
          }
          // 턴이 화면을 열어 봤다면 완료 알림은 게이트의 판정 뒤로 미룬다
          // (runScreenGate 가 둘 중 하나를 내보낸다). 여기서 먼저 부르면
          // 사용자는 `작업이 끝났습니다` 를 읽은 직후 다시 도는 대화를 본다.
          if (
            state === "idle" &&
            (this.autoSaveDue.has(sessionId) || this.gateRequests.has(sessionId))
          ) {
            void this.finishChangedTurn(sessionId, turnDurationMs);
          } else {
            this.finishWithoutGate(sessionId, state, turnDurationMs);
          }
          // 게이트의 판정 상태는 세션과 함께 간다 — close, delete, remove,
          // daemon stop all land here as `closed`.
          if (state === "closed") {
            this.router?.forgetReviveBudget(sessionId);
            // P2-1: 주인을 잃은 자동 저장 표는 치르지 않는다 — 닫힌 대화의
            // 커밋 제목을 그 대화의 말에서 끌어올 수 없다.
            this.autoSaveDue.delete(sessionId);
            this.screenMapDue.delete(sessionId);
            this.drivers.pinnedThisTurn.delete(sessionId);
            this.drivers.gatedSessions.delete(sessionId);
            // 턴의 장부도 세션과 함께 간다(2026-10-02) — 도구 기록 · 바뀐
            // 파일 · 게이트 대기 · 판정 · 재시도 횟수가 살아 있는 세션 수만큼
            // 쌓이던 긴 실행의 샘이었다.
            this.turnActivity.delete(sessionId);
            this.turnPrompts.delete(sessionId);
            this.changedTurnFiles.delete(sessionId);
            this.gateRequests.delete(sessionId);
            this.turnEnds.delete(sessionId);
            // 수명 규칙: the worktree build's life is
            // tied to the conversation that opened it — its close reaps the
            // worktree and the port. The store ignores strangers itself.
            this.handoffPreviews.closeSession(sessionId);
          }
        },
        onPermissionRequest: (payload) =>
          this.broadcast({ type: "permission.request", ...payload }),
        onQuestionRequest: (payload) => this.broadcast({ type: "question.request", ...payload }),
        // 화면 연결은 새 턴에서 다시 모은다.
        onTurnStart: (sessionId) => {
          this.drivers.pinnedThisTurn.delete(sessionId);
          this.turnActivity.set(sessionId, new TurnActivity());
        },
        // 턴 통계의 preDeliverMs (2026-10-19 응답 속도 조사) — 아래 beforeDeliver 가 끝나
        // 말이 CLI 로 나간 순간.
        onDelivered: (sessionId) => {
          this.stats.noteDelivered(sessionId);
        },
        beforeDeliver: (sessionId, item) => this.prepareTurn(sessionId, item),
        onPinned: (sessionId, pins) => {
          for (const pin of pins) this.drivers.notePinned(sessionId, pin.screen);
        },
        // 감독(2026-09-19): 턴이 도는 중에 CLI 가 죽었다 — 라우터가 같은 id 의
        // 재개로 스스로 일으킨다. start() 전에는 라우터가 없다(그때 세션도
        // 없다): 없는 문은 조용히 닫혀 있는 것이 옳다.
        onRevive: (sessionId) => {
          void this.router?.revive(sessionId);
        },
        // 로그인 만료로 턴이 멈췄다 (PLAN L12) — 기계 상태를 다시 읽어 주의를
        // `reconnect/agent-login` 로 세우고, 로그인이 돌아오면 그 말을 한 번
        // 다시 보내도록 지켜본다.
        onAuthStall: (sessionId) => {
          void this.status().then((status) => this.broadcast({ type: "status", status }));
          this.armLoginWatcher(sessionId);
        },
        // 사다리를 다 쓴 실패 — 그 프로젝트의 개발자 알림(turn:failed)이 선다.
        onTurnFailed: (sessionId, resultText) => {
          void this.router?.noteTurnFailed(sessionId, resultText);
        },
      },
      this.agentDrivers,
    );
    // One cwd for both probe readers — plan limits and the session-less
    // model catalog — so the two cannot disagree about where a probe runs.
    const probeCwd = () => {
      const active = this.activeOrNull();
      return active?.repo.isCloned() ? realpathBestEffort(active.paths.repoRoot) : homedir();
    };
    this.plans = new PlanTracker({
      idleSession: (provider) =>
        [...this.manager.all()]
          .filter((candidate) => candidate.state === "idle")
          .filter((candidate) => candidate.provider === provider)
          .sort((a, b) => b.lastActivity - a.lastActivity)[0] ?? null,
      usageProbes: this.agentDrivers.all().flatMap((driver) => {
        const read = driver.probeUsage?.bind(driver);
        return read ? [{ provider: driver.id, read }] : [];
      }),
      probeCwd,
      signal: this.closing.signal,
      onChanged: () =>
        void this.status().then((status) => this.broadcast({ type: "status", status })),
      catalogSources: this.agentDrivers
        .all()
        .filter((driver) => typeof driver.listModels === "function")
        .map((driver) => ({
          provider: driver.id,
          read: () => driver.listModels!({ cwd: probeCwd(), signal: this.closing.signal }),
        })),
    });
    this.drivers = new PreviewDrivers({
      factory: () => this.config.previewDriverFactory,
      activeRepo: () => this.activeOrNull()?.repo ?? null,
      // 게이트의 재검증은 세션이 사는 프로젝트 기준 — 전환 뒤 끝난 턴의 핀을
      // 활성 레포의 주소로 다시 열지 않는다(preview-drivers 의존 주석 참조).
      repoForSession: (id) => this.workspaceOfSession(id)?.repo ?? null,
      session: (id) => this.manager.get(id),
      sessions: () => this.manager.all(),
      notice: (n) => {
        // 게이트가 턴을 다시 열었다는 사실이 그 턴의 통계에 새겨진다.
        if (n.kind === "gate") this.stats.noteGate(n.sessionId);
        this.config.onNotice?.(n);
      },
    });
    // 턴 통계 — 서버가 아는 것만 좁은 창으로 내어준다. 사건은 onEvent 에서
    // 흘러들어오고, 세션·프로젝트 조회는 여기의 콜백이 나중에 답한다.
    this.stats = new TurnStats({
      projectOf: (sessionId) => {
        const workspaces = this.workspaceOfSession(sessionId);
        if (workspaces === null) return null;
        const root = realpathBestEffort(workspaces.paths.repoRoot);
        for (const project of this.registry.list()) {
          if (realpathBestEffort(this.registry.paths(project.slug).repoRoot) === root) {
            return project.slug;
          }
        }
        return null;
      },
      chipsOf: (sessionId) => {
        const session = this.manager.get(sessionId);
        if (session === undefined) return { provider: null, model: null, effort: null };
        return {
          provider: session.provider,
          model: session.model ?? session.chosen.model,
          effort: session.chosen.effort,
        };
      },
      contextTokens: async (sessionId) => {
        const usage = await this.manager.get(sessionId)?.contextUsage();
        return usage?.totalTokens ?? null;
      },
    });
    this.editAnnouncer = new EditAnnouncer({
      where: (sessionId) => {
        const workspaces = this.workspaceOfSession(sessionId);
        if (workspaces === null) return null;
        const repoRoot = workspaces.paths.repoRoot;
        return {
          roots: [...new Set([repoRoot, realpathBestEffort(repoRoot)])],
          projectRoot: workspaces.paths.root,
        };
      },
      readRows: (projectRoot) => readScreenMap(projectRoot),
      emit: (sessionId, screen) =>
        this.broadcast({
          type: "session.editing",
          sessionId,
          route: screen.route,
          ...(screen.title === undefined ? {} : { title: screen.title }),
        }),
    });
  }

  async start(): Promise<void> {
    // 시작 줄의 시간 칸 — 아래 "데몬 시작" 의 startMs · uptimeMs(2026-10-20).
    const startedAt = performance.now();
    const spans: Record<string, number> = {};
    let mark = startedAt;
    const lap = (name: string) => {
      const now = performance.now();
      spans[name] = Math.round(now - mark);
      mark = now;
    };
    this.claudeExecutable = await resolveClaudeExecutable(this.config.claudeExecutable);
    lap("claudeMs");
    // git 가드 훅 폴더를 기동 때 한 번 쓴다 — 세션을 띄우는 드라이버들이
    // gitGuardEnv 로 core.hooksPath 를 겨눌 때 훅이 이미 있어야 한다.
    ensureGitGuardHooks();
    // 시작 복구 · 기동 청소 (PLAN L12): 정상 종료가 살려 둔 진행 중 턴을 먼저
    // 꺼낸다 — 2시간 안의 것은 그 대화를 되살려 브리프 턴으로 이어받는다(그
    // 일은 라우터가 선 뒤, 아래에서). 나머지 방은 lost room 으로 — 그 말들은
    // 이제 입력창 초안의 몫이다.
    const recoveries = this.queueStore.takeStartupRecoveries();
    const orphaned = this.queueStore.sweepOrphans();
    if (orphaned > 0) this.logger?.info(`queue: recovered ${orphaned} lost room(s) from disk`);

    // Secrets move into the OS store on the way in; settings files keep only
    // what is not secret. A platform without its store yet keeps its plaintext.
    await migratePlaintextSecrets(this.credentials);

    // A pre-projects installation becomes one project here, folder and all,
    // and its per-project PAT — if the old layout left one — becomes the
    // machine-wide token nobody has to re-enter.
    // (5ca5253b 가 이 두 줄을 잃어 registry 가 비어 start() 가 넘어졌다 — 2026-09-25 복구.)
    this.registry = ProjectRegistry.load(process.env);
    this.machineSetting.load();
    this.fleet = new ProjectFleet({
      registry: this.registry,
      manager: this.manager,
      previewDrivers: this.drivers,
      broadcast: (m) => this.broadcast(m),
      notice: (n) => this.config.onNotice?.(n),
      logger: this.logger,
      claudeExecutable: () => this.claudeExecutable,
      agentDrivers: this.agentDrivers,
      machineTurn: (prompt, opts) => this.machineTurns.turn(prompt, opts),
      // 넘긴 요청의 작성자 이름 — 온보딩이 machine.json 에 저장한 값(P1-3).
      authorName: () => this.machineSetting.get("authorName"),
      closingSignal: this.closing.signal,
      pat: () => this.github.token,
      developerNotice: this.developerNotice,
      gitHubClient: () => this.github.client(),
      githubAuthExpired: () => this.github.authExpired,
      queueDiskFor: this.queueDiskFor,
      // 기획서(Confluence) 상태 배선(수용 항목 13) — 미러와 만료 판정은 지연 클로저다:
      // ConfluenceSync 는 이 아래 start() 에서 만들어진다.
      machineSetting: this.machineSetting,
      confluenceExpired: (slug) => this.confluence?.expiredState(slug) ?? false,
      // 발행 게이트 — 쓰기 경로(draft-service · doc-ops · doc-comments)와 같은 환경 변수를 읽는다(2026-10-23 U2).
      confluenceWritable: () => process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH === "1",
    });
    await migrateProjectPats(
      this.credentials,
      this.registry.list().map((project) => project.slug),
      this.registry.activeSlug(),
    );
    await this.github.load();
    // 슬라이스 5: 저장된 웹훅을 읽는다 — 상태 방송은 그 뒤에 일어난다.
    await this.escalation.load();
    lap("loadMs");
    this.confluence = new ConfluenceSync({
      machineSetting: this.machineSetting,
      credentials: this.credentials,
      workspaceOf: (slug) => {
        const workspaces = this.fleet?.workspaces.get(slug);
        if (workspaces === undefined) return null;
        return {
          root: workspaces.repo.root,
          laneRun: (kind, job, opts) => workspaces.repo.laneRun(kind, job, opts),
        };
      },
      slugs: () => this.registry?.list().map((project) => project.slug) ?? [],
      logger: this.logger,
    });
    this.confluence.start();
    // 기획 초안 — ConfluenceSync 바로 뒤에서 만든다(2026-10-23 작업 B2). 저장소는 슬러그마다
    // 한 벌씩 서비스 안에서 살고, 도는 생성은 stop() 이 끊는다.
    this.drafts = new DraftService({
      registry: this.registry,
      machineSetting: this.machineSetting,
      credentials: this.credentials,
      workspaceRoot: (slug) => this.fleet?.workspaces.get(slug)?.repo.root ?? null,
      claudeExecutable: () => this.claudeExecutable,
      broadcast: (m) => this.broadcast(m),
      logger: this.logger,
      ai: createDraftAiRunner(),
      publisher: new DraftPublisher(),
    });
    // 문서 관리 — 기획 초안 바로 옆에서 만든다(2026-10-23 작업 D1a). 적용 · 결과 불명 뒤에는 트리를
    // 걷게 한다 — 이동 · 휴지통은 증분이 못 본다(2026-10-23 · 최종 구현 계획 F2 · 작업 B5).
    const docOps = new DocOps({
      registry: this.registry,
      machineSetting: this.machineSetting,
      credentials: this.credentials,
      workspaceRoot: (slug) => this.fleet?.workspaces.get(slug)?.repo.root ?? null,
      broadcast: (m) => this.broadcast(m),
      logger: this.logger,
      walkNow: (slug) => this.confluence.walkNow(slug),
    });
    // 문서 코멘트 — 문서 관리 바로 옆에서 만든다(2026-10-23 작업 D2a). 기록은 활성
    // 프로젝트 데이터의 plans/comment-ops 에 산다.
    const docComments = new DocComments({
      registry: this.registry,
      machineSetting: this.machineSetting,
      credentials: this.credentials,
      workspaceRoot: (slug) => this.fleet?.workspaces.get(slug)?.repo.root ?? null,
      logger: this.logger,
    });
    this.router = new RequestRouter({
      manager: this.manager,
      fleet: this.fleet,
      previewDrivers: this.drivers,
      handoffPreviews: this.handoffPreviews,
      stats: this.stats,
      agentDrivers: this.agentDrivers,
      plans: this.plans,
      github: this.github,
      queueStore: this.queueStore,
      registry: this.registry,
      escalation: this.escalation,
      logger: this.logger,
      broadcast: (m) => this.broadcast(m),
      notice: (n) => this.config.onNotice?.(n),
      claudeExecutable: () => this.claudeExecutable,
      claudeExecutableOverride: () => this.config.claudeExecutable,
      setClaudeExecutable: (path) => this.adoptClaudeExecutable(path),
      refreshClaudeExecutable: () => this.refreshClaudeExecutable(),
      machineSetting: this.machineSetting,
      credentials: this.credentials,
      confluence: this.confluence,
      drafts: this.drafts,
      docOps,
      docComments,
      machineTurns: this.machineTurns,
      agentLogin: this.agentLogin,
      agentInstall: this.agentInstall,
      agentUpdates: this.agentUpdates,
      queueDiskFor: this.queueDiskFor,
      developerNotice: this.developerNotice,
      // 로그인이 돌아오면 기다리던 말을 다시 세운다 (PLAN L12) — 앱 안의
      // 로그인이 끝나는 순간을 놓치지 않게 하는 길이다.
      afterAgentLogin: () => void this.flushLoginWatchers(),
      status: () => this.status(),
      // 기능 제안 본문에 실릴 앱 버전 (PLAN-FEEDBACK) — 데스크톱은
      // app.getVersion() 을, 단독 실행은 데몬 package.json 의 값으로 이미 들어있다.
      appVersion: () => this.config.appVersion ?? null,
    });

    // 시작 복구 (PLAN L12): 라우터가 섰으니 아껴 둔 진행 중 턴을 되살려
    // 브리프로 연다. 기다리지 않는다 — 시작의 나머지 일을 늦추지 않게.
    if (recoveries.length > 0) void this.router?.recoverStartupTurns(recoveries);
    // 에이전트 새 버전 확인(PLAN-UI U12) — 기다리지 않는다, 그 뒤로 하루에 한 번.
    this.agentUpdates.start();

    // 감독자의 timer 틱 — 모든 프로젝트가 한 번씩 돈다 (PLAN L2). 열린
    // 넘김의 재읽기 · 착지 · 베이스 따라가기는 모두 이 틱의 판정이 한다.
    // unref: 테스트 러너와 데스크톱 in-process 호스트를 타이머가 붙잡지 않게.
    this.handoffTimer = setInterval(() => {
      for (const workspaces of this.fleet.workspaces.values()) {
        void workspaces.supervisor.tick("timer");
      }
    }, HANDOFF_POLL_MS);
    this.handoffTimer.unref?.();

    // Warm restart: bring the active project up the same way a switch does —
    // in particular, arm its token. A start that only built the workspace
    // left it unarmed until the planner happened to switch projects, so a
    // private repo could neither pull nor hand over after a restart.
    // `activateProject` sees nothing moving and stops after arming it.
    const activeSlug = this.registry.activeSlug();
    if (activeSlug) {
      const active = await this.activateProject(activeSlug);
      if (active.repo.remoteUrl) void active.repo.sync().catch(() => undefined);
    }

    // The sidebar's numbers and badges exist before anyone clicks (PLAN D18):
    // a workspace per project — cheap, synchronous, side-effect free — and
    // one `git status` per cloned project so a restart does not blank the
    // counts. Only the ACTIVE project gets a preview server; that is what
    // activation above already did. Clones re-arm their trust entry too: the
    // ~/.colonova-design migration renamed every clone path, and trust is keyed
    // by path.
    const sweeps: Array<Promise<unknown>> = [];
    for (const project of this.registry.list()) {
      const workspaces = this.workspacesFor(project.slug);
      workspaces.repo.setPat(this.github.token);
      if (workspaces.repo.isCloned()) {
        trustWorkspace(workspaces.paths.repoRoot);
        sanitizeRepoAgentSettings(workspaces.paths.repoRoot);
        // Awaited, not fired-and-forgotten: the first announce and every
        // client's first status read must see the counted clone, or a
        // restart blanks the counts for exactly the moment the tree also
        // starts scanning (PLAN D18/D59).
        sweeps.push(
          // 시작 훑기 — recoverParkedWork 를 부르던 자리가 감독자의 start 틱
          // 으로 바뀌었다(PLAN L2). 활성 프로젝트의 sync 와 겹치지 않는 것은
          // 차선이 보장한다. recoverShelf 는 그대로다.
          workspaces.supervisor
            .tick("start")
            // 치워둔 작업 자동 꺼내기 — 단추가 사라진 뒤에도 슬롯은 남아
            // 있다(v0.3.8~v0.3.10). 이 쓸기는 매 시작마다 돌므로 오늘
            // 놓아둔("kept") 슬롯은 작업 폴더가 깨끗해진 다음 시작에 다시
            // 시도된다.
            .then(() => workspaces.repo.recoverShelf())
            .then((shelf) => {
              if (shelf === "restored") {
                this.logger?.info(`repo: 치워둔 작업을 꺼내 놓았습니다 (${project.slug})`);
              } else if (shelf === "kept") {
                this.logger?.info(`repo: 치워둔 작업이 있지만 지금은 놓아둡니다 (${project.slug})`);
              }
            })
            .catch(() => undefined)
            .then(() => workspaces.repo.refreshPendingChanges()),
        );
      }
    }
    lap("activateMs");
    await Promise.all(sweeps);
    lap("sweepMs");
    if (this.registry.list().length > 0) this.announceProjects();

    this.http = createServer((req, res) => {
      // Everything this server emits is either per-run (a token'd page) or
      // live state: no store, ever — a disk cache must never hold a url that
      // carries the pairing token (QA generation-1 finding F2).
      res.setHeader("cache-control", "no-store");
      // A tiny health endpoint so `hub doctor` and launchd can probe the daemon.
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, protocolVersion: PROTOCOL_VERSION }));
        return;
      }
      if (this.config.webDist) {
        serveWeb(this.config.webDist, req, res);
        return;
      }
      res.writeHead(404).end();
    });

    this.wss = new WebSocketServer({ noServer: true });

    this.http.on("upgrade", (req, socket, head) => {
      // A browser page on another origin could drive this socket cross-site —
      // the token sits in the url, so an Origin-bearing client must be one of
      // ours: the daemon's own pages or the dev server. Non-browser clients
      // send no Origin and answer to the token alone.
      const origin = req.headers.origin;
      if (origin !== undefined && !this.allowedUpgradeOrigin(origin)) {
        this.logger.warn("허용되지 않은 출처의 연결 거부", {
          origin,
          remote: req.socket.remoteAddress ?? "unknown",
        });
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      // A malformed Host (or url) throws inside `new URL` — left alone that is
      // an uncaughtException in the daemon's own process. Reject the handshake.
      let url: URL;
      try {
        url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      } catch {
        this.logger.warn("잘못된 업그레이드 요청 거부", {
          remote: req.socket.remoteAddress ?? "unknown",
        });
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }
      const given = Buffer.from(url.searchParams.get("token") ?? "");
      const expected = Buffer.from(this.config.token);
      // Constant-time: this token guards every message the daemon accepts.
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        this.logger.warn("토큰 불일치 연결 거부", {
          remote: req.socket.remoteAddress ?? "unknown",
        });
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss?.handleUpgrade(req, socket, head, (ws) => this.attach(ws));
    });

    await new Promise<void>((resolve, reject) => {
      // A bind failure (the stored port is taken) must reach the caller as a
      // rejection, not crash the process on an unhandled 'error' event — the
      // daemon entry prints its Korean guidance from that rejection.
      this.http?.once("error", reject);
      this.http?.listen(this.config.port, this.config.host, () => resolve());
    });
    // 미리보기 포트 스캔은 이 포트를 못 본다 — 자식들이 fd 로 물려받은 이
    // 리스너를 자기 소켓으로 착각하는 함정을 닫는다(preview-claim 참조).
    daemonOwnedPorts.add(this.address().port);
    const bound = this.address();
    this.logger.info("데몬 시작", {
      host: bound.address,
      port: bound.port,
      protocolVersion: PROTOCOL_VERSION,
      // 베타 관측(2026-10-07): 이 줄이 어느 앱 · 어느 OS 의 것인지 — 버전 · 이름 · 숫자뿐이다.
      ...startupLogFields({
        appVersion: this.config.appVersion,
        platform: process.platform,
        osRelease: release(),
        arch: arch(),
        nodeVersion: process.versions.node,
      }),
      // 앱 시작이 느린 자리를 가리는 숫자들(2026-10-20, Windows 실측 — 창이 붙기까지 9~12초).
      // startMs 는 이 start() 의 몸(복구 · 훑기 포함), uptimeMs 는 프로세스가 뜬 뒤 여기까지다.
      // claudeMs · loadMs · activateMs · sweepMs 는 그 몸을 나눈 것이다(끝의 듣기는 나머지).
      startMs: Math.round(performance.now() - startedAt),
      ...spans,
      uptimeMs: Math.round(process.uptime() * 1000),
    });
  }

  /** Where the HTTP server actually bound (port 0 = ephemeral in desktop). */
  address(): { address: string; port: number } {
    const bound = this.http?.address() as { address: string; port: number };
    return bound;
  }

  /**
   * The origins a WebSocket upgrade may come from: the daemon's own pages
   * (loopback on the bound port — the desktop's one-process origin) and, on
   * the HMR dev path, the vite server the window was opened from
   * (`COLONOVA_DESIGN_DEV_SERVER`, desktop/scripts/dev.mjs). Anything else that
   * sends an Origin is a foreign page and gets a 403.
   */
  private allowedUpgradeOrigin(origin: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const port = this.address().port;
    const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname);
    if (loopback && parsed.port === String(port)) return true;
    const devServer = process.env.COLONOVA_DESIGN_DEV_SERVER;
    if (devServer) {
      try {
        if (parsed.origin === new URL(devServer).origin) return true;
      } catch {
        // A malformed dev-server env var allows nothing.
      }
    }
    return false;
  }

  /** 리뷰 B3: the desktop's close guard asks before quitting under a turn. */
  anySessionBusy(): boolean {
    return this.manager.anyBusy();
  }

  /**
   * 호스트(데스크톱 메인)가 이 데몬의 기록에 남기는 한 줄. 앱 안의 console 은 사용자에게 없는
   * 출력이라 지원에 필요한 흔적은 데몬의 파일 기록으로 모은다. 종류와 숫자만 싣는다 —
   * 사용자의 말 · 파일 경로 · 값은 남기지 않는다.
   */
  hostLog(message: string, fields?: Record<string, string | number>): void {
    this.logger.info(message, fields);
  }

  /**
   * Shutdown, asked for as many times as anyone likes. A second call joins
   * the first instead of running the sequence again: the old one re-entered
   * `http.close()` on a listener already closed (and already nulled), whose
   * callback never fires — the caller's promise hung forever, which is how
   * projects-e2e finished green while its `main()` never returned.
   */
  async stop(): Promise<void> {
    this.stopping ??= this.runStop();
    return this.stopping;
  }

  private async runStop(): Promise<void> {
    // First, before any await: the probes this run left unattended must stop
    // waiting on a CLI nobody is listening to any more.
    this.closing.abort();
    // 진행 중인 에이전트 로그인·설치도 이 데몬의 자식이다 — 데몬이 내려가면 함께 끊는다.
    this.agentLogin.stop();
    this.agentInstall.stop();
    this.agentUpdates.stop();
    // 도는 증분 타입 검사의 자식도 이 데몬의 것 — 내려갈 때 함께 끊는다.
    clearInterval(this.handoffTimer ?? undefined);
    this.handoffTimer = null;
    this.confluence?.stop();
    // 도는 기획 AI 생성도 이 데몬의 자식 — 내려갈 때 함께 끊는다(2026-10-23 작업 B2).
    this.drafts?.stop();
    this.logger.info("데몬 종료");
    await this.manager.closeAll();
    // Every project the daemon touched this run, not just the active one: an
    // inactive project may still hold a warm preview server, and every
    // preview process is ours to take down. The fleet itself may not exist —
    // a start() that failed before building it still owes stop() a clean
    // shutdown, not a TypeError that caches the rejection in `stopping`.
    for (const workspaces of this.fleet?.workspaces.values() ?? []) {
      // 감독자의 제출 재시도 타이머(N6)도 함께 거둔다 — 데몬이 내려간 뒤
      // 혼자 남아 틱을 돌리지 않게.
      workspaces.supervisor.stop();
      // Writers settle BEFORE the preview dies: a 최신화 killed between its
      // stash and its pop parks the planner's unsaved work in `git stash`.
      await workspaces.repo.settle();
      await workspaces.repo.stop();
    }
    // 수명 규칙의 마지막 자리 — 데몬이 내려가면 워크트리·서버·기록이 남는다.
    await this.handoffPreviews.dispose();
    for (const client of this.clients) client.close();
    this.wss?.close();
    // The web/http listener refs the event loop for as long as it listens —
    // the desktop in-process host and the test runner both stay alive until
    // it is closed, so stop() must close it, not just the websocket.
    const http = this.http;
    this.http = null;
    if (http) await new Promise<void>((resolve) => http.close(() => resolve()));
  }

  private attach(ws: WebSocket): void {
    this.clients.add(ws);
    this.logger.info("클라이언트 연결", { clients: this.clients.size });
    ws.on("close", () => {
      this.clients.delete(ws);
      this.logger.info("클라이언트 연결 해제", { clients: this.clients.size });
    });
    ws.on("message", (raw) => void this.onMessage(ws, String(raw)));

    void this.status().then((status) => {
      this.send(ws, {
        type: "hello",
        protocolVersion: PROTOCOL_VERSION,
        status,
      });
      // 재접속 복원 (리뷰 B1): the requests the window missed while it was
      // gone — the cards it must answer or the turn waits forever. THIS
      // socket only; a broadcast would double every other window's cards.
      // The client dedupes by requestId, so a flapping socket replays safe.
      for (const message of this.manager.pendingReplays()) this.send(ws, message);
    });
    void this.activeOrNull()
      ?.repo.status()
      .then((status) => this.broadcast({ type: "repo.status", status }));
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  }

  private broadcast(message: ServerMessage): void {
    for (const client of this.clients) this.send(client, message);
  }

  // -------------------------------------------------------------------------
  // Projects (PLAN D2[프로젝트]): what "the repo" currently means
  // -------------------------------------------------------------------------
  /**
   * A project's live workspace — the fleet (project-fleet.ts) owns the map,
   * the switch, the announces, and the handoff poll; the delegates below
   * keep the dispatch table and session wiring readable.
   */
  private workspacesFor(slug: string): ProjectWorkspaces {
    return this.fleet.workspacesFor(slug);
  }

  private activeOrNull(): ProjectWorkspaces | null {
    return this.fleet.activeOrNull();
  }

  private projectSummaries(): ProjectSummary[] {
    return this.fleet.projectSummaries();
  }

  private announceProjects(): void {
    this.fleet.announceProjects();
  }

  private refreshThreads(): void {
    this.fleet.refreshThreads();
  }

  private activateProject(slug: string): Promise<ProjectWorkspaces> {
    return this.fleet.activateProject(slug);
  }

  private workspaceOfSession(sessionId: string): ProjectWorkspaces | null {
    return this.fleet.workspaceOfSession(sessionId);
  }

  private readonly turnActivity = new Map<string, TurnActivity>();
  private readonly turnPrompts = new Map<string, { id: string; text: string }>();
  private readonly changedTurnFiles = new Map<string, string[]>();
  private readonly gateRequests = new Map<
    string,
    { requestId: string; afterTurn: number; text: string }
  >();
  private readonly turnEnds = new Map<string, "success" | "failed" | "interrupted">();

  private async prepareTurn(sessionId: string, item: { id: string; text: string }): Promise<void> {
    const workspace = this.workspaceOfSession(sessionId);
    if (!workspace) return;
    const activity = this.turnActivity.get(sessionId);
    // 2026-10-20 응답 지연 개선: 파일과 공급자 대화록을 읽지 않는다.
    // 진행 중인 보관만 기다려 다음 수정이 이전 보관에 섞이지 않게 한다.
    const saving = this.autoSaveLands.get(workspace.slug);
    if (saving) await saving;
    if (this.turnActivity.get(sessionId) !== activity || !this.manager.get(sessionId)) return;
    this.turnEnds.delete(sessionId);
    this.turnPrompts.set(sessionId, { id: item.id, text: item.text });
    if (readTurn(item.text).marker?.kind === "gate") {
      this.gateRequests.set(sessionId, { requestId: item.id, afterTurn: 0, text: item.text });
      return;
    }
    this.gateRequests.delete(sessionId);
    if (!this.drivers.gatedSessions.has(sessionId)) this.changedTurnFiles.delete(sessionId);
  }
  /**
   * 문제 없이 지나간 턴 끝 확인의 기록(2026-10-06) — 게이트 판정이 나서 자동 보관이 치러질 때까지 여기 산다. 보관이 서면
   * `screens.saved` 와 대화록에 실려 결과 카드가 「무엇을 확인했는지」 말한다. 문제를 찾았거나 확인하지 못한 턴에는 없다.
   */
  private readonly gateChecked = new Map<string, GateChecked>();

  /** 성공한 편집·명령이 있는 요청만 완료 뒤 미보관 파일을 확인한다. */
  private async finishChangedTurn(sessionId: string, duration: number | undefined): Promise<void> {
    const activity = this.turnActivity.get(sessionId);
    const workspace = this.workspaceOfSession(sessionId);
    const pending =
      workspace && activity?.mayHaveChanged
        ? await workspace.repo
            .repoCore()
            .diff()
            .catch(() => [])
        : [];
    if (
      this.turnActivity.get(sessionId) !== activity ||
      this.manager.get(sessionId)?.state !== "idle"
    )
      return;
    const changed =
      workspace && activity
        ? activity.changedFiles(
            workspace.paths.repoRoot,
            pending.map((file) => file.path),
          )
        : [];
    const originalFiles = this.changedTurnFiles.get(sessionId) ?? [];
    this.changedTurnFiles.set(sessionId, changed);
    const gate = this.gateRequests.get(sessionId);
    if (gate && workspace) {
      this.changedTurnFiles.set(sessionId, [...new Set([...originalFiles, ...changed])]);
      const result = await this.drivers.verifyRepair(
        sessionId,
        changed.length > 0,
        this.turnEnds.get(sessionId) ?? "failed",
      );
      if (this.gateRequests.get(sessionId) !== gate) return;
      appendTape(workspace.paths.root, {
        sessionId,
        afterTurn: gate.afterTurn,
        matchByText: gate.afterTurn === 0,
        event: {
          kind: "user.echo",
          text: gate.text,
          images: 0,
          requestId: gate.requestId,
          gateResult: result,
        },
      });
      this.broadcast({
        type: "session.event",
        sessionId,
        event: { kind: "gate.result", requestId: gate.requestId, result },
      });
      this.gateRequests.delete(sessionId);
      if (
        this.turnActivity.get(sessionId) !== activity ||
        this.manager.get(sessionId)?.state !== "idle"
      )
        return;
      this.finishWithoutGate(sessionId, "idle", duration);
      return;
    }
    if (changed.length === 0) {
      this.autoSaveDue.delete(sessionId);
      this.drivers.pinnedThisTurn.delete(sessionId);
      this.screenMapDue.delete(sessionId);
      this.finishWithoutGate(sessionId, "idle", duration);
    } else {
      // 2026-10-20 사용자 요청: 재검사 없이 연결 기록을 남기고 보관한다.
      const rows = workspace ? await readScreenMap(workspace.paths.root).catch(() => []) : [];
      if (
        this.turnActivity.get(sessionId) !== activity ||
        this.manager.get(sessionId)?.state !== "idle"
      )
        return;
      const routes = new Set([
        ...(this.drivers.pinnedThisTurn.get(sessionId)?.keys() ?? []),
        ...routesForFiles(changed, rows),
      ]);
      if (routes.size > 0) this.screenMapDue.set(sessionId, [...routes]);
      this.finishWithoutGate(sessionId, "idle", duration);
    }
  }

  private finishWithoutGate(
    sessionId: string,
    state: SessionState,
    turnDurationMs: number | undefined,
  ): void {
    const notice = noticeForState(
      sessionId,
      state,
      this.manager.get(sessionId)?.title ?? NEW_SESSION_TITLE,
      turnDurationMs,
    );
    if (notice) this.config.onNotice?.(notice);
    // 게이트가 없는 턴의 커밋은 여기서 곧바로 — idle 에만. 다른 상태의
    // idle 아닌 방송(running · waiting_*)은 아직 턴의 끝이 아니다.
    if (state === "idle") this.runAutoSave(sessionId);
  }

  /** 다음 턴은 직전 보관의 커밋까지 기다린다. */
  private readonly autoSaveLands = new Map<string, Promise<void>>();

  private runAutoSave(sessionId: string): void {
    const routes = this.screenMapDue.get(sessionId);
    this.screenMapDue.delete(sessionId);
    // 이 턴의 확인 기록은 이 보관이 가져가고 — 보관이 없는 턴에서도 다음 턴으로 새지 않게 여기서 비운다.
    const checked = this.gateChecked.get(sessionId);
    this.gateChecked.delete(sessionId);
    if (!this.autoSaveDue.delete(sessionId)) return;
    const workspaces = this.workspaceOfSession(sessionId);
    const answer = this.manager.get(sessionId)?.lastAssistantText ?? null;
    const url = workspaces?.repo.repoCore().previewUrl;
    let origin: string | null = null;
    try {
      origin = url ? new URL(url).origin : null;
    } catch {
      // 주소를 읽지 못해도 보관은 진행한다.
    }
    const changedScreens = screensOfTurn(
      routes ?? [...(this.drivers.pinnedThisTurn.get(sessionId)?.keys() ?? [])],
      answer,
      origin,
      true,
    );
    const source = changedScreens.map((screen) => screen.route);
    const autoSave = this.fleet.autoSaveTurn(sessionId, source, checked);
    // 커밋이 내려앉은 순간 — 실패도 「끝」이다(다음 턴을 영원히 세우지 않는다).
    const landed: Promise<void> = autoSave.then(
      () => undefined,
      () => undefined,
    );
    if (workspaces) {
      this.autoSaveLands.set(workspaces.slug, landed);
      void landed.then(() => {
        if (this.autoSaveLands.get(workspaces.slug) === landed)
          this.autoSaveLands.delete(workspaces.slug);
      });
    }
    // 차례의 전제: 아래 then 은 landed 보다 뒤에 걸렸으므로 커밋이 내려앉으면 landed 가
    // 먼저 풀리고, 이 then 의 동기 구간(대화록의 user.echo 를 changedScreens 와 함께 다시
    // 적는 자리)이 다음 턴의 beforeDeliver 가 이어지기 전에 지나간다 — 대화록에서 지난
    // 턴의 줄이 새 턴의 user.echo 뒤에 서지 않는다. 그 구간에 await 를 넣지 않는다.
    void autoSave
      .then(async (saved) => {
        if (!workspaces || !saved?.requestId) return;
        const prompt = readTape(workspaces.paths.root, sessionId).find(
          (row) => row.event.kind === "user.echo" && row.event.requestId === saved.requestId,
        );
        if (prompt && prompt.event.kind === "user.echo") {
          appendTape(workspaces.paths.root, {
            ...prompt,
            event: { ...prompt.event, changedScreens, ...(checked ? { checked } : {}) },
          });
        }
        this.broadcast({
          type: "session.event",
          sessionId,
          event: {
            kind: "screens.saved",
            requestId: saved.requestId,
            screens: changedScreens,
            ...(checked ? { checked } : {}),
          },
        });
        this.broadcast({ type: "repo.status", status: workspaces.repo.repoCore().snapshot() });
      })
      .catch(() => this.logger.info("Turn save record unavailable"))
      .finally(() => {
        // 턴이 idle 이 되어 자동 보관이 끝난 뒤 — 감독자가 사이클을 한 번 본다.
        void workspaces?.supervisor.tick("turn-idle");
      });
  }

  private async status() {
    const active = this.activeOrNull();
    const registry = active?.repo.registry() ?? null;
    const base = await buildStatus({
      executable: this.claudeExecutable,
      liveSessions: this.manager.liveCount,
      pendingPermissions: this.manager.pendingCount,
      // The registry probe only makes sense inside a repo that declares one,
      // and it asks that repo's own scope — never a package fixed in advance.
      registryProbe:
        active && registry ? { dir: active.repo.root, scope: scopeOf(registry) } : null,
    });
    // A repo that ships its own pre-approved tool rules widens its sessions
    // past the card flow — the planner should hear that it did. It rides its
    // own field, not the env warnings: this is news, not a live problem, and
    // the fingerprint lets a client that has read it stay quiet until the
    const repoSettings = active ? repoSettingsWarning(active.repo.root) : null;
    const providers = await Promise.all(
      this.agentDrivers.all().map(async (driver) => {
        const descriptor = driver.describe();
        const diagnostic = await driver.isAvailable().catch((): Diagnostic => ({ ok: false }));
        return {
          id: descriptor.id,
          label: descriptor.label,
          available: diagnostic.ok,
          ...(diagnostic.version ? { version: diagnostic.version } : {}),
          ...(this.agentUpdates.latest(descriptor.id)
            ? { latestVersion: this.agentUpdates.latest(descriptor.id) }
            : {}),
          ...(diagnostic.loggedIn !== undefined ? { loggedIn: diagnostic.loggedIn } : {}),
          ...(diagnostic.reason ? { reason: diagnostic.reason } : {}),
          oneShot: driver.oneShot !== undefined,
          capabilities: {
            ...descriptor.capabilities,
          } as Record<string, unknown>,
        };
      }),
    );
    // The picker's rows before any thread: drivers that can answer without
    // a session are read once per run, off this await — the next broadcast
    // carries whatever landed.
    this.plans.refreshModels();
    // 마지막 확인에서 한 시간이 지났으면 새 버전을 뒤에서 다시 본다(PLAN-UI U12).
    this.agentUpdates.maybeCheck();
    // 기계 주의 (PLAN L8): GitHub 만료 · 에이전트 로그아웃의 since 를 세고,
    // 환경 경고를 개발자 알림과 맞춘다. 주의는 우선순위 하나만 화면에 선다.
    const attention = this.machineAttention(base);
    this.syncMachineNotices(base.warnings ?? []);
    return {
      ...base,
      repoSettingsWarning: repoSettings,
      planUsageByProvider: this.plans.currentAll(this.agentDrivers.all().map((d) => d.id)),
      modelsByProvider: this.plans.models,
      projects: this.projectSummaries(),
      activeProject: this.registry?.activeSlug() ?? null,
      providers,
      machineProvider: this.machineSetting.get("provider"),
      machineProviderActive: await this.machineTurns.resolve(),
      // 개발 전용 면의 판정은 데몬이 내린다 — 웹 번들의 DEV 플래그는 패키징 빌드라 항상 거짓.
      dev: this.config.devAgents === true,
      authorName: this.machineSetting.get("authorName"),
      agentAutoUpdate: this.machineSetting.get("agentAutoUpdate") !== "off",
      ...(this.agentUpdates.snapshot() ? { agentUpdates: this.agentUpdates.snapshot() } : {}),
      githubAuthExpired: this.github.authExpired,
      // 만료 예정(U17) — 브리지가 아직 모르면(첫 관찰 전) machine.json 의 값.
      githubTokenExpiresAt:
        this.github.tokenExpiresAt ?? this.machineSetting.get("githubTokenExpiresAt"),
      // 슬라이스 5: 설정 폼과 `개발자 부르기` 가 잠긴 채 보이던 이유 — 상태가
      // 이 한 단어를 채우지 않았다 (PLAN 단계 0). 비밀 자체는 못 나간다.
      escalationConfigured: this.escalation.configured,
      // 개발자 알림이 실제로 갈 수 있는 경로 (PLAN L8) — 화면의 "알렸어요" 가
      // 이 값을 읽는다. GitHub 우선, Slack 보조, 둘 다 없으면 none.
      noticeRoute: this.noticeRoute(),
      ...(attention ? { attention } : {}),
    };
  }

  /** 개발자 알림이 실제로 갈 수 있는 경로 — GitHub 우선, Slack 보조. */
  private noticeRoute(): "github" | "slack" | "none" {
    if (this.github.client() !== null && !this.github.authExpired) return "github";
    return this.escalation.configured ? "slack" : "none";
  }

  /**
   * 만료 예고(U17) — 판정이 경고 창(14일) 안으로 들어서면 개발자에게 한 번
   * 알리고(새 초대 파일 요청), 새 코드가 오거나 창 밖으로 나가면 거둔다. 슬러그를
   * 꼭 준다 — 기계 알림(slug 없음)은 Slack · 로그로만 가서 GitHub 만 쓰는
   * 개발자에게 닿지 않는다. 보낸 슬러그는 machine.json 이 기억하므로 거둠이
   * 재시작을 넘는다. 조용한 키라 화면의 문제 문장은 늘어나지 않는다.
   */
  private noteTokenExpiry(iso: string | null): void {
    const judged = iso === null ? null : expiryJudgement(iso);
    const step = expiryNoticeStep({
      judged,
      storedSlug: this.machineSetting.get("githubExpiryNoticeSlug"),
      activeSlug: this.registry?.activeSlug() ?? this.registry?.list()[0]?.slug ?? null,
    });
    if (step.raise !== undefined) {
      this.machineSetting.set("githubExpiryNoticeSlug", step.raise);
      void this.developerNotice.raise({
        key: "github:expiring",
        slug: step.raise,
        ...describeProblem("github:expiring", `만료: ${iso} · ${judged?.daysLeft}일 남음`),
      });
    }
    if (step.resolve !== undefined) {
      this.machineSetting.set("githubExpiryNoticeSlug", null);
      void this.developerNotice.resolve("github:expiring", step.resolve);
    }
    void this.status().then((status) => this.broadcast({ type: "status", status }));
  }
  /**
   * 로그인 감시 (PLAN L12) — 로그인 만료로 멈춘 대화를 30초에 한 번 본다.
   * `claude auth status` 가 CLI 를 띄우는 검사라 자주 볼 수 없다: 앱 안의
   * 로그인이 끝나는 순간(afterAgentLogin)과 상태 방송에 얹힐시 확인이 그
   * 사이를 메운다. 로그인이 돌아오면 상태를 다시 방송하고 그 말을 한 번 다시
   * 보낸다(resumeAfterLogin).
   */
  armLoginWatcher(sessionId: string): void {
    if (this.loginWatchers.has(sessionId)) return;
    const timer = setInterval(() => void this.checkLoginWatcher(sessionId), 30_000);
    timer.unref?.();
    this.loginWatchers.set(sessionId, timer);
  }

  /** 감시 전부를 지금 확인한다 — 앱 안 로그인이 끝났을 때의 길. */
  async flushLoginWatchers(): Promise<void> {
    await Promise.all([...this.loginWatchers.keys()].map((id) => this.checkLoginWatcher(id)));
  }

  private async checkLoginWatcher(sessionId: string): Promise<void> {
    const session = this.manager.get(sessionId);
    const timer = this.loginWatchers.get(sessionId);
    if (!session || session.state === "closed" || timer === undefined) {
      if (timer !== undefined) {
        clearInterval(timer);
        this.loginWatchers.delete(sessionId);
      }
      return;
    }
    const driver = this.agentDrivers.get(session.provider);
    const diagnostic = await driver?.isAvailable().catch(() => null);
    if (diagnostic?.loggedIn !== true) return;
    clearInterval(timer);
    this.loginWatchers.delete(sessionId);
    // 로그인이 돌아왔다는 소식도 함께 — 상태 방송이 주의를 거둔다.
    await this.status().then((status) => this.broadcast({ type: "status", status }));
    session.resumeAfterLogin();
  }

  /**
   * 기계 전체의 주의 (PLAN L8) — GitHub 만료와 에이전트 로그아웃은 사용자의
   * 손이 필요한 유일한 문제다. since 는 처음 선 시각을 기억한다.
   */
  private machineAttention(base: { claudeExecutable: string | null; loggedIn: boolean }) {
    const loggedOut = base.claudeExecutable !== null && !base.loggedIn;
    if (loggedOut) this.agentLoggedOutAt ??= new Date().toISOString();
    else this.agentLoggedOutAt = null;
    return composeAttention({
      reconnect: this.githubExpiredAt
        ? { what: "github" as const, since: this.githubExpiredAt }
        : this.agentLoggedOutAt
          ? { what: "agent-login" as const, since: this.agentLoggedOutAt }
          : null,
      aiFixingSince: null,
      notices: this.developerNotice.machineNotices(),
    });
  }

  /**
   * 환경 경고 → 개발자 알림 (PLAN L11) — status 가 만드는 warnings 에
   * ANTHROPIC_API_KEY · CLI 없음 · git 없음 · 패키지 토큰 거절이 있으면
   * `env:<종류>` 로 한 번 올리고(기계 전체라 Slack), 사라지면 거둔다.
   */
  private syncMachineNotices(warnings: string[]): void {
    const keys = new Set<string>();
    for (const warning of warnings) {
      const key = warning.startsWith("데몬 환경에 ANTHROPIC_API_KEY")
        ? "env:anthropic-key"
        : warning.startsWith("Claude Code CLI 를 찾지 못했습니다")
          ? "env:claude-cli"
          : warning.startsWith("git 이 없어")
            ? "env:git"
            : warning.startsWith("GitHub 패키지 저장소가")
              ? "env:packages-token"
              : null;
      if (key === null) continue;
      keys.add(key);
      void this.developerNotice.raise({ key, slug: null, ...describeProblem(key, warning) });
    }
    for (const key of Object.keys(this.developerNotice.machineNotices())) {
      if (key.startsWith("env:") && !keys.has(key)) void this.developerNotice.resolve(key, null);
    }
  }

  private async onMessage(ws: WebSocket, raw: string): Promise<void> {
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      // 선로 해석 실패의 답은 사람의 말이다 — zod 의 영어 문장이 화면에 오르지 않게
      // 한다(2026-10-23 · 웹 검토 R2 의 3). 로그는 필드 경로의 검사 문장만 —
      // 사용자의 글은 남지 않는다.
      this.logger.info("선로 해석 실패", { issues: parsed.error });
      this.send(ws, {
        type: "error",
        id: parsed.id,
        message: "요청을 읽지 못했어요 — 글이 너무 길거나 고른 것이 너무 많을 수 있어요",
        code: "bad_request",
      });
      return;
    }
    const message = parsed.value;
    // 멱등 답변(command-dedupe.ts): the same id never runs twice. A resend
    // that arrives while the first run is in flight joins it, and one that
    // arrives after it settled gets the remembered reply — so a retried
    // session.send cannot send twice and a retried save cannot commit twice.
    const reply = await this.dedupe.run(message.id, () => this.produceReply(message));
    this.send(ws, reply);
  }

  /**
   * 한 명령의 답 하나 — ok 이든 error 이든 dedupe 가 기억하는 정산물이다.
   * 절대 던지지 않는다: 실패도 실행의 결과라, 재전송은 같은 실패 답을 다시
   * 본다. 새로 시도하는 것은 새 id 가 하는 일이다.
   */
  private async produceReply(message: ClientMessage): Promise<ServerMessage> {
    try {
      const data = await this.router.dispatch(message);
      return { type: "ok", id: message.id, data };
    } catch (error) {
      // The one Korean boundary every RPC refusal passes (리뷰 C1·C3): the
      // daemon's own guards already answer in Korean and pass through
      // untouched, while a foreign error — the SDK's "Query closed before
      // response received" once rode the wire to the chat banner — is logged
      // here verbatim and replaced by the recovery sentence.
      this.logger.error("요청 실패", { type: message.type, err: error });
      // 오류가 실은 기계 코드(draft.stale 같은)는 답에 함께 나른다 — 화면이 처지를 가린다(2026-10-23 작업 B2).
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string" &&
        error.code.startsWith("draft.")
          ? error.code
          : undefined;
      return {
        type: "error",
        id: message.id,
        message: asPlannerFacingError(error).message,
        ...(code !== undefined ? { code } : {}),
      };
    }
  }
}

/** D1: 답변 한 덩이에서 http(s) 주소를 걷는다 — 문장 부호를 뗀 채로. */
function linksOf(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>)\]]+/g)].map((match) =>
    match[0].replace(/[.,;:!?"'`]+$/, ""),
  );
}
