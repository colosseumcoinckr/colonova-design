import type { Block } from "../../lib/daemon-client.ts";
import { type AgentBrief, agentBriefs } from "../../lib/progress.ts";
import { currentTodoItems, type TodoItem, turnStart } from "../../lib/todo-plan.ts";

/**
 * 입력창 위 알약의 내용(2026-10-20 사용자 요청) — 이번 턴의 할 일 목록과 보조 작업. 할 일은
 * `currentTodoItems` 의 규칙(이번 턴 · 본 대화의 목록 · 두 줄 이상)을 그대로 쓰고, 보조 작업은 마지막 사용자 말
 * 뒤에 본 대화가 띄운 것만 센다 — 지난 턴의 보조 작업이 이번 알약에 서면 거짓이다. 둘 다 없으면 null: 알약이
 * 서지 않는다. 마지막 사용자 말 뒤에 이미 턴 끝(`turn`)이 있으면 그 목록은 끝난 턴의 것이다 — 보낸 말이 아직
 * 테이프에 오기 전, 도는 표시가 먼저 켜진 틈에 지난 `5/5` 가 서지 않게 null 이다(대화록의 `endedTodos` 와 같은 표식).
 */
export interface RunPlan {
  todos: TodoItem[] | null;
  agents: AgentBrief[];
}

export function runPlan(blocks: Block[]): RunPlan | null {
  const turn = blocks.slice(turnStart(blocks));
  if (turn.some((block) => block.type === "turn")) return null;
  const todos = currentTodoItems(blocks);
  const spawned = turn.filter((block) => block.type === "tool" && block.agentId === null);
  const agents = agentBriefs(spawned);
  if (todos === null && agents.length === 0) return null;
  return { todos, agents };
}
