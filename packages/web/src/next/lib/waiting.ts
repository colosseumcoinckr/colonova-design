import { startOfDay } from "./thread-groups.ts";

/**
 * 기다림이 보이게(2026-10-07 UX 점검 3단계) — 개발자 확인을 기다리는 요청이 며칠째인지. 상태 줄의 둘째 점(`개발자 확인을
 * 기다려요 · 2일째`)과 홈의 한 줄이 같은 계산을 쓴다. 달력으로 센다 — 어제 낸 것은 오늘 2일째이고, 자정이 지나면
 * 부르는 쪽(`useToday`)이 `today` 를 갈아 끼워 숫자가 저절로 는다.
 *
 * 순수 함수만 산다 — 단위 시험이 src 에서 곧장 읽는다. 문장은 부르는 쪽(`labels.ts`)의 것이다.
 */

const DAY_MS = 86_400_000;

/**
 * 요청이 열린 때(`since`, ISO)로부터 달력으로 며칠이 지났나 — 오늘 연 것은 0. `today` 는 오늘 자정(ms)이다. 모르거나
 * 읽을 수 없는 시각은 null(말하지 않는다). 시계가 어긋나 미래인 때는 0.
 */
export function daysSince(since: string | null | undefined, today: number): number | null {
  if (!since) return null;
  const at = Date.parse(since);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.round((today - startOfDay(at)) / DAY_MS));
}

/**
 * 개발자의 확인을 기다리는 요청인가 — `open` 뿐이다. 개발자가 변경을 청한 요청(`changes_requested`)은 공이 우리 쪽에 있고
 * (AI 가 반영한다), 끝난 요청(`merged` · `closed`)은 기다릴 것이 없다.
 */
export function waitingForDeveloper(handoff: { state: string } | null | undefined): boolean {
  return handoff?.state === "open";
}

export interface WaitingRow {
  slug: string;
  name: string;
  /** 달력으로 며칠째(0 = 오늘 제출) — 요청이 열린 때를 모르면 null. */
  days: number | null;
}

/**
 * 홈의 한 줄들 — 개발자 확인을 기다리는 요청이 있는 프로젝트. 오래 기다린 것이 먼저이고, 때를 모르는 것은 맨 뒤다.
 * 같은 날은 등록 순서를 지킨다(안정 정렬).
 */
export function waitingRows(
  projects: ReadonlyArray<{
    slug: string;
    name: string;
    handoff: { state: string; since?: string } | null;
  }>,
  today: number,
): WaitingRow[] {
  return projects
    .filter((project) => waitingForDeveloper(project.handoff))
    .map((project) => ({
      slug: project.slug,
      name: project.name,
      days: daysSince(project.handoff?.since, today),
    }))
    .map((row, order) => ({ row, order }))
    .sort((a, b) => {
      const left = a.row.days ?? -1;
      const right = b.row.days ?? -1;
      return right - left || a.order - b.order;
    })
    .map(({ row }) => row);
}
