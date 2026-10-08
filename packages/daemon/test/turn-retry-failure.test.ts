import assert from "node:assert/strict";
import { test } from "node:test";
// `../dist` 임포트인 이유: turn-retry 는 이제 형제(budgets)를 `.js` 지정자로
// 부른다 — src 직접 로드는 그 지정을 못 고친다(cycle-reconcile 와 같은 길).
import { BUDGETS } from "../dist/budgets.js";
import {
  classifyFailure,
  classifyRetry,
  isAccountFailure,
  MAX_AUTO_REVIVES,
  RETRY_DELAYS_MS,
} from "../dist/turn-retry.js";

test("사다리는 PLAN L7 의 다섯 계단이다", () => {
  assert.deepEqual(RETRY_DELAYS_MS, [4_000, 16_000, 60_000, 300_000, 900_000]);
  assert.equal(RETRY_DELAYS_MS.length, BUDGETS.turnRetry.attempts);
});

test("classifyRetry 는 계단을 차례로 오른다", () => {
  for (const [attempt, delay] of RETRY_DELAYS_MS.entries()) {
    const decision = classifyRetry({
      attempt,
      resultText: "temporary failure",
      rateLimit: null,
      now: 0,
      delays: RETRY_DELAYS_MS,
    });
    assert.deepEqual(decision, { action: "retry", delayMs: delay });
  }
});

test("로그인 만료 문장은 사다리를 타지 않고 auth 로 멈춘다", () => {
  const sentences = [
    "authentication_error: Invalid API key",
    "invalid api key provided",
    "OAuth token has expired",
    "Please run /login to authenticate",
    "You are not logged in",
    "Request failed with status code 401",
    "HTTP 401 Unauthorized",
  ];
  for (const resultText of sentences) {
    assert.deepEqual(
      classifyRetry({
        attempt: 0,
        resultText,
        rateLimit: null,
        now: 0,
        delays: RETRY_DELAYS_MS,
      }),
      { action: "stop", reason: "auth" },
      resultText,
    );
    assert.equal(classifyFailure(resultText), "auth", resultText);
  }
});

test("한도 기다림은 24시간 상한 안에서만 기다린다", () => {
  const now = 1_000_000_000_000;
  // 상한 안(23시간 뒤 재충전) — 기다린다.
  const within = classifyRetry({
    attempt: 0,
    resultText: "usage limit reached",
    rateLimit: { status: "blocked", resetsAt: now + 23 * 60 * 60_000 },
    now,
    delays: RETRY_DELAYS_MS,
  });
  assert.equal(within.action, "wait");
  // 상한 밖(25시간 뒤) — 기다리는 것이 아니라 잊는다.
  const beyond = classifyRetry({
    attempt: 0,
    resultText: "usage limit reached",
    rateLimit: { status: "blocked", resetsAt: now + 25 * 60 * 60_000 },
    now,
    delays: RETRY_DELAYS_MS,
  });
  assert.deepEqual(beyond, { action: "stop", reason: "limit-no-reset" });
});

test("되살리기 상한은 예산 표(10분 안에 3회)를 따른다", () => {
  assert.equal(MAX_AUTO_REVIVES, 3);
  assert.equal(BUDGETS.revive.max, 3);
  assert.equal(BUDGETS.revive.windowMs, 10 * 60_000);
});

test("classifyFailure — 길이 문제는 length 다", () => {
  assert.equal(classifyFailure("prompt is too long: 250000 tokens > 200000 maximum"), "length");
});

test("classifyFailure — 한도 문장은 limit 다", () => {
  assert.equal(classifyFailure("usage limit reached, try again later"), "limit");
  assert.equal(classifyFailure("rate limit exceeded for this account"), "limit");
});

test("classifyFailure — 스트림 오류는 짧고 근거가 있을 때만 stream 다", () => {
  assert.equal(
    classifyFailure("stream error unavailable: please try the model again later (error id: 1)"),
    "stream",
  );
  // 길고 문맥 있는 정상 답변이 stream error 를 화제로 설명하는 모양 — stream 이 아니다.
  const prose = `The user asked about stream error handling. ${"Here is a long explanation. ".repeat(40)}`;
  assert.equal(classifyFailure(prose), "other");
});

test("classifyFailure — 모르는 문장과 빈 문장은 other 다", () => {
  assert.equal(classifyFailure("something went sideways"), "other");
  assert.equal(classifyFailure(null), "other");
  assert.equal(classifyFailure(""), "other");
});

test("classifyRetry 는 기존 판정을 유지한다 — 상한 소진은 stop 다", () => {
  const decision = classifyRetry({
    attempt: RETRY_DELAYS_MS.length,
    resultText: "temporary failure",
    rateLimit: null,
    now: 0,
    delays: RETRY_DELAYS_MS,
  });
  assert.deepEqual(decision, { action: "stop", reason: "exhausted" });
});

// ── 계정류 (2026-10-07 베타 준비 분석) ────────────────────────────────────────

/**
 * 계정류 정규식의 근거 — 번들 CLI(@anthropic-ai/claude-agent-sdk 0.3.263 · CLI 2.1.292)의 문자열과
 * 공식 오류 문서(code.claude.com/docs/en/errors)에서 읽은 실제 문구다. 뒤의 두 줄은 이전 CLI 판의
 * 문구(필드 보고)와 문서에만 있는 문구.
 */
const ACCOUNT_SENTENCES = [
  "Credit balance is too low",
  "Your account is on hold and can't sign in to Claude Code. View details or appeal: https://claude.ai/restricted",
  "Your account is on hold and can't use Claude Code. View details or appeal: https://claude.ai/restricted",
  "This organization has been disabled",
  "Your ANTHROPIC_API_KEY belongs to a disabled organization · Unset the environment variable to use your subscription instead",
  "Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access",
  "Your organization has disabled API key authentication · Unset ANTHROPIC_API_KEY to use your claude.ai account instead",
  "API Error: 403 OAuth authentication is currently not allowed for this organization",
  "Your account does not have access to Claude. Please login again or contact your administrator.",
  "Claude Opus is not available with the Claude Pro plan. If you have updated your subscription plan recently, run /logout and /login for the plan to take effect.",
  "Auto mode is unavailable for your plan",
  "There's an issue with the selected model (claude-x). It may not exist or you may not have access to it. Run /model to pick a different model.",
  // 이전 CLI 판 · 문서에만 있는 문구
  "Your account does not have access to Claude Code. Please run /login.",
  "Model claude-x is not available. Your organization restricts model selection.",
];

const stopped = (resultText: string | null, extra: { attempt?: number; errorCode?: string } = {}) =>
  classifyRetry({
    attempt: extra.attempt ?? 0,
    resultText,
    rateLimit: null,
    now: 0,
    delays: RETRY_DELAYS_MS,
    errorCode: extra.errorCode ?? null,
  });

test("계정류 문구는 사다리를 타지 않고 곧바로 account 로 멈춘다", () => {
  for (const sentence of ACCOUNT_SENTENCES) {
    assert.deepEqual(stopped(sentence), { action: "stop", reason: "account" }, sentence);
    assert.equal(classifyFailure(sentence), "account", sentence);
  }
});

test("계정류는 사다리의 어느 계단에서도 account 다 — 소진 판정이 계정의 말을 가리지 않는다", () => {
  for (const attempt of [0, 2, RETRY_DELAYS_MS.length, RETRY_DELAYS_MS.length + 3]) {
    assert.deepEqual(
      stopped("Credit balance is too low", { attempt }),
      { action: "stop", reason: "account" },
      `attempt ${attempt}`,
    );
  }
});

test("로그인 문장을 함께 든 계정류는 auth 가 아니라 account 다", () => {
  const text = "Your account does not have access to Claude Code. Please run /login.";
  assert.deepEqual(stopped(text), { action: "stop", reason: "account" });
  // 문장 자체가 로그인 만료인 것은 그대로 auth — 계정류가 로그인 만료를 삼키지 않는다.
  for (const auth of [
    "Not logged in · Please run /login",
    "Login expired · Please run /login",
    "Failed to authenticate. API Error: 401 API key is invalid.",
  ]) {
    assert.deepEqual(stopped(auth), { action: "stop", reason: "auth" }, auth);
    assert.equal(classifyFailure(auth), "auth", auth);
  }
});

test("오류 코드가 있으면 문장보다 먼저 본다 — 계정류 코드는 문장을 몰라도 account 다", () => {
  for (const errorCode of [
    "billing_error",
    "account_on_hold",
    "oauth_org_not_allowed",
    "model_not_found",
  ]) {
    assert.deepEqual(
      stopped("some future wording we have never seen", { errorCode }),
      { action: "stop", reason: "account" },
      errorCode,
    );
    assert.equal(classifyFailure("some future wording", errorCode), "account", errorCode);
  }
  assert.equal(isAccountFailure(null, "billing_error"), true);
});

test("계정류가 아닌 코드와 모르는 코드는 문장으로 읽는다 — 로그인 만료 코드를 계정으로 막지 않는다", () => {
  // authentication_failed 는 계정류 코드가 아니다 — 문장이 로그인 만료면 auth, 아니면 사다리.
  assert.deepEqual(stopped("Invalid API key", { errorCode: "authentication_failed" }), {
    action: "stop",
    reason: "auth",
  });
  assert.equal(stopped("something odd", { errorCode: "authentication_failed" }).action, "retry");
  for (const errorCode of [
    "overloaded",
    "server_error",
    "rate_limit",
    "unknown",
    "brand_new_code",
  ]) {
    assert.equal(stopped("temporary failure", { errorCode }).action, "retry", errorCode);
  }
});

test("일시 오류는 여전히 사다리를 탄다 — 계정류로 막지 않는다", () => {
  const transient = [
    "API Error: 529 Overloaded. The API is at capacity — this is usually temporary.",
    "Request timed out",
    "read ECONNRESET",
    "API Error: 500 Internal server error",
    "stream error unavailable: please try the model again later (error id: 1)",
    "temporary failure",
    "",
  ];
  for (const sentence of transient) {
    assert.equal(stopped(sentence).action, "retry", sentence);
    assert.equal(classifyFailure(sentence) === "account", false, sentence);
  }
  assert.equal(stopped(null).action, "retry");
  assert.equal(isAccountFailure(null), false);
  assert.equal(isAccountFailure(""), false);
});

test("계정류가 한도 상태보다 먼저다 — 막힌 한도 신호가 있어도 account 로 끝난다", () => {
  const decision = classifyRetry({
    attempt: 0,
    resultText: "Credit balance is too low",
    rateLimit: { status: "rejected", resetsAt: null },
    now: 0,
    delays: RETRY_DELAYS_MS,
  });
  assert.deepEqual(decision, { action: "stop", reason: "account" });
});
