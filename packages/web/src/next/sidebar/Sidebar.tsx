import type { ThreadSummary } from "@colonova-design/protocol";
import { Monitor } from "lucide-react";
import { type ReactNode, type Ref, useState } from "react";
import type { Sessions } from "../../hooks/useSessions";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import { keyHint } from "../lib/key-hint";
import { hasNewerVersion } from "../lib/version";
import type { ShellNav } from "../slots";
import { Count } from "../ui/Count";
import {
  CloseIcon,
  GearIcon,
  LightbulbIcon,
  PanelIcon,
  PlansDocIcon,
  PlusIcon,
  SearchIcon,
  Spin,
} from "../ui/icons";
import { ConversationList } from "./ConversationList";
import { OtherProjects } from "./OtherProjects";
import { ProjectSwitcher } from "./ProjectSwitcher";

/** 프로젝트 · 자리 셋 · 자리별 목록 · 설정을 놓는다. 좁은 창에서는 같은 내용이 서랍에 선다(2026-10-23 화면 전면 재설계 §3.2). */
export function Sidebar({
  daemon,
  sessions,
  activeSessionId,
  plansOn = false,
  planDrafts = 0,
  running = false,
  plansContent,
  titleFor,
  nav,
  onPalette,
  onFeedback,
  onCollapse,
  drawer = false,
  onRenameSession,
  hidden = false,
  containerRef,
}: {
  daemon: Daemon;
  /** `useSessions` 의 결과 — 대화 목록의 지우기 · 이름 바꾸기가 쓴다. */
  sessions: Sessions;
  activeSessionId: string | null;
  /** 기획서 자리인가. 자리 표시와 목록 선택에 쓴다. */
  plansOn?: boolean;
  /** 지금 프로젝트의 작성 중인 초안 수 — `기획서` 줄 끝에 흐리게 선다(2026-10-23 기획자 화면 손질 D5). */
  planDrafts?: number;
  running?: boolean;
  plansContent?: ReactNode;
  titleFor: (thread: ThreadSummary) => string;
  nav: ShellNav;
  /** ⌘K 팔레트를 연다. */
  onPalette: () => void;
  /** 기능 제안 대화상자를 연다(PLAN-FEEDBACK) — 앱 전체 기능이라 활성 대화와 무관하다. */
  onFeedback: () => void;
  /** 넓은 창의 접기 — 좁은 창에서는 서랍 닫기. */
  onCollapse: () => void;
  /** 좁은 창의 서랍인가 — 머리의 단추가 접기(패널 그림)가 아니라 닫기(✕)가 된다. */
  drawer?: boolean;
  /** 이름 바꾸기 — 설정의 대화 제목에 남는다(셸의 `onRenameSession`). */
  onRenameSession: (sessionId: string, title: string) => void;
  /** 접힘(넓은 창) · 닫힘(좁은 창 서랍) — 초점과 접근 이름이 안으로 들어가지
      않게 한다(작업 기록 서랍과 같은 패턴). */
  hidden?: boolean;
  /** 셸이 서랍을 열 때 첫 줄로 초점을 옮기기 위해 쥐는 자리. */
  containerRef?: Ref<HTMLElement>;
}) {
  const projects = daemon.projects;
  const active = projects.find((project) => project.slug === daemon.activeSlug) ?? null;
  // `프로젝트 N개 더 보기` 가 전환기 목록을 여는 신호 — 누를 때마다 한 칸 올라 목록이 열린다.
  const [openSwitcher, setOpenSwitcher] = useState(0);
  // `화면` 줄의 기다림 배지 — 지금 프로젝트의 「내 손이 필요한 일」만 센다(2026-10-31 홈 걷기 —
  // 옛 `홈` 줄은 모든 프로젝트의 수를 섰다). 다른 프로젝트의 기다림은 `다른 프로젝트` 줄이 말한다.
  const waiting = active?.pendingCount ?? 0;
  const author = daemon.status?.authorName?.trim() || null;
  // 설정 바퀴의 점 — 깔려 있는 AI 중 새 버전을 아는 것이 있으면 한 알(PLAN-UI U12).
  const updateReady = (daemon.status?.providers ?? []).some(
    (provider) => provider.available && hasNewerVersion(provider.version, provider.latestVersion),
  );

  return (
    <aside className="nx-sidebar" aria-hidden={hidden} inert={hidden} ref={containerRef}>
      <div className="nx-side-top">
        <span className="nx-brand">
          <img src="/colonova-icon.svg" alt="" width={20} height={20} />
          {L.sidebar.brand}
        </span>
        {/* 서랍 안에는 닫는 단추가 없어 스크림 · Esc · ⌘B 만 남았다 — 겹판처럼 머리 오른쪽에 ✕ 가 선다. */}
        <button
          type="button"
          className="nx-ibtn nx-collapse-btn"
          title={drawer ? L.shell.closeMenu : keyHint(L.sidebar.collapse)}
          aria-label={drawer ? L.shell.closeMenu : keyHint(L.sidebar.collapse)}
          onClick={onCollapse}
        >
          {drawer ? <CloseIcon /> : <PanelIcon />}
        </button>
      </div>
      <ProjectSwitcher
        daemon={daemon}
        projects={projects}
        active={active}
        onSwitch={nav.switchProject}
        onToast={nav.toast}
        openSignal={openSwitcher}
      />
      <nav className="nx-side-nav" aria-label={L.sidebar.nav}>
        <button type="button" className="nx-side-row" onClick={onPalette}>
          <SearchIcon />
          {L.sidebar.find}
          <kbd>{keyHint("⌘K")}</kbd>
        </button>
        {/* 왼쪽 줄의 차례는 찾기 · 기획서 · 화면이다 — 홈 자리는 2026-10-31 사용자 결정으로 걷혔다. */}
        <button
          type="button"
          className={`nx-side-row${plansOn ? " nx-side-row--on" : ""}`}
          aria-current={plansOn ? "page" : undefined}
          aria-label={planDrafts > 0 ? L.sidebar.plansDraftsAria(planDrafts) : undefined}
          title={L.plans.open}
          onClick={nav.openPlans}
        >
          <PlansDocIcon />
          {L.plans.sidebar}
          {planDrafts > 0 && (
            <span className="nx-side-note" aria-hidden="true">
              {L.sidebar.plansDrafts(planDrafts)}
            </span>
          )}
        </button>
        <button
          type="button"
          className={`nx-side-row${!plansOn ? " nx-side-row--on" : ""}`}
          aria-current={!plansOn ? "page" : undefined}
          aria-label={
            running
              ? L.sidebar.screenRunning
              : waiting > 0
                ? L.sidebar.waitingAnswerCount(waiting)
                : undefined
          }
          title={
            running
              ? L.sidebar.screenRunning
              : waiting > 0
                ? L.sidebar.waitingAnswerCount(waiting)
                : undefined
          }
          onClick={nav.openScreen ?? nav.showScreen}
        >
          <Monitor className="nx-i" size={16} aria-hidden="true" />
          {L.sidebar.screen}
          {/* 옛 `홈` 줄의 기다림 배지(2026-10-31 홈 걷기) — 지금 프로젝트의 기다림만 센다. */}
          {waiting > 0 && !running && <Count n={waiting} className="nx-r" />}
          {running && (
            <span className="nx-side-note" title={L.sidebar.screenRunning}>
              <Spin />
            </span>
          )}
        </button>
      </nav>
      {plansContent}
      <div className="nx-side-conversations" hidden={plansOn}>
        <div className="nx-side-list-head">
          <h2>{L.sidebar.convs}</h2>
          <button
            type="button"
            className="nx-btn nx-btn--sm nx-btn--ghost"
            onClick={() => nav.newThread()}
            title={keyHint(`${L.sidebar.newConv} · ⌘T`)}
          >
            <PlusIcon />
            {L.sidebar.newConv}
          </button>
        </div>
        <OtherProjects
          projects={projects}
          activeSlug={daemon.activeSlug}
          onSwitch={nav.switchProject}
          onMore={() => setOpenSwitcher((count) => count + 1)}
        />
        <ConversationList
          daemon={daemon}
          project={active}
          sessions={sessions}
          activeSessionId={activeSessionId}
          titleFor={titleFor}
          onOpen={(thread) => active && nav.openThread(active.slug, thread.id)}
          onRenameSession={onRenameSession}
          onToast={nav.toast}
        />
      </div>
      <div className="nx-side-bottom">
        <button type="button" className="nx-side-row nx-fb-row" onClick={onFeedback}>
          <LightbulbIcon />
          {L.feedback.button}
        </button>
        <button
          type="button"
          className="nx-me"
          aria-label={updateReady ? L.sidebar.settingsUpdate : L.sidebar.settings}
          title={updateReady ? L.sidebar.settingsUpdate : L.sidebar.settings}
          onClick={() => nav.openSettings()}
        >
          {author && <span className="nx-me-av">{Array.from(author)[0]}</span>}
          <b>{author ?? L.sidebar.settings}</b>
          <span className="nx-grow" />
          <span className="nx-muted">
            <span className={updateReady ? "nx-gear-dot" : ""}>
              <GearIcon />
            </span>
          </span>
        </button>
      </div>
    </aside>
  );
}
