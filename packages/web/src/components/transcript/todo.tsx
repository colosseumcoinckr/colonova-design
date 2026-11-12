import { useState } from "react";
import { readTodoList, type TodoItem, todoProgress } from "../../lib/todo-plan";
import { L } from "../../next/labels";
import { ToolBlock } from "./blocks";
import type { TodoToolBlock } from "./shared";

export function TodoList({ todos }: { todos: TodoItem[] }) {
  return (
    <ul className="todo__list">
      {todos.map((todo, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: 할 일의 정체성은 목록에서의 위치다 — 상태만 바뀔 뿐 재배치가 없다.
          key={index}
          className={
            todo.status === "in_progress" ? "todo__item todo__item--current" : "todo__item"
          }
        >
          {/* 표식은 장식 — 낭독은 이 문장이 상태를 읽는다(2026-11-12 UI 조사 U-039). */}
          <span className="todo__sign" aria-hidden>
            {todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "●" : "○"}
          </span>
          <span className="nx-sr">
            {todo.status === "completed"
              ? L.chat.plan.done
              : todo.status === "in_progress"
                ? L.chat.plan.doing
                : L.chat.plan.waiting}{" "}
          </span>
          <span className="todo__text">{todo.text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * 끝난 턴의 할 일 한 줄 — "할 일 N개 끝". 도는 턴의 할 일은 이 카드가
 * 그리지 않는다: 입력창 위 알약(`next/chat/RunPlan.tsx`)이 같은 목차를 펼쳐
 * 보이므로, 테이프가 또 그리는 것은 같은 정보의 두 번째 사본이다(라이브 카드는
 * Thread 에서 걸러진다). 펼치면 ✓ ● ○ 목록이 남는다 — 기록은 접힌
 * 한 줄 뒤에 있다. 목록을 쓰지 않은 TodoWrite 는 카드가 아니라 도구 줄로.
 */
export function TodoCard({ block }: { block: TodoToolBlock }) {
  const [open, setOpen] = useState(false);
  const todos = readTodoList(block.input);
  if (!todos || todos.length === 0) return <ToolBlock block={block} />;

  // 2026-11-12 UI 조사 U-038 — 끝난 턴의 카드는 완료 수를 세어 말한다.
  const { done, total } = todoProgress(todos);

  return (
    <div className="machine todo todo--done">
      <button
        type="button"
        className="todo__done"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {/* 2026-11-12 UI 조사 U-038 — 끝난 턴의 카드는 완료 수를 세어 말한다:
            미완료가 남은 답을 «모두 끝» 으로 읽게 하지 않는다. */}
        {done === total ? L.tape.todoDone(total) : L.tape.todoLeft(done, total - done)}
      </button>
      {open && <TodoList todos={todos} />}
    </div>
  );
}
