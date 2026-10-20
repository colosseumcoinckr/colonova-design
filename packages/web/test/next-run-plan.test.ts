import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-run-line.test.ts 와 같은 모양).
import type { Block } from "../src/lib/daemon-client.ts";
import { L } from "../src/next/labels.ts";
import { runPlan } from "../src/next/lib/run-plan.ts";

/**
 * 입력창 위 알약(2026-10-20 사용자 요청) — 이번 턴의 할 일 목록과 보조 작업을 세고 누르면 펼친다. 지난 턴의 것이
 * 서거나 보조 작업 안의 목록 · 보조 작업이 끼면 알약이 거짓을 말한다.
 */

let seq = 0;
const nextSeq = () => (seq += 1);

const user = (): Block => ({ type: "user", id: `u${nextSeq()}`, text: "말", images: 0 });

type Status = "completed" | "in_progress" | "pending";

const todoWrite = (statuses: Status[], agentId: string | null = null): Block => ({
  type: "tool",
  id: `t${nextSeq()}`,
  name: "TodoWrite",
  input: { todos: statuses.map((status, index) => ({ content: `일 ${index}`, status })) },
  agentId,
  done: true,
});

const agent = (
  description: string,
  options: { name?: string; done?: boolean; agentId?: string | null; isError?: boolean } = {},
): Block => ({
  type: "tool",
  id: `a${nextSeq()}`,
  name: options.name ?? "Agent",
  input: { description, prompt: "…", subagent_type: "Explore" },
  agentId: options.agentId ?? null,
  done: options.done ?? false,
  isError: options.isError,
});

test("runPlan: 할 일도 보조 작업도 없으면 null — 알약이 서지 않는다", () => {
  assert.equal(runPlan([]), null);
  assert.equal(runPlan([user()]), null);
  // 한 줄짜리 목록은 단계가 아니다.
  assert.equal(runPlan([user(), todoWrite(["pending"])]), null);
});

test("runPlan: 이번 턴의 마지막 목록을 항목째 싣는다", () => {
  const plan = runPlan([
    user(),
    todoWrite(["in_progress", "pending"]),
    todoWrite(["completed", "in_progress", "pending"]),
  ]);
  assert.deepEqual(
    plan?.todos?.map((item) => item.status),
    ["completed", "in_progress", "pending"],
  );
  assert.equal(plan?.todos?.[0]?.text, "일 0");
  assert.deepEqual(plan?.agents, []);
});

test("runPlan: 지난 턴의 목록 · 보조 작업은 이번 알약에 서지 않는다", () => {
  const blocks = [
    user(),
    todoWrite(["completed", "completed"]),
    agent("화면 살펴보기", { done: true }),
  ];
  assert.notEqual(runPlan(blocks), null);
  assert.equal(runPlan([...blocks, user()]), null);
});

test("runPlan: 턴이 끝난 목록은 서지 않는다 — 보낸 말이 테이프에 오기 전의 틈", () => {
  const turnEnd: Block = {
    type: "turn",
    id: `e${nextSeq()}`,
    subtype: "success",
    isError: false,
  } as Block;
  const ended = [user(), todoWrite(["completed", "completed"]), agent("살펴보기", { done: true })];
  // 도는 표시가 먼저 켜지고 새 말은 아직 오지 않았다 — 지난 `2/2` 가 서면 거짓이다.
  assert.equal(runPlan([...ended, turnEnd]), null);
  // 새 말이 오고 이번 턴이 목록을 내면 그것이 선다.
  const next = runPlan([...ended, turnEnd, user(), todoWrite(["in_progress", "pending"])]);
  assert.deepEqual(
    next?.todos?.map((item) => item.status),
    ["in_progress", "pending"],
  );
  assert.deepEqual(next?.agents, []);
});

test("runPlan: 보조 작업은 이 턴에 본 대화가 띄운 것만 — 옛 이름 `Task` 도 같다", () => {
  const plan = runPlan([
    user(),
    agent("목록 화면 살펴보기", { done: true }),
    agent("검색창 자리 찾기", { name: "Task" }),
    // 보조 작업 안에서 띄운 것 · 보조 작업 안의 목록은 본 대화의 것이 아니다.
    agent("안쪽 일", { agentId: "x" }),
    todoWrite(["pending", "pending"], "x"),
  ]);
  assert.equal(plan?.todos, null);
  assert.deepEqual(
    plan?.agents.map((brief) => [brief.label, brief.status]),
    [
      ["목록 화면 살펴보기", "completed"],
      ["검색창 자리 찾기", "running"],
    ],
  );
});

test("runPlan: 실패한 보조 작업은 끝남으로 세지 않는다", () => {
  const plan = runPlan([user(), agent("살펴보기", { done: true, isError: true })]);
  assert.equal(plan?.agents[0]?.status, "failed");
});

test("알약의 말: `할 일 k/n` · `보조 작업 n` 과 표식의 낭독 말", () => {
  assert.equal(L.chat.plan.todo(9, 12), "할 일 9/12");
  assert.equal(L.chat.plan.agents(2), "보조 작업 2");
  for (const word of [L.chat.plan.done, L.chat.plan.doing, L.chat.plan.waiting]) {
    assert.ok(word.length > 0);
  }
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const component = read("../src/next/chat/RunPlan.tsx");
const css = read("../src/next/chat/chat.css");

test("알약은 펼침 단추이고, 목록은 앱의 다른 팝과 같은 `Popover` 로 위에 뜬다", () => {
  assert.match(component, /aria-haspopup="dialog"/);
  assert.match(component, /aria-expanded=\{open\}/);
  // 바깥 누름 · Esc · 초점 되돌림 · 높이 상한은 `Popover` 의 몫이다 — 따로 짜지 않는다.
  assert.match(
    component,
    /<Popover\s+anchor=\{anchor\}\s+onClose=\{\(\) => setOpen\(false\)\}\s+up\s/,
  );
  assert.match(component, /label=\{L\.chat\.plan\.title\}/);
  assert.doesNotMatch(component, /addEventListener/);
  // 표식은 눈으로 읽히고 낭독기에는 말이 대신 읽힌다.
  assert.match(component, /aria-hidden="true"/);
  assert.match(component, /className="nx-sr"/);
});

test("끝난 일은 취소선이고, 알약의 숫자는 폭이 맞는다", () => {
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    assert.notEqual(start, -1, selector);
    return css.slice(start, css.indexOf("}", start));
  };
  assert.match(block(".nx-plan-row--done .nx-plan-text"), /text-decoration: line-through;/);
  assert.match(block(".nx .nx-plan-pill"), /font-variant-numeric: tabular-nums;/);
  // 자리는 `.nx-pop` 이 정한다 — 팝의 칸이 자리를 다시 짜지 않는다.
  assert.doesNotMatch(block(".nx-pop.nx-plan-pop"), /position:|bottom:/);
});
