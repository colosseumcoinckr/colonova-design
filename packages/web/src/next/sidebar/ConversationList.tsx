import type { ProjectSummary, ThreadSummary } from "@colonova-design/protocol";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { Tip } from "../../components/Tip";
import type { Sessions } from "../../hooks/useSessions";
import type { Daemon } from "../../lib/daemon-client";
import { composing } from "../../lib/ime";
import { previewPathOf } from "../../lib/screen-link";
import { SYSTEM_THREAD_TITLES, visibleThreads } from "../../lib/thread-visibility";
import { downloadTranscript, transcriptToMarkdown } from "../../lib/transcript-export";
import { threadScreens } from "../../lib/turn-screens";
import { MoreIcon } from "../chat/icons";
import { L } from "../labels";
import { exportFileName } from "../lib/export-name";
import { groupThreadsByDay } from "../lib/thread-groups";
import { useFreshKeys } from "../lib/use-fresh-keys";
import { useToday } from "../lib/use-today";
import { InlineConfirm } from "../ui/InlineConfirm";
import { ChevronRightIcon, DownloadIcon, PencilIcon, Spin, TrashIcon } from "../ui/icons";
import { Popover } from "../ui/Popover";

/** ↑ ↓ 로 오가는 자리 — 대화 줄 하나하나와 `도구가 한 일` 의 머리. */
const STOPS = ".nx-conv, .nx-toolg > summary";

/**
 * 활성 프로젝트의 대화 목록 — 날짜 머리(오늘 · 어제 · 지난 7일 · 이전) 아래에 제목과 둘째 줄(그
 * 대화가 만진 화면들)이 선다. 도구가 스스로 연 대화(연결 준비 · 리뷰 반영 · 문제 해결)는 맨 아래
 * 접힌 `도구가 한 일` 로 간다 — 판정은 옛 사이드바와 같은 `SYSTEM_THREAD_TITLES`(데몬의 제목).
 * 줄의 `···` 메뉴는 이름 바꾸기 · 내보내기 · 지우기를 단다(도구가 한 일의 줄은 이름 바꾸기가
 * 없다 — 제목이 도구의 것이다). 오른쪽 단추나 `···` 자리 어디서든 메뉴가 열린다.
 *
 * 2026-10-06 사이드바 개선 — 날짜 머리 · ↑↓ Home End 로 줄 사이 이동 · 우클릭(또는 메뉴 키)으로 메뉴 ·
 * 열린 대화가 목록 밖에 있으면 보이는 자리로 · `···` 가 줄의 너비를 떼어 가지 않는다(CSS).
 */
export function ConversationList({
  daemon,
  project,
  sessions,
  activeSessionId,
  threadView,
  titleFor,
  onOpen,
  onRenameSession,
  onToast,
}: {
  daemon: Daemon;
  project: ProjectSummary | null;
  /** `useSessions` 의 결과 — 지운 대화가 열려 있으면 새 대화의 빈 자리로 돌린다. */
  sessions: Sessions;
  activeSessionId: string | null;
  /** 대화 보기가 앞에 서 있는가 — 홈에서는 어느 행도 켜지 않는다. */
  threadView: boolean;
  titleFor: (thread: ThreadSummary) => string;
  onOpen: (thread: ThreadSummary) => void;
  /** 이름 바꾸기 — 셸의 `onRenameSession`(설정의 대화 제목에 남는다). */
  onRenameSession: (sessionId: string, title: string) => void;
  onToast: (text: string) => void;
}) {
  const threads = useMemo(
    () => (project ? visibleThreads(project.threads, daemon.hiddenThreads, project.slug) : []),
    [project, daemon.hiddenThreads],
  );
  const planner = useMemo(
    () => threads.filter((thread) => !SYSTEM_THREAD_TITLES[thread.title]),
    [threads],
  );
  const tool = useMemo(
    () => threads.filter((thread) => SYSTEM_THREAD_TITLES[thread.title]),
    [threads],
  );
  // 날짜 머리 — 자정이 지나면 `useToday` 가 갈아 끼워 묶음이 저절로 한 칸씩 밀린다.
  const today = useToday();
  const groups = useMemo(() => groupThreadsByDay(planner, today), [planner, today]);
  const groupId = useId();
  // 새로 들어온 대화만 자리를 열며 내려앉는다 — 처음 그릴 때와 프로젝트를 옮길 때는 이미
  // 있는 줄을 새 것으로 치지 않고, 재정렬에서 옆으로 밀린 줄도 다시 등장하지 않는다.
  const fresh = useFreshKeys(
    threads.map((thread) => thread.id),
    project?.slug ?? "",
  );

  // 둘째 줄의 화면 — 이 창이 기록을 읽은 대화만 안다. 읽지 않은 대화 · 화면이 아직 없는
  // 대화는 둘째 줄이 없다.
  const previewUrl = daemon.repo?.previewUrl ?? null;
  const screensById = useMemo(() => {
    const toPath = (href: string) => previewPathOf(href, previewUrl);
    const out = new Map<string, string>();
    for (const [id, view] of Object.entries(daemon.sessions)) {
      if (view.blocks.length === 0) continue;
      // 제목 없는 맨 주소는 줄에 세우지 않는다 — 사용자 면에는 화면 이름만(U10).
      const titles = threadScreens(view.blocks, toPath).flatMap((screen) =>
        screen.title ? [screen.title] : [],
      );
      // 만든 화면이 없으면 둘째 줄을 비운다 — 빈 자리를 말로 채우지 않는다.
      out.set(id, titles.join(" · "));
    }
    return out;
  }, [daemon.sessions, previewUrl]);

  // 읽지 않은 대화의 둘째 줄도 채운다 — 목록 맨 앞(최신) 15개까지, 한 번에 하나씩
  // 기록을 읽어 온다. 도구가 연 대화는 화면을 말하지 않으니 건너뛴다. 끊겨
  // 실패한 것은 다음 연결에서 다시 묻고, 다 읽을 때까지 이어지도록 `fetchTick`
  // 으로 이펙트를 한 박자 더 돌린다.
  const fetched = useRef(new Set<string>());
  const fetching = useRef(false);
  const [, setFetchTick] = useState(0);
  useEffect(() => {
    if (daemon.connection !== "open" || fetching.current) return;
    const next = planner
      .slice(0, 15)
      .find(
        (thread) =>
          !daemon.sessions[thread.id]?.live &&
          !screensById.has(thread.id) &&
          !fetched.current.has(thread.id),
      );
    if (!next) return;
    fetched.current.add(next.id);
    fetching.current = true;
    daemon.api
      .history(next.id)
      .then((events) => daemon.hydrate(next.id, events))
      .catch(() => fetched.current.delete(next.id))
      .finally(() => {
        fetching.current = false;
        setFetchTick((tick) => tick + 1);
      });
  }, [daemon.connection, daemon.api, daemon.hydrate, daemon.sessions, planner, screensById]);

  // 줄의 `···` 메뉴와 그 안의 지우기 확인, 이름 바꾸기 입력의 상태.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  // Popover 가 누름 요소를 바깥으로 치지 않게 하는 줄의 `···` 단추들 — 줄마다 한 객체를 오래 쥔다.
  // 렌더마다 새 객체를 건네면 스트리밍으로 목록이 다시 그려질 때마다 팝이 자리를 다시 잰다.
  const anchors = useRef(new Map<string, { current: HTMLButtonElement | null }>());
  const anchorOf = (id: string) => {
    let anchor = anchors.current.get(id);
    if (!anchor) {
      anchor = { current: null };
      anchors.current.set(id, anchor);
    }
    return anchor;
  };
  // 메뉴를 키보드로 열었는가(메뉴 키 · Shift+F10) — 닫히면 초점이 `···` 가 아니라 제 줄로 돌아간다.
  const menuByKeys = useRef(false);
  // 지우기 메뉴 줄 — 확인이 접히면(그만두기 · Esc) 초점이 그 줄로 돌아온다(확인이 떠 있는 동안은 줄이 없다).
  const removeItem = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLElement>(null);

  /**
   * 줄의 제목 단추로 초점을 돌린다 — 메뉴 · 이름 바꾸기가 끝난 뒤 키보드가 제자리에서 이어지게.
   * 손이 이미 다른 곳(입력칸 · 다른 요소)에 가 있으면 건드리지 않는다.
   */
  const focusRow = (id: string) =>
    requestAnimationFrame(() => {
      const now = document.activeElement;
      if (now && now !== document.body && !now.classList.contains("nx-conv-menu")) return;
      listRef.current
        ?.querySelector<HTMLElement>(`.nx-conv[data-thread="${CSS.escape(id)}"]`)
        ?.focus();
    });
  const closeMenu = (restore = false) => {
    const id = menuFor;
    const byKeys = menuByKeys.current;
    setMenuFor(null);
    setConfirmFor(null);
    menuByKeys.current = false;
    if (restore && byKeys && id) focusRow(id);
  };
  // 지우기 확인으로 바뀌면 팝의 키와 폭이 달라진다 — 창 기준으로 선 팝이 자리를 다시 재도록 알린다
  // (아래로 열린 팝이 창 바닥에 닿아 확인 단추가 잘리지 않게 뒤집어 선다).
  useEffect(() => {
    if (confirmFor !== null) window.dispatchEvent(new Event("resize"));
  }, [confirmFor]);

  // 이름 바꾸기 입력 — 시작할 때 안내해 고른다(autoFocus 는 쓰지 않는다).
  const renameInput = useRef<HTMLInputElement>(null);
  const renamingId = renaming?.id ?? null;
  useEffect(() => {
    if (renamingId !== null) renameInput.current?.select();
  }, [renamingId]);

  // 프로젝트를 옮기면 목록은 맨 위부터 — 앞 프로젝트에서 굴려 둔 자리가 새 목록의 한가운데로 남지 않게.
  const slug = project?.slug;
  useEffect(() => {
    if (slug) listRef.current?.scrollTo({ top: 0 });
  }, [slug]);
  // 열린 대화가 목록의 굴러간 자리 밖이면 보이는 곳으로 — 찾기(⌘K)로 연 대화나 다시 켠 뒤 돌아온 대화가
  // 아래에 묻혀 지금 어디인지 알 수 없던 것을 막는다. 이미 보이면 건드리지 않는다.
  const openId = threadView ? activeSessionId : null;
  const openListed = threads.some((thread) => thread.id === openId);
  useEffect(() => {
    const list = listRef.current;
    const row = openId && openListed ? list?.querySelector(".nx-conv-row--on") : null;
    if (!list || !row) return;
    const box = list.getBoundingClientRect();
    const at = row.getBoundingClientRect();
    // 위쪽은 붙어 선 날짜 머리(약 30px)가 가리는 만큼 더 올린다.
    if (at.top < box.top + 30) list.scrollTop -= box.top + 30 - at.top;
    else if (at.bottom > box.bottom - 8) list.scrollTop += at.bottom - box.bottom + 8;
  }, [openId, openListed]);

  /**
   * ↑ ↓ Home End — 대화 줄과 `도구가 한 일` 머리 사이를 오간다. 닫힌 묶음 안의 줄은 보이지 않으니
   * 건너뛴다. 조합키를 누른 입력과 이름 바꾸기 칸(이 단추들이 아니다)은 건드리지 않는다.
   */
  const moveFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const { key } = event;
    if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return;
    const stops = [...(listRef.current?.querySelectorAll<HTMLElement>(STOPS) ?? [])].filter(
      (stop) => stop.tagName === "SUMMARY" || !stop.closest("details:not([open])"),
    );
    const at = stops.indexOf(event.currentTarget);
    if (at < 0) return;
    event.preventDefault();
    const next =
      key === "Home" ? 0 : key === "End" ? stops.length - 1 : at + (key === "ArrowDown" ? 1 : -1);
    stops[Math.min(stops.length - 1, Math.max(0, next))]?.focus();
  };

  /**
   * 이름 바꾸기의 끝 — 저장이면 흰칸만 다듬어 남기고(같은 제목은 다시 쓰지 않는다), 취소(Esc)면 아무것도
   * 쓰지 않는다. 한 번만 끝난다: 키로 끝나 입력이 떼어질 때 오는 블러가 낡은 글을 다시 저장하지 못하게
   * 막는다. 키로 끝나면 초점이 제 줄로 돌아온다(입력이 사라지며 초점이 허공으로 떨어지던 것).
   */
  const renameEnding = useRef(false);
  const endRename = (save: boolean, byKeys: boolean) => {
    const target = renaming;
    if (!target || renameEnding.current) return;
    renameEnding.current = true;
    setRenaming(null);
    if (byKeys) focusRow(target.id);
    const name = target.draft.trim();
    if (!save || !name) return;
    const thread = threads.find((entry) => entry.id === target.id);
    if (thread && titleFor(thread) === name) return;
    onRenameSession(target.id, name);
  };

  /**
   * 내보내기 — 대화를 markdown 파일 하나로. 아직 읽지 않은 대화는 여는 길과 같은
   * 읽기로 채우니(ensureSession · hydrate) 둘째 줄의 화면도 함께 생긴다.
   */
  const exportThread = (thread: ThreadSummary) => {
    const title = titleFor(thread);
    void daemon.api
      .history(thread.id)
      .then((events) => {
        if (!daemon.sessions[thread.id]) {
          daemon.ensureSession(thread.id);
          daemon.hydrate(thread.id, events);
        }
        const base = exportFileName(title, new Date());
        downloadTranscript(transcriptToMarkdown(events, title), base);
        onToast(L.convMenu.exportDone(`${base}.md`));
      })
      .catch(() => onToast(L.convMenu.exportFailed));
  };

  /**
   * 지우기 — 확인은 메뉴 안의 한 줄. 승인과 같은 커밋에서 행을 먼저 거둔다(낙관
   * 숨김, thread-visibility), 데몬의 목록이 따라오면 숨김을 거둔다. 실패하면
   * 행을 되돌린다.
   */
  const removeThread = (thread: ThreadSummary) => {
    const slug = project?.slug;
    if (!slug) return;
    // 키보드로 지웠으면 이웃 줄로 — 사라질 줄에 있던 초점이 허공으로 떨어지지 않게(보이는 줄만 센다).
    if (menuByKeys.current) {
      const stops = [...(listRef.current?.querySelectorAll<HTMLElement>(".nx-conv") ?? [])].filter(
        (stop) => stop.getClientRects().length > 0,
      );
      const at = stops.findIndex((stop) => stop.dataset.thread === thread.id);
      const near = stops[at + 1] ?? stops[at - 1];
      requestAnimationFrame(() => near?.isConnected && near.focus());
    }
    closeMenu();
    daemon.hideThread(slug, thread.id);
    // 지운 대화가 열려 있으면 새 대화의 빈 자리로 — 보던 화면은 그대로다.
    if (activeSessionId === thread.id) sessions.fresh();
    void daemon.api
      .deleteSession(thread.id)
      // 줄이 사라지는 것만으로는 낭독이 알 수 없다 — 끝났다는 한 줄이 알린다.
      .then(() => onToast(L.convMenu.removeDone))
      .catch(() => {
        daemon.unhideThread(slug, thread.id);
        onToast(L.convMenu.removeFailed);
      });
  };

  const rowBody = (thread: ThreadSummary) => {
    const view = daemon.sessions[thread.id];
    const failed = view?.state === "error";
    const on = threadView && thread.id === activeSessionId;
    const system = Boolean(SYSTEM_THREAD_TITLES[thread.title]);
    const menuOpen = menuFor === thread.id;
    const sub =
      thread.state === "running"
        ? L.journey.making
        : thread.state === "awaiting"
          ? L.sidebar.waitingAnswer
          : failed
            ? L.sidebar.aiFailedRetry
            : (screensById.get(thread.id) ?? "");

    if (renaming?.id === thread.id) {
      return (
        <div className="nx-conv-row">
          <input
            ref={renameInput}
            className="nx-conv-rename"
            value={renaming.draft}
            aria-label={L.convMenu.renameLabel}
            onChange={(event) => setRenaming({ id: thread.id, draft: event.target.value })}
            // 밖을 눌러 빠지면 저장한다 — 초점은 누른 곳에 둔다(키로 끝날 때만 줄로 돌아온다).
            onBlur={() => endRename(true, false)}
            onKeyDown={(event) => {
              // 한글이 조합 중이면 Enter 를 저장으로 읽지 않는다.
              if (composing(event)) return;
              if (event.key === "Enter") endRename(true, true);
              if (event.key === "Escape") endRename(false, true);
            }}
          />
        </div>
      );
    }

    return (
      <div
        className={`nx-conv-row${on ? " nx-conv-row--on" : ""}${menuOpen ? " nx-conv-row--menu" : ""}`}
      >
        <button
          type="button"
          className={`nx-conv${on ? " nx-conv--on" : ""}`}
          // 긴 제목은 줄에서 잘린다 — 전체 이름은 이 이름표가 말한다(OtherProjects 와 같은 결).
          title={titleFor(thread)}
          aria-current={on ? "true" : undefined}
          onClick={() => onOpen(thread)}
          onKeyDown={moveFocus}
          data-thread={thread.id}
          // 우클릭 · 메뉴 키 · Shift+F10 — 어디서든 `···` 와 같은 메뉴가 같은 자리에 뜬다.
          onContextMenu={(event) => {
            event.preventDefault();
            setConfirmFor(null);
            // 키보드로 연 것이면 초점이 `···` 로 건너가야 팝이 키보드를 받는다 — 팝은 창 뿌리에 그려져
            // 탭 순서의 끝에 있어 초점이 이 줄에 남으면 닿을 길이 없었다(2026-10-06 겹판 조사).
            const byKeys = event.currentTarget.matches(":focus-visible");
            menuByKeys.current = byKeys;
            if (byKeys) anchorOf(thread.id).current?.focus();
            setMenuFor(thread.id);
          }}
        >
          <span className="nx-conv-body">
            <span className="nx-conv-t">
              <span>{titleFor(thread)}</span>
              {thread.state === "running" ? (
                <Spin />
              ) : thread.state === "awaiting" ? (
                <i className="nx-dot nx-dot--amber" aria-hidden="true" />
              ) : failed ? (
                <i className="nx-dot nx-dot--red" aria-hidden="true" />
              ) : null}
            </span>
            {sub && <span className="nx-conv-s">{sub}</span>}
          </span>
        </button>
        {/* 이름(대화 메뉴)은 단추가 이미 말한다 — 풍선은 안에 든 것을 더 말한다(Tip 의 지침). */}
        <Tip
          label={menuOpen ? undefined : L.convMenu.hint}
          side="bottom"
          align="end"
          className="nx-conv-tip"
        >
          <button
            ref={(element) => {
              anchorOf(thread.id).current = element;
            }}
            type="button"
            className="nx-conv-menu"
            aria-label={L.convMenu.label}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => {
              setConfirmFor(null);
              menuByKeys.current = false;
              setMenuFor(menuOpen ? null : thread.id);
            }}
          >
            <MoreIcon />
          </button>
        </Tip>
        {menuOpen && (
          <Popover
            anchor={anchorOf(thread.id)}
            onClose={() => closeMenu(true)}
            align="end"
            // 굴러가는 목록의 끝에서 잘리지 않게 창 기준으로 선다.
            float
            // 줄을 고르는 목록은 `menu`(↑ ↓ Home End · 글자 건너뛰기), 지우기 확인이 선 동안은 `dialog`.
            role={confirmFor === thread.id ? "dialog" : "menu"}
            className={`nx-conv-pop${confirmFor === thread.id ? " nx-conv-pop--confirm" : ""}`}
            label={confirmFor === thread.id ? L.convMenu.removeTitle : L.convMenu.label}
          >
            {confirmFor === thread.id ? (
              <InlineConfirm
                title={L.convMenu.removeTitle}
                body={L.convMenu.removeBody}
                confirmLabel={L.convMenu.remove}
                cancelLabel={L.convMenu.removeCancel}
                onConfirm={() => removeThread(thread)}
                onCancel={() => setConfirmFor(null)}
                returnRef={removeItem}
              >
                {/* 도는 대화를 지우면 AI 의 일이 멈춘다 — 미리 말한다. */}
                {thread.state === "running" && (
                  <p className="nx-iconf-why">{L.convMenu.removeRunning}</p>
                )}
              </InlineConfirm>
            ) : (
              <>
                {!system && (
                  <button
                    type="button"
                    role="menuitem"
                    className="nx-mi"
                    onClick={() => {
                      closeMenu();
                      renameEnding.current = false;
                      setRenaming({ id: thread.id, draft: titleFor(thread) });
                    }}
                  >
                    <span className="nx-mi-ic">
                      <PencilIcon />
                    </span>
                    <b>{L.convMenu.rename}</b>
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="nx-mi"
                  onClick={() => {
                    closeMenu(true);
                    exportThread(thread);
                  }}
                >
                  <span className="nx-mi-ic">
                    <DownloadIcon />
                  </span>
                  <b>{L.convMenu.export}</b>
                </button>
                <div className="nx-msep" />
                <button
                  type="button"
                  role="menuitem"
                  ref={removeItem}
                  className="nx-mi nx-mi--dng"
                  onClick={() => setConfirmFor(thread.id)}
                >
                  <span className="nx-mi-ic">
                    <TrashIcon />
                  </span>
                  <b>{L.convMenu.remove}</b>
                </button>
              </>
            )}
          </Popover>
        )}
      </div>
    );
  };

  // 줄을 격자 감싸개로 싼다 — 새 줄이 높이 0 에서 제 높이로 열리며 아래 줄을 밀어낸다.
  const row = (thread: ThreadSummary) => (
    <div key={thread.id} className={`nx-item${fresh.has(thread.id) ? " nx-item--new" : ""}`}>
      {rowBody(thread)}
    </div>
  );

  // 접힌 묶음에 실패가 묻혔는지 — 안의 실패(error) 행을 펼치지 않고도 알게 한다.
  // 대기(awaiting)는 이미 인박스 · 배지가 세지만 실패는 어디에도 집계되지 않았다
  // (2026-10-04 ux-review).
  const toolFailed = tool.some((thread) => daemon.sessions[thread.id]?.state === "error");
  const toolOpen = tool.some((thread) => thread.id === activeSessionId);
  return (
    // 대화 줄들로 가는 길 — 위의 `새 대화 · 홈 · 찾기` 와 따로 이름을 단 내비게이션이다.
    <nav className="nx-conv-list" ref={listRef} aria-label={L.sidebar.convs}>
      {/* 과업이 하나도 없으면(도구 대화만 남은 경우 포함) 조용한 한 줄 — 빈 목록은 그대로 두지 않는다. */}
      {planner.length === 0 && <div className="nx-calm">{L.palette.noConvs}</div>}
      {groups.map((group) => (
        <section
          key={group.bucket}
          className="nx-cg"
          aria-labelledby={`${groupId}-${group.bucket}`}
        >
          <h3 className="nx-cg-h" id={`${groupId}-${group.bucket}`}>
            {L.sidebar.groups[group.bucket]}
          </h3>
          {group.threads.map(row)}
        </section>
      ))}
      {tool.length > 0 && (
        // 열린 대화가 그 안에 있을 때만 펼친 채로 선다 — 기본은 접힘.
        <details className="nx-toolg" open={toolOpen || undefined}>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: summary 는 접는 머리라 키로 이미 여닫는 단추다 — 화살표 이동만 더한다. */}
          <summary onKeyDown={moveFocus}>
            <ChevronRightIcon />
            {L.sidebar.toolWorkCount(tool.length)}
            {toolFailed && !toolOpen && (
              <>
                <i className="nx-dot nx-dot--red" aria-hidden="true" />
                <span className="nx-vh">{L.vocab.aiFailed}</span>
              </>
            )}
          </summary>
          {tool.map(row)}
        </details>
      )}
    </nav>
  );
}
