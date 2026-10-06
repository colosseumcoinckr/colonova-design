/**
 * 상태 줄 견본 — 데몬 없이 `StatusLine`(대화 제목 · 여정 · 제출)을 여러 상태와 폭으로
 * 눈으로 보는 페이지. 앱과 같은 CSS(테마 · styles.css · next.css→status.css)를
 * 올린다. `vite build` 의 입력은 index.html 뿐이라 제품에 실리지 않고, tsconfig 가
 * dev/ 를 보지 않는다.
 *
 *   pnpm --filter @colonova-design/web exec vite --port 29187 --strictPort
 *   → http://127.0.0.1:29187/dev/status-fixture.html
 *
 * 주소 끝의 `?theme=dark` 처럼 테마를, `?w=1475` 로 넓은 벌의 폭을, `?name=…` 으로 프로젝트
 * 이름을, `?sweep=1` 로 같은 상태를 막대 폭 아홉 가지로 늘어놓는다.
 *
 * 팝을 열어 보려면(2026-10-06 겹판 손질 — 제출 확인 · 이번 작업) 한 상태만 그린다:
 *   `?case=b` 아래 BASE_CASES 의 id 하나(sweep 이면 `?case=a` 가 폭별 a 를 모두).
 *   `?submit=` 제출 확인에 가짜 데몬이 주는 답 — `ready`(기본) · `loading`(영영 읽는 중) · `fail`(읽기 실패) ·
 *     `changed`(읽는 동안 내용이 바뀜) · `sendfail`(보내기 실패) · `conflict`(보내는 순간 내용이 바뀜) ·
 *     `many`(화면 8개) · `outside`(화면 밖 변경만) · `empty`(제출할 변경 없음) · `more`(열린 요청에 더하는 제출 —
 *     화면 5개 중 둘은 앞서 제출한 것). 보내기가 성공하면 여정이 따라온다.
 *   `?draft=` 제출 확인의 「개발자에게는 이렇게 보여요」 — 가짜 데몬이 주는 요청 초안: `ready`(기본, 1.2초 뒤) ·
 *     `slow`(영영 읽는 중) · `empty`(AI 가 못 씀 → 첫 보관의 제목이 대신) · `fail`(읽기 실패 → 상자가 안 선다) ·
 *     `long`(긴 설명 → 세 줄에서 잘린다). `?submit=more` 는 이미 열린 요청의 제목이 선다.
 *   `?ledger=` `이번 작업` 의 장부 — `ready`(기본, 코멘트 둘) · `loading`(영영 읽는 중) · `failed`(읽기 실패) · `empty`.
 *     `hook-*` 는 진짜 장부 훅(`useWorkLedger`)을 돌린다 — `hook-slow`(영영 읽는 중) · `hook-fail`(늘 실패) ·
 *     `hook-failthen`(열고 4초 안에는 실패, 그 뒤 성공 — `다시 시도` 가 고치는 길) · `hook-ok`.
 * 화면의 `열기` 단추가 부른 길은 `window.__opened`(경로 목록)에 쌓인다. 상태 줄 아래에 문제 문장 줄(`ProblemLine`)이
 * 함께 선다 — `?case=g`(제출이 막힘 — 복사 단추) · `?case=p`(다시 로그인 — 로그인 단추).
 */

import type {
  DeveloperReview,
  ProjectSummary,
  RepoHistoryEntry,
  RepoStatus,
  SubmitPreview,
} from "@colonova-design/protocol";
import { StrictMode, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Sessions } from "../src/hooks/useSessions";
import type { Daemon } from "../src/lib/daemon-client";
import { registerScreenOpener } from "../src/lib/screen-link";
import { applyStoredTheme, applyStoredTypeScale } from "../src/lib/settings";
import { L } from "../src/next/labels";
import { deriveJourney } from "../src/next/lib/journey";
import { submitCopy } from "../src/next/lib/submit-copy";
import type { ShellNav } from "../src/next/slots";
import { ProblemLine } from "../src/next/status/ProblemLine";
import { StatusLine } from "../src/next/status/StatusLine";
import { useWorkLedger } from "../src/next/status/use-work-ledger";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "../src/styles.css";
import "../src/next/next.css";

applyStoredTheme();
applyStoredTypeScale();
const query = new URLSearchParams(location.search);
const theme = query.get("theme");
if (theme) document.documentElement.dataset.theme = theme;
const WIDE = Number(query.get("w")) || 1475;

const project = {
  name: query.get("name") ?? "colonova-cdp",
  slug: "colonova-cdp",
  reviewers: ["dev1"],
} as ProjectSummary;

const SUBMIT = query.get("submit") ?? "ready";
const LOADED_AT = Date.now();
const LEDGER = query.get("ledger") ?? "ready";
const DRAFT = query.get("draft") ?? "ready";
const MINUTE = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE).toISOString();
const later = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** 열기 단추가 부른 길의 흔적 — 시험 스크립트가 `window.__opened` 로 읽는다. */
const trace = (what: string) => {
  const win = window as unknown as { __opened?: string[] };
  win.__opened = [...(win.__opened ?? []), what];
};
registerScreenOpener({ previewUrl: "http://127.0.0.1:5274/", open: (path) => trace(path) });

/** 화면 한 줄의 재료 — 제목 · 경로 · 사용자의 말. */
const NOTES: Array<[string, string, string]> = [
  ["회원 목록", "/members", "회원 목록에 이름으로 찾는 검색창을 넣어 줘"],
  ["회원 상세", "/members/1", "회원 상세의 연락처 칸을 두 줄로 줄여 줘"],
  ["결제 내역", "/billing", "결제 내역 표를 월별로 묶어 줘"],
  ["환불 요청", "/refunds", "환불 요청 단추를 오른쪽 위로 옮겨 줘"],
  ["공지사항", "/notices", "공지사항 목록에 새 글 표시를 달아 줘"],
  ["로그인", "/login", "로그인 화면의 안내 문구를 짧게 고쳐 줘"],
  ["대시보드", "/dashboard", "대시보드 숫자 카드의 색을 통일해 줘"],
  ["설정", "/settings", "설정 화면의 알림 항목을 묶어 줘"],
];
/** 오래된 것부터 아홉 분 간격 — 오늘의 시각이라 `10:12` 꼴로 읽힌다. */
const screenOf = (index: number, total: number) => {
  const [title, route, note] = NOTES[index] as [string, string, string];
  return { route, title, note, at: ago((total - index) * 9), sha: `s${index + 1}` };
};
const SCREENS = [0, 1, 2].map((index) => screenOf(index, 3));
const MANY = NOTES.map((_, index) => screenOf(index, NOTES.length));

/** 제출 확인이 읽는 사진 — 화면마다 차례 하나, 화면에 서지 않은 공통 글꼴 변경 하나. */
const previewOf = (repo: RepoStatus): SubmitPreview => {
  const live = repo.cycleScreens ?? [];
  // 읽는 동안 내용이 바뀐 상황 — 목록이 데몬의 지금보다 한 화면 모자란다.
  const shown = SUBMIT === "changed" ? live.slice(1) : live;
  const entries: RepoHistoryEntry[] =
    SUBMIT === "empty"
      ? []
      : [
          {
            sha: "o1",
            message: "공통 글꼴을 정리해 줘",
            at: ago(4),
            files: ["src/styles/common.css", "src/styles/theme.css"],
          },
          ...shown.map((item) => ({
            sha: item.sha ?? "",
            message: item.note,
            at: item.at,
            files: [`src/pages${item.route}.tsx`],
          })),
        ];
  return {
    expectedPreview: "preview-1",
    head: "abc1234",
    repo: { ...repo, cycleScreens: shown },
    history: { base: "origin/main", entries },
    finalFiles: [...new Set(entries.flatMap((entry) => entry.files))],
  };
};

/** `이번 작업` 의 장부 — 코멘트 하나는 반영됐고 하나는 AI 가 고치는 중이다. */
const REVIEWS: DeveloperReview[] = [
  {
    id: 1,
    kind: "review",
    author: "dev1",
    body: "검색창 안내 문구를 조금 더 짧게 해 주세요.",
    pr: 7,
    at: ago(30),
  },
  {
    id: 2,
    kind: "review",
    author: "dev1",
    body: "표 머리글 색이 바탕과 비슷해서 잘 안 읽혀요. 한 단계만 진하게 부탁해요.",
    pr: 7,
    at: ago(6),
  },
];
const REFLECTION: RepoHistoryEntry = {
  sha: "r1",
  message: "코멘트 반영 — 검색창 안내 문구",
  at: ago(20),
  files: [],
  kind: "comment",
};
const ledgerOf = (handedAt: string | null) => ({
  reviews: LEDGER === "ready" ? REVIEWS : [],
  history: LEDGER === "loading" || LEDGER === "failed" ? null : [REFLECTION],
  handedAt,
  status: LEDGER === "loading" ? "loading" : LEDGER === "failed" ? "failed" : "ready",
  refresh: () => {},
  retry: () => trace("ledger-retry"),
});

const handoff = (state: "open" | "merged") => ({
  number: 7,
  url: "https://example.com/pull/7",
  title: "feat(members): 회원 목록에 이름 검색 추가 (작성: 정인권)",
  state,
  branch: "colonova-design/20261006-1",
  reviewers: ["dev1"],
});

const repoOf = (parts: Partial<RepoStatus>): RepoStatus => ({
  root: "/tmp/colonova-cdp",
  phase: "ready",
  detail: null,
  previewUrl: "http://127.0.0.1:5274/",
  previewPort: 5274,
  previewEpoch: 1,
  url: null,
  branch: "colonova-design/20261006-1",
  baseBranch: "main",
  handoff: null,
  pendingChanges: 0,
  cycleScreens: SCREENS.slice(0, 1),
  ...parts,
});

const nav = {
  toast: (text: string) => trace(`toast:${text}`),
  showTab: (tab: string) => trace(`tab:${tab}`),
} as unknown as ShellNav;

interface Case {
  id: string;
  label: string;
  title: string;
  repo?: Partial<RepoStatus>;
  running?: boolean;
  comments?: number;
  /** 요청이 열린 지 달력으로 며칠인가(0 = 오늘) — 코멘트가 없는 기다림의 `N일째`. */
  waitingDays?: number;
  phase?: "read" | "file" | "command" | null;
  width?: number;
  narrow?: boolean;
  sidebarHidden?: boolean;
}

const LONG = "[최종 홈 검증] 파일·화면·설정 변경과 제출 없이 정확히 “최종 확인 완료”만 답해주세요.";

const BASE_CASES: Case[] = [
  { id: "a", label: "a · 제출 전 · 화면 1개 (스크린샷의 그 상태)", title: LONG },
  {
    id: "b",
    label: "b · 제출 전 · 화면 3개",
    title: "회원 목록에 이름으로 찾는 검색창을 넣어 줘",
    repo: { cycleScreens: SCREENS },
  },
  {
    id: "c",
    label: "c · 아직 만든 것이 없다(제출 잠김)",
    title: "새 대화",
    repo: { branch: null, cycleScreens: [] },
  },
  {
    id: "d",
    label: "d · AI 가 도는 중 · 파일 고치는 중",
    title: "회원 목록에 이름으로 찾는 검색창을 넣어 줘",
    repo: { cycleScreens: SCREENS },
    running: true,
    phase: "file",
  },
  {
    id: "e",
    label: "e · 제출함 · 개발자 확인을 기다려요 · 코멘트 2",
    title: "결제 내역 표를 월별로 묶어 줘",
    repo: { handoff: handoff("open"), cycleScreens: SCREENS },
    comments: 2,
  },
  {
    id: "q",
    label: "q · 제출함 · 개발자 확인을 기다려요 · 3일째(코멘트 없음)",
    title: "결제 내역 표를 월별로 묶어 줘",
    repo: { handoff: handoff("open"), cycleScreens: SCREENS },
    waitingDays: 2,
  },
  {
    id: "f",
    label: "f · 반영됨",
    title: "결제 내역 표를 월별로 묶어 줘",
    repo: { handoff: handoff("merged"), branch: null, cycleScreens: [] },
  },
  {
    id: "g",
    label: "g · 제출이 막힘",
    title: "회원 목록에 이름으로 찾는 검색창을 넣어 줘",
    repo: {
      cycleScreens: SCREENS,
      submit: { phase: "blocked", attempts: 3, lastError: "network", log: [] },
    },
  },
  {
    id: "p",
    label: "p · 다시 로그인이 필요해요(문제 문장 줄 — 로그인 단추)",
    title: "회원 목록에 이름으로 찾는 검색창을 넣어 줘",
    repo: {
      cycleScreens: SCREENS,
      attention: { kind: "reconnect", since: ago(3), what: "agent-login" },
    },
  },
  {
    id: "h",
    label: "h · 1100px (중간 폭)",
    title: LONG,
    repo: { cycleScreens: SCREENS },
    width: 1100,
  },
  {
    id: "i",
    label: "i · 960px · 사이드바 접힘 단추",
    title: LONG,
    repo: { cycleScreens: SCREENS },
    width: 960,
    sidebarHidden: true,
  },
  {
    id: "j",
    label: "j · 좁은 창(900px 아래) 430px",
    title: LONG,
    repo: { cycleScreens: SCREENS },
    width: 430,
    narrow: true,
    sidebarHidden: true,
  },
  {
    id: "k",
    label: "k · 좁은 창 · AI 도는 중",
    title: LONG,
    repo: { cycleScreens: SCREENS },
    running: true,
    phase: "read",
    width: 430,
    narrow: true,
    sidebarHidden: true,
  },
];

/** `?sweep=1` — 같은 상태(a · d · e · g)를 여러 막대 폭으로 늘어놓는다. 접히는 순서와 겹침을 본다. */
const SWEEP_WIDTHS = [1500, 1300, 1150, 1000, 900, 800, 700, 620, 540];
const SWEEP: Case[] = SWEEP_WIDTHS.flatMap((width) =>
  BASE_CASES.filter((spec) => ["a", "d", "e", "g", "q"].includes(spec.id)).map((spec) => ({
    ...spec,
    id: `${spec.id}-${width}`,
    label: `${spec.id} @ ${width}`,
    width,
    narrow: width < 900,
    sidebarHidden: width < 900 || spec.sidebarHidden,
  })),
);
const ONLY = query.get("case");
const CASES: Case[] = (query.get("sweep") ? SWEEP : BASE_CASES).filter(
  (spec) => !ONLY || spec.id === ONLY || spec.id.startsWith(`${ONLY}-`),
);

function Row({ spec }: { spec: Case }) {
  // 보내기가 성공하면 열린 요청이 서고 마지막 제출의 시각이 생긴다 — 여정 · 단추 · 영수증이 따라온다.
  const [sentAt, setSentAt] = useState<string | null>(null);
  const modePatch: Partial<RepoStatus> =
    SUBMIT === "many" && (spec.repo?.cycleScreens?.length ?? 1) > 0
      ? { cycleScreens: MANY }
      : SUBMIT === "outside"
        ? { cycleScreens: [] }
        : SUBMIT === "more"
          ? {
              // 이미 제출한 요청에 더하는 제출 — 마지막 제출(30분 전) 앞의 화면 둘은 접힌다.
              cycleScreens: MANY.slice(3),
              handoff: handoff("open"),
              submit: { phase: "idle", attempts: 0, log: [{ at: ago(30), text: "제출했어요" }] },
            }
          : {};
  const sentPatch: Partial<RepoStatus> = sentAt
    ? {
        handoff: handoff("open"),
        submit: { phase: "idle", attempts: 0, log: [{ at: sentAt, text: "제출했어요" }] },
      }
    : {};
  const repo = repoOf({ ...spec.repo, ...modePatch, ...sentPatch });
  const copy = submitCopy(repo.submit, L);
  const journey = deriveJourney(
    {
      repo,
      diffStatus: null,
      running: spec.running ?? false,
      comments: spec.comments ?? 0,
      ...(spec.waitingDays === undefined ? {} : { waitingDays: spec.waitingDays }),
      submitCopy: copy,
    },
    L,
  );
  // 진짜 장부 훅을 돌려 보는 모드(`?ledger=hook-*`) — 읽는 중 · 읽지 못함 · 다시 시도의 실제 전이를 본다.
  // 가짜 데몬의 `api` 는 훅의 읽기 콜백이 매 렌더 바뀌지 않게 한 번만 짓는다.
  const repoRef = useRef(repo);
  repoRef.current = repo;
  const api = useMemo(
    () => ({
      onboardingFix: async () => {
        await later(600);
      },
      refreshStatus: async () => {
        await later(400);
      },
      submitPreview: () =>
        SUBMIT === "loading"
          ? new Promise(() => {})
          : SUBMIT === "fail"
            ? later(400).then(() => Promise.reject(new Error("read")))
            : later(400).then(() => previewOf(repoRef.current)),
      // 요청 초안 — AI 한 번이라 느리다. `empty` 는 AI 가 못 쓴 초안(제목 · 설명이 빔).
      handoffDraft: () =>
        DRAFT === "slow"
          ? new Promise(() => {})
          : DRAFT === "fail"
            ? later(1200).then(() => Promise.reject(new Error("draft")))
            : later(1200).then(() =>
                DRAFT === "empty"
                  ? {
                      title: "",
                      body: "",
                      source: "fallback" as const,
                      extras: { commentsSection: null, filesSection: null, shotCount: 0 },
                    }
                  : {
                      title: "feat(members): 회원 목록에 이름으로 찾는 검색창 추가 (작성: 정인권)",
                      body:
                        DRAFT === "long"
                          ? "회원 목록 맨 위에 검색창을 넣고 이름 일부만 쳐도 결과가 바로 걸러지게 했습니다. 결과가 없을 때는 안내 문구를 보여 주고, 휴대폰 폭에서도 검색창이 옆으로 밀리지 않도록 폭을 맞췄습니다. 검색어를 지우면 전체 목록으로 돌아오고, 목록의 정렬은 그대로 유지됩니다. 접근성을 위해 검색창에 이름표를 달았고 키보드만으로도 조작할 수 있습니다."
                          : "회원 목록 맨 위에 검색창을 넣어 이름으로 거를 수 있게 했습니다.\n\n- 검색 결과가 없으면 안내 문구를 보여 줍니다\n- 휴대폰 폭에서도 옆으로 밀리지 않습니다",
                      source: "machine" as const,
                      extras: { commentsSection: null, filesSection: null, shotCount: 3 },
                    },
              ),
      noteToDeveloper: async () => {
        await later(300);
      },
      submit: async () => {
        await later(900);
        if (SUBMIT === "sendfail") throw new Error("network");
        if (SUBMIT === "conflict") throw new Error("SUBMIT_CHANGED");
        setSentAt(new Date().toISOString());
      },
      // 코멘트 읽기 — `hook-slow` 는 영영 읽는 중, `hook-fail` 은 늘 실패, `hook-failthen` 은 열어 두고 4초 뒤부터 성공.
      handoffStatus: async () => {
        await later(500);
        if (LEDGER === "hook-slow") await new Promise(() => {});
        if (LEDGER === "hook-fail") throw new Error("read");
        if (LEDGER === "hook-failthen" && Date.now() - LOADED_AT < 4000) throw new Error("read");
        return { number: 7, reviews: REVIEWS };
      },
      saveHistory: async () => {
        await later(300);
        return { entries: [REFLECTION] };
      },
    }),
    [],
  );
  const daemon = {
    activeSlug: "colonova-cdp",
    repo,
    status: { authorName: "정인권" },
    projects: [project],
    diffStatus: null,
    sessions: {},
    api,
  } as unknown as Daemon;
  const hooked = useWorkLedger(daemon);
  const ledger = LEDGER.startsWith("hook")
    ? { ...hooked, handedAt: sentAt }
    : ledgerOf(sentAt ?? null);
  const width = spec.width ?? WIDE;
  return (
    <div id={`fixture-${spec.id}`} style={{ margin: "14px 0 18px 20px" }}>
      <div style={{ font: "12px/1.4 monospace", color: "#888", margin: "0 0 4px" }}>
        {spec.label} · {width}px
      </div>
      {/* .nx 는 견본에서 토큰 범위만 빌린다 — 셸의 그리드는 풀어 평범한 문서로. */}
      <div
        className={`nx${spec.narrow ? " nx--narrow" : ""}`}
        style={{
          display: "block",
          height: "auto",
          overflow: "visible",
          width,
          border: "1px dashed #8884",
        }}
      >
        <div className="nx-main" style={{ width }}>
          <StatusLine
            daemon={daemon}
            sessions={{ activeId: "s1" } as unknown as Sessions}
            project={project}
            title={spec.title}
            onRename={spec.id === "c" ? undefined : (name) => console.log("rename", name)}
            journey={journey}
            turnStartedAt={spec.running ? Date.now() - 12_000 : null}
            makingPhase={spec.phase ?? null}
            firstTurn={false}
            narrow={spec.narrow ?? false}
            nav={nav}
            onSubmit={() => {}}
            ledger={ledger}
            submitCopy={copy}
            sidebarHidden={spec.sidebarHidden ?? false}
            onOpenSidebar={() => {}}
          />
          <ProblemLine
            daemon={daemon}
            invitePath={null}
            onClearInvite={() => {}}
            onToast={(text) => trace(`toast:${text}`)}
          />
          {/* 대화 칸 · 미리보기 칸의 경계 — 상태 줄과 이 선이 어떻게 만나는지 본다. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: spec.narrow ? "1fr" : "400px minmax(0, 1fr)",
              height: 36,
            }}
          >
            <div style={{ borderRight: spec.narrow ? 0 : "1px solid var(--line)" }} />
            <div />
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: 40 }}>
      {CASES.map((spec) => (
        <Row key={spec.id} spec={spec} />
      ))}
    </div>
  </StrictMode>,
);
