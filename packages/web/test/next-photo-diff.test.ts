import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-compare-zoom.test.ts 와 같은 모양).
import {
  type Box,
  DIFF_DEFAULTS,
  diffRegions,
  outsideRegions,
  type RgbaImage,
  summarizeDiff,
  WIDE_RATIO,
} from "../src/next/lib/photo-diff.ts";

type Rgb = [number, number, number];
const WHITE: Rgb = [255, 255, 255];

/** 흰 종이 한 장. */
function paper(width: number, height: number, rgb: Rgb = WHITE): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

/** 사각형을 칠한다 — 사진을 직접 고친다. */
function paint(image: RgbaImage, x: number, y: number, w: number, h: number, rgb: Rgb): RgbaImage {
  for (let row = y; row < y + h; row += 1) {
    for (let col = x; col < x + w; col += 1) {
      const i = (row * image.width + col) * 4;
      image.data[i] = rgb[0];
      image.data[i + 1] = rgb[1];
      image.data[i + 2] = rgb[2];
    }
  }
  return image;
}

const clone = (image: RgbaImage): RgbaImage => ({ ...image, data: image.data.slice() });

/** 정해진 씨앗의 난수 — 시험이 흔들리지 않게(mulberry32). */
function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 모든 채널에 ±amp 의 잡음. */
function noisy(image: RgbaImage, amp: number, seed: number): RgbaImage {
  const next = rng(seed);
  const out = clone(image);
  for (let i = 0; i < out.width * out.height; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      const value = out.data[i * 4 + c] ?? 0;
      out.data[i * 4 + c] = value + Math.round((next() * 2 - 1) * amp);
    }
  }
  return out;
}

/** 두 상자가 허용 오차 안에서 같은가. */
function near(actual: Box | undefined, expected: Box, tol = 0.012): void {
  assert.ok(actual, "상자가 있다");
  for (const key of ["x", "y", "w", "h"] as const) {
    assert.ok(
      Math.abs(actual[key] - expected[key]) <= tol,
      `${key}: ${actual[key]} ≠ ${expected[key]} (±${tol})`,
    );
  }
}

/** 화면 한 장처럼 — 머리띠 · 몇 줄 · 푸터가 있는 960×600. */
function page(): RgbaImage {
  const image = paper(960, 600, [244, 245, 247]);
  paint(image, 0, 0, 960, 68, WHITE);
  paint(image, 36, 22, 220, 24, [31, 36, 48]);
  for (let row = 0; row < 5; row += 1) {
    paint(image, 36, 104 + row * 78, 888, 62, WHITE);
    paint(image, 56, 122 + row * 78, 120 + row * 20, 12, [228, 231, 238]);
  }
  paint(image, 0, 560, 960, 40, [229, 231, 236]);
  return image;
}

const BUTTON = { x: 810, y: 18, w: 110, h: 34 };
const BUTTON_BOX: Box = {
  x: BUTTON.x / 960,
  y: BUTTON.y / 600,
  w: BUTTON.w / 960,
  h: BUTTON.h / 600,
};

test("같은 사진 — 윤곽이 없고 달라진 몫도 0 이다", () => {
  const before = page();
  const result = diffRegions(before, clone(before));
  assert.deepEqual(result, { regions: [], changedRatio: 0, comparable: true });
});

test("버튼 하나의 색만 바뀐 사진 — 그 버튼에만 상자 하나가 선다", () => {
  const before = page();
  paint(before, BUTTON.x, BUTTON.y, BUTTON.w, BUTTON.h, [47, 111, 237]);
  const after = clone(before);
  paint(after, BUTTON.x, BUTTON.y, BUTTON.w, BUTTON.h, [22, 163, 74]);
  const result = diffRegions(before, after);
  assert.equal(result.comparable, true);
  assert.equal(result.regions.length, 1);
  near(result.regions[0], BUTTON_BOX);
  assert.ok(result.changedRatio > 0 && result.changedRatio < 0.02, `몫 ${result.changedRatio}`);
});

test("버튼이 커진 사진 — 1~2px 의 키움도 가장자리 띠로 잡힌다", () => {
  const before = page();
  paint(before, BUTTON.x, BUTTON.y, BUTTON.w, BUTTON.h, [47, 111, 237]);
  const after = page();
  paint(after, BUTTON.x - 2, BUTTON.y - 2, BUTTON.w + 4, BUTTON.h + 4, [47, 111, 237]);
  const result = diffRegions(before, after);
  assert.equal(result.regions.length, 1);
  near(result.regions[0], {
    x: (BUTTON.x - 2) / 960,
    y: (BUTTON.y - 2) / 600,
    w: (BUTTON.w + 4) / 960,
    h: (BUTTON.h + 4) / 600,
  });
});

test("흩어진 두 곳 — 상자가 둘이고 위에서 아래 순서다", () => {
  const before = page();
  const after = clone(before);
  paint(after, BUTTON.x, BUTTON.y, BUTTON.w, BUTTON.h, [47, 111, 237]);
  paint(after, 0, 560, 960, 40, [31, 36, 48]);
  const result = diffRegions(before, after);
  assert.equal(result.regions.length, 2);
  near(result.regions[0], BUTTON_BOX);
  near(result.regions[1], { x: 0, y: 560 / 600, w: 1, h: 40 / 600 });
});

test("가까운 두 조각은 하나로 합치고, 먼 조각은 따로 둔다", () => {
  const before = paper(960, 600);
  const close = clone(before);
  paint(close, 100, 100, 60, 30, [20, 20, 20]);
  paint(close, 170, 100, 60, 30, [20, 20, 20]);
  assert.equal(diffRegions(before, close).regions.length, 1, "사이 10px — 한 덩어리");
  const far = clone(before);
  paint(far, 100, 100, 60, 30, [20, 20, 20]);
  paint(far, 400, 100, 60, 30, [20, 20, 20]);
  assert.equal(diffRegions(before, far).regions.length, 2, "사이 240px — 두 덩어리");
});

test("잡음 수준의 변화 — 상자가 서지 않는다", () => {
  const before = page();
  // 채널마다 ±12 → 세 채널 합의 차가 아무리 커도 36 미만이다(임계 48).
  const after = noisy(before, 12, 7);
  const result = diffRegions(before, after);
  assert.deepEqual(result.regions, []);
  assert.equal(result.changedRatio, 0);
  assert.equal(result.comparable, true);
});

test("압축 흔적처럼 가장자리가 한 픽셀 흔들린 사진 — 상자가 서지 않는다", () => {
  const before = page();
  const after = page();
  // 밝기 차가 임계 미만인 옅은 줄 — 안티앨리어싱이 하는 일.
  paint(after, 36, 104, 888, 1, [240, 240, 240]);
  paint(after, 36, 166, 888, 1, [240, 240, 240]);
  assert.deepEqual(diffRegions(before, after).regions, []);
});

test("작은 얼룩(변경 픽셀 몇 개)은 버린다", () => {
  const before = paper(960, 600);
  const after = clone(before);
  paint(after, 300, 300, 3, 1, [0, 0, 0]);
  const result = diffRegions(before, after);
  assert.deepEqual(result.regions, []);
  assert.equal(result.comparable, true);
});

test("임계 경계 — 채널 차의 합이 47 이면 같고 48 이면 다르다", () => {
  const before = paper(960, 600, [200, 200, 200]);
  const same = paint(clone(before), 100, 100, 200, 100, [200 - 16, 200 - 16, 200 - 15]);
  assert.deepEqual(diffRegions(before, same).regions, [], "합 47");
  const differs = paint(clone(before), 100, 100, 200, 100, [200 - 16, 200 - 16, 200 - 16]);
  assert.equal(diffRegions(before, differs).regions.length, 1, "합 48");
  assert.equal(DIFF_DEFAULTS.threshold, 48);
});

test("수정 후가 더 길면 넘치는 아랫부분을 달라진 곳으로 센다", () => {
  const before = page();
  const after = paper(960, 640, [244, 245, 247]);
  after.data.set(before.data);
  const result = diffRegions(before, after);
  assert.equal(result.comparable, true);
  assert.equal(result.regions.length, 1);
  near(result.regions[0], { x: 0, y: 600 / 640, w: 1, h: 40 / 640 });
  assert.ok(result.changedRatio > 0.05, `몫 ${result.changedRatio}`);
});

test("수정 전이 더 길면 그릴 자리가 없어 상자는 없고 몫에만 센다", () => {
  const before = paper(960, 640);
  const after = page();
  paint(before, 0, 0, 960, 600, [244, 245, 247]);
  before.data.set(after.data.subarray(0, 960 * 600 * 4));
  const result = diffRegions(before, after);
  assert.equal(result.comparable, true);
  assert.deepEqual(result.regions, []);
  assert.ok(result.changedRatio > 0.05, `몫 ${result.changedRatio}`);
});

test("크기가 너무 다르면 비교하지 않는다 — 가로 폭이 다르거나 세로가 두 배 이상", () => {
  const base = paper(960, 600);
  const give = { regions: [], changedRatio: 0, comparable: false };
  assert.deepEqual(diffRegions(base, paper(800, 600)), give, "가로가 다르다");
  assert.deepEqual(diffRegions(paper(390, 844), paper(960, 600)), give, "휴대폰 폭 대 PC 폭");
  assert.deepEqual(diffRegions(base, paper(960, 1200)), give, "정확히 두 배");
  assert.deepEqual(diffRegions(paper(960, 1500), base), give, "두 배를 넘는다");
  assert.equal(diffRegions(base, paper(960, 1199)).comparable, true, "두 배 바로 아래");
  assert.equal(diffRegions(base, paper(961, 600)).comparable, true, "가로 1px 는 반올림이다");
});

test("읽을 수 없는 사진은 비교하지 않는다", () => {
  const good = paper(100, 100);
  const give = { regions: [], changedRatio: 0, comparable: false };
  assert.deepEqual(
    diffRegions({ width: 0, height: 0, data: new Uint8ClampedArray(0) }, good),
    give,
  );
  assert.deepEqual(
    diffRegions(good, { width: 100, height: 100, data: new Uint8ClampedArray(8) }),
    give,
  );
  assert.deepEqual(
    diffRegions(good, { width: 1.5, height: 100, data: new Uint8ClampedArray(600) }),
    give,
  );
});

test("전부 바뀐 사진 — 상자 하나가 화면을 덮고 `화면 대부분` 으로 말한다", () => {
  const before = page();
  const after = paper(960, 600, [20, 24, 36]);
  const result = diffRegions(before, after);
  assert.equal(result.comparable, true);
  assert.equal(result.regions.length, 1);
  near(result.regions[0], { x: 0, y: 0, w: 1, h: 1 }, 0.02);
  assert.ok(result.changedRatio > 0.9, `몫 ${result.changedRatio}`);
  assert.deepEqual(summarizeDiff(result), { kind: "wide" });
});

test("상자 수의 상한 — 넘으면 가까운 것부터 합쳐 달라진 곳을 버리지 않는다", () => {
  const before = paper(960, 600);
  const after = clone(before);
  // 30 × 20 칸 가운데 흩어진 서른여섯 곳(서로 70px 이상 떨어져 합쳐지지 않는 간격).
  const spots: Array<[number, number]> = [];
  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      const spot: [number, number] = [40 + col * 150, 40 + row * 90];
      spots.push(spot);
      paint(after, spot[0], spot[1], 40, 30, [20, 20, 20]);
    }
  }
  const result = diffRegions(before, after);
  assert.ok(result.regions.length <= DIFF_DEFAULTS.maxBoxes, `${result.regions.length}개`);
  // 합쳐도 모든 점이 어느 상자엔가 들어 있다.
  for (const [x, y] of spots) {
    const cx = (x + 20) / 960;
    const cy = (y + 15) / 600;
    assert.ok(
      result.regions.some(
        (r) =>
          cx >= r.x - 0.002 &&
          cx <= r.x + r.w + 0.002 &&
          cy >= r.y - 0.002 &&
          cy <= r.y + r.h + 0.002,
      ),
      `(${x}, ${y}) 가 어느 상자에도 없다`,
    );
  }
  assert.equal(diffRegions(before, after, { maxBoxes: 40 }).regions.length, 36, "상한을 풀면 36");
});

test("1200×750 사진도 같은 좌표로 말한다 — 줄여 보되 좌표는 정규화다", () => {
  const before = paper(1200, 750);
  const after = clone(before);
  paint(after, 600, 300, 120, 60, [200, 30, 30]);
  const result = diffRegions(before, after);
  assert.equal(result.regions.length, 1);
  near(result.regions[0], { x: 0.5, y: 0.4, w: 0.1, h: 0.08 }, 0.008);
});

test("알파가 있는 사진은 흰 종이 위에 얹어 비교한다", () => {
  const before = paper(960, 600);
  const after = clone(before);
  for (let i = 0; i < after.width * after.height; i += 1) {
    after.data[i * 4] = 0;
    after.data[i * 4 + 1] = 0;
    after.data[i * 4 + 2] = 0;
    after.data[i * 4 + 3] = 0;
  }
  assert.deepEqual(diffRegions(before, after).regions, [], "투명한 검정 = 흰 종이");
});

test("summarizeDiff — 비교 불가는 말이 없고, 상자 없음 · 곳 수 · 대부분을 가른다", () => {
  assert.equal(summarizeDiff({ regions: [], changedRatio: 0, comparable: false }), null);
  assert.deepEqual(summarizeDiff({ regions: [], changedRatio: 0.001, comparable: true }), {
    kind: "none",
  });
  const two: Box[] = [
    { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
    { x: 0.6, y: 0.6, w: 0.1, h: 0.1 },
  ];
  assert.deepEqual(summarizeDiff({ regions: two, changedRatio: 0.02, comparable: true }), {
    kind: "regions",
    count: 2,
  });
  assert.deepEqual(summarizeDiff({ regions: two, changedRatio: WIDE_RATIO, comparable: true }), {
    kind: "wide",
  });
});

// ── 요청 밖의 변경 판정 ─────────────────────────────────────────────

const PIN: Box = { x: 0.4, y: 0.4, w: 0.1, h: 0.08 };
const NEAR_PIN: Box = { x: 0.41, y: 0.41, w: 0.08, h: 0.05 };
const BESIDE_PIN: Box = { x: 0.52, y: 0.4, w: 0.1, h: 0.08 };
const FAR_BIG: Box = { x: 0.05, y: 0.75, w: 0.9, h: 0.2 };
const FAR_SMALL: Box = { x: 0.9, y: 0.05, w: 0.04, h: 0.04 };

test("outsideRegions — 핀과 겹치거나 곁인 상자는 말하지 않고, 멀리 떨어진 큰 상자만 돌려준다", () => {
  const regions = [NEAR_PIN, BESIDE_PIN, FAR_BIG, FAR_SMALL];
  const flagged = outsideRegions(regions, [PIN]);
  assert.deepEqual(flagged, [FAR_BIG]);
  assert.equal(flagged[0], FAR_BIG, "부른 쪽의 상자 객체 그대로");
});

test("outsideRegions — 핀이 없는 요청(말만)이면 경고하지 않는다", () => {
  assert.deepEqual(outsideRegions([NEAR_PIN, FAR_BIG], []), []);
});

test("outsideRegions — 핀이 가리킨 곳이 달라지지 않았으면 경고하지 않는다(좌표가 어긋났을 수 있다)", () => {
  assert.deepEqual(outsideRegions([FAR_BIG, FAR_SMALL], [PIN]), []);
});

test("outsideRegions — 핀 좌표를 믿을 수 없으면(사진 밖 · 크기 없음 · 숫자 아님) 경고하지 않는다", () => {
  const regions = [NEAR_PIN, FAR_BIG];
  assert.deepEqual(outsideRegions(regions, [{ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }]), [], "사진 밖");
  assert.deepEqual(outsideRegions(regions, [{ x: 0.4, y: 0.4, w: 0, h: 0.1 }]), [], "너비 0");
  assert.deepEqual(outsideRegions(regions, [{ x: Number.NaN, y: 0.4, w: 0.1, h: 0.1 }]), [], "NaN");
  assert.deepEqual(
    outsideRegions(regions, [PIN, { x: -0.5, y: 0, w: 0.1, h: 0.1 }]),
    [],
    "하나라도 이상",
  );
  assert.equal(
    outsideRegions(regions, [PIN, { x: 1.0, y: 0.2, w: 0.01, h: 0.01 }]).length,
    1,
    "반올림 오차는 봐 준다",
  );
});

test("outsideRegions — 여유(margin)와 면적 기준은 옵션으로 조인다", () => {
  // BESIDE_PIN 은 핀에서 0.02 떨어져 있다 — 여유 0 이면 곁이 아니다.
  const regions = [NEAR_PIN, BESIDE_PIN];
  assert.deepEqual(outsideRegions(regions, [PIN], { margin: 0, minArea: 0 }), [BESIDE_PIN]);
  assert.deepEqual(outsideRegions([NEAR_PIN, FAR_SMALL], [PIN], { minArea: 0 }), [FAR_SMALL]);
  assert.deepEqual(outsideRegions([NEAR_PIN, FAR_SMALL], [PIN]), [], "기본 면적 기준 아래");
});

test("outsideRegions — 세로 여유는 사진의 비율로 맞춘다(같은 px 로 곁을 본다)", () => {
  // 16:10 에서 가로 5% 는 세로 8% 와 같은 px 다.
  const below: Box = { x: 0.4, y: 0.4 + 0.08 + 0.07, w: 0.1, h: 0.2 };
  assert.deepEqual(outsideRegions([NEAR_PIN, below], [PIN], { aspect: 0.625 }), [], "곁이다");
  assert.deepEqual(
    outsideRegions([NEAR_PIN, below], [PIN], { aspect: 1 }),
    [below],
    "정사각형이면 7% 는 멀다",
  );
});
