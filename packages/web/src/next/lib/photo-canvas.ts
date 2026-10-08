import {
  type Box,
  DIFF_DEFAULTS,
  type DiffResult,
  diffRegions,
  type RgbaImage,
} from "./photo-diff";
import { outlineRect, type ShareTile, shareLayout } from "./photo-share";

/**
 * 사진 위의 윤곽과 한 장 복사의 브라우저 쪽 얇은 어댑터(2026-10-08 베타 준비 분석 · 겹판 점검 E). 계산은 순수 모듈
 * (`photo-diff` · `photo-share`)이 하고, 여기서는 사진을 풀어 픽셀로 건네고(`Image` → 캔버스 → `ImageData`), 합친 그림을
 * 캔버스에 그려 PNG 로 굽고, 클립보드에 넣을 뿐이다. 사진은 `data:` 주소라 캔버스가 오염되지 않는다.
 */

/** 수정 후 사진의 원래 크기를 함께 든 비교 결과 — 윤곽을 얹는 SVG 의 비율이 이 크기다. */
export interface PhotoDiff extends DiffResult {
  width: number;
  height: number;
}

/** 그림 하나를 읽는다. 못 읽는(깨진) 그림은 null. */
function decode(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0 ? image : null);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/** 그림을 `scale` 배로 줄여 픽셀로 푼다 — 큰 사진은 줄인 뒤에 읽으므로 메모리와 시간이 작다. */
function pixelsOf(image: HTMLImageElement, scale: number): RgbaImage | null {
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return { width, height, data: context.getImageData(0, 0, width, height).data };
}

/** 브라우저가 한가할 때까지 — 카드가 화면에 뜨는 순간의 그림 그리기를 비켜 간다. */
function idle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => resolve(), { timeout: 600 });
    } else {
      window.setTimeout(resolve, 0);
    }
  });
}

async function compute(beforeSrc: string, afterSrc: string): Promise<PhotoDiff | null> {
  const [before, after] = await Promise.all([decode(beforeSrc), decode(afterSrc)]);
  if (!before || !after) return null;
  // 두 사진을 같은 배율로 줄인다(수정 후의 폭 기준) — 같은 그림이 같게 줄어야 윤곽이 거짓으로 서지 않는다.
  const scale = Math.min(1, DIFF_DEFAULTS.width / after.naturalWidth);
  const a = pixelsOf(after, scale);
  const b = pixelsOf(before, scale);
  if (!a || !b) return null;
  return { ...diffRegions(b, a), width: after.naturalWidth, height: after.naturalHeight };
}

interface Entry {
  job: Promise<PhotoDiff | null>;
  /** 끝난 값 — 카드가 다시 서도 껌뻑이지 않게 동기로 읽는다. */
  value: PhotoDiff | null;
}

/** 사진 쌍 단위의 캐시(수정 후 → 수정 전). 같은 쌍은 카드와 대화상자가 한 번만 계산한다. */
const MAX_PAIRS = 8;
const cache = new Map<string, Map<string, Entry>>();
const order: Array<[string, string]> = [];
let chain: Promise<unknown> = Promise.resolve();

function forget(before: string, after: string): void {
  const inner = cache.get(after);
  inner?.delete(before);
  if (inner && inner.size === 0) cache.delete(after);
  const at = order.findIndex(([a, b]) => a === after && b === before);
  if (at !== -1) order.splice(at, 1);
}

/** 이미 계산이 끝난 쌍의 결과 — 없으면 null. */
export function knownDiff(before: string, after: string): PhotoDiff | null {
  return cache.get(after)?.get(before)?.value ?? null;
}

/**
 * 두 사진의 달라진 곳. 한 번에 하나씩 차례로, 브라우저가 한가할 때 돈다. 못 읽거나 비교할 수 없으면 null(조용히 윤곽 없음)이고
 * 그 실패는 캐시에 남기지 않는다.
 */
export function photoDiff(before: string, after: string): Promise<PhotoDiff | null> {
  const hit = cache.get(after)?.get(before);
  if (hit) return hit.job;
  const run = chain
    .then(idle)
    .then(() => compute(before, after))
    .catch(() => null);
  chain = run;
  const entry: Entry = { value: null, job: run };
  entry.job = run.then((value) => {
    entry.value = value;
    if (!value) forget(before, after);
    return value;
  });
  let inner = cache.get(after);
  if (!inner) {
    inner = new Map();
    cache.set(after, inner);
  }
  inner.set(before, entry);
  order.push([after, before]);
  while (order.length > MAX_PAIRS) {
    const oldest = order.shift();
    if (oldest) forget(oldest[1], oldest[0]);
  }
  return entry.job;
}

// ── 한 장으로 복사 ───────────────────────────────────────────────────

/** 합친 그림에 쓰는 앱의 글꼴 · 윤곽 색 — 캔버스는 CSS 변수를 모르니 부르는 순간의 값을 읽어 건넨다. */
export interface ShareTheme {
  font: string;
  accent: string;
  warn: string;
}

/** `.nx` 뿌리의 토큰을 읽는다. 읽지 못하면 이 앱의 밝은 팔레트 값. */
export function readShareTheme(host: Element | null = document.querySelector(".nx")): ShareTheme {
  const style = getComputedStyle(host ?? document.documentElement);
  const token = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    font: token("--font", "sans-serif"),
    accent: token("--accent", "#4a6b8f"),
    warn: token("--warn", "#855312"),
  };
}

export interface ShareInput {
  /** 수정 전 사진과 그 이름표 — 없으면 수정 후 한 장만(이름표도 없다). */
  before: { src: string; label: string } | null;
  after: { src: string; label: string };
  /** 윤곽이 켜져 있으면 수정 후 사진 위에도 그린다. */
  outlines: { boxes: readonly Box[]; warn: ReadonlySet<Box> } | null;
}

/** 이름표 글자의 크기(합친 그림의 px) — 붙여 넣은 곳에서 줄어 보이므로 넉넉히. */
const LABEL_FONT = 20;
const STROKE = 3;

function trace(
  context: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  radius: number,
): void {
  context.beginPath();
  if (typeof context.roundRect === "function") {
    context.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
  } else {
    context.rect(rect.x, rect.y, rect.width, rect.height);
  }
}

/** 이름표 글자를 쓰는 글꼴이 오기까지 잠깐(1.2초까지) 기다린다 — 안 오면 있는 글꼴로 그린다. */
async function fontReady(font: string, text: string): Promise<void> {
  try {
    if (!document.fonts) return;
    await Promise.race([
      document.fonts.load(`700 ${LABEL_FONT}px ${font}`, text),
      new Promise((resolve) => window.setTimeout(resolve, 1200)),
    ]);
  } catch {
    /* 글꼴을 못 기다려도 합성은 그대로 간다. */
  }
}

/** 수정 전 | 수정 후 를 한 장의 PNG 로 합친다. 사진을 못 읽으면 던진다 — 거짓 전·후를 짓지 않는다. */
export async function composeShare(input: ShareInput, theme: ShareTheme): Promise<Blob> {
  const [before, after] = await Promise.all([
    input.before ? decode(input.before.src) : Promise.resolve(null),
    decode(input.after.src),
  ]);
  if (!after || (input.before && !before)) throw new Error("photo");
  const layout = shareLayout(
    before ? { width: before.naturalWidth, height: before.naturalHeight } : null,
    { width: after.naturalWidth, height: after.naturalHeight },
  );
  await fontReady(theme.font, `${input.before?.label ?? ""}${input.after.label}`);

  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  // 고정 — 공유하는 종이는 어느 테마에서도 흰 바탕에 어두운 글자다(붙여 넣는 곳은 앱의 팔레트를 모른다).
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, layout.width, layout.height);

  const tiles: Array<[ShareTile | null, HTMLImageElement | null, string | undefined]> = [
    [layout.before, before, input.before?.label],
    [layout.after, after, input.after.label],
  ];
  for (const [tile, image, label] of tiles) {
    if (!tile || !image) continue;
    const { photo } = tile;
    context.drawImage(image, photo.x, photo.y, photo.width, photo.height);
    if (layout.direction !== "single") {
      // 고정 — 흰 종이 위에서 사진의 가장자리를 가르는 얇은 테두리.
      context.strokeStyle = "#d4d7de";
      context.lineWidth = 1;
      context.strokeRect(photo.x + 0.5, photo.y + 0.5, photo.width - 1, photo.height - 1);
    }
    if (tile.label && label) {
      context.fillStyle = "#2b2f3a";
      context.font = `700 ${LABEL_FONT}px ${theme.font}`;
      context.textBaseline = "middle";
      context.fillText(label, tile.label.x, tile.label.y + tile.label.height / 2);
    }
  }

  if (input.outlines) {
    for (const box of input.outlines.boxes) {
      const rect = outlineRect(box, layout.after.photo, STROKE + 1);
      const color = input.outlines.warn.has(box) ? theme.warn : theme.accent;
      trace(context, rect, 6);
      context.save();
      context.globalAlpha = 0.12;
      context.fillStyle = color;
      context.fill();
      context.restore();
      // 고정 — 어두운 바깥 띠가 흰 쪽에서도 옅은 포인트 색 윤곽을 받쳐 준다.
      trace(context, rect, 6);
      context.lineWidth = STROKE + 2;
      context.strokeStyle = "rgba(0, 0, 0, 0.35)";
      context.stroke();
      trace(context, rect, 6);
      context.lineWidth = STROKE;
      context.strokeStyle = color;
      context.stroke();
    }
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("png");
  return blob;
}

/**
 * 사진을 클립보드에 넣는다. `ClipboardItem` 은 Blob 의 약속(Promise)을 받으므로 눌림의 손짓 안에서 곧바로 부르고 합성은
 * 뒤에서 끝낸다 — 합성이 길어져도 `사용자가 눌렀다` 는 허락이 만료되지 않는다. 안 되는 곳이면 false.
 */
export async function copyPhoto(blob: Promise<Blob>): Promise<boolean> {
  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}
