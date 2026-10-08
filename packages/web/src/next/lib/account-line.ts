import type { L } from "../labels";

/**
 * 로그인 뒤의 계정 한 줄 — `kim@회사.kr · Max 로 연결됨` (2026-10-07 베타 준비 분석). 앱은 지금까지 로그인
 * 여부(`로그인됨`)만 말해서, 어느 계정으로 이어졌는지(회사 계정인지 개인 계정인지, 유료인지)를 사용자도
 * 진행자도 알 길이 없었다. 데몬은 이미 `claude auth status` 의 `email` · `subscriptionType` · `authMethod` 를
 * 상태에 싣는다 — 이 모듈은 그 값을 화면의 한 줄로 옮긴다.
 *
 * 순수 함수만 산다. 시험이 src 에서 곧장 읽으므로 형제 모듈을 부르지 않고, 문장이 필요하면 부르는 쪽이
 * 문장 묶음(`L`)을 넘긴다. 요금제의 이름(Pro · Max · Team · Enterprise)은 고유 이름이라 여기 있다.
 *
 * 값의 근거: `claude auth status` 의 JSON(번들 CLI 2.1.292 에서 읽음) — `authMethod` 는 `claude.ai` ·
 * `api_key` · `api_key_helper` · `oauth_token` · `third_party` · `none`, `email` · `subscriptionType` 은
 * `claude.ai` 로 로그인했을 때만 있다(`subscriptionType` 은 `max · pro · enterprise · team` 이거나 null).
 */

/** CLI 의 요금제 값 → 화면의 표기. 이 밖의 값은 원문 그대로 보인다. */
const PLAN_NAMES: Readonly<Record<string, string>> = {
  pro: "Pro",
  max: "Max",
  team: "Team",
  enterprise: "Enterprise",
};

/** 요금제 값의 표기 — 알려진 넷은 이름으로, 모르는 값은 원문 그대로, 없으면 null(요금제 부분을 생략한다). */
export function planName(plan: string | null | undefined): string | null {
  if (typeof plan !== "string") return null;
  const raw = plan.trim();
  if (raw === "") return null;
  return PLAN_NAMES[raw.toLowerCase()] ?? raw;
}

/** 한 줄에 싣는 이메일의 상한 — 넘으면 가운데를 줄인다(알약이 길어져 요금제가 잘리지 않게). */
const EMAIL_MAX = 30;

/** 긴 이메일은 앞 14자 · 뒤 14자만 남기고 가운데를 `…` 로 줄인다 — 앞(이름)과 뒤(도메인)가 알아볼 단서다. */
export function shortEmail(email: string): string {
  const chars = [...email];
  if (chars.length <= EMAIL_MAX) return email;
  return `${chars.slice(0, 14).join("")}…${chars.slice(-14).join("")}`;
}

/** 데몬 상태에서 이 한 줄이 읽는 칸들 — 이 밖의 칸은 읽지 않는다. */
export interface AccountFacts {
  loggedIn: boolean;
  authMethod: string | null;
  email: string | null;
  subscriptionType: string | null;
}

/**
 * - `account` — 이메일 · 요금제 가운데 아는 것을 ` · ` 로 이은 `who`(`kim@회사.kr · Max`).
 * - `api-key` — API 키로 이어졌다(요금제도 이메일도 없다).
 * - `connected` — 이어졌지만 더 말할 것이 없다(구독 코드 · 다른 서비스 · 정보 없음).
 */
export type AccountLine =
  | { kind: "account"; who: string }
  | { kind: "api-key" }
  | { kind: "connected" };

/** 로그인이 안 됐으면 null — 부르는 쪽이 자기 문장(`로그인이 필요해요`)을 말한다. */
export function accountLine(facts: AccountFacts): AccountLine | null {
  if (!facts.loggedIn) return null;
  if (facts.authMethod === "api_key" || facts.authMethod === "api_key_helper") {
    return { kind: "api-key" };
  }
  const email = shortEmail(facts.email?.trim() ?? "");
  const who = [email, planName(facts.subscriptionType) ?? ""].filter((part) => part !== "");
  return who.length > 0 ? { kind: "account", who: who.join(" · ") } : { kind: "connected" };
}

/** 한 줄의 말 — 로그인이 안 됐으면 null. 순수 판정의 관례대로 문장 묶음(`L`)을 인자로 받는다. */
export function accountText(
  line: AccountLine | null,
  words: Pick<typeof L, "account">,
): string | null {
  if (line === null) return null;
  if (line.kind === "account") return words.account.connectedAs(line.who);
  return line.kind === "api-key" ? words.account.apiKey : words.account.connected;
}
