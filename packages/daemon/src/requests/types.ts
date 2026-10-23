import type { ClientMessage, ServerMessage } from "@colonova-design/protocol";
import type { DriverRegistry } from "../agent/registry.js";
import type { AgentInstall } from "../agent-install.js";
import type { AgentUpdates } from "../agent-update.js";
import type { ConfluenceSync } from "../confluence-sync.js";
import type { CredentialStore } from "../credentials.js";
import type { DeveloperNotice } from "../developer-notice.js";
import type { DocComments } from "../doc-comments.js";
import type { DocOps } from "../doc-ops.js";
import type { DraftService } from "../draft-service.js";
import type { Escalation } from "../escalation.js";
import type { GitHubBridge } from "../github-bridge.js";
import type { HandoffPreviews } from "../handoff-preview.js";
import type { DaemonLogger } from "../log.js";
import type { DaemonNotice } from "../notices.js";
import type { AgentLogin } from "../onboarding.js";
import type { PlanTracker } from "../plan-tracker.js";
import type { PreviewDrivers } from "../preview-drivers.js";
import type { ProjectFleet } from "../project-fleet.js";
import type { ProjectRegistry } from "../projects.js";
import type { QueueDisk, QueueStore } from "../queue-store.js";
import type { SessionManager } from "../session-manager.js";
import type { TurnStats } from "../turn-stats.js";

/**
 * 서버가 라우터에 넘기는 것 — 프로토콜의 모든 요청이 거치는 좁은 문. 협력자는
 * 참조로, 실행 중 바뀌는 값은 콜백으로, 바깥에도 쓰이는 상태맵은 공유로.
 */
export interface RouterDeps {
  manager: SessionManager;
  fleet: ProjectFleet;
  previewDrivers: PreviewDrivers;
  /**
   * 시점 빌드 재현 — the handed-off moment's worktree
   * build. The server owns its lifetime; the router only relays.
   */
  handoffPreviews: HandoffPreviews;
  /** The agent provider registry — session.create resolves its driver here. */
  agentDrivers: DriverRegistry;
  plans: PlanTracker;
  github: GitHubBridge;
  queueStore: QueueStore;
  registry: ProjectRegistry;
  /** 슬라이스 5: 환경 실패를 개발자 채널로 흘리는 문 — 저장된 웹훅의 주인. */
  escalation: Escalation;
  /** 기계 잔일의 설정(machine.json) — machine.set · machine.author.set 이 쓰고 상태가 읽는다. */
  machineSetting: { get(key: string): string | null; set(key: string, value: string | null): void };
  /** 자격 저장소(키체인 · DPAPI · memory) — confluence.connect 이 이메일·토큰 짝을 둔다. */
  credentials: CredentialStore;
  /** 기획서 가져오기의 몸 — importNow 의 합류와 만료 판정은 이 모듈의 것이다. */
  confluence: ConfluenceSync;
  /** 기획 초안의 몸 — draft.* 요청이 잇는다(2026-10-23 최종 구현 계획 F1). */
  drafts: DraftService;
  /** 문서 관리의 몸 — doc.trash · doc.restore · doc.copy · doc.move 가 잇는다(2026-10-23 작업 D1a). */
  docOps: DocOps;
  /** 문서 코멘트의 몸 — doc.comment.* 가 잇는다(2026-10-23 작업 D2a). */
  docComments: DocComments;
  /** 담당의 캐시 — 설정이 바뀌면 지운다(invalidate). */
  machineTurns: { invalidate(): void };
  notice(notice: DaemonNotice): void;
  logger: DaemonLogger;
  /** 터미널 없는 에이전트 로그인(P1-1) — 데몬이 파이프로 몰고 방송한다. */
  agentLogin: AgentLogin;
  /** 에이전트 설치 진행기(1단계) — 데몬이 끝까지 지켜보고 방송한다. */
  agentInstall: AgentInstall;
  /** 에이전트 업데이트(PLAN-UI U12) — 확인 · 미루기 · 자동 설치의 담당. */
  agentUpdates: AgentUpdates;
  broadcast(message: ServerMessage): void;
  /** 해석된 CLI 경로 — start() 가 채운다. */
  claudeExecutable(): string | null;
  /**
   * 설치 성공이 방금 푼 claude 경로를 데몬에 심는다(2026-09-24) — 드라이버와
   * 상태가 읽는 자리가 같은 필드라 로그인 버튼이 재시작 없이 새 CLI 를 안다.
   */
  setClaudeExecutable(path: string | null): void;
  /** onboarding.check 의 방어 — 풀린 적 없으면(null) 한 번 다시 푼다. */
  refreshClaudeExecutable(): Promise<void>;
  /** 설정의 CLI 경로 오버라이드 — 온보딩 체크가 읽는다. */
  claudeExecutableOverride(): string | undefined;
  queueDiskFor(sessionId: string): QueueDisk;
  /** 개발자 알림 (PLAN L11) — 턴 자기치유의 예산 초과가 올라가는 문 (L12). */
  developerNotice: DeveloperNotice;
  /** 앱이 에이전트 로그인을 마쳤다 — 로그인 대기 중인 말을 다시 세운다 (L12). */
  afterAgentLogin?: () => void;
  /** 프로젝트 전환 직후 — pane 이 다른 페이지를 겨누기 시작했음을 알린다. */
  afterProjectSwitch?: () => void;
  status(): Promise<unknown>;
  /** 턴 통계 — 보내기 문에서 잰 핀 강화 시간만 흘려 준다. */
  stats: TurnStats;
  /**
   * 앱 버전 (PLAN-FEEDBACK) — 기능 제안 본문에 실린다. 선택인 이유는 기존
   * 목업·서버 시험 깨지지 않게 하려는 것뿐이고, 서버는 항상 심는다.
   */
  appVersion?: () => string | null;
}

/** 메시지 종류마다 해당 메시지만 받는다. */
export type RequestHandlers<K extends ClientMessage["type"] = ClientMessage["type"]> = {
  [T in K]: (message: Extract<ClientMessage, { type: T }>) => unknown;
};
