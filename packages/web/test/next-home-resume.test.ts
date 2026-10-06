import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-motion.test.ts 와 같은 모양).
import { RESUME_LIMIT, type ResumeThread, resumeItems } from "../src/next/lib/home-resume.ts";

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const ago = (min: number) => new Date(NOW - min * MIN).toISOString();

const thread = (
  id: string,
  min: number,
  state: ResumeThread["state"] = "idle",
  title = `대화 ${id}`,
): ResumeThread => ({ id, title, state, updatedAt: ago(min) });

const NONE: ReadonlySet<string> = new Set();
const SYSTEM = { "연결 준비": true, "리뷰 반영": true } as const;

test("resumeItems: 새것부터 세 개까지 선다", () => {
  const items = resumeItems(
    [thread("a", 50), thread("b", 10), thread("c", 90), thread("d", 30), thread("e", 5)],
    NONE,
    SYSTEM,
  );
  assert.equal(RESUME_LIMIT, 3);
  assert.deepEqual(
    items.map((item) => item.sessionId),
    ["e", "b", "d"],
  );
});

test("resumeItems: 시각은 실제 시각(ms)이다", () => {
  const [first] = resumeItems([thread("a", 7)], NONE, SYSTEM);
  assert.equal(first?.at, NOW - 7 * MIN);
});

test("resumeItems: 다른 묶음에 이미 선 대화는 빼고 다음 것이 올라온다", () => {
  const items = resumeItems(
    [thread("a", 1), thread("b", 2), thread("c", 3), thread("d", 4)],
    new Set(["a", "c"]),
    SYSTEM,
  );
  assert.deepEqual(
    items.map((item) => item.sessionId),
    ["b", "d"],
  );
});

test("resumeItems: 도구가 연 대화는 사람의 대화가 아니라 센다", () => {
  const items = resumeItems(
    [thread("t", 1, "idle", "연결 준비"), thread("u", 2, "finished", "리뷰 반영"), thread("a", 3)],
    NONE,
    SYSTEM,
  );
  assert.deepEqual(
    items.map((item) => item.sessionId),
    ["a"],
  );
});

test("resumeItems: 도는 중 · 답을 기다리는 대화는 그 묶음의 몫이다", () => {
  const items = resumeItems(
    [
      thread("r", 1, "running"),
      thread("w", 2, "awaiting"),
      thread("f", 3, "finished"),
      thread("i", 4),
    ],
    NONE,
    SYSTEM,
  );
  assert.deepEqual(
    items.map((item) => item.sessionId),
    ["f", "i"],
  );
});

test("resumeItems: 읽을 수 없는 시각의 대화는 `n분 전` 을 말할 수 없어 뺀다", () => {
  const broken: ResumeThread = { id: "x", title: "깨진 시각", state: "idle", updatedAt: "어제" };
  const items = resumeItems([broken, thread("a", 5)], NONE, SYSTEM);
  assert.deepEqual(
    items.map((item) => item.sessionId),
    ["a"],
  );
});

test("resumeItems: 데몬이 새것부터 주지 않아도 새것부터 서고, 같은 때는 들어온 순서를 지킨다", () => {
  const items = resumeItems(
    [thread("old", 100), thread("p", 10), thread("q", 10), thread("new", 1)],
    NONE,
    SYSTEM,
    undefined,
    4,
  );
  assert.deepEqual(
    items.map((item) => item.sessionId),
    ["new", "p", "q", "old"],
  );
});

test("resumeItems: 사용자가 바꾼 이름을 따른다", () => {
  const [first] = resumeItems([thread("a", 5)], NONE, SYSTEM, (item) => `${item.title} (바꿈)`);
  assert.equal(first?.title, "대화 a (바꿈)");
});

test("resumeItems: 도구 대화의 판정은 바꾼 이름이 아니라 데몬의 제목으로 한다", () => {
  const items = resumeItems(
    [thread("t", 1, "idle", "연결 준비")],
    NONE,
    SYSTEM,
    () => "내가 붙인 이름",
  );
  assert.deepEqual(items, []);
});

test("resumeItems: 대화가 없으면 아무것도 서지 않는다", () => {
  assert.deepEqual(resumeItems([], NONE, SYSTEM), []);
});
