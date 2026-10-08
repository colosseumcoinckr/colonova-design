/**
 * 턴 자기치유의 판정만 — 언제 같은 말로 스스로 다시 시도할지 (감독 정책).
 *
 * 계약: 이 모듈은 순수하다. 타이머도 세션도 모른다 — 판단에 필요한 것을
 * 받아 판정만 내린다. 세션(session.ts)은 이 판정을 믿고 스스로 재전송하며,
 * 그 규칙이 한 곳에 사는 것이 무한 재시도를 막는 상한의 전부다.
 *
 * 네 갈래 (PLAN L12):
 * - `retry` — 일시적 실패(전송 거절 · 스트림 오류). 같은 말을 백오프로 다시.
 * - `wait`  — 사용량 한도. resetsAt 을 아는 한 그 시각에 맞춰 다시.
 * - `stop`  — 같은 말로는 영영 안 될 이유(로그인 만료 · 프롬프트 Too Long,
 *   한도인데 돌아올 시각을 모름 · 계정 문제). 로그인 만료는 상태가 돌아오면
 *   세션이 한 번 다시 보내고(auth), 나머지만 사람의 손 — 실패 카드가 남는다.
 *
 * 계정류(`account`, 2026-10-07 베타 준비 분석): 요금제 미지원 · 크레딧 부족 · 조직
 * 비활성 · 계정 보류 · 모델 접근 불가 — 시간이 풀어 주지 않는다. 사다리를 타면
 * 쓸 수 없는 계정이 첫 요청 뒤 약 21분(4s+16s+60s+5m+15m)을 기다려서야 실패했다.
 */

import type { TurnFailureStage } from "@colonova-design/protocol";
import { BUDGETS } from "./budgets.js";

/** 백오프 간격 — 재시도마다 하나씩 소비한다. 길이가 곧 상한이다 (PLAN L7). */
export const RETRY_DELAYS_MS: readonly number[] = BUDGETS.turnRetry.delaysMs;

/** 한도 기다림의 상한 — 이보다 먼 재충전은 기다리는 것이 아니라 잊는 것이다. */
const LIMIT_WAIT_MAX_MS = BUDGETS.turnRetry.limitWaitMaxMs;
/** 재충전 직후엔 서버의 시계와 우리의 시계가 어긋난다 — 그만큼 여유. */
const LIMIT_RETRY_GRACE_MS = 3_000;

/** 크래시 자동 재개의 상한 — 같은 대화가 10분 창 안에 스스로 일으키는 횟수. */
export const MAX_AUTO_REVIVES = BUDGETS.revive.max;
/** 죽은 CLI 가 완전히 내려앉을 유예 — 재개가 그 시체와 경합하지 않게. */
export const REVIVE_GRACE_MS = BUDGETS.revive.graceMs;

export interface RetryInput {
  /** 이미 쓴 재시도 수 — 0 이면 첫 재시도를 묻는 중. */
  attempt: number;
  /** 실패한 턴의 결과 문장 (resultText). 없는 실패도 있다. */
  resultText: string | null;
  /** 이 세션이 마지막으로 본 한도 상태 — 턴 직전의 ratelimit 이벤트. */
  rateLimit: { status: string; resetsAt: number | null } | null;
  /** 판정의 기준 시각 (epoch ms). */
  now: number;
  /** 백오프 간격 — 테스트가 짧은 값을 넣는 길. 생략하면 RETRY_DELAYS_MS. */
  delays?: readonly number[];
  /**
   * CLI 가 이 실패에 직접 단 오류 코드(`SDKAssistantMessageError`, 드라이버가 읽는다) —
   * 있으면 계정류 판정이 문장보다 이 코드를 먼저 본다. 문구는 CLI 판마다 바뀌어도 코드는
   * SDK 의 타입 계약이다. Claude 만 싣고, 없는 실패가 대부분이다.
   */
  errorCode?: string | null;
}

export type RetryDecision =
  | { action: "retry"; delayMs: number }
  | { action: "wait"; delayMs: number }
  | {
      action: "stop";
      reason: "auth" | "account" | "exhausted" | "permanent" | "limit-no-reset";
    };

/**
 * 계정류 실패의 오류 코드 — SDK 의 `SDKAssistantMessageError`(sdk.d.ts)에서 시간이 풀 수
 * 없는 것들: 크레딧 · 청구(`billing_error`), 계정 보류(`account_on_hold`), 조직이 구독 로그인을
 * 막음(`oauth_org_not_allowed`), 모델 접근 불가(`model_not_found`). `authentication_failed` 는
 * 일부러 뺐다 — 로그인 만료는 `auth` 의 몫이다(문장으로 갈린다).
 */
const ACCOUNT_CODES: ReadonlySet<string> = new Set([
  "billing_error",
  "account_on_hold",
  "oauth_org_not_allowed",
  "model_not_found",
]);

/**
 * 계정류 실패의 문장들 — 같은 말로 다시 시도해도 소용없고 계정이 풀어야 한다.
 * 문구는 번들 CLI(@anthropic-ai/claude-agent-sdk 0.3.263 · CLI 2.1.292 의 문자열을
 * `grep -a` 로 읽음)와 공식 오류 문서(code.claude.com/docs/en/errors)에서 뽑았다 — 새로 지어낸 문장은
 * 없다. 각 줄의 `[CLI]` 는 번들에서 확인한 문구, `[문서]` 는 공식 문서에만 있는 문구,
 * `[필드]` 는 이전 CLI 판의 문구(사용자 PC 의 CLI 는 이 도구가 고르지 않으므로 옛 판도 읽는다)다.
 */
const ACCOUNT_RESULT = new RegExp(
  [
    // 크레딧 부족 — `Credit balance is too low` (billing_error) [CLI][문서]
    "credit balance is too low",
    // 계정 보류 — `Your account is on hold and can't sign in to Claude Code …` (account_on_hold) [CLI][문서]
    "account is on hold",
    // 조직 비활성 — API 원문 `This organization has been disabled` [CLI][문서]
    "organization has been disabled",
    // 비활성 조직의 ANTHROPIC_API_KEY — `Your ANTHROPIC_API_KEY belongs to a disabled organization …` [CLI]
    "belongs to a disabled organization",
    // 조직 정책 — `Your organization has disabled Claude subscription access …` ·
    // `… has disabled API key authentication …` [CLI][문서]
    "organization has disabled (?:claude subscription access|api key authentication)",
    // 조직이 구독 로그인을 막음 — API 원문 `OAuth authentication is currently not allowed for this
    // organization` (oauth_org_not_allowed) [CLI]
    "oauth authentication is currently not allowed",
    // 접근 권한 없음 — `Your account does not have access to Claude. Please login again or contact
    // your administrator.` [CLI] · `Your account does not have access to Claude Code. Please run
    // /login.` [필드: 무료 요금제 · 청구 연체 · 요금제 하향 보고(claude-code 이슈 #30854 · #45886)] —
    // 뒤쪽은 `please run /login` 이 들어 있어 auth 로도 읽히므로 계정류가 먼저다.
    "does not have access to claude",
    // 요금제가 모델 · 기능을 막음 — `Claude Opus is not available with the Claude Pro plan …` [CLI][문서] ·
    // `Auto mode is unavailable for your plan` [CLI]
    "(?:not available|unavailable) (?:with|for) (?:the |your )?(?:claude )?(?:\\w+ )?plan",
    // 조직이 모델 선택을 막음 — `Model … is restricted by your organization's settings` ·
    // `… Your organization restricts model selection.` [문서]
    "restricts model selection|restricted by your organization",
    // 모델 접근 불가 — `There's an issue with the selected model (…). It may not exist or you may not
    // have access to it.` (model_not_found) [CLI][문서]
    "issue with the selected model|may not have access to it",
  ].join("|"),
  "i",
);

/**
 * 이 실패가 계정류인가 — 코드가 있으면 코드가 먼저, 없거나 모르는 코드면 문장을 읽는다.
 * 모르는 것으로 막지 않는다: 어느 쪽도 맞지 않으면 계정류가 아니다(거짓 차단이 거짓 허용보다
 * 나쁘다 — 계정류가 아닌 일시 오류는 사다리가 그대로 맡는다).
 */
export function isAccountFailure(resultText: string | null, errorCode?: string | null): boolean {
  if (errorCode != null && ACCOUNT_CODES.has(errorCode)) return true;
  return resultText !== null && ACCOUNT_RESULT.test(resultText);
}

/**
 * 로그인 만료의 문장들 — 같은 말로 다시 시도해도 소용없는 실패다(PLAN L12).
 * 시간이 풀지 않고 사용자의 로그인이 푼다: 세션은 멈춘 말을 기억하고 상태가
 * 돌아오면 한 번 스스로 다시 보낸다.
 */
const AUTH_RESULT =
  /authentication_error|invalid api key|oauth token|please run \/login|not logged in|\b401\b/i;

/**
 * 같은 말로는 다시 시도해도 소용없는 실패 — 길이의 문제는 말을 줄여야
 * 하니 사람의 몫으로 남는다. 한도와 혼동하지 않는다: 한도는 시간의 문제다.
 */
const PERMANENT_RESULT =
  /prompt is too long|too many tokens|context (window|length)|maximum input|input.*too long/i;

/** 시간이 풀어 줄 실패 — 한도 계열. 재충전 시각을 아는 것이 재시도의 조건. */
const LIMIT_RESULT = /usage limit|rate limit|limit reached|weekly limit|quota/i;

/** ratelimit 이벤트의 status 중 "막힘"이 아닌 말들 — claude `allowed`, codex `updated`. */
const RATE_LIMIT_CLEAR = /^(allowed|updated|ok|)$/i;

/** 막힌 한도 상태인가 — status 가 조용한 말이 아니면 막힌 것이다. */
function rateLimitBlocked(rateLimit: RetryInput["rateLimit"]): boolean {
  if (!rateLimit) return false;
  return !RATE_LIMIT_CLEAR.test(rateLimit.status);
}

/**
 * 공급자 스트림 오류가 답변 옷을 입고 도착한 모양 — 드라이버가 isError 를
 * 못 달 때(오류가 마지막 메시지 텍스트로 흘러들 때)의 실패 신호다.
 * 실측: "Devin stream error unavailable: The third-party model provider is
 * experiencing issues ... Please try this model again later. (error ID: ...)".
 *
 * 오류 문구와 근거 문구를 함께 요구하고 길이 상한을 두는 것은, 스트림 오류를
 * 화제로 설명하는 정상 답변(길고 문맥이 있는 말)과 갈라 놓기 위해서다.
 */
const STREAM_ERROR_HEADLINE = /\bstream error\b/i;
const STREAM_ERROR_DETAIL =
  /\b(unavailable|not available|try (this |the )?model again|again later|error id:)\b/i;
const STREAM_ERROR_MAX_CHARS = 600;

export function looksLikeStreamError(resultText: string | null): boolean {
  if (!resultText || resultText.length > STREAM_ERROR_MAX_CHARS) return false;
  return STREAM_ERROR_HEADLINE.test(resultText) && STREAM_ERROR_DETAIL.test(resultText);
}

export function classifyRetry(input: RetryInput): RetryDecision {
  const delays = input.delays ?? RETRY_DELAYS_MS;
  const text = input.resultText ?? "";
  // 계정류는 사다리의 어느 계단에서도 같은 말이다 — 소진 판정보다 앞서서 `다섯 번 다시
  // 물었다` 는 거짓말 없이 곧바로 계정의 말로 끝난다. 로그인 문장(`please run /login`)을
  // 함께 든 계정류 문구도 auth 보다 먼저 가른다.
  if (isAccountFailure(input.resultText, input.errorCode)) {
    return { action: "stop", reason: "account" };
  }
  const delay = delays.at(input.attempt);
  if (delay === undefined) return { action: "stop", reason: "exhausted" };
  // 로그인 만료는 사다리를 타지 않는다 — 기다림이 문제를 풀지 않는다.
  if (AUTH_RESULT.test(text)) return { action: "stop", reason: "auth" };
  if (PERMANENT_RESULT.test(text)) return { action: "stop", reason: "permanent" };
  const limited = LIMIT_RESULT.test(text) || rateLimitBlocked(input.rateLimit);
  if (limited) {
    const resetsAt = input.rateLimit?.resetsAt ?? null;
    if (resetsAt === null) return { action: "stop", reason: "limit-no-reset" };
    const wait = resetsAt + LIMIT_RETRY_GRACE_MS - input.now;
    if (wait > LIMIT_WAIT_MAX_MS) return { action: "stop", reason: "limit-no-reset" };
    // 이미 지난 재충전 — 기다릴 것이 없으니 백오프로 곧바로 다시.
    return { action: "wait", delayMs: Math.max(wait, delay) };
  }
  return { action: "retry", delayMs: delay };
}

/** 실패의 단계 — 턴 통계(turn-stats)가 실패 행에 새기는 한 마디. 사전은 프로토콜 한 곳(진단 요약과 함께 쓴다). */
export type FailureStage = TurnFailureStage;

/**
 * 실패 문장의 최선 분류 — 재시도 판정(classifyRetry)이 쓰는 같은 사전으로
 * 읽는다. 세션의 ratelimit 상태는 여기 없으므로 limit 은 문장에 흔적이 남을
 * 때만 나온다: 판정이 아니라 측정이다(실패 단계의 분포를 보는 잣대).
 * 계정류는 판정과 같은 자리에서 가장 먼저 갈린다(2026-10-07) — 통계가 본 `account` 와
 * 세션이 멈춘 `account` 가 어긋나지 않게.
 */
export function classifyFailure(
  resultText: string | null,
  errorCode?: string | null,
): FailureStage {
  const text = resultText ?? "";
  if (isAccountFailure(resultText, errorCode)) return "account";
  if (PERMANENT_RESULT.test(text)) return "length";
  if (AUTH_RESULT.test(text)) return "auth";
  if (looksLikeStreamError(resultText)) return "stream";
  if (LIMIT_RESULT.test(text)) return "limit";
  return "other";
}
