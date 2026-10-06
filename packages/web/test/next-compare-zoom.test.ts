import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-shortcut-sheet.test.ts 와 같은 모양).
import {
  applySplit,
  clampPan,
  clampSplit,
  clampZoom,
  compareKeyAction,
  defaultCompareMode,
  fitSize,
  HOME_VIEW,
  isPannable,
  isSafeShot,
  panBy,
  panLimits,
  splitFromPointer,
  splitShares,
  stepZoom,
  wheelZoom,
  zoomAt,
  zoomPercent,
} from "../src/next/lib/compare-zoom.ts";

const STAGE = { width: 800, height: 500 };
const PHOTO = { width: 1200, height: 750 };

test("기본 보기: 대화상자가 920px 보다 좁으면 번갈아, 아니면 나란히 — 못 쟀으면 넓은 창으로 본다", () => {
  assert.equal(defaultCompareMode(1052), "side");
  assert.equal(defaultCompareMode(920), "side");
  assert.equal(defaultCompareMode(919), "flip");
  assert.equal(defaultCompareMode(512), "flip");
  assert.equal(defaultCompareMode(0), "side");
  assert.equal(defaultCompareMode(Number.NaN), "side");
});

test("배율: 100% ~ 250% 로 조이고, 이상한 값은 처음 크기", () => {
  assert.equal(clampZoom(0.4), 1);
  assert.equal(clampZoom(9), 2.5);
  assert.equal(clampZoom(1.5), 1.5);
  assert.equal(clampZoom(Number.NaN), 1);
  assert.equal(zoomPercent(1.25), 125);
  assert.equal(zoomPercent(2.5), 250);
});

test("배율 한 칸: 25% 눈금에 맞추고 한계에서 멈춘다", () => {
  assert.equal(stepZoom(1, 1), 1.25);
  assert.equal(stepZoom(1.25, 1), 1.5);
  assert.equal(stepZoom(2.5, 1), 2.5);
  assert.equal(stepZoom(1, -1), 1);
  assert.equal(stepZoom(1.25, -1), 1);
  // 눈금 사이(휠로 맞춘 값)에서는 가까운 눈금으로 걸어간다.
  assert.equal(stepZoom(1.1, 1), 1.25);
  assert.equal(stepZoom(1.1, -1), 1);
  assert.equal(stepZoom(2.4, -1), 2.25);
  assert.equal(stepZoom(2.4, 1), 2.5);
});

test("휠 확대: 위로 모으면 커지고 아래로 벌리면 작아지며, 한계를 넘지 않는다", () => {
  assert.ok(wheelZoom(1.5, -10) > 1.5);
  assert.ok(wheelZoom(1.5, 10) < 1.5);
  assert.equal(wheelZoom(2.5, -100), 2.5);
  assert.equal(wheelZoom(1, 100), 1);
  assert.equal(wheelZoom(1.5, 0), 1.5);
  assert.equal(wheelZoom(1.5, Number.NaN), 1.5);
});

test("칸에 맞추기: 비율을 지키며 통째로 들어오는 크기", () => {
  // 가로가 먼저 닿는다: 800 / 1200 = 0.667 → 800 × 500.
  assert.deepEqual(fitSize(PHOTO, STAGE), { width: 800, height: 500 });
  // 세로가 먼저 닿는다: 칸이 낮을 때.
  const low = fitSize(PHOTO, { width: 800, height: 300 });
  assert.equal(Math.round(low.height), 300);
  assert.equal(Math.round(low.width), 480);
  // 크기를 모르면 0.
  assert.deepEqual(fitSize({ width: 0, height: 0 }, STAGE), { width: 0, height: 0 });
  assert.deepEqual(fitSize(PHOTO, { width: Number.NaN, height: 10 }), { width: 0, height: 0 });
});

test("이동의 한계: 확대해서 칸을 넘친 만큼만 움직이고, 칸 안에 든 쪽은 0", () => {
  const fit = fitSize(PHOTO, STAGE);
  assert.deepEqual(panLimits(fit, 1, STAGE), { x: 0, y: 0 });
  assert.deepEqual(panLimits(fit, 2, STAGE), { x: 400, y: 250 });
  // 칸이 그림보다 가로로 넓으면(세로가 먼저 닿음) 가로는 확대해도 한참 동안 0.
  const tall = fitSize(PHOTO, { width: 1200, height: 300 });
  assert.equal(panLimits(tall, 1.25, { width: 1200, height: 300 }).x, 0);
});

test("이동 조임: 한계를 넘는 값은 가장자리에 붙고, 처음 크기로 돌아오면 0", () => {
  const fit = fitSize(PHOTO, STAGE);
  assert.deepEqual(clampPan({ x: 999, y: -999 }, fit, 2, STAGE), { x: 400, y: -250 });
  assert.deepEqual(clampPan({ x: 120, y: 30 }, fit, 2, STAGE), { x: 120, y: 30 });
  assert.deepEqual(clampPan({ x: 120, y: 30 }, fit, 1, STAGE), { x: 0, y: 0 });
  assert.deepEqual(clampPan({ x: Number.NaN, y: 5 }, fit, 2, STAGE), { x: 0, y: 5 });
});

test("끌어 옮기기: 끈 만큼 따라오고 한계에서 멈춘다 — 사진 둘이 같은 값을 쓰니 같이 움직인다", () => {
  const fit = fitSize(PHOTO, STAGE);
  const start = { zoom: 2, pan: { x: 0, y: 0 } };
  const moved = panBy(start, -60, 25, fit, STAGE);
  assert.deepEqual(moved, { zoom: 2, pan: { x: -60, y: 25 } });
  assert.deepEqual(panBy(moved, -9999, 0, fit, STAGE).pan, { x: -400, y: 25 });
  // 처음 크기에서는 끌어도 갈 데가 없다.
  assert.deepEqual(panBy(HOME_VIEW, 40, 40, fit, STAGE), HOME_VIEW);
});

test("점을 붙든 확대: 포인터 밑의 그림이 제자리에 남는다", () => {
  const fit = fitSize(PHOTO, STAGE);
  // 칸 중심에서 오른쪽 위(200, -100)를 붙들고 1 → 2 배.
  const next = zoomAt(HOME_VIEW, 2, { x: 200, y: -100 }, fit, STAGE);
  assert.equal(next.zoom, 2);
  // 그 점 밑의 그림 좌표(그림 중심 기준, 확대 전 px) = 포인터 - 이동 / 배율. 확대 뒤에도 같아야 한다.
  const under = (view: { zoom: number; pan: { x: number; y: number } }) => ({
    x: (200 - view.pan.x) / view.zoom,
    y: (-100 - view.pan.y) / view.zoom,
  });
  assert.deepEqual(under(next), under(HOME_VIEW));
  // 처음 크기로 돌아오면 이동이 0 이 된다.
  assert.deepEqual(zoomAt(next, 1, { x: 0, y: 0 }, fit, STAGE).pan, { x: 0, y: 0 });
});

test("점을 붙든 확대: 가장자리를 붙들어도 그림이 칸에서 벗겨지지 않는다", () => {
  const fit = fitSize(PHOTO, STAGE);
  const next = zoomAt(HOME_VIEW, 2.5, { x: 400, y: 250 }, fit, STAGE);
  const limit = panLimits(fit, 2.5, STAGE);
  assert.ok(Math.abs(next.pan.x) <= limit.x + 1e-6);
  assert.ok(Math.abs(next.pan.y) <= limit.y + 1e-6);
});

test("끌 데가 있는지: 확대했을 때만", () => {
  assert.equal(isPannable(1), false);
  assert.equal(isPannable(1.25), true);
  assert.equal(isPannable(Number.NaN), false);
});

test("와이프의 선: 0~100 으로 조이고, 포인터 자리에서 비율을 얻는다", () => {
  assert.equal(clampSplit(-5), 0);
  assert.equal(clampSplit(140), 100);
  assert.equal(clampSplit(42.4), 42);
  assert.equal(clampSplit(Number.NaN), 50);
  assert.equal(splitFromPointer(300, 100, 400), 50);
  assert.equal(splitFromPointer(0, 100, 400), 0);
  assert.equal(splitFromPointer(900, 100, 400), 100);
  assert.equal(splitFromPointer(300, 100, 0), 50);
});

test("낭독 몫: 수정 전과 수정 후의 합이 늘 100", () => {
  assert.deepEqual(splitShares(40), { before: 40, after: 60 });
  assert.deepEqual(splitShares(0), { before: 0, after: 100 });
  assert.deepEqual(splitShares(100), { before: 100, after: 0 });
  for (const value of [0, 1, 33, 50, 67, 99, 100]) {
    const { before, after } = splitShares(value);
    assert.equal(before + after, 100);
  }
});

test("선 옮기기: 지금 자리에서 그만큼, 또는 그 자리로 — 끝에서 멈춘다", () => {
  assert.equal(applySplit(50, { by: 2 }), 52);
  assert.equal(applySplit(50, { by: -10 }), 40);
  assert.equal(applySplit(1, { by: -10 }), 0);
  assert.equal(applySplit(99, { by: 10 }), 100);
  assert.equal(applySplit(50, { to: 0 }), 0);
  assert.equal(applySplit(50, { to: 100 }), 100);
});

test("키: + − 0 은 어느 보기에서나 크기를 말한다", () => {
  for (const mode of ["side", "overlay", "flip"] as const) {
    const state = { mode, zoom: 1 };
    assert.deepEqual(compareKeyAction({ key: "+" }, state), { kind: "zoom", direction: 1 });
    assert.deepEqual(compareKeyAction({ key: "=" }, state), { kind: "zoom", direction: 1 });
    assert.deepEqual(compareKeyAction({ key: "-" }, state), { kind: "zoom", direction: -1 });
    assert.deepEqual(compareKeyAction({ key: "0" }, state), { kind: "reset" });
  }
});

test("키: 번갈아에서 ←는 수정 전, →는 수정 후", () => {
  const state = { mode: "flip", zoom: 1 } as const;
  assert.deepEqual(compareKeyAction({ key: "ArrowLeft" }, state), { kind: "side", side: "before" });
  assert.deepEqual(compareKeyAction({ key: "ArrowRight" }, state), { kind: "side", side: "after" });
  // 확대했어도 ← → 는 앞뒤 전환이다(위 아래가 그림을 옮긴다).
  const zoomed = { mode: "flip", zoom: 2 } as const;
  assert.deepEqual(compareKeyAction({ key: "ArrowLeft" }, zoomed), {
    kind: "side",
    side: "before",
  });
  assert.deepEqual(compareKeyAction({ key: "ArrowDown" }, zoomed), { kind: "pan", dx: 0, dy: -48 });
});

test("키: 겹쳐서에서 ← →는 선을 옮기고(Shift 는 크게), Home · End 는 끝으로 보낸다", () => {
  const state = { mode: "overlay", zoom: 1 } as const;
  assert.deepEqual(compareKeyAction({ key: "ArrowLeft" }, state), { kind: "split", by: -2 });
  assert.deepEqual(compareKeyAction({ key: "ArrowRight" }, state), { kind: "split", by: 2 });
  assert.deepEqual(compareKeyAction({ key: "ArrowRight", shiftKey: true }, state), {
    kind: "split",
    by: 10,
  });
  assert.deepEqual(compareKeyAction({ key: "Home" }, state), { kind: "split", to: 0 });
  assert.deepEqual(compareKeyAction({ key: "End" }, state), { kind: "split", to: 100 });
  // 확대하지 않았으면 위 아래는 할 일이 없다.
  assert.equal(compareKeyAction({ key: "ArrowUp" }, state), null);
});

test("키: 나란히에서는 확대했을 때만 화살표가 그림을 옮긴다 — 손가락의 반대로 그림이 간다", () => {
  assert.equal(compareKeyAction({ key: "ArrowLeft" }, { mode: "side", zoom: 1 }), null);
  const zoomed = { mode: "side", zoom: 2 } as const;
  assert.deepEqual(compareKeyAction({ key: "ArrowRight" }, zoomed), {
    kind: "pan",
    dx: -48,
    dy: 0,
  });
  assert.deepEqual(compareKeyAction({ key: "ArrowLeft", shiftKey: true }, zoomed), {
    kind: "pan",
    dx: 144,
    dy: 0,
  });
  assert.deepEqual(compareKeyAction({ key: "ArrowUp" }, zoomed), { kind: "pan", dx: 0, dy: 48 });
});

test("키: 뜻이 없는 키는 건드리지 않는다", () => {
  assert.equal(compareKeyAction({ key: "a" }, { mode: "side", zoom: 1 }), null);
  assert.equal(compareKeyAction({ key: "Home" }, { mode: "flip", zoom: 1 }), null);
  assert.equal(compareKeyAction({ key: "Enter" }, { mode: "overlay", zoom: 2 }), null);
});

test("안전한 사진: 형식이 png · jpeg · webp 이고 4MB 이하일 때만", () => {
  assert.equal(isSafeShot({ mediaType: "image/png", data: "AAAA" }), true);
  assert.equal(isSafeShot({ mediaType: "image/webp", data: "AAAA" }), true);
  assert.equal(isSafeShot({ mediaType: "image/svg+xml", data: "AAAA" }), false);
  assert.equal(isSafeShot({ mediaType: "text/html", data: "AAAA" }), false);
  assert.equal(
    isSafeShot({ mediaType: "image/png", data: "A".repeat(4 * 1024 * 1024 + 1) }),
    false,
  );
  assert.equal(isSafeShot(null), false);
  assert.equal(isSafeShot(undefined), false);
});
