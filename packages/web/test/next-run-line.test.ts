import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-making.test.ts 와 같은 모양).
import type { Block } from "../src/lib/daemon-client.ts";
import { currentTodoProgress, MIN_TODO_STEPS } from "../src/lib/todo-plan.ts";
import { L } from "../src/next/labels.ts";
import { makingWordOf } from "../src/next/lib/making.ts";

/**
 * 대화 칸의 `작업 중` 줄(2026-10-06 UX 점검) — 도는 도구의 묶음이 말을 고르고, AI 가 이 턴에 할 일 목록을 냈을
 * 때만 `k/n 단계` 가 붙는다. 목록을 안 낸 턴에 지난 목록이 서거나 하위 에이전트의 목록이 끼면 숫자가 거짓이 된다.
 */

let seq = 0;
const nextSeq = () => (seq += 1);

const user = (): Block => ({ type: "user", id: `u${nextSeq()}`, text: "말", images: 0 });

type Status = "completed" | "in_progress" | "pending";

/** 할 일 쓰기 — 항목의 글은 시험이 보지 않는다. */
const todoWrite = (statuses: Status[], agentId: string | null = null): Block => ({
  type: "tool",
  id: `t${nextSeq()}`,
  name: "TodoWrite",
  input: { todos: statuses.map((status, index) => ({ content: `일 ${index}`, status })) },
  agentId,
  done: true,
});

const readTool = (): Block => ({
  type: "tool",
  id: `t${nextSeq()}`,
  name: "Read",
  input: null,
  agentId: null,
  done: false,
});

test("currentTodoProgress: 목록을 안 냈으면 null — 단계를 지어내지 않는다", () => {
  assert.equal(currentTodoProgress([]), null);
  assert.equal(currentTodoProgress([user(), readTool()]), null);
});

test("currentTodoProgress: 끝난 것만 센다 — 하는 중 · 기다리는 것은 아직이다", () => {
  const blocks = [user(), todoWrite(["completed", "completed", "in_progress", "pending"])];
  assert.deepEqual(currentTodoProgress(blocks), { done: 2, total: 4 });
  assert.deepEqual(currentTodoProgress([user(), todoWrite(["pending", "pending"])]), {
    done: 0,
    total: 2,
  });
});

test("currentTodoProgress: 이 턴의 마지막 목록이 이긴다 — 할 일이 늘면 분모도 는다", () => {
  const blocks = [
    user(),
    todoWrite(["in_progress", "pending", "pending"]),
    readTool(),
    todoWrite(["completed", "in_progress", "pending", "pending"]),
  ];
  assert.deepEqual(currentTodoProgress(blocks), { done: 1, total: 4 });
});

test("currentTodoProgress: 지난 턴의 목록은 이번 턴에 서지 않는다", () => {
  const blocks = [user(), todoWrite(["completed", "completed", "completed"]), user(), readTool()];
  assert.equal(currentTodoProgress(blocks), null);
  // 이번 턴에 새 목록을 내면 그것이 선다.
  assert.deepEqual(currentTodoProgress([...blocks, todoWrite(["completed", "pending"])]), {
    done: 1,
    total: 2,
  });
});

test("currentTodoProgress: 새 목록이 아직 읽히지 않으면 앞의 목록을 쓴다 — 입력이 덜 온 참", () => {
  const unreadable: Block = { ...todoWrite(["pending", "pending"]), input: null, done: false };
  const blocks = [user(), todoWrite(["completed", "pending", "pending"]), unreadable];
  assert.deepEqual(currentTodoProgress(blocks), { done: 1, total: 3 });
  // 앞의 목록이 없으면 읽을 것이 없다.
  assert.equal(currentTodoProgress([user(), unreadable]), null);
});

test("currentTodoProgress: 하위 에이전트의 목록은 세지 않는다 — 숫자가 뒤로 가지 않게", () => {
  const blocks = [
    user(),
    todoWrite(["completed", "pending", "pending"]),
    todoWrite(["pending", "pending"], "sub-1"),
  ];
  assert.deepEqual(currentTodoProgress(blocks), { done: 1, total: 3 });
  assert.equal(currentTodoProgress([user(), todoWrite(["completed", "pending"], "sub-1")]), null);
});

test("currentTodoProgress: 한 줄짜리 · 빈 목록은 단계가 아니다", () => {
  assert.equal(MIN_TODO_STEPS, 2);
  assert.equal(currentTodoProgress([user(), todoWrite(["pending"])]), null);
  assert.equal(currentTodoProgress([user(), todoWrite([])]), null);
  // 목록을 비우면 앞의 목록도 걷힌다 — AI 가 계획을 접은 것이다.
  assert.equal(
    currentTodoProgress([user(), todoWrite(["pending", "pending"]), todoWrite([])]),
    null,
  );
});

test("currentTodoProgress: 모양이 어긋난 항목은 아직인 것으로 센다 — 끝났다고 지어내지 않는다", () => {
  const odd: Block = {
    ...todoWrite([]),
    input: { todos: [null, "글", { status: "done" }, { content: "일", status: "completed" }] },
  };
  assert.deepEqual(currentTodoProgress([user(), odd]), { done: 1, total: 4 });
});

test("makingWordOf: 묶음마다 말을 고르고, 모르면 대신하는 말을 쓴다", () => {
  const words = { read: "읽는 중", file: "고치는 중", command: "검사 중", fallback: "작업 중" };
  assert.equal(makingWordOf("read", words), "읽는 중");
  assert.equal(makingWordOf("file", words), "고치는 중");
  assert.equal(makingWordOf("command", words), "검사 중");
  assert.equal(makingWordOf(null, words), "작업 중");
});

test("workTodo: 숫자와 `단계` 뿐 — AI 가 쓴 항목의 글은 싣지 않는다", () => {
  assert.equal(L.chat.workTodo(2, 5), "2/5 단계");
  assert.equal(L.chat.workTodo(0, 3), "0/3 단계");
  // 줄의 말은 상태 줄의 알약과 같은 말이다 — 따로 지은 문장이 없다.
  assert.equal(typeof L.journey.makingRead, "string");
  assert.equal(typeof L.chat.working, "string");
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const column = read("../src/next/chat/ChatColumn.tsx");
const runLine = read("../src/next/chat/RunLine.tsx");
const statusLine = read("../src/next/status/StatusLine.tsx");
const hook = read("../src/next/lib/use-held-phase.ts");
const css = read("../src/next/chat/chat.css");

test("대화 칸은 단계 말과 `k/n` 을 줄에 넘기고 항목의 글은 넘기지 않는다", () => {
  assert.match(
    column,
    /useHeldPhase\(clockMounted \? makingPhase\(blocks\) : null, clockMounted\)/,
  );
  assert.match(column, /currentTodoProgress\(blocks\)/);
  assert.match(
    column,
    /<RunLine quiet=\{!showClock\} word=\{runWord\} steps=\{runSteps\} startedAt=\{clockStart\} \/>/,
  );
  assert.doesNotMatch(column, /latestTodoItems|readTodoList/, "목록의 글은 이 칸에 오지 않는다");
});

test("줄은 낭독 칸이고, 단계는 목록이 있을 때만 서며 숫자만 말한다", () => {
  assert.match(runLine, /role="status"/);
  assert.match(runLine, /steps !== null && \(/);
  assert.match(runLine, /L\.chat\.workTodo\(steps\.done, steps\.total\)/);
  assert.match(runLine, /startedAt !== null && <Elapsed startedAt=\{startedAt\} \/>/);
});

test("상태 줄의 알약과 대화 칸의 줄이 같은 유지 규칙과 같은 말 표를 쓴다", () => {
  assert.match(statusLine, /useHeldPhase\(makingPhase, makingState === "on"\)/);
  assert.match(statusLine, /makingWordOf\(heldWord, \{/);
  assert.doesNotMatch(statusLine, /heldPhase\(/, "알약에 옛 유지 코드가 남아 있지 않다");
});

test("유지 훅은 켜지는 렌더에서 지난 말을 비우고, 꺼진 동안은 얼린다", () => {
  assert.match(hook, /if \(on !== wasOn\) \{\s*setWasOn\(on\);\s*if \(on\) setWord\(null\);\s*\}/);
  assert.match(hook, /if \(!on\) return;/);
});

test("할 일 줄은 시계처럼 옅고 폭이 맞으며 줄이 좁으면 아래로 감긴다", () => {
  const start = css.indexOf(".nx-m-run-todo {");
  assert.notEqual(start, -1);
  const body = css.slice(start, css.indexOf("}", start));
  assert.match(body, /font-variant-numeric: tabular-nums;/);
  assert.match(body, /white-space: nowrap;/);
  const runStart = css.indexOf(".nx-m-run {");
  assert.match(css.slice(runStart, css.indexOf("}", runStart)), /flex-wrap: wrap;/);
});
