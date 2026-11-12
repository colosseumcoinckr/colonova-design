import type { ThreadSummary } from "@colonova-design/protocol";
import { type CSSProperties, useCallback, useEffect, useId, useRef, useState } from "react";
import { ShortcutsSheet } from "../components/dialogs/ShortcutsSheet";
import { Palette } from "../components/shell/Palette";
import { Splitter } from "../components/shell/Splitter";
import { focusableElements } from "../hooks/focusable";
import { overlayOpen, useModalFocus } from "../hooks/use-modal-focus";
import { usePins } from "../hooks/usePins";
import { useSessions } from "../hooks/useSessions";
import { ChatColumn } from "./chat/ChatColumn";
import { FeedbackDialog } from "./feedback/FeedbackDialog";
import { L } from "./labels";
import { composing } from "./lib/ime";
import { deriveJourney } from "./lib/journey";
import { CHAT_MIN, PREVIEW_MIN } from "./lib/shell-metrics";
import { submitCopy } from "./lib/submit-copy";
import { nextTabIndex } from "./lib/tab-keys";
import { useNarrow, useShellNav } from "./lib/use-shell-nav";
import { useSidebarWidth } from "./lib/use-sidebar-width";
import { useToday } from "./lib/use-today";
import { daysSince } from "./lib/waiting";
import { commentCount, outsideChanges } from "./lib/work-ledger";
import type { NextShellProps } from "./NextShell";
import { draftsInProgress } from "./plans/drafts-in-progress";
import { openPlanTarget } from "./plans/open-plan";
import { PlansColumn } from "./plans/PlansColumn";
import { PlansHeader } from "./plans/PlansHeader";
import { PlansSidebar } from "./plans/PlansSidebar";
import { PlansContext, usePlansWorkspace } from "./plans/PlansWorkspace";
import { useDraftSummaries } from "./plans/use-draft-summaries";
import { PreviewColumn } from "./preview/PreviewColumn";
import { SettingsDialog } from "./settings/SettingsDialog";
import { Sidebar } from "./sidebar/Sidebar";
import type { SettingsPage, SlotProps } from "./slots";
import { ProblemLine } from "./status/ProblemLine";
import { StatusLine } from "./status/StatusLine";
import { useWorkLedger } from "./status/use-work-ledger";
import { Count } from "./ui/Count";
import { Toast } from "./ui/Toast";

/**
 * 오른쪽 칸(대화)의 폭(2026-10-31 화면 자리 개선안 S15) — 320~640px, 처음은 420.
 * 미리보기가 가운데서 가장 넓은 자리를 쓰고(`PREVIEW_MIN` 아래로 줄지 않게 위쪽 한도는
 * 창 폭에 따라 더 낮아진다), 고른 폭은 기억한다. 옛 대화 폭의 기억(`chatWidth`)은
 * 오른쪽 칸 폭으로 그대로 옮겨 읽는다(§7 위험 — 좌우가 바뀌어도 폭의 기억은 산다).
 */
const CHAT_MAX = 640;
const CHAT_DEFAULT = 420;
const CHAT_KEY = "colonova-design.chatWidth";
/** 좌우가 바뀐 첫 안내(§7 위험) — 한 번만 온다. */
const MOVED_KEY = "colonova-design.chatMoved";

/** 폭 프리셋(S11) — 기본 → 화면 넓게(칸 320) → 칸 넓게(640) → 기본 으로 돈다. */
const PANE_PRESETS = [CHAT_DEFAULT, CHAT_MIN, CHAT_MAX] as const;

function storedChatWidth(): number {
  try {
    const value = Number(localStorage.getItem(CHAT_KEY));
    return Number.isFinite(value) && value >= CHAT_MIN && value <= CHAT_MAX ? value : CHAT_DEFAULT;
  } catch {
    return CHAT_DEFAULT;
  }
}

/** 턴이 살아 있는 상태 — 진행 시계와 `만드는 중` 이 읽는다. */
const LIVE = new Set(["starting", "running", "waiting_permission", "waiting_question"]);

/**
 * 프로젝트가 하나 이상 있는 기계의 작업 틀(PLAN-UI U1) — Claude Desktop 의
 * 배치: 사이드바 · 상태 줄(대화와 미리보기 위에 걸친다) · 대화 · 미리보기.
 * 900px 아래(U16)에서는 사이드바가 `≡` 뒤의 서랍, 대화와 미리보기가 두 탭이다.
 *
 * 훅(`useSessions` · `usePins`)은 여기서 한 번만 불리고 칸들이 같은 결과를
 * 나눠 쓴다. 대화 · 미리보기 칸은 기획서 자리에서도 마운트된 채 숨는다 —
 * 미리보기의 게스트가 죽지 않게(PreviewColumn 의 계약).
 */
export function Workspace({
  daemon,
  settings,
  onChatChange,
  onLayoutChange,
  onSettingsChange,
  onRenameSession,
  discardableInvitePath = null,
}: NextShellProps & { discardableInvitePath?: string | null }) {
  const sessions = useSessions(daemon, {
    ready: daemon.repo?.phase === "ready",
    chat: settings.chat,
    onChatChange,
  });
  const pins = usePins(daemon.activeSlug, daemon.api);
  const narrow = useNarrow();
  const tabsId = useId();
  const drawerOpen = useRef(false);
  // 설정 대화상자(단계 6) — 사이드바 바퀴 · ⌘, · 팔레트가 같은 문으로 연다.
  const [settingsPage, setSettingsPage] = useState<SettingsPage | "default" | null>(null);
  // 설정도 기능 제안처럼 좁은 창의 서랍 위에 겹치지 않게 서랍을 먼저 닫는다(⌘, · 팔레트 · 바퀴 모두 —
  // 2026-10-06 겹판 조사: 서랍이 설정 뒤에 열려 있었다). `page` 가 오면 그 쪽이 먼저 선다(2026-11-12 —
  // 기획서 자리의 연결 단추는 `연결` 쪽으로).
  const openSettings = (page?: SettingsPage) => {
    if (narrow) setDrawer(false);
    setSettingsPage(page ?? "default");
  };
  // 기능 제안(PLAN-FEEDBACK) — 좁은 창의 서랍 위에 겹치지 않게 서랍을 먼저 닫는다.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const openFeedback = () => {
    if (narrow) setDrawer(false);
    setFeedbackOpen(true);
  };
  // 서랍 위에서 연 대화상자가 닫히면 좁은 창에서는 서랍이 이미 닫혀 있어(열 때 먼저 닫는다) 화면의
  // ≡ 단추로 초점을 되돌린다 — 대화상자의 초점 복구가 body 로 떨어지지 않게.
  const focusMenuButton = useCallback(() => {
    if (!narrow) return;
    requestAnimationFrame(() => {
      const menu = [...document.querySelectorAll<HTMLButtonElement>(".nx-main button")].find(
        (button) =>
          button.getAttribute("aria-label") === L.shell.menu &&
          button.getClientRects().length > 0 &&
          getComputedStyle(button).visibility !== "hidden" &&
          !button.closest("[inert]"),
      );
      menu?.focus();
    });
  }, [narrow]);
  const closeFeedback = useCallback(() => {
    setFeedbackOpen(false);
    focusMenuButton();
  }, [focusMenuButton]);
  const closeSettings = useCallback(() => {
    setSettingsPage(null);
    focusMenuButton();
  }, [focusMenuButton]);
  const { state, nav, toast, dismissToast, setCollapsed, setDrawer } = useShellNav({
    daemon,
    sessions,
    collapsed: settings.layout.sidebarCollapsed,
    discardableInvitePath,
    narrow,
    onLayoutChange,
    onOpenSettings: openSettings,
  });
  const project = daemon.projects.find((entry) => entry.slug === daemon.activeSlug) ?? null;
  const plansOn = state.pane === "plans";
  // 기획서 지면인가 — 화면 자리(대화 · 미리보기)가 아니라는 뜻이다. 연결 자리는 2026-10-30 걷었다.
  const paneOn = plansOn;
  // 자리마다 폭을 기억한다(2026-10-23 화면 전면 재설계 §3.2).
  const sidebarWidth = useSidebarWidth(
    paneOn ? (settings.layout.plansSidebarWidth ?? null) : settings.layout.sidebarWidth,
    (width) => onLayoutChange(paneOn ? { plansSidebarWidth: width } : { sidebarWidth: width }),
    paneOn,
  );

  const titleForThread = useCallback(
    (thread: ThreadSummary) => settings.sessionTitles[thread.id] ?? thread.title,
    [settings.sessionTitles],
  );
  const activeId = sessions.activeId;
  const title = (() => {
    if (!activeId) return L.sidebar.newConv;
    const renamed = settings.sessionTitles[activeId];
    if (renamed) return renamed;
    return (
      project?.threads?.find((thread) => thread.id === activeId)?.title ??
      sessions.list.find((session) => session.sessionId === activeId)?.title ??
      L.sidebar.newConv
    );
  })();

  // 이 프로젝트에서 AI 가 도는가 — 열린 대화의 상태가 먼저, 다른 대화는 등록부가 안다.
  const activeLive = LIVE.has(sessions.active?.state ?? "idle");
  const awaiting = sessions.awaitingTurn?.sessionId === activeId ? sessions.awaitingTurn : null;
  const running = activeLive || awaiting !== null || project?.working === true;
  const attention = daemon.repo?.attention ?? daemon.status?.attention ?? null;
  // 단계 4 — 제출 상태의 문장과 이번 작업의 장부(코멘트 수가 여정의 둘째 점에 붙는다).
  const ledger = useWorkLedger(daemon);
  const copy = submitCopy(daemon.repo?.submit, L);
  // 오늘의 자정 — 자정이 지나면 갈아 끼워 `N일째` 가 저절로 는다(2026-10-07 UX 점검 3단계).
  const today = useToday();
  const journey = deriveJourney(
    {
      repo: daemon.repo,
      diffStatus: daemon.diffStatus,
      running,
      reconnect: attention?.kind === "reconnect",
      comments: commentCount(ledger.reviews),
      outsideChanges: outsideChanges(ledger.history, daemon.repo?.cycleScreens, copy.lastAt),
      waitingDays: daysSince(daemon.repo?.handoff?.since, today),
      approved: daemon.repo?.handoff?.approved === true,
      submitCopy: copy,
    },
    L,
  );

  // 팔레트와 단축키(⌘K · ⌘T · ⌘,) — 조합키가 붙어 입력창의 타이핑과 만나지 않는다.
  const [palette, setPalette] = useState(false);
  const plans = usePlansWorkspace({ daemon, project, active: plansOn, paletteOpen: palette });
  // 기획서 칸 — 처음 열 때 마운트하고 그 뒤로는 마운트된 채 숨는다(열린 문서 · 찾는 말이 미리보기로 갔다 와도 그대로).
  // 열기 전에는 짓지 않는다: 지으면 기획서를 쓰지 않는 프로젝트도 앱을 켤 때마다 목록을 읽는다.
  const [plansMounted, setPlansMounted] = useState(false);
  if (state.pane === "plans" && !plansMounted) setPlansMounted(true);
  // 기획서 칸이 초안 편집기를 열고 닫을 때 알리는 손 — 이동 상태(`planDraft`)에 남긴다. 칸에 건네는 손은 렌더마다 같은
  // 것이어야 칸의 알림 효과가 매번 다시 돌지 않는다.
  const navRef = useRef(nav);
  navRef.current = nav;
  const setPlanDraft = useCallback((open: boolean) => navRef.current.setPlanDraft(open), []);
  // 지금 프로젝트의 초안 요약 — 사이드바의 `기획서` 줄과 상태 줄이 함께 읽는다(2026-10-23 기획자 화면 손질 D4 · D5).
  // 기획서를 연결하지 않은 프로젝트는 읽지 않는다(null).
  const draftSummaries = useDraftSummaries(daemon);
  const draftsInWork = draftSummaries === null ? 0 : draftsInProgress(draftSummaries).length;
  // ⌘/ 단축키 시트(2026-10-04 ux-plan PR 2) — 팔레트 · 설정과 같은 창 문이다.
  const [sheetOpen, setSheetOpen] = useState(false);
  const keys = useRef({
    palette: () => {},
    fresh: () => {},
    settings: () => {},
    sidebar: () => {},
    sheet: () => {},
    width: () => {},
  });
  keys.current = {
    palette: () => setPalette((open) => !open),
    fresh: () => nav.newThread(),
    settings: openSettings,
    // ⌘B — 사이드바를 접고 편다(좁은 창에서는 서랍을 여닫는다).
    sidebar: () => (narrow ? setDrawer(!state.drawer) : setCollapsed(!state.collapsed)),
    sheet: () => setSheetOpen(true),
    // ⌘\ — 폭 프리셋(S11). 밑의 cyclePaneWidth 와 같은 길이다.
    width: () => cyclePaneWidth(),
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      // 대화상자가 떠 있으면 물러선다 — 팔레트 자기 토글(⌘K)만 예외.
      // 찾기는 물러나는 동안(`nx-pal--out`)에는 막지 않는다 — 곧 사라질 판이 단축키를 삼키지 않게.
      const modal = overlayOpen();
      const key = event.key.toLowerCase();
      if (modal && key !== "k") return;
      if (key === "k") {
        event.preventDefault();
        keys.current.palette();
      } else if (key === "t") {
        event.preventDefault();
        keys.current.fresh();
      } else if (key === ",") {
        event.preventDefault();
        keys.current.settings();
      } else if (key === "b") {
        event.preventDefault();
        keys.current.sidebar();
      } else if (key === "\\") {
        // ⌘\ — 오른쪽 칸의 폭 프리셋(S11). 경계를 두 번 누르는 것과 같다.
        event.preventDefault();
        keys.current.width();
      } else if (key === "/") {
        // 입력창 안의 / 는 글자다 — 포커스가 입력칸에 있으면 물러선다(미리보기
        // Esc 의 판정과 같은 목록). PreviewFrame 이 문서를 대상으로 다시 쏜
        // ⌘/ 는 target 이 문서라 이 판정을 통과한다(2026-10-04 ux-plan PR 2).
        const target = event.target;
        if (target instanceof Element && target.closest("input, textarea, [contenteditable]")) {
          return;
        }
        event.preventDefault();
        keys.current.sheet();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 오른쪽 칸(대화)의 폭 — 넓은 창의 한 경계(S15). 끌어 바꾸면 기억하고, 창이 좁아져
  // 못 맞으면 조여서 그린다. 경계를 두 번 누르면(⌘\ 도 같다) 폭 프리셋으로 돈다(S11).
  const [chatWidth, setChatWidth] = useState(storedChatWidth);
  const [drag, setDrag] = useState<{ startX: number; startWidth: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyWidth, setBodyWidth] = useState(0);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setBodyWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const chatBounds = {
    min: CHAT_MIN,
    max: bodyWidth > 0 ? Math.max(CHAT_MIN, Math.min(CHAT_MAX, bodyWidth - PREVIEW_MIN)) : CHAT_MAX,
  };
  const clamp = (value: number) =>
    Math.round(Math.min(chatBounds.max, Math.max(chatBounds.min, value)));
  const shownChatWidth = clamp(chatWidth);
  useEffect(() => {
    if (drag !== null) return;
    try {
      localStorage.setItem(CHAT_KEY, String(chatWidth));
    } catch {
      /* 비공개 모드 — 이번 실행에서만 산다 */
    }
  }, [chatWidth, drag]);
  // 폭 프리셋(S11) — 지금 폭이 어느 단계와 가까운지 찾아 다음 단계로 돌린다. 어느 쪽도
  // 아니면(끌어 온 폭) 기본부터 시작한다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: clamp 은 지금 한도를 매번 다시 잰다 — 의존하지 않는다.
  const cyclePaneWidth = useCallback(() => {
    setChatWidth((before) => {
      const now = clamp(before);
      const at = PANE_PRESETS.findIndex((preset) => Math.abs(preset - now) < 8);
      const next = PANE_PRESETS[(at + 1) % PANE_PRESETS.length] ?? CHAT_DEFAULT;
      return next;
    });
  }, []);
  // F6(⇧F6 거꾸로) — 상태 줄 → 미리보기 막대 → 무대 → 오른쪽 칸 탭 → 칸의 몸 → 입력창을
  // 돈다(S13). 보이지 않는 걸음(기획서 자리의 미리보기 막대 · 접힌 칸)은 건너뛴다.
  useEffect(() => {
    const stops = [
      ".nx-statusbar",
      ".nx-pvbar",
      "[data-f6='stage']",
      "[data-f6='rtabs']",
      "[data-f6='body']",
      ".nx-cmp-wrap",
    ];
    const visible = (el: Element) => el.getClientRects().length > 0;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "F6" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (overlayOpen() || drawerOpen.current) {
        event.preventDefault();
        return;
      }
      const found = stops
        .map((selector) => document.querySelector<HTMLElement>(selector))
        .filter((el): el is HTMLElement => el !== null && visible(el));
      if (found.length === 0) return;
      const active = document.activeElement;
      const at = found.findIndex((el) => el === active || el.contains(active));
      const next = event.shiftKey ? (at <= 0 ? found.length : at) - 1 : (at + 1) % found.length;
      const region = found[next];
      const target = region ? focusableElements(region)[0] : undefined;
      target?.focus();
      if (target && document.activeElement === target) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // 좌우가 바뀐 첫 안내(§7 위험) — 기억한 폭은 그대로 읽히니 말 한 번만 한다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 켤 때 한 번만 말한다.
  useEffect(() => {
    try {
      if (localStorage.getItem(MOVED_KEY) === "1") return;
      localStorage.setItem(MOVED_KEY, "1");
    } catch {
      return;
    }
    nav.toast(L.toast.chatMoved);
  }, []);
  // 찍기를 켰을 때 칸이 가장 넓으면(S11) 화면을 내어 주자 한 번 제안한다 — 고른 폭은
  // 기억되니 눌렀을 때만 좁혀진다.
  const widenAsked = useRef(false);
  useEffect(() => {
    const onPinsOn = () => {
      if (widenAsked.current || shownChatWidth < CHAT_MAX) return;
      widenAsked.current = true;
      nav.toast(L.toast.widenAsk, { label: L.toast.widenDo, run: () => setChatWidth(CHAT_MIN) });
    };
    window.addEventListener("nx:pins:on", onPinsOn);
    return () => window.removeEventListener("nx:pins:on", onPinsOn);
  }, [shownChatWidth, nav]);

  /** 지금 화면의 제목 — 미리보기 칸이 알린다(단계 3). 좁은 창의 탭이 읽는다. */
  const [screenName, setScreenName] = useState<string | null>(null);
  const [chatScreen, setChatScreen] = useState<{ slug: string | null; name: string | null }>({
    slug: null,
    name: null,
  });
  const reportScreenName = useCallback(
    (name: string | null) => {
      setScreenName(name);
      setChatScreen({ slug: project?.slug ?? null, name });
    },
    [project?.slug],
  );
  /** 지금 화면의 주소 — 오른쪽 칸의 기획서 탭이 이 화면에 이어진 문서를 가른다(S10). */
  const [screenRoute, setScreenRoute] = useState<string | null>(null);

  const slot: SlotProps = {
    daemon,
    settings,
    sessions,
    pins,
    project,
    activeSessionId: activeId,
    nav,
    narrow,
    onChatChange,
    onRenameSession,
  };

  const sidebarHidden = narrow ? !state.drawer : state.collapsed;
  const openSidebar = () => (narrow ? setDrawer(true) : setCollapsed(false));
  const classes = [
    "nx",
    state.collapsed && !narrow ? "nx--collapsed" : "",
    narrow ? "nx--narrow" : "",
    narrow && state.drawer ? "nx--drawer" : "",
    drag || sidebarWidth.dragging ? "nx--resizing" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const pinCount = pins.list.length;
  const chatHidden = paneOn || (narrow && state.tab === "preview");
  // 넓은 창으로 다녀오면 서랍은 닫는다 — 열어 둔 채 넓혔다 다시 좁히면 서랍이 저절로 열려 있던 것을
  // 막는다(2026-10-06 겹판 조사).
  useEffect(() => {
    if (!narrow) setDrawer(false);
  }, [narrow, setDrawer]);

  // 좁은 창 서랍 — Esc 로 닫히고, 열리면 첫 줄로 초점이 간다. 위에 대화상자가
  // 떠 있으면 물러난다(위의 조합키와 같은 규칙).
  const sidebarRef = useRef<HTMLElement>(null);
  drawerOpen.current = narrow && state.drawer;
  useModalFocus(sidebarRef, narrow && state.drawer);
  useEffect(() => {
    if (!(narrow && state.drawer)) return;
    if (!sidebarRef.current?.contains(document.activeElement)) {
      sidebarRef.current?.querySelector<HTMLElement>(".nx-side-nav .nx-side-row")?.focus();
    }
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229
      )
        return;
      if (overlayOpen()) return;
      setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [narrow, state.drawer, setDrawer]);

  // 사이드바가 접히거나 닫힐 때 — 초점이 그 안에 있었다면 펼치기 · ≡ 단추로
  // 되돌린다. 기획서 자리는 기획서 막대의 단추, 화면 자리는 상태 줄의 단추가 그 자리다.
  const sidebarWasHidden = useRef(sidebarHidden);
  useEffect(() => {
    if (sidebarHidden === sidebarWasHidden.current) return;
    sidebarWasHidden.current = sidebarHidden;
    if (!sidebarHidden) {
      // 펴면 손이 있던 펴기 단추가 사라지며 초점이 body 로 떨어진다 — 사이드바 첫 줄로 옮긴다.
      if (document.activeElement === document.body) {
        sidebarRef.current?.querySelector<HTMLElement>(".nx-side-nav .nx-side-row")?.focus();
      }
      return;
    }
    const focused = document.activeElement;
    if (!sidebarRef.current?.contains(focused) && !focused?.matches(".nx-scrim")) return;
    const bar = paneOn ? ".nx-pl-bar" : ".nx-statusbar";
    document.querySelector<HTMLElement>(`${bar} .nx-ibtn`)?.focus();
  }, [sidebarHidden, paneOn]);

  // 화면 자리가 좁은 창의 뒤에서 나올 때 — 칸들은 자리가 바뀌어도 마운트된 채라(미리보기가 살아 있게)
  // 입력창의 열쇠가 안 바뀐다. 입력창이 초점을 받도록 알린다.
  useEffect(() => {
    if (!paneOn) window.dispatchEvent(new Event("nx:composer:focus"));
  }, [paneOn]);

  return (
    <PlansContext.Provider value={plans}>
      <div
        className={classes}
        data-testid="next-shell"
        style={{ "--nx-side-w": `${sidebarWidth.width}px` } as CSSProperties}
      >
        <Sidebar
          daemon={daemon}
          sessions={sessions}
          activeSessionId={activeId}
          plansOn={plansOn}
          chatShown={!chatHidden}
          running={running}
          plansContent={
            plansMounted ? (
              <PlansSidebar
                nav={nav}
                daemon={daemon}
                hidden={!plansOn}
                sidebarHidden={sidebarHidden}
                onMenuHidden={() => {
                  if (sidebarHidden) {
                    const bar = plansOn ? ".nx-pl-bar" : ".nx-statusbar";
                    document.querySelector<HTMLElement>(`${bar} .nx-ibtn`)?.focus();
                  } else if (!plansOn) {
                    sidebarRef.current
                      ?.querySelector<HTMLElement>('.nx-side-nav [aria-current="page"]')
                      ?.focus();
                  }
                }}
                onOpen={() => {
                  if (narrow) setDrawer(false);
                }}
              />
            ) : undefined
          }
          planDrafts={draftsInWork}
          titleFor={titleForThread}
          nav={nav}
          onPalette={() => setPalette(true)}
          onFeedback={openFeedback}
          onCollapse={() => (narrow ? setDrawer(false) : setCollapsed(true))}
          drawer={narrow}
          onRenameSession={onRenameSession}
          hidden={sidebarHidden}
          containerRef={sidebarRef}
        />
        {/* 사이드바와 본문 사이의 경계 — 접히거나 서랍이 된 동안은 끌 것이 없다. */}
        {!narrow && !state.collapsed && (
          <Splitter
            side="left"
            width={sidebarWidth.width}
            bounds={sidebarWidth.bounds}
            label={L.shell.sidebarWidth}
            active={sidebarWidth.dragging}
            {...sidebarWidth.split}
          />
        )}
        {/* 스크림은 좁은 창에서 늘 서 있고 서랍이 열릴 때만 보인다 — 닫힐 때 서랍이 미끄러지는 동안 불투명도로
            걷힌다(`shell.css`). 닫힌 동안은 `visibility: hidden` 이라 눌리지도 초점을 받지도 않는다. */}
        {narrow && (
          <button
            type="button"
            className="nx-scrim"
            aria-label={L.shell.closeMenu}
            onClick={() => setDrawer(false)}
          />
        )}

        {/* 좁은 창의 서랍이 열려 있는 동안 뒷화면은 눌리지도 초점을 받지도 않는다(서랍은 모달처럼 보인다). */}
        <main className="nx-main" inert={narrow && state.drawer}>
          <div className="nx-view nx-work">
            {plansOn ? (
              <PlansHeader
                daemon={daemon}
                nav={nav}
                sidebarHidden={sidebarHidden}
                narrow={narrow}
                onOpenSidebar={openSidebar}
              />
            ) : (
              <StatusLine
                daemon={daemon}
                sessions={sessions}
                project={project}
                title={title}
                onRename={activeId ? (name) => onRenameSession(activeId, name) : undefined}
                journey={journey}
                narrow={narrow}
                nav={nav}
                onSubmit={() => undefined}
                ledger={ledger}
                submitCopy={copy}
                sidebarHidden={sidebarHidden}
                onOpenSidebar={openSidebar}
                drafts={draftSummaries}
              />
            )}
            <ProblemLine
              daemon={daemon}
              invitePath={state.discardableInvitePath}
              onClearInvite={() => nav.setDiscardableInvitePath(null)}
              onToast={nav.toast}
            />
            {narrow && (
              // 좁은 창의 탭(S12) — 화면이 첫 탭이다(S15 와 같은 뜻). 기획서는 세 번째
              // 탭으로, 누르면 기획서 자리가 앞에 선다(기획서 자리의 머리에서 돌아온다).
              <div
                className="nx-tabs"
                role="tablist"
                data-f6="rtabs"
                onKeyDown={(event) => {
                  if (composing(event) || event.altKey || event.ctrlKey || event.metaKey) return;
                  const buttons = [
                    ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
                  ];
                  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
                  if (at < 0) return;
                  const next = nextTabIndex(event.key, buttons.length, at);
                  if (next === null) return;
                  event.preventDefault();
                  buttons[next]?.click();
                  buttons[next]?.focus();
                }}
              >
                <button
                  type="button"
                  role="tab"
                  id={`${tabsId}-preview-tab`}
                  aria-controls={`${tabsId}-preview-panel`}
                  tabIndex={!paneOn && state.tab === "preview" ? 0 : -1}
                  aria-selected={!paneOn && state.tab === "preview"}
                  className={!paneOn && state.tab === "preview" ? "nx-tab--on" : ""}
                  onClick={() => nav.showScreen()}
                >
                  {/* 2026-10-04 ux-review(2차): 긴 화면 이름은 말줄임으로 — 익명 플렉스
                      항목은 CSS 만 줄일 수 없어 이름만 감싼다. */}
                  <span className="nx-tab-label">
                    {L.narrow.screenTab(screenName ?? project?.name ?? "")}
                  </span>
                  {pinCount > 0 && <Count n={pinCount} />}
                </button>
                <button
                  type="button"
                  role="tab"
                  id={`${tabsId}-chat-tab`}
                  aria-controls={`${tabsId}-chat-panel`}
                  tabIndex={!paneOn && state.tab === "chat" ? 0 : -1}
                  aria-selected={!paneOn && state.tab === "chat"}
                  className={!paneOn && state.tab === "chat" ? "nx-tab--on" : ""}
                  onClick={() => {
                    nav.showScreen();
                    nav.showTab("chat");
                  }}
                >
                  {L.narrow.chatTab}
                </button>
                <button
                  type="button"
                  role="tab"
                  id={`${tabsId}-plans-tab`}
                  aria-controls={`${tabsId}-plans-panel`}
                  tabIndex={paneOn ? 0 : -1}
                  className={paneOn ? "nx-tab--on" : ""}
                  aria-selected={paneOn}
                  onClick={() => nav.openPlans()}
                >
                  {L.narrow.plansTab}
                </button>
              </div>
            )}
            <div
              ref={bodyRef}
              className={`nx-body${drag ? " planner__body--resizing" : ""}`}
              data-tab={narrow && !paneOn ? state.tab : undefined}
              style={
                narrow && !paneOn
                  ? undefined
                  : {
                      // 화면이 가운데(S15) — 미리보기가 남은 폭을 다 쓰고 오른쪽 칸이 제 폭을 갖는다.
                      gridTemplateColumns: paneOn
                        ? "minmax(0, 1fr)"
                        : `minmax(0, 1fr) ${shownChatWidth}px`,
                    }
              }
            >
              <div
                className="nx-panel-slot"
                id={`${tabsId}-preview-panel`}
                {...(narrow
                  ? { role: "tabpanel" as const, "aria-labelledby": `${tabsId}-preview-tab` }
                  : {})}
                aria-hidden={paneOn || (narrow && state.tab !== "preview")}
                inert={paneOn || (narrow && state.tab !== "preview")}
              >
                <PreviewColumn
                  {...slot}
                  onScreenName={reportScreenName}
                  onScreenRoute={setScreenRoute}
                  offstage={(narrow && state.tab === "chat") || state.pane !== "preview"}
                />
              </div>
              {!narrow && !paneOn && (
                <Splitter
                  // 오른쪽 칸의 폭을 잰다(S15) — 경계는 칸의 왼쪽 가장자리에 매달리고,
                  // 왼쪽으로 끌면(칸이 넓어지는 방향) 폭이 는다.
                  side="right"
                  width={shownChatWidth}
                  bounds={chatBounds}
                  label={L.shell.paneWidth}
                  resetHint={L.shell.paneWidthCycle}
                  active={drag !== null}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    try {
                      event.currentTarget.setPointerCapture(event.pointerId);
                    } catch {
                      /* 이미 떠난 포인터 — 창 안의 끌기는 그대로 된다 */
                    }
                    setDrag({ startX: event.clientX, startWidth: shownChatWidth });
                  }}
                  onPointerMove={(event) => {
                    if (!drag) return;
                    if (event.buttons === 0) {
                      setDrag(null);
                      return;
                    }
                    // 왼쪽으로 끌면 칸이 넓어진다 — 오른쪽 칸 기준이라 부호가 거꾸로다.
                    setChatWidth(clamp(drag.startWidth - (event.clientX - drag.startX)));
                  }}
                  onPointerUp={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      event.currentTarget.releasePointerCapture(event.pointerId);
                    }
                    setDrag(null);
                  }}
                  onNudge={(delta) => setChatWidth(clamp(shownChatWidth + delta))}
                  onReset={cyclePaneWidth}
                />
              )}
              <div
                id={`${tabsId}-chat-panel`}
                {...(narrow
                  ? { role: "tabpanel" as const, "aria-labelledby": `${tabsId}-chat-tab` }
                  : {})}
                className={`nx-chat-slot${chatHidden ? " nx-offstage" : ""}`}
                aria-hidden={chatHidden}
                inert={chatHidden}
              >
                <ChatColumn
                  {...slot}
                  offstage={paneOn}
                  pane="preview"
                  rightTab={narrow ? "chat" : state.rightTab}
                  screenRoute={screenRoute}
                  screenName={
                    project !== null && chatScreen.slug === project.slug ? chatScreen.name : null
                  }
                  sheetOn={narrow && !paneOn && state.tab === "preview"}
                />
              </div>
              <div
                className="nx-panel-slot"
                id={`${tabsId}-plans-panel`}
                {...(narrow
                  ? { role: "tabpanel" as const, "aria-labelledby": `${tabsId}-plans-tab` }
                  : {})}
                aria-hidden={!plansOn}
                inert={!plansOn}
              >
                {plansMounted && (
                  <PlansColumn
                    daemon={daemon}
                    project={project}
                    nav={nav}
                    offstage={!plansOn}
                    header={false}
                    onFocusTree={openSidebar}
                    onDraftOpen={setPlanDraft}
                  />
                )}
              </div>
            </div>
          </div>
        </main>
        <Toast toast={toast} onDone={dismissToast} />
        {settingsPage !== null && (
          <SettingsDialog
            daemon={daemon}
            settings={settings}
            onChatChange={onChatChange}
            onSettingsChange={onSettingsChange}
            initialPage={settingsPage === "default" ? undefined : settingsPage}
            onClose={closeSettings}
          />
        )}
        {/* 기능 제안은 늘 마운트된 채 `open` 만 그린다 — 전송이 도는 동안 닫았다
            다시 열어도 약속이 죽지 않고 늦은 접수 확인이 초안을 지울 수 있다. */}
        <FeedbackDialog
          daemon={daemon}
          open={feedbackOpen}
          onClose={closeFeedback}
          onToast={nav.toast}
        />
        {/* ⌘/ — 설정 창과 같은 자리에 서는 단축키 시트다. */}
        {sheetOpen && <ShortcutsSheet open onClose={() => setSheetOpen(false)} />}
      </div>

      {/* 팔레트는 스스로 `.nx` 뿌리다(`palette.css`) — 앱 뿌리의 격자 · 100vh · 잘림에
          갇히지 않게 그 옆에 그린다. */}
      {palette && (
        <Palette
          titleForThread={titleForThread}
          documents={plans.connected ? plans.rows.filter((row) => row.kind === "doc") : []}
          documentsLoading={
            plans.connected &&
            (plans.state.listPhase === "idle" || plans.state.listPhase === "loading")
          }
          documentsFailed={plans.connected && plans.state.listPhase === "failed"}
          onRetryDocuments={plans.refreshList}
          onOpenDocument={(pageId) => openPlanTarget({ pageId }, nav)}
          onOpenPlans={nav.openPlans}
          activeSessionId={activeId}
          projects={daemon.projects}
          hiddenThreads={daemon.hiddenThreads}
          transcripts={daemon.sessions}
          activeSlug={daemon.activeSlug}
          onOpenThread={(slug, thread) => nav.openThread(slug, thread.id)}
          onCreateSession={() => nav.newThread()}
          // 사이드바와 같은 한 길 — 옮기면 알림도 같이 뜬다. 실패는 열린 판 안에서 말한다(`quiet`).
          onActivateProject={(slug) => nav.switchProject(slug, { quiet: true })}
          onOpenSettings={openSettings}
          onClose={() => setPalette(false)}
        />
      )}
    </PlansContext.Provider>
  );
}
