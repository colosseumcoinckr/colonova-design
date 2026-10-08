import assert from "node:assert/strict";
import { test } from "node:test";
import { isUnusablePlan, UNUSABLE_PLANS } from "@colonova-design/protocol";
// `../dist` 임포트인 이유: onboarding 은 형제를 `.js` 지정자로 부른다 — src 직접 로드는 그것을 못 고친다.
import { planBlockedStep } from "../dist/onboarding.js";

/**
 * 쓸 수 없다고 알려진 요금제의 막힘(2026-10-07 베타 준비 분석). 번들 CLI 의 코드를 읽어 확인한 사실 — 요금제
 * 값은 `max · pro · enterprise · team` 이거나 null 이고, 무료 요금제는 `free` 가 아니라 null 로 나온다고
 * 읽힌다[추정]. 그래서 이 막힘은 CLI 가 쓸 수 없는 요금제를 값으로 내기 시작할 때를 위한 장치이고, 가장
 * 중요한 약속은 **모르는 값(null · 처음 보는 이름)으로 막지 않는다**는 것이다.
 */

test("알려진 쓸 수 없는 요금제는 로그인 고침을 든 막힌 단계다 — 카드가 저절로 로그인을 열지 않게 reason 이 선다", () => {
  const step = planBlockedStep("free");
  assert.ok(step);
  assert.equal(step.id, "claude");
  assert.equal(step.status, "fail");
  assert.equal(step.reason, "plan");
  assert.equal(step.fix?.kind, "login-claude");
  assert.match(step.detail, /요금제/);
  assert.match(step.detail, /다시 로그인/);
});

test("대소문자 · 공백이 달라도 같은 요금제다", () => {
  for (const value of ["Free", " FREE ", "free\n"]) {
    assert.equal(planBlockedStep(value)?.reason, "plan", JSON.stringify(value));
  }
});

test("쓸 수 있는 요금제 · 모르는 값 · null 은 막지 않는다 — 거짓 차단이 거짓 허용보다 나쁘다", () => {
  for (const value of [
    "pro",
    "max",
    "team",
    "enterprise",
    "Max",
    "mystery",
    "claude_free_trial",
    "",
    null,
  ]) {
    assert.equal(planBlockedStep(value), null, String(value));
  }
});

test("쓸 수 없는 요금제의 목록은 한 곳(protocol)에 있다 — 데몬의 게이트와 웹이 같은 말을 읽는다", () => {
  assert.ok(UNUSABLE_PLANS.includes("free"));
  assert.equal(isUnusablePlan("free"), true);
  assert.equal(isUnusablePlan(null), false);
  assert.equal(isUnusablePlan(undefined), false);
  assert.equal(isUnusablePlan("max"), false);
  // 막힌 요금제가 쓸 수 있는 요금제와 겹치지 않는다.
  for (const usable of ["pro", "max", "team", "enterprise"]) {
    assert.equal(UNUSABLE_PLANS.includes(usable), false, usable);
  }
});
