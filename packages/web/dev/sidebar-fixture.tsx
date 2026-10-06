/**
 * 사이드바 견본 — 데몬 없이 `Sidebar`(전환기 · 다른 프로젝트 · 대화 목록 · 바닥)를 여러 상태로
 * 눈으로 보는 페이지. 앱과 같은 CSS(테마 · styles.css · next.css→sidebar.css)를 올린다.
 * `vite build` 의 입력은 index.html 뿐이라 제품에 실리지 않고, tsconfig 가 dev/ 를 보지 않는다.
 *
 *   ./node_modules/.bin/vite --port 29181 --strictPort --host 127.0.0.1   (packages/web 에서)
 *   → http://127.0.0.1:29181/dev/sidebar-fixture.html
 *
 * 주소 끝의 `?theme=dark` 처럼 테마를, `?case=a,c` 로 보일 상태만을, `?h=720` 으로 틀의 높이를,
 * `?w=320` 으로 사이드바 폭을, `?active=m16` 으로 처음 켜 둘 대화를, `?switch=slow|reject` 로 프로젝트를 옮기는 데
 * 1.2초가 걸리거나 실패하는 경우를 고른다. 상태는 눌러 볼 수 있다 — 대화를 누르면 켜지고, 프로젝트를
 * 옮기면 그 프로젝트의 줄이 선다. 새 상태는 여기에 더한다(새 페이지를 만들지 않는다).
 */

import type { ProjectSummary, ThreadSummary } from "@colonova-design/protocol";
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Splitter } from "../src/components/shell/Splitter";
import type { Sessions } from "../src/hooks/useSessions";
import type { Daemon } from "../src/lib/daemon-client";
import { applyStoredTheme, applyStoredTypeScale } from "../src/lib/settings";
import { L } from "../src/next/labels";
import { useSidebarWidth } from "../src/next/lib/use-sidebar-width";
import { Sidebar } from "../src/next/sidebar/Sidebar";
import type { ShellNav } from "../src/next/slots";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "../src/styles.css";
import "../src/next/next.css";

applyStoredTheme();
applyStoredTypeScale();
const query = new URLSearchParams(location.search);
const theme = query.get("theme");
if (theme) document.documentElement.dataset.theme = theme;
const FRAME_H = Number(query.get("h")) || 760;
const SIDE_W = Number(query.get("w")) || 0;
const ONLY = query.get("case")?.split(",") ?? null;
const ACTIVE = query.get("active");

const MIN = 60_000;
const startOfToday = new Date();
startOfToday.setHours(0, 0, 0, 0);
/** `min` 분 전. */
const ago = (min: number) => new Date(Date.now() - min * MIN).toISOString();
/** `days` 일 전 `hour` 시 — 날짜 묶음(오늘 · 어제 · 지난 7일 · 이전)을 지나는 시각을 만든다. */
const dayAt = (days: number, hour: number) =>
  new Date(startOfToday.getTime() - days * 24 * 60 * MIN + hour * 60 * MIN).toISOString();

const PREVIEW = "http://127.0.0.1:5274/";

interface Row {
  id: string;
  title: string;
  at: string;
  state?: ThreadSummary["state"];
  /** 대화가 말한 화면들 — 둘째 줄에 서는 화면 이름. */
  screens?: string[];
  /** 대화 기록이 끝난 모양 — `error` 면 줄에 빨간 점이 선다. */
  view?: "error";
}

const rowsOf = (rows: Row[]): ThreadSummary[] =>
  rows.map((row) => ({
    id: row.id,
    title: row.title,
    state: row.state ?? "idle",
    updatedAt: row.at,
  }));

const LONG_A =
  "[최종 홈 검증] 파일·화면·설정 변경과 제출 없이 정확히 “최종 확인 완료”만 답해주세요.";
const LONG_B =
  "[구현 검증 A] 파일·화면·설정 변경과 제출 없이 정확히 “구현 검증 완료”만 답해주세요.";

/** 스크린샷 그대로의 여섯 줄 — 모두 오늘 안이라 날짜 묶음이 하나다. */
const SCREENSHOT: Row[] = [
  { id: "t1", title: LONG_A, at: ago(14) },
  { id: "t2", title: LONG_B, at: ago(55) },
  { id: "t3", title: "QA 재검증 · 일반 A/B + 핀 C", at: ago(95) },
  {
    id: "t4",
    title: "QA 점검입니다. 파일·화면·설정을 변경하거나 제출하지 말고 읽기만 해 주세요.",
    at: ago(130),
  },
  { id: "t5", title: "화면이나 코드는 수정하지 말고 답변만 해주세요", at: ago(190) },
  { id: "t6", title: "이 화면에서 ‘입고 번호’ 검색칸은 어떻게 동작하나요?", at: ago(260) },
];

/** 여러 날에 걸친 열여섯 줄 — 도는 것 · 기다리는 것 · 실패 · 화면이 있는 줄이 섞여 있다. */
const MANY: Row[] = [
  {
    id: "m1",
    title: "회원 목록에 이름으로 찾는 검색창을 넣어 줘",
    at: ago(2),
    state: "running",
    screens: ["회원 목록"],
  },
  {
    id: "m2",
    title: "결제 내역 표를 월별로 묶어 줘",
    at: ago(25),
    state: "awaiting",
    screens: ["결제 내역", "월별 합계"],
  },
  { id: "m3", title: "로그인 화면 문구를 부드럽게 다듬어 줘", at: ago(62), view: "error" },
  { id: "m4", title: LONG_A, at: ago(170), screens: ["회원 상세"] },
  { id: "m5", title: "QA 재검증 · 일반 A/B + 핀 C", at: dayAt(1, 18) },
  { id: "m6", title: LONG_B, at: dayAt(1, 11), screens: ["회원 목록 · 이름 검색"] },
  { id: "m7", title: "이 화면에서 ‘입고 번호’ 검색칸은 어떻게 동작하나요?", at: dayAt(3, 15) },
  { id: "m8", title: "대시보드 카드 색을 브랜드 색으로 맞춰 줘", at: dayAt(5, 10) },
  { id: "m9", title: "설정 화면의 알림 토글 간격이 좁아 보여요", at: dayAt(6, 17) },
  { id: "m10", title: `${"A".repeat(48)} (띄어쓰기 없는 아주 긴 제목)`, at: dayAt(9, 13) },
  { id: "m11", title: "😀 이모지가 들어간 제목과 English mixed 제목 123", at: dayAt(14, 9) },
  { id: "m12", title: "주문 목록 필터 초기화 버튼", at: dayAt(22, 16) },
  { id: "m13", title: "상품 상세의 이미지 슬라이더", at: dayAt(41, 12) },
  { id: "m14", title: "모바일 헤더 정리", at: dayAt(70, 14) },
  { id: "m15", title: "빈 상태 일러스트 교체", at: dayAt(110, 11) },
  { id: "m16", title: "처음 만든 화면", at: dayAt(200, 10) },
];

/** 도구가 스스로 연 대화 — `도구가 한 일` 묶음으로 간다(제목은 데몬의 고정 제목). */
const TOOLS: Row[] = [
  { id: "x1", title: "연결 준비", at: dayAt(2, 9) },
  { id: "x2", title: "리뷰 반영", at: dayAt(1, 9), view: "error" },
  { id: "x3", title: "제출 문제 해결", at: ago(300) },
];

const handoff = (state: "open" | "merged") => ({
  number: 7,
  url: "https://example.com/pull/7",
  title: "t",
  state,
  branch: "colonova-design/20261006-1",
  reviewers: ["dev1"],
});

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

interface Case {
  id: string;
  label: string;
  projects: ProjectSummary[];
  activeSlug: string;
  rows: Row[];
  /** 처음 켜진 대화 · 홈 보기. */
  activeId?: string | null;
  view?: "home" | "thread";
  author?: string | null;
  updateDot?: boolean;
  /** 좁은 창의 서랍 — 폭 284px. */
  drawer?: boolean;
  /** 서랍 뒤의 본문과 스크림까지 — 520px 틀 안에 `nx--narrow nx--drawer` 의 실제 배치를 그린다. */
  pane?: boolean;
  /** 사이드바 옆에 끌 수 있는 경계(Splitter)와 빈 본문을 함께 — 너비 조절을 눌러 본다. */
  shell?: boolean;
}

const CASES: Case[] = [
  {
    id: "a",
    label: "a · 스크린샷 그대로 — 프로젝트 하나 · 여섯 대화 · 켜진 줄 하나",
    projects: [project("colonova-cdp", "colonova-cdp", rowsOf(SCREENSHOT))],
    activeSlug: "colonova-cdp",
    rows: SCREENSHOT,
    activeId: "t1",
  },
  {
    id: "b",
    label: "b · 대화 열여섯 · 날짜 걸침 · 도는 것 · 기다리는 것 · 실패 · 화면 이름 · 도구가 한 일",
    projects: [project("colonova-cdp", "colonova-cdp", rowsOf([...MANY, ...TOOLS]))],
    activeSlug: "colonova-cdp",
    rows: [...MANY, ...TOOLS],
    activeId: "m4",
  },
  {
    id: "c",
    label: "c · 프로젝트 여럿 — 준비 중 · 답을 기다려요 · 아직 열지 않음 · 반영됨",
    projects: [
      // `?busy=1` — AI 가 도는 중이라 프로젝트를 뺄 수 없는 경우(확인 판에 이유가 단추 위에 선다).
      project("colonova-cdp", "colonova-cdp", rowsOf(SCREENSHOT), {
        handoff: handoff("open"),
        working: query.get("busy") === "1",
      }),
      project(
        "marketing-site",
        "marketing-site",
        rowsOf([
          { id: "k1", title: "배너 문구", at: ago(5), state: "awaiting" },
          { id: "k2", title: "푸터 링크", at: ago(9), state: "awaiting" },
        ]),
      ),
      project("admin-console", "admin-console", [], { phase: "cloning" }),
      project("docs-portal", "docs-portal", undefined, { phase: "missing" }),
      project("billing-web", "billing-web", [], { handoff: handoff("merged") }),
    ],
    activeSlug: "colonova-cdp",
    rows: SCREENSHOT,
    activeId: "t2",
  },
  {
    id: "j",
    label:
      "j · 프로젝트 일곱 — 다른 프로젝트는 급한 셋만 · `프로젝트 3개 더 보기` (?h=560 으로 낮은 창)",
    projects: [
      project("colonova-cdp", "colonova-cdp", rowsOf(SCREENSHOT)),
      project("quiet-one", "quiet-one", []),
      project("making-now", "making-now", [], { working: true }),
      project("quiet-two", "quiet-two", [], { handoff: handoff("open") }),
      project(
        "needs-you",
        "needs-you",
        rowsOf([{ id: "k1", title: "배너 문구", at: ago(5), state: "awaiting" }]),
      ),
      project("preparing", "preparing", [], { phase: "cloning" }),
      project("merged-one", "merged-one", [], { handoff: handoff("merged") }),
    ],
    activeSlug: "colonova-cdp",
    rows: SCREENSHOT,
    activeId: "t2",
  },
  {
    id: "d",
    label: "d · 빈 상태 — 대화가 하나도 없다",
    projects: [project("colonova-cdp", "colonova-cdp", [])],
    activeSlug: "colonova-cdp",
    rows: [],
  },
  {
    id: "e",
    label: "e · 도구의 대화만 남았다",
    projects: [project("colonova-cdp", "colonova-cdp", rowsOf(TOOLS))],
    activeSlug: "colonova-cdp",
    rows: TOOLS,
  },
  {
    id: "f",
    label: "f · 홈 보기 · 기다리는 일 · 긴 프로젝트 이름 · 작성자 없음 · 업데이트 점",
    projects: [
      project(
        "a-very-long-project-slug-for-the-sidebar",
        "아주 아주 긴 프로젝트 이름의 관리자 콘솔 웹",
        rowsOf(MANY.slice(0, 3)),
      ),
      project(
        "marketing-site",
        "marketing-site",
        rowsOf([{ id: "k1", title: "배너", at: ago(5), state: "awaiting" }]),
      ),
    ],
    activeSlug: "a-very-long-project-slug-for-the-sidebar",
    rows: MANY.slice(0, 3),
    view: "home",
    author: null,
    updateDot: true,
  },
  {
    id: "h",
    label: "h · 너비 조절 — 경계를 끌거나(←→ · Home · End · Enter) 두 번 눌러 본다",
    projects: [project("colonova-cdp", "colonova-cdp", rowsOf(MANY.slice(0, 9)))],
    activeSlug: "colonova-cdp",
    rows: MANY.slice(0, 9),
    activeId: "m4",
    shell: true,
  },
  {
    id: "i",
    label: "i · 좁은 창의 서랍 + 스크림 · 본문(inert) — 520px 틀",
    projects: [
      project("colonova-cdp", "colonova-cdp", rowsOf(MANY.slice(0, 9))),
      project("marketing-site", "marketing-site", [], { pendingCount: 2 }),
    ],
    activeSlug: "colonova-cdp",
    rows: MANY.slice(0, 9),
    activeId: "m4",
    drawer: true,
    pane: true,
  },
  {
    id: "g",
    label: "g · 좁은 창의 서랍 284px",
    projects: [project("colonova-cdp", "colonova-cdp", rowsOf(MANY.slice(0, 9)))],
    activeSlug: "colonova-cdp",
    rows: MANY.slice(0, 9),
    activeId: "m4",
    drawer: true,
  },
];

function Frame({ spec }: { spec: Case }) {
  const [activeId, setActiveId] = useState<string | null>(ACTIVE ?? spec.activeId ?? null);
  const [view, setView] = useState<"home" | "thread">(spec.view ?? "thread");
  const [slug, setSlug] = useState(spec.activeSlug);
  const [log, setLog] = useState("—");
  // 너비 조절(h) — 저장은 이 견본의 상태가 맡는다(앱에서는 설정의 layout.sidebarWidth).
  const [saved, setSaved] = useState<number | null>(SIDE_W || null);
  const side = useSidebarWidth(saved, (width) => {
    setSaved(width);
    setLog(`저장 ${width}`);
  });

  const daemon = useMemo(() => {
    const views: Record<string, unknown> = {};
    for (const row of spec.rows) {
      const screens = row.screens ?? [];
      views[row.id] = {
        blocks: screens.length
          ? [
              {
                type: "text",
                id: `${row.id}-b`,
                agentId: null,
                streaming: false,
                text: screens
                  .map((name, index) => `[${name}](${PREVIEW}screen-${index})`)
                  .join("\n"),
              },
            ]
          : [],
        state: row.view === "error" ? "error" : "idle",
        live: false,
        queue: [],
        dropped: [],
        tasks: [],
        suggestion: null,
        turnStartedAt: null,
        model: null,
      };
    }
    return {
      projects: spec.projects,
      activeSlug: slug,
      status: {
        authorName: spec.author === undefined ? "정인권" : spec.author,
        providers: spec.updateDot
          ? [{ id: "claude", available: true, version: "1.0.0", latestVersion: "1.2.0" }]
          : [],
      },
      hiddenThreads: {},
      sessions: views,
      repo: { phase: "ready", previewUrl: PREVIEW },
      connection: "closed",
      api: {
        history: async () => [],
        deleteSession: async () => {},
        projectUpdate: async () => {},
        projectRemove: async () => {},
      },
      hydrate: () => {},
      ensureSession: () => {},
      hideThread: (_slug: string, id: string) => setLog(`hide ${id}`),
      unhideThread: () => {},
    } as unknown as Daemon;
  }, [spec, slug]);

  const nav = {
    newThread: () => {
      setActiveId(null);
      setView("thread");
      setLog("새 대화");
    },
    goHome: () => {
      setView("home");
      setLog("홈");
    },
    openThread: (_slug: string, id: string) => {
      setActiveId(id);
      setView("thread");
      setLog(`열기 ${id}`);
    },
    switchProject: (next: string) => {
      const mode = query.get("switch");
      setLog(`옮기기 ${next}`);
      return new Promise<boolean>((resolve) =>
        window.setTimeout(
          () => {
            if (mode === "reject") {
              setLog(`토스트: ${L.toast.switchFailed}`);
              resolve(false);
              return;
            }
            setSlug(next);
            setView("home");
            resolve(true);
          },
          mode === "slow" || mode === "reject" ? 1200 : 0,
        ),
      );
    },
    openSettings: () => setLog("설정"),
    toast: (text: string) => setLog(`토스트: ${text}`),
    showThread: () => setView("thread"),
    showTab: () => {},
    setDiscardableInvitePath: () => {},
  } as unknown as ShellNav;

  const titles = new Map(spec.rows.map((row) => [row.id, row.title]));
  const width = spec.drawer ? 284 : spec.shell ? side.width : SIDE_W || 264;
  const sidebar = (
    <Sidebar
      daemon={daemon}
      sessions={{ fresh: () => setActiveId(null) } as unknown as Sessions}
      activeSessionId={activeId}
      view={view}
      titleFor={(thread) => titles.get(thread.id) ?? thread.title}
      nav={nav}
      onPalette={() => setLog("찾기")}
      onFeedback={() => setLog("기능 제안")}
      onCollapse={() => setLog(spec.drawer ? "서랍 닫기(✕)" : "접기")}
      drawer={spec.drawer}
      onRenameSession={(id, title) => setLog(`이름 바꾸기 ${id} → ${title}`)}
    />
  );
  const frameWidth = spec.shell ? 900 : spec.pane ? 520 : width + 2;
  return (
    <div id={`fixture-${spec.id}`} style={{ width: frameWidth }}>
      <div
        style={{ font: "11.5px/1.45 monospace", color: "#888", margin: "0 0 4px", minHeight: 34 }}
      >
        {spec.label}
        <br />→ {log}
      </div>
      <div
        className={`nx${spec.drawer ? " nx--narrow nx--drawer" : ""}${side.dragging ? " nx--resizing" : ""}`}
        style={{
          display: "grid",
          gridTemplateColumns: spec.shell ? undefined : "minmax(0, 1fr)",
          height: FRAME_H,
          width: frameWidth,
          overflow: "hidden",
          border: "1px dashed #8884",
          ...(spec.shell || (SIDE_W && !spec.drawer)
            ? ({ "--nx-side-w": `${spec.shell ? side.width : SIDE_W}px` } as object)
            : {}),
        }}
      >
        {sidebar}
        {spec.pane && (
          <>
            <button
              type="button"
              className="nx-scrim"
              aria-label={L.shell.closeMenu}
              onClick={() => setLog("스크림 · 서랍 닫기")}
            />
            {/* 서랍이 열려 있는 동안 뒷화면은 눌리지도 초점을 받지도 않는다(셸의 `inert`). */}
            <main
              className="nx-main"
              inert
              style={{ padding: 24, font: "12px monospace", color: "#888" }}
            >
              본문 자리 — 서랍 뒤의 화면
            </main>
          </>
        )}
        {spec.shell && (
          <>
            <Splitter
              side="left"
              width={side.width}
              bounds={side.bounds}
              label={L.shell.sidebarWidth}
              active={side.dragging}
              {...side.split}
            />
            <main
              className="nx-main"
              style={{ padding: 24, font: "12px monospace", color: "#888" }}
            >
              본문 자리 — 사이드바 {side.width}px (한도 {side.bounds.min}~{side.bounds.max})
            </main>
          </>
        )}
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
