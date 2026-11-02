import assert from "node:assert/strict";
import { test } from "node:test";
import { nextTabIndex } from "../src/next/lib/tab-keys.ts";

test("탭 걸음: 옆 화살표는 다음 탭으로 — 끝에 닿으면 처음으로 돌아간다", () => {
  assert.equal(nextTabIndex("ArrowRight", 3, 0), 1);
  assert.equal(nextTabIndex("ArrowRight", 3, 1), 2);
  assert.equal(nextTabIndex("ArrowRight", 3, 2), 0);
  assert.equal(nextTabIndex("ArrowDown", 3, 1), 2);
});

test("탭 걸음: 왼쪽 화살표는 앞 탭으로 — 처음에서는 끝으로 간다", () => {
  assert.equal(nextTabIndex("ArrowLeft", 3, 2), 1);
  assert.equal(nextTabIndex("ArrowLeft", 3, 0), 2);
  assert.equal(nextTabIndex("ArrowUp", 3, 1), 0);
});

test("탭 걸음: Home · End 는 양 끝이다 — 빙글 돌지 않는다", () => {
  assert.equal(nextTabIndex("Home", 3, 1), 0);
  assert.equal(nextTabIndex("End", 3, 0), 2);
  assert.equal(nextTabIndex("Home", 3, 0), 0);
  assert.equal(nextTabIndex("End", 3, 2), 2);
});

test("탭 걸음: 다른 키 · 빈 탭은 손을 뗀다", () => {
  assert.equal(nextTabIndex("Enter", 3, 1), null);
  assert.equal(nextTabIndex("ArrowRight", 0, 0), null);
});
