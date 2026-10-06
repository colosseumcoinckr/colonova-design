/**
 * 홈의 `이어서 하기`(2026-10-06 홈 개선) — 이 프로젝트에서 사람이 나눈 대화 가운데 가장 최근
 * 몇 개. 홈의 다른 묶음(기다려요 · 진행 중 · 방금 있던 일)에 이미 선 대화는 빼고, 도구가 스스로
 * 연 대화(`연결 준비` · `리뷰 반영` …)는 사이드바와 같은 까닭으로 센다 — 사람의 대화만 이어 할 수 있다.
 *
 * 순수 함수라 React 없이 규칙을 시험한다. `thread-visibility.ts` 의 판정(`SYSTEM_THREAD_TITLES` ·
 * 숨김)은 부르는 쪽이 인자로 건넨다 — 단위 시험이 src 에서 곧장 읽는 순수 모듈은 형제를 부르지 않는다.
 */

/** 줄로 서는 대화 수 — 이어 하기는 한눈에 고르는 자리라 길게 늘이지 않는다. */
export const RESUME_LIMIT = 3;

/** 읽는 데 쓰는 대화 한 건의 모양 — `ThreadSummary` 의 부분이다. */
export interface ResumeThread {
  id: string;
  title: string;
  state: "running" | "awaiting" | "finished" | "idle";
  updatedAt: string;
}

export interface ResumeItem {
  sessionId: string;
  title: string;
  /** `updatedAt` 의 실제 시각(ms) — 줄 끝의 `n분 전` 이 읽는다. */
  at: number;
}

/**
 * 이어 할 대화 — 새것부터 `limit` 개.
 *
 * - `taken`: 홈의 다른 묶음이 이미 보여 주는 대화의 id(같은 대화가 두 번 서지 않게).
 * - `systemTitles`: 도구가 여는 대화의 고정 제목들.
 * - 도는 중 · 답을 기다리는 대화는 그 묶음의 몫이라 여기서 빼고, 시각을 읽을 수 없는 대화는 `n분 전` 을
 *   말할 수 없어 뺀다. `titleOf` 는 사용자가 바꾼 이름을 따른다(사이드바와 같은 이름).
 */
export function resumeItems(
  threads: readonly ResumeThread[],
  taken: ReadonlySet<string>,
  systemTitles: Readonly<Record<string, true>>,
  titleOf: (thread: ResumeThread) => string = (thread) => thread.title,
  limit: number = RESUME_LIMIT,
): ResumeItem[] {
  const items: ResumeItem[] = [];
  for (const thread of threads) {
    if (taken.has(thread.id)) continue;
    if (systemTitles[thread.title]) continue;
    if (thread.state === "running" || thread.state === "awaiting") continue;
    const at = Date.parse(thread.updatedAt);
    if (!Number.isFinite(at)) continue;
    items.push({ sessionId: thread.id, title: titleOf(thread), at });
  }
  // 데몬이 새것부터 내려 주지만 한 번 더 — 같은 때의 대화는 들어온 순서를 지킨다(안정 정렬).
  items.sort((a, b) => b.at - a.at);
  return items.slice(0, limit);
}
