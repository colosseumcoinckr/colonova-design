/**
 * 겹판 견본 — 데몬 없이 팝업 · 모달 · 토스트를 한 곳에서 눈으로 보는 페이지(2026-10-06 겹판 손질).
 * 앱과 같은 CSS(테마 · styles.css · next.css)를 올린다. `vite build` 의 입력은 index.html 뿐이라
 * 제품에 실리지 않고, tsconfig 가 dev/ 를 보지 않는다.
 *
 *   ./node_modules/.bin/vite --port 29181 --strictPort --host 127.0.0.1   (packages/web 에서)
 *   → http://127.0.0.1:29181/dev/overlay-fixture.html?case=sheet
 *
 * 주소 끝의 `?case=` 로 표면을, `?theme=dark` 로 테마를 고른다. 표면은 아래 `CASES` 표에 있다 —
 * 새 겹판은 여기에 한 줄 더한다(새 페이지를 만들지 않는다). 화면 밖의 시험이 읽는 상태는
 * `window.__overlay` 에 남는다.
 */

import type { InviteRow } from "@colonova-design/protocol";
import {
  type ComponentType,
  lazy,
  type ReactNode,
  StrictMode,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import type { InviteImportState } from "../src/hooks/use-invite-import";
import type { PinAttachment } from "../src/hooks/usePins";
import type { CrashReport } from "../src/lib/crash";
import {
  applyStoredTheme,
  applyStoredTypeScale,
  type ThemeChoice,
  useSettings,
} from "../src/lib/settings";
import type { ToastNote } from "../src/next/lib/use-shell-nav";
import { Popover } from "../src/next/ui/Popover";
import { Toast } from "../src/next/ui/Toast";
import {
  ago,
  calls,
  INVITE,
  INVITE_ROWS,
  mockDaemon,
  PROJECTS,
  REPO,
  RICH_SCREENS,
  SETTINGS_daemon,
  USER_SCREENS,
} from "./overlay-mocks";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "../src/styles.css";
import "../src/next/next.css";

/**
 * 표면 컴포넌트는 case 가 고른 것만 불러온다 — 한 표면의 파일이 작업 중에 잠깐 깨져도(다른 이가
 * 고치는 중) 나머지 case 의 견본은 살아 있다. 정적 import 였을 때는 어느 표면의 오류든 모든 case 를
 * 죽였다. 새 표면도 `named(() => import(…), "이름")` 로 더한다.
 */
// biome-ignore lint/suspicious/noExplicitAny: 견본의 느슨한 props — 실제 타입은 각 컴포넌트가 지킨다.
const named = (load: () => Promise<Record<string, any>>, name: string) =>
  // biome-ignore lint/suspicious/noExplicitAny: 위와 같다.
  lazy(async () => ({ default: (await load())[name] as ComponentType<any> }));
const ShortcutsSheet = named(
  () => import("../src/components/dialogs/ShortcutsSheet"),
  "ShortcutsSheet",
);
const Palette = named(() => import("../src/components/shell/Palette"), "Palette");
const CrashScreen = named(() => import("../src/next/CrashScreen"), "CrashScreen");
const ConnectingScreen = named(() => import("../src/next/ConnectingScreen"), "ConnectingScreen");
const InviteConfirm = named(() => import("../src/next/onboarding/InviteConfirm"), "InviteConfirm");
const ComparisonDialog = named(
  () => import("../src/next/preview/ComparisonDialog"),
  "ComparisonDialog",
);
const HistoryDrawer = named(() => import("../src/next/preview/HistoryDrawer"), "HistoryDrawer");
const PinBubble = named(() => import("../src/next/preview/PinBubble"), "PinBubble");
const PrepareCard = named(() => import("../src/next/preview/PrepareCard"), "PrepareCard");
const StageNotice = named(() => import("../src/next/preview/PrepareCard"), "StageNotice");
const SettingsDialog = named(() => import("../src/next/settings/SettingsDialog"), "SettingsDialog");
const InviteFlow = named(() => import("./invite-flow-case"), "InviteFlow");
const AskCard = named(() => import("../src/next/chat/cards"), "AskCard");
/** 비교 대화상자를 여는 창 이벤트 — `ComparisonDialog.tsx` 의 EVENT 와 같은 이름. */
const openComparison = (detail: {
  route: string;
  title: string;
  requestId?: string;
  sha?: string;
  submitted?: boolean;
}) => window.dispatchEvent(new CustomEvent("nx:comparison:open", { detail }));

applyStoredTheme();
applyStoredTypeScale();
const query = new URLSearchParams(location.search);
const theme = query.get("theme");
if (theme) document.documentElement.dataset.theme = theme;
const CASE = query.get("case") ?? "sheet";
// 충돌 화면: `?booted=1` 은 마운트를 마친 뒤의 사고(문구가 「화면에 문제가 생겼어요」), `?repeat=1` 은
// 직전 실행도 사고로 끝난 경우(같은 문제가 계속 생겨요 — 저장소가 태어나기 전에 미러를 심어 둔다).
if (query.get("booted") === "1") document.documentElement.dataset.appMounted = "1";
if (query.get("repeat") === "1") {
  localStorage.setItem(
    "colonova-design.last-crash",
    JSON.stringify({ source: "render", message: "이전 실행의 사고", time: Date.now() - 4000 }),
  );
}

const CRASH: CrashReport = {
  source: "render",
  message: "Cannot read properties of undefined (reading 'name')",
  stack:
    "TypeError: Cannot read properties of undefined (reading 'name')\n    at ProjectCard (app.js:120:14)\n    at renderWithHooks (react-dom.js:15486:18)",
  componentStack: "\n    at ProjectCard\n    at Sidebar\n    at Workspace",
  time: Date.now(),
} as CrashReport;

function Sheet() {
  const [open, setOpen] = useState(true);
  return <ShortcutsSheet open={open} onClose={() => setOpen(false)} />;
}

/**
 * 찾기(⌘K) 견본 — `?activate=reject|slow` 는 프로젝트 줄을 눌렀을 때(실패 · 1.5초 걸림), `?many=1` 은
 * 도는 대화 · 기다리는 대화 · 90자 제목 · 대화 내용에서 맞는 줄이 든 더 풍성한 재료, `?lite=1` 은 대화가
 * 없는 프로젝트(빈 상태). 누른 일은 `window.__overlay.calls` 에 남는다. 닫은 뒤 「다시 열기」로 나감 · 들어옴을 본다.
 */
const LONG_TITLE =
  "[최종 홈 검증] 파일·화면·설정 변경과 제출 없이 정확히 “최종 확인 완료”만 답해주세요 — 결제 내역 화면의 월별 묶음을 확인합니다.";
const paletteProjects = () => {
  const base = (PROJECTS as unknown as Array<Record<string, unknown>>).map((project) => ({
    phase: "ready",
    working: false,
    pendingCount: 0,
    pendingChanges: 0,
    handoff: null,
    ...project,
  }));
  if (query.get("lite") === "1") return [{ ...base[0], threads: [] }, base[1]] as never;
  if (query.get("many") !== "1") return base as never;
  const first = base[0] as Record<string, unknown> & { threads: Array<Record<string, unknown>> };
  const second = base[1] as Record<string, unknown> & { threads: Array<Record<string, unknown>> };
  return [
    {
      ...first,
      threads: [
        { ...first.threads[0], id: "t1", state: "running" },
        {
          id: "t9",
          title: "결제 수단 아이콘을 카드 이름 옆으로 옮겨 줘",
          state: "awaiting",
          updatedAt: ago(18),
        },
        { id: "t10", title: LONG_TITLE, state: "idle", updatedAt: ago(60) },
        ...first.threads.slice(1),
      ],
    },
    {
      ...second,
      working: true,
      threads: [
        { id: "s9", title: "정산 화면의 합계 줄 정렬", state: "awaiting", updatedAt: ago(75) },
        ...second.threads,
      ],
    },
    {
      slug: "blog-site",
      name: "블로그 사이트",
      phase: "cloning",
      working: false,
      pendingCount: 0,
      pendingChanges: 0,
      handoff: null,
      threads: [],
    },
    {
      slug: "docs",
      name: "도움말 센터",
      phase: "ready",
      working: false,
      pendingCount: 2,
      pendingChanges: 0,
      handoff: null,
      threads: [],
    },
  ] as never;
};
const paletteTranscripts = () =>
  query.get("many") === "1"
    ? ({
        t3: {
          blocks: [
            {
              type: "user",
              id: "b1",
              text: "로그인 화면의 오류 문구가 너무 딱딱해요. 결제 화면의 문구처럼 부드럽게 바꿔 주세요.",
            },
          ],
        },
      } as never)
    : ({} as never);

function PaletteCase() {
  const [open, setOpen] = useState(true);
  const projects = useMemo(paletteProjects, []);
  const transcripts = useMemo(paletteTranscripts, []);
  const mode = query.get("activate");
  return open ? (
    <Palette
      titleForThread={(t: { title: string }) => t.title}
      activeSessionId="t1"
      projects={projects}
      hiddenThreads={{ has: () => false } as never}
      transcripts={transcripts}
      activeSlug="colonova-cdp"
      onOpenThread={(slug: string, thread: { id: string }) =>
        calls.push(`open:${slug}:${thread.id}`)
      }
      onCreateSession={() => calls.push("new")}
      onOpenHome={() => calls.push("home")}
      onActivateProject={(slug: string) => {
        calls.push(`activate:${slug}`);
        return new Promise<boolean>((resolve, reject) =>
          window.setTimeout(
            () => (mode === "reject" ? reject(new Error("옮기지 못함")) : resolve(true)),
            mode === "reject" ? 700 : mode === "slow" ? 1500 : 0,
          ),
        );
      }}
      onOpenSettings={() => calls.push("settings")}
      onClose={() => setOpen(false)}
    />
  ) : (
    <button type="button" className="nx-btn" id="reopen" onClick={() => setOpen(true)}>
      팔레트 다시 열기
    </button>
  );
}

function ToastCase() {
  const [toast, setToast] = useState<ToastNote | null>(null);
  const seq = useRef(0);
  const fire = (text: string) => {
    seq.current += 1;
    setToast({ text, seq: seq.current });
  };
  return (
    <div style={{ padding: 24, display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button
        type="button"
        className="nx-btn"
        id="t-short"
        onClick={() => fire("옮겼어요 · colonova-cdp")}
      >
        짧은 토스트
      </button>
      <button
        type="button"
        className="nx-btn"
        id="t-long"
        onClick={() =>
          fire(
            "옮겼어요 · 상점 관리자 · 미리보기는 보던 자리 그대로예요. 이 문장은 일부러 길게 써서 두 줄까지 읽히는지, 그 너머는 말줄임으로 잘리는지 본다 — 한 줄에서 끝나지 않는 문장.",
          )
        }
      >
        긴 토스트
      </button>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function PopCase() {
  const [open, setOpen] = useState<string | null>(null);
  const refs = {
    start: useRef<HTMLSpanElement>(null),
    end: useRef<HTMLSpanElement>(null),
    up: useRef<HTMLSpanElement>(null),
    float: useRef<HTMLSpanElement>(null),
    menu: useRef<HTMLSpanElement>(null),
  };
  const toggle = (key: keyof typeof refs) => setOpen(open === key ? null : key);
  const item = (text: string, hint?: string) => (
    <button
      type="button"
      className="nx-mi"
      role="menuitem"
      key={text}
      onClick={() => setOpen(null)}
    >
      <span className="nx-mt">
        <b>{text}</b>
        {hint && <small>{hint}</small>}
      </span>
    </button>
  );
  const anchor = (key: keyof typeof refs, label: string, extra: ReactNode) => (
    <span className="nx-anchor" ref={refs[key]} style={{ display: "inline-block" }}>
      <button
        type="button"
        className="nx-btn"
        id={`p-${key}`}
        aria-expanded={open === key}
        onClick={() => toggle(key)}
      >
        {label}
      </button>
      {open === key && extra}
    </span>
  );
  return (
    <div
      style={{
        padding: 40,
        display: "flex",
        gap: 24,
        alignItems: "flex-start",
        flexWrap: "wrap",
        minHeight: "100vh",
      }}
    >
      {anchor(
        "start",
        "아래 · 왼쪽 맞춤",
        <Popover anchor={refs.start} onClose={() => setOpen(null)} label="예시">
          {item("이름 바꾸기")}
          {item("복제하기", "같은 내용으로 새 대화")}
          {item("지우기")}
        </Popover>,
      )}
      {anchor(
        "end",
        "아래 · 오른쪽 맞춤",
        <Popover anchor={refs.end} onClose={() => setOpen(null)} align="end" label="예시">
          {item("이름 바꾸기")}
          {item("복제하기")}
        </Popover>,
      )}
      {anchor(
        "menu",
        "메뉴(화살표 걸음)",
        <Popover anchor={refs.menu} onClose={() => setOpen(null)} role="menu" label="메뉴 예시">
          {item("첫째 줄")}
          {item("둘째 줄", "설명이 붙은 줄")}
          {item("셋째 줄")}
          {item("바나나")}
        </Popover>,
      )}
      <div style={{ position: "fixed", left: 40, bottom: 40 }}>
        {anchor(
          "up",
          "위로 열기",
          <Popover anchor={refs.up} onClose={() => setOpen(null)} up label="예시">
            {item("위로 선 첫 줄")}
            {item("위로 선 둘째 줄")}
          </Popover>,
        )}
      </div>
      <div style={{ position: "fixed", right: 40, bottom: 40 }}>
        {anchor(
          "float",
          "창 기준(float · 위)",
          <Popover
            anchor={refs.float}
            onClose={() => setOpen(null)}
            float
            up
            align="end"
            label="예시"
          >
            {item("창 기준 첫 줄")}
            {item("창 기준 둘째 줄")}
          </Popover>,
        )}
      </div>
    </div>
  );
}

function SettingsCase() {
  const { settings, update } = useSettings();
  const [open, setOpen] = useState(true);
  // `?state=app-new,check-fail` — 상태 이름은 overlay-mocks.ts 의 SETTINGS_daemon 이 푼다.
  const daemon = useMemo(
    () => SETTINGS_daemon((query.get("state") ?? "").split(",").filter(Boolean)),
    [],
  );
  // 쿼리의 테마를 저장 값으로 — useSettings 가 html 의 data-theme 을 저장 값에서 다시 칠한다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 처음 한 번만
  useEffect(() => {
    if (theme) update({ theme: theme as ThemeChoice });
    // 고른 AI 가 못 쓰는 AI 인 상태(`codex-picked`) — 설정 값이라 데몬 가짜가 아니라 여기서 건다.
    if ((query.get("state") ?? "").split(",").includes("codex-picked")) {
      update({ chat: { ...settings.chat, provider: "codex" } });
    }
  }, []);
  return open ? (
    <SettingsDialog
      daemon={daemon}
      settings={settings}
      onChatChange={(patch) => update({ chat: { ...settings.chat, ...patch } })}
      onSettingsChange={update}
      onClose={() => setOpen(false)}
    />
  ) : (
    <button type="button" className="nx-btn" id="reopen" onClick={() => setOpen(true)}>
      설정 다시 열기
    </button>
  );
}

/**
 * 초대 확인판 견본(F) — `?phase=reading|confirm|applying|done|error` 로 단계를, 곁 쿼리로 변주를 고른다:
 *   `&rows=many`(행 여덟 — 푸터 고정 확인) · `&variant=partial|failed|token|warn|detail|noauthor|readme|plain`
 *   · `&offline=1`(데몬 연결 끊김 — 가져오기 잠금) · `&trash=fail`(휴지통 실패) · `&nodesktop=1`(브라우저 개발 경로)
 *   · `&live=1`(`가져오기` 를 누르면 적용 중 → 결과로 실제로 넘어간다).
 * 데스크톱의 `invite.discard` 는 가짜다 — 0.5초 뒤 풀리고, 호출은 `__overlay.calls` 에 남는다.
 */
function InviteCase() {
  const initial = query.get("phase") ?? "confirm";
  const variant = query.get("variant") ?? "";
  const many = query.get("rows") === "many";
  const offline = query.get("offline") === "1";
  const live = query.get("live") === "1";
  const base = useMemo(() => mockDaemon(), []);
  const daemon = useMemo(
    () =>
      mockDaemon({
        connection: offline ? "closed" : "open",
        status: { ...base.status, authorName: variant === "noauthor" ? null : "정인권" },
        // 바뀜 행의 「무엇이 바뀌는가」 — 짝의 지금 기본 가지가 초대장과 다르다.
        projects: base.projects.map((entry) =>
          entry.slug === "shop-admin" ? { ...entry, baseBranch: "main" } : entry,
        ),
      }),
    [offline, variant, base],
  );
  // 데스크톱 다리의 가짜 — 확인판의 파일 정리가 이것을 본다.
  useMemo(() => {
    if (query.get("nodesktop") === "1") return;
    Object.assign(window, {
      colonovaDesignDesktop: {
        platform: "darwin",
        invite: {
          discard: (file: string) => {
            calls.push(`discard:${file}`);
            return new Promise<void>((resolve, reject) =>
              window.setTimeout(
                () => (query.get("trash") === "fail" ? reject(new Error("busy")) : resolve()),
                500,
              ),
            );
          },
        },
      },
    });
  }, []);
  const [open, setOpen] = useState(true);
  const path = "/Users/me/Downloads/회원 관리.colonova-invite";
  const project = (name: string, slug: string) =>
    ({
      repoUrl: `https://github.com/colosseum/${slug}`,
      name,
      baseBranch: "main",
      approveCommands: false,
    }) as never;
  const rows: InviteRow[] = many
    ? [
        { action: "add", project: project("고객 센터", "support") },
        { action: "add", project: project("정산 대시보드", "settle-board") },
        ...INVITE_ROWS,
        {
          action: "update",
          project: project("쿠폰 관리", "coupon"),
          slug: "coupon",
          currentName: "쿠폰 관리",
        },
        {
          action: "keep",
          project: project("공지 사이트", "notice"),
          slug: "notice",
          currentName: "공지 사이트",
        },
        {
          action: "keep",
          project: project("사내 위키", "wiki"),
          slug: "wiki",
          currentName: "사내 위키",
        },
        {
          action: "keep",
          project: project("채용 페이지", "careers"),
          slug: "careers",
          currentName: "채용 페이지",
        },
      ]
    : INVITE_ROWS;
  const invite =
    variant === "readme"
      ? { ...INVITE, readme: "새 분기 초대장이에요.\n문서 포털은 이번에 그대로예요." }
      : variant === "noauthor"
        ? { ...INVITE, authorName: undefined }
        : INVITE;
  const warn = "‘상점 관리자’ 프로젝트는 새 연결 코드로 제출할 수 없어요 — 개발자에게 알려 주세요.";
  const stateFor = (phase: string): InviteImportState => {
    if (phase === "reading") return { phase: "reading" };
    if (phase === "applying")
      return { phase: "applying", invite, rows, firstRun: false, done: 1, path };
    if (phase === "error") {
      return variant === "detail"
        ? {
            phase: "error",
            error:
              "초대 파일의 내용에 문제가 있어요 — 개발자에게 다시 만들어 달라고 부탁해 주세요.",
            detail: "프로젝트는 최대 20개까지입니다",
            firstRun: false,
          }
        : {
            phase: "error",
            error: "초대 파일을 읽지 못했어요 — 개발자에게 파일을 다시 보내 달라고 부탁해 주세요.",
            firstRun: false,
          };
    }
    if (phase === "done") {
      if (variant === "token") {
        return {
          phase: "done",
          invite,
          firstRun: false,
          path,
          result: {
            tokenError:
              "개발자에게 받은 코드가 이 레포에 닿지 않습니다 — 개발자에게 새 초대 파일을 요청하세요.",
            results: [],
            reachWarnings: [],
          },
        };
      }
      if (variant === "partial" || variant === "failed") {
        return {
          phase: "done",
          invite,
          firstRun: false,
          path,
          result: {
            results: rows.map((row, index) => ({
              row,
              ok: variant === "partial" ? index !== 0 && index !== 3 : false,
              ...(variant === "partial"
                ? index === 0 || index === 3
                  ? { error: "이미 같은 이름의 프로젝트가 있습니다" }
                  : {}
                : { error: "연결이 끊어졌습니다 — 잠시 뒤 대화나 화면을 다시 확인해 주세요" }),
            })),
            reachWarnings: variant === "partial" ? [warn] : [],
          },
        };
      }
      return {
        phase: "done",
        invite,
        firstRun: false,
        path,
        result: {
          results: rows.map((row) => ({ row, ok: true })),
          reachWarnings: variant === "warn" ? [warn] : [],
        },
      };
    }
    return { phase: "confirm", invite, rows, firstRun: false, path };
  };
  const [state, setState] = useState<InviteImportState>(() => stateFor(initial));
  const timers = useRef<number[]>([]);
  const run = () => {
    for (const timer of timers.current) window.clearTimeout(timer);
    setState({ phase: "applying", invite, rows, firstRun: false, done: 0, path });
    rows.forEach((_, index) => {
      timers.current.push(
        window.setTimeout(
          () =>
            setState((prev) => (prev.phase === "applying" ? { ...prev, done: index + 1 } : prev)),
          700 * (index + 1),
        ),
      );
    });
    timers.current.push(
      window.setTimeout(() => setState(stateFor("done")), 700 * rows.length + 500),
    );
  };
  return open ? (
    <InviteConfirm
      daemon={daemon}
      state={state}
      onApply={() => {
        calls.push("apply");
        if (live) run();
      }}
      onRetry={() => {
        calls.push("retry");
        if (live) run();
      }}
      onClose={() => setOpen(false)}
      onOpenPicker={() => calls.push("picker")}
      onDiscarded={() => calls.push("discarded")}
    />
  ) : (
    <button
      type="button"
      className="nx-btn"
      id="reopen"
      onClick={() => {
        setState(stateFor(initial));
        setOpen(true);
      }}
    >
      확인판 다시 열기
    </button>
  );
}

/** `?state=loading|failed|failonce|nobefore|noafter|none`(사진 상태는 overlay-mocks) · `?submitted=1`(마지막 제출과 비교). */
function CompareCase() {
  const daemon = useMemo(() => mockDaemon(), []);
  const submitted = query.get("submitted") === "1";
  const open = () =>
    openComparison({
      route: "/members",
      title: "회원 목록",
      requestId: "r1",
      sha: "abc1234",
      submitted,
    });
  // biome-ignore lint/correctness/useExhaustiveDependencies: 처음 한 번만
  useEffect(() => {
    const timer = window.setTimeout(open, 50);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div style={{ padding: 24 }}>
      <button type="button" className="nx-btn" id="reopen" onClick={open}>
        비교 다시 열기
      </button>
      <ComparisonDialog daemon={daemon} />
    </div>
  );
}

/** `···` 메뉴의 줄에서 연 비교 — 줄이 사라진 뒤에도 닫으면 초점이 `···` 단추로 돌아와야 한다(2026-10-06). */
function CompareMoreCase() {
  const daemon = useMemo(() => mockDaemon(), []);
  const [more, setMore] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  return (
    <div style={{ position: "fixed", top: 24, right: 24 }}>
      <div className="nx-anchor" ref={anchor}>
        <button
          type="button"
          className="nx-ibtn"
          id="more"
          aria-label="더 보기"
          aria-haspopup="dialog"
          aria-expanded={more}
          onClick={() => setMore((value) => !value)}
        >
          ···
        </button>
        {more && (
          <Popover anchor={anchor} onClose={() => setMore(false)} align="end" label="더 보기">
            <button
              type="button"
              className="nx-mi"
              id="more-compare"
              onClick={() => {
                setMore(false);
                openComparison({
                  route: "/members",
                  title: "회원 목록",
                  sha: "abc1234",
                  submitted: true,
                });
              }}
            >
              마지막 제출과 비교
            </button>
          </Popover>
        )}
      </div>
      <ComparisonDialog daemon={daemon} />
    </div>
  );
}

/**
 * `?col=360`(칸의 폭 — 480 이하면 시트) · `?hist=loading|fail|empty|now|rich|user`(읽기) · `?restore=fail|slow`(되돌리기)
 * · `?working=1`(AI 작업 중이라 잠김) · `?arm=a2&count=1`(결과 카드의 `방금 한 것 되돌리기` 가 건넨 되돌아갈 곳 — 그 줄의
 * 확인이 `방금 한 것을 되돌릴까요?` 로 미리 열린다. `count` 가 지금 기록과 안 맞으면 줄의 제목으로 묻는다). 단추 셋 — `홈으로`(칸이 숨는다 — 열린 서랍은 접혀야 한다) ·
 * `작업으로` · `프로젝트 바꾸기`(다른 프로젝트의 기록은 0.6초 뒤에 온다 — 그동안 지난 프로젝트의 줄이 비치면 안 된다).
 */
function HistoryCase() {
  const working = query.get("working") === "1";
  const dataset = query.get("hist");
  const rich = dataset === "rich";
  const [slug, setSlug] = useState("colonova-cdp");
  const [home, setHome] = useState(false);
  Object.assign(window, { __histProject: slug });
  const daemon = useMemo(
    () =>
      mockDaemon({
        activeSlug: slug,
        ...(working
          ? { projects: PROJECTS.map((project) => ({ ...project, working: true })) }
          : {}),
      }),
    [working, slug],
  );
  const repo = rich
    ? ({ ...REPO, pendingChanges: 9, cycleScreens: RICH_SCREENS } as typeof REPO)
    : dataset === "user"
      ? ({ ...REPO, pendingChanges: 10, cycleScreens: USER_SCREENS } as typeof REPO)
      : REPO;
  const [open, setOpen] = useState(true);
  const opener = useRef<HTMLButtonElement>(null);
  const col = Number(query.get("col")) || 520;
  const armQuery = query.get("arm");
  const armOf = () =>
    armQuery ? { sha: armQuery, count: Number(query.get("count") ?? "-1") } : null;
  const [arm, setArm] = useState(armOf);
  return (
    <div style={{ padding: 24 }}>
      <button
        type="button"
        className="nx-btn"
        id="reopen"
        ref={opener}
        onClick={() => setOpen(true)}
      >
        작업 기록 열기
      </button>
      {armQuery && (
        <button
          type="button"
          className="nx-btn"
          id="arm"
          onClick={() => {
            setArm(armOf());
            setOpen(true);
          }}
        >
          방금 한 것 되돌리기
        </button>
      )}
      <button type="button" className="nx-btn" id="go-home" onClick={() => setHome(true)}>
        홈으로
      </button>
      <button type="button" className="nx-btn" id="back-work" onClick={() => setHome(false)}>
        작업으로
      </button>
      <button
        type="button"
        className="nx-btn"
        id="switch"
        onClick={() => setSlug((now) => (now === "colonova-cdp" ? "shop-admin" : "colonova-cdp"))}
      >
        프로젝트 바꾸기
      </button>
      <input id="home-input" placeholder="홈의 입력칸" />
      <div className={home ? "nx-offstage" : undefined}>
        <section
          className="nx-preview"
          style={{ width: col, height: 720, marginTop: 16, border: "1px solid var(--line)" }}
        >
          <div className="nx-pvbar" />
          <HistoryDrawer
            open={open}
            offstage={home}
            onClose={() => setOpen(false)}
            daemon={daemon}
            repo={repo}
            submits={rich ? [ago(100), ago(1440 + 200)] : [ago(100)]}
            onRestored={() => calls.push("restored")}
            toast={(text) => calls.push(`toast:${text}`)}
            returnRef={opener}
            arm={arm}
            onArmed={() => setArm(null)}
          />
        </section>
      </div>
      {/* 서랍의 `수정 전·후 보기` 가 여는 비교 — 실제 칸(PreviewColumn)도 둘을 함께 마운트한다. */}
      <ComparisonDialog daemon={daemon} />
    </div>
  );
}

const PIN: PinAttachment = {
  id: "p1",
  screen: "/members",
  note: "",
  element: {
    component: "button",
    text: "검색",
    path: "body > main > form > button",
    rect: { x: 300, y: 190, width: 88, height: 44 },
    a11y: { role: "button", name: "검색" },
    attrs: { classes: ["btn", "btn-primary"] },
    styles: { color: "rgb(255, 255, 255)", fontSize: "16px", padding: "10px 16px" },
  },
};

/**
 * `?x=` `?y=`(요소의 칸 안 자리 — 기본 40 · 150) · `?col=` `?h=`(칸의 크기 — 520 × 720) · `?note=`(적힌 메모) ·
 * `?rich=1`(요소 정보를 열세 줄로 — 칸보다 길 때 안쪽이 굴러가는지 본다). 위쪽 열기는 `?y=600` 처럼 바닥 가까이.
 */
function PinCase() {
  const [open, setOpen] = useState(true);
  const [note, setNote] = useState(query.get("note") ?? "");
  const x = Number(query.get("x") ?? 40);
  const y = Number(query.get("y") ?? 150);
  const col = Number(query.get("col")) || 520;
  const height = Number(query.get("h")) || 720;
  const rich = query.get("rich") === "1";
  const pin: PinAttachment = {
    ...PIN,
    note,
    element: {
      ...PIN.element,
      rect: { x: 0, y: 0, width: 88, height: 44 },
      styles: rich
        ? {
            color: "rgb(255, 255, 255)",
            "background-color": "rgb(44, 107, 214)",
            "font-family": "Pretendard, system-ui, sans-serif",
            "font-size": "16px",
            "font-weight": "600",
            "line-height": "24px",
            padding: "10px 18px",
            margin: "0px 0px 0px 12px",
            "border-radius": "8px",
            display: "inline-flex",
            width: "88px",
            height: "44px",
            gap: "6px",
          }
        : PIN.element.styles,
    },
  };
  return (
    <div style={{ padding: 24 }}>
      <button type="button" className="nx-btn" id="reopen" onClick={() => setOpen(true)}>
        말풍선 다시 열기
      </button>
      <section
        className="nx-preview"
        style={{ width: col, height, marginTop: 16, border: "1px solid var(--line)" }}
      >
        <div className="nx-pvbar" />
        <div
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: 88,
            height: 44,
            display: "grid",
            placeItems: "center",
            background: "#2c6bd6",
            color: "#fff",
            borderRadius: 8,
          }}
        >
          검색
        </div>
        {open && (
          <PinBubble
            pin={pin}
            n={1}
            screenName="회원 목록"
            frame={{ left: x, top: y }}
            zoom={1}
            box={{ width: col, height }}
            narrow={false}
            onNote={setNote}
            onRemove={() => setOpen(false)}
            onClose={() => setOpen(false)}
            toast={(text) => calls.push(`toast:${text}`)}
          />
        )}
      </section>
    </div>
  );
}

/**
 * 준비 · 상태 덮개 — `?kind=prepare|finale|restarting|fixing|failed`(기본 prepare) · `?phase=cloning|installing|starting`
 * · `?first=0`(다시 켜는 준비) · `?col=`(칸의 폭 — 520). 무대(`.nx-pvstage`) 위의 덮개(`.nx-over`)와 같은 틀이다.
 */
function PrepareCase() {
  const kind = query.get("kind") ?? "prepare";
  const phase = query.get("phase") ?? "installing";
  const col = Number(query.get("col")) || 520;
  const [attempts, setAttempts] = useState(0);
  const since = useMemo(() => new Date(Date.now() - 65_000).toISOString(), []);
  const fixingSince = useMemo(() => Date.now() - 130_000, []);
  return (
    <div style={{ padding: 24 }}>
      <section
        className="nx-preview"
        style={{ width: col, height: 560, border: "1px solid var(--line)" }}
      >
        <div className="nx-pvbar" />
        <div className="nx-pvstage">
          <div className="nx-over">
            {kind === "prepare" || kind === "finale" ? (
              <PrepareCard
                phase={phase}
                phaseSince={since}
                first={query.get("first") !== "0"}
                finale={kind === "finale"}
              />
            ) : (
              <StageNotice
                kind={kind as "restarting" | "fixing" | "failed"}
                since={kind === "fixing" ? fixingSince : undefined}
                onRetry={() => {
                  calls.push("retry");
                  setAttempts((n) => n + 1);
                }}
              />
            )}
          </div>
        </div>
      </section>
      <output id="attempts" style={{ display: "none" }}>
        {attempts}
      </output>
    </div>
  );
}

/** 표면 표 — 새 겹판은 한 줄 더한다. 값은 그 표면을 그리는 컴포넌트다. */
/**
 * 확인 카드(질문 · 허락) — 대화록 안에 서는 그대로(2026-10-06 겹판 손질 C).
 * `?kind=single|chips|multi|multichips|two|permission` 으로 모양을, `?fail=1` 은 전하지 못함(실패 줄),
 * `?hang=1` 은 보내는 중에 머문다(도는 표시), `?w=` 는 칸의 폭. 보낸 답은 `window.__overlay.calls` 에 남는다.
 */
function AskCase() {
  const kind = query.get("kind") ?? "single";
  const width = Number(query.get("w")) || 420;
  const fail = query.get("fail") === "1";
  const hang = query.get("hang") === "1";
  const option = (label: string, description = "") => ({ label, description });
  const place = {
    question: "회원 목록의 검색창을 어디에 둘까요?",
    header: "위치",
    multiSelect: false,
    options: [
      option("표 위에", "표 바로 위 한 줄에 둬요. 가장 눈에 잘 띄어요."),
      option("화면 위쪽 머리에", "제목 오른쪽에 작게 둬요. 자리를 덜 차지해요."),
      option("왼쪽 옆 칸에", "옆 칸의 맨 위에 둬요."),
    ],
  };
  const chips = {
    question: "검색창에 어떤 안내 글을 넣을까요?",
    header: "안내 글",
    multiSelect: false,
    options: [option("이름으로 찾기"), option("회원 검색"), option("무엇을 찾으세요?")],
  };
  const columns = {
    question: "표에 보일 칸을 모두 골라 주세요.",
    header: "칸",
    multiSelect: true,
    options: [
      option("이름", "회원의 이름이에요."),
      option("연락처", "전화번호와 이메일이에요."),
      option("가입일", "가입한 날짜예요."),
      option("등급", "일반 · 우수 · 최우수예요."),
    ],
  };
  const columnChips = {
    question: "검색 결과에 보일 칸을 모두 골라 주세요.",
    header: "칸",
    multiSelect: true,
    options: [option("이름"), option("연락처"), option("가입일"), option("등급")],
  };
  const questions =
    kind === "chips"
      ? [chips]
      : kind === "multi"
        ? [columns]
        : kind === "multichips"
          ? [columnChips]
          : kind === "two"
            ? [place, columnChips]
            : [place];
  const request =
    kind === "permission"
      ? {
          kind: "permission",
          requestId: "p1",
          sessionId: "t1",
          toolName: "Bash",
          input: { command: "pnpm test" },
        }
      : { kind: "question", requestId: "q1", sessionId: "t1", questions };
  return (
    <section className="nx-chat" style={{ width, margin: "24px auto" }}>
      <div className="nx-transcript">
        <div className="nx-thread">
          <AskCard
            request={request}
            onQuestion={(answers: unknown) => {
              calls.push(`answer:${JSON.stringify(answers)}`);
              if (hang) return new Promise<void>(() => undefined);
              return fail ? Promise.reject(new Error("fixture")) : Promise.resolve();
            }}
            onPermission={(decision: string) => {
              calls.push(`permission:${decision}`);
              return hang ? new Promise<void>(() => undefined) : Promise.resolve();
            }}
          />
        </div>
      </div>
    </section>
  );
}

const CASES: Record<string, () => ReactNode> = {
  sheet: () => <Sheet />,
  palette: () => <PaletteCase />,
  crash: () => <CrashScreen report={CRASH} />,
  connecting: () => <ConnectingScreen onRetry={() => calls.push("retry")} />,
  toast: () => <ToastCase />,
  pop: () => <PopCase />,
  settings: () => <SettingsCase />,
  invite: () => <InviteCase />,
  // 진짜 `useInviteImport` 로 파일을 읽고 확인하고 적용한다(`dev/invite-flow-case.tsx`).
  inviteflow: () => <InviteFlow />,
  compare: () => <CompareCase />,
  "compare-more": () => <CompareMoreCase />,
  history: () => <HistoryCase />,
  pin: () => <PinCase />,
  prepare: () => <PrepareCase />,
  ask: () => <AskCase />,
};

Object.assign(window, { __overlay: { cases: Object.keys(CASES), current: CASE, calls } });

const Case = CASES[CASE] ?? CASES.sheet;
createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Suspense fallback={null}>
      {/* 충돌 · 연결 안내판은 실제 앱에서 `.nx` 밖(AppCrashBoundary · App)에 그려진다 — 견본도 같게. */}
      {CASE === "crash" || CASE === "connecting" ? (
        Case?.()
      ) : (
        <div className="nx" style={{ minHeight: "100vh" }}>
          {Case?.()}
        </div>
      )}
    </Suspense>
  </StrictMode>,
);
