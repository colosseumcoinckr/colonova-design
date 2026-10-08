/**
 * 자동 검사(CI) 읽기의 순수 부분 (2026-10-07 베타 준비 분석 · W6) — 체크 런 목록을 상태로 접고, 통과하지 못한 검사를
 * AI 가 읽을 브리프로 쓴다. 읽기(GitHub 호출)는 cycle-observe 가, 판정은 cycle-reconcile 의 14c 행이 한다 —
 * 여기는 입력이 같으면 출력이 같은 함수들뿐이다.
 *
 * 말할 수 있는 것은 읽힌 만큼이다:
 * - 검사 목록을 읽었을 때(`Checks: Read` 가 있는 토큰) — `passing` · `pending` · `failing` · `none` · `unknown`.
 * - 읽지 못했을 때(권한 없음 · GitHub 에 닿지 못함) — 상태 자체가 없다(`checks` 가 없다). `mergeable_state` 의
 *   `unstable` · `blocked` 는 필수가 아닌 검사의 실패나 대기, 필수 검사 · 승인 · 규칙 중 하나의 부족일 뿐이라
 *   「검사가 실패했다」 로 읽지 않고 AI 도 깨우지 않는다 — 표는 DEVELOPERS.md 의 「자동 검사 상태 읽기」.
 */
import { type HandoffCi, markTurn } from "@colonova-design/protocol";
import type { CheckAnnotationRow, CheckRunRow } from "./github.js";

/** 상태 — `none` 은 읽었는데 검사가 하나도 없다, `unknown` 은 끝났지만 통과도 실패도 아닌 결론(취소 · 사람의 승인 대기)뿐이다. */
export type CiState = "passing" | "pending" | "failing" | "none" | "unknown";

/** 읽는 양의 상한 — 검사 20개 · 줄 단위 안내 합계 50줄 · 글자 상한. 한 번 읽고 한 번 브리프한다. */
export const CI_LIMITS = {
  failing: 20,
  annotations: 50,
  nameChars: 120,
  summaryChars: 600,
  messageChars: 300,
  briefChars: 6000,
} as const;

/** 줄 단위 안내 한 건 — 경로가 있으니 AI 의 브리프에만 쓰고 로그 · 통계에는 남기지 않는다. */
export interface CiAnnotation {
  path: string;
  line: number | null;
  message: string;
}

/** 통과하지 못한 검사 하나 — 이름과 짧은 글과 안내(상한 안). */
export interface CiFailure {
  name: string;
  summary: string;
  annotations: CiAnnotation[];
}

/** 스냅샷에 실리는 자동 검사의 요약. `failing` 은 상한에서 잘려 있을 수 있고 `failingCount` 가 실제 수다. */
export interface CiChecks {
  state: CiState;
  failingCount: number;
  failing: CiFailure[];
  total: number;
}

/** 통과로 세는 결론 — 건너뜀 · 중립은 막지 않는다. */
const PASSING = new Set(["success", "neutral", "skipped"]);
/** AI 가 고칠 수 있는 실패 — 취소(대개 새 실행에 밀림) · 사람의 승인 대기는 실패가 아니다. */
const FAILING = new Set(["failure", "timed_out", "startup_failure"]);

/**
 * 검사 목록을 상태로 접는다. 하나라도 끝나지 않았으면 `pending` 이 먼저다(실패가 보여도 나머지가 끝나길 기다린다 —
 * 한 번의 브리프에 실패를 모두 싣는다). 끝난 검사 중 실패가 있으면 `failing`, 전부 통과면 `passing`.
 */
export function classifyCheckRuns(runs: CheckRunRow[]): { state: CiState; failing: CheckRunRow[] } {
  if (runs.length === 0) return { state: "none", failing: [] };
  const failing = runs.filter(
    (run) => run.status === "completed" && run.conclusion !== null && FAILING.has(run.conclusion),
  );
  if (runs.some((run) => run.status !== "completed")) return { state: "pending", failing };
  if (failing.length > 0) return { state: "failing", failing };
  const allPassing = runs.every((run) => run.conclusion !== null && PASSING.has(run.conclusion));
  return { state: allPassing ? "passing" : "unknown", failing };
}

/** 한 줄로 접고 상한에서 자른다 — 검사 이름 · 요약이 줄바꿈과 공백을 길게 들고 올 수 있다. */
function oneLine(text: string, max: number): string {
  const folded = text.replace(/\s+/g, " ").trim();
  return folded.length > max ? `${folded.slice(0, max)}…` : folded;
}

/** 요약 글 — 제목과 요약이 같지 않으면 둘 다, 둘이 비면 본문 앞부분. 줄바꿈은 살리고 상한에서 자른다. */
function summaryOf(run: CheckRunRow): string {
  const parts = [run.title.trim(), run.summary.trim()].filter(
    (part, index, all) => part !== "" && all.indexOf(part) === index,
  );
  const joined = (parts.length > 0 ? parts : [run.text.trim()]).join("\n").trim();
  return joined.length > CI_LIMITS.summaryChars
    ? `${joined.slice(0, CI_LIMITS.summaryChars)}…`
    : joined;
}

/**
 * 읽은 검사들을 스냅샷의 모양으로 접는다. 줄 단위 안내는 `annotationsOf`(검사 id → 안내)에서 가져오고, 실패 수준의
 * 안내를 먼저 세어 합계 상한(50줄) 안에서 자른다.
 */
export function summarizeCheckRuns(
  runs: CheckRunRow[],
  annotationsOf: ReadonlyMap<number, CheckAnnotationRow[]> = new Map(),
): CiChecks {
  const { state, failing } = classifyCheckRuns(runs);
  let room: number = CI_LIMITS.annotations;
  const kept: CiFailure[] = [];
  for (const run of state === "failing" ? failing.slice(0, CI_LIMITS.failing) : []) {
    const rows = [...(annotationsOf.get(run.id) ?? [])].sort(
      (a, b) => Number(b.level === "failure") - Number(a.level === "failure"),
    );
    const annotations = rows.slice(0, Math.max(0, room)).map((row) => ({
      path: row.path,
      line: row.line,
      message: oneLine(
        [row.title, row.message].filter(Boolean).join(" — "),
        CI_LIMITS.messageChars,
      ),
    }));
    room -= annotations.length;
    kept.push({
      name: oneLine(run.name, CI_LIMITS.nameChars) || "이름 없는 검사",
      summary: summaryOf(run),
      annotations,
    });
  }
  return {
    state,
    failingCount: state === "failing" ? failing.length : 0,
    failing: kept,
    total: runs.length,
  };
}

/**
 * 선로(HandoffStatus.ci)로 나가는 요약 — 종류와 숫자만. 검사가 없거나(`none`) 판단할 수 없거나(`unknown`) 읽지
 * 못했으면(undefined) 없다: 없다는 말이 「통과」 도 「실패」 도 아니다.
 */
export function handoffCiOf(checks: CiChecks | undefined): HandoffCi | undefined {
  if (checks === undefined) return undefined;
  if (checks.state === "passing" || checks.state === "pending") return { state: checks.state };
  if (checks.state === "failing") {
    return {
      state: "failing",
      ...(checks.failingCount > 0 ? { failing: checks.failingCount } : {}),
    };
  }
  return undefined;
}

/** 개발자 알림의 `자세히` 에 쓰는 한 줄 — `build, lint 외 2개`. 이름은 개발자의 채널로만 간다. */
export function failingNames(checks: CiChecks): string {
  const names = checks.failing.slice(0, 3).map((failure) => failure.name);
  const rest = checks.failingCount - names.length;
  return rest > 0 ? `${names.join(", ")} 외 ${rest}개` : names.join(", ");
}

/** 브리프의 끝의 기준 — 레포가 선언한 검사 명령만 돌리고, 검사와 무관한 변경은 하지 않는다(공통 규칙의 명령 범위와 같다). */
export const CI_FINISH_LINE =
  "끝의 기준: 이 검사가 통과하도록 고치고, 레포가 선언한 검사 명령(package.json 의 lint · typecheck · test · build)을 돌려 확인해 주세요 — 검사와 무관한 변경은 하지 마세요.";

/** 검사 결과의 상세가 하나도 없을 때 브리프가 밝히는 말 — 선언된 검사 명령으로 실패를 직접 찾게 한다. */
export const CI_NO_DETAIL_LINE =
  "실패한 검사의 자세한 출력은 읽지 못했습니다 — 레포가 선언한 검사 명령을 직접 돌려 어디서 실패하는지 먼저 찾아 주세요.";

/**
 * 자동 검사 반영 턴 — 첫 줄 표식(`<!-- colonova-design:ci … -->`)이 대화에서 카드가 된다. 본문은 AI 가 읽는
 * 한국어이고 끝의 기준 한 줄로 닫는다. 검사 이름 · 요약 · 줄 단위 안내는 글자 상한(`CI_LIMITS.briefChars`) 안에서만
 * 싣는다 — 넘치는 순간부터는 검사 이름만 적고 그 사실을 한 줄로 밝히며, 상한(20개)에 잘린 검사는 수로만 말한다.
 * 상세가 하나도 없으면 그 사실을 밝히고 선언된 검사 명령으로 찾게 한다.
 */
export function ciToTurn(input: { pr: number; checks: CiChecks }): string {
  const { checks } = input;
  const count = Math.max(checks.failingCount, checks.failing.length);
  const lines = [
    `자동 검사가 통과하지 못했습니다 — 제출한 요청에서 검사 ${count}개가 실패했습니다. 아래 결과를 읽고 고쳐 주세요.`,
    "",
  ];
  let used = lines.join("\n").length;
  const push = (row: string, force = false): boolean => {
    if (!force && used + row.length + 1 > CI_LIMITS.briefChars) return false;
    lines.push(row);
    used += row.length + 1;
    return true;
  };
  let shown = 0;
  let trimmed = false;
  for (const [index, failure] of checks.failing.entries()) {
    // 첫 검사의 머리줄은 늘 싣는다 — 이름도 없는 브리프는 쓸모가 없다.
    if (!push(`${index + 1}. ${failure.name}`, shown === 0)) break;
    shown += 1;
    // 상한을 넘은 뒤에는 이름만 적는다.
    if (trimmed) continue;
    const rows = [
      ...failure.summary
        .split("\n")
        .filter((row) => row.trim() !== "")
        .map((row) => `   ${row}`),
      ...failure.annotations.map(
        (note) =>
          `   - ${note.path}${note.line === null ? "" : `:${note.line}`}${note.message ? ` — ${note.message}` : ""}`,
      ),
    ];
    for (const row of rows) {
      if (push(row)) continue;
      trimmed = true;
      break;
    }
  }
  if (trimmed) lines.push("", "(글이 길어 일부 출력과 줄 안내는 줄였습니다)");
  const more = count - shown;
  if (more > 0) lines.push("", `(통과하지 못한 검사가 ${more}개 더 있습니다)`);
  const detailed = checks.failing.some(
    (failure) => failure.summary.trim() !== "" || failure.annotations.length > 0,
  );
  if (!detailed) lines.push("", CI_NO_DETAIL_LINE);
  lines.push("", CI_FINISH_LINE);
  return markTurn({ kind: "ci", pr: input.pr, failing: count }, lines.join("\n"));
}
