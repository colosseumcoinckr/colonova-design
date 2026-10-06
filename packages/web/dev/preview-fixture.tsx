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
 */

import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { applyStoredTheme, applyStoredTypeScale } from "../src/lib/settings";
import { HistoryDrawer } from "../src/next/preview/HistoryDrawer";
import { PreviewBar, type ScreenRow } from "../src/next/preview/PreviewBar";
import type { PreviewDevice } from "../src/next/preview/PreviewHost";
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
}

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
function FakeGuest() {
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
        <div>서비스를 선택하세요</div>
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

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: 40 }}>
      {CASES.map((spec) => (
        <Row key={spec.id} spec={spec} />
      ))}
    </div>
  </StrictMode>,
);
