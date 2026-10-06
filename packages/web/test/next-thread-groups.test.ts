import assert from "node:assert/strict";
import { test } from "node:test";
import type { ThreadSummary } from "@colonova-design/protocol";
// 순수 모듈 — src 에서 곧장 읽는다(next-motion.test.ts 와 같은 모양).
import { bucketOf, groupThreadsByDay, startOfDay } from "../src/next/lib/thread-groups.ts";

/** 지역 시간 2026-10-06 15:30 — 달력의 날 단위로 셈하므로 시험이 어느 시간대에서 돌아도 같다. */
const NOW = new Date(2026, 9, 6, 15, 30).getTime();
const at = (daysBack: number, hour: number) =>
  new Date(2026, 9, 6 - daysBack, hour, 0).toISOString();

const thread = (id: string, updatedAt: string): ThreadSummary => ({
  id,
  title: id,
  state: "idle",
  updatedAt,
});

test("bucketOf: 자정이 오늘의 시작이고 어제의 끝이다", () => {
  assert.equal(bucketOf(new Date(2026, 9, 6, 0, 0).getTime(), NOW), "today");
  assert.equal(bucketOf(new Date(2026, 9, 5, 23, 59).getTime(), NOW), "yesterday");
  assert.equal(bucketOf(new Date(2026, 9, 5, 0, 0).getTime(), NOW), "yesterday");
  assert.equal(bucketOf(new Date(2026, 9, 4, 23, 59).getTime(), NOW), "week");
});

test("bucketOf: 지난 7일은 일곱 날 앞의 자정까지, 그 너머는 이전이다", () => {
  assert.equal(bucketOf(new Date(2026, 9, 6 - 6, 0, 0).getTime(), NOW), "week");
  assert.equal(bucketOf(new Date(2026, 9, 6 - 7, 0, 0).getTime(), NOW), "week");
  assert.equal(bucketOf(new Date(2026, 9, 6 - 7, 0, 0).getTime() - 1, NOW), "older");
});

test("bucketOf: 미래의 시각(시계 어긋남)은 오늘이고 읽을 수 없는 시각은 이전이다", () => {
  assert.equal(bucketOf(NOW + 3 * 60 * 60 * 1000, NOW), "today");
  assert.equal(bucketOf(Number.NaN, NOW), "older");
});

test("startOfDay: 달력의 날로 셈한다 — 월 · 해를 넘어도 맞다", () => {
  assert.equal(startOfDay(NOW), new Date(2026, 9, 6).getTime());
  assert.equal(startOfDay(NOW, -6), new Date(2026, 8, 30).getTime());
  assert.equal(
    startOfDay(new Date(2026, 0, 1, 12).getTime(), -1),
    new Date(2025, 11, 31).getTime(),
  );
});

test("groupThreadsByDay: 새것부터 같은 날을 한 묶음으로 끊는다", () => {
  const groups = groupThreadsByDay(
    [
      thread("a", at(0, 14)),
      thread("b", at(0, 9)),
      thread("c", at(1, 18)),
      thread("d", at(3, 10)),
      thread("e", at(30, 10)),
      thread("f", at(90, 10)),
    ],
    NOW,
  );
  assert.deepEqual(
    groups.map((group) => [group.bucket, group.threads.map((entry) => entry.id)]),
    [
      ["today", ["a", "b"]],
      ["yesterday", ["c"]],
      ["week", ["d"]],
      ["older", ["e", "f"]],
    ],
  );
});

test("groupThreadsByDay: 순서가 어긋난 입력도 묶음마다 한 번만 선다", () => {
  const groups = groupThreadsByDay(
    [
      thread("old", at(40, 9)),
      thread("new", at(0, 9)),
      thread("mid", at(1, 9)),
      thread("new2", at(0, 12)),
    ],
    NOW,
  );
  assert.deepEqual(
    groups.map((group) => group.bucket),
    ["today", "yesterday", "older"],
  );
  assert.deepEqual(
    groups[0]?.threads.map((entry) => entry.id),
    ["new2", "new"],
  );
});

test("groupThreadsByDay: 같은 때의 대화는 들어온 순서를 지킨다", () => {
  const same = at(0, 10);
  const groups = groupThreadsByDay([thread("x", same), thread("y", same), thread("z", same)], NOW);
  assert.deepEqual(
    groups[0]?.threads.map((entry) => entry.id),
    ["x", "y", "z"],
  );
});

test("groupThreadsByDay: 읽을 수 없는 시각은 가장 오래된 묶음 끝에 선다", () => {
  const groups = groupThreadsByDay([thread("bad", "not a date"), thread("ok", at(0, 8))], NOW);
  assert.deepEqual(
    groups.map((group) => [group.bucket, group.threads.map((entry) => entry.id)]),
    [
      ["today", ["ok"]],
      ["older", ["bad"]],
    ],
  );
});

test("groupThreadsByDay: 빈 목록은 묶음이 없다", () => {
  assert.deepEqual(groupThreadsByDay([], NOW), []);
});
