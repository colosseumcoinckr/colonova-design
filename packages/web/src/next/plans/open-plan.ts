// 순수에 가까운 이음 — 시험이 src 에서 곧장 읽도록 확장자를 붙인다(plan-ref-strip.ts 와 같은 모양).
import { PLANS_OPEN_EVENT, type PlanOpenTarget, stashPlanOpen } from "../chat/plan-ref-strip.ts";
import type { ShellNav } from "../slots.ts";

/**
 * 기획서 칸의 한 자리(문서 · 초안 · 새 문서 창)를 열고 오른쪽 칸을 기획서로 세운다 — 화면 대화의 근거 칩과 홈의 기획서
 * 묶음이 같은 길을 쓴다(2026-10-23 기획자 화면 손질 D4).
 *
 * 칸이 마운트돼 있으면(숨어 있어도) 이벤트를 받아 그 자리를 연다. 아직 마운트 전이면(이 세션에서 한 번도 열지 않았다)
 * 이벤트가 취소되지 않으니 요청을 맡겨 두고, 칸이 마운트하며 꺼낸다. 어느 쪽이든 칸을 앞에 세운다 — 받은 칸이 숨은 채로
 * 남으면 누른 손에 아무 일도 없어 보인다(2026-10-23 화면 손질에서 찾은 틈: 받으면 칸을 세우지 않고 돌아갔다).
 */
export function openPlanTarget(target: PlanOpenTarget, nav: Pick<ShellNav, "openPlans">): void {
  const offer = new CustomEvent(PLANS_OPEN_EVENT, { cancelable: true, detail: target });
  if (window.dispatchEvent(offer)) stashPlanOpen(target);
  nav.openPlans();
}
