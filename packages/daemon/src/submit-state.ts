/**
 * 제출 상태 (PLAN-UI U13) — 원장의 제출 의도 · 푸시 · 예산 · 서 있는 알림을
 * 한 값(`RepoStatus.submit`)으로 읽는 순수 함수들. 상태 줄의 `제출하지 못했어요`
 * 와 `이번 작업` 의 제출 기록이 이 값에서 나온다 — 문장은 웹이 짓고, 여기서는
 * 국면과 기록 줄만 정한다.
 *
 * 국면:
 * - idle — 제출 의도가 없다.
 * - running — 의도가 있고 아직 실패가 없다(한 번 누른 제출이 도는 중).
 * - retrying — 잠깐의 실패(network · rejected · other)가 예산 안에 있다.
 *   감독자가 백오프 간격으로 스스로 다시 제출한다.
 * - blocked — 사람의 손이 필요하다. 연결 코드가 만료됐거나(auth — 새 초대 파일이 푼다), 코드의
 *   권한이 모자라거나(permission — 개발자가 코드의 권한을 고쳐야 푼다; 새 초대 파일은 해결이 아니다),
 *   예산을 다 써 개발자에게 알렸다(developer-notified). 시도는 백오프로 계속되고, 풀리면 도구가
 *   다시 제출한다. GitHub 의 한도(limit)는 막힘이 아니다 — 시간이 풀므로 retrying 의 사다리를 탄다.
 *
 * 기록 줄의 말은 이 판의 어휘 그대로다 — 개발자 말(턴 · git · PR …)을 쓰지 않는다.
 */
import type { BudgetLedger } from "./budgets.js";
import type {
  CycleLedger,
  CyclePushState,
  CycleSubmitTrail,
  SubmitErrorKind,
  SubmitPhase,
} from "./cycle-ledger.js";

/** 기록 줄의 문장 — 웹의 labels 와 같은 말(PLAN-UI U13). */
export const SUBMIT_LOG_TEXT = {
  blocked: "제출하지 못했어요 — 개발자에게 알렸어요",
  unblocked: "개발자가 풀었어요 — 도구가 다시 제출해요",
  succeeded: "제출했어요",
  retrying: "다시 제출하는 중",
  /** 한마디 더(U20 · PLAN-UI §10) — 영수증의 상자가 보낸 말의 흔적. */
  noteSent: "개발자에게 한마디를 더 보냈어요",
} as const;

/** 선로에 싣는 기록 줄의 수 — `이번 작업` 은 최근 셋을 보인다. */
export const SUBMIT_LOG_MAX = 3;

/**
 * 막힘의 까닭 — `auth` 는 연결 코드 만료(새 초대 파일이 푼다), `permission` 은 코드의 권한 부족(개발자가
 * 코드의 권한을 고쳐야 한다 — 새 초대 파일을 받아도 같은 문장이 나온다), `network` 는 이 기계의 인터넷
 * 문제(풀리면 저절로), `developer-notified` 는 그 밖의 문제로 재시도 예산을 다 써 개발자에게 알린 경우.
 * 네트워크 문제를 개발자에게 알렸다고 말하면 사용자는 제 연결이 아니라 개발자를 기다린다(2026-10-06
 * UX 점검). 403 을 전부 만료로 말하던 거짓 증상을 갈랐다(2026-10-07 베타 준비 분석).
 */
export type SubmitBlockReason = "auth" | "permission" | "developer-notified" | "network";

export interface SubmitPhaseView {
  phase: SubmitPhase;
  attempts: number;
  lastError?: SubmitErrorKind;
  /** blocked 일 때만 — 알림(`submit-blocked`)의 reason. */
  blockedBy?: SubmitBlockReason;
}

/**
 * 원장 조각에서 지금의 국면을 판정한다. 인증이 먼저다 — 만료된 연결 코드는
 * 예산과 상관없이 사람(새 초대 파일)이 풀어야 한다.
 */
export function deriveSubmitPhase(input: {
  intent: CycleLedger["submit"];
  push: CyclePushState | null;
  budgets: BudgetLedger;
  notices: CycleLedger["notices"];
  authExpired: boolean;
}): SubmitPhaseView {
  const { intent, push } = input;
  if (intent === null) return { phase: "idle", attempts: 0 };
  const stepAttempts = intent.attempts ?? 0;
  const pushAttempts = push?.attempts ?? 0;
  const attempts = Math.max(stepAttempts, pushAttempts);
  // 단계의 실패가 있으면 그 분류가, 없으면 밀린 푸시의 분류가 마지막 오류다.
  const lastError: SubmitErrorKind | undefined =
    stepAttempts > 0 && intent.lastError !== undefined
      ? intent.lastError
      : pushAttempts > 0
        ? push?.lastError
        : undefined;
  const auth =
    input.authExpired ||
    (stepAttempts > 0 && intent.lastError === "auth") ||
    (pushAttempts > 0 && push?.lastError === "auth");
  if (auth) return { phase: "blocked", attempts, lastError: "auth", blockedBy: "auth" };
  // 권한 부족은 기다려도 풀리지 않는다 — 예산과 상관없이 첫 실패에 막힘이다. 개발자가 코드의 권한을
  // 고치면 도구의 다음 시도가 선다(같은 코드의 권한을 고치는 것도 새 코드를 받는 것도 풀이다).
  const permission =
    (stepAttempts > 0 && intent.lastError === "permission") ||
    (pushAttempts > 0 && push?.lastError === "permission");
  if (permission) {
    return { phase: "blocked", attempts, lastError: "permission", blockedBy: "permission" };
  }
  // 예산이 다해 알림이 나갔다 — 단계 예산의 escalated 표식, 또는 1시간 넘게
  // 밀린 푸시의 서 있는 알림(push:behind).
  const escalated =
    input.budgets["submit:pr"]?.escalated === true ||
    input.budgets["submit:commit"]?.escalated === true ||
    input.notices["push:behind"] !== undefined;
  if (escalated) {
    return {
      phase: "blocked",
      attempts,
      lastError: lastError ?? "other",
      blockedBy: lastError === "network" ? "network" : "developer-notified",
    };
  }
  if (attempts > 0) {
    return { phase: "retrying", attempts, ...(lastError ? { lastError } : {}) };
  }
  return { phase: "running", attempts: 0 };
}

/**
 * 국면의 전이를 기록에 적는다 — 같은 국면이면 그대로(기록은 사건이지 틱이
 * 아니다). `succeeded` 는 제출이 끝까지 선 순간에만 부른다: 의도가 지워지는
 * 다른 길(보낼 것이 없음)은 성공이 아니다. 돌려주는 `blocked` 는 이번 전이로
 * 막힘에 새로 들어섰을 때만 — 알림이 막힘마다 한 번 나가는 근거다.
 */
export function advanceSubmitTrail(
  trail: CycleSubmitTrail | undefined,
  next: SubmitPhaseView,
  at: string,
  succeeded = false,
): { trail: CycleSubmitTrail; changed: boolean; blocked: SubmitBlockReason | null } {
  const prev = trail ?? { phase: "idle" as const, log: [] };
  const lines: string[] = [];
  let blocked: SubmitBlockReason | null = null;
  if (succeeded) {
    lines.push(SUBMIT_LOG_TEXT.succeeded);
  } else if (next.phase !== prev.phase) {
    if (next.phase === "blocked") {
      lines.push(SUBMIT_LOG_TEXT.blocked);
      blocked = next.blockedBy ?? "developer-notified";
    } else if (prev.phase === "blocked" && next.phase !== "idle") {
      lines.push(SUBMIT_LOG_TEXT.unblocked);
    } else if (next.phase === "retrying") {
      lines.push(SUBMIT_LOG_TEXT.retrying);
    }
  }
  const phase = succeeded ? "idle" : next.phase;
  if (phase === prev.phase && lines.length === 0) {
    return { trail: prev, changed: false, blocked: null };
  }
  const log = [...prev.log, ...lines.map((text) => ({ at, text }))].slice(-SUBMIT_LOG_MAX);
  // 막힘에 새로 들어선 순간이 그 문제의 신원이다 — 닫은 줄이 같은 문제를
  // 계속 말할 때 다시 뜨지 않는다(풀렸다 다시 막히면 새 신원으로 다시 선다).
  const blockedAt = next.phase === "blocked" && prev.phase !== "blocked" ? at : prev.blockedAt;
  return {
    trail: { phase, log, ...(blockedAt ? { blockedAt } : {}) },
    changed: true,
    blocked,
  };
}

/** GitHub 가 거절한 이유의 세 갈래 — 같은 403 이라도 사람이 하는 일이 다르다. */
export type GitHubFailureKind = "auth" | "permission" | "limit";

/**
 * 한도 — 1차(시간당) · 2차(secondary) · 남용 감지. 403 으로도 429 로도 온다. 시간이 풀므로 먼저 가른다:
 * 한도의 403 은 권한 문장이 아니다. 상태 숫자(429)는 `STATUS_CODE` 가 따로 본다.
 */
const LIMIT_FAILURE =
  /rate limit|secondary rate|abuse[- ](?:detection|rate)|too many requests|retry[- ]after/i;
/** 인증 — 코드 자체가 틀렸거나 만료 · 철회(401). 새 초대 파일이 푼다. */
const AUTH_FAILURE =
  /Authentication failed|could not read Username|Invalid username or password|Bad credentials|Requires authentication|Permission denied \(publickey\)|password authentication|\bUnauthorized\b|토큰이 유효하지 않|연결 코드를 확인|token (?:expired|revoked)|credentials? (?:expired|invalid)/i;
/**
 * 권한 — 코드는 맞는데 이 일을 할 권한이 없다(403 `Resource not accessible …` · 쓰기 거절 · 조직 SSO).
 * 비공개 레포는 권한이 없어도 404 로 답하므로(`GitHub 404`, httpError 의 꼴) 같은 갈래다. 개발자가 코드의
 * 권한을 고쳐야 푼다.
 */
const PERMISSION_FAILURE =
  /Resource not accessible|must have (?:admin|write|push)|Permission to .+ denied|denied to|Write access to repository not granted|SAML enforcement|not authorized|\bForbidden\b|GitHub 404/i;

/**
 * 상태 숫자는 **상태 자리**에서만 센다(2026-10-08 검토 · F11) — 앱이 GitHub 응답에 붙이는 머리(`GitHub 403:`),
 * git 의 `returned error: 403` · `HTTP 403`, `status 403`, `(403)`. 예전에는 글 어디서든 `\b403\b` 를 찾아 레포 ·
 * 브랜치 · 파일 이름의 숫자(`app-429.git` · `fix/403-page` · `403.tsx`)가 상태로 읽혔다. 공백 칸은 몇 칸으로 묶는다 —
 * 긴 공백 줄에서 되돌아가느라 느려지지 않게.
 */
const STATUS_CODE =
  /(?:GitHub|HTTP|status|code|error|returned)\s{0,3}:?\s{0,3}(401|403|429)\b|\((401|403|429)\)/gi;

/** 이름을 지운 자리 — `Permission to <이름> denied` 처럼 문장의 틀은 그대로 읽히게 자리를 남긴다. */
const NAME_SLOT = "<이름>";
/** 접두가 이름이 아니라 상태 · 줄머리인 `접두:값` 은 이름으로 보지 않는다. */
const OWNER_BRANCH_WORD =
  /^(?!(?:error|status|code|http|github|returned|fatal|remote)\b)[A-Za-z][\w.-]*:\w[\w.-]*$/i;
const HTTP_VERSION_WORD = /^HTTP\/\d(?:\.\d)?$/i;
const QUOTES = `'"\``;
const TRAILING_PUNCTUATION = ".,;:!?)]}";

/**
 * 낱말 하나가 이름이면 이름을 지운 말을, 아니면 그대로 돌려준다. 낱말마다 한 번씩만 본다 — 긴 글(출력 꼬리 수십 KB)에서도
 * 선형이다(낱말 안을 되돌아가는 정규식은 100KB 한 줄에서 30초가 걸렸다).
 */
function maskName(word: string): string {
  // 주소는 그 뒤를 통째로 지운다(`https://host/a/b":"x` 처럼 낱말에 붙은 꼬리까지) — 앞의 글자는 문장이다.
  const scheme = word.indexOf("://");
  if (scheme !== -1) {
    let from = scheme;
    while (from > 0 && /[A-Za-z0-9+.-]/.test(word[from - 1] ?? "")) from -= 1;
    return `${word.slice(0, from)}${NAME_SLOT}`;
  }
  let end = word.length;
  while (end > 0 && TRAILING_PUNCTUATION.includes(word[end - 1] ?? "")) end -= 1;
  const core = word.slice(0, end);
  if (HTTP_VERSION_WORD.test(core)) return "HTTP";
  // 경로 · `owner/branch` — 슬래시가 든 낱말은 이름이다.
  if (core.includes("/") || core.includes("\\")) return NAME_SLOT;
  // 따옴표로 감싼 한 덩이(`'abuse-reports'`) — 공백이 든 따옴표 글은 여러 낱말이라 여기 오지 않는다.
  const quote = core[0] ?? "";
  if (core.length >= 3 && QUOTES.includes(quote) && core.endsWith(quote)) return NAME_SLOT;
  return OWNER_BRANCH_WORD.test(core) ? NAME_SLOT : word;
}

/**
 * 분류의 눈에 들어가기 전에 이름을 지운다(2026-10-08 검토 · F11) — URL · 경로 · `owner/branch` · `owner:branch` ·
 * 따옴표로 감싼 이름. 레포 · 브랜치 · 파일 이름의 낱말과 숫자(`abuse-reports.git` · `app-429.git` · `fix/403-page` ·
 * `src/pages/403.tsx`)가 한도 · 권한으로 읽혀 첫 실패에 막히거나 한 시간 조용히 재시도하던 길을 막는다.
 */
function withoutNames(text: string): string {
  return text
    .split(/(\s+)/)
    .map((piece, at) => (at % 2 === 1 || piece === "" ? piece : maskName(piece)))
    .join("");
}

/**
 * GitHub · git 의 거절 문장을 세 갈래로 — 없으면 null(그 밖의 실패). 제출 단계의 분류
 * (classifySubmitError)와 푸시의 분류(cycle-supervisor 의 classifyPushError) · 푸시 게이트의
 * 인증 안내(repo-publish 의 failGate)가 같은 잣대를 쓴다. 이름을 지운 글에서 낱말과 상태 자리의 숫자만 본다.
 */
export function classifyGitHubFailure(text: string): GitHubFailureKind | null {
  const words = withoutNames(text);
  const codes = new Set<string>();
  for (const match of words.matchAll(STATUS_CODE)) codes.add(match[1] ?? match[2] ?? "");
  if (codes.has("429") || LIMIT_FAILURE.test(words)) return "limit";
  if (codes.has("401") || AUTH_FAILURE.test(words)) return "auth";
  if (codes.has("403") || PERMISSION_FAILURE.test(words)) return "permission";
  return null;
}

/**
 * 제출 단계의 실패 이유(사람의 문장 · git · GitHub 의 말)를 분류한다 — 인증 · 권한 · 한도는
 * classifyGitHubFailure 가 가르고, 그 밖에 이 기계의 네트워크 · 밀림을 더한다.
 */
export function classifySubmitError(reason: string): SubmitErrorKind {
  const github = classifyGitHubFailure(reason);
  if (github !== null) return github;
  if (
    /could not resolve host|connection|timed out|unable to access|network|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN/i.test(
      reason,
    )
  ) {
    return "network";
  }
  if (/rejected|non-fast-forward|fetch first/.test(reason)) return "rejected";
  return "other";
}
