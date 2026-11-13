import assert from "node:assert/strict";
import { test } from "node:test";
import type { ThreadSummary } from "@colonova-design/protocol";
// 순수 모듈 — src 에서 곧장 읽는다(next-thread-groups.test.ts 와 같은 모양).
import { UnseenDone } from "../src/next/lib/unseen-done.ts";

const thread = (id: string, state: ThreadSummary["state"]): ThreadSummary => ({
  id,
  title: id,
  state,
  updatedAt: "2026-11-12T00:00:00.000Z",
});

test("도는 중 → 끝남 전이를 관찰한 대화만 «끝났어요» 를 단다", () => {
  const done = new UnseenDone();
  done.observe([thread("a", "running"), thread("b", "running")], null);
  assert.equal(done.observe([thread("a", "finished"), thread("b", "running")], null), true);
  assert.deepEqual([...done.marked], ["a"]);
});

test("끝날 때 보고 있던 대화는 표시하지 않는다", () => {
  const done = new UnseenDone();
  done.observe([thread("a", "running")], "a");
  done.observe([thread("a", "finished")], "a");
  assert.equal(done.marked.has("a"), false);
});

test("처음 본 finished 는 표시하지 않는다 — 앱을 다시 켜도 옛 대화가 켜지지 않는다", () => {
  const done = new UnseenDone();
  done.observe([thread("a", "finished"), thread("b", "finished")], null);
  assert.equal(done.marked.size, 0);
});

test("표시된 대화를 열면 지운다", () => {
  const done = new UnseenDone();
  done.observe([thread("a", "running"), thread("b", "running")], null);
  done.observe([thread("a", "finished"), thread("b", "finished")], null);
  assert.equal(done.observe([thread("a", "finished"), thread("b", "finished")], "a"), true);
  assert.equal(done.marked.has("a"), false);
  assert.equal(done.marked.has("b"), true);
});

test("다시 돌기 시작하면 지운다", () => {
  const done = new UnseenDone();
  done.observe([thread("a", "running")], null);
  done.observe([thread("a", "finished")], null);
  assert.equal(done.observe([thread("a", "running")], null), true);
  assert.equal(done.marked.has("a"), false);
});

test("묻는 중 · 멈춤을 거친 끝남은 «끝났어요» 가 아니다 — 직접 전이만 단다", () => {
  const done = new UnseenDone();
  done.observe([thread("a", "running"), thread("b", "running")], null);
  done.observe([thread("a", "awaiting"), thread("b", "idle")], null);
  done.observe([thread("a", "finished"), thread("b", "finished")], null);
  assert.equal(done.marked.size, 0);
});

test("보고 있던 도는 대화에서 다른 곳으로 옮긴 관찰에 끝남이 겹쳐도 표시한다", () => {
  const done = new UnseenDone();
  done.observe([thread("a", "running")], "a");
  // 같은 관찰에서 a 가 끝났고 보고 있는 대화는 b 로 바뀌었다 — 옮기는 사이 끝난 답이다.
  assert.equal(done.observe([thread("a", "finished"), thread("b", "running")], "b"), true);
  assert.equal(done.marked.has("a"), true);
});

test("목록에서 사라진 대화는 표시를 거둔다", () => {
  const done = new UnseenDone();
  done.observe([thread("a", "running")], null);
  done.observe([thread("a", "finished")], null);
  assert.equal(done.marked.has("a"), true);
  done.observe([], null);
  assert.equal(done.marked.has("a"), false);
});
