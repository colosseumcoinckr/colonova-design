/**
 * 수정 전 · 후 사진에서 달라진 곳 찾기 — 결과 카드와 비교 대화상자가 사진 위에 윤곽을 그린다
 * (2026-10-08 베타 준비 분석 · 2026-10-06 겹판 점검 E 의 해소). 형제 모듈을 부르지 않고 DOM 도 모른다 —
 * 시험이 src 에서 곧장 읽고, 브라우저 쪽 얇은 어댑터(`photo-canvas.ts`)가 사진을 `RgbaImage` 로 풀어 건넨다.
 *
 * 왜 조심스러운가: 1~2px 의 변화는 번갈아 봐도 안 보이고, 요청하지 않은 곳이 달라졌는지는 사람이 눈으로 찾아야
 * 했다. 그런데 거짓 윤곽(달라지지 않은 곳에 선 윤곽)은 윤곽이 없는 것보다 나쁘다 — 그래서 의심스러우면 모두 물러난다:
 * 크기가 너무 다르면 비교하지 않고(`comparable: false`), 잡음 수준의 변화는 상자를 만들지 않고, 너무 작은 상자는 버린다.
 *
 * 좌표의 약속: 상자는 수정 후 사진의 가로 · 세로를 각각 1 로 센 정규화 좌표다(왼쪽 위가 원점). 화면의 사진이 어떻게
 * 놓이든(칸에 맞춤 · 확대) 퍼센트로 옮기면 그대로 맞는다.
 */

/** 브라우저의 `ImageData` 와 같은 모양 — DOM 없이 합성 버퍼로 시험한다. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** 정규화한 사각형(수정 후 사진 기준 0..1). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiffResult {
  /** 달라진 곳의 상자들 — 위에서 아래로, 왼쪽에서 오른쪽으로. 비교할 수 없으면 빈 목록. */
  regions: Box[];
  /** 겹치는 면적(넘치는 길이 포함) 중 달라진 몫 0..1. 비교할 수 없으면 0 — 쓰지 않는다. */
  changedRatio: number;
  /** 두 사진이 같은 화면의 같은 폭으로 찍혔다고 볼 수 있나. 아니면 윤곽을 그리지 않는다. */
  comparable: boolean;
}

export interface DiffOptions {
  /** 비교하는 폭(px) — 이보다 넓은 사진은 이 폭으로 줄여 본다(안티앨리어싱 · 압축 잡음이 줄어든다). */
  width?: number;
  /** 격자 한 칸의 한 변(줄인 사진의 px). */
  cell?: number;
  /** 채널 차의 합(0..765)이 이 값 이상이면 변경 픽셀. */
  threshold?: number;
  /** 한 칸에서 변경 픽셀이 이만큼 이상이어야 변경 칸이다. */
  cellPixels?: number;
  /** 두 상자의 사이가 이 px 이하면 하나로 합친다. */
  mergeGap?: number;
  /** 상자 하나가 품은 변경 픽셀이 이보다 적으면 버린다. */
  minPixels?: number;
  /** 상자 수의 상한 — 넘으면 가까운 것부터 합친다. */
  maxBoxes?: number;
}

/** 2026-10-08 — 합성 사진 쌍과 1200×750 사진에서 고른 값. 바꾸면 시험의 허용 오차도 본다. */
export const DIFF_DEFAULTS = {
  width: 480,
  cell: 12,
  threshold: 48,
  cellPixels: 4,
  mergeGap: 10,
  minPixels: 10,
  maxBoxes: 12,
} as const;

const UNSET = 2147483647;
/** 가로 폭이 이 비율보다 더 다르면 다른 크기의 화면이다(최소 2px 의 어긋남은 반올림으로 본다). */
const WIDTH_TOLERANCE = 0.01;
/** 세로가 이 배수 이상 어긋나면 같은 화면이 아니다 — 긴 쪽이 짧은 쪽의 두 배 이상. */
const HEIGHT_LIMIT = 2;
/** 달라진 몫이 이 이상이면 곳곳이 아니라 화면 전체가 달라진 것이다 — 윤곽은 소음이다. */
export const WIDE_RATIO = 0.5;

function usable(image: RgbaImage): boolean {
  return (
    Number.isInteger(image.width) &&
    Number.isInteger(image.height) &&
    image.width > 0 &&
    image.height > 0 &&
    image.data.length >= image.width * image.height * 4
  );
}

/**
 * 같은 배율로 줄인 RGB(알파는 흰 종이 위에 얹어 지운다). 칸 평균이라 한 픽셀짜리 잡음과 안티앨리어싱이 옅어지고,
 * 두 사진이 같은 배율을 쓰므로 같은 그림은 같게 줄어든다.
 */
function shrink(image: RgbaImage, scale: number, outW: number, outH: number): Uint8Array {
  const { width, height, data } = image;
  const out = new Uint8Array(outW * outH * 3);
  for (let ty = 0; ty < outH; ty += 1) {
    const sy0 = Math.min(height - 1, Math.floor(ty / scale));
    const sy1 = Math.min(height, Math.max(sy0 + 1, Math.floor((ty + 1) / scale)));
    for (let tx = 0; tx < outW; tx += 1) {
      const sx0 = Math.min(width - 1, Math.floor(tx / scale));
      const sx1 = Math.min(width, Math.max(sx0 + 1, Math.floor((tx + 1) / scale)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        let i = (sy * width + sx0) * 4;
        for (let sx = sx0; sx < sx1; sx += 1) {
          const a = data[i + 3] ?? 255;
          const paper = 255 - a;
          r += ((data[i] ?? 0) * a + 255 * paper) / 255;
          g += ((data[i + 1] ?? 0) * a + 255 * paper) / 255;
          b += ((data[i + 2] ?? 0) * a + 255 * paper) / 255;
          n += 1;
          i += 4;
        }
      }
      const o = (ty * outW + tx) * 3;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
    }
  }
  return out;
}

/** 줄인 사진 위의 반열린 구간 `[x0, x1) × [y0, y1)` 와 그 안의 변경 픽셀 수. */
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  px: number;
}

const joined = (a: Rect, b: Rect): Rect => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
  px: a.px + b.px,
});

/** 두 사각형 사이의 가로 · 세로 빈틈 — 겹치거나 맞닿으면 0. */
function gapOf(a: Rect, b: Rect): { x: number; y: number } {
  return {
    x: Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1)),
    y: Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1)),
  };
}

/** 가까운 상자를 하나로 — 합쳐져 커진 상자가 또 다른 상자와 가까워질 수 있어 더 합칠 것이 없을 때까지 돈다. */
function joinNear(rects: Rect[], gap: number): Rect[] {
  const list = rects.slice();
  let moved = true;
  while (moved) {
    moved = false;
    for (let i = 0; i < list.length; i += 1) {
      let j = i + 1;
      while (j < list.length) {
        const a = list[i];
        const b = list[j];
        if (a && b) {
          const g = gapOf(a, b);
          if (g.x <= gap && g.y <= gap) {
            list[i] = joined(a, b);
            list.splice(j, 1);
            moved = true;
            j = i + 1;
            continue;
          }
        }
        j += 1;
      }
    }
  }
  return list;
}

/** 상자 수의 상한 — 가장 가까운 한 쌍부터 합쳐 달라진 곳을 버리지 않고 줄인다. */
function capRects(rects: Rect[], max: number): Rect[] {
  const list = rects.slice();
  while (list.length > Math.max(1, max)) {
    let bestI = 0;
    let bestJ = 1;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (!a || !b) continue;
        const g = gapOf(a, b);
        const d = g.x * g.x + g.y * g.y;
        if (d < best) {
          best = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    const a = list[bestI];
    const b = list[bestJ];
    if (!a || !b) break;
    list[bestI] = joined(a, b);
    list.splice(bestJ, 1);
  }
  return list;
}

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

/**
 * 두 사진이 어디서 달라졌나.
 *
 * 1. 크기가 너무 다르면(가로가 다르거나 세로가 두 배 이상 어긋남) 물러난다 — 같은 화면이 아니다.
 * 2. 같은 배율로 폭 480 안팎까지 줄인 두 사진의 겹치는 좌상단 영역을 픽셀마다 비교한다. 수정 후가 더 길면 넘치는 아랫 부분은
 *    통째로 달라진 것으로 센다(수정 전이 더 길면 그려 줄 자리가 없어 몫만 센다).
 * 3. 12px 격자 칸마다 변경 픽셀을 세어 일정 수 이상인 칸만 변경 칸이다 — 한두 픽셀의 잡음은 칸을 켜지 못한다.
 * 4. 이웃한 변경 칸을 이어 붙이고, 상자는 칸이 아니라 변경 픽셀이 닿은 곳까지로 죄어 준다(좌표가 칸 눈금에 갇히지 않는다).
 * 5. 가까운 상자를 합치고, 변경 픽셀이 너무 적은 상자는 버리고, 상한(12)을 넘으면 가까운 것부터 더 합친다.
 */
export function diffRegions(
  before: RgbaImage,
  after: RgbaImage,
  options: DiffOptions = {},
): DiffResult {
  const o = { ...DIFF_DEFAULTS, ...options };
  const give = (comparable: boolean): DiffResult => ({ regions: [], changedRatio: 0, comparable });
  if (!usable(before) || !usable(after)) return give(false);
  const wide = Math.max(before.width, after.width);
  if (Math.abs(before.width - after.width) > Math.max(2, wide * WIDTH_TOLERANCE))
    return give(false);
  if (
    Math.max(before.height, after.height) / Math.min(before.height, after.height) >=
    HEIGHT_LIMIT
  ) {
    return give(false);
  }

  const scale = Math.min(1, o.width / after.width);
  const aw = Math.max(1, Math.round(after.width * scale));
  const ah = Math.max(1, Math.round(after.height * scale));
  const bw = Math.max(1, Math.round(before.width * scale));
  const bh = Math.max(1, Math.round(before.height * scale));
  const a = shrink(after, scale, aw, ah);
  const b = shrink(before, scale, bw, bh);
  // 가로가 한두 픽셀 어긋난 가장자리는 비교하지 않는다(반올림의 몫이다). 세로가 넘치는 만큼은 달라진 것이다.
  const cw = Math.min(aw, bw);
  const ch = Math.min(ah, bh);

  const cols = Math.ceil(aw / o.cell);
  const rows = Math.ceil(ah / o.cell);
  const cells = cols * rows;
  // 칸마다 변경 픽셀 수와 그 픽셀들이 닿은 범위 — 상자를 칸 눈금이 아니라 변경 픽셀까지로 죄는 재료다.
  const count = new Uint32Array(cells);
  const minX = new Int32Array(cells).fill(UNSET);
  const minY = new Int32Array(cells).fill(UNSET);
  const maxX = new Int32Array(cells).fill(-1);
  const maxY = new Int32Array(cells).fill(-1);
  let changed = 0;
  for (let y = 0; y < ah; y += 1) {
    const cy = Math.floor(y / o.cell);
    for (let x = 0; x < cw; x += 1) {
      let differs: boolean;
      if (y >= ch) {
        differs = true;
      } else {
        const i = (y * aw + x) * 3;
        const j = (y * bw + x) * 3;
        const d =
          Math.abs((a[i] ?? 0) - (b[j] ?? 0)) +
          Math.abs((a[i + 1] ?? 0) - (b[j + 1] ?? 0)) +
          Math.abs((a[i + 2] ?? 0) - (b[j + 2] ?? 0));
        differs = d >= o.threshold;
      }
      if (!differs) continue;
      changed += 1;
      const k = cy * cols + Math.floor(x / o.cell);
      count[k] = (count[k] ?? 0) + 1;
      if (x < (minX[k] ?? UNSET)) minX[k] = x;
      if (x > (maxX[k] ?? -1)) maxX[k] = x;
      if (y < (minY[k] ?? UNSET)) minY[k] = y;
      if (y > (maxY[k] ?? -1)) maxY[k] = y;
    }
  }
  // 수정 전이 더 길어 수정 후에 자리가 없는 넘침은 그릴 수 없다 — 몫에만 센다.
  const overflowBelow = bh > ah ? (bh - ah) * cw : 0;
  const total = cw * Math.max(ah, bh);
  const changedRatio = total > 0 ? round4(Math.min(1, (changed + overflowBelow) / total)) : 0;

  // 변경 칸을 이웃끼리(대각선 포함) 이어 붙인다.
  const lit = (k: number): boolean => (count[k] ?? 0) >= o.cellPixels;
  const seen = new Uint8Array(cells);
  const found: Rect[] = [];
  for (let start = 0; start < cells; start += 1) {
    if (seen[start] || !lit(start)) continue;
    seen[start] = 1;
    const stack = [start];
    const rect: Rect = { x0: aw, y0: ah, x1: 0, y1: 0, px: 0 };
    while (stack.length > 0) {
      const k = stack.pop() as number;
      rect.x0 = Math.min(rect.x0, minX[k] ?? aw);
      rect.y0 = Math.min(rect.y0, minY[k] ?? ah);
      rect.x1 = Math.max(rect.x1, (maxX[k] ?? -1) + 1);
      rect.y1 = Math.max(rect.y1, (maxY[k] ?? -1) + 1);
      rect.px += count[k] ?? 0;
      const cx = k % cols;
      const cy = (k - cx) / cols;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const n = ny * cols + nx;
          if (seen[n] || !lit(n)) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    found.push(rect);
  }

  const kept = capRects(
    joinNear(found, o.mergeGap).filter((rect) => rect.px >= o.minPixels),
    o.maxBoxes,
  );
  const regions = kept
    .map(
      (rect): Box => ({
        x: round4(rect.x0 / aw),
        y: round4(rect.y0 / ah),
        w: round4((rect.x1 - rect.x0) / aw),
        h: round4((rect.y1 - rect.y0) / ah),
      }),
    )
    .sort((p, q) => p.y - q.y || p.x - q.x);
  return { regions, changedRatio, comparable: true };
}

/** 카드가 말할 한 줄의 종류 — 문장은 부르는 쪽이 `L` 로 짓는다. */
export type DiffSummary = { kind: "none" } | { kind: "wide" } | { kind: "regions"; count: number };

/** 윤곽을 그릴 수 없으면(비교 불가) null. 화면 대부분이 달라졌으면 상자 대신 한 마디만 한다. */
export function summarizeDiff(diff: DiffResult): DiffSummary | null {
  if (!diff.comparable) return null;
  if (diff.changedRatio >= WIDE_RATIO) return { kind: "wide" };
  if (diff.regions.length === 0) return { kind: "none" };
  return { kind: "regions", count: diff.regions.length };
}

export interface OutsideOptions {
  /** 사진의 세로 ÷ 가로 — 가로 · 세로의 여유를 같은 px 로 맞추는 데 쓴다. 기본은 16:10. */
  aspect?: number;
  /** 핀 둘레에서 `인접` 으로 치는 여유(사진 가로의 몫). */
  margin?: number;
  /** 이보다 작은 상자는 경고하지 않는다(사진 면적의 몫). */
  minArea?: number;
}

const OUTSIDE_DEFAULTS = { aspect: 0.625, margin: 0.05, minArea: 0.01 } as const;
/** 정규화 좌표가 사진 밖으로 이만큼까지는 반올림으로 본다. */
const PIN_SLACK = 0.02;

function pinUsable(pin: Box): boolean {
  const finite = [pin.x, pin.y, pin.w, pin.h].every((value) => Number.isFinite(value));
  return (
    finite &&
    pin.w > 0 &&
    pin.h > 0 &&
    pin.x >= -PIN_SLACK &&
    pin.y >= -PIN_SLACK &&
    pin.x + pin.w <= 1 + PIN_SLACK &&
    pin.y + pin.h <= 1 + PIN_SLACK
  );
}

/**
 * 요청한 곳 밖에서 달라진 상자들 — `요청한 곳 밖도 달라졌어요` 의 근거. 거짓 경보는 신뢰를 깨므로 세 겹으로 물러난다:
 * ① 핀이 없으면(말만 한 요청) 경고하지 않는다. ② 핀 하나라도 사진 밖이거나 이상하면(좌표를 믿을 수 없다) 모두 믿지
 * 않는다. ③ 핀이 가리킨 곳(겹치거나 곁)이 달라진 상자가 하나도 없으면 경고하지 않는다 — 좌표가 어긋났는지 AI 가 다른 곳을
 * 고쳤는지 가를 수 없고, 어긋났다면 모든 상자가 밖으로 읽혀 전부 거짓 경보가 되기 때문이다. 이 셋을 지나고서야, 핀과
 * 겹치지도 곁에 있지도 않은 상자 가운데 면적이 기준 이상인 것만 돌려준다(부른 쪽의 상자 객체 그대로).
 */
export function outsideRegions(
  regions: readonly Box[],
  pins: readonly Box[],
  options: OutsideOptions = {},
): Box[] {
  const o = { ...OUTSIDE_DEFAULTS, ...options };
  if (pins.length === 0 || regions.length === 0 || !pins.every(pinUsable)) return [];
  const aspect = o.aspect > 0 && Number.isFinite(o.aspect) ? o.aspect : OUTSIDE_DEFAULTS.aspect;
  const mx = o.margin;
  const my = o.margin / aspect;
  const near = (region: Box): boolean =>
    pins.some(
      (pin) =>
        region.x < pin.x + pin.w + mx &&
        region.x + region.w > pin.x - mx &&
        region.y < pin.y + pin.h + my &&
        region.y + region.h > pin.y - my,
    );
  if (!regions.some(near)) return [];
  return regions.filter((region) => !near(region) && region.w * region.h >= o.minArea);
}
