/**
 * 입력창 시트 견본 — 데몬 없이 진짜 `ChatColumn` 을 좁은 창의 세 탭 구조 위에 올려
 * 화면 탭의 시트(열기 · 접기 · 탭 이동 · 넓혔다 좁히기)가 입력창을 재마운트하지 않는지
 * 본다. 앱과 같은 CSS(테마 · styles.css · next.css → shell.css · chat.css)를 올린다.
 * `vite build` 의 입력은 index.html 뿐이라 제품에 실리지 않고, tsconfig 가 dev/ 를 보지 않는다.
 *
 *   ./node_modules/.bin/vite --port 29181 --strictPort --host 127.0.0.1   (packages/web 에서)
 *   → http://127.0.0.1:29181/dev/composer-sheet-fixture.html?tab=preview
 *
 * ?tab=preview|chat|plans — 처음 앞에 설 탭. ?narrow=0 — 넓은 창으로 시작한다.
 * 검증용 전역: `__callLog`(nav 손의 호출 기록), `__setNarrow`(넓은 창 흉내).
 * 재마운트 여부는 textarea·첨부 칩의 DOM 노드 동일성과 쓰던 글·첨부 보존으로 본다.
 */

import { StrictMode, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type { Pins } from "../src/hooks/usePins";
import type { Sessions } from "../src/hooks/useSessions";
import type { Settings } from "../src/lib/settings";
import { applyStoredTheme, applyStoredTypeScale } from "../src/lib/settings";
import { ChatColumn } from "../src/next/chat/ChatColumn";
import { L } from "../src/next/labels";
import {
  getComposerSheet,
  setComposerSheetHost,
  subscribeComposerSheet,
  toggleComposerSheet,
} from "../src/next/lib/composer-sheet";
import type { ShellNav } from "../src/next/slots";
import { mockDaemon } from "./overlay-mocks";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "../src/styles.css";
import "../src/next/next.css";

applyStoredTheme();
applyStoredTypeScale();
const query = new URLSearchParams(location.search);
const initialTab = (query.get("tab") ?? "preview") as "preview" | "chat" | "plans";
const initialNarrow = query.get("narrow") !== "0";

declare global {
  interface Window {
    __callLog: string[];
    __setNarrow: (narrow: boolean) => void;
    __setTab: (tab: "preview" | "chat" | "plans") => void;
  }
}
window.__callLog = [];

const daemon = mockDaemon();

const pins = {
  list: [],
  ghosts: [],
  add: () => undefined,
  remove: () => undefined,
  setNote: () => undefined,
  clear: () => undefined,
  markSent: async () => undefined,
  dismissGhosts: () => undefined,
} as unknown as Pins;

const sessions = {
  activeId: null,
  active: null,
  list: [],
  queue: [],
  outgoing: [],
  dropped: [],
  usage: null,
  running: false,
  stopping: false,
  commands: [],
  historyFailed: false,
  awaitingTurn: null,
  suggestion: null,
  chipTarget: (subject: "next" | "session") => ({
    subject,
    key: `next:claude`,
    provider: "claude",
    model: null,
    effort: null,
    fastMode: false,
    fastModeBlocked: null,
    models: [],
    setModel: async () => undefined,
    setEffort: async () => undefined,
    setFast: async () => null,
  }),
  submit: async () => undefined,
  sentOriginal: () => null,
  dismissDropped: () => undefined,
  branchFrom: async () => undefined,
  fresh: () => undefined,
  reopen: () => undefined,
  setError: () => undefined,
} as unknown as Sessions;

/** 화면 칸의 자리 — PreviewColumn 과 같은 계약: 좁은 창에서만 자리를 세운다. */
function MockPreview({ narrow }: { narrow: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!narrow) {
      setComposerSheetHost(null);
      return undefined;
    }
    setComposerSheetHost(host.current);
    return () => setComposerSheetHost(null);
  }, [narrow]);
  const sheet = useSyncExternalStore(subscribeComposerSheet, getComposerSheet, getComposerSheet);
  return (
    <section className="nx-preview" style={{ position: "relative" }}>
      <div className="nx-sheet-host" ref={host} id="fx-sheet-host" />
      <button
        type="button"
        className="nx-fold-cmp"
        aria-expanded={sheet.open}
        aria-controls="fx-sheet-host"
        onClick={toggleComposerSheet}
      >
        {L.narrow.composeFold}
      </button>
    </section>
  );
}

function Fixture() {
  const [narrow, setNarrow] = useState(initialNarrow);
  const [tab, setTab] = useState<"preview" | "chat" | "plans">(initialTab);
  window.__setNarrow = setNarrow;
  window.__setTab = setTab;

  const nav = {
    showTab: (next: string) => {
      window.__callLog.push(`showTab:${next}`);
      if (next === "preview" || next === "chat" || next === "plans") setTab(next);
    },
    showRightTab: (next: string) => window.__callLog.push(`showRightTab:${next}`),
    showThread: () => window.__callLog.push("showThread"),
    showScreen: () => window.__callLog.push("showScreen"),
    openPlans: () => window.__callLog.push("openPlans"),
    openSettings: () => window.__callLog.push("openSettings"),
    toast: (text: string) => window.__callLog.push(`toast:${text}`),
  } as unknown as ShellNav;

  const chatHidden = narrow && tab === "preview";
  const sheetOn = narrow && tab === "preview";

  return (
    <div
      className={`nx${narrow ? " nx--narrow" : ""}`}
      style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}
    >
      <div className="nx-body" data-tab={narrow ? tab : undefined}>
        <MockPreview narrow={narrow} />
        <div
          className={`nx-chat-slot${chatHidden ? " nx-offstage" : ""}`}
          aria-hidden={chatHidden}
          inert={chatHidden}
        >
          <ChatColumn
            daemon={daemon}
            settings={
              { chat: { showThinking: true, showTools: true, disabledProviders: [] } } as Settings
            }
            sessions={sessions}
            pins={pins}
            project={daemon.projects[0] ?? null}
            activeSessionId={null}
            nav={nav}
            narrow={narrow}
            rightTab="chat"
            screenName="로그인 화면"
            sheetOn={sheetOn}
            onChatChange={() => undefined}
            onRenameSession={() => undefined}
          />
        </div>
      </div>
    </div>
  );
}

const fixtureRoot = document.getElementById("root");
if (!fixtureRoot) throw new Error("fixture root missing");
createRoot(fixtureRoot).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
