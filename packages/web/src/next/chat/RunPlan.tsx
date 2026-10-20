import { useRef, useState } from "react";
import type { AgentBrief } from "../../lib/progress";
import { type TodoItem, todoProgress } from "../../lib/todo-plan";
import { L } from "../labels";
import type { RunPlan as Plan } from "../lib/run-plan";
import { Popover } from "../ui/Popover";
import { CheckIcon } from "./icons";

type Mark = "done" | "doing" | "waiting" | "off";

/**
 * 입력창 위 알약(2026-10-20 사용자 요청) — 도는 동안 이번 요청의 `할 일 k/n` 과 `보조 작업 n` 을 세고, 누르면 그 위로
 * 목록이 뜬다. 끝난 일은 체크와 취소선, 하는 일은 채운 점, 남은 일은 빈 동그라미다. 보조 작업은 도는 동안 30초마다
 * 오는 근황 한 줄을 함께 싣는다. 팝은 앱의 다른 팝과 같은 `Popover` 라 바깥을 누르거나 Esc 로 닫히고, 턴이 끝나면
 * 알약째 사라진다 — 끝난 목록은 대화록의 `할 일 N개 끝` 카드로 남는다. `initialOpen` 은 견본(thread-fixture)이 펼친
 * 모양을 보려고 쓴다.
 */
export function RunPlan({ plan, initialOpen = false }: { plan: Plan; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const anchor = useRef<HTMLButtonElement>(null);

  const progress = plan.todos === null ? null : todoProgress(plan.todos);
  const pill = [
    progress && L.chat.plan.todo(progress.done, progress.total),
    plan.agents.length > 0 && L.chat.plan.agents(plan.agents.length),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="nx-anchor nx-plan">
      <button
        ref={anchor}
        type="button"
        className={`nx-plan-pill${open ? " nx-plan-pill--on" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {pill}
      </button>
      {open && (
        <Popover
          anchor={anchor}
          onClose={() => setOpen(false)}
          up
          label={L.chat.plan.title}
          className="nx-plan-pop"
        >
          {plan.todos && (
            <ul className="nx-plan-list">
              {plan.todos.map((item, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 할 일의 정체성은 목록에서의 위치다 — 상태만 바뀔 뿐 재배치가 없다.
                <TodoRow key={index} item={item} />
              ))}
            </ul>
          )}
          {plan.agents.length > 0 && (
            <>
              <div className="nx-plan-head">{L.chat.plan.agentsTitle}</div>
              <ul className="nx-plan-list">
                {plan.agents.map((agent) => (
                  <AgentRow key={agent.id} agent={agent} />
                ))}
              </ul>
            </>
          )}
        </Popover>
      )}
    </div>
  );
}

function Sign({ mark }: { mark: Mark }) {
  return (
    <span className={`nx-plan-sign nx-plan-sign--${mark}`} aria-hidden="true">
      {mark === "done" && <CheckIcon />}
    </span>
  );
}

function TodoRow({ item }: { item: TodoItem }) {
  const mark =
    item.status === "completed" ? "done" : item.status === "in_progress" ? "doing" : "waiting";
  return (
    <li className={`nx-plan-row nx-plan-row--${mark}`}>
      <Sign mark={mark} />
      <span className="nx-plan-text">
        <span className="nx-sr">{L.chat.plan[mark]} </span>
        {item.text}
      </span>
    </li>
  );
}

function AgentRow({ agent }: { agent: AgentBrief }) {
  const mark: Mark =
    agent.status === "running" ? "doing" : agent.status === "completed" ? "done" : "off";
  const ended =
    agent.status === "failed"
      ? L.chat.plan.agentFailed
      : agent.status === "stopped"
        ? L.chat.plan.agentStopped
        : null;
  return (
    <li className={`nx-plan-row nx-plan-row--${mark}`}>
      <Sign mark={mark} />
      <span className="nx-plan-text">
        {ended === null && (
          <span className="nx-sr">{L.chat.plan[mark === "done" ? "done" : "doing"]} </span>
        )}
        {agent.label || L.chat.plan.agentUnnamed}
        {mark === "doing" && agent.summary && <span className="nx-plan-sub">{agent.summary}</span>}
        {ended !== null && <span className="nx-plan-sub">{ended}</span>}
      </span>
    </li>
  );
}
