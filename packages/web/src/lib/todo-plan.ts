import type { Block } from "./daemon-client";

/**
 * 할 일 목록의 읽기 — TodoWrite 입력의 방어적 파싱과 "최신 목록 하나" 규칙.
 * 입력창 위 알약(`next/chat/RunPlan.tsx`)이 세는 `k/n` 과 펼친 목록도 여기서 나온다.
 *
 * 순수 함수로 여기 사는 이유는 progress.ts 와 같다: 블록 배열 in · 목록 out,
 * 판정 규칙은 테스트가 박아야 한다.
 */

export interface TodoItem {
  text: string;
  status: "completed" | "in_progress" | "pending";
}

/**
 * the agent.s plan, read defensively out of a TodoWrite input: `content` is the
 * CLI's current shape, `activeForm` and `subject` are shapes other senders
 * used. Something that is not a todo list at all gets no card.
 */
export function readTodoList(input: unknown): TodoItem[] | null {
  const todos = (input as { todos?: unknown } | null)?.todos;
  if (!Array.isArray(todos)) return null;
  return todos.map((entry): TodoItem => {
    const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const text = [item.content, item.activeForm, item.subject].find(
      (value): value is string => typeof value === "string" && value.trim() !== "",
    );
    const status =
      item.status === "completed" || item.status === "in_progress" ? item.status : "pending";
    return { text: text ?? "", status };
  });
}

/**
 * 테이프의 **마지막** 할 일 목록. TodoWrite 는 덮어쓰는 도구다 — 과거의
 * 목록이 이기면 스트립이 끝난 일을 다음 일처럼 읽힌다. 목록을 쓴 적이
 * 없으면 null: 빈 목록 카드를 그릴 이유가 없다.
 */
export function latestTodoItems(blocks: Block[]): TodoItem[] | null {
  let todos: TodoItem[] | null = null;
  for (const block of blocks) {
    if (block.type === "tool" && block.name === "TodoWrite") todos = readTodoList(block.input);
  }
  return todos;
}

/** 이보다 짧은 목록은 단계로 말하지 않는다 — `0/1 단계` 는 `작업 중` 보다 아는 것이 없다. */
export const MIN_TODO_STEPS = 2;

/** 마지막 사용자 말 바로 뒤의 자리 — 이번 턴의 블록은 여기서부터다. 사용자 말이 없으면 0. */
export function turnStart(blocks: Block[]): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index]?.type === "user") return index + 1;
  }
  return 0;
}

/**
 * 지금 도는 턴의 할 일 목록 — AI 가 이 턴에 할 일 목록을 냈을 때만(2026-10-06 UX 점검). 테이프의 마지막 목록은
 * 지난 턴의 것(다 끝난 `5/5`)일 수 있어, 마지막 사용자 말 뒤의 블록만 본다 — 목록을 안 낸 턴에 지난 목록이 서면 거짓이다.
 * 하위 에이전트의 목록은 빼낸다(제 일의 목록이라 `k/n` 이 뒤로 간다). 새 목록이 아직 읽히지 않으면(입력이
 * 덜 온 참) 앞의 목록을 쓴다. 목록이 없거나 짧으면 null: 단계를 지어내지 않는다.
 */
export function currentTodoItems(blocks: Block[]): TodoItem[] | null {
  let items: TodoItem[] | null = null;
  for (let index = turnStart(blocks); index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block?.type !== "tool" || block.agentId !== null || block.name !== "TodoWrite") continue;
    items = readTodoList(block.input) ?? items;
  }
  if (items === null || items.length < MIN_TODO_STEPS) return null;
  return items;
}

/** 목록의 `k/n` — 끝난 일 수와 전체 수. */
export function todoProgress(items: TodoItem[]): { done: number; total: number } {
  return { done: items.filter((item) => item.status === "completed").length, total: items.length };
}

/** 지금 도는 턴의 할 일 진행 `k/n` — 셈의 규칙은 `currentTodoItems` 와 같다. */
export function currentTodoProgress(blocks: Block[]): { done: number; total: number } | null {
  const items = currentTodoItems(blocks);
  return items === null ? null : todoProgress(items);
}
