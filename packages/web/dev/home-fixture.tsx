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
 *
 * `?case=journey[&pause=1]` 은 정지한 장면이 아니라 시간 흐름이다 — 진짜 `useShellNav` 를 올려 첫 준비 → `서비스가
 * 떴어요` 의 전이(토스트 · 홈 줄 · 첫 화면 사진 · 칩 이름)를 본다(2026-10-07 베타 준비 분석 · 첫 5분).
 */

import type { LandedWork, ProjectSummary, ThreadSummary } from "@colonova-design/protocol";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ChipTarget, Sessions } from "../src/hooks/useSessions";
import type { Daemon } from "../src/lib/daemon-client";
import { applyStoredTheme, applyStoredTypeScale } from "../src/lib/settings";
import { HomeView } from "../src/next/home/HomeView";
import { useShellNav } from "../src/next/lib/use-shell-nav";
import type { ShellNav } from "../src/next/slots";
import { Toast } from "../src/next/ui/Toast";
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

/**
 * 서비스의 첫 화면 사진 흉내(2026-10-07) — 숨은 창이 찍어 올 한 장을 캔버스로 그린다(회원 목록 같은 관리 화면: 머리글 ·
 * 사이드바 · 표). 드라이버가 없는 브라우저에서도 줄의 사진 자리를 눈으로 본다. base64 본문만 돌려준다.
 */
function fakeShot(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 750;
  const g = canvas.getContext("2d");
  if (!g) return "";
  g.fillStyle = "#f4f5f7";
  g.fillRect(0, 0, 1200, 750);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 1200, 64);
  g.fillStyle = "#3552d8";
  g.fillRect(28, 18, 28, 28);
  g.fillStyle = "#222";
  g.font = "600 20px system-ui";
  g.fillText("콜로노바 OMS", 68, 40);
  g.fillStyle = "#e6e8ee";
  g.fillRect(0, 64, 220, 686);
  for (let i = 0; i < 7; i += 1) {
    g.fillStyle = i === 1 ? "#3552d8" : "#9aa1b2";
    g.fillRect(28, 100 + i * 46, i === 1 ? 150 : 110 + ((i * 17) % 40), 14);
  }
  g.fillStyle = "#111";
  g.font = "700 28px system-ui";
  g.fillText("회원 목록", 260, 118);
  g.fillStyle = "#fff";
  g.fillRect(260, 150, 900, 520);
  for (let row = 0; row < 8; row += 1) {
    g.fillStyle = row % 2 === 0 ? "#fafbfc" : "#fff";
    g.fillRect(260, 196 + row * 56, 900, 56);
    g.fillStyle = "#c9cdd8";
    g.fillRect(284, 218 + row * 56, 120 + ((row * 31) % 60), 12);
    g.fillRect(560, 218 + row * 56, 200, 12);
    g.fillRect(900, 218 + row * 56, 90, 12);
  }
  g.fillStyle = "#e7ebfb";
  g.fillRect(260, 150, 900, 46);
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}

const lookOf = (mode: "ok" | "none" | "broken" | undefined) => async () => {
  await new Promise((resolve) => setTimeout(resolve, 700));
  if (mode === "none") return { route: "/", image: null };
  if (mode === "broken") {
    return { route: "/", image: { at: "", mediaType: "image/png", data: "bm90IGFuIGltYWdl" } };
  }
  return { route: "/", image: { at: "", mediaType: "image/png", data: fakeShot() } };
};

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
  /** 활성 프로젝트의 준비 단계 — 처음 켜는 중 장면(i)이 쓴다. 비우면 ready. */
  repoPhase?: string;
  /** 데몬이 준비가 끝나며 읽은 서비스의 첫 화면(2026-10-07) — 시작 칩이 그 이름으로 선다. */
  firstScreen?: { path: string; title: string };
  /** 서비스가 떴는데 아직 그 화면을 보지 않은 프로젝트(2026-10-07) — `서비스가 떴어요` 줄이 선다. */
  ready?: string[];
  /** 첫 화면 사진 — `ok` 는 그럴듯한 한 장이 오고, `none` 은 못 찍은 것(`image: null`), `broken` 은 풀리지 않는 그림이 온다. 비우면 `ok`. */
  look?: "ok" | "none" | "broken";
  /** 활성 프로젝트의 반영된 일(2026-10-08 · A2b) — 데몬이 `RepoStatus.landed` 로 싣는 최근 것부터의 목록. */
  landed?: LandedWork[];
  /** 활성 프로젝트 상태(`daemon.repo`)에 얹을 것 — 승인 · 자동 검사의 신호(`handoff.approved` · `handoff.ci`)와 주의(`attention`). */
  repoExtra?: Record<string, unknown>;
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

/** 반영된 일 한 줄 — `daysAgo` 일 전에 병합됐다(소수 가능). */
const landedAgo = (pr: number, daysAgo: number, more: Partial<LandedWork> = {}): LandedWork => ({
  at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  pr,
  ...more,
});

const LANDED_FIVE: LandedWork[] = [
  landedAgo(31, 0.03, { title: "회원 목록에 이름으로 찾는 검색창", days: 3, screens: 2 }),
  landedAgo(29, 2, { title: "결제 내역 표를 월별로 묶기", days: 0, screens: 1 }),
  landedAgo(27, 6, { days: 1, screens: 3 }),
  landedAgo(24, 15, { title: "로그인 화면 문구 다듬기", days: 5 }),
  landedAgo(20, 40, { title: "대시보드 카드 색을 브랜드 색으로 맞추기" }),
];

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
  {
    id: "i",
    label:
      "i · 처음 켜는 중(2026-10-07) — 첫 프로젝트는 늘 활성이다: `지금 진행 중` 의 준비 줄을 누르면 작업 화면의 준비 진행으로 간다(로그 확인). 다른 프로젝트의 준비 줄은 그 프로젝트로 옮긴다",
    projects: [
      project("colonova-cdp", "회원 관리", [], { phase: "installing", firstPrep: true }),
      project("admin-console", "admin-console", [], { phase: "cloning", firstPrep: true }),
    ],
    activeSlug: "colonova-cdp",
    repoPhase: "installing",
  },
  {
    id: "j",
    label:
      "j · 서비스가 떴어요(2026-10-07) — 첫 준비가 끝났다: 입력창 아래에 `화면 보기` 줄이 서고, 시작 칩은 서비스의 첫 화면 이름으로 선다(칩 위에 손을 올리면 초안이 보인다)",
    projects: [project("colonova-cdp", "회원 관리", [])],
    activeSlug: "colonova-cdp",
    ready: ["colonova-cdp"],
    firstScreen: { path: "/", title: "회원 목록 · 콜로노바 OMS" },
    look: "ok",
  },
  {
    id: "k",
    label:
      "k · 첫 화면 제목이 개발 흔적이다(Vite + React + TS) — 칩은 어느 서비스에나 맞는 일반 문장 그대로 선다(퇴보 없음) · 긴 프로젝트 이름의 완료 줄",
    projects: [
      project(
        "a-very-long-project-slug-for-the-home",
        "아주 아주 긴 프로젝트 이름의 관리자 콘솔 웹 서비스",
        [],
      ),
    ],
    activeSlug: "a-very-long-project-slug-for-the-home",
    ready: ["a-very-long-project-slug-for-the-home"],
    firstScreen: { path: "/", title: "Vite + React + TS" },
    look: "none",
  },
  {
    id: "l",
    label:
      "l · 첫 화면 사진이 풀리지 않는 그림으로 온다(2026-10-07) — 깨진 그림을 세우지 않고 사진 없는 줄로 남는다",
    projects: [project("colonova-cdp", "회원 관리", [])],
    activeSlug: "colonova-cdp",
    ready: ["colonova-cdp"],
    firstScreen: { path: "/", title: "회원 목록 · 콜로노바 OMS" },
    look: "broken",
  },
  {
    id: "m",
    label:
      "m · 반영된 일 다섯 건(2026-10-08 · A2b) — 접히는 묶음 · 최신순 · 제목 없는 줄(`제출한 일`) · 같은 날(`제출한 날 안에`) · 화면 수를 모르는 줄 · 며칠도 모르는 줄은 부제가 없다",
    projects: [project("colonova-cdp", "colonova-cdp", rowsOf(HISTORY.slice(0, 3)))],
    activeSlug: "colonova-cdp",
    landed: LANDED_FIVE,
  },
  {
    id: "t",
    label:
      "t · 반영된 일이 많다 — 열한 건이 있어도 여덟만 서고(데몬은 스무 건을 기억한다) · 아주 긴 제목은 한 줄로 말줄임으로 닫힌다",
    projects: [project("colonova-cdp", "colonova-cdp", rowsOf(HISTORY.slice(0, 2)))],
    activeSlug: "colonova-cdp",
    landed: [
      landedAgo(60, 0.5, {
        title:
          "결제 내역 화면의 필터 · 정렬 · 기간 선택 · 엑셀 내려받기 · 빈 화면 안내 문구를 한꺼번에 손본 아주 긴 제목의 일",
        days: 12,
        screens: 4,
      }),
      ...Array.from({ length: 10 }, (_, index) =>
        landedAgo(50 - index, 1 + index * 2, {
          title: `반영된 일 ${index + 2}`,
          days: index % 4,
          screens: 1 + (index % 3),
        }),
      ),
    ],
  },
  {
    id: "n",
    label:
      "n · 활성 프로젝트의 개발자 소식(2026-10-08) — 지금 보는 프로젝트의 반려가 `방금 있던 일` 에 다른 프로젝트의 소식과 최근순으로 선다(눌러도 옮기지 않고 작업 보기로 간다)",
    projects: [
      project("colonova-cdp", "colonova-cdp", rowsOf(HISTORY.slice(0, 3)), {
        lastEventKind: "closed",
        lastEventAt: ago(20),
      }),
      project("docs-portal", "docs-portal", [], {
        lastEventKind: "merged",
        lastEventAt: ago(60 * 3),
      }),
    ],
    activeSlug: "colonova-cdp",
  },
  {
    id: "o",
    label:
      "o · 활성 프로젝트가 방금 병합됐다 — 병합 소식은 `반영된 일` 이 대신 말한다: `방금 있던 일` 에 소식 줄이 없고 묶음 맨 위에 새 줄만 선다",
    projects: [
      project("colonova-cdp", "colonova-cdp", rowsOf(HISTORY.slice(0, 3)), {
        lastEventKind: "merged",
        lastEventAt: ago(2),
      }),
    ],
    activeSlug: "colonova-cdp",
    landed: LANDED_FIVE.slice(0, 2),
  },
  {
    id: "p",
    label:
      "p · 병합 소식이 있는데 `반영된 일` 이 비어 있다(기억을 아직 못 읽은 상태) — 소식을 잃지 않게 소식 줄이 대신 선다",
    projects: [
      project("colonova-cdp", "colonova-cdp", rowsOf(HISTORY.slice(0, 3)), {
        lastEventKind: "merged",
        lastEventAt: ago(2),
      }),
    ],
    activeSlug: "colonova-cdp",
  },
  {
    id: "q",
    label:
      "q · 개발자가 확인했다(승인) — 기다리는 줄의 부제가 `개발자가 확인했어요 — 반영을 기다려요`. 비활성 프로젝트(billing-web)는 신호가 없어 기본 문장 그대로",
    projects: [
      project("colonova-cdp", "colonova-cdp", rowsOf(HISTORY.slice(0, 3)), {
        handoff: requestOpen(2),
      }),
      project("billing-web", "billing-web", [], { handoff: requestOpen(1) }),
    ],
    activeSlug: "colonova-cdp",
    repoExtra: { handoff: { ...requestOpen(2), approved: true } },
  },
  {
    id: "r",
    label:
      "r · 자동 검사가 통과하지 못했고 AI 가 고치는 중 — 부제가 `자동 검사가 통과하지 못해 AI가 고치고 있어요`",
    projects: [
      project("colonova-cdp", "colonova-cdp", rowsOf(HISTORY.slice(0, 3)), {
        handoff: requestOpen(1),
      }),
    ],
    activeSlug: "colonova-cdp",
    repoExtra: {
      handoff: { ...requestOpen(1), ci: { state: "failing", failing: 2 } },
      attention: { kind: "ai-fixing", since: ago(5), key: "ci" },
    },
  },
  {
    id: "s",
    label:
      "s · 자동 검사가 계속 통과하지 못해 개발자에게 알렸다(알림 키 ci:<번호>:rounds) — 부제가 `자동 검사가 계속 통과하지 못해 개발자에게 알렸어요`",
    projects: [
      project("colonova-cdp", "colonova-cdp", rowsOf(HISTORY.slice(0, 3)), {
        handoff: requestOpen(3),
      }),
    ],
    activeSlug: "colonova-cdp",
    repoExtra: {
      handoff: { ...requestOpen(3), ci: { state: "failing", failing: 1 } },
      attention: { kind: "developer-notified", since: ago(30), via: "pr", key: "ci:12:rounds" },
    },
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
  const [ready, setReady] = useState(spec.ready ?? []);

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
          phase: spec.repoPhase ?? "ready",
          commands: spec.commands,
          cycleScreens: spec.cycleScreens,
          ...(spec.firstScreen ? { firstScreen: spec.firstScreen } : {}),
          ...(spec.landed ? { landed: spec.landed } : {}),
          ...(spec.repoExtra ?? {}),
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
          firstLook: lookOf(spec.look),
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
    showScreen: () => setLog("작업 화면(미리보기 · 준비 진행)으로 넘어감"),
    openProjectScreen: (next: string) => {
      setReady((list) => list.filter((entry) => entry !== next));
      setLog(`서비스 화면으로 넘어감 ${next}`);
    },
    dismissReady: (next: string) => {
      setReady((list) => list.filter((entry) => entry !== next));
      setLog(`줄 닫음 ${next}`);
    },
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
            <HomeView daemon={daemon} sessions={sessions} nav={nav} ready={ready} />
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * 시간 흐름 장면(`?case=journey`) — 진짜 `useShellNav` 를 올려 첫 준비 → 서비스가 떴어요의 전이를 본다(2026-10-07 베타
 * 준비 분석 · 첫 5분). 데몬 대신 이 장면이 `projects` 를 단계마다 바꿔 먹이고, 홈 · 토스트 · 작업 화면 자리표시가 셸의
 * 판정(`ready-watch.ts`)과 이동(`nav.ts`)을 그대로 따른다. `?pause=1` 이면 자동으로 넘기지 않고
 * `window.__readyJourney.set(i)` 로 한 걸음씩 — 눌러 보는 장면(토스트의 `화면 보기` · 홈 줄)은 이쪽이 낫다.
 */
const JOURNEY_STEPS: Array<{
  label: string;
  a: Partial<ProjectSummary>;
  b?: Partial<ProjectSummary>;
  repo: string;
  first?: { path: string; title: string };
}> = [
  {
    label: "0 · 설치하는 중 — 홈에 `처음 켜는 준비` 줄",
    a: { phase: "installing", firstPrep: true },
    repo: "installing",
  },
  { label: "1 · 미리보기 켜는 중", a: { phase: "starting", firstPrep: true }, repo: "starting" },
  {
    label: "2 · ready — 토스트(화면 보기) + 홈의 `서비스가 떴어요` 줄",
    a: { phase: "ready" },
    repo: "ready",
  },
  {
    label: "3 · 서비스의 첫 화면 이름이 도착 — 시작 칩이 그 이름으로 선다",
    a: { phase: "ready" },
    repo: "ready",
    first: { path: "/", title: "회원 목록 · 콜로노바 OMS" },
  },
  {
    label: "4 · 다른 프로젝트(admin-console)가 처음 켜는 중",
    a: { phase: "ready" },
    b: { phase: "installing", firstPrep: true },
    repo: "ready",
  },
  {
    label: "5 · 다른 프로젝트가 떴다 — 토스트와 홈 줄이 그 프로젝트의 이름으로",
    a: { phase: "ready" },
    b: { phase: "ready" },
    repo: "ready",
  },
];

function Journey() {
  const paused = query.get("pause") === "1";
  const [step, setStep] = useState(0);
  const [active, setActive] = useState("colonova-cdp");
  useEffect(() => {
    (window as unknown as { __readyJourney: unknown }).__readyJourney = { set: setStep };
  }, []);
  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(
      () => setStep((at) => Math.min(at + 1, JOURNEY_STEPS.length - 1)),
      2600,
    );
    return () => window.clearInterval(timer);
  }, [paused]);

  const spec = JOURNEY_STEPS[step] ?? JOURNEY_STEPS[0];
  const projects = useMemo(
    () => [
      project("colonova-cdp", "회원 관리", [], spec?.a ?? {}),
      project("admin-console", "관리자 콘솔", [], spec?.b ?? { phase: "ready" }),
    ],
    [spec],
  );
  const daemon = useMemo(
    () =>
      ({
        projects,
        activeSlug: active,
        status: {
          authorName: "정인권",
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
        },
        pending: [],
        sessions: {},
        hiddenThreads: {},
        repo: {
          phase: spec?.repo ?? "ready",
          ...(spec?.first ? { firstScreen: spec.first } : {}),
        },
        connection: "open",
        resolvePending: () => {},
        api: {
          planRefresh: () => Promise.resolve(),
          projectActivate: async (slug: string) => {
            setActive(slug);
          },
          firstLook: lookOf("ok"),
        },
      }) as unknown as Daemon,
    [projects, active, spec],
  );
  const sessions = {
    chipTarget: () => chip,
    refreshUsage: () => {},
    active: null,
    list: [],
    create: async () => "fixture-new",
    sendTurn: async () => {},
    open: async () => {},
    resume: async () => {},
    fresh: () => {},
  } as unknown as Sessions;

  const narrow = FRAME_W <= 900;
  const { state, nav, ready, toast, dismissToast } = useShellNav({
    daemon,
    sessions,
    collapsed: false,
    narrow,
    onLayoutChange: () => {},
    onOpenSettings: () => {},
  });

  return (
    <div style={{ width: FRAME_W }}>
      <div
        style={{ font: "11.5px/1.5 monospace", color: "#888", margin: "0 0 4px", minHeight: 52 }}
      >
        {spec?.label}
        <br />→ 보는 곳 {state.view}
        {state.view === "thread" ? `(탭 ${state.tab})` : ""} · 활성 {active} · 떴어요 줄 [
        {ready.join(", ")}]
        <br />
        <button type="button" onClick={() => nav.goHome()}>
          홈
        </button>{" "}
        <button type="button" onClick={() => nav.showScreen()}>
          작업 화면
        </button>{" "}
        <button type="button" onClick={() => nav.showTab("chat")}>
          대화 탭
        </button>
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
          {state.view === "home" ? (
            <div className="nx-view">
              <HomeView daemon={daemon} sessions={sessions} nav={nav} ready={ready} />
            </div>
          ) : (
            <div
              className="nx-view"
              style={{ display: "grid", placeItems: "center", color: "var(--ink3)" }}
              data-testid="work-placeholder"
            >
              작업 화면 자리표시 — {active} · 미리보기 쪽
              {state.tab === "preview" ? "(화면 탭)" : ""}
            </div>
          )}
        </main>
        <Toast toast={toast} onDone={dismissToast} />
      </div>
    </div>
  );
}

const JOURNEY = query.get("case") === "journey";

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
      {JOURNEY ? (
        <Journey />
      ) : (
        CASES.filter((spec) => !ONLY || ONLY.includes(spec.id)).map((spec) => (
          <Frame key={spec.id} spec={spec} />
        ))
      )}
    </div>
  </StrictMode>,
);
