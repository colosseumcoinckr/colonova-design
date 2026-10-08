import {
  type KeyboardEvent,
  type ReactElement,
  type UIEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useModalEscape, useModalFocus } from "../../hooks/use-modal-focus";
import type { Daemon } from "../../lib/daemon-client";
import { requestInvitePicker } from "../../lib/invite-bus";
import type { ChatSettings, Settings } from "../../lib/settings";
import { L } from "../labels";
import { connectionCopy, connectionLock, reconnectNeeds } from "../lib/connection-copy";
import { closeGuard, pageDirection } from "../lib/settings-shell";
import { useClosing } from "../lib/use-closing";
import { hasNewerVersion } from "../lib/version";
import { CloseIcon, Spin } from "../ui/icons";
import { AiPage } from "./AiPage";
import { ConnectionPage } from "./ConnectionPage";
import { DeveloperPage } from "./DeveloperPage";
import {
  AiPageIcon,
  ConnectPageIcon,
  DevPageIcon,
  NotifyPageIcon,
  ThemePageIcon,
  UpdatePageIcon,
} from "./icons";
import { NotifyPage } from "./NotifyPage";
import { AnnounceContext } from "./parts";
import { ThemePage } from "./ThemePage";
import { UpdatePage } from "./UpdatePage";
import { useAuthorName } from "./use-author";
import { useReset } from "./use-reset";
import { useUpdates } from "./use-updates";

/** 설정의 쪽 — 왼쪽 목록의 차례가 이 순서고, 개발자용은 맨 아래에 따로 선다. */
type Page = "ai" | "theme" | "notify" | "connection" | "update" | "developer";

const PAGES: readonly Page[] = ["ai", "theme", "notify", "connection", "update", "developer"];

const PAGE_TITLE: Record<Page, string> = {
  ai: L.settings.ai,
  theme: L.settings.theme,
  notify: L.settings.notify,
  connection: L.settings.connection,
  update: L.settings.update,
  developer: L.settings.developer,
};

const PAGE_SUB: Record<Page, string> = {
  ai: L.settings.aiSub,
  theme: L.settings.themeSub,
  notify: L.settings.notifySub,
  connection: L.settings.connectionSub,
  update: L.settings.updateSub,
  developer: L.settings.developerSub,
};

const PAGE_ICON: Record<Page, () => ReactElement> = {
  ai: AiPageIcon,
  theme: ThemePageIcon,
  notify: NotifyPageIcon,
  connection: ConnectPageIcon,
  update: UpdatePageIcon,
  developer: DevPageIcon,
};

type PillTone = "blue" | "amber" | "red";

/**
 * 설정의 여섯 쪽과 왼쪽 목록(PLAN-UI U12) — `nav.openSettings` 가 연다. 문장은 전부 labels(L · DEV)에서
 * 오고, 저장은 옛 대화상자와 같은 길(테마 · 알림은 settings, 프로바이더는 chat 의 patch, 자동 설치 ·
 * 작성 이름은 데몬의 machine 설정)을 쓴다. 쪽은 모두 그려 둔 채 하나만 보인다 — 쪽을 옮겨도 설치 ·
 * 로그인 · 확인 중인 일이 끊기지 않게. 이 껍데기는 목록 · 머리 · 닫기 · 낭독을 맡고, 쪽마다의 일은
 * 쪽 컴포넌트(2026-10-06 설정 손질로 나눴다)가 맡는다.
 */
export function SettingsDialog({
  daemon,
  settings,
  onChatChange,
  onSettingsChange,
  onClose,
}: {
  daemon: Daemon;
  settings: Settings;
  onChatChange: (patch: Partial<ChatSettings>) => void;
  /** 알림 정책의 저장 — App 의 settings 상태가 유일한 원천이다. */
  onSettingsChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}) {
  const status = daemon.status;
  const providers = status?.providers ?? [];
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(panel);
  // 열 때 초점은 고른 쪽의 탭에 둔다 — 패널에 두면 목록의 ↑↓ 가 아무 일도 하지 않는다.
  useEffect(() => {
    const tab = panel.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    (tab ?? panel.current)?.focus();
  }, []);

  // 사이드바 바퀴의 점과 같은 판정 — 점이 켜진 채 열면 업데이트 쪽이 먼저 보인다.
  const agentUpdateReady = providers.some(
    (provider) => provider.available && hasNewerVersion(provider.version, provider.latestVersion),
  );
  const [page, setPage] = useState<Page>(() => (agentUpdateReady ? "update" : "ai"));
  // 쪽이 바뀐 뒤부터만 등장 움직임을 준다 — 열릴 때는 창의 pop 하나로 충분하다. 방향은 목록의 차례가 정한다.
  const [switched, setSwitched] = useState(false);
  const [direction, setDirection] = useState<"up" | "down" | "none">("none");
  const selectPage = (next: Page) => {
    if (next === page) return;
    setDirection(pageDirection(PAGES, page, next));
    setSwitched(true);
    setPage(next);
  };
  // 쪽을 굴리면 머리 아래에 가는 선이 선다 — 쪽마다 제 굴림을 가진다.
  const [scrolled, setScrolled] = useState<Partial<Record<Page, boolean>>>({});
  const scrollOf = (id: Page) => (event: UIEvent<HTMLDivElement>) => {
    const on = event.currentTarget.scrollTop > 2;
    setScrolled((now) => (Boolean(now[id]) === on ? now : { ...now, [id]: on }));
  };

  // 좁은 창(720px 아래)에서는 왼쪽 목록이 가로 띠가 된다 — settings.css 의 어금과 같은 문턱. 읽는 방향
  // (aria-orientation)도 실제 배치를 따라간다(2026-10-04 ux-review).
  const [railRow, setRailRow] = useState(
    () => window.matchMedia?.("(max-width: 720px)").matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 720px)");
    const onChange = () => setRailRow(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // 목록의 활성 표시는 알약 하나가 미끄러진다 — 고른 탭의 자리와 크기를 재어 CSS 변수로 건네고, 움직임은
  // CSS 가 전환한다(동작 줄이기에서는 곧바로). 첫 그림은 전환 없이 제 자리에 선다(`data-ready` 가 붙기 전).
  const tabsRef = useRef<HTMLDivElement>(null);
  const placed = useRef("");
  const placePill = useCallback(() => {
    const tabs = tabsRef.current;
    const on = tabs?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!tabs || !on) return;
    // 자리가 그대로면 쓰지 않는다 — 이름 칸에 글자를 칠 때마다 껍데기가 다시 그려지지만 알약은 가만히 있다.
    const key = `${on.offsetLeft}|${on.offsetTop}|${on.offsetWidth}|${on.offsetHeight}`;
    if (placed.current === key) return;
    placed.current = key;
    tabs.style.setProperty("--pill-x", `${on.offsetLeft}px`);
    tabs.style.setProperty("--pill-y", `${on.offsetTop}px`);
    tabs.style.setProperty("--pill-w", `${on.offsetWidth}px`);
    tabs.style.setProperty("--pill-h", `${on.offsetHeight}px`);
    tabs.dataset.ready = "";
  }, []);
  // 알약이나 글꼴이 탭의 폭을 바꿀 수 있어 그릴 때마다 다시 잰다 — 읽기 몇 번이라 싸다.
  useLayoutEffect(placePill);
  useEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs || typeof ResizeObserver === "undefined") return;
    const watcher = new ResizeObserver(placePill);
    watcher.observe(tabs);
    for (const tab of tabs.querySelectorAll("[role='tab']")) watcher.observe(tab);
    return () => watcher.disconnect();
  }, [placePill]);

  // ── 낭독 — 늘 마운트된 상태 칸 하나에 문장을 올린다(내용과 함께 새로 그려지는 칸은 낭독이 놓친다).
  const [live, setLive] = useState("");
  const liveTimer = useRef<number | null>(null);
  const announce = useCallback((text: string) => {
    if (liveTimer.current !== null) window.clearTimeout(liveTimer.current);
    setLive("");
    liveTimer.current = window.setTimeout(() => setLive(text), 60);
  }, []);
  useEffect(
    () => () => {
      if (liveTimer.current !== null) window.clearTimeout(liveTimer.current);
    },
    [],
  );

  // ── 쪽마다의 상태 — 닫기 보호가 이름의 저장과 초기화의 걸음을 알아야 해서 껍데기가 든다.
  const author = useAuthorName(daemon);
  const reset = useReset();
  const updates = useUpdates(daemon);
  // 연결 코드의 만료와 AI 로그인의 끝은 다른 일이다 — 갈라 읽는다(connection-copy 의 reconnectNeeds).
  const reconnect = reconnectNeeds(status);
  // 연결 한 줄(U17) — 만료 예정을 데몬이 머리글에서 읽어 왔다면 남은 날을 말한다.
  const connection = connectionCopy(
    {
      expired: reconnect.github,
      expiresAt: status?.githubTokenExpiresAt ?? null,
      projects: daemon.projects.length,
      noticeRoute: status?.noticeRoute ?? "none",
    },
    Date.now(),
    L,
  );

  // ── 닫기 — Esc · 배경 · ✕ 가 모두 이 길로 모인다. 이름이 저장되지 못했으면 열어 둔 채 말한다.
  const { closing, begin } = useClosing(onClose);
  const [closeWaiting, setCloseWaiting] = useState(false);
  const [focusAuthor, setFocusAuthor] = useState(0);
  // 저장이 닫기 때문에 실패해 창을 열어 둔 채 말해 준 글 — 같은 글로 다시 닫으면 그대로 닫는다.
  const [warnedDraft, setWarnedDraft] = useState<string | null>(null);
  const requestClose = async () => {
    // 초기화가 도는 동안은 닫히지 않는다 — 앱이 곧 다시 열린다.
    if (reset.phase !== "idle" || closing || closeWaiting) return;
    const verdict = closeGuard({
      dirty: author.dirty,
      saving: author.phase === "saving",
      warned: warnedDraft !== null && warnedDraft === author.draft.trim(),
    });
    if (verdict === "close") {
      begin();
      return;
    }
    setCloseWaiting(true);
    const saved = await (verdict === "save" ? author.commit() : author.settle());
    setCloseWaiting(false);
    if (saved) {
      begin();
      return;
    }
    // 닫으며 쏜 저장의 실패는 언마운트 뒤에 써져 사라졌다 — 열어 둔 채 연결 쪽의 칸으로 데려간다.
    setWarnedDraft(author.draft.trim());
    selectPage("connection");
    setFocusAuthor((count) => count + 1);
  };
  useModalEscape(panel, () => void requestClose());
  // 초대 파일 열기 — 고르기 창이 열리는 동안 설정은 닫는 모션을 지나 물러난다(확인 카드가 이어받는다).
  const openInvite = () => {
    requestInvitePicker();
    void requestClose();
  };

  // 왼쪽 목록의 화살표 걸음 — 옮겨 가며 곧바로 그 쪽을 연다(탭 순서에는 고른 쪽 하나만 선다).
  const railKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = PAGES.indexOf(page);
    let next: number;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (at + 1) % PAGES.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft")
      next = (at - 1 + PAGES.length) % PAGES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = PAGES.length - 1;
    else return;
    event.preventDefault();
    const target = PAGES[next];
    if (target) selectPage(target);
    event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='tab']")[next]?.focus();
  };

  /** 왼쪽 목록의 알약 — 눈여겨볼 일이 있는 쪽에만 서고, 무슨 일인지 말이 따로 선다(색만으로 말하지 않는다). */
  const pillOf = (id: Page): { tone: PillTone; text: string } | null => {
    if (id === "ai") {
      return reconnect.login ? { tone: "red", text: L.settings.attentionExpired } : null;
    }
    if (id === "update") {
      return agentUpdateReady || updates.summary.count > 0
        ? { tone: "blue", text: L.settings.attentionUpdate }
        : null;
    }
    if (id === "connection") {
      if (connection.dot === "green") return null;
      return connection.dot === "red"
        ? { tone: "red", text: L.settings.attentionExpired }
        : { tone: "amber", text: L.settings.attentionSoon };
    }
    return null;
  };

  return (
    <AnnounceContext.Provider value={announce}>
      {/* 배경을 누르면 창이 물러난다 — 눌린 곳이 배경 자신일 때만(안의 창은 제외). */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 배경 누름은 포인터의 길이다 — 키보드는 Esc 와 닫기 단추로 같은 곳에 닿는다. */}
      <div
        className={`nx-set-back${closing ? " nx-set-back--out" : ""}`}
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) void requestClose();
        }}
      >
        <div
          ref={panel}
          className="nx-set"
          role="dialog"
          aria-modal="true"
          aria-label={L.settings.title}
          tabIndex={-1}
        >
          <div className="nx-set-rail">
            <h2 className="nx-set-title">{L.settings.title}</h2>
            <div
              ref={tabsRef}
              className="nx-set-tabs"
              role="tablist"
              aria-orientation={railRow ? "horizontal" : "vertical"}
              aria-label={L.settings.title}
              onKeyDown={railKeys}
            >
              <span className="nx-set-slide" role="presentation" aria-hidden="true" />
              {PAGES.map((id) => {
                const Icon = PAGE_ICON[id];
                const pill = pillOf(id);
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    id={`nx-set-tab-${id}`}
                    aria-selected={page === id}
                    aria-controls={`nx-set-page-${id}`}
                    tabIndex={page === id ? 0 : -1}
                    className={`nx-set-tab${page === id ? " nx-set-tab--on" : ""}${
                      id === "developer" ? " nx-set-tab--dev" : ""
                    }`}
                    onClick={() => selectPage(id)}
                  >
                    <Icon />
                    <span>{PAGE_TITLE[id]}</span>
                    {pill && (
                      <span className={`nx-set-pill nx-set-pill--${pill.tone}`}>
                        <i aria-hidden="true" />
                        {pill.text}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            className={`nx-set-pane${switched ? " nx-set-pane--switched" : ""}`}
            data-dir={direction}
            data-scrolled={scrolled[page] ? "" : undefined}
          >
            <div className="nx-set-hd">
              <div key={page} className="nx-set-hd-txt">
                <h3>{PAGE_TITLE[page]}</h3>
                <p>{PAGE_SUB[page]}</p>
              </div>
            </div>

            <AiPage
              active={page === "ai"}
              daemon={daemon}
              settings={settings}
              onChatChange={onChatChange}
              onSettingsChange={onSettingsChange}
              loginExpired={reconnect.login}
              onScroll={scrollOf("ai")}
            />
            <ThemePage
              active={page === "theme"}
              settings={settings}
              onSettingsChange={onSettingsChange}
              onScroll={scrollOf("theme")}
            />
            <NotifyPage
              active={page === "notify"}
              settings={settings}
              onSettingsChange={onSettingsChange}
              onScroll={scrollOf("notify")}
            />
            <ConnectionPage
              active={page === "connection"}
              daemon={daemon}
              author={author}
              reset={reset}
              connection={connection}
              lockReason={connectionLock(daemon.connection, L)}
              focusSignal={focusAuthor}
              onOpenInvite={openInvite}
              onScroll={scrollOf("connection")}
            />
            <UpdatePage
              active={page === "update"}
              daemon={daemon}
              updates={updates}
              onGoAi={() => selectPage("ai")}
              onScroll={scrollOf("update")}
            />
            <DeveloperPage
              active={page === "developer"}
              daemon={daemon}
              onScroll={scrollOf("developer")}
            />

            {/* 닫기는 DOM 의 끝에 둔다 — Tab 이 목록 → 본문 → 닫기 순으로 흐른다. 자리는 CSS 가 머리 오른쪽에 둔다. */}
            <button
              type="button"
              className="nx-ibtn nx-set-x"
              aria-label={L.settings.close}
              disabled={reset.phase !== "idle"}
              onClick={() => void requestClose()}
            >
              <CloseIcon />
            </button>
            {closeWaiting && (
              <div className="nx-set-wait" role="status">
                <Spin /> {L.settings.nameSaving}
              </div>
            )}
            <div className="nx-sr" role="status">
              {live}
            </div>
          </div>
        </div>
      </div>
    </AnnounceContext.Provider>
  );
}
