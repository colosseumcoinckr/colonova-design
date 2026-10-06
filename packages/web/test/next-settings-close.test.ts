import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-shortcut-sheet.test.ts 와 같은 모양).
import { closeGuard, nameEscape, pageDirection } from "../src/next/lib/settings-shell.ts";

test("closeGuard: 이름 칸이 깨끗하면 곧바로 닫는다", () => {
  assert.equal(closeGuard({ dirty: false, saving: false, warned: false }), "close");
  assert.equal(closeGuard({ dirty: false, saving: false, warned: true }), "close");
});

test("closeGuard: 저장하지 않은 글이 있으면 먼저 저장한다 — 닫은 뒤의 실패는 말할 곳이 없다", () => {
  assert.equal(closeGuard({ dirty: true, saving: false, warned: false }), "save");
});

test("closeGuard: 저장이 도는 중이면 끝나길 기다린다", () => {
  assert.equal(closeGuard({ dirty: true, saving: true, warned: false }), "wait");
  assert.equal(closeGuard({ dirty: false, saving: true, warned: false }), "wait");
});

test("closeGuard: 실패를 열어 둔 채 말해 준 뒤의 닫기는 그대로 닫는다 — 사용자를 가두지 않는다", () => {
  assert.equal(closeGuard({ dirty: true, saving: false, warned: true }), "close");
});

test("nameEscape: 바뀐 글이 있으면 첫 Esc 는 되돌리고, 깨끗하면 닫는다", () => {
  assert.equal(nameEscape(true), "revert");
  assert.equal(nameEscape(false), "close");
});

test("pageDirection: 목록의 아래 쪽으로 가면 down, 위 쪽으로 가면 up", () => {
  const order = ["ai", "theme", "notify", "connection", "update", "developer"] as const;
  assert.equal(pageDirection(order, "ai", "notify"), "down");
  assert.equal(pageDirection(order, "update", "theme"), "up");
  assert.equal(pageDirection(order, "ai", "developer"), "down");
  assert.equal(pageDirection(order, "developer", "ai"), "up");
});

test("pageDirection: 같은 쪽 · 모르는 쪽은 움직이지 않는다", () => {
  const order = ["a", "b"] as const;
  assert.equal(pageDirection(order, "a", "a"), "none");
  assert.equal(pageDirection(order as readonly string[], "a", "z"), "none");
  assert.equal(pageDirection(order as readonly string[], "z", "a"), "none");
});
