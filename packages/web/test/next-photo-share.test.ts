import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-compare-zoom.test.ts 와 같은 모양).
import {
  outlineRect,
  type Rect,
  SHARE_GAP,
  SHARE_LABEL,
  SHARE_MAX_HEIGHT,
  SHARE_MAX_WIDTH,
  SHARE_PAD,
  shareLayout,
} from "../src/next/lib/photo-share.ts";

const PHOTO = { width: 1200, height: 750 };

const inside = (inner: Rect, outer: { width: number; height: number }): boolean =>
  inner.x >= 0 &&
  inner.y >= 0 &&
  inner.x + inner.width <= outer.width &&
  inner.y + inner.height <= outer.height;

test("나란히 — 1200 폭 두 장은 한 줄에 서고 폭은 1600 을 넘지 않는다", () => {
  const layout = shareLayout(PHOTO, PHOTO);
  assert.equal(layout.direction, "row");
  assert.ok(layout.width <= SHARE_MAX_WIDTH, `폭 ${layout.width}`);
  assert.ok(layout.scale < 1 && layout.scale >= 0.55, `배율 ${layout.scale}`);
  const { before, after } = layout;
  assert.ok(before);
  // 수정 전이 왼쪽, 수정 후가 오른쪽 — 사이는 간격 한 칸, 같은 높이에서 시작한다.
  assert.equal(before.photo.x, SHARE_PAD);
  assert.equal(after.photo.x, before.photo.x + before.photo.width + SHARE_GAP);
  assert.equal(before.photo.y, after.photo.y);
  assert.equal(before.photo.y, SHARE_PAD + SHARE_LABEL);
  // 이름표 띠는 사진 바로 위에서 사진과 같은 폭이다.
  assert.deepEqual(before.label, {
    x: before.photo.x,
    y: SHARE_PAD,
    width: before.photo.width,
    height: SHARE_LABEL,
  });
  assert.deepEqual(after.label, {
    x: after.photo.x,
    y: SHARE_PAD,
    width: after.photo.width,
    height: SHARE_LABEL,
  });
  // 오른쪽 끝에도 여백이 남고, 모든 것이 캔버스 안에 있다.
  assert.equal(layout.width, after.photo.x + after.photo.width + SHARE_PAD);
  assert.equal(layout.height, SHARE_PAD * 2 + SHARE_LABEL + before.photo.height);
  for (const rect of [before.photo, after.photo, before.label, after.label]) {
    assert.ok(rect && inside(rect, layout));
  }
});

test("작은 사진 한 쌍은 줄이지 않는다 — 배율 1", () => {
  const layout = shareLayout({ width: 600, height: 400 }, { width: 600, height: 400 });
  assert.equal(layout.scale, 1);
  assert.equal(layout.direction, "row");
  assert.equal(layout.before?.photo.width, 600);
  assert.equal(layout.width, SHARE_PAD * 3 + 1200 + SHARE_GAP - SHARE_PAD);
});

test("높이가 다른 두 장 — 위가 맞고 캔버스는 더 큰 쪽을 따른다", () => {
  const layout = shareLayout({ width: 1200, height: 700 }, { width: 1200, height: 800 });
  assert.equal(layout.before?.photo.y, layout.after.photo.y);
  assert.equal(layout.height, SHARE_PAD * 2 + SHARE_LABEL + layout.after.photo.height);
  assert.ok((layout.before?.photo.height ?? 0) < layout.after.photo.height);
});

test("나란히 두면 너무 작아지는 넓은 사진은 위아래로 놓는다", () => {
  const wide = { width: 2400, height: 1500 };
  const layout = shareLayout(wide, wide);
  assert.equal(layout.direction, "column");
  assert.ok(layout.width <= SHARE_MAX_WIDTH, `폭 ${layout.width}`);
  const { before, after } = layout;
  assert.ok(before);
  assert.equal(before.photo.x, SHARE_PAD);
  assert.equal(after.photo.x, SHARE_PAD);
  // 위 사진의 이름표 → 사진 → 간격 → 아래 사진의 이름표 → 사진 차례.
  assert.equal(before.photo.y, SHARE_PAD + SHARE_LABEL);
  assert.equal(after.label?.y, before.photo.y + before.photo.height + SHARE_GAP);
  assert.equal(after.photo.y, (after.label?.y ?? 0) + SHARE_LABEL);
  assert.equal(layout.height, after.photo.y + after.photo.height + SHARE_PAD);
  assert.ok(layout.scale > 0.6, `위아래가 더 크게 보인다 — ${layout.scale}`);
});

test("수정 전이 없으면 이름표 없는 한 장 — 거짓 전·후를 짓지 않는다", () => {
  const layout = shareLayout(null, PHOTO);
  assert.equal(layout.direction, "single");
  assert.equal(layout.before, null);
  assert.equal(layout.after.label, null);
  assert.deepEqual(layout.after.photo, { x: 0, y: 0, width: 1200, height: 750 });
  assert.deepEqual([layout.width, layout.height], [1200, 750]);
  assert.equal(layout.scale, 1);
});

test("한 장이 1600 보다 넓으면 줄인다", () => {
  const layout = shareLayout(null, { width: 3200, height: 2000 });
  assert.equal(layout.width, SHARE_MAX_WIDTH);
  assert.equal(layout.height, 1000);
  assert.equal(layout.scale, 0.5);
});

test("아주 긴 사진은 높이 한도에 맞춰 더 줄인다", () => {
  const tall = { width: 1200, height: 9000 };
  for (const layout of [
    shareLayout(null, tall),
    shareLayout(tall, tall),
    shareLayout({ width: 2400, height: 4000 }, { width: 2400, height: 4000 }),
  ]) {
    assert.ok(layout.height <= SHARE_MAX_HEIGHT, `${layout.direction} 높이 ${layout.height}`);
    assert.ok(layout.width <= SHARE_MAX_WIDTH, `${layout.direction} 폭 ${layout.width}`);
  }
});

test("모든 값은 정수이고 이상한 크기도 1px 이상으로 잡는다", () => {
  const layout = shareLayout({ width: 1201, height: 751 }, { width: 1199, height: 749 });
  const numbers = [
    layout.width,
    layout.height,
    ...[layout.before, layout.after].flatMap((t) =>
      t ? [t.photo.x, t.photo.y, t.photo.width, t.photo.height] : [],
    ),
  ];
  assert.ok(numbers.every(Number.isInteger), JSON.stringify(numbers));
  const degenerate = shareLayout({ width: 0, height: 0 }, { width: -5, height: Number.NaN });
  assert.ok(degenerate.width >= 1 && degenerate.height >= 1);
});

test("outlineRect — 정규화 상자를 사진 위 px 로 옮기고 부풀리되 사진 밖으로 나가지 않는다", () => {
  const photo = { x: 100, y: 50, width: 800, height: 500 };
  assert.deepEqual(outlineRect({ x: 0.5, y: 0.2, w: 0.25, h: 0.1 }, photo), {
    x: 500,
    y: 150,
    width: 200,
    height: 50,
  });
  assert.deepEqual(outlineRect({ x: 0.5, y: 0.2, w: 0.25, h: 0.1 }, photo, 4), {
    x: 496,
    y: 146,
    width: 208,
    height: 58,
  });
  // 가장자리에 붙은 상자는 사진 안으로 잘린다.
  assert.deepEqual(outlineRect({ x: 0, y: 0.9, w: 1, h: 0.1 }, photo, 6), {
    x: 100,
    y: 494,
    width: 800,
    height: 56,
  });
});
