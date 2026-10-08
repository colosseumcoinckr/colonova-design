import assert from "node:assert/strict";
import { test } from "node:test";
import { L } from "../src/next/labels.ts";
import { accountLine, accountText, planName, shortEmail } from "../src/next/lib/account-line.ts";

/**
 * 로그인 뒤의 계정 한 줄(2026-10-07 베타 준비 분석). `claude auth status` 의 모양은 번들 CLI 에서 읽었다:
 * `authMethod` 는 claude.ai · api_key · api_key_helper · oauth_token · third_party · none, `email` ·
 * `subscriptionType` 은 claude.ai 로그인에만 있고 요금제는 max · pro · enterprise · team 이거나 null.
 */

const facts = (over: Partial<Parameters<typeof accountLine>[0]> = {}) => ({
  loggedIn: true,
  authMethod: "claude.ai",
  email: "kim@회사.kr",
  subscriptionType: "max",
  ...over,
});

test("planName: 알려진 넷은 이름으로, 모르는 값은 원문 그대로, 없으면 null", () => {
  assert.equal(planName("pro"), "Pro");
  assert.equal(planName("max"), "Max");
  assert.equal(planName("team"), "Team");
  assert.equal(planName("enterprise"), "Enterprise");
  assert.equal(planName("MAX"), "Max");
  assert.equal(planName(" team "), "Team");
  assert.equal(planName("claude_future_plan"), "claude_future_plan");
  assert.equal(planName("free"), "free");
  for (const empty of [null, undefined, "", "   "]) assert.equal(planName(empty), null);
});

test("accountLine: 이메일과 요금제가 있으면 둘 다 — 예시 그대로 `kim@회사.kr · Max 로 연결됨`", () => {
  const line = accountLine(facts());
  assert.deepEqual(line, { kind: "account", who: "kim@회사.kr · Max" });
  assert.equal(accountText(line, L), "kim@회사.kr · Max 로 연결됨");
});

test("accountLine: 요금제가 없으면(null) 요금제 부분만 생략한다", () => {
  const line = accountLine(facts({ subscriptionType: null }));
  assert.deepEqual(line, { kind: "account", who: "kim@회사.kr" });
  assert.equal(accountText(line, L), "kim@회사.kr 로 연결됨");
});

test("accountLine: 이메일이 없고 요금제만 있으면 요금제만", () => {
  const line = accountLine(facts({ email: null }));
  assert.equal(accountText(line, L), "Max 로 연결됨");
  assert.equal(accountText(accountLine(facts({ email: "  " })), L), "Max 로 연결됨");
});

test("accountLine: 모르는 요금제 이름은 원문 그대로 보인다", () => {
  const line = accountLine(facts({ subscriptionType: "claude_future_plan" }));
  assert.equal(accountText(line, L), "kim@회사.kr · claude_future_plan 로 연결됨");
});

test("accountLine: API 키 방식은 `API 키로 연결됨` — 요금제도 이메일도 말하지 않는다", () => {
  for (const authMethod of ["api_key", "api_key_helper"]) {
    const line = accountLine(facts({ authMethod, email: null, subscriptionType: null }));
    assert.deepEqual(line, { kind: "api-key" }, authMethod);
    assert.equal(accountText(line, L), "API 키로 연결됨");
  }
});

test("accountLine: 더 말할 것이 없는 연결은 `연결됨`", () => {
  for (const authMethod of ["oauth_token", "third_party", "none", null]) {
    const line = accountLine(facts({ authMethod, email: null, subscriptionType: null }));
    assert.deepEqual(line, { kind: "connected" }, String(authMethod));
    assert.equal(accountText(line, L), "연결됨");
  }
});

test("accountLine: 로그인이 안 됐으면 null — 말은 부르는 쪽의 몫이다", () => {
  const line = accountLine(facts({ loggedIn: false }));
  assert.equal(line, null);
  assert.equal(accountText(line, L), null);
});

test("계정 문장은 사용자 어휘만 쓴다 — 요금제가 필요하다는 말은 네 요금제를 모두 말한다", () => {
  for (const plan of ["Pro", "Max", "Team", "Enterprise"]) {
    assert.ok(L.account.planNeed.includes(plan), plan);
  }
  assert.ok(L.account.planNeed.includes("무료 요금제"));
  assert.ok(L.account.planBlocked.includes("유료 요금제 계정으로 다시 로그인"));
});

test("shortEmail: 길지 않으면 그대로, 길면 앞 14자 · 뒤 14자만 남기고 가운데를 줄인다", () => {
  assert.equal(shortEmail("kim@회사.kr"), "kim@회사.kr");
  const exactly30 = `${"a".repeat(19)}@company.kr`;
  assert.equal(exactly30.length, 30);
  assert.equal(shortEmail(exactly30), exactly30);
  const long = "very.long.name.of.a.person@a-company-with-a-very-long-domain-name.example.co.kr";
  const short = shortEmail(long);
  assert.equal(short, `${long.slice(0, 14)}…${long.slice(-14)}`);
  assert.equal([...short].length, 29);
  // 요금제는 줄어든 이메일 뒤에 그대로 남는다.
  const line = accountLine(facts({ email: long, subscriptionType: "enterprise" }));
  assert.equal(accountText(line, L), `${short} · Enterprise 로 연결됨`);
});
