import type { ThreadSummary } from "@colonova-design/protocol";

/**
 * 대화 목록의 날짜 묶음 — 사이드바가 `오늘 · 어제 · 지난 7일 · 이전` 머리 아래에 줄을 세운다
 * (2026-10-06 사이드바 개선). 기준은 이 컴퓨터의 달력이다: 자정이 지나면 어제가 된다. 순수
 * 함수만 산다 — 단위 시험이 src 에서 곧장 읽는다.
 */
export type DayBucket = "today" | "yesterday" | "week" | "older";

export interface ThreadGroup {
  bucket: DayBucket;
  threads: ThreadSummary[];
}

/**
 * `at` 이 속한 날의 자정(ms) 에서 `offsetDays` 날 앞뒤. 시계가 아니라 달력으로 셈하므로
 * 서머타임이 낀 날에도 어긋나지 않는다.
 */
export function startOfDay(at: number, offsetDays = 0): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays).getTime();
}

/** 이 시각이 `now` 기준 어느 묶음인가 — 미래(시계 어긋남)는 오늘이고, 읽을 수 없으면 가장 오래된 쪽이다. */
export function bucketOf(at: number, now: number): DayBucket {
  if (!Number.isFinite(at)) return "older";
  if (at >= startOfDay(now)) return "today";
  if (at >= startOfDay(now, -1)) return "yesterday";
  if (at >= startOfDay(now, -7)) return "week";
  return "older";
}

/**
 * 대화를 새것부터 날짜 묶음으로 — 데몬이 이미 새것부터 내려 주므로 보통은 순서가 그대로다.
 * 그래도 한 번 더 정렬한다: 같은 묶음이 두 번 서면 머리가 겹쳐 서고 열쇠가 부딪친다. 같은 때의
 * 대화는 들어온 순서를 지킨다(안정 정렬).
 */
export function groupThreadsByDay(threads: readonly ThreadSummary[], now: number): ThreadGroup[] {
  const stamped = threads.map((thread) => {
    const at = Date.parse(thread.updatedAt);
    return { thread, at: Number.isFinite(at) ? at : 0 };
  });
  stamped.sort((a, b) => b.at - a.at);
  const groups: ThreadGroup[] = [];
  for (const { thread, at } of stamped) {
    const bucket = bucketOf(at, now);
    const last = groups[groups.length - 1];
    if (last?.bucket === bucket) last.threads.push(thread);
    else groups.push({ bucket, threads: [thread] });
  }
  return groups;
}
