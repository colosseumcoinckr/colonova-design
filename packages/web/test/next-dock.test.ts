import assert from "node:assert/strict";
import { test } from "node:test";
import { dockOf, refsChipText } from "../src/next/lib/dock.ts";

test("작업 독: 아무 일도 없으면 줄이 서지 않는다", () => {
  const dock = dockOf({ running: false, asks: 0, notices: [], refs: 0 });
  assert.equal(dock.main, null);
  assert.equal(dock.refs, 0);
});

test("작업 독: 도는 중이면 ① 줄이 선다 — 묻는 일과 알림보다 먼저다", () => {
  const dock = dockOf({
    running: true,
    asks: 1,
    notices: ["대화가 길어졌어요"],
    refs: 2,
  });
  assert.deepEqual(dock.main, { kind: "run" });
  // 근거 칩은 도는 중에도 남는다(S4).
  assert.equal(dock.refs, 2);
});

test("작업 독: 묻는 일은 알림보다 먼저다(② ③)", () => {
  const dock = dockOf({ running: false, asks: 2, notices: ["힌트"], refs: 0 });
  assert.deepEqual(dock.main, { kind: "ask", count: 2 });
});

test("작업 독: 알림이 둘 이상이면 첫 줄만 선다 — 한 번에 한 줄이다", () => {
  const dock = dockOf({
    running: false,
    asks: 0,
    notices: ["대화 내용을 고쳐 보내요", "대화가 길어졌어요"],
    refs: 0,
  });
  assert.deepEqual(dock.main, { kind: "notice", text: "대화 내용을 고쳐 보내요" });
});

test("작업 독: 빈 알림 줄은 건너뛴다", () => {
  const dock = dockOf({ running: false, asks: 0, notices: ["", "  ", "길어졌어요"], refs: 0 });
  assert.deepEqual(dock.main, { kind: "notice", text: "길어졌어요" });
});

test("작업 독: 근거만 있으면 줄 없이 칩만 산다", () => {
  const dock = dockOf({ running: false, asks: 0, notices: [], refs: 1 });
  assert.equal(dock.main, null);
  assert.equal(dock.refs, 1);
});

test("작업 독: 근거 칩의 표기 — 있을 때만 문장이 난다", () => {
  assert.equal(
    refsChipText(0, (n) => `기획서 ${n}`),
    "",
  );
  assert.equal(
    refsChipText(3, (n) => `기획서 ${n}`),
    "기획서 3",
  );
});
