/**
 * AI 계정의 요금제 말들(2026-10-07 베타 준비 분석) — `claude auth status` 가 내는 `subscriptionType`.
 *
 * 번들 CLI(@anthropic-ai/claude-agent-sdk 0.3.263 · CLI 2.1.292)의 코드를 읽어 확인한 사실: 이 값은
 * `max` · `pro` · `enterprise` · `team` 넷 가운데 하나이거나 null 이다(조직 종류 → 값 표 `Cpe`, 그 밖의
 * 종류는 null). 따라서 **무료 요금제는 `free` 가 아니라 null 로 나온다고 읽힌다** [추정 — 코드를
 * 읽은 결론이고 실제 무료 계정의 출력은 아직 보지 못했다. 베타에서 확인할 것]. null 은 `알 수
 * 없음` 이라 막을 수 없다(거짓 차단이 거짓 허용보다 나쁘다). 그래서 첫 요청 전에 막는 것은 CLI 가 쓸 수
 * 없는 요금제를 값으로 내기 시작할 때를 위한 장치이고, 지금의 무료 계정은 첫 요청의 계정류 실패
 * (`turn.end.failure: "account"`)가 사다리 없이 곧바로 말한다.
 */

/**
 * Claude Code 를 쓸 수 없다고 알려진 요금제 — 공식 문서(code.claude.com/docs/en/authentication)는
 * Pro · Max · Team · Enterprise 와 Console · 클라우드 공급자만 말하고 무료 요금제는 싣지 않는다.
 * 새 값이 알려지면 이 목록에 한 줄을 더한다.
 */
export const UNUSABLE_PLANS: readonly string[] = ["free"];

/** 이 요금제는 Claude Code 를 쓸 수 없다고 알려져 있는가 — 모르는 값 · null 은 아니다. */
export function isUnusablePlan(plan: string | null | undefined): boolean {
  return typeof plan === "string" && UNUSABLE_PLANS.includes(plan.trim().toLowerCase());
}
