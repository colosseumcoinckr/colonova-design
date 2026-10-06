import { L } from "../labels";
import { Elapsed } from "../status/Elapsed";

/**
 * 대화 칸 맨 아래의 `작업 중` 줄(2026-10-06 UX 점검) — 단계 말 · AI 가 낸 할 일 목록의 `k/n 단계`(있을 때만) · 흐른
 * 시간. 도는 동안 줄은 늘 그 자리에 서 있고 `quiet` 가 보이기만 바꾼다(글이 흐르는 동안 접힌다). 낭독 칸이라 단계
 * 말이 바뀌면 읽히고, 시계는 `role="timer"` 라 초마다 읽히지 않는다.
 */
export function RunLine({
  quiet,
  word,
  steps,
  startedAt,
}: {
  quiet: boolean;
  /** 지금의 단계 말 — 묶음을 모르면 `작업 중`. */
  word: string;
  /** 이 턴의 할 일 진행 — 목록을 안 냈으면 null. 숫자만 받는다(항목의 글은 오지 않는다). */
  steps: { done: number; total: number } | null;
  /** 데몬의 시계 — 없으면 시간을 말하지 않는다. */
  startedAt: number | null;
}) {
  return (
    <div className={`nx-m-run${quiet ? " nx-m-run--quiet" : ""}`} role="status">
      <i className="nx-spin" aria-hidden="true" />
      <span>{word}</span>
      {steps !== null && (
        <span className="nx-m-run-todo">{L.chat.workTodo(steps.done, steps.total)}</span>
      )}
      {startedAt !== null && <Elapsed startedAt={startedAt} />}
    </div>
  );
}
