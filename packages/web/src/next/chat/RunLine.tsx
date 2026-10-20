import { Elapsed } from "../status/Elapsed";

/**
 * 대화 칸 맨 아래의 `작업 중` 줄(2026-10-06 UX 점검) — 단계 말 · 흐른 시간. 도는 동안 줄은 늘 그 자리에 서 있고
 * `quiet` 가 보이기만 바꾼다(글이 흐르는 동안 접힌다). 낭독 칸이라 단계 말이 바뀌면 읽히고, 시계는 `role="timer"` 라
 * 초마다 읽히지 않는다. 할 일의 `k/n` 은 입력창 위 알약(`RunPlan.tsx`)으로 옮겼다(2026-10-20 사용자 요청) — 줄은
 * 글이 흐르면 접히지만 알약은 턴 내내 선다.
 */
export function RunLine({
  quiet,
  word,
  startedAt,
}: {
  quiet: boolean;
  /** 지금의 단계 말 — 묶음을 모르면 `작업 중`. */
  word: string;
  /** 데몬의 시계 — 없으면 시간을 말하지 않는다. */
  startedAt: number | null;
}) {
  return (
    <div className={`nx-m-run${quiet ? " nx-m-run--quiet" : ""}`} role="status">
      <i className="nx-spin" aria-hidden="true" />
      <span>{word}</span>
      {startedAt !== null && <Elapsed startedAt={startedAt} />}
    </div>
  );
}
