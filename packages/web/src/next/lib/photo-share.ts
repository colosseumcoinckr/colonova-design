/**
 * 한 장으로 복사 — 수정 전 | 수정 후 를 한 장의 사진으로 합칠 때의 자리 계산(2026-10-08 베타 준비 분석 · 겹판 점검 E).
 * Slack · 메일에 한 장으로 붙여 공유하는 길이다. 형제 모듈을 부르지 않고 DOM 도 모른다 — 캔버스에 그리는 일은 브라우저 쪽
 * 어댑터(`photo-canvas.ts`)가 하고, 여기서는 두 사진의 크기를 받아 캔버스의 크기와 사진 · 이름표의 자리만 계산한다.
 *
 * 나란히가 기본이고, 나란히 놓으면 사진이 너무 작아질 만큼 넓은 사진이면 위아래로 놓는다. 사진이 한 장뿐이면(수정 전이
 * 없는 카드) 이름표 없이 그 한 장만 — 없는 수정 전을 만들어 거짓 `전 | 후` 를 짓지 않는다.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 사진 한 장과 그 위의 이름표 띠(사진 바로 위). 이름표가 없으면 null. */
export interface ShareTile {
  label: Rect | null;
  photo: Rect;
}

export interface ShareLayout {
  width: number;
  height: number;
  /** `row` 나란히 · `column` 위아래 · `single` 사진 한 장. */
  direction: "row" | "column" | "single";
  /** 원본 사진을 줄인 비율(1 이하) — 윤곽의 두께 같은 px 값을 이 비율로 맞춘다. */
  scale: number;
  before: ShareTile | null;
  after: ShareTile;
}

/** 붙여 넣는 곳(Slack · 메일)이 읽기 좋은 최대 폭. */
export const SHARE_MAX_WIDTH = 1600;
/** 세로가 아주 긴 사진 한 쌍이 캔버스 한계를 넘지 않게. */
export const SHARE_MAX_HEIGHT = 6000;
export const SHARE_PAD = 24;
export const SHARE_GAP = 24;
/** 이름표 띠의 높이. */
export const SHARE_LABEL = 32;
/** 나란히 놓으면 사진이 이 배율 아래로 줄어야 할 때(그리고 위아래가 더 크게 보일 때) 위아래로 놓는다. */
export const SHARE_MIN_ROW_SCALE = 0.55;

/** 정수 px — 내림이라 합친 폭이 한계를 반올림으로 넘지 않는다(부동소수 오차는 먼저 걷는다). */
const px = (value: number): number =>
  Number.isFinite(value) ? Math.max(1, Math.floor(value + 1e-6)) : 1;

function tile(x: number, y: number, size: Size, scale: number, labeled: boolean): ShareTile {
  const photo = {
    x,
    y: y + (labeled ? SHARE_LABEL : 0),
    width: px(size.width * scale),
    height: px(size.height * scale),
  };
  return { photo, label: labeled ? { x, y, width: photo.width, height: SHARE_LABEL } : null };
}

/**
 * 두 사진의 크기 → 캔버스 크기와 자리. `before` 가 null 이면 수정 후 한 장만. 모든 값은 정수 px 이고, 폭은 1600 을 넘지 않는다.
 */
export function shareLayout(before: Size | null, after: Size): ShareLayout {
  const a = { width: px(after.width), height: px(after.height) };
  if (!before) {
    const scale = Math.min(1, SHARE_MAX_WIDTH / a.width, SHARE_MAX_HEIGHT / a.height);
    const only = tile(0, 0, a, scale, false);
    return {
      width: only.photo.width,
      height: only.photo.height,
      direction: "single",
      scale,
      before: null,
      after: only,
    };
  }
  const b = { width: px(before.width), height: px(before.height) };
  const rowScale = Math.min(1, (SHARE_MAX_WIDTH - 2 * SHARE_PAD - SHARE_GAP) / (a.width + b.width));
  const columnScale = Math.min(1, (SHARE_MAX_WIDTH - 2 * SHARE_PAD) / Math.max(a.width, b.width));
  if (rowScale >= SHARE_MIN_ROW_SCALE || rowScale >= columnScale) {
    // 가로로 좁힌 값이 세로 한계에도 닿으면 더 줄인다.
    const fixed = 2 * SHARE_PAD + SHARE_LABEL;
    const scale = Math.min(rowScale, (SHARE_MAX_HEIGHT - fixed) / Math.max(a.height, b.height));
    const left = tile(SHARE_PAD, SHARE_PAD, b, scale, true);
    const right = tile(left.photo.x + left.photo.width + SHARE_GAP, SHARE_PAD, a, scale, true);
    return {
      width: right.photo.x + right.photo.width + SHARE_PAD,
      height: fixed + Math.max(left.photo.height, right.photo.height),
      direction: "row",
      scale,
      before: left,
      after: right,
    };
  }
  const fixed = 2 * SHARE_PAD + 2 * SHARE_LABEL + SHARE_GAP;
  const scale = Math.min(columnScale, (SHARE_MAX_HEIGHT - fixed) / (a.height + b.height));
  const top = tile(SHARE_PAD, SHARE_PAD, b, scale, true);
  const bottom = tile(SHARE_PAD, top.photo.y + top.photo.height + SHARE_GAP, a, scale, true);
  return {
    width: 2 * SHARE_PAD + Math.max(top.photo.width, bottom.photo.width),
    height: bottom.photo.y + bottom.photo.height + SHARE_PAD,
    direction: "column",
    scale,
    before: top,
    after: bottom,
  };
}

/**
 * 정규화한 상자(수정 후 사진 기준) → 캔버스 위의 사각형. 윤곽이 몸을 에워싸도록 `pad` 만큼 부풀리고, 사진 밖으로 나가지
 * 않게 사진 안으로 자른다.
 */
export function outlineRect(
  box: { x: number; y: number; w: number; h: number },
  photo: Rect,
  pad = 0,
): Rect {
  const left = Math.max(photo.x, photo.x + box.x * photo.width - pad);
  const top = Math.max(photo.y, photo.y + box.y * photo.height - pad);
  const right = Math.min(photo.x + photo.width, photo.x + (box.x + box.w) * photo.width + pad);
  const bottom = Math.min(photo.y + photo.height, photo.y + (box.y + box.h) * photo.height + pad);
  const thousandth = (value: number): number => Math.round(value * 1000) / 1000;
  return {
    x: thousandth(left),
    y: thousandth(top),
    width: thousandth(Math.max(0, right - left)),
    height: thousandth(Math.max(0, bottom - top)),
  };
}
