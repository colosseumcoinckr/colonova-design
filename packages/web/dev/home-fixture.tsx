/**
 * 홈 견본 — 데몬 없이 `HomeView`(인사 · 큰 입력창 · 시작점 · 받은 편지함)를 여러 상태로 눈으로
 * 보는 페이지. 앱과 같은 CSS(테마 · styles.css · next.css→home.css)를 올린다. `vite build` 의
 * 입력은 index.html 뿐이라 제품에 실리지 않고, tsconfig 가 dev/ 를 보지 않는다.
 *
 *   ./node_modules/.bin/vite --port 29181 --strictPort --host 127.0.0.1   (packages/web 에서)
 *   → http://127.0.0.1:29181/dev/home-fixture.html
 *
 * 주소 끝의 `?theme=dark` 처럼 테마를, `?case=a,c` 로 보일 상태만을, `?w=420` 으로 틀의 폭을
 * (900 이하면 좁은 창 모양), `?h=900` 으로 높이를 고른다. 새 상태는 여기에 더한다(새 페이지를
 * 만들지 않는다).
 */

import type { ProjectSummary, ThreadSummary } from "@colonova-design/protocol";
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ChipTarget, Sessions } from "../src/hooks/useSessions";
import type { Daemon } from "../src/lib/daemon-client";
import { applyStoredTheme, applyStoredTypeScale } from "../src/lib/settings";
import { HomeView } from "../src/next/home/HomeView";
import type { ShellNav } from "../src/next/slots";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "../src/styles.css";
import "../src/next/next.css";

applyStoredTheme();
applyStoredTypeScale();
const query = new URLSearchParams(location.search);
const theme = query.get("theme");
if (theme) document.documentElement.dataset.theme = theme;
const FRAME_W = Number(query.get("w")) || 1100;
const FRAME_H = Number(query.get("h")) || 860;
const ONLY = query.get("case")?.split(",") ?? null;

const MIN = 60_000;
/** `min` 분 전. */
const ago = (min: number) => new Date(Date.now() - min * MIN).toISOString();
const agoMs = (min: number) => Date.now() - min * MIN;

interface Row {
  id: string;
  title: string;
  at: string;
  state?: ThreadSummary["state"];
}

const rowsOf = (rows: Row[]): ThreadSummary[] =>
  rows.map((row) => ({
    id: row.id,
    title: row.title,
    state: row.state ?? "idle",
    updatedAt: row.at,
  }));

const project = (
  slug: string,
  name: string,
  threads: ThreadSummary[] | undefined,
  more: Partial<ProjectSummary> = {},
): ProjectSummary =>
  ({
    slug,
    name,
    baseBranch: "main",
    phase: "ready",
    pendingChanges: 0,
    working: false,
    handoff: null,
    pendingCount: (threads ?? []).filter((thread) => thread.state === "awaiting").length,
    repoUrl: `https://github.com/example/${slug}`,
    ...(threads ? { threads } : {}),
    ...more,
  }) as ProjectSummary;

/** 스크린샷의 홈 — 이 컴퓨터에 쌓인 지난 대화들(모두 조용히 끝났다). */
const HISTORY: Row[] = [
  {
    id: "t1",
    title: "[최종 홈 검증] 파일·화면·설정 변경과 제출 없이 정확히 “최종 확인 완료”만 답해주세요.",
    at: ago(14),
  },
  { id: "t2", title: "QA 재검증 · 일반 A/B + 핀 C", at: ago(95) },
  { id: "t3", title: "이 화면에서 ‘입고 번호’ 검색칸은 어떻게 동작하나요?", at: ago(260) },
  { id: "t4", title: "로그인 화면 문구를 부드럽게 다듬어 줘", at: ago(60 * 26) },
  { id: "t5", title: "결제 내역 표를 월별로 묶어 줘", at: ago(60 * 24 * 4) },
  { id: "t6", title: "대시보드 카드 색을 브랜드 색으로 맞춰 줘", at: ago(60 * 24 * 9) },
];

/** 도구가 스스로 연 대화 — 사람의 대화가 아니다. */
const TOOLS: Row[] = [
  { id: "x1", title: "연결 준비", at: ago(60 * 24 * 12), state: "finished" },
  { id: "x2", title: "리뷰 반영", at: ago(40), state: "finished" },
];

const CLAUDE_UPDATED = {
  claude: { phase: "done", at: ago(62), version: "2.1.290" },
};

interface Case {
  id: string;
  label: string;
  projects: ProjectSummary[];
  activeSlug: string;
  author?: string | null;
  connection?: "open" | "connecting" | "closed";
  pending?: unknown[];
  views?: Record<string, unknown>;
  updates?: boolean;
  commands?: Record<string, string>;
  cycleScreens?: Array<{ route: string; title: string; note: string; at: string }>;
}

const view = (more: Record<string, unknown> = {}) => ({
  blocks: [],
  state: "idle",
  live: false,
  queue: [],
  dropped: [],
  tasks: [],
  suggestion: null,
  turnStartedAt: null,
  model: null,
  ...more,
});

/** 개발자에게 넘긴 요청 — `daysAgo` 일 전에 열렸다(null 이면 때를 모른다). */
const requestOpen = (
  daysAgo: number | null,
  state: "open" | "changes_requested" | "merged" = "open",
) => ({
  number: 12,
  url: "https://github.com/example/app/pull/12",
  title: "feat(members): 회원 목록 검색",
  state,
  branch: "colonova-design/20261001-1",
  reviewers: ["kim"],
  ...(daysAgo === null ? {} : { since: new Date(Date.now() - daysAgo * 86_400_000).toISOString() }),
});

const CASES: Case[] = [
  {
    id: "a",
    label: "a · 스크린샷 그대로 — 기다리는 일 없음 · 도는 일 없음 · 도구 업데이트 한 줄",
    projects: [project("colonova-cdp", "colonova-cdp", rowsOf(HISTORY))],
    activeSlug: "colonova-cdp",
    updates: true,
  },
  {
    id: "b",
    label:
      "b · 붐비는 홈 — 답을 기다려요(질문 · 허락 · 코멘트) · 도는 대화 · 답이 온 대화 · 다른 프로젝트의 소식",
    projects: [
      project(
        "colonova-cdp",
        "colonova-cdp",
        rowsOf([
          {
            id: "q1",
            title: "회원 목록에 이름으로 찾는 검색창을 넣어 줘",
            at: ago(3),
            state: "awaiting",
          },
          { id: "p1", title: "결제 내역 표를 월별로 묶어 줘", at: ago(8), state: "awaiting" },
          { id: "r1", title: "회원가입 완료 화면의 문구를 검토해 줘", at: ago(30) },
          {
            id: "w1",
            title: "대시보드 카드 색을 브랜드 색으로 맞춰 줘",
            at: ago(1),
            state: "running",
          },
          {
            id: "d1",
            title: "설정 화면의 알림 토글 간격이 좁아 보여요",
            at: ago(25),
            state: "finished",
          },
          { id: "d2", title: "주문 목록 필터 초기화 버튼", at: ago(60 * 5), state: "finished" },
          ...HISTORY.slice(2),
          ...TOOLS,
        ]),
      ),
      project(
        "marketing-site",
        "marketing-site",
        rowsOf([{ id: "k1", title: "배너 문구", at: ago(5), state: "awaiting" }]),
        { lastEventKind: "comments", lastEventAt: ago(12) },
      ),
      project("admin-console", "admin-console", [], { phase: "installing" }),
      project("billing-web", "billing-web", [], { working: true }),
      project("docs-portal", "docs-portal", [], {
        lastEventKind: "merged",
        lastEventAt: ago(60 * 3),
      }),
    ],
    activeSlug: "colonova-cdp",
    updates: true,
    commands: { check: "pnpm check" },
    pending: [
      {
        kind: "question",
        requestId: "rq1",
        sessionId: "q1",
        questions: [
          {
            question: "검색은 이름만 찾을까요, 전화번호도 함께 찾을까요?",
            header: "검색 범위",
            multiSelect: false,
            options: [
              { label: "이름만", description: "" },
              { label: "이름과 전화번호", description: "" },
            ],
          },
        ],
        requestedAt: agoMs(3),
      },
      {
        kind: "permission",
        requestId: "rp1",
        sessionId: "p1",
        toolName: "Bash",
        input: { command: "pnpm check" },
        suggestions: [],
        requestedAt: agoMs(8),
      },
    ],
    views: {
      r1: view({
        blocks: [{ type: "human", id: "h1", reviews: [] }],
      }),
      w1: view({
        state: "running",
        turnStartedAt: agoMs(1),
        tasks: [{ taskId: "k", type: "x", description: "카드 색을 브랜드 색으로 바꾸는 중" }],
      }),
    },
  },
  {
    id: "c",
    label: "c · 처음 — 대화가 하나도 없고 소식도 없다",
    projects: [project("colonova-cdp", "colonova-cdp", [])],
    activeSlug: "colonova-cdp",
  },
  {
    id: "d",
    label: "d · 연결이 끊겼다 — 보낼 수 없는 이유가 선다",
    projects: [project("colonova-cdp", "colonova-cdp", rowsOf(HISTORY))],
    activeSlug: "colonova-cdp",
    connection: "closed",
  },
  {
    id: "e",
    label: "e · 긴 글 — 긴 프로젝트 이름 · 긴 대화 제목 · 작성자 없음 · 프로젝트 여럿",
    projects: [
      project(
        "a-very-long-project-slug-for-the-home",
        "아주 아주 긴 프로젝트 이름의 관리자 콘솔 웹",
        rowsOf([
          {
            id: "l1",
            title: `${"A".repeat(60)} (띄어쓰기 없는 아주 긴 제목)`,
            at: ago(20),
            state: "finished",
          },
          {
            id: "l2",
            title:
              "회원 목록 화면에서 이름으로 찾는 검색창을 위쪽 오른편에 넣고, 결과가 없을 때 안내 문구와 초기화 버튼도 함께 보여 줘",
            at: ago(75),
          },
          ...HISTORY.slice(0, 2),
        ]),
      ),
      project("marketing-site", "marketing-site", []),
    ],
    activeSlug: "a-very-long-project-slug-for-the-home",
    author: null,
    updates: true,
  },
  {
    id: "f",
    label: "f · 이번 작업이 있다 — 고친 화면이 있고 대화는 조용하다",
    projects: [project("colonova-cdp", "colonova-cdp", rowsOf(HISTORY.slice(0, 3)))],
    activeSlug: "colonova-cdp",
    cycleScreens: [
      { route: "/members", title: "회원 목록", note: "검색창", at: ago(30) },
      { route: "/payments", title: "결제 내역", note: "월별", at: ago(95) },
    ],
  },
  {
    id: "g",
    label:
      "g · 개발자 확인을 기다리는 요청 — `지금 진행 중` 에 며칠째로 선다(오래 기다린 것이 먼저 · 때를 모르는 것은 맨 뒤 · 변경이 청해졌거나 반영된 요청은 안 선다) · 답을 기다려요 수에는 안 센다",
    projects: [
      project(
        "colonova-cdp",
        "colonova-cdp",
        rowsOf([
          {
            id: "w1",
            title: "대시보드 카드 색을 브랜드 색으로 맞춰 줘",
            at: ago(1),
            state: "running",
          },
          ...HISTORY.slice(0, 2),
        ]),
        { handoff: requestOpen(2) },
      ),
      project("billing-web", "billing-web", [], { handoff: requestOpen(0) }),
      project("marketing-site", "marketing-site", [], { handoff: requestOpen(7) }),
      project("admin-console", "admin-console", [], { handoff: requestOpen(null) }),
      project("docs-portal", "docs-portal", [], { handoff: requestOpen(9, "merged") }),
      project("legacy-app", "legacy-app", [], { handoff: requestOpen(4, "changes_requested") }),
    ],
    activeSlug: "colonova-cdp",
  },
  {
    id: "h",
    label: "h · 기다리는 요청 하나뿐 — 다른 일은 없어서 `지금 진행 중` 이 이 한 줄로만 선다",
    projects: [
      project("colonova-cdp", "colonova-cdp", rowsOf(HISTORY.slice(0, 3)), {
        handoff: requestOpen(1),
      }),
    ],
    activeSlug: "colonova-cdp",
  },
];

const CLAUDE_MODELS = [
  {
    value: "default",
    displayName: "Sonnet 5.5",
    resolvedModel: null,
    description: "",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high"],
    supportsFastMode: false,
  },
];

const chip: ChipTarget = {
  subject: "next",
  key: "next:claude",
  provider: "claude",
  model: "default",
  effort: "high",
  fastMode: false,
  fastModeBlocked: null,
  models: CLAUDE_MODELS as ChipTarget["models"],
  setModel: () => Promise.resolve(),
  setEffort: () => Promise.resolve(),
  setFast: (on) => Promise.resolve({ on, blocked: null, key: "next:claude" }),
  pickProvider: () => {},
};

function Frame({ spec }: { spec: Case }) {
  const [log, setLog] = useState("—");
  const [slug, setSlug] = useState(spec.activeSlug);

  const daemon = useMemo(
    () =>
      ({
        projects: spec.projects,
        activeSlug: slug,
        status: {
          authorName: spec.author === undefined ? "정인권" : spec.author,
          providers: [
            {
              id: "claude",
              label: "Claude",
              available: true,
              loggedIn: true,
              capabilities: { fastMode: false },
            },
          ],
          planUsageByProvider: {},
          ...(spec.updates ? { agentUpdates: CLAUDE_UPDATED } : {}),
        },
        pending: spec.pending ?? [],
        sessions: spec.views ?? {},
        hiddenThreads: {},
        repo: {
          phase: "ready",
          commands: spec.commands,
          cycleScreens: spec.cycleScreens,
        },
        connection: spec.connection ?? "open",
        resolvePending: (id: string) => setLog(`카드 거둠 ${id}`),
        api: {
          // 모델 칩의 팝이 열릴 때 부른다 — 없으면 칩이 오류로 죽어 홈 입력창이 통째로 사라진다.
          planRefresh: () => Promise.resolve(),
          respondQuestion: async (id: string, answers: unknown) => {
            setLog(`질문 답 ${id} ${JSON.stringify(answers)}`);
          },
          respondPermission: async (id: string, verdict: string) => {
            setLog(`허락 답 ${id} ${verdict}`);
          },
        },
      }) as unknown as Daemon,
    [spec, slug],
  );

  const sessions = {
    chipTarget: () => chip,
    refreshUsage: () => {},
    active: null,
    create: async () => "fixture-new",
    sendTurn: async (text: string, attachments: unknown[], id: string) => {
      setLog(`보냄 → ${id}: ${text} (첨부 ${attachments.length})`);
    },
  } as unknown as Sessions;

  const nav = {
    openThread: (_slug: string, id: string) => setLog(`열기 ${id}`),
    switchProject: (next: string) => {
      setSlug(next);
      setLog(`옮기기 ${next}`);
    },
    showThread: () => setLog("대화 보기로 넘어감"),
    toast: (text: string) => setLog(`토스트: ${text}`),
  } as unknown as ShellNav;

  const narrow = FRAME_W <= 900;
  return (
    <div id={`fixture-${spec.id}`} style={{ width: FRAME_W }}>
      <div
        style={{ font: "11.5px/1.45 monospace", color: "#888", margin: "0 0 4px", minHeight: 34 }}
      >
        {spec.label}
        <br />→ {log}
      </div>
      <div
        className={`nx${narrow ? " nx--narrow" : ""}`}
        style={{
          gridTemplateColumns: "minmax(0, 1fr)",
          height: FRAME_H,
          width: FRAME_W,
          overflow: "hidden",
          border: "1px dashed #8884",
        }}
      >
        <main className="nx-main">
          <div className="nx-view">
            <HomeView daemon={daemon} sessions={sessions} nav={nav} />
          </div>
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <div
      style={{
        background: "var(--bg)",
        minHeight: "100vh",
        padding: 20,
        display: "flex",
        gap: 24,
        alignItems: "flex-start",
        flexWrap: "wrap",
      }}
    >
      {CASES.filter((spec) => !ONLY || ONLY.includes(spec.id)).map((spec) => (
        <Frame key={spec.id} spec={spec} />
      ))}
    </div>
  </StrictMode>,
);
