import { APP_SHORTCUTS } from "@colonova-design/protocol";
import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from "react";
import { composing } from "../../lib/ime";
import { L } from "../labels";
import { keyHint, tipWithKeys } from "../lib/key-hint";
import { zoomButtons } from "../lib/preview-geometry";
import { Count } from "../ui/Count";
import { Popover } from "../ui/Popover";
import {
  AddrChevronIcon,
  BackIcon,
  CameraIcon,
  EyeIcon,
  ForwardIcon,
  HistoryIcon,
  KeyboardIcon,
  MinusIcon,
  MoreIcon,
  PcIcon,
  PhoneIcon,
  PinIcon,
  PlusIcon,
  ReloadIcon,
  ScreenIcon,
  SmallCheckIcon,
  TabletIcon,
} from "./icons";
import type { PreviewDevice } from "./PreviewHost";

/** 단축키 표(APP_SHORTCUTS)에 적힌 글리프 — 표에 없으면 null. 메뉴 · 시트와 같은 한 벌이다. */
function keysOf(id: string): string | null {
  return APP_SHORTCUTS.find((entry) => entry.id === id)?.keys ?? null;
}

/** 손에 올린 풍선 — `뒤로 · ⌘[` 처럼 표의 단축키를 이 컴퓨터의 표기로 덧붙인다. */
function tipWith(label: string, id: string): string {
  return tipWithKeys(label, keysOf(id));
}

/** 주소 목록의 한 줄 — 화면 이름과 그 주소(주소는 목록 안에서만 보인다, U10). */
export interface ScreenRow {
  path: string;
  name: string;
  modified?: boolean;
}

/**
 * 미리보기 막대 — 목업 `.pvbar`: 왼쪽은 ‹ › ⟳ · 주소(=화면 이름, 누르면 화면 목록),
 * 오른쪽 한 묶음은 PC/태블릿/휴대폰 · 찍기(이 막대의 주 단추) · 기록 · 배율 알약(100% 가
 * 아닐 때만) · `···`(배율 · AI에게 이 화면 보여 주기 · 제출한 때의 화면 · 단축키).
 * 넓으면 기록이 글자를 입고, 좁아지면 글자부터 감긴다(2026-10-06 막대 개편).
 */
export function PreviewBar({
  canBack,
  canForward,
  onBack,
  onForward,
  onReload,
  loading,
  screenName,
  mine,
  others,
  currentPath,
  arrivePulse,
  onGo,
  onAddress,
  device,
  onDevice,
  pinOn,
  pinCount,
  pinLocked,
  onPin,
  historyOpen,
  historyBtn,
  drawerId,
  onHistory,
  native,
  zoom,
  onZoom,
  frozenReady,
  onCompare,
  onFrozen,
  onShowAi,
  showAiBusy,
  onShortcuts,
  addrSignal,
}: {
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  /** 화면이 150ms 를 넘겨 불러오는 중 — 새로 고침 그림이 돈다(무대 가장자리의 흐르는 선과 같은 신호). */
  loading: boolean;
  screenName: string;
  mine: ScreenRow[];
  others: ScreenRow[];
  /** 지금 뜬 화면의 주소 — 목록의 체크 · 처음 선택이 이 줄을 가른다. */
  currentPath: string;
  onGo: (path: string) => void;
  /** `/` 로 시작하는 주소 — 옮겼으면 null, 거절이면 그 이유 한 줄. */
  onAddress: (raw: string) => string | null;
  device: PreviewDevice;
  onDevice: (device: PreviewDevice) => void;
  pinOn: boolean;
  /** 입력창에 담겨 있는 핀의 수 — 0 보다 크면 단추에 숫자 알약이 선다. */
  pinCount: number;
  /** 찍기가 잠긴 이유(준비 중) — 있으면 누름이 이유를 말한다. */
  pinLocked: string | null;
  onPin: () => void;
  historyOpen: boolean;
  /** 시계 단추의 자리 — 서랍이 닫히면 초점이 여기로 돌아간다. */
  historyBtn?: RefObject<HTMLButtonElement | null>;
  /** 단추가 여닫는 서랍의 id — `aria-controls` 가 가리킨다. */
  drawerId?: string;
  onHistory: () => void;
  native: boolean;
  zoom: number;
  onZoom: (kind: "in" | "out" | "reset") => void;
  /** 제출한 때의 화면을 볼 수 있는가 — 개발자에게 가 있는 동안만. */
  frozenReady: boolean;
  onFrozen: () => void;
  onCompare: () => void;
  onShowAi: () => void;
  showAiBusy: boolean;
  onShortcuts: () => void;
  /** 답이 끝나 도착한 신호 — 오를 때마다 주소 알약이 강조색으로 잠깐 물든다. */
  arrivePulse: number;
  /** ⌘L — 오를 때마다 주소 목록을 연다. */
  addrSignal: number;
}) {
  const [addrOpen, setAddrOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // 답이 끝나 도착하면 주소 알약이 강조색으로 1.2초 물든다 — 도착이 먼저
  // 말하고 색이 뒤따라 꺼진다.
  const [arriveTint, setArriveTint] = useState(false);
  useEffect(() => {
    if (arrivePulse <= 0) return;
    setArriveTint(true);
    const off = window.setTimeout(() => setArriveTint(false), 1200);
    return () => window.clearTimeout(off);
  }, [arrivePulse]);
  const addrRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (addrSignal > 0) setAddrOpen(true);
  }, [addrSignal]);

  // 게스트(webview) 안의 누름은 문서의 mousedown 에 닿지 않는다 — 게스트가 포커스를
  // 가져가는 순간을 「바깥을 눌렀다」로 본다.
  useEffect(() => {
    if (!addrOpen && !moreOpen) return;
    const onFocusIn = (event: FocusEvent) => {
      if ((event.target as HTMLElement | null)?.tagName !== "WEBVIEW") return;
      setAddrOpen(false);
      setMoreOpen(false);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [addrOpen, moreOpen]);

  const zoomState = zoomButtons(zoom);
  // 주소 목록의 체크와 같은 비교 — 이 대화에서 만든 화면 위에 서 있는가.
  const mineHere = currentPath !== "" && mine.some((entry) => entry.path === currentPath);
  const addrKeys = keysOf("address");
  // 점이 서 있으면 풍선이 그 뜻을 먼저 말한다 — 눈으로 보는 사람도 점의 이유를 안다.
  const addrTip = tipWith(L.preview.addrLabel, "address");
  // 잠김 상태는 이름이 말한다 — 잠긴 이유는 눌렀을 때의 토스트 몫이다(2026-10-04 ux-review).
  let pinName: string = L.preview.pin;
  if (pinLocked) pinName = L.preview.pinLockedState;
  else if (pinCount > 0) pinName = L.preview.pinCountState(pinCount);

  const deviceButton = (value: PreviewDevice, label: string, icon: ReactNode) => (
    <button
      type="button"
      className={device === value ? "nx-seg--on" : ""}
      title={label}
      aria-label={label}
      aria-pressed={device === value}
      onClick={() => onDevice(value)}
    >
      {icon}
    </button>
  );

  return (
    <div className="nx-pvbar">
      <button
        type="button"
        className="nx-ibtn"
        title={tipWith(L.preview.back, "back")}
        aria-label={L.preview.back}
        disabled={!canBack}
        onClick={onBack}
      >
        <BackIcon />
      </button>
      <button
        type="button"
        className="nx-ibtn nx-fwd"
        title={tipWith(L.preview.forward, "forward")}
        aria-label={L.preview.forward}
        disabled={!canForward}
        onClick={onForward}
      >
        <ForwardIcon />
      </button>
      <button
        type="button"
        className={`nx-ibtn nx-reload${loading ? " nx-reload--busy" : ""}`}
        title={tipWith(L.preview.reload, "reload")}
        aria-label={L.preview.reload}
        aria-busy={loading}
        onClick={onReload}
      >
        <ReloadIcon />
      </button>

      <div className="nx-anchor nx-addrwrap" ref={addrRef}>
        <button
          type="button"
          className={`nx-addr${arriveTint ? " nx-addr--tint" : ""}`}
          aria-label={`${L.preview.addrLabel} · ${screenName}${mineHere ? ` · ${L.preview.addrMine}` : ""}`}
          aria-haspopup="dialog"
          aria-expanded={addrOpen}
          data-testid="preview-address"
          title={mineHere ? `${L.preview.addrMine} · ${addrTip}` : addrTip}
          onClick={() => setAddrOpen((open) => !open)}
        >
          <span className="nx-addr-ic">
            <ScreenIcon />
          </span>
          <span className="nx-addr-name">
            {/* 화면 이름으로 key — 이름이 바뀌면 들어오는 쪽에서 미끄러져
                들어온다(답이 끝나 옮겨 간 순간이 가장 크게 보인다). */}
            <b key={screenName}>{screenName}</b>
            {/* 이 대화에서 만든 화면에 있다는 점 — 목록의 `이 대화에서 만든 화면` 과 같은 뜻이다. */}
            {mineHere && <i className="nx-addr-dot" aria-hidden="true" />}
          </span>
          {/* 이름은 위 aria-label 이 말한다 — 단축키는 눈에만 보이는 힌트다. */}
          {addrKeys && <kbd className="nx-addr-k">{keyHint(addrKeys)}</kbd>}
          <AddrChevronIcon />
        </button>
        {addrOpen && (
          <Popover
            anchor={addrRef}
            onClose={() => setAddrOpen(false)}
            className="nx-addr-pop"
            label={L.preview.addrLabel}
          >
            <AddressList
              mine={mine}
              others={others}
              currentPath={currentPath}
              onGo={(path) => {
                setAddrOpen(false);
                onGo(path);
              }}
              onAddress={(raw) => {
                const why = onAddress(raw);
                if (why === null) setAddrOpen(false);
                return why;
              }}
            />
          </Popover>
        )}
      </div>

      <fieldset className="nx-seg" aria-label={L.preview.device}>
        {deviceButton("desktop", L.preview.devicePc, <PcIcon />)}
        {deviceButton("tablet", L.preview.deviceTablet, <TabletIcon />)}
        {deviceButton("mobile", L.preview.devicePhone, <PhoneIcon />)}
      </fieldset>

      <button
        type="button"
        className={`nx-tbtn nx-pin-t${pinOn ? " nx-tbtn--on" : ""}${pinLocked ? " nx-tbtn--locked" : ""}`}
        title={pinLocked ?? keyHint(pinOn ? L.preview.pinOffTip : L.preview.pinTip)}
        aria-label={pinName}
        aria-pressed={pinOn}
        aria-disabled={pinLocked !== null}
        onClick={onPin}
      >
        <PinIcon />
        <span className="nx-pin-w">{L.preview.pin}</span>
        {pinCount > 0 && <Count n={pinCount} className={pinOn ? "nx-cnt--inv" : undefined} />}
      </button>
      <button
        type="button"
        ref={historyBtn}
        className={`nx-tbtn nx-hist-t${historyOpen ? " nx-tbtn--sel" : ""}`}
        title={historyOpen ? L.history.close : L.preview.history}
        aria-label={L.preview.history}
        aria-expanded={historyOpen}
        aria-controls={drawerId}
        onClick={onHistory}
      >
        <span className="nx-hist-ic">
          <HistoryIcon />
        </span>
        <span className="nx-hist-w">{L.preview.history}</span>
      </button>
      {/* 배율이 100% 가 아닐 때만 — 메뉴 안에 숨은 상태가 막대에서도 보이고, 한 번에 돌아간다. */}
      {native && !zoomState.reset && (
        <button
          type="button"
          className="nx-tbtn nx-zoom-t"
          title={L.preview.zoomReset}
          aria-label={`${L.preview.zoomReset} · ${Math.round(zoom * 100)}%`}
          onClick={() => onZoom("reset")}
        >
          {Math.round(zoom * 100)}%
        </button>
      )}

      <div className="nx-anchor" ref={moreRef}>
        <button
          type="button"
          className="nx-ibtn"
          title={L.preview.more}
          aria-label={L.preview.more}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <MoreIcon />
        </button>
        {moreOpen && (
          <Popover
            anchor={moreRef}
            onClose={() => setMoreOpen(false)}
            align="end"
            className="nx-more-pop"
            label={L.preview.more}
          >
            {native && (
              <>
                <div className="nx-mh">{L.preview.zoom}</div>
                <div className="nx-mseg">
                  <button
                    type="button"
                    title={L.preview.zoomOut}
                    aria-label={L.preview.zoomOut}
                    disabled={zoomState.out}
                    onClick={() => onZoom("out")}
                  >
                    <MinusIcon />
                  </button>
                  <button
                    type="button"
                    className={zoomState.reset ? "nx-mseg--on" : ""}
                    title={L.preview.zoomReset}
                    aria-label={L.preview.zoomReset}
                    onClick={() => onZoom("reset")}
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    type="button"
                    title={L.preview.zoomIn}
                    aria-label={L.preview.zoomIn}
                    disabled={zoomState.in}
                    onClick={() => onZoom("in")}
                  >
                    <PlusIcon />
                  </button>
                </div>
                <div className="nx-msep" />
              </>
            )}
            {native && (
              <button
                type="button"
                // 이유를 말하는 항목의 통일 표기 — 닫히지 않는 항목은 aria-disabled 로(2026-10-04 ux-review).
                className={`nx-mi${showAiBusy ? " nx-mi--dis" : ""}`}
                aria-disabled={showAiBusy}
                onClick={() => {
                  if (showAiBusy) return;
                  setMoreOpen(false);
                  onShowAi();
                }}
              >
                <CameraIcon />
                <span className="nx-mt">
                  <b>{showAiBusy ? L.preview.showAiBusy : L.preview.showAi}</b>
                  <small>{L.preview.showAiSub}</small>
                </span>
              </button>
            )}
            <button
              type="button"
              className={`nx-mi${frozenReady ? "" : " nx-mi--dis"}`}
              aria-disabled={!frozenReady}
              onClick={() => {
                if (!frozenReady) return;
                setMoreOpen(false);
                onFrozen();
              }}
            >
              <EyeIcon />
              <span className="nx-mt">
                <b>{L.preview.frozenOpen}</b>
                <small>{frozenReady ? L.preview.frozenOpenSub : L.preview.frozenLocked}</small>
              </span>
            </button>
            <button
              type="button"
              // 잠긴 이유를 말하는 항목은 `제출한 때의 화면 보기` 와 같은 표기로(2026-10-04 ux-review).
              className={`nx-mi${frozenReady ? "" : " nx-mi--dis"}`}
              aria-disabled={!frozenReady}
              onClick={() => {
                if (!frozenReady) return;
                setMoreOpen(false);
                onCompare();
              }}
            >
              <EyeIcon />
              <span className="nx-mt">
                <b>{L.compare.submitted}</b>
                <small>{frozenReady ? L.compare.submittedDesktop : L.preview.frozenLocked}</small>
              </span>
            </button>
            <div className="nx-msep" />
            <button
              type="button"
              className="nx-mi"
              onClick={() => {
                setMoreOpen(false);
                onShortcuts();
              }}
            >
              <KeyboardIcon />
              {L.preview.shortcuts}
            </button>
          </Popover>
        )}
      </div>
    </div>
  );
}

/**
 * 주소 목록 — `이 대화에서 만든 화면` 과 `다른 화면`. 글자를 치면 이름(과
 * 주소)으로 거르고, `/` 로 시작하면 Enter 가 그 주소로 간다. 화살표로 고른다.
 */
function AddressList({
  mine,
  others,
  currentPath,
  onGo,
  onAddress,
}: {
  mine: ScreenRow[];
  others: ScreenRow[];
  /** 지금 뜬 화면의 주소 — 그 줄이 체크를 달고 처음 고르는 줄이다. */
  currentPath: string;
  onGo: (path: string) => void;
  onAddress: (raw: string) => string | null;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState(() => {
    const here = [...mine, ...others].findIndex((entry) => entry.path === currentPath);
    return here >= 0 ? here : 0;
  });
  const [why, setWhy] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const typedPath = q.startsWith("/");
  const match = (entry: ScreenRow) =>
    q === "" || entry.name.toLowerCase().includes(q) || entry.path.toLowerCase().includes(q);
  const mineShown = mine.filter(match);
  const othersShown = others.filter(match);
  const flat = [...mineShown, ...othersShown];
  const listRef = useRef<HTMLDivElement>(null);

  // 화살표로 고른 줄이 목록 밖에 나가면 따라간다 — 눌린 순간의 pick 으로 읽는다.
  const reveal = (index: number) => {
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector(`[id='${listId}-${index}']`)
        ?.scrollIntoView({ block: "nearest" });
    });
  };

  const row = (entry: ScreenRow, index: number) => {
    const here = entry.path === currentPath;
    return (
      <button
        type="button"
        key={`${entry.path}-${index}`}
        id={`${listId}-${index}`}
        role="option"
        // 고르는 손은 입력칸의 화살표다(aria-activedescendant) — 옵션까지 Tab 정지가 되면 두 모델이 겹친다.
        tabIndex={-1}
        aria-selected={index === pick && !typedPath}
        className={`nx-mi${index === pick && !typedPath ? " nx-mi--pick" : ""}`}
        onMouseEnter={() => setPick(index)}
        onClick={() => onGo(entry.path)}
      >
        {here ? <SmallCheckIcon /> : <EyeIcon />}
        <b>{entry.name}</b>
        {entry.modified && <span className="nx-screen-recent">{L.preview.recent}</span>}
        {/* 이름이 없는 화면만 주소로 말한다 — 이름이 있는 줄의 `/` 는 비개발자에게 군더더기다. */}
        {entry.name === L.preview.untitledScreen && <span className="nx-mi-r">{entry.path}</span>}
      </button>
    );
  };

  return (
    <>
      <input
        className="nx-addr-in"
        placeholder={L.preview.addrPlaceholder}
        aria-label={L.preview.addrPlaceholder}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={
          !typedPath && flat.length > 0 && pick < flat.length ? `${listId}-${pick}` : undefined
        }
        // biome-ignore lint/a11y/noAutofocus: 목록을 연 손은 곧 글자를 친다.
        autoFocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPick(0);
          setWhy(null);
        }}
        onKeyDown={(event) => {
          if (composing(event)) return;
          if (event.key === "ArrowDown" && flat.length > 0) {
            event.preventDefault();
            setPick((index) => {
              const next = (index + 1) % flat.length;
              reveal(next);
              return next;
            });
          } else if (event.key === "ArrowUp" && flat.length > 0) {
            event.preventDefault();
            setPick((index) => {
              const next = index <= 0 ? flat.length - 1 : index - 1;
              reveal(next);
              return next;
            });
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (typedPath) {
              setWhy(onAddress(query));
              return;
            }
            const picked = flat[pick] ?? flat[0];
            if (picked) onGo(picked.path);
          }
        }}
      />
      {why && (
        <div className="nx-addr-why" role="status">
          {why}
        </div>
      )}
      {/* 맞는 화면 수 — 글자를 칠 때마다 낭독기가 한 줄로 읽는다(목록은 화살표로 걷는다). */}
      <span className="nx-sr" role="status">
        {typedPath ? "" : L.preview.addrCount(flat.length)}
      </span>
      {/* listbox 의 자식은 옵션과 묶음뿐이다 — 머리는 묶음의 이름이고, 빈 안내는 목록이 없을 때만 선다. */}
      <div
        className="nx-addr-list"
        role={flat.length > 0 ? "listbox" : undefined}
        id={listId}
        ref={listRef}
      >
        {mineShown.length > 0 && (
          // biome-ignore lint/a11y/useSemanticElements: listbox 안의 묶음 — fieldset 의 테두리 · 여백을 되돌리지 않고 div 로 둔다.
          <div role="group" aria-labelledby={`${listId}-mine`}>
            <div className="nx-mh" id={`${listId}-mine`}>
              {L.preview.addrMine}
            </div>
            {mineShown.map((entry, index) => row(entry, index))}
          </div>
        )}
        {othersShown.length > 0 && (
          // biome-ignore lint/a11y/useSemanticElements: 위와 같다.
          <div role="group" aria-labelledby={`${listId}-others`}>
            <div className="nx-mh" id={`${listId}-others`}>
              {L.preview.addrOthers}
            </div>
            {othersShown.map((entry, index) => row(entry, mineShown.length + index))}
          </div>
        )}
        {flat.length === 0 && !typedPath && (
          <div className="nx-addr-none">
            {q === "" ? L.preview.addrNoScreens : L.preview.addrEmpty}
          </div>
        )}
      </div>
    </>
  );
}
