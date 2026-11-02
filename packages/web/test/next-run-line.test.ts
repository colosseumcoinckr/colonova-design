import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-making.test.ts 와 같은 모양).
import type { Block } from "../src/lib/daemon-client.ts";
import { currentTodoProgress, MIN_TODO_STEPS } from "../src/lib/todo-plan.ts";
import { L } from "../src/next/labels.ts";
import { makingWordOf } from "../src/next/lib/making.ts";

/**
 * 대화 칸의 `작업 중` 줄(2026-10-06 UX 점검) — 도는 도구의 묶음이 말을 고른다. 이 턴의 할 일 `k/n` 은 입력창 위
 * 알약이 센다(2026-10-20 사용자 요청, next-run-plan.test.ts). 목록을 안 낸 턴에 지난 목록이 서거나 하위 에이전트의
 * 목록이 끼면 숫자가 거짓이 된다.
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

test("줄의 말은 상태 줄의 알약과 같은 말이다 — 따로 지은 문장이 없다", () => {
  assert.equal(typeof L.journey.makingRead, "string");
  assert.equal(typeof L.chat.working, "string");
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const column = read("../src/next/chat/ChatColumn.tsx");
const dock = read("../src/next/chat/WorkDock.tsx");
const statusLine = read("../src/next/status/StatusLine.tsx");
const hook = read("../src/next/lib/use-held-phase.ts");
const css = read("../src/next/chat/chat.css");

test("대화 칸은 단계 말을 작업 독에 넘기고, 할 일 · 보조 작업의 목록도 같이 건넨다(S4)", () => {
  assert.match(
    column,
    /useHeldPhase\(clockMounted \? makingPhase\(blocks\) : null, clockMounted\)/,
  );
  assert.match(column, /<WorkDock/);
  assert.match(column, /runWord=\{runWord\}/);
  assert.match(column, /startedAt=\{clockStart\}/);
  // 독의 줄은 도는 동안만 — 끝난 목록은 대화록의 `할 일 N개 끝` 카드가 맡는다.
  assert.match(column, /const runningPlan = clockMounted \? runPlan\(blocks\) : null;/);
  assert.match(column, /plan=\{runningPlan\}/);
  // 독은 입력창 감싸개 안에 선다 — 턴 내내 그 자리다.
  const wrap = column.indexOf('className="nx-cmp-wrap"');
  assert.ok(wrap !== -1 && column.indexOf("<WorkDock", wrap) > wrap);
});

test("작업 독은 낭독 칸이고 단계 말 · 시계를 싣는다", () => {
  assert.match(dock, /role="status"/);
  assert.match(dock, /<Elapsed startedAt=\{startedAt\} \/>/);
  // 줄의 판정은 순수 모듈이 정한다 — 독이 차례를 직접 짓지 않는다.
  assert.match(column, /dockOf\(\{/);
});

test("상태 줄은 진행의 말을 하지 않는다 — 말과 시계는 작업 독의 몫이다(S2)", () => {
  assert.doesNotMatch(statusLine, /makingWordOf|useHeldPhase|RollingWord/);
  // 도는 표시는 점 하나다 — 테두리 빛과 알약이 돌아오지 않는다.
  assert.doesNotMatch(statusLine, /nx-journey--making|nx-project-work--making/);
});

test("유지 훅은 켜지는 렌더에서 지난 말을 비우고, 꺼진 동안은 얼린다", () => {
  assert.match(hook, /if \(on !== wasOn\) \{\s*setWasOn\(on\);\s*if \(on\) setWord\(null\);\s*\}/);
  assert.match(hook, /if \(!on\) return;/);
});

test("작업 독이 좁으면 아래로 감긴다 — 줄을 차지한 옛 부품이 돌아오지 않는다", () => {
  assert.equal(css.indexOf(".nx-m-run {"), -1, "옛 진행 줄의 옷이다");
  assert.equal(css.indexOf(".nx-m-run-todo {"), -1, "할 일 숫자는 줄을 떠났다");
  const runStart = css.indexOf(".nx-dock {");
  assert.match(css.slice(runStart, css.indexOf("}", runStart)), /flex-wrap: wrap;/);
});
