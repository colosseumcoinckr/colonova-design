import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-motion.test.ts 와 같은 모양).
import {
  CHAT_MIN,
  clampWidth,
  PREVIEW_MIN,
  SIDEBAR_DEFAULT,
  sidebarBounds,
} from "../src/next/lib/shell-metrics.ts";

/** 설정이 정한 절대 한도(`SIDEBAR_WIDTH_BOUNDS`)의 모양 — 이 시험은 값이 아니라 계산을 지킨다. */
const LIMITS = { min: 220, max: 420 };

test("sidebarBounds: 넓은 창에서는 설정이 정한 한도가 그대로 선다", () => {
  assert.deepEqual(sidebarBounds(2560, LIMITS), LIMITS);
  assert.deepEqual(sidebarBounds(1440, LIMITS), LIMITS);
});

test("sidebarBounds: 대화 · 미리보기가 쓸 자리를 먼저 남기고 상한이 내려온다", () => {
  const room = CHAT_MIN + PREVIEW_MIN;
  // 사이드바가 상한을 다 쓰면 두 칸이 최소 폭을 못 지키는 창 — 그만큼 상한이 줄어든다.
  assert.equal(sidebarBounds(room + 380, LIMITS).max, 380);
  assert.equal(sidebarBounds(room + LIMITS.max, LIMITS).max, LIMITS.max);
  assert.equal(sidebarBounds(room + LIMITS.max + 1, LIMITS).max, LIMITS.max);
});

test("sidebarBounds: 아주 좁은 창에서도 아래 한도 밑으로 내려가지 않는다(그 밑은 서랍의 몫)", () => {
  // 넓은 창의 문턱(901px)에서는 남는 자리가 아래 한도 바로 위다 — 거의 늘릴 여지가 없다.
  assert.equal(sidebarBounds(901, LIMITS).max, LIMITS.min + 1);
  assert.equal(sidebarBounds(900, LIMITS).max, LIMITS.min);
  assert.equal(sidebarBounds(0, LIMITS).max, LIMITS.min);
  assert.equal(sidebarBounds(0, LIMITS).min, LIMITS.min);
});

test("clampWidth: 한도 안으로 누르고 정수 픽셀로 다듬는다", () => {
  assert.equal(clampWidth(100, LIMITS), 220);
  assert.equal(clampWidth(999, LIMITS), 420);
  assert.equal(clampWidth(300.4, LIMITS), 300);
  assert.equal(clampWidth(300.6, LIMITS), 301);
});

test("SIDEBAR_DEFAULT: 한도 안이고, 끌어 본 적 없는 CSS 의 기본값(264px)과 같다", () => {
  assert.equal(SIDEBAR_DEFAULT, 264);
  assert.equal(clampWidth(SIDEBAR_DEFAULT, LIMITS), SIDEBAR_DEFAULT);
});
