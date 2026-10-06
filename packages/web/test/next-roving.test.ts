import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-shortcut-sheet.test.ts 와 같은 모양).
import { rovingStop, rovingTarget } from "../src/next/lib/roving.ts";

test("rovingTarget: → ↓ 는 뒤로, ← ↑ 는 앞으로 — 네 방향 키가 같은 군을 걷는다", () => {
  assert.equal(rovingTarget("ArrowRight", 1, 4), 2);
  assert.equal(rovingTarget("ArrowDown", 1, 4), 2);
  assert.equal(rovingTarget("ArrowLeft", 2, 4), 1);
  assert.equal(rovingTarget("ArrowUp", 2, 4), 1);
});

test("rovingTarget: 끝에서 넘으면 반대 끝으로 돌아온다", () => {
  assert.equal(rovingTarget("ArrowRight", 3, 4), 0);
  assert.equal(rovingTarget("ArrowDown", 4 - 1, 4), 0);
  assert.equal(rovingTarget("ArrowLeft", 0, 4), 3);
  assert.equal(rovingTarget("ArrowUp", 0, 4), 3);
});

test("rovingTarget: Home · End 는 어느 칸에서든 양 끝으로 간다", () => {
  assert.equal(rovingTarget("Home", 2, 5), 0);
  assert.equal(rovingTarget("End", 2, 5), 4);
  assert.equal(rovingTarget("Home", 0, 5), 0);
  assert.equal(rovingTarget("End", 4, 5), 4);
});

test("rovingTarget: 군이 걷는 키가 아니면 null — 군은 그 키를 가로채지 않는다", () => {
  for (const key of ["Enter", " ", "Tab", "Escape", "a", "PageDown", "constructor", ""]) {
    assert.equal(rovingTarget(key, 1, 4), null, `키 ${JSON.stringify(key)}`);
  }
});

test("rovingTarget: 칸이 하나뿐이면 제자리, 칸이 없거나 수가 이상하면 null", () => {
  assert.equal(rovingTarget("ArrowRight", 0, 1), 0);
  assert.equal(rovingTarget("ArrowUp", 0, 1), 0);
  assert.equal(rovingTarget("ArrowRight", 0, 0), null);
  assert.equal(rovingTarget("Home", 0, -1), null);
  assert.equal(rovingTarget("End", 0, Number.NaN), null);
});

test("rovingTarget: 어느 칸에서도 오지 않은 초점(-1 · 칸 밖)은 → ↓ 가 첫 칸, ← ↑ 가 끝 칸이다", () => {
  assert.equal(rovingTarget("ArrowDown", -1, 3), 0);
  assert.equal(rovingTarget("ArrowRight", 9, 3), 0);
  assert.equal(rovingTarget("ArrowUp", -1, 3), 2);
  assert.equal(rovingTarget("ArrowLeft", 3, 3), 2);
});

test("rovingStop: 손이 옮긴 칸 > 고른 칸 > 첫 칸 순으로 Tab 이 닿는다", () => {
  assert.equal(rovingStop(4, 2, 3), 3);
  assert.equal(rovingStop(4, 2, null), 2);
  assert.equal(rovingStop(4, -1, null), 0);
});

test("rovingStop: 칸이 줄어 손이 옮긴 칸이 사라지면 고른 칸으로 돌아가고, 군이 비면 0", () => {
  assert.equal(rovingStop(2, 1, 3), 1);
  assert.equal(rovingStop(2, 5, null), 0);
  assert.equal(rovingStop(0, 0, null), 0);
  assert.equal(rovingStop(Number.NaN, 1, 1), 0);
});
