/**
 * 실제 PlanTab을 fake Daemon으로 올리는 브라우저 회귀 견본.
 * pnpm exec vite --port 29181 --strictPort
 * http://127.0.0.1:29181/dev/plan-tab-fixture.html?case=mixed&w=420
 */
import type {
  DocBlock,
  DraftBlock,
  DraftChangedMessage,
  DraftView,
} from "@colonova-design/protocol";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Daemon } from "../src/lib/daemon-client";
import { applyStoredTheme, applyStoredTypeScale } from "../src/lib/settings";
import { PlanTab } from "../src/next/chat/PlanTab";
import { COMPOSER_ATTACH_EVENT } from "../src/next/lib/composer-attach";
import type { ShellNav } from "../src/next/slots";
import { mockDaemon } from "./overlay-mocks";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "../src/styles.css";
import "../src/next/next.css";

applyStoredTheme();
applyStoredTypeScale();

const params = new URLSearchParams(location.search);
const CASE = params.get("case") ?? "mixed";
const WIDTH = [320, 420, 640].includes(Number(params.get("w"))) ? Number(params.get("w")) : 420;
const theme = params.get("theme");
if (theme) document.documentElement.dataset.theme = theme;

type FixtureWindow = Window & { __calls: string[]; __errors: string[] };
const calls: string[] = [];
const errors: string[] = [];
Object.assign(window, { __calls: calls, __errors: errors });
window.addEventListener("unhandledrejection", (event) => {
  errors.push(String(event.reason instanceof Error ? event.reason.message : event.reason));
});

const NOW = new Date().toISOString();
const docs = [
  { pageId: "1001", title: "회원 목록 화면 기준", version: 3, path: "제품/회원" },
  { pageId: "1002", title: "결제 내역 화면 기준", version: 2, path: "제품/결제" },
];
type MapRead = Awaited<ReturnType<Daemon["api"]["mapRead"]>>;
let memoryLinks: MapRead["links"] =
  CASE === "empty" || CASE === "refs-only"
    ? []
    : [{ pageId: "1001", route: "/members", section: "검색", note: null, createdAt: NOW }];
const previewBlocks: DocBlock[] = [
  { t: "heading", level: 1, children: [{ t: "text", text: "공식 문서 미리보기" }] },
  {
    t: "p",
    children: [{ t: "text", text: "공식본문 확인문장: Confluence 원본에 저장된 내용입니다." }],
  },
  {
    t: "table",
    rows: [
      {
        cells: [
          { header: true, blocks: [{ t: "p", children: [{ t: "text", text: "항목" }] }] },
          { header: true, blocks: [{ t: "p", children: [{ t: "text", text: "기준" }] }] },
        ],
      },
      {
        cells: [
          { header: false, blocks: [{ t: "p", children: [{ t: "text", text: "검색 결과" }] }] },
          { header: false, blocks: [{ t: "p", children: [{ t: "text", text: "이름과 이메일" }] }] },
        ],
      },
    ],
  },
];
const draftBlocks: DraftBlock[] = [
  {
    id: "h1",
    view: { kind: "heading", level: 1, text: "최신 초안 미리보기" },
    editable: true,
    tokens: {},
    status: "changed",
  },
  {
    id: "p1",
    view: { kind: "paragraph", text: "최신초안 확인문장: 작업 중인 초안의 내용입니다." },
    editable: true,
    tokens: {},
    status: "changed",
  },
  {
    id: "t1",
    view: {
      kind: "table",
      rows: [
        {
          cells: [
            { header: true, text: "구분" },
            { header: true, text: "최신 초안" },
          ],
        },
        {
          cells: [
            { header: false, text: "검색" },
            { header: false, text: "이름 또는 이메일" },
          ],
        },
      ],
    },
    editable: true,
    tokens: {},
    status: "same",
  },
  {
    id: "preserved",
    view: { kind: "preserved", label: "macro:info" },
    editable: false,
    tokens: {},
    status: "same",
    preview: [
      {
        t: "panel",
        tone: "info",
        title: "보존된 안내",
        blocks: [{ t: "p", children: [{ t: "text", text: "보존 블록 미리보기 사례" }] }],
      },
    ],
  },
];

let draftView: DraftView = {
  docKey: "n-0123456789abcdef0123456789abcdef",
  kind: "new",
  pageId: null,
  site: "fixture.invalid",
  title: "회원 목록 개선 초안",
  baseTitle: null,
  baseVersion: null,
  revision: 4,
  state: "editing",
  blocks: draftBlocks,
  parent: null,
  stage: { notation: null, closed: false },
  observedVersion: null,
  pendingCommandId: null,
  updatedAt: NOW,
};

const mapResult = (): MapRead => ({
  linked: true,
  docs,
  folders: [],
  screens: [{ route: "/members", title: "회원 목록", observed: true }],
  links: memoryLinks,
});
const refsResult = (sessionId: string) => ({
  refs:
    CASE === "empty" || (CASE === "race" && sessionId === "session-fixture-b")
      ? []
      : [
          {
            at: NOW,
            ref: {
              title: "회원 목록 개선 초안",
              pageId: null,
              docKey: draftView.docKey,
              url: null,
              version: null,
              revision: 4,
              published: false,
              sections: ["검색 조건"],
            },
          },
        ],
});
const syncResult = (sessionId: string) => ({
  docs:
    (CASE === "mixed" || CASE === "race") && !(CASE === "race" && sessionId === "session-fixture-b")
      ? [
          {
            pageId: "1002",
            docKey: "p-1002",
            title: "결제 내역 같이 고친 초안",
            changes: 2,
            sections: ["표시 순서", "합계"],
            at: NOW,
          },
        ]
      : [],
});

const daemon = mockDaemon();
const draftListeners = new Set<Parameters<Daemon["onDraftEvent"]>[0]>();
const onDraftEvent: Daemon["onDraftEvent"] = (listener) => {
  draftListeners.add(listener);
  calls.push("event.subscribe:draft");
  return () => {
    draftListeners.delete(listener);
    calls.push("event.unsubscribe:draft");
  };
};
const attempt: Record<string, number> = {};
const onceFail = (name: string, active: boolean) => {
  attempt[name] = (attempt[name] ?? 0) + 1;
  if (active && attempt[name] === 1) throw new Error(`fixture ${name} first attempt`);
};
const pauseRace = () =>
  CASE === "race" ? new Promise<void>((resolve) => setTimeout(resolve, 1400)) : Promise.resolve();
const toBase64 = (value: string) => btoa(String.fromCharCode(...new TextEncoder().encode(value)));
const api: Partial<Daemon["api"]> = {
  mapRead: async () => {
    calls.push("api.mapRead");
    onceFail("mapRead", CASE === "failed" || CASE === "partial");
    return mapResult();
  },
  draftRefs: async (sessionId) => {
    calls.push(`api.draftRefs:${sessionId}`);
    onceFail("draftRefs", CASE === "failed");
    return refsResult(sessionId);
  },
  draftSyncDocs: async (sessionId) => {
    calls.push(`api.draftSyncDocs:${sessionId}`);
    onceFail("draftSyncDocs", CASE === "failed");
    return syncResult(sessionId);
  },
  draftGet: async (docKey) => {
    calls.push(`api.draftGet:${docKey}`);
    onceFail("draftGet", CASE === "read-failed");
    await pauseRace();
    if (docKey === "p-1002")
      return {
        ...draftView,
        docKey: "p-1002",
        kind: "existing",
        pageId: "1002",
        title: "결제 내역 같이 고친 초안",
        baseTitle: "결제 내역 화면 기준",
        baseVersion: 2,
      };
    return draftView;
  },
  docRead: async (pageId) => {
    calls.push(`api.docRead:${pageId}`);
    onceFail("docRead", CASE === "read-failed");
    await pauseRace();
    return {
      markdown: "공식본문 확인문장: Confluence 원본",
      sections: [{ heading: "검색", macro: false }],
      comments: null,
      view: previewBlocks,
    };
  },
  docList: async () => {
    calls.push("api.docList");
    onceFail("docList", CASE === "pick-failed");
    return { docs };
  },
  mapWrite: async (changes) => {
    calls.push(`api.mapWrite:${JSON.stringify(changes)}`);
    for (const change of changes) {
      if (change.op === "add") {
        if (
          !memoryLinks.some((link) => link.pageId === change.pageId && link.route === change.route)
        ) {
          memoryLinks = [
            ...memoryLinks,
            {
              pageId: change.pageId,
              route: change.route,
              section: change.section ?? null,
              note: change.note ?? null,
              createdAt: NOW,
            },
          ];
        }
      } else {
        memoryLinks = memoryLinks.filter(
          (link) => !(link.pageId === change.pageId && link.route === change.route),
        );
      }
    }
    return memoryLinks;
  },
  draftSnapshot: async (input) => {
    calls.push(`api.draftSnapshot:${JSON.stringify(input)}`);
    onceFail("draftSnapshot", CASE === "send-failed");
    await pauseRace();
    return {
      attachment: {
        name: "회원 목록 개선 초안.md",
        mediaType: "text/markdown",
        data: toBase64("최신초안 확인문장: 첨부에 담길 초안"),
      },
      ref: {
        title: "회원 목록 개선 초안",
        pageId: null,
        docKey: draftView.docKey,
        url: null,
        version: null,
        revision: 4,
        published: false,
        sections: [],
      },
    };
  },
  draftCompare: async () => ({
    docKey: "p-1001",
    pageId: "1001",
    title: "회원 목록 화면 기준",
    source: "견본",
    rows: [],
    note: null,
  }),
  draftCompareDecline: async () => ({ ok: true }),
};
Object.assign(daemon, { api, onDraftEvent });

const nav: ShellNav = {
  openThread: (...args) => calls.push(`nav.openThread:${args.join(":")}`),
  newThread: (...args) => calls.push(`nav.newThread:${args.join(":")}`),
  showThread: () => calls.push("nav.showThread"),
  showScreen: () => calls.push("nav.showScreen"),
  openPlans: () => calls.push("nav.openPlans"),
  showPane: (pane) => calls.push(`nav.showPane:${pane}`),
  setPlanDraft: (open) => calls.push(`nav.setPlanDraft:${open}`),
  openProjectScreen: (slug) => calls.push(`nav.openProjectScreen:${slug}`),
  switchProject: async () => true,
  showTab: (tab) => calls.push(`nav.showTab:${tab}`),
  showRightTab: (tab) => calls.push(`nav.showRightTab:${tab}`),
  openSettings: () => calls.push("nav.openSettings"),
  toast: (message) => calls.push(`toast:${message}`),
  setDiscardableInvitePath: (path) => calls.push(`nav.invite:${path}`),
};

function Fixture() {
  const [sessionId, setSessionId] = useState("session-fixture-a");
  const [route, setRoute] = useState<string | null>("/members");
  const [activeSlug, setActiveSlug] = useState("colonova-cdp");
  const [revision, setRevision] = useState(0);
  const [mountKey, setMountKey] = useState(0);
  const activeDaemon = useMemo(() => ({ ...daemon, activeSlug }), [activeSlug]);
  const editOpenDraft = () => {
    const nextRevision = draftView.revision + 1;
    draftView = {
      ...draftView,
      revision: nextRevision,
      updatedAt: new Date().toISOString(),
      blocks: draftView.blocks.map((block) =>
        block.id === "p1"
          ? {
              ...block,
              view: {
                kind: "paragraph",
                text: "최신초안 확인문장: 방송 뒤 갱신된 초안 본문입니다.",
              } as const,
            }
          : block,
      ),
    };
    const message: DraftChangedMessage = {
      type: "draft.changed",
      docKey: draftView.docKey,
      revision: nextRevision,
      state: draftView.state,
    };
    calls.push(`event.emit:${message.docKey}:${message.revision}`);
    for (const listener of draftListeners) listener(message);
  };
  useEffect(() => {
    if (CASE === "no-composer") return;
    const onAttach = (event: Event) => {
      event.preventDefault();
      const detail = (event as CustomEvent<unknown>).detail;
      calls.push(`attach:${JSON.stringify(detail)}`);
    };
    window.addEventListener(COMPOSER_ATTACH_EVENT, onAttach);
    return () => window.removeEventListener(COMPOSER_ATTACH_EVENT, onAttach);
  }, []);

  return (
    <div
      className="nx nx-chat"
      style={{
        display: "flex",
        flexDirection: "column",
        width: `min(${WIDTH}px, 100vw)`,
        minWidth: 0,
        height: "100vh",
        margin: "0 auto",
        overflow: "auto",
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          padding: 8,
          background: "var(--nx-surface, #fff)",
        }}
      >
        <strong>
          case={CASE} · w={WIDTH}
        </strong>
        <button
          type="button"
          className="nx-btn nx-btn--sm"
          onClick={() => setRevision((n) => n + 1)}
        >
          목록 다시 읽기
        </button>
        <button
          type="button"
          className="nx-btn nx-btn--sm"
          onClick={() => setMountKey((n) => n + 1)}
        >
          견본 다시 열기
        </button>
        <button type="button" className="nx-btn nx-btn--sm" onClick={editOpenDraft}>
          열린 초안 고치기
        </button>
        {CASE === "race" && (
          <>
            <button
              type="button"
              className="nx-btn nx-btn--sm"
              onClick={() => setSessionId("session-fixture-b")}
            >
              다른 대화로
            </button>
            <button
              type="button"
              className="nx-btn nx-btn--sm"
              onClick={() => setRoute("/billing")}
            >
              다른 화면으로
            </button>
            <button
              type="button"
              className="nx-btn nx-btn--sm"
              onClick={() => setActiveSlug("shop-admin")}
            >
              다른 프로젝트로
            </button>
          </>
        )}
      </div>
      <PlanTab
        key={mountKey}
        daemon={activeDaemon}
        nav={nav}
        screenRoute={route}
        sessionId={sessionId}
        sentCount={revision}
        tabpanelId="plan-tab-fixture"
        tabpanelLabel="기획서 탭 견본"
      />
      <details style={{ padding: 12 }}>
        <summary>견본 진단</summary>
        <p>API 호출·토스트·첨부는 window.__calls, 미처리 거부는 window.__errors에서 확인합니다.</p>
        <button
          type="button"
          className="nx-btn nx-btn--sm"
          onClick={() => {
            calls.length = 0;
            errors.length = 0;
          }}
        >
          진단 기록 비우기
        </button>
        <pre>{JSON.stringify({ calls, errors }, null, 2)}</pre>
      </details>
    </div>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Fixture root element is missing.");
createRoot(rootElement).render(<Fixture />);

// TS가 전역 진단 표면을 명시적으로 이해하게 한다.
void (window as FixtureWindow).__calls;
