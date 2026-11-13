/**
 * 기다림이 보이게(2026-10-07 UX 점검 3단계) — 개발자 확인을 기다리는 요청이 며칠째인지. 상태 줄의 둘째 점(`개발자 확인을
 * 기다려요 · 2일째`)과 여정의 같은 계산이다. 달력으로 센다 — 어제 낸 것은 오늘 2일째이고, 자정이 지나면
 * 부르는 쪽(`useToday`)이 `today` 를 갈아 끼워 숫자가 저절로 는다.
 *
 * 순수 함수만 산다 — 단위 시험이 src 에서 곧장 읽는다. 문장은 부르는 쪽(`labels.ts`)의 것이다.
 * 홈 자리의 줄 묶음(`waitingRows`)은 2026-10-31 홈 걷기로 걷혔다 — 사이드바 `화면` 줄의 배지가 데몬의
 * `pendingCount` 로 그 말을 맡는다.
 */

import { startOfDay } from "./thread-groups.ts";

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
