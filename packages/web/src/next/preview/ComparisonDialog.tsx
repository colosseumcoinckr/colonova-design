import type { ScreenComparison } from "@colonova-design/protocol";
import { ImageOff, MoveHorizontal, SquareSplitHorizontal } from "lucide-react";
import {
  type CSSProperties,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { escapeCloses, MODAL_ROOT_SELECTOR } from "../../hooks/use-modal-focus";
import type { Daemon } from "../../lib/daemon-client";
import { screenPath } from "../../lib/screen-link";
import { L } from "../labels";
import {
  applySplit,
  COMPARE_ZOOM_MAX,
  type CompareMode,
  clampPan,
  compareKeyAction,
  defaultCompareMode,
  fitSize,
  HOME_VIEW,
  isPannable,
  isSafeShot,
  type Pan,
  panBy,
  type Size,
  splitFromPointer,
  splitShares,
  stepZoom,
  type View,
  wheelZoom,
  zoomAt,
  zoomPercent,
} from "../lib/compare-zoom";
import { InfoIcon, Spin } from "../ui/icons";
import { ModalFoot, ModalFrame, ModalHead } from "../ui/ModalFrame";
import { MinusIcon, PlusIcon } from "./icons";

export interface ComparisonTarget {
  route: string;
  title: string;
  requestId?: string;
  sha?: string;
  submitted?: boolean;
}
const EVENT = "nx:comparison:open";
export function openComparison(target: ComparisonTarget): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: target }));
}

/** 사진 한 장 — 읽어 본 크기까지 안다(칸에 맞추는 계산이 이 크기에서 시작한다). */
interface Shot {
  src: string;
  size: Size;
  at: Date | null;
}

interface Shots {
  before: Shot | null;
  after: Shot | null;
}

/** 그림을 한 번 읽어 크기를 안다. 못 읽는(깨진) 그림은 null — 없는 사진으로 다룬다. */
function loadSize(src: string): Promise<Size | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function readShot(shot: ScreenComparison["before"]): Promise<Shot | null> {
  if (!isSafeShot(shot)) return null;
  const src = `data:${shot.mediaType};base64,${shot.data}`;
  const size = await loadSize(src);
  if (!size || size.width <= 0 || size.height <= 0) return null;
  const at = shot.at ? new Date(shot.at) : null;
  return { src, size, at: at && !Number.isNaN(at.getTime()) ? at : null };
}

const timeOf = (at: Date): string =>
  at.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * 닫은 뒤 초점이 돌아갈 곳 — 연 순간의 초점이다. `···` 메뉴의 줄처럼 곧 사라질 팝 안에 있었다면
 * (사라진 뒤에는 초점이 body 로 떨어져 돌아갈 곳이 없다) 그 팝을 연 단추로 돌려 보낸다.
 * 2026-10-06 겹판 조사.
 */
function returnTargetOf(active: Element | null): HTMLElement | null {
  if (!(active instanceof HTMLElement) || active === document.body) return null;
  const pop = active.closest(".nx-pop");
  if (!pop) return active;
  return pop.closest(".nx-anchor")?.querySelector<HTMLElement>(":scope > button") ?? null;
}

/**
 * 요소의 크기를 따라간다 — 처음 그리기 전에 한 번 재서 첫 그림이 어긋나지 않게. 재는 값은 배치(layout)의 크기다:
 * `getBoundingClientRect` 는 조상의 `transform` 을 입어서, 겹판이 떠오르는 동안(scale 0.965 에서 시작)에 재면
 * 사진이 칸보다 작게 맞춰진 채 굳는다(2026-10-06 측정: 칸 662 에 사진 652).
 */
function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = (entry?: ResizeObserverEntry) => {
      const box = entry?.borderBoxSize?.[0];
      const next = box
        ? { width: box.inlineSize, height: box.blockSize }
        : { width: el.offsetWidth, height: el.offsetHeight };
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    read();
    const observer = new ResizeObserver((entries) => read(entries[0]));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** 칸이 잰 값 — 키 · 단추가 같은 값으로 이동을 조인다. */
interface Metrics {
  stage: Size;
  fit: Size;
}
type ViewUpdate = (compute: (view: View, metrics: Metrics) => View) => void;

const NO_METRICS: Metrics = { stage: { width: 0, height: 0 }, fit: { width: 0, height: 0 } };

/** 칸의 한가운데에서 잰 포인터의 자리 — 확대가 붙들 점. */
function focalOf(event: { clientX: number; clientY: number }, el: HTMLElement): Pan {
  const box = el.getBoundingClientRect();
  return {
    x: event.clientX - box.left - box.width / 2,
    y: event.clientY - box.top - box.height / 2,
  };
}

/** 모든 보기가 같이 받는 것 — 한 벌의 확대 · 이동, 그 계산에 쓰는 칸의 크기. */
interface ViewerShared {
  title: string;
  view: View;
  update: ViewUpdate;
  metrics: MutableRefObject<Metrics>;
  beforeLabel: string;
  afterLabel: string;
}

/**
 * 사진이 서는 칸 — 확대 · 끌어 옮기기 · 휠이 여기서 일어난다. 사진 둘이 같은 `view` 를 쓰니
 * 어느 칸을 끌어도 같이 움직인다.
 */
function Stage({
  view,
  update,
  metrics,
  reference,
  splitTo,
  children,
}: {
  view: View;
  update: ViewUpdate;
  metrics: MutableRefObject<Metrics>;
  /** 칸에 맞추는 기준이 되는 사진의 크기 — 칸은 이 비율을 따라 서서 사진 둘레에 빈자리가 남지 않는다. */
  reference: Size;
  /** 겹쳐서 — 확대하지 않은 동안 칸 어디를 끌어도 선이 따라온다. 선의 자리(%)를 받는다. */
  splitTo?: (percent: number) => void;
  children: (stage: Size) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stage = useElementSize(ref);
  metrics.current = { stage, fit: fitSize(reference, stage) };
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ kind: "pan" | "split"; x: number; y: number } | null>(null);
  const pannable = isPannable(view.zoom);

  // 휠은 칸 안에서만 쓴다 — 확대했으면 그림을 옮기고, ctrl(트랙패드의 모으기)이면 포인터 자리를 붙들고
  // 확대한다. React 의 onWheel 은 수동(passive)이라 기본 동작을 막지 못해서 직접 건다.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const focal = focalOf(event, el);
        update((now, m) => zoomAt(now, wheelZoom(now.zoom, event.deltaY), focal, m.fit, m.stage));
        return;
      }
      // 옮길 데가 없는데 막으면 휠이 죽는다 — 확대한 동안만 가로챈다.
      let moved = false;
      update((now, m) => {
        if (!isPannable(now.zoom)) return now;
        moved = true;
        return panBy(now, -event.deltaX, -event.deltaY, m.fit, m.stage);
      });
      if (moved) event.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [update]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const onHandle = event.target instanceof Element && event.target.closest("[data-cv-handle]");
    const kind = splitTo && (onHandle || !pannable) ? "split" : pannable ? "pan" : null;
    if (!kind) return;
    drag.current = { kind, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    if (kind === "split") {
      const box = event.currentTarget.getBoundingClientRect();
      splitTo?.(splitFromPointer(event.clientX, box.left, box.width));
    }
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    if (current.kind === "split") {
      const box = event.currentTarget.getBoundingClientRect();
      splitTo?.(splitFromPointer(event.clientX, box.left, box.width));
      return;
    }
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    drag.current = { kind: "pan", x: event.clientX, y: event.clientY };
    update((now, m) => panBy(now, dx, dy, m.fit, m.stage));
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  // 두 번 누르면 그 자리를 붙들고 크게, 이미 크면 처음 크기로 — 사진을 훑어보는 손의 버릇이다.
  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // 선을 잡고 흔들다 생긴 두 번 누름은 확대가 아니다.
    if (event.target instanceof Element && event.target.closest("[data-cv-handle]")) return;
    const focal = focalOf(event, event.currentTarget);
    update((now, m) => (isPannable(now.zoom) ? HOME_VIEW : zoomAt(now, 2, focal, m.fit, m.stage)));
  };

  const classes = ["nx-cv-stage"];
  if (splitTo) classes.push("has-split");
  if (pannable) classes.push("is-pannable");
  if (dragging) classes.push("is-dragging");
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: 사진 칸의 끌기 · 두 번 누르기는 손으로만 하는 보조다 — 키보드는 + − 0 · 화살표가 같은 일을 한다.
    // biome-ignore lint/a11y/noStaticElementInteractions: 위와 같다.
    <div
      ref={ref}
      className={classes.join(" ")}
      style={
        reference.width > 0
          ? ({ aspectRatio: `${reference.width} / ${reference.height}` } as CSSProperties)
          : undefined
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClick}
    >
      {children(stage)}
    </div>
  );
}

/** 사진 한 겹 — 칸 가운데에 맞추고, 공유하는 확대 · 이동을 입는다. */
function Layer({
  shot,
  alt,
  stage,
  view,
  clip,
  off = false,
}: {
  shot: Shot;
  alt: string;
  stage: Size;
  view: View;
  /** 겹쳐서 — 왼쪽에서 이만큼(%)만 보인다. */
  clip?: number;
  /** 번갈아에서 지금 안 보이는 쪽 — 눈에도 낭독에도 빠진다. */
  off?: boolean;
}) {
  const fit = fitSize(shot.size, stage);
  const pan = clampPan(view.pan, fit, view.zoom, stage);
  return (
    <div
      className={`nx-cv-layer${clip !== undefined ? " nx-cv-layer--clip" : ""}${off ? " is-off" : ""}`}
      style={clip !== undefined ? { clipPath: `inset(0 ${100 - clip}% 0 0)` } : undefined}
      aria-hidden={off || undefined}
    >
      <img
        src={shot.src}
        alt={off ? "" : alt}
        draggable={false}
        style={{
          width: fit.width,
          height: fit.height,
          transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${view.zoom})`,
        }}
      />
    </div>
  );
}

/** 사진 위의 이름표 — 지금 무슨 사진을 보는지, 언제 찍은 것인지. */
function Tag({ side, label, at }: { side: "before" | "after"; label: string; at?: Date | null }) {
  return (
    <span className={`nx-cv-tag nx-cv-tag--${side}`} aria-hidden="true">
      {label}
      {at && <small className="nx-cv-tag-at">{timeOf(at)}</small>}
    </span>
  );
}

function SideView({ both, ...shared }: ViewerShared & { both: { before: Shot; after: Shot } }) {
  const { title, view, update, metrics, beforeLabel, afterLabel } = shared;
  const frame = (which: "before" | "after", shot: Shot, label: string) => (
    <section className={`nx-compare-side nx-compare-side--${which}`} aria-label={label}>
      <h3 className="nx-compare-cap">
        <span>{label}</span>
        {shot.at && <small className="nx-compare-cap-at">{timeOf(shot.at)}</small>}
      </h3>
      <Stage view={view} update={update} metrics={metrics} reference={both.after.size}>
        {(stage) => <Layer shot={shot} alt={`${title} · ${label}`} stage={stage} view={view} />}
      </Stage>
    </section>
  );
  return (
    <div className="nx-compare-pair">
      {frame("before", both.before, beforeLabel)}
      {frame("after", both.after, afterLabel)}
    </div>
  );
}

function OverlayView({
  both,
  split,
  setSplit,
  ...shared
}: ViewerShared & {
  both: { before: Shot; after: Shot };
  split: number;
  setSplit: (percent: number) => void;
}) {
  const { title, view, update, metrics, beforeLabel, afterLabel } = shared;
  const shares = splitShares(split);
  return (
    <Stage
      view={view}
      update={update}
      metrics={metrics}
      reference={both.after.size}
      splitTo={setSplit}
    >
      {(stage) => (
        <>
          <Layer shot={both.after} alt={`${title} · ${afterLabel}`} stage={stage} view={view} />
          <Layer
            shot={both.before}
            alt={`${title} · ${beforeLabel}`}
            stage={stage}
            view={view}
            clip={split}
          />
          {/* 선은 화면 낭독이 읽는 슬라이더다 — 손으로 끄는 것은 아래의 막대(굵은 선과 손잡이)가 한다. */}
          <input
            type="range"
            className="nx-cv-range nx-sr"
            min={0}
            max={100}
            step={1}
            value={split}
            aria-label={L.compare.divider}
            aria-valuetext={L.compare.dividerValue(
              beforeLabel,
              shares.before,
              afterLabel,
              shares.after,
            )}
            onChange={(event) => setSplit(Number(event.target.value))}
          />
          <div
            className="nx-cv-handle"
            data-cv-handle
            style={{ left: `${split}%` }}
            aria-hidden="true"
          >
            <span className="nx-cv-grip">
              <MoveHorizontal size={15} strokeWidth={2} />
            </span>
          </div>
          <Tag side="before" label={beforeLabel} />
          <Tag side="after" label={afterLabel} />
        </>
      )}
    </Stage>
  );
}

function FlipView({
  both,
  side,
  ...shared
}: ViewerShared & { both: { before: Shot; after: Shot }; side: "before" | "after" }) {
  const { title, view, update, metrics, beforeLabel, afterLabel } = shared;
  const shown = side === "before" ? both.before : both.after;
  return (
    <Stage view={view} update={update} metrics={metrics} reference={both.after.size}>
      {(stage) => (
        <>
          <Layer
            shot={both.before}
            alt={`${title} · ${beforeLabel}`}
            stage={stage}
            view={view}
            off={side !== "before"}
          />
          <Layer
            shot={both.after}
            alt={`${title} · ${afterLabel}`}
            stage={stage}
            view={view}
            off={side !== "after"}
          />
          <Tag side="before" label={side === "before" ? beforeLabel : afterLabel} at={shown.at} />
        </>
      )}
    </Stage>
  );
}

function SoloView({
  shot,
  isAfter,
  note,
  ...shared
}: ViewerShared & { shot: Shot; isAfter: boolean; note: string }) {
  const { title, view, update, metrics, beforeLabel, afterLabel } = shared;
  const label = isAfter ? afterLabel : beforeLabel;
  return (
    <>
      <p className="nx-compare-note" role="status">
        <InfoIcon />
        {note}
      </p>
      <Stage view={view} update={update} metrics={metrics} reference={shot.size}>
        {(stage) => (
          <>
            <Layer shot={shot} alt={`${title} · ${label}`} stage={stage} view={view} />
            <Tag side="before" label={label} at={shot.at} />
          </>
        )}
      </Stage>
    </>
  );
}

/** 키 안내 한 마디 — 눌러야 하는 키는 캡으로 · 뜻은 글자로. */
function Hint({ keys = [], children }: { keys?: string[]; children: ReactNode }) {
  return (
    <span className="nx-compare-hint">
      {keys.map((key) => (
        <kbd key={key} className="nx-kc">
          {key}
        </kbd>
      ))}
      {children}
    </span>
  );
}

/** 분절 — 하나만 눌려 있는 단추 줄(보기 방식 · 번갈아의 앞뒤). */
function Seg<Value extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: Value;
  options: Array<{ value: Value; text: string }>;
  onPick: (value: Value) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: 분절은 fieldset 의 모양(테두리 · 범례)을 입지 않는다 — 눌림 단추 줄을 이름 붙여 묶을 뿐이다.
    <div className="nx-compare-switch" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onPick(option.value)}
        >
          {option.text}
        </button>
      ))}
    </div>
  );
}

/** 사진 읽기와 보기 — 열 때마다 새로 태어난다(`key`), 그래서 지난번의 확대 · 선 자리가 남지 않는다. */
function Comparison({
  target,
  daemon,
  returnRef,
  onClose,
}: {
  target: ComparisonTarget;
  daemon: Daemon;
  returnRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [shots, setShots] = useState<Shots | null>(null);
  // 2026-10-04 ux-review(2차): 실패 문장이 「다시 열어 주세요」 였는데 손이 없었다 — 같은 창에서 다시 읽는다.
  // 2026-10-06 겹판 손질: 다시 읽는 동안에도 단추는 그 자리에 남아 바쁨을 말하고(초점이 달아나지 않는다),
  // 또 실패하면 문장이 바뀐다.
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [failures, setFailures] = useState(0);

  const [picked, setPicked] = useState<CompareMode | null>(null);
  const [side, setSide] = useState<"before" | "after">("after");
  const [split, setSplit] = useState(50);
  const [view, setView] = useState<View>(HOME_VIEW);
  const viewRef = useRef(view);
  const metrics = useRef<Metrics>(NO_METRICS);
  const update = useCallback<ViewUpdate>((compute) => {
    const next = compute(viewRef.current, metrics.current);
    viewRef.current = next;
    setView(next);
  }, []);

  const body = useRef<HTMLDivElement>(null);
  const width = useElementSize(body).width;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` 는 다시 시도 단추가 올리는 열쇠다 — 값이 아니라 바뀜이 읽기를 다시 부른다.
  useEffect(() => {
    let cancelled = false;
    void daemon.api
      .comparison(target)
      .then(async (record) => {
        const next: Shots | null = record
          ? { before: await readShot(record.before), after: await readShot(record.after) }
          : null;
        if (cancelled) return;
        setShots(next);
        setPhase("ready");
        setRetrying(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPhase("failed");
        setRetrying(false);
        setFailures((n) => n + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [target, attempt, daemon.api]);

  const beforeLabel = target.submitted ? L.compare.lastSubmit : L.compare.before;
  const afterLabel = target.submitted ? L.compare.current : L.compare.after;
  const both = shots?.before && shots.after ? { before: shots.before, after: shots.after } : null;
  const solo = both ? null : (shots?.after ?? shots?.before ?? null);
  const soloIsAfter = solo !== null && solo === shots?.after;
  const mode: CompareMode = picked ?? defaultCompareMode(width);
  // 한 장뿐이면 겹치거나 번갈아 볼 짝이 없다 — 큰 사진 한 장과 없는 쪽의 사정만 보인다.
  const layout: CompareMode | "solo" | "none" = both ? mode : solo ? "solo" : "none";
  const soloNote = soloIsAfter
    ? target.submitted
      ? L.compare.noSubmitted
      : L.compare.noBefore
    : L.compare.noAfter;
  const pictures = phase === "ready" && layout !== "none";

  // 키 — 맨 위 층일 때만 듣는다(서랍 위의 비교가 열린 동안 서랍의 키와 섞이지 않게).
  const keyState = useRef({ layout });
  keyState.current = { layout };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const root = body.current?.closest(MODAL_ROOT_SELECTOR);
      const layers = Array.from(document.querySelectorAll(MODAL_ROOT_SELECTOR));
      if (!root || !escapeCloses(root, layers)) return;
      const { layout: now } = keyState.current;
      if (now === "none") return;
      const action = compareKeyAction(event, {
        mode: now === "solo" ? "side" : now,
        zoom: viewRef.current.zoom,
      });
      if (!action) return;
      event.preventDefault();
      if (action.kind === "zoom") {
        update((current, m) =>
          zoomAt(current, stepZoom(current.zoom, action.direction), { x: 0, y: 0 }, m.fit, m.stage),
        );
      } else if (action.kind === "reset") {
        update(() => HOME_VIEW);
      } else if (action.kind === "pan") {
        update((current, m) => panBy(current, action.dx, action.dy, m.fit, m.stage));
      } else if (action.kind === "side") {
        setSide(action.side);
      } else {
        setSplit((current) => applySplit(current, action));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [update]);

  const zoomBy = (direction: 1 | -1) =>
    update((current, m) =>
      zoomAt(current, stepZoom(current.zoom, direction), { x: 0, y: 0 }, m.fit, m.stage),
    );

  const headLabel = target.submitted ? L.compare.submitted : L.compare.title;
  const title = [headLabel, target.title].filter(Boolean).join(" · ");
  const shared: ViewerShared = {
    title: target.title,
    view,
    update,
    metrics,
    beforeLabel,
    afterLabel,
  };

  let viewer: ReactNode = null;
  if (phase === "loading") {
    // 사진이 설 자리를 같은 크기로 잡아 둔다 — 사진이 와도 창이 출렁이지 않는다.
    viewer =
      mode === "side" ? (
        <div className="nx-compare-pair" aria-hidden="true">
          <div className="nx-compare-skel nx-compare-skel--ratio" />
          <div className="nx-compare-skel nx-compare-skel--ratio" />
        </div>
      ) : (
        <div className="nx-compare-skel nx-compare-skel--ratio" aria-hidden="true" />
      );
  } else if (phase === "failed") {
    viewer = (
      <div className="nx-compare-empty">
        {/* 문장만 새로 서서(key) 다시 읽히고, 단추는 그 자리에 남아 초점이 달아나지 않는다. */}
        <p className="nx-compare-msg nx-compare-msg--fail" role="alert" key={failures}>
          {failures > 1 ? L.compare.failedAgain : L.compare.failed}
        </p>
        <button
          type="button"
          className="nx-btn nx-btn--sm"
          disabled={retrying}
          aria-busy={retrying || undefined}
          onClick={() => {
            setRetrying(true);
            setAttempt((n) => n + 1);
          }}
        >
          {retrying && <Spin />}
          {retrying ? L.compare.retrying : L.vocab.retry}
        </button>
      </div>
    );
  } else if (layout === "none") {
    viewer = (
      <div className="nx-compare-empty">
        <p className="nx-compare-msg">
          <ImageOff size={20} strokeWidth={1.7} aria-hidden="true" />
          {L.compare.noRecord}
        </p>
      </div>
    );
  } else if (both && layout === "side") {
    viewer = <SideView both={both} {...shared} />;
  } else if (both && layout === "overlay") {
    viewer = <OverlayView both={both} split={split} setSplit={setSplit} {...shared} />;
  } else if (both && layout === "flip") {
    viewer = <FlipView both={both} side={side} {...shared} />;
  } else if (solo) {
    viewer = <SoloView shot={solo} isAfter={soloIsAfter} note={soloNote} {...shared} />;
  }

  const status = phase === "loading" ? L.compare.loading : pictures ? L.compare.loaded : "";

  return (
    <ModalFrame
      onClose={onClose}
      returnRef={returnRef}
      backClassName="nx-compare-back"
      className="nx-compare"
    >
      <ModalHead
        title={title}
        sub={L.compare.picture}
        icon={<SquareSplitHorizontal size={17} strokeWidth={1.8} aria-hidden="true" />}
      />
      {pictures && (
        <div className="nx-compare-bar">
          {both && (
            <Seg
              label={L.compare.modes}
              value={mode}
              options={[
                { value: "side", text: L.compare.modeSide },
                { value: "overlay", text: L.compare.modeOverlay },
                { value: "flip", text: L.compare.modeFlip },
              ]}
              onPick={setPicked}
            />
          )}
          {both && layout === "flip" && (
            <Seg
              label={L.compare.flipGroup}
              value={side}
              options={[
                { value: "before", text: beforeLabel },
                { value: "after", text: afterLabel },
              ]}
              onPick={setSide}
            />
          )}
          <span className="nx-grow" />
          <div className="nx-compare-zoom">
            <button
              type="button"
              className="nx-ibtn"
              title={L.compare.zoomOut}
              aria-label={L.compare.zoomOut}
              aria-disabled={view.zoom <= 1}
              onClick={() => view.zoom > 1 && zoomBy(-1)}
            >
              <MinusIcon />
            </button>
            <button
              type="button"
              className="nx-compare-pct"
              title={L.compare.zoomReset}
              aria-label={L.compare.zoomReset}
              aria-disabled={view.zoom <= 1}
              onClick={() => view.zoom > 1 && update(() => HOME_VIEW)}
            >
              {zoomPercent(view.zoom)}%
            </button>
            <button
              type="button"
              className="nx-ibtn"
              title={L.compare.zoomIn}
              aria-label={L.compare.zoomIn}
              aria-disabled={view.zoom >= COMPARE_ZOOM_MAX}
              onClick={() => view.zoom < COMPARE_ZOOM_MAX && zoomBy(1)}
            >
              <PlusIcon />
            </button>
          </div>
        </div>
      )}
      <div className="nx-compare-body" ref={body}>
        {viewer}
      </div>
      <p className="nx-sr" role="status">
        {status}
      </p>
      {/* 사진이 없거나 못 읽은 창에는 바닥이 할 말이 없다 — 빈 줄을 두지 않는다. */}
      {(pictures || phase === "loading") && (
        <ModalFoot className="nx-compare-foot">
          {pictures ? (
            <span className="nx-compare-hints">
              {layout === "flip" && <Hint keys={["←", "→"]}>{L.compare.hintFlip}</Hint>}
              {layout === "overlay" && <Hint keys={["←", "→"]}>{L.compare.hintSlide}</Hint>}
              <Hint keys={["+", "−"]}>{L.compare.hintZoom}</Hint>
              <Hint keys={["0"]}>{L.compare.hintReset}</Hint>
              {(layout === "side" || layout === "solo") && <Hint>{L.compare.hintDrag}</Hint>}
            </span>
          ) : (
            <span />
          )}
          <span className="nx-compare-meta">
            {target.submitted ? L.compare.submittedDesktop : L.compare.desktop}
          </span>
        </ModalFoot>
      )}
    </ModalFrame>
  );
}

/** 읽기 전용 사진 — 지난 요청의 `수정 후` 는 오늘의 미리보기가 아니라 그때 찍어 둔 사진이다. */
export function ComparisonDialog({ daemon }: { daemon: Daemon }) {
  const [open, setOpen] = useState<{ target: ComparisonTarget; seq: number } | null>(null);
  const returnRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onOpen = (event: Event) => {
      const next = (event as CustomEvent<ComparisonTarget>).detail;
      if (!next?.route) return;
      // 연 순간의 초점을 붙들어 둔다 — 닫은 뒤 그 자리로 돌려 보낸다.
      returnRef.current = returnTargetOf(document.activeElement);
      setOpen((current) => ({
        target: { ...next, route: screenPath(next.route) },
        seq: (current?.seq ?? 0) + 1,
      }));
    };
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 프로젝트가 바뀌면 열린 비교는 닫는다.
  useEffect(() => {
    setOpen(null);
  }, [daemon.activeSlug]);
  if (!open) return null;
  return createPortal(
    <Comparison
      key={open.seq}
      target={open.target}
      daemon={daemon}
      returnRef={returnRef}
      onClose={() => setOpen(null)}
    />,
    document.querySelector(".nx") ?? document.body,
  );
}
