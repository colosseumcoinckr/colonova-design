/**
 * 비교 대화상자의 순수 계산 — 보기 방식의 기본값 · 확대의 한계 · 두 사진이 함께 움직이는 이동 ·
 * 와이프(겹쳐서)의 선 · 키 한 번이 하는 일(2026-10-06 겹판 손질). 형제 모듈을 부르지 않는다
 * (시험이 src 에서 곧장 읽는다) — 문장은 부르는 쪽이 `L` 로 지어 건넨다.
 *
 * 좌표의 약속: 칸(stage)의 중심이 원점이다. `pan` 은 그림 중심이 칸 중심에서 벗어난 px,
 * `zoom` 은 칸에 통째로 들어오는 크기(`fitSize`)를 1 로 센 배율이다. 사진 둘은 같은 `zoom` ·
 * `pan` 한 벌을 쓰므로 어느 쪽을 끌어도 같이 움직인다 — 동기화는 계산이 아니라 구조다.
 */

/** 보기 방식 — 나란히(둘을 옆으로) · 겹쳐서(와이프) · 번갈아(한 장씩). */
export type CompareMode = "side" | "overlay" | "flip";

/** 이 폭(대화상자의 px)보다 좁으면 나란히는 사진이 너무 작아져 번갈아가 기본이다. */
export const SIDE_BY_SIDE_MIN = 920;

/** 대화상자 폭 → 처음 보기 방식. 폭을 못 쟀으면(0 · NaN) 넓은 창으로 본다. */
export function defaultCompareMode(dialogWidth: number): CompareMode {
  return Number.isFinite(dialogWidth) && dialogWidth > 0 && dialogWidth < SIDE_BY_SIDE_MIN
    ? "flip"
    : "side";
}

export const COMPARE_ZOOM_MIN = 1;
export const COMPARE_ZOOM_MAX = 2.5;
export const COMPARE_ZOOM_STEP = 0.25;

// `+ 0` 은 -0 을 0 으로 편다 — 한계가 0 인 쪽에서 `-0` 이 새어 나오지 않게.
const round = (value: number) => Math.round(value * 1000) / 1000 + 0;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** 배율을 한계 안으로. 이상한 값은 처음 크기. */
export function clampZoom(zoom: number): number {
  return Number.isFinite(zoom) ? round(clamp(zoom, COMPARE_ZOOM_MIN, COMPARE_ZOOM_MAX)) : 1;
}

/** 한 칸 크게(1) · 작게(-1) — 25% 눈금에 맞춘다(1.1 에서 크게 → 1.25, 작게 → 1). */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const at = clampZoom(zoom) / COMPARE_ZOOM_STEP;
  const next = direction > 0 ? Math.floor(at + 1e-9) + 1 : Math.ceil(at - 1e-9) - 1;
  return clampZoom(next * COMPARE_ZOOM_STEP);
}

/** 배율 알약의 글자 — `150%`. */
export function zoomPercent(zoom: number): number {
  return Math.round(clampZoom(zoom) * 100);
}

/**
 * 휠로 움직이는 크기. 트랙패드의 두 손가락 모으기(ctrl + 휠)는 작은 값이 잇따라 오고, 마우스 휠은 한 칸에
 * 100 안팎이 온다 — 한 칸이 4분의 1(28%) 가량 움직이게 맞췄다(처음에는 한 칸에 한계까지 뛰었다).
 */
export function wheelZoom(zoom: number, deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return clampZoom(zoom);
  return clampZoom(zoom * Math.exp(-clamp(deltaY, -120, 120) * 0.0025));
}

export interface Size {
  width: number;
  height: number;
}

export interface Pan {
  x: number;
  y: number;
}

/** 그림이 칸 안에 비율을 지켜 통째로 들어오는 크기. 크기를 모르면 0 × 0. */
export function fitSize(image: Size, stage: Size): Size {
  const known = [image.width, image.height, stage.width, stage.height].every(
    (value) => Number.isFinite(value) && value > 0,
  );
  if (!known) return { width: 0, height: 0 };
  const scale = Math.min(stage.width / image.width, stage.height / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

/** 확대한 그림이 칸을 넘치는 만큼만 움직일 수 있다 — 중심에서 ±. 칸 안에 든 쪽은 0. */
export function panLimits(fit: Size, zoom: number, stage: Size): Pan {
  const z = clampZoom(zoom);
  return {
    x: Math.max(0, (fit.width * z - stage.width) / 2),
    y: Math.max(0, (fit.height * z - stage.height) / 2),
  };
}

/** 이동을 한계 안으로 — 그림 가장자리가 칸 안으로 끌려 들어와 빈 틈이 생기지 않게. */
export function clampPan(pan: Pan, fit: Size, zoom: number, stage: Size): Pan {
  const limit = panLimits(fit, zoom, stage);
  return {
    x: round(clamp(Number.isFinite(pan.x) ? pan.x : 0, -limit.x, limit.x)),
    y: round(clamp(Number.isFinite(pan.y) ? pan.y : 0, -limit.y, limit.y)),
  };
}

export interface View {
  zoom: number;
  pan: Pan;
}

/** 손으로 끌어 옮긴다 — 끈 만큼 그림이 따라온다. */
export function panBy(view: View, dx: number, dy: number, fit: Size, stage: Size): View {
  return {
    zoom: view.zoom,
    pan: clampPan({ x: view.pan.x + dx, y: view.pan.y + dy }, fit, view.zoom, stage),
  };
}

/**
 * 한 점을 붙든 채 크기를 바꾼다 — `focal` 은 칸 중심에서 잰 포인터의 자리(px). 그 점 밑의 그림이
 * 포인터 밑에 그대로 남아, 보던 곳을 확대해도 시선이 달아나지 않는다. 처음 크기로 돌아오면
 * 이동도 0 이 된다.
 */
export function zoomAt(view: View, nextZoom: number, focal: Pan, fit: Size, stage: Size): View {
  const from = clampZoom(view.zoom);
  const to = clampZoom(nextZoom);
  const ratio = to / from;
  return {
    zoom: to,
    pan: clampPan(
      {
        x: focal.x - (focal.x - view.pan.x) * ratio,
        y: focal.y - (focal.y - view.pan.y) * ratio,
      },
      fit,
      to,
      stage,
    ),
  };
}

/** 처음 크기 — 칸에 통째로 들어온 모습. */
export const HOME_VIEW: View = { zoom: 1, pan: { x: 0, y: 0 } };

/** 확대한 동안만 끌어 옮길 데가 있다. */
export function isPannable(zoom: number): boolean {
  return clampZoom(zoom) > COMPARE_ZOOM_MIN + 1e-9;
}

/** 와이프의 선 자리(0~100%) — 왼쪽에서 그만큼이 `수정 전`, 나머지가 `수정 후` 다. */
export function clampSplit(percent: number): number {
  return Number.isFinite(percent) ? Math.round(clamp(percent, 0, 100)) : 50;
}

/** 포인터의 가로 자리 → 선 자리. */
export function splitFromPointer(clientX: number, left: number, width: number): number {
  if (!(width > 0)) return 50;
  return clampSplit(((clientX - left) / width) * 100);
}

/** 낭독 · 글자로 읽는 두 몫 — 합이 늘 100 이다(`수정 전 40% · 수정 후 60%`). */
export function splitShares(split: number): { before: number; after: number } {
  const before = clampSplit(split);
  return { before, after: 100 - before };
}

/** 키 한 번이 하는 일 — 화면은 이 판정을 받아 상태를 바꾼다. */
export type CompareAction =
  | { kind: "zoom"; direction: 1 | -1 }
  | { kind: "reset" }
  | { kind: "side"; side: "before" | "after" }
  | { kind: "split"; by: number }
  | { kind: "split"; to: number }
  | { kind: "pan"; dx: number; dy: number };

/** 화살표 한 번에 옮기는 px(Shift 는 세 배) · 선은 2%(Shift 는 10%). */
const PAN_STEP = 48;
const SPLIT_STEP = 2;
const SPLIT_STEP_FAST = 10;

/**
 * 키 → 일. `+ −` 크기 · `0` 처음 크기는 어느 보기에서나 같다. 화살표는 보기마다 뜻이 다르다:
 * 번갈아는 ←(수정 전) →(수정 후), 겹쳐서는 ← → 가 선을 옮기고, 그 밖에는 확대했을 때 그림을
 * 옮긴다. 위 아래는 확대했을 때만 그림을 옮긴다. 뜻이 없는 키는 null — 건드리지 않는다.
 */
export function compareKeyAction(
  event: { key: string; shiftKey?: boolean },
  state: { mode: CompareMode; zoom: number },
): CompareAction | null {
  const { key } = event;
  const fast = event.shiftKey === true;
  if (key === "+" || key === "=") return { kind: "zoom", direction: 1 };
  if (key === "-" || key === "_") return { kind: "zoom", direction: -1 };
  if (key === "0") return { kind: "reset" };
  const horizontal = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
  const vertical = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0;
  const step = fast ? PAN_STEP * 3 : PAN_STEP;
  if (horizontal !== 0) {
    if (state.mode === "flip") return { kind: "side", side: horizontal < 0 ? "before" : "after" };
    if (state.mode === "overlay") {
      return { kind: "split", by: horizontal * (fast ? SPLIT_STEP_FAST : SPLIT_STEP) };
    }
    // 그림이 끌려 가는 쪽은 손가락의 반대다 — 오른쪽 화살표는 오른쪽을 더 보여 준다.
    return isPannable(state.zoom) ? { kind: "pan", dx: -horizontal * step, dy: 0 } : null;
  }
  if (vertical !== 0) {
    return isPannable(state.zoom) ? { kind: "pan", dx: 0, dy: -vertical * step } : null;
  }
  if (state.mode === "overlay" && key === "Home") return { kind: "split", to: 0 };
  if (state.mode === "overlay" && key === "End") return { kind: "split", to: 100 };
  return null;
}

/** 선 움직임 하나를 적용한다 — `by` 는 지금 자리에서 그만큼, `to` 는 그 자리로. */
export function applySplit(current: number, action: { by: number } | { to: number }): number {
  return "by" in action ? clampSplit(current + action.by) : clampSplit(action.to);
}

/** 비교 창이 받는 사진 — 형식 · 크기가 안전한 것만 화면에 올린다(데이터 주소로 그리므로). */
export const COMPARE_MAX_BYTES = 4 * 1024 * 1024;

export function isSafeShot<Shot extends { mediaType: string; data: string }>(
  shot: Shot | null | undefined,
): shot is Shot {
  if (!shot) return false;
  const okType =
    shot.mediaType === "image/png" ||
    shot.mediaType === "image/jpeg" ||
    shot.mediaType === "image/webp";
  return okType && shot.data.length <= COMPARE_MAX_BYTES;
}
