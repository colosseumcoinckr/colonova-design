import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Sessions } from "../../hooks/useSessions";
import type { Daemon } from "../../lib/daemon-client";
import type { LayoutSettings } from "../../lib/settings";
import { L } from "../labels";
import type { ShellNav } from "../slots";
import { initialNav, type NavState, navReducer, type ToastAction } from "./nav";
import { isPreparing } from "./project-note";
import { nextReady, type SeenView, sameList, stepFirstPrep } from "./ready-watch";

/** 좁은 창의 문턱(U16) — 목업의 `@container win (max-width:900px)`. */
const NARROW_QUERY = "(max-width: 900px)";

/** 토스트가 머무는 시간 — 토스트의 줄어드는 막대가 같은 값으로 닳는다. */
export const TOAST_MS = 2600;
/** 단추가 달린 토스트는 읽고 누를 시간이 더 필요하다(2026-10-07 베타 준비 분석 · 첫 5분). */
export const TOAST_ACTION_MS = 8000;

/** 지금 떠 있는 토스트 — `seq` 가 달라지면 같은 문장도 새 알림이다. `action` 이 있으면 단추가 달리고 더 오래 머문다. */
export interface ToastNote {
  text: string;
  seq: number;
  action?: ToastAction;
}

/** 창이 900px 아래인가 — 목업은 창 폭의 컨테이너 질의, 앱은 창 자체다. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(NARROW_QUERY).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(NARROW_QUERY);
    if (!media) return;
    const onChange = () => setNarrow(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

/**
 * 셸의 이동 — 상태(`nav.ts` 의 줄임 함수)와 칸들에 건넬 손(`ShellNav`).
 * 활성 프로젝트가 바뀌면 홈부터, 다른 프로젝트의 대화를 여는 클릭은 전환을 먼저 하고 등록부가 옮겨 앉으면 그
 * 대화를 연다(jump), 대화를 여는 길은 목록 → 살아 있는 세션 → 되살리기 순.
 */
export function useShellNav({
  daemon,
  sessions,
  collapsed,
  discardableInvitePath = null,
  narrow = false,
  onLayoutChange,
  onOpenSettings,
}: {
  daemon: Daemon;
  sessions: Sessions;
  /** 설정에 남은 사이드바 접힘 — 처음 값의 씨앗. */
  collapsed: boolean;
  /** 가져온 초대 파일의 위치(U11) — 셸 위쪽(NextShell)이 정하고 대화 칸이 읽는다. */
  discardableInvitePath?: string | null;
  /** 좁은 창인가 — 서비스가 떴다는 소식은 화면 탭이 앞에 있어야 `보고 있는 것` 이다(`ready-watch.ts`). */
  narrow?: boolean;
  onLayoutChange: (patch: Partial<LayoutSettings>) => void;
  onOpenSettings: () => void;
}): {
  state: NavState;
  nav: ShellNav;
  /** 첫 준비가 끝났는데 아직 그 화면을 보지 않은 프로젝트 — 홈의 `서비스가 떴어요` 줄이 읽는다. */
  ready: string[];
  toast: ToastNote | null;
  /** 토스트를 곧바로 내린다 — 머무는 시간은 `Toast` 가 재고, 끝나거나 `×` 를 누르면 부른다. */
  dismissToast: () => void;
  setCollapsed: (v: boolean) => void;
  setDrawer: (v: boolean) => void;
} {
  const [state, dispatch] = useReducer(
    navReducer,
    { collapsed, path: discardableInvitePath },
    ({ collapsed: seedCollapsed, path }) => initialNav(seedCollapsed, path),
  );
  // 셸 위쪽(NextShell)이 정한 초대 파일 위치 — 첫 실행의 가져오기가 끝나면
  // Workspace 가 막 등장하기 때문에 씨앗만으로는 부족하다(이후의 다시 받기).
  useEffect(() => {
    dispatch({ type: "invite-path", path: discardableInvitePath });
  }, [discardableInvitePath]);

  // 같은 문장이 연속돼도 두 번째가 묻히지 않게 — 상태는 문장과 차례를 함께 쥐어
  // 타이머가 다시 돌게 한다(2026-10-04 ux-review).
  // 머무는 시간은 `Toast` 가 잰다(손이 얹히면 멈춰야 해서) — 여기는 지금 알림과 차례만 쥔다.
  const [toast, setToast] = useState<ToastNote | null>(null);
  const seqRef = useRef(0);
  const showToast = useCallback((text: string, action?: ToastAction) => {
    seqRef.current += 1;
    setToast({ text, seq: seqRef.current, ...(action ? { action } : {}) });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  // 이 두 효과의 순서가 뜻이다: 프로젝트가 바뀌면 먼저 홈으로 돌리고, 같은
  // 커밋에서 뒤따르는 점프가 대화를 열면 그 "thread" 가 이긴다.
  const seenSlug = useRef(daemon.activeSlug);
  useEffect(() => {
    if (seenSlug.current === daemon.activeSlug) return;
    seenSlug.current = daemon.activeSlug;
    dispatch({ type: "project-changed" });
  }, [daemon.activeSlug]);

  const jump = useRef<{
    slug: string;
    threadId?: string;
    fresh?: boolean;
    screen?: boolean;
  } | null>(null);

  /**
   * 이 프로젝트의 대화를 id 로 연다 — 목록이 빠른 길, 목록이 아직 모르는 살아
   * 있는 대화는 그 상태로, 그 밖은 저장된 대화를 되살린다(`session.create { resume }`).
   */
  const openHere = async (threadId: string) => {
    dispatch({ type: "thread" });
    const listed = sessions.list.find((session) => session.sessionId === threadId);
    if (listed) {
      await sessions.open(listed);
      return;
    }
    const view = daemon.sessions[threadId];
    if (view?.live) {
      const known = daemon.projects
        .flatMap((project) => project.threads ?? [])
        .find((thread) => thread.id === threadId);
      await sessions.open({
        sessionId: threadId,
        title: known?.title ?? threadId,
        lastModified: known ? Date.parse(known.updatedAt) : 0,
        live: true,
        state: view.state,
        turnStartedAt: view.turnStartedAt,
      });
      return;
    }
    await sessions.resume(threadId);
  };

  const freshHere = () => {
    dispatch({ type: "thread" });
    sessions.fresh();
  };

  const openRef = useRef({ openHere, freshHere });
  openRef.current = { openHere, freshHere };
  useEffect(() => {
    const pending = jump.current;
    if (!pending) return;
    jump.current = null;
    // 등록부가 다른 슬러그에 정착했다 — 낡은 점프는 거둔다.
    if (daemon.activeSlug !== pending.slug) return;
    if (pending.threadId) void openRef.current.openHere(pending.threadId);
    else if (pending.fresh) openRef.current.freshHere();
    else if (pending.screen) dispatch({ type: "screen" });
  }, [daemon.activeSlug]);

  const toastSwitched = (slug: string) => {
    const project = daemon.projects.find((entry) => entry.slug === slug);
    if (!project) return;
    showToast(
      isPreparing(project) || project.phase === "missing"
        ? L.toast.switchedPreparing(project.name)
        : L.toast.switched(project.name),
    );
  };

  /**
   * 프로젝트를 옮긴다 — 옮겼는지(true) 못 옮겼는지(false)를 돌려준다. 못 옮기면 한 문장으로 알린다
   * (사이드바 · 찾기 · 홈이 한 길을 쓴다 — 이전에는 실패가 아무 말 없이 지나갔다, 2026-10-06 겹판 조사).
   * `quiet` 는 실패를 부르는 쪽이 제 자리에서 말할 때(찾기 창이 열린 채 남는다).
   */
  const activate = (
    slug: string,
    then?: { threadId?: string; fresh?: boolean; screen?: boolean },
    options?: { quiet?: boolean },
  ): Promise<boolean> => {
    // 기다리던 점프가 있어도 갈아끼운다 — 새 클릭이 사용자의 최신 뜻이다.
    jump.current = then ? { slug, ...then } : null;
    return daemon.api.projectActivate(slug).then(
      () => {
        // 서비스 화면으로 가는 길은 도착한 화면이 말한다 — `옮겼어요` 가 한 번 더 뜨지 않게.
        if (!then?.screen) toastSwitched(slug);
        return true;
      },
      () => {
        jump.current = null;
        if (!options?.quiet) showToast(L.toast.switchFailed);
        return false;
      },
    );
  };

  // 첫 준비가 끝났는데 아직 그 화면을 보지 않은 프로젝트(2026-10-07 베타 준비 분석 · 첫 5분) — 홈의 `서비스가 떴어요`
  // 줄이 서 있는 동안이다. 그 프로젝트의 작업 화면을 보면(또는 줄을 닫으면) 거둔다.
  const [ready, setReady] = useState<string[]>([]);
  const dropReady = (slug: string) => setReady((list) => list.filter((entry) => entry !== slug));

  const nav: ShellNav = {
    openThread: (slug, threadId) => {
      if (slug === daemon.activeSlug) void openHere(threadId);
      else void activate(slug, { threadId });
    },
    newThread: (slug) => {
      if (!slug || slug === daemon.activeSlug) freshHere();
      else void activate(slug, { fresh: true });
    },
    goHome: () => dispatch({ type: "home" }),
    showThread: () => dispatch({ type: "thread" }),
    showScreen: () => dispatch({ type: "screen" }),
    openProjectScreen: (slug) => {
      dropReady(slug);
      if (slug === daemon.activeSlug) dispatch({ type: "screen" });
      else void activate(slug, { screen: true });
    },
    dismissReady: dropReady,
    switchProject: (slug, options) => {
      dispatch({ type: "drawer", open: false });
      return slug === daemon.activeSlug
        ? Promise.resolve(true)
        : activate(slug, undefined, options);
    },
    showTab: (tab) => dispatch({ type: "tab", tab }),
    openSettings: () => onOpenSettings(),
    toast: showToast,
    setDiscardableInvitePath: (path) => dispatch({ type: "invite-path", path }),
  };

  // OS 알림을 누르면 데스크톱이 세션 id 를 건넨다 — 주인 프로젝트를 먼저 찾고
  // (다른 프로젝트에서 되살리면 그곳에 갈래가 생긴다) 같은 길로 연다.
  // 구독은 한 번 — 손(nav)과 연결(daemon)은 ref 가 늘 새것으로 쥔다.
  const latest = useRef({ nav, daemon });
  latest.current = { nav, daemon };
  const readyRef = useRef(ready);
  readyRef.current = ready;
  useEffect(() => {
    const bridge = window.colonovaDesignDesktop;
    if (!bridge?.onOpenSession) return;
    return bridge.onOpenSession((sessionId) => {
      const { daemon: now } = latest.current;
      void now.api
        .locateSession(sessionId)
        .then((located) =>
          latest.current.nav.openThread(located.slug ?? now.activeSlug ?? "", sessionId),
        )
        .catch(() => undefined);
    });
  }, []);

  // 개발자 쪽 사건 알림(넘김 · 준비 끝 · 제출 막힘)을 누르면 데스크톱이 프로젝트 slug 를 건넨다 —
  // 그 프로젝트의 홈으로 간다(소식은 홈의 받은 편지함에 선다). 다른 프로젝트면 옮기고(옮겨 앉으면 셸이
  // 홈부터 연다), 이미 거기면 홈으로 돌아온다. 옛 UI 에는 있던 구독이 `next/` 로 옮기며 빠져, 알림을
  // 눌러도 창만 앞으로 오고 프로젝트는 그대로였다(2026-10-06 UX 점검). 못 옮기면 `switchProject` 가 한
  // 문장으로 말한다.
  useEffect(() => {
    const bridge = window.colonovaDesignDesktop;
    if (!bridge?.onOpenProject) return;
    return bridge.onOpenProject((slug) => {
      const { nav: now, daemon: current } = latest.current;
      // 서비스가 떴다는 알림이면 그 화면으로 — 보러 오라고 부른 알림이다. 그 밖의 소식은 홈의 받은 편지함에 선다.
      if (readyRef.current.includes(slug)) now.openProjectScreen(slug);
      else if (slug === current.activeSlug) now.goHome();
      else void now.switchProject(slug);
    });
  }, []);

  // 첫 준비가 끝난 순간(2026-10-07 베타 준비 분석 · 첫 5분) — 그 프로젝트의 작업 화면을 보고 있지 않으면(홈이거나 다른
  // 프로젝트) 앱 안에서 말한다: 토스트 한 번 + 홈의 줄. 데몬이 `firstPrep` 으로 첫 준비를 알려 주고(앱을 다시 켤 때의
  // 준비는 말하지 않는다), 이 효과는 `ready` 로 바뀌는 순간만 본다. 판정은 `ready-watch.ts`.
  const watchingPrep = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const step = stepFirstPrep(watchingPrep.current, daemon.projects);
    watchingPrep.current = step.watching;
    const seen: SeenView = {
      view: state.view,
      tab: state.tab,
      narrow,
      activeSlug: daemon.activeSlug,
    };
    const next = nextReady({
      ready: readyRef.current,
      finished: step.finished,
      up: daemon.projects
        .filter((project) => project.phase === "ready")
        .map((project) => project.slug),
      seen,
    });
    if (!sameList(next.ready, readyRef.current)) setReady(next.ready);
    for (const slug of next.announce) {
      const name = daemon.projects.find((project) => project.slug === slug)?.name ?? slug;
      showToast(L.firstReady.title(name), {
        label: L.firstReady.see,
        run: () => latest.current.nav.openProjectScreen(slug),
      });
    }
  }, [daemon.projects, daemon.activeSlug, state.view, state.tab, narrow, showToast]);

  const setCollapsed = useCallback(
    (value: boolean) => {
      dispatch({ type: "collapse", collapsed: value });
      onLayoutChange({ sidebarCollapsed: value });
    },
    [onLayoutChange],
  );
  const setDrawer = useCallback((open: boolean) => dispatch({ type: "drawer", open }), []);

  return { state, nav, ready, toast, dismissToast, setCollapsed, setDrawer };
}
