import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import type * as activity from "../src/components/transcript/activity.tsx";
import type * as todo from "../src/components/transcript/todo.tsx";
import type { Block } from "../src/lib/daemon-client.ts";

let vite: ViteDevServer;
let ActivitySummary: typeof activity.ActivitySummary;
let TodoCard: typeof todo.TodoCard;
let TodoList: typeof todo.TodoList;

before(async () => {
  vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, ws: false, watch: null },
    appType: "custom",
  });
  ({ ActivitySummary } = await vite.ssrLoadModule("/src/components/transcript/activity.tsx"));
  ({ TodoCard, TodoList } = await vite.ssrLoadModule("/src/components/transcript/todo.tsx"));
});
after(async () => {
  await vite?.close();
});

function tool(over: Partial<Extract<Block, { type: "tool" }>>): Extract<Block, { type: "tool" }> {
  return {
    type: "tool",
    id: over.id ?? "t1",
    name: over.name ?? "Read",
    input: over.input ?? {},
    agentId: over.agentId ?? null,
    done: over.done ?? true,
    ...over,
  };
}

// U-037 — 실패한 도구가 섞인 런은 «화면을 고쳤어요» 가 아니라 부분 실패로 말한다.
test("작업 과정 머리: 실패 도구가 있으면 부분 실패 문장과 표식이 선다", () => {
  const html = renderToStaticMarkup(
    createElement(ActivitySummary, {
      steps: [
        tool({ id: "w", name: "Write", input: { file_path: "a.tsx" }, done: true }),
        tool({
          id: "b",
          name: "Bash",
          input: { command: "check" },
          done: true,
          isError: true,
          result: "failed",
        }),
      ],
      controls: {},
    }),
  );
  assert.match(html, /일부 작업을 처리하지 못했어요/);
  assert.match(html, /실패 있음/);
  assert.doesNotMatch(html, /화면을 고쳤어요/);
});

// U-037 — 실패가 없으면 기존처럼 한 일의 무게를 말한다.
test("작업 과정 머리: 파일 도구만 성공하면 고쳤다고 말한다", () => {
  const html = renderToStaticMarkup(
    createElement(ActivitySummary, {
      steps: [tool({ name: "Write", input: { file_path: "a.tsx" }, done: true })],
      controls: {},
    }),
  );
  assert.match(html, /화면을 고쳤어요/);
  assert.doesNotMatch(html, /실패/);
});

// U-038 — 남은 할 일이 있는 끝난 턴은 «모두 끝» 이 아니라 완료 수/전체 수를 말한다.
test("할 일 카드: 미완료가 남으면 완료 수와 남은 수를 말한다", () => {
  const block = tool({
    name: "TodoWrite",
    input: {
      todos: [
        { content: "첫째", status: "completed" },
        { content: "둘째", status: "completed" },
        { content: "셋째", status: "in_progress" },
        { content: "넷째", status: "pending" },
      ],
    },
    done: true,
  });
  const html = renderToStaticMarkup(createElement(TodoCard, { block }));
  assert.match(html, /할 일 2\/4 · 2개 남아요/);
  assert.doesNotMatch(html, /마쳤어요/);
});

// U-038 — 모두 끝난 목록만 완결 문장을 쓴다.
test("할 일 카드: 모두 끝나면 완결 문장이다", () => {
  const block = tool({
    name: "TodoWrite",
    input: { todos: [{ content: "첫째", status: "completed" }] },
    done: true,
  });
  const html = renderToStaticMarkup(createElement(TodoCard, { block }));
  assert.match(html, /할 일 1개를 마쳤어요/);
});

// U-039 — ✓ ● ○ 는 장식이고 낭독은 숨긴 상태 문장이 한다.
test("할 일 목록: 각 항목이 낭독용 상태 문장을 품는다", () => {
  const html = renderToStaticMarkup(
    createElement(TodoList, {
      todos: [
        { text: "첫째", status: "completed" },
        { text: "둘째", status: "in_progress" },
        { text: "셋째", status: "pending" },
      ],
    }),
  );
  for (const word of ["끝남", "하는 중", "남음"]) assert.match(html, new RegExp(word));
  // 표식은 aria-hidden 이라 낭독에서 사라지고 문장만 남는다.
  assert.match(html, /aria-hidden/);
});
