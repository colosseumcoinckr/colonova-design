// PLAN-UI U13 의 순수 시험 — 제출 국면의 판정(deriveSubmitPhase) · 기록의 전이
// (advanceSubmitTrail) · 실패 분류(classifySubmitError · classifyGitHubFailure). `../dist` 임포트인
// 이유는 cycle-ledger.test.ts 와 같다.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceSubmitTrail,
  classifyGitHubFailure,
  classifySubmitError,
  deriveSubmitPhase,
  SUBMIT_LOG_TEXT,
} from "../dist/submit-state.js";

const AT = "2026-09-25T01:00:00.000Z";
const intent = (extra: Record<string, unknown> = {}) => ({
  requestedAt: AT,
  via: "button" as const,
  ...extra,
});
const base = { push: null, budgets: {}, notices: {}, authExpired: false };

test("deriveSubmitPhase — 의도가 없으면 idle", () => {
  assert.deepEqual(deriveSubmitPhase({ ...base, intent: null }), { phase: "idle", attempts: 0 });
});

test("deriveSubmitPhase — 실패가 없는 의도는 running", () => {
  assert.deepEqual(deriveSubmitPhase({ ...base, intent: intent() }), {
    phase: "running",
    attempts: 0,
  });
});

test("deriveSubmitPhase — 예산 안의 잠깐 실패는 retrying (단계 · 푸시 둘 다)", () => {
  assert.deepEqual(
    deriveSubmitPhase({ ...base, intent: intent({ attempts: 2, lastError: "network" }) }),
    { phase: "retrying", attempts: 2, lastError: "network" },
  );
  const push = { behindSince: AT, attempts: 3, nextAttemptAt: AT, lastError: "rejected" as const };
  assert.deepEqual(deriveSubmitPhase({ ...base, push, intent: intent() }), {
    phase: "retrying",
    attempts: 3,
    lastError: "rejected",
  });
});

test("deriveSubmitPhase — 인증은 예산보다 먼저 막힌다 (만료 기록 · 401)", () => {
  assert.deepEqual(deriveSubmitPhase({ ...base, authExpired: true, intent: intent() }), {
    phase: "blocked",
    attempts: 0,
    lastError: "auth",
    blockedBy: "auth",
  });
  const push = { behindSince: AT, attempts: 1, nextAttemptAt: AT, lastError: "auth" as const };
  assert.equal(deriveSubmitPhase({ ...base, push, intent: intent() }).blockedBy, "auth");
});

test("deriveSubmitPhase — 예산을 다 써 알렸으면 developer-notified", () => {
  const budgets = {
    "submit:pr": { spent: 5, firstAt: AT, lastAt: AT, escalated: true },
  };
  assert.deepEqual(
    deriveSubmitPhase({ ...base, budgets, intent: intent({ attempts: 5, lastError: "other" }) }),
    { phase: "blocked", attempts: 5, lastError: "other", blockedBy: "developer-notified" },
  );
  // 1시간 넘게 밀린 푸시의 서 있는 알림도 같은 막힘이다.
  const notices = { "push:behind": { via: "issue" as const, raisedAt: AT, count: 1 } };
  assert.equal(
    deriveSubmitPhase({ ...base, notices, intent: intent() }).blockedBy,
    "developer-notified",
  );
});

test("deriveSubmitPhase — 인터넷 문제로 예산을 다 쓴 막힘은 network (개발자를 기다릴 일이 아니다)", () => {
  const budgets = {
    "submit:pr": { spent: 5, firstAt: AT, lastAt: AT, escalated: true },
  };
  assert.deepEqual(
    deriveSubmitPhase({ ...base, budgets, intent: intent({ attempts: 5, lastError: "network" }) }),
    { phase: "blocked", attempts: 5, lastError: "network", blockedBy: "network" },
  );
  // 밀린 푸시가 1시간을 넘긴 막힘도 마지막 오류가 인터넷이면 같다.
  const notices = { "push:behind": { via: "issue" as const, raisedAt: AT, count: 1 } };
  const push = { behindSince: AT, attempts: 4, nextAttemptAt: AT, lastError: "network" as const };
  assert.equal(
    deriveSubmitPhase({ ...base, notices, push, intent: intent() }).blockedBy,
    "network",
  );
  // 인증이 먼저다 — 둘이 겹치면 사람의 손이 필요한 쪽이 이긴다.
  assert.equal(
    deriveSubmitPhase({
      ...base,
      budgets,
      authExpired: true,
      intent: intent({ attempts: 5, lastError: "network" }),
    }).blockedBy,
    "auth",
  );
});

test("advanceSubmitTrail — 같은 국면은 기록하지 않는다(틱은 사건이 아니다)", () => {
  const trail = { phase: "retrying" as const, log: [{ at: AT, text: SUBMIT_LOG_TEXT.retrying }] };
  const step = advanceSubmitTrail(trail, { phase: "retrying", attempts: 3 }, AT);
  assert.equal(step.changed, false);
  assert.equal(step.blocked, null);
});

test("advanceSubmitTrail — 막힘은 들어설 때 한 번, 풀림과 성공이 차례로 적힌다", () => {
  let trail = advanceSubmitTrail(undefined, { phase: "running", attempts: 0 }, AT).trail;
  assert.deepEqual(trail.log, [], "누름 자체는 기록이 아니다");
  let step = advanceSubmitTrail(trail, { phase: "retrying", attempts: 1 }, AT);
  assert.deepEqual(
    step.trail.log.map((l) => l.text),
    [SUBMIT_LOG_TEXT.retrying],
  );
  step = advanceSubmitTrail(
    step.trail,
    { phase: "blocked", attempts: 5, blockedBy: "developer-notified" },
    AT,
  );
  assert.equal(step.blocked, "developer-notified");
  assert.equal(step.trail.blockedAt, AT, "막힘에 들어선 순간이 줄의 신원이다");
  // 막힌 채 이유만 바뀌어도(인증) 다시 울리지 않는다.
  const again = advanceSubmitTrail(
    step.trail,
    { phase: "blocked", attempts: 5, blockedBy: "auth" },
    AT,
  );
  assert.equal(again.changed, false);
  assert.equal(again.blocked, null);
  step = advanceSubmitTrail(step.trail, { phase: "retrying", attempts: 5 }, AT);
  assert.equal(step.blocked, null);
  trail = advanceSubmitTrail(step.trail, { phase: "idle", attempts: 0 }, AT, true).trail;
  assert.equal(trail.phase, "idle");
  assert.equal(trail.blockedAt, AT, "막힘의 흔적은 기록에 남는다");
  // 최근 셋만 남는다 — 가장 오래된 `다시 제출하는 중` 이 밀려난다.
  assert.deepEqual(
    trail.log.map((l) => l.text),
    [SUBMIT_LOG_TEXT.blocked, SUBMIT_LOG_TEXT.unblocked, SUBMIT_LOG_TEXT.succeeded],
  );
});

test("advanceSubmitTrail — 풀렸다 다시 막히면 새 신원(blockedAt)으로 선다", () => {
  const first = advanceSubmitTrail(
    undefined,
    { phase: "blocked", attempts: 3, blockedBy: "developer-notified" },
    AT,
  ).trail;
  assert.equal(first.blockedAt, AT);
  // 같은 막힘이 계속돼도 신원은 처음 시각 그대로다.
  const still = advanceSubmitTrail(
    first,
    { phase: "blocked", attempts: 6, blockedBy: "developer-notified" },
    "2026-09-25T02:00:00.000Z",
  );
  assert.equal(still.changed, false);
  // 풀렸다가 다시 막힌 것은 새 문제다 — 신원이 갱신되어 닫은 줄도 다시 선다.
  const retrying = advanceSubmitTrail(
    still.trail,
    { phase: "retrying", attempts: 7 },
    "2026-09-25T03:00:00.000Z",
  ).trail;
  const reblocked = advanceSubmitTrail(
    retrying,
    { phase: "blocked", attempts: 8, blockedBy: "developer-notified" },
    "2026-09-25T04:00:00.000Z",
  ).trail;
  assert.equal(reblocked.blockedAt, "2026-09-25T04:00:00.000Z");
});

test("advanceSubmitTrail — 성공 없이 idle 로 돌아가면(보낼 것이 없음) 줄이 없다", () => {
  const trail = { phase: "running" as const, log: [] };
  const step = advanceSubmitTrail(trail, { phase: "idle", attempts: 0 }, AT);
  assert.equal(step.trail.phase, "idle");
  assert.deepEqual(step.trail.log, []);
});

// ————— 인증 · 권한 · 한도 (2026-10-07 베타 준비 분석) —————
// 403 을 전부 `연결 코드 만료` 로 읽으면 개발자가 권한을 틀리게 만든 초대장에서 사용자가 새 초대 파일을
// 받아도 같은 문장을 본다. 갈래마다 사람이 하는 일이 다르다: auth → 새 초대 파일 · permission → 개발자가 코드의
// 권한을 고침 · limit → 시간이 푼다(막힘 아님).

test("deriveSubmitPhase — 권한 부족은 예산보다 먼저 막힌다(첫 실패 · 단계도 푸시도)", () => {
  assert.deepEqual(
    deriveSubmitPhase({ ...base, intent: intent({ attempts: 1, lastError: "permission" }) }),
    { phase: "blocked", attempts: 1, lastError: "permission", blockedBy: "permission" },
  );
  const push = {
    behindSince: AT,
    attempts: 2,
    nextAttemptAt: AT,
    lastError: "permission" as const,
  };
  assert.deepEqual(deriveSubmitPhase({ ...base, push, intent: intent() }), {
    phase: "blocked",
    attempts: 2,
    lastError: "permission",
    blockedBy: "permission",
  });
  // 인증이 권한보다 앞선다 — 코드가 만료됐으면 새 초대 파일이 먼저다.
  assert.equal(
    deriveSubmitPhase({
      ...base,
      authExpired: true,
      intent: intent({ attempts: 1, lastError: "permission" }),
    }).blockedBy,
    "auth",
  );
});

test("deriveSubmitPhase — 한도는 막힘이 아니라 retrying 이다(예산이 아직 안 다했을 때)", () => {
  assert.deepEqual(
    deriveSubmitPhase({ ...base, intent: intent({ attempts: 3, lastError: "limit" }) }),
    { phase: "retrying", attempts: 3, lastError: "limit" },
  );
  // 한 시간 넘게 이어져 개발자 알림이 선 뒤(예산의 표식)에야 막힘이다 — 그때도 인증 · 권한이 아니다.
  const escalated = deriveSubmitPhase({
    ...base,
    budgets: { "submit:pr": { spent: 5, firstAt: AT, lastAt: AT, escalated: true } },
    intent: intent({ attempts: 5, lastError: "limit" }),
  });
  assert.equal(escalated.phase, "blocked");
  assert.equal(escalated.blockedBy, "developer-notified");
});

test("advanceSubmitTrail — 권한 막힘은 새로 들어설 때 한 번 permission 으로 알린다", () => {
  const view = {
    phase: "blocked" as const,
    attempts: 1,
    lastError: "permission" as const,
    blockedBy: "permission" as const,
  };
  const step = advanceSubmitTrail(undefined, view, AT);
  assert.equal(step.blocked, "permission");
  assert.deepEqual(
    step.trail.log.map((line) => line.text),
    [SUBMIT_LOG_TEXT.blocked],
  );
  const again = advanceSubmitTrail(step.trail, view, AT);
  assert.equal(again.changed, false);
  assert.equal(again.blocked, null);
});

test("classifyGitHubFailure — 같은 403 도 문장이 갈래를 정한다", () => {
  const table: Array<[string, string | null]> = [
    // 인증 — 새 초대 파일이 푼다
    ["제출에 실패했습니다 — GitHub 401: Bad credentials", "auth"],
    ["fatal: Authentication failed for 'https://github.com/org/app.git/'", "auth"],
    ["remote: Invalid username or password.", "auth"],
    ["git@github.com: Permission denied (publickey).", "auth"],
    ["토큰이 유효하지 않거나 만료됐습니다 — 새 토큰을 넣어 주세요.", "auth"],
    // 권한 — 개발자가 코드의 권한을 고쳐야 푼다
    [
      "제출에 실패했습니다 — GitHub 403: Resource not accessible by personal access token",
      "permission",
    ],
    ["remote: Permission to org/app.git denied to colonova-bot.", "permission"],
    [
      "fatal: unable to access 'https://github.com/org/app.git/': The requested URL returned error: 403",
      "permission",
    ],
    [
      "제출에 실패했습니다 — GitHub 403: Resource protected by organization SAML enforcement.",
      "permission",
    ],
    ["제출에 실패했습니다 — GitHub 403: Must have admin rights to Repository.", "permission"],
    // 비공개 레포는 권한이 없어도 404 로 답한다
    ["제출에 실패했습니다 — GitHub 404: Not Found", "permission"],
    // 한도 — 시간이 푼다(403 · 429 둘 다). 한도의 403 은 권한 문장이 아니다
    ["제출에 실패했습니다 — GitHub 403: API rate limit exceeded for user ID 1.", "limit"],
    [
      "제출에 실패했습니다 — GitHub 403: You have exceeded a secondary rate limit. Please wait a few minutes",
      "limit",
    ],
    ["제출에 실패했습니다 — GitHub 403: You have triggered an abuse detection mechanism", "limit"],
    ["제출에 실패했습니다 — GitHub 429: Too Many Requests", "limit"],
    // 그 밖
    ["fetch failed", null],
    ["요청 열기 실패 (422)", null],
    ["제출에 실패했습니다 — GitHub 422: Validation Failed — A pull request already exists", null],
    ["error: cannot open .git/FETCH_HEAD: Permission denied", null],
  ];
  for (const [text, expected] of table) {
    assert.equal(classifyGitHubFailure(text), expected, text);
  }
});

test("classifyGitHubFailure — 레포 · 브랜치 · 파일 이름의 숫자와 낱말은 상태가 아니다(2026-10-08 F11)", () => {
  const table: Array<[string, string | null]> = [
    // 이름이 한도로 읽히던 것 — 주소의 `abuse` · `429`
    [
      "fatal: unable to access 'https://github.com/acme/abuse-reports.git/': The requested URL returned error: 403",
      "permission",
    ],
    ["fatal: Authentication failed for 'https://github.com/acme/app-429.git/'", "auth"],
    ["remote: Permission to acme/abuse-reports.git denied to colonova-bot.", "permission"],
    // 이름이 권한으로 읽히던 것 — 브랜치 · 경로의 `403`
    [
      "제출에 실패했습니다 — GitHub 422: Validation Failed — A pull request already exists for acme:fix/403-page.",
      null,
    ],
    ["error: pathspec 'src/pages/403.tsx' did not match any file(s) known to git", null],
    ["error: src refspec fix-403 does not match any", null],
    ["fatal: invalid reference: abuse-reports", null],
    // 상태 자리의 숫자는 그대로 센다 — 앱의 머리 · git 의 returned error · HTTP · 괄호
    ["error: RPC failed; HTTP 403 curl 22 The requested URL returned error: 403", "permission"],
    [
      "제출에 실패했습니다 — GitHub 403: Resource not accessible by personal access token",
      "permission",
    ],
    ["제출에 실패했습니다 — GitHub 401: Bad credentials", "auth"],
    [
      "fatal: unable to access 'https://github.com/o/r.git/': The requested URL returned error: 429",
      "limit",
    ],
    ["< HTTP/2 429", "limit"],
    ["401 Unauthorized", "auth"],
    ["요청 열기 실패 (403)", "permission"],
    // 진짜 한도의 말은 주소가 섞여도 한도다
    [
      "제출에 실패했습니다 — GitHub 403: You have exceeded a secondary rate limit. See https://docs.github.com/en/rest/guides/best-practices",
      "limit",
    ],
    // 문장의 낱말은 그대로 — 공백 든 따옴표 글 · 아포스트로피는 문장이다
    ['{"message":"Bad credentials","status":"401"}', "auth"],
    ["You don't have permission, that's that — retry-after: 60", "limit"],
    ["page 403 of the report", null],
  ];
  for (const [text, expected] of table) {
    assert.equal(classifyGitHubFailure(text), expected, text);
  }
  // 두 분류기가 같은 잣대다 — 이름의 숫자가 막힘 · 한 시간 재시도로 이어지지 않는다.
  assert.equal(
    classifySubmitError("fatal: Authentication failed for 'https://github.com/acme/app-429.git/'"),
    "auth",
  );
  assert.equal(
    classifySubmitError(
      "제출에 실패했습니다 — GitHub 422: A pull request already exists for acme:fix/403-page.",
    ),
    "other",
  );
});

test("classifyGitHubFailure — 긴 글에서도 선형이다: 공백 없는 10만 자 줄이 데몬을 멈추지 않는다(2026-10-08 F11)", () => {
  // 이름을 지우는 정규식이 낱말 안을 되돌아가면 10만 자 한 줄에서 30초가 걸렸다 — 낱말 단위로 한 번만 본다.
  // 여유를 크게 잡은 한계다(실제는 몇 ms) — 부하 속의 흔들림이 아니라 제곱으로 느려지는 것을 잡는다.
  const long = [
    "a".repeat(100_000),
    "a-".repeat(50_000),
    `error${" ".repeat(100_000)}x`,
    `${"x/".repeat(50_000)}403`,
  ];
  for (const text of long) {
    const startedAt = Date.now();
    assert.equal(classifyGitHubFailure(text), null);
    assert.ok(Date.now() - startedAt < 3_000, "긴 글을 선형 시간에 훑는다");
  }
  // 긴 글의 끝에 붙은 진짜 거절 문장은 그대로 읽힌다.
  assert.equal(
    classifyGitHubFailure(
      `${"a".repeat(100_000)}\nfatal: Authentication failed for 'https://github.com/o/r.git/'`,
    ),
    "auth",
  );
});

test("classifySubmitError — 인증 · 권한 · 한도가 갈린다(같은 403 이 전부 auth 가 아니다)", () => {
  assert.equal(
    classifySubmitError(
      "제출에 실패했습니다 — GitHub 403: Resource not accessible by personal access token",
    ),
    "permission",
  );
  assert.equal(classifySubmitError("제출에 실패했습니다 — GitHub 401: Bad credentials"), "auth");
  assert.equal(
    classifySubmitError(
      "제출에 실패했습니다 — GitHub 403: You have exceeded a secondary rate limit.",
    ),
    "limit",
  );
  // 푸시 쪽 문장도 같은 잣대다 — git 의 403 은 권한, 인증 실패는 인증.
  assert.equal(
    classifySubmitError(
      "fatal: unable to access 'https://github.com/org/app.git/': The requested URL returned error: 403",
    ),
    "permission",
  );
  assert.equal(
    classifySubmitError("fatal: Authentication failed for 'https://github.com/org/app.git/'"),
    "auth",
  );
});

test("classifySubmitError — 네 분류", () => {
  assert.equal(
    classifySubmitError("토큰이 유효하지 않거나 만료됐습니다 — 새 토큰을 넣어 주세요."),
    "auth",
  );
  assert.equal(
    classifySubmitError("GitHub 에 닿을 수 없습니다 — 연결 코드를 확인해 주세요."),
    "auth",
  );
  assert.equal(classifySubmitError("fetch failed"), "network");
  assert.equal(classifySubmitError("! [rejected] non-fast-forward"), "rejected");
  assert.equal(classifySubmitError("요청 열기 실패 (422)"), "other");
});
