/**
 * 미리보기 막대 견본 — 데몬 없이 `PreviewBar` 를 여러 상태와 폭으로 눈으로 보는 페이지. 앱과 같은
 * CSS(테마 · styles.css · next.css→preview.css)를 올리고, 막대 밑에 연결 서비스의 화면을
 * 흉내 낸 가짜 무대를 깔아 막대와 무대가 만나는 모습까지 본다. `vite build` 의 입력은
 * index.html 뿐이라 제품에 실리지 않고, tsconfig 가 dev/ 를 보지 않는다.
 *
 *   ./node_modules/.bin/vite --port 29181 --strictPort --host 127.0.0.1   (packages/web 에서)
 *   → http://127.0.0.1:29181/dev/preview-fixture.html
 *
 * 주소 끝의 `?theme=dark` 처럼 테마를, `?case=a,c` 로 보고 싶은 사례만, `?w=1100` 으로 넓은 벌의
 * 폭을, `?sweep=1` 로 같은 상태를 막대 폭 여덟 가지로 늘어놓는다. 반응은 살아 있다: 새로 고침은
 * 3초 불러오는 중이 되고, 기기 · 찍기 · 기록 단추는 눌린 대로 선다.
 *
 * 라이브감(2026-10-08 베타 준비 분석) 사례 q–u 는 진짜 `useLiveFollow` 훅과 `LiveLayer` 를 마운트한다(모의 신호를 훅에
 * 먹이는 작은 하네스 `LiveRow`). 신호는 `window.__live[사례 id]` 로 주입한다 — `drive(on)` 는 `browser.driving`,
 * `edit(route, title)` 는 `session.editing`, `touch()` 는 사용자가 미리보기를 만짐, `newTurn()` 은 새 턴. `?play=1` 이면 사례의
 * 대본이 저절로 재생된다. 사례 w 는 **진짜 `PreviewColumn`** 을 모의 데몬으로 마운트한다(브라우저 경로 — iframe): 안쪽 화면은
 * `?guest=http://127.0.0.1:포트` 의 서버가 그리고(주소의 경로를 그대로 보여 주는 서버면 된다), 신호는 같은 `window.__live.w` 로
 * 먹인다 — 칸의 손(`noteUser`)과 훅의 이음매를 눈으로 확인한다.
 */

import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Sessions } from "../src/hooks/useSessions";
import type { EditingScreen } from "../src/lib/daemon-client";
import { applyStoredTheme, applyStoredTypeScale, type Settings } from "../src/lib/settings";
import { HistoryDrawer } from "../src/next/preview/HistoryDrawer";
import { LiveLayer } from "../src/next/preview/LiveLayer";
import { PreviewBar, type ScreenRow } from "../src/next/preview/PreviewBar";
import { PreviewColumn } from "../src/next/preview/PreviewColumn";
import type { PreviewDevice } from "../src/next/preview/PreviewHost";
import { useLiveFollow } from "../src/next/preview/use-live-follow";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "../src/styles.css";
import "../src/next/next.css";
import { mockDaemon, REPO } from "./overlay-mocks";

applyStoredTheme();
applyStoredTypeScale();
const query = new URLSearchParams(location.search);
const theme = query.get("theme");
if (theme) document.documentElement.dataset.theme = theme;
const WIDE = Number(query.get("w")) || 1100;
/** 서랍이 읽는 가짜 데몬 — 기록 · 화면은 overlay-mocks 의 것(견본 `overlay-fixture.html?case=history` 와 같다). */
const DAEMON = mockDaemon();
const SUBMITS = [new Date(Date.now() - 100 * 60_000).toISOString()];

const MINE: ScreenRow[] = [
  { path: "/", name: "첫 화면", modified: true },
  { path: "/members", name: "회원 목록", modified: true },
];
const OTHERS: ScreenRow[] = [
  { path: "/billing", name: "결제 내역" },
  { path: "/wms/inbound", name: "입고 목록" },
  { path: "/wms/stock", name: "재고 현황" },
];

interface Case {
  id: string;
  label: string;
  width?: number;
  height?: number;
  screenName?: string;
  currentPath?: string;
  mine?: ScreenRow[];
  loading?: boolean;
  pinOn?: boolean;
  pinCount?: number;
  pinLocked?: string | null;
  historyOpen?: boolean;
  zoom?: number;
  device?: PreviewDevice;
  canBack?: boolean;
  /** 1 이면 주소 목록이 열린 채 시작한다(⌘L 의 신호). */
  addrOpen?: boolean;
  /** 있으면 진짜 훅을 마운트하는 라이브감 사례다. */
  live?: LiveSpec;
}

/** 라이브감 사례 — 훅에 먹일 모의 신호의 시작 상태와 `?play=1` 의 대본. */
interface LiveSpec {
  /** 처음에 서 있는 화면 경로. */
  start?: string;
  /** 이번 턴에 이미 미리보기를 만진 채로 시작한다. */
  touched?: boolean;
  /** 처음부터 AI 가 화면을 누르는 중이다. */
  driving?: boolean;
  /** 처음부터 받은 `session.editing` 신호(막 도착한 것). */
  editing?: { route: string; title: string | null };
  /** 찍기가 켜져 있다 — 따라가기 · 라이브 한 줄이 비켜 서는 것을 본다. */
  pin?: boolean;
  /** 자동 재생의 걸음. */
  script?: Array<{
    at: number;
    drive?: boolean;
    edit?: { route: string; title: string | null };
    touch?: boolean;
  }>;
}

/** 견본의 화면 이름 — 칸이 아는 이름(`titleOf`)의 자리다. */
const NAMES: Record<string, string> = {
  "/": "첫 화면",
  "/members": "회원 목록",
  "/billing": "결제 내역",
  "/wms/inbound": "입고 목록",
  "/wms/stock": "재고 현황",
};

const BASE_CASES: Case[] = [
  { id: "a", label: "a · 스크린샷의 그 상태 — 첫 화면 · 찍기 꺼짐", mine: [], canBack: false },
  { id: "b", label: "b · 이 대화에서 만든 화면 위 — 이름 뒤에 점", currentPath: "/", mine: MINE },
  {
    id: "c",
    label: "c · 찍기 켜짐 · 2곳 담음(속이 찬 단추 · 뒤집힌 숫자)",
    pinOn: true,
    pinCount: 2,
  },
  { id: "d", label: "d · 찍기 꺼짐 · 3곳은 입력창에 담겨 있음", pinCount: 3 },
  { id: "e", label: "e · 불러오는 중 — 새로 고침 그림이 돈다", loading: true },
  { id: "f", label: "f · 찍기 잠김(준비 중)", pinLocked: "준비가 끝나면 화면을 찍을 수 있어요" },
  { id: "g", label: "g · 작업 기록 열림 · 배율 80%", historyOpen: true, zoom: 0.8, height: 720 },
  {
    id: "h",
    label: "h · 주소 목록 열림",
    currentPath: "/members",
    screenName: "회원 목록",
    mine: MINE,
    addrOpen: true,
    height: 400,
  },
  { id: "i", label: "i · 780px(기록 글자 · 단축키 접힘 직전)", width: 781, pinCount: 2 },
  { id: "j", label: "j · 700px(기록 글자 · 단축키 접힘)", width: 700, pinCount: 2 },
  { id: "k", label: "k · 560px(찍기 글자도 접힘)", width: 560, pinCount: 2, pinOn: true },
  {
    id: "l",
    label: "l · 430px · 작업 기록 시트",
    width: 430,
    pinCount: 2,
    historyOpen: true,
    height: 720,
  },
  { id: "m", label: "m · 380px(가장 좁은 탭)", width: 380 },
  { id: "n", label: "n · 태블릿 틀", device: "tablet", height: 460, pinOn: true, pinCount: 1 },
  { id: "o", label: "o · 휴대폰 틀", device: "mobile", height: 560 },
  {
    id: "p",
    label: "p · 가장 나쁜 경우 — 찍기 켜짐 12곳 · 기록 열림 · 배율 80% · 만든 화면 위",
    currentPath: "/",
    mine: MINE,
    pinOn: true,
    pinCount: 12,
    historyOpen: true,
    zoom: 0.8,
    height: 150,
  },
  {
    id: "q",
    label: "q · 라이브 — AI 가 화면을 직접 누르는 중(가장자리 고리 + 아래 한 줄)",
    height: 320,
    live: { driving: true },
  },
  {
    id: "r",
    label: "r · 라이브 — AI 가 지금 고치는 화면(사용자가 이미 만져서 옮기지 않음)",
    height: 320,
    live: { touched: true, editing: { route: "/members", title: "회원 목록" } },
    mine: MINE,
  },
  {
    id: "s",
    label: "s · 라이브 — 첫 편집에서 그 화면으로 옮겨 감 → 옮겼어요 → 고치는 중 (`?play=1`)",
    height: 320,
    mine: MINE,
    live: {
      script: [
        { at: 700, edit: { route: "/members", title: "회원 목록" } },
        { at: 9000, drive: true },
        { at: 12000, drive: false },
      ],
    },
  },
  {
    id: "t",
    label: "t · 라이브 — 사용자가 만진 뒤의 신호는 옮기지 않는다 (`?play=1`)",
    height: 320,
    mine: MINE,
    live: {
      script: [
        { at: 300, touch: true },
        { at: 900, edit: { route: "/members", title: "회원 목록" } },
      ],
    },
  },
  {
    id: "u",
    label: "u · 라이브 — 좁은 폭 · 긴 이름 · 눌러 보는 중이 고치는 중보다 먼저",
    width: 380,
    height: 420,
    live: {
      driving: true,
      editing: { route: "/wms/inbound", title: "입고 목록 · 오늘 들어온 물건 확인하기" },
      touched: true,
    },
  },
  {
    id: "w",
    label: "w · 진짜 칸 — PreviewColumn 을 모의 데몬으로 마운트 (`?guest=` 서버가 필요)",
    height: 420,
    live: {},
  },
  {
    id: "v",
    label: "v · 라이브 — 찍기가 켜져 있으면 한 줄과 고리는 비켜 선다",
    height: 320,
    pinOn: true,
    pinCount: 2,
    live: { driving: true, pin: true, editing: { route: "/members", title: "회원 목록" } },
  },
];

/** `?sweep=1` — 같은 상태(b · c)를 막대 폭 여덟 가지로. 접히는 순서와 겹침을 본다. */
const SWEEP_WIDTHS = [1300, 1100, 900, 781, 700, 600, 540, 440];
const SWEEP: Case[] = SWEEP_WIDTHS.flatMap((width) =>
  BASE_CASES.filter((spec) => ["b", "c"].includes(spec.id)).map((spec) => ({
    ...spec,
    id: `${spec.id}-${width}`,
    label: `${spec.id} @ ${width}`,
    width,
    height: 150,
  })),
);
const ONLY = query.get("case")?.split(",");
const CASES: Case[] = (query.get("sweep") ? SWEEP : BASE_CASES).filter(
  (spec) => !ONLY || ONLY.includes(spec.id),
);

/** 연결 서비스의 화면을 흉내 낸 가짜 — 유리 조각 바탕 위의 흰 카드 한 장(스크린샷의 그 화면). */
function FakeGuest({ title }: { title?: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: "grid",
        placeItems: "center",
        padding: 18,
        background:
          "radial-gradient(circle at 20% 20%, #dfe6fb 0, transparent 40%), linear-gradient(135deg, #a9b9f0, #5f84ef 70%, #c9d5fa)",
      }}
    >
      <div
        style={{
          width: "min(100%, 760px)",
          background: "#fff",
          borderRadius: 14,
          padding: 20,
          display: "grid",
          gridTemplateColumns: "1fr 2fr",
          gap: 14,
          font: "600 15px var(--font)",
          color: "#1b2340",
        }}
      >
        <div>{title ?? "서비스를 선택하세요"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {["OMS", "WMS", "Setting"].map((name) => (
            <div
              key={name}
              style={{ border: "1px solid #dde1ee", borderRadius: 10, height: 96, padding: 10 }}
            >
              {name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ spec }: { spec: Case }) {
  const [device, setDevice] = useState<PreviewDevice>(spec.device ?? "desktop");
  const [pinOn, setPinOn] = useState(spec.pinOn ?? false);
  const [historyOpen, setHistoryOpen] = useState(spec.historyOpen ?? false);
  const [loading, setLoading] = useState(spec.loading ?? false);
  const [zoom, setZoom] = useState(spec.zoom ?? 1);
  const [addrSignal, setAddrSignal] = useState(0);
  const [pulse, setPulse] = useState(0);
  const historyBtn = useRef<HTMLButtonElement | null>(null);
  const width = spec.width ?? WIDE;
  const height = spec.height ?? 300;

  // ⌘L 의 신호 — 사례가 연 채로 시작하면 마운트 직후 한 번 올린다.
  useEffect(() => {
    if (spec.addrOpen) setAddrSignal(1);
  }, [spec.addrOpen]);

  // 새로 고침은 3초 불러오는 중이다 — 도는 그림이 켜지고 꺼지는 것을 본다.
  const reload = () => {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 3000);
  };

  return (
    <div id={`fixture-${spec.id}`} style={{ margin: "14px 0 18px 20px" }}>
      <div style={{ font: "12px/1.4 monospace", color: "#888", margin: "0 0 4px" }}>
        {spec.label} · {width}px
      </div>
      {/* .nx 는 견본에서 토큰 범위만 빌린다 — 셸의 그리드는 풀어 평범한 문서로. */}
      <div
        className="nx"
        style={{ display: "block", height: "auto", overflow: "visible", width, background: "none" }}
      >
        <section className="nx-preview" style={{ width, height, border: "1px dashed #8884" }}>
          <PreviewBar
            canBack={spec.canBack ?? true}
            canForward={false}
            onBack={() => {}}
            onForward={() => {}}
            onReload={reload}
            loading={loading}
            screenName={spec.screenName ?? "첫 화면"}
            mine={spec.mine ?? []}
            others={OTHERS}
            currentPath={spec.currentPath ?? "/"}
            arrivePulse={pulse}
            onGo={() => setPulse((n) => n + 1)}
            onAddress={() => null}
            device={device}
            onDevice={setDevice}
            pinOn={pinOn}
            pinCount={spec.pinCount ?? 0}
            pinLocked={spec.pinLocked ?? null}
            onPin={() => setPinOn((on) => !on)}
            historyOpen={historyOpen}
            historyBtn={historyBtn}
            onHistory={() => setHistoryOpen((open) => !open)}
            native
            zoom={zoom}
            onZoom={(kind) =>
              setZoom(kind === "reset" ? 1 : kind === "in" ? zoom + 0.1 : zoom - 0.1)
            }
            frozenReady
            onFrozen={() => {}}
            onCompare={() => {}}
            onShowAi={() => {}}
            showAiBusy={false}
            onShortcuts={() => {}}
            addrSignal={addrSignal}
            drawerId={`fixture-${spec.id}-drawer`}
          />
          <div className="nx-pvstage" data-device={device}>
            <div className="nx-pvdevice">
              <FakeGuest />
            </div>
            {pinOn && <div className="nx-pvring" aria-hidden="true" />}
            {loading && <i className="nx-pvbusy" aria-hidden="true" />}
          </div>
          <HistoryDrawer
            id={`fixture-${spec.id}-drawer`}
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            daemon={DAEMON}
            repo={REPO}
            submits={SUBMITS}
            onRestored={reload}
            toast={() => {}}
            returnRef={historyBtn}
          />
        </section>
      </div>
    </div>
  );
}

/**
 * 라이브감 하네스(2026-10-08 베타 준비 분석) — 모의 신호(`browser.driving` · `session.editing` · 사용자의 손)를 진짜
 * `useLiveFollow` 에 먹이고 `LiveLayer` 를 앱과 같은 마크업 · CSS 로 그린다. 칸(`PreviewColumn`)은 데몬이 있어야 서므로
 * 여기서는 칸이 훅에 건네는 입력만 흉내 낸다. 뿌리의 `data-here` · `data-line` 은 눈으로 본 것을 코드로도 읽게 하는 표식이다.
 */
function LiveRow({ spec }: { spec: Case }) {
  const live = spec.live as LiveSpec;
  const width = spec.width ?? WIDE;
  const height = spec.height ?? 300;
  const [turnStartedAt, setTurnStartedAt] = useState(() => Date.now() - 1000);
  const touchedAt = useRef<number | null>(live.touched ? Date.now() : null);
  const [here, setHere] = useState(live.start ?? "/");
  const [driving, setDriving] = useState(live.driving ?? false);
  const [editing, setEditing] = useState<EditingScreen | null>(
    live.editing ? { ...live.editing, at: Date.now() } : null,
  );
  const [pinOn, setPinOn] = useState(live.pin ?? spec.pinOn ?? false);
  const [pulse, setPulse] = useState(0);
  const historyBtn = useRef<HTMLButtonElement | null>(null);

  const result = useLiveFollow({
    sessionId: "fixture",
    turnLive: true,
    turnStartedAt,
    driving,
    editing,
    here,
    view: { visible: true, covered: false, external: false, crowded: false },
    modes: { follow: true, pin: pinOn, frozen: false, history: false },
    titleOf: (route) => NAMES[route] ?? null,
    onFollow: (route) => {
      setHere(route);
      setPulse((n) => n + 1);
    },
    touchedAt,
  });

  const send = (route: string, title: string | null = NAMES[route] ?? null) =>
    setEditing({ route, title, at: Date.now() });
  const touch = () => {
    touchedAt.current = Date.now();
  };
  const newTurn = () => {
    setTurnStartedAt(Date.now());
    setEditing(null);
    setDriving(false);
  };

  // 밖(CDP · 눈)에서 신호를 먹이는 길 — `window.__live[사례 id]`.
  useEffect(() => {
    const holder = window as unknown as { __live?: Record<string, unknown> };
    holder.__live = {
      ...holder.__live,
      [spec.id]: { drive: setDriving, edit: send, touch, newTurn },
    };
  });
  // `?play=1` — 사례의 대본이 저절로 재생된다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 마운트 때 한 번 재생한다.
  useEffect(() => {
    if (!query.get("play") || !live.script) return;
    const timers = live.script.map((step) =>
      window.setTimeout(() => {
        if (step.touch) touch();
        if (step.drive !== undefined) setDriving(step.drive);
        if (step.edit) send(step.edit.route, step.edit.title);
      }, step.at),
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);

  const button = { font: "12px var(--font)", padding: "3px 9px" } as const;
  return (
    <div
      id={`fixture-${spec.id}`}
      data-here={here}
      data-line={result.line?.kind ?? ""}
      data-ring={result.ring ? "on" : ""}
      style={{ margin: "14px 0 18px 20px" }}
    >
      <div style={{ font: "12px/1.4 monospace", color: "#888", margin: "0 0 4px" }}>
        {spec.label} · {width}px
      </div>
      <div
        className="nx"
        style={{ display: "block", height: "auto", overflow: "visible", width, background: "none" }}
      >
        <section className="nx-preview" style={{ width, height, border: "1px dashed #8884" }}>
          <PreviewBar
            canBack
            canForward={false}
            onBack={() => {}}
            onForward={() => {}}
            onReload={() => touch()}
            loading={false}
            screenName={NAMES[here] ?? "이름 없는 화면"}
            mine={spec.mine ?? []}
            others={OTHERS}
            currentPath={here}
            arrivePulse={pulse}
            onGo={(path) => {
              touch();
              setHere(path);
            }}
            onAddress={() => null}
            device="desktop"
            onDevice={() => {}}
            pinOn={pinOn}
            pinCount={spec.pinCount ?? 0}
            pinLocked={null}
            onPin={() => {
              touch();
              setPinOn((on) => !on);
            }}
            historyOpen={false}
            historyBtn={historyBtn}
            onHistory={() => {}}
            native
            zoom={1}
            onZoom={() => {}}
            frozenReady
            onFrozen={() => {}}
            onCompare={() => {}}
            onShowAi={() => {}}
            showAiBusy={false}
            onShortcuts={() => {}}
            addrSignal={0}
            drawerId={`fixture-${spec.id}-drawer`}
          />
          <div className="nx-pvstage" data-device="desktop">
            <div className="nx-pvdevice">
              <FakeGuest title={NAMES[here]} />
            </div>
            {pinOn && <div className="nx-pvring" aria-hidden="true" />}
            <LiveLayer line={result.line} ring={result.ring} />
          </div>
        </section>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0 0", width }}>
        <button type="button" style={button} onClick={() => setDriving((on) => !on)}>
          {driving ? "AI 조작 끄기" : "AI 가 화면을 누름"}
        </button>
        <button type="button" style={button} onClick={() => send("/members")}>
          신호 · 회원 목록
        </button>
        <button type="button" style={button} onClick={() => send("/billing")}>
          신호 · 결제 내역
        </button>
        <button type="button" style={button} onClick={touch}>
          사용자가 미리보기를 만짐
        </button>
        <button type="button" style={button} onClick={newTurn}>
          새 턴
        </button>
        <button type="button" style={button} onClick={() => setHere("/")}>
          첫 화면으로 되돌림
        </button>
      </div>
    </div>
  );
}

/** 진짜 칸에 건네는 가짜 손들 — 칸이 읽는 것만 채운다. */
const COLUMN_PINS = { list: [], ghosts: [], add: () => {}, remove: () => {}, setNote: () => {} };
const COLUMN_NAV = { toast: () => {}, showTab: () => {} };

/**
 * 진짜 `PreviewColumn` 을 마운트한다(2026-10-08 라이브감) — 하네스가 훅만 돌린 것과 달리 칸의 `noteUser` · `go` · 덮개 · 막대의
 * 이음매까지 앱과 같은 코드가 돈다. 브라우저 경로라 무대는 iframe 이다. `window.__live.w` 의 `drive` · `edit` · `newTurn` 이 데몬의
 * `browser.driving` · `session.editing` · 턴 시작을 흉내 낸다. 손(주소 이동 · 기기 · 뒤로)은 막대를 직접 누른다.
 */
function ColumnRow({ spec }: { spec: Case }) {
  const guest = query.get("guest");
  if (guest === null) {
    return (
      <div
        id={`fixture-${spec.id}`}
        style={{ margin: "14px 0 18px 20px", font: "12px/1.5 monospace" }}
      >
        {spec.label} · `?guest=http://127.0.0.1:포트` 가 필요해요 — 주소의 경로를 그대로 보여 주는
        작은 서버면 된다.
      </div>
    );
  }
  return <ColumnMounted spec={spec} guest={guest} />;
}

function ColumnMounted({ spec, guest }: { spec: Case; guest: string }) {
  const width = spec.width ?? WIDE;
  const height = spec.height ?? 420;
  const [driving, setDriving] = useState(false);
  const [editing, setEditing] = useState<EditingScreen | null>(null);
  const [turn, setTurn] = useState(() => ({ at: Date.now() - 1000, live: true }));
  const [followEdits, setFollowEdits] = useState(query.get("follow") !== "off");

  const daemon = useMemo(
    () =>
      mockDaemon({
        repo: { ...REPO, previewUrl: guest, previewEpoch: 1 },
        browserDriving: new Set(driving ? ["w1"] : []),
        editingScreens: new Map(editing ? [["w1", editing]] : []),
        sessions: {
          w1: { blocks: [], state: turn.live ? "running" : "idle", turnStartedAt: turn.at },
        },
      }),
    [guest, driving, editing, turn],
  );
  const sessions = useMemo(
    () =>
      ({
        activeId: "w1",
        active: {
          state: turn.live ? "running" : "idle",
          turnStartedAt: turn.at,
          blocks: [],
          queue: [],
        },
        setViewing: () => {},
        create: async () => "w1",
        sendTurn: async () => {},
      }) as unknown as Sessions,
    [turn],
  );

  useEffect(() => {
    const holder = window as unknown as { __live?: Record<string, unknown> };
    holder.__live = {
      ...holder.__live,
      [spec.id]: {
        drive: setDriving,
        edit: (route: string, title: string | null = null) =>
          setEditing({ route, title, at: Date.now() }),
        newTurn: () => {
          setTurn({ at: Date.now(), live: true });
          setEditing(null);
          setDriving(false);
        },
        endTurn: () => {
          setTurn((now) => ({ ...now, live: false }));
          setEditing(null);
          setDriving(false);
        },
        follow: setFollowEdits,
      },
    };
  });

  return (
    <div id={`fixture-${spec.id}`} style={{ margin: "14px 0 18px 20px" }}>
      <div style={{ font: "12px/1.4 monospace", color: "#888", margin: "0 0 4px" }}>
        {spec.label} · {width}px · guest {guest}
      </div>
      <div
        className="nx"
        style={{ display: "block", height: "auto", overflow: "visible", width, background: "none" }}
      >
        <div style={{ width, height, display: "grid", border: "1px dashed #8884" }}>
          <PreviewColumn
            daemon={daemon}
            settings={{ followEdits } as Settings}
            sessions={sessions}
            pins={COLUMN_PINS as never}
            project={null}
            activeSessionId="w1"
            nav={COLUMN_NAV as never}
            narrow={false}
            onScreenName={() => {}}
            onChatChange={() => {}}
            onRenameSession={() => {}}
          />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: 40 }}>
      {CASES.map((spec) =>
        spec.id === "w" ? (
          <ColumnRow key={spec.id} spec={spec} />
        ) : spec.live ? (
          <LiveRow key={spec.id} spec={spec} />
        ) : (
          <Row key={spec.id} spec={spec} />
        ),
      )}
    </div>
  </StrictMode>,
);
