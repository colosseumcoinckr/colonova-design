import type { Attention, HandoffStatus } from "@colonova-design/protocol";
import type { L } from "../labels";

/**
 * 이번 작업 팝오버의 자동 검사 줄(2026-10-07 베타 준비 분석) — 제출한 요청의 자동 검사가 어떤지 한 줄로 말한다.
 * 말하는 만큼만 읽은 것이다: 데몬이 검사를 읽지 못한 연결(권한 없음)이나 검사가 없는 레포에서는 `handoff.ci` 가
 * 없고 이 줄도 없다 — 없다는 말이 「통과」 도 「실패」 도 아니다.
 *
 * 문장은 인자로 받는다 — 단위 시험이 src 에서 곧장 읽는 순수 모듈은 형제를 부르지 않는다(journey.ts 와 같은 규칙).
 */
export type CiLineWords = Pick<typeof L, "afterSubmit">;

export interface CiLine {
  /** `fixing` AI 가 고치는 중 · `notified` 개발자에게 알렸다 · `failing` 통과하지 못했고 손이 닿은 곳이 없다. */
  tone: "passing" | "pending" | "fixing" | "notified" | "failing";
  text: string;
}

export function ciLine(
  handoff: HandoffStatus | null | undefined,
  attention: Attention | null | undefined,
  W: CiLineWords,
): CiLine | null {
  if (!handoff || (handoff.state !== "open" && handoff.state !== "changes_requested")) return null;
  const ci = handoff.ci;
  if (!ci) return null;
  const A = W.afterSubmit;
  if (ci.state === "passing") return { tone: "passing", text: A.checkPassing };
  if (ci.state === "pending") return { tone: "pending", text: A.checkPending };
  // 통과하지 못했다 — 누가 맡았는지는 화면의 문제 문장(주의)이 이미 정했다. 같은 말을 따로 짓지 않는다.
  if (attention?.kind === "ai-fixing" && attention.key === "ci") {
    return { tone: "fixing", text: A.checkFixing };
  }
  if (attention?.kind === "developer-notified" && attention.key?.startsWith("ci:")) {
    return { tone: "notified", text: A.checkNotified };
  }
  return { tone: "failing", text: A.checkFailing };
}
