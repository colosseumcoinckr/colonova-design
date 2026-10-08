/**
 * 겹판 견본의 가짜 재료 — 데몬 · 설정 · 사진 · 기록(2026-10-06 겹판 손질). `overlay-fixture.tsx` 가 읽는다.
 * 새 겹판이 더 필요한 재료는 여기에 더한다(파일 전체를 다시 쓰지 말고 필요한 부분만 더한다).
 */

import type {
  DiagnosticsSummary,
  InviteRow,
  NormalizedInvite,
  ProjectSummary,
  RepoHistoryEntry,
  RepoStatus,
  ScreenComparison,
  ThreadSummary,
} from "@colonova-design/protocol";
import type { Daemon } from "../src/lib/daemon-client";

const MIN = 60_000;
export const ago = (min: number) => new Date(Date.now() - min * MIN).toISOString();

export const thread = (id: string, title: string, at: number): ThreadSummary => ({
  id,
  title,
  state: "idle",
  updatedAt: ago(at),
});

export const PROJECTS = [
  {
    name: "colonova-cdp",
    slug: "colonova-cdp",
    reviewers: ["dev1"],
    repoUrl: "https://github.com/colosseum/colonova-cdp",
    threads: [
      thread("t1", "회원 목록에 이름으로 찾는 검색창을 넣어 줘", 5),
      thread("t2", "결제 내역 표를 월별로 묶어 줘", 40),
      thread("t3", "로그인 화면 문구를 부드럽게 다듬어 줘", 120),
    ],
  },
  {
    name: "상점 관리자",
    slug: "shop-admin",
    reviewers: ["dev1"],
    repoUrl: "https://github.com/colosseum/shop-admin",
    threads: [
      thread("s1", "주문 목록 필터 초기화 버튼", 300),
      thread("s2", "상품 상세의 이미지 슬라이더", 900),
    ],
  },
] as unknown as ProjectSummary[];

/** 설정 · 초대 등이 읽는 데몬 상태 — AI 둘(하나는 새 버전이 있고 하나는 설치 전). */
export const STATUS = {
  projects: PROJECTS,
  activeProject: "colonova-cdp",
  protocolVersion: 19,
  commonInstructions: "공통 규칙 …",
  platform: "darwin",
  claudeVersion: "2.1.3",
  gitAvailable: true,
  loggedIn: true,
  authMethod: "oauth",
  subscriptionType: "max",
  email: "hong@example.com",
  apiKeyInEnv: false,
  githubAuthExpired: false,
  githubTokenExpiresAt: new Date(Date.now() + 9 * 24 * 60 * MIN).toISOString(),
  liveSessions: 0,
  pendingPermissions: 0,
  warnings: [],
  repoSettingsWarning: null,
  pnpmAvailable: true,
  modelsByProvider: {},
  providers: [
    {
      id: "claude",
      label: "Claude Code",
      available: true,
      version: "2.1.3",
      latestVersion: "2.2.0",
      loggedIn: true,
      oneShot: true,
      capabilities: {},
    },
    {
      id: "codex",
      label: "Codex",
      available: false,
      reason: "아직 설치되지 않았어요",
      capabilities: {},
    },
  ],
  machineProvider: null,
  machineProviderActive: { id: "claude", origin: "auto" },
  dev: false,
  authorName: "정인권",
  agentAutoUpdate: true,
  agentUpdates: {},
  noticeRoute: "slack",
  attention: null,
} as unknown as NonNullable<Daemon["status"]>;

/** 사진 한 장 — 캔버스로 그린 가짜 화면(비교 창은 png · jpeg · webp 만 받는다). */
function screenPng(withSearch: boolean): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 800;
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = "#f6f7fb";
  g.fillRect(0, 0, 1280, 800);
  g.fillStyle = "#1f2a44";
  g.fillRect(0, 0, 220, 800);
  g.fillStyle = "#cfd6ea";
  g.font = "600 20px system-ui";
  g.fillText("관리자", 28, 52);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = i === 1 ? "#33427a" : "transparent";
    g.fillRect(12, 90 + i * 46, 196, 36);
    g.fillStyle = "#aab4d4";
    g.font = "16px system-ui";
    g.fillText(
      ["대시보드", "회원 목록", "결제 내역", "상품", "정산", "설정"][i] ?? "",
      28,
      114 + i * 46,
    );
  }
  g.fillStyle = "#111827";
  g.font = "700 28px system-ui";
  g.fillText("회원 목록", 260, 76);
  if (withSearch) {
    g.fillStyle = "#fff";
    g.strokeStyle = "#c7cde0";
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(260, 104, 420, 44, 10);
    g.fill();
    g.stroke();
    g.fillStyle = "#8a93ad";
    g.font = "16px system-ui";
    g.fillText("이름으로 찾기", 282, 133);
    g.fillStyle = "#2c6bd6";
    g.beginPath();
    g.roundRect(696, 104, 88, 44, 10);
    g.fill();
    g.fillStyle = "#fff";
    g.font = "600 16px system-ui";
    g.fillText("검색", 724, 133);
  }
  g.fillStyle = "#fff";
  g.beginPath();
  g.roundRect(260, withSearch ? 172 : 108, 960, 520, 12);
  g.fill();
  for (let i = 0; i < 8; i++) {
    const y = (withSearch ? 172 : 108) + 24 + i * 58;
    g.fillStyle = i % 2 ? "#f1f3f9" : "#fafbfd";
    g.fillRect(272, y, 936, 48);
    g.fillStyle = "#374151";
    g.font = "16px system-ui";
    g.fillText(
      ["김하늘", "이도윤", "박서연", "최지후", "정민서", "한유진", "오세훈", "윤아라"][i] ?? "",
      292,
      y + 30,
    );
    g.fillStyle = "#9ca3af";
    g.fillText(`user${i + 1}@example.com`, 520, y + 30);
    g.fillText(`2026-10-0${(i % 6) + 1}`, 900, y + 30);
  }
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}

export function mockComparison(): ScreenComparison {
  return {
    requestId: "r1",
    sessionId: "t1",
    sha: "abc1234",
    route: "/members",
    title: "회원 목록",
    viewport: "desktop",
    before: { at: ago(95), mediaType: "image/png", data: screenPng(false) },
    after: { at: ago(4), mediaType: "image/png", data: screenPng(true) },
  };
}

export const HISTORY: RepoHistoryEntry[] = [
  { sha: "a1", message: "회원 목록에 이름으로 찾는 검색창을 넣어 줘", at: ago(4), files: ["a"] },
  { sha: "a2", message: "표 머리글을 굵게 하고 줄 간격을 넓혀 줘", at: ago(38), files: ["a", "b"] },
  {
    sha: "a3",
    message: "코멘트 반영 — 버튼 문구를 「검색」으로",
    at: ago(70),
    files: ["a"],
    kind: "comment",
  },
  { sha: "a4", message: "개발자 쪽 변경을 합쳤어요", at: ago(190), files: [], kind: "merge" },
  { sha: "a5", message: "결제 내역 표를 월별로 묶어 줘", at: ago(300), files: ["c"] },
];

/**
 * 서랍 견본 `?hist=rich` — 여러 날(오늘 · 어제 · 그 앞) · 이어진 반영 차례(접힘) · 긴 제목 · 화면이 둘인 차례 ·
 * 되돌림 · 코멘트 반영 · 굴러야 하는 길이. 위에서부터 `최신 내용을 가져왔어요 · 3번` 이 지금이다(실제 화면의 그 모양).
 */
const DAY = 1440;
export const RICH_HISTORY: RepoHistoryEntry[] = [
  { sha: "r1", message: "합쳤어요", at: ago(6), files: [], kind: "merge" },
  { sha: "r2", message: "합쳤어요", at: ago(20), files: [], kind: "merge" },
  { sha: "r3", message: "합쳤어요", at: ago(55), files: [], kind: "merge" },
  {
    sha: "r4",
    message:
      "회원 목록 맨 위에 이름과 이메일로 한꺼번에 찾을 수 있는 검색창을 넣고, 검색어를 지우는 버튼과 결과가 없을 때 보여 줄 안내 문구까지 만들어 줘",
    at: ago(80),
    files: ["a"],
  },
  {
    sha: "r5",
    message: "결제 내역과 회원 상세의 표 머리글을 같은 모양으로 맞춰 줘",
    at: ago(130),
    files: ["a", "b"],
  },
  { sha: "r6", message: "되돌리기: 14:05", at: ago(170), files: ["a"], kind: "restore" },
  {
    sha: "r7",
    message: "코멘트 반영 — 검색 버튼을 오른쪽 끝으로 옮겨 주세요",
    at: ago(200),
    files: ["a"],
    kind: "comment",
  },
  { sha: "r8", message: "입고 목록에 날짜 필터를 달아 줘", at: ago(DAY + 60), files: ["c"] },
  { sha: "r9", message: "합쳤어요", at: ago(DAY + 120), files: [], kind: "merge" },
  { sha: "r10", message: "합쳤어요", at: ago(DAY + 150), files: [], kind: "merge" },
  {
    sha: "r11",
    message: "재고 현황의 숫자를 천 단위로 끊어 보여 줘",
    at: ago(DAY + 400),
    files: ["d"],
  },
  {
    sha: "r12",
    message: "로그인 화면 문구를 부드럽게 다듬어 줘",
    at: ago(2 * DAY + 300),
    files: ["e"],
  },
  { sha: "r13", message: "합쳤어요", at: ago(2 * DAY + 420), files: [], kind: "merge" },
  { sha: "r14", message: "첫 화면의 카드 순서를 바꿔 줘", at: ago(3 * DAY + 100), files: ["f"] },
];

/** `?hist=rich` 와 함께 쓰는 화면 지도 — r5 는 화면이 둘이다(비교 단추에 화면 이름이 실린다). */
export const RICH_SCREENS = [
  { route: "/members", title: "회원 목록", note: "검색창", at: ago(80), sha: "r4" },
  { route: "/billing", title: "결제 내역", note: "표 머리글", at: ago(130), sha: "r5" },
  { route: "/members/1", title: "회원 상세", note: "표 머리글", at: ago(130), sha: "r5" },
  { route: "/wms/inbound", title: "입고 목록", note: "날짜", at: ago(DAY + 60), sha: "r8" },
  { route: "/wms/stock", title: "재고 현황", note: "숫자", at: ago(DAY + 400), sha: "r11" },
  { route: "/login", title: "로그인", note: "문구", at: ago(2 * DAY + 300), sha: "r12" },
];

/**
 * 서랍 견본 `?hist=user` — 2026-10-06 사용자가 보낸 스크린샷의 그 모양: 오늘은 `최신 내용을 가져왔어요 · 3번` 이 지금이고,
 * 며칠 전은 반영 6번 + `작업 이어 보관`(WMS 입고 목록).
 */
const dayAt = (back: number, hour: number, minute: number) => {
  const date = new Date();
  date.setDate(date.getDate() - back);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};
export const USER_HISTORY: RepoHistoryEntry[] = [
  { sha: "u1", message: "합쳤어요", at: dayAt(0, 13, 21), files: [], kind: "merge" },
  { sha: "u2", message: "합쳤어요", at: dayAt(0, 13, 4), files: [], kind: "merge" },
  { sha: "u3", message: "합쳤어요", at: dayAt(0, 12, 31), files: [], kind: "merge" },
  ...[17, 16, 15, 14, 13, 12].map((hour, index) => ({
    sha: `u${4 + index}`,
    message: "합쳤어요",
    at: dayAt(4, hour, 5),
    files: [],
    kind: "merge" as const,
  })),
  { sha: "u10", message: "작업 이어 보관", at: dayAt(4, 10, 23), files: ["a"] },
];
export const USER_SCREENS = [
  {
    route: "/wms/inbound",
    title: "WMS 입고 목록",
    note: "작업 이어 보관",
    at: dayAt(4, 10, 23),
    sha: "u10",
  },
];

/** 프로젝트를 옮긴 뒤의 기록 — 이전 프로젝트의 줄이 비치지 않는지 본다(`__histProject`). */
const SHOP_HISTORY: RepoHistoryEntry[] = [
  { sha: "s1", message: "주문 목록에 필터 초기화 버튼을 달아 줘", at: ago(12), files: ["a"] },
  {
    sha: "s2",
    message: "상품 상세의 이미지 슬라이더를 넘겨 보게 해 줘",
    at: ago(90),
    files: ["b"],
  },
];

export const REPO = {
  root: "/tmp/colonova-cdp",
  phase: "ready",
  branch: "colonova-design/20261006-1",
  pendingChanges: 3,
  cycleScreens: [
    { route: "/members", title: "회원 목록", note: "검색창", at: ago(4), sha: "a1" },
    { route: "/members/1", title: "회원 상세", note: "표 머리글", at: ago(38), sha: "a2" },
    { route: "/billing", title: "결제 내역", note: "월별", at: ago(300), sha: "a5" },
  ],
} as unknown as RepoStatus;

export const INVITE: NormalizedInvite = {
  token: "ghp_mock",
  authorName: "정인권",
  projects: [
    {
      repoUrl: "https://github.com/colosseum/colonova-cdp",
      name: "colonova-cdp",
      baseBranch: "main",
      reviewers: ["dev1", "dev2"],
      approveCommands: true,
    },
    {
      repoUrl: "https://github.com/colosseum/shop-admin",
      name: "상점 관리자",
      baseBranch: "develop",
      reviewers: ["dev1"],
      approveCommands: false,
    },
    {
      repoUrl: "https://github.com/colosseum/docs-portal",
      name: "문서 포털",
      baseBranch: "main",
      approveCommands: false,
    },
  ],
};

export const INVITE_ROWS: InviteRow[] = [
  { action: "add", project: INVITE.projects[0] as NonNullable<(typeof INVITE.projects)[number]> },
  {
    action: "update",
    project: INVITE.projects[1] as NonNullable<(typeof INVITE.projects)[number]>,
    slug: "shop-admin",
    currentName: "상점 관리자",
  },
  {
    action: "keep",
    project: INVITE.projects[2] as NonNullable<(typeof INVITE.projects)[number]>,
    slug: "docs-portal",
    currentName: "문서 포털",
  },
];

/** 호출 기록 — 화면 밖의 시험이 `window.__overlay.calls` 로 읽는다. */
export const calls: string[] = [];

/**
 * 비교 견본의 상태 — `?state=` 로 고른다: loading(끝나지 않음) · failed(늘 실패) · failonce(처음만 실패) ·
 * nobefore · noafter · none(둘 다 없음). 아무것도 없으면 두 사진 모두 있다(2026-10-06 겹판 손질).
 */
let comparisonCalls = 0;
function comparisonByState(): unknown {
  const state = new URLSearchParams(location.search).get("state");
  comparisonCalls += 1;
  if (state === "loading") return new Promise(() => undefined);
  if (state === "failed") return Promise.reject(new Error("mock failure"));
  // StrictMode 가 처음 읽기를 두 번 부르므로(둘째가 살아남는다) 처음 두 번이 실패다 — 다시 시도(셋째)부터 성공.
  if (state === "failonce" && comparisonCalls <= 2)
    return Promise.reject(new Error("mock failure"));
  const record = mockComparison();
  if (state === "nobefore") return { ...record, before: null };
  if (state === "noafter") return { ...record, after: null };
  if (state === "none") return { ...record, before: null, after: null };
  return record;
}

/** 서랍 견본의 상태 — `?hist=loading|fail|empty|now|rich|user`(읽기) · `?restore=fail|slow`(되돌리기). */
function historyByState(): unknown {
  const state = new URLSearchParams(location.search).get("hist");
  const project = (window as { __histProject?: string }).__histProject;
  // 다른 프로젝트는 0.6초 뒤에 답한다 — 읽는 동안 이전 프로젝트의 줄이 비치는지 본다.
  if (project === "shop-admin")
    return new Promise((resolve) => setTimeout(() => resolve({ entries: SHOP_HISTORY }), 600));
  if (state === "loading") return new Promise(() => undefined);
  if (state === "fail") return Promise.reject(new Error("mock failure"));
  if (state === "empty") return { entries: [] };
  if (state === "rich") return { entries: RICH_HISTORY };
  if (state === "user") return { entries: USER_HISTORY };
  if (state === "now") return { entries: [{ ...HISTORY[0], at: ago(0.3) }, ...HISTORY.slice(1)] };
  return { entries: HISTORY };
}
function restoreByState(): unknown {
  const state = new URLSearchParams(location.search).get("restore");
  if (state === "fail") return { stage: "failed" };
  if (state === "slow")
    return new Promise((resolve) => setTimeout(() => resolve({ stage: "done" }), 1500));
  return { stage: "done" };
}

/** 진단 요약의 견본(2026-10-07 베타 준비 분석) — 설정의 개발자용 쪽 · 준비 실패 카드의 복사가 읽는다. */
export const DIAGNOSTICS: DiagnosticsSummary = {
  at: new Date().toISOString(),
  appVersion: "0.4.0",
  os: { platform: "win32", release: "10.0.22631", arch: "x64" },
  protocolVersion: 19,
  nodeVersion: "24.1.0",
  tools: {
    node: { present: true, version: "24.1.0" },
    git: { present: true, version: "2.45.1" },
    pnpm: { present: false, version: null },
    bash: { present: true, version: null },
  },
  ai: [
    { id: "claude", present: true, version: "2.1.292", loggedIn: true },
    { id: "codex", present: false, version: null, loggedIn: null },
  ],
  account: { method: "claude.ai", plan: "max" },
  turnStats: {
    days: 7,
    turns: 37,
    byKind: { user: 20, comments: 9, brief: 5, gate: 3 },
    failed: 3,
    failures: { account: 2, limit: 1 },
    pinTurns: 9,
    avgToolCalls: 6.4,
    firstEditMs: { n: 25, p50: 4200, p90: 12800 },
    firstDeltaMs: { n: 25, p50: 900, p90: 2100 },
    durationMs: { n: 25, p50: 31000, p90: 74000 },
  },
  errors: [
    {
      level: "error",
      kind: "요청 실패 · repo.sync · Error",
      count: 3,
      lastAt: new Date().toISOString(),
    },
    { level: "warn", kind: "게이트 실패 · capture", count: 1, lastAt: new Date().toISOString() },
  ],
};

const HANDLERS: Record<string, (...args: unknown[]) => unknown> = {
  diagnosticsSummary: () => DIAGNOSTICS,
  comparison: () => comparisonByState(),
  saveHistory: () => historyByState(),
  restore: () => restoreByState(),
};

/** 모든 api 호출을 받는 가짜 — 아는 것은 답하고, 모르는 것은 빈 객체로 답한다. */
export function mockDaemon(patch: Record<string, unknown> = {}): Daemon {
  const api = new Proxy({} as Record<string, unknown>, {
    get:
      (_target, key: string) =>
      (...args: unknown[]) => {
        calls.push(key);
        return Promise.resolve(HANDLERS[key]?.(...args) ?? {});
      },
  });
  return {
    connection: "open",
    connectionError: null,
    reconnect: () => undefined,
    status: STATUS,
    projects: PROJECTS,
    activeSlug: "colonova-cdp",
    hiddenThreads: { has: () => false },
    hideThread: () => undefined,
    unhideThread: () => undefined,
    hideAllThreads: () => undefined,
    unhideAllThreads: () => undefined,
    sessions: {},
    pending: [],
    api,
    repo: REPO,
    diffStatus: null,
    browserDriving: new Set<string>(),
    editingScreens: new Map(),
    login: null,
    loginDone: null,
    install: null,
    installDone: null,
    onboarding: null,
    onboardingProvider: null,
    resolvePending: () => undefined,
    ensureSession: () => undefined,
    hydrate: () => undefined,
    markLive: () => undefined,
    dismissDropped: () => undefined,
    ...patch,
  } as unknown as Daemon;
}

// ── 설정(S) 견본의 상태 — `?case=settings&state=a,b` 의 쉼표로 이은 이름들(2026-10-06 설정 손질).
// 데스크톱 다리는 `window.colonovaDesignDesktop` 스텁으로, 데몬은 `mockDaemon` 의 patch 로 세운다.

const SETTINGS_DELAY = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 설정 견본의 데스크톱 스텁 — 이름이 있는 상태만 세운다(없으면 브라우저처럼 다리가 없다). */
function settingsDesktop(flags: string[]): void {
  const has = (flag: string) => flags.includes(flag);
  const wanted = [
    "desktop",
    "app-new",
    "app-defer",
    "app-fail",
    "app-slow",
    "probe-fail",
    "linux",
    "notify-block",
    "notify-slow",
    "reset-go",
    "reset-fail",
    "reset-slow",
  ];
  if (!wanted.some(has)) return;
  let prepared = false;
  (window as unknown as { colonovaDesignDesktop: unknown }).colonovaDesignDesktop = {
    platform: has("linux") ? "linux" : "darwin",
    updateCheck: async () => {
      await SETTINGS_DELAY(300);
      if (has("probe-fail")) throw new Error("피드를 읽지 못했습니다");
      const fresh = has("app-new") || has("app-defer") || has("app-fail") || has("app-slow");
      return {
        updateAvailable: fresh,
        version: fresh ? "0.5.0" : "0.4.1",
        notes: null,
        url: "https://example.com/colonova.zip",
        sha256: "abc123",
        winUrl: null,
        winSha256: null,
      };
    },
    selfUpdate: async () => {
      if (prepared) {
        await SETTINGS_DELAY(500);
        return { started: true, downloadPath: "/tmp/colonova.zip", steps: [] };
      }
      await SETTINGS_DELAY(has("app-slow") ? 8000 : 1800);
      if (has("app-fail")) return { error: "업데이트 파일을 내려받지 못했습니다 (HTTP 404)" };
      if (has("app-defer")) return { deferred: true, version: "0.5.0" };
      prepared = true;
      return { prepared: true, version: "0.5.0" };
    },
    reset: async () => {
      await SETTINGS_DELAY(has("reset-slow") ? 60000 : 2500);
      if (has("reset-fail")) return { error: "초기화를 시작하지 못했습니다" };
      return has("reset-go") ? { restarting: true } : { cancelled: true };
    },
    notifyTest: async () => {
      await SETTINGS_DELAY(has("notify-slow") ? 3000 : 400);
      return has("notify-block") ? { shown: false, error: "서명되지 않은 실행" } : { shown: true };
    },
    openHome: async () => ({}),
    openNotificationSettings: async () => ({}),
  };
}

/**
 * 설정 견본의 데몬 — `flags` 가 상태 · 진행 · 실패를 고른다. 모르는 이름은 건너뛴다.
 *  · 데스크톱 다리: desktop · app-new · app-defer · app-fail · app-slow · probe-fail · linux ·
 *    notify-block · notify-slow · reset-go · reset-fail · reset-slow
 *  · 업데이트 쪽: all-latest · no-latest · no-agents · update-run · update-fail · check-fail · auto-fail
 *  · AI 쪽: both-usable · login-needed · login-run · login-fail · login-expired · install-run ·
 *    install-fail · fix-reject · empty-providers · loading · codex-picked(고른 AI 를 못 씀)
 *  · 연결 쪽: offline · github-expired · work(제출하지 않은 작업이 있는 프로젝트) · author-fail · author-slow
 *  · 계정 쪽(로그인 뒤의 한 줄): acct-none(요금제 모름) · acct-apikey · acct-long(긴 이메일) · acct-free(쓸 수 없는 요금제)
 */
export function SETTINGS_daemon(flags: string[]): Daemon {
  settingsDesktop(flags);
  const has = (flag: string) => flags.includes(flag);
  type Provider = Record<string, unknown>;
  const claude = STATUS.providers?.[0] as unknown as Provider;
  const codex = STATUS.providers?.[1] as unknown as Provider;
  let providers: Provider[] = [{ ...claude }, { ...codex }];
  if (has("all-latest")) providers = [{ ...claude, latestVersion: claude.version }, { ...codex }];
  if (has("no-latest")) providers = [{ ...claude, latestVersion: undefined }, { ...codex }];
  if (has("no-agents")) {
    providers = [
      {
        ...claude,
        available: false,
        version: undefined,
        latestVersion: undefined,
        reason: "아직 설치되지 않았어요",
      },
      { ...codex },
    ];
  }
  // AI 쪽 — 둘 다 쓸 수 있음 · 로그인 필요 · 목록이 빔(2026-10-06 설정 손질 · S2)
  if (has("both-usable")) {
    providers = [
      { ...claude },
      {
        ...codex,
        available: true,
        loggedIn: true,
        version: "0.46.0",
        latestVersion: "0.46.0",
        reason: undefined,
      },
    ];
  }
  const loginNeeded = ["login-needed", "login-run", "login-fail", "login-expired"].some(has);
  if (loginNeeded) providers = [{ ...claude, loggedIn: false }, { ...codex }];
  if (has("empty-providers") || has("loading")) providers = [];
  const status: Record<string, unknown> = { ...STATUS, providers };
  // 계정 쪽(2026-10-07 베타 준비 분석) — 로그인 뒤의 한 줄과 쓸 수 없는 요금제의 막힘.
  if (has("acct-none")) status.subscriptionType = null;
  if (has("acct-apikey")) {
    status.authMethod = "api_key";
    status.email = null;
    status.subscriptionType = null;
  }
  if (has("acct-long")) {
    status.email =
      "very.long.name.of.a.person@a-company-with-a-very-long-domain-name.example.co.kr";
    status.subscriptionType = "enterprise";
  }
  if (has("acct-free")) status.subscriptionType = "free";
  if (has("login-expired")) {
    status.attention = { kind: "reconnect", what: "agent-login", since: new Date().toISOString() };
  }
  if (has("update-run")) {
    status.agentUpdates = { claude: { phase: "running", at: new Date().toISOString() } };
  }
  if (has("update-fail")) {
    status.agentUpdates = {
      claude: {
        phase: "failed",
        at: new Date().toISOString(),
        detail: "내려받은 파일을 확인하지 못했어요",
      },
    };
  }
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  if (has("check-fail")) {
    handlers.agentUpdate = (_kind: unknown, check: unknown) =>
      check ? Promise.reject(new Error("연결이 닿지 않았습니다")) : {};
  }
  if (has("auto-fail"))
    handlers.machineSet = () => Promise.reject(new Error("저장하지 못했습니다"));
  if (has("fix-reject"))
    handlers.onboardingFix = () => Promise.reject(new Error("연결이 끊겼습니다"));
  if (has("author-fail"))
    handlers.machineAuthorSet = () => Promise.reject(new Error("저장하지 못했습니다"));
  if (has("author-slow")) handlers.machineAuthorSet = () => SETTINGS_DELAY(1500).then(() => ({}));
  if (has("login-fail")) {
    handlers.onboardingFix = () => ({
      started: false,
      guidance:
        "이 에이전트는 로그인을 앱이 대신 시작할 수 없습니다 — 터미널에서 직접 로그인한 뒤 다시 확인해 주세요.",
    });
  }
  const api = new Proxy({} as Record<string, unknown>, {
    get:
      (_target, key: string) =>
      (...args: unknown[]) => {
        calls.push(key);
        const handler = handlers[key] ?? HANDLERS[key];
        try {
          return Promise.resolve(handler?.(...args) ?? {});
        } catch (error) {
          return Promise.reject(error);
        }
      },
  });
  const patch: Record<string, unknown> = { status, api };
  if (has("update-run"))
    patch.install = { kind: "update-claude", line: "Downloading claude 2.2.0" };
  if (has("loading")) patch.status = null;
  // 연결 쪽 — 연결 끊김 · 연결 코드 만료 · 제출하지 않은 작업이 있는 프로젝트(초기화의 규모)
  if (has("offline")) patch.connection = "closed";
  if (has("github-expired")) {
    status.githubAuthExpired = true;
    status.attention = { kind: "reconnect", what: "github", since: new Date().toISOString() };
  }
  if (has("work")) {
    patch.projects = [
      {
        ...PROJECTS[0],
        pendingChanges: 3,
        working: false,
        branch: "colonova-design/me/20261006-1",
        handoff: null,
      },
      {
        ...PROJECTS[1],
        pendingChanges: 0,
        working: false,
        branch: "colonova-design/me/20261005-2",
        handoff: { state: "open" },
      },
    ];
  }
  if (has("install-run"))
    patch.install = { kind: "install-codex", line: "Downloading codex 0.47.0" };
  if (has("install-fail")) {
    patch.installDone = {
      kind: "install-codex",
      ok: false,
      detail:
        "네트워크에 닿지 못했습니다 — 인터넷 연결을 확인한 뒤 다시 시도해 주세요.\ncurl: (6) Could not resolve host: github.com",
    };
  }
  if (has("login-run"))
    patch.login = { url: "https://claude.ai/oauth/authorize?code=true", wantsCode: true };
  return mockDaemon(patch);
}
