import type { ThreadSummary } from "@colonova-design/protocol";
import { type Ref, useState } from "react";
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
  HomeIcon,
  LightbulbIcon,
  PanelIcon,
  PlusIcon,
  SearchIcon,
} from "../ui/icons";
import { ConversationList } from "./ConversationList";
import { OtherProjects } from "./OtherProjects";
import { ProjectSwitcher } from "./ProjectSwitcher";

/**
 * 사이드바(U1 · U7) — 위에서부터 `새 대화 · 홈 · 찾기`, 프로젝트 전환기, 다른
 * 프로젝트 줄, 날짜 머리 아래의 대화 목록, 접힌 `도구가 한 일`, 바닥에 기능 제안과
 * 작성자 · 설정. 넓은 창은 열(접힘 · 너비 조절 가능), 좁은 창은 `≡` 뒤의 서랍이다 — 모양은
 * 셸의 CSS 가 정하고 이 컴포넌트는 같은 내용을 그린다.
 */
export function Sidebar({
  daemon,
  sessions,
  activeSessionId,
  view,
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
  view: "home" | "thread";
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
  // 홈 배지는 확인 요청만 센다 — 「내 손이 필요한 일」의 수, 모든 프로젝트에 걸쳐(U6).
  const waiting = projects.reduce((sum, project) => sum + project.pendingCount, 0);
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
      <nav className="nx-side-nav" aria-label={L.sidebar.nav}>
        <button
          type="button"
          className="nx-side-row nx-side-row--new"
          onClick={() => nav.newThread()}
        >
          {/* 사이드바의 으뜸 행동 — 브랜드 색이 든 알약 하나로 다른 두 줄과 가른다(2026-10-06). */}
          <span className="nx-newmark">
            <PlusIcon />
          </span>
          {L.sidebar.newConv}
          <kbd>{keyHint("⌘T")}</kbd>
        </button>
        <button
          type="button"
          className={`nx-side-row${view === "home" ? " nx-side-row--on" : ""}`}
          aria-current={view === "home" ? "page" : undefined}
          onClick={nav.goHome}
        >
          <HomeIcon />
          {L.sidebar.home}
          {waiting > 0 && <Count n={waiting} className="nx-r" />}
        </button>
        <button type="button" className="nx-side-row" onClick={onPalette}>
          <SearchIcon />
          {L.sidebar.find}
          <kbd>{keyHint("⌘K")}</kbd>
        </button>
      </nav>
      <ProjectSwitcher
        daemon={daemon}
        projects={projects}
        active={active}
        onSwitch={nav.switchProject}
        onToast={nav.toast}
        openSignal={openSwitcher}
      />
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
        threadView={view === "thread"}
        titleFor={titleFor}
        onOpen={(thread) => active && nav.openThread(active.slug, thread.id)}
        onRenameSession={onRenameSession}
        onToast={nav.toast}
      />
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
