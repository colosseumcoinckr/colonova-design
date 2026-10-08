import type { GateChecked, HandoffChecks } from "@colonova-design/protocol";
import { HANDOFF_TITLE_MAX_CHARS } from "./repo-prompts.js";

/**
 * 넘기기 본문의 코멘트 절 (PLAN D93) — 개발자는 무엇이 바뀌었는지와 **왜**
 * 바뀌었는지를 풀 리퀘스트를 떠나지 않고 읽는다. 이 저장소의 유일한 독자가
 * 그 개발자다: 사용자의 핀은 대화에서 이미 소비됐으므로 도구는 그것을 다시
 * 목록으로 그리지 않는다.
 */

/**
 * Builds the `### 수정 요청` section from this cycle's recorded comments:
 * 브랜치가 생긴 시각(sinceIso) 이후의 항목, 최대 20건(넘으면 `외 N건`), 화면은
 * 핀이 기록한 화면 id로, 요소 이름과 경로는 쓰지 않는다(D38). 자동 정리 뒤 모든
 * 행은 AI에게 전달된 것 — 해결 표식은 없다, 목록 자체가 요청의 기록이다.
 * 의도가 제목을 정한다 (재설계 C10 · 커미티 2차 판정 4): 전부 질문이면 섹션
 * 자체가 질문이고, 섞였으면 행마다 (질문)을 새긴다 — 사용자의 질문이 개발자
 * 에게 변경 지시로 읽혀선 안 된다. 빈 메모는 빈 메모다 (커미티 2차 판정 3):
 * 턴의 문장을 빌려 오면 한 문장이 N행으로 복제된다.
 */
export function buildCommentsSection(
  rows: Array<{
    screen: string;
    text: string;
    at: string;
    intent?: "change" | "question";
  }>,
  sinceIso: string,
  max = 20,
): string | null {
  // Compare as instants, not strings: the commit date is local-offset ISO,
  // the comment rows are UTC — a string compare would sort them wrong.
  const sinceMs = Date.parse(sinceIso);
  if (Number.isNaN(sinceMs)) return null;
  const cycle = rows
    .filter((row) => {
      const at = Date.parse(row.at);
      return !Number.isNaN(at) && at >= sinceMs;
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (cycle.length === 0) return null;
  const shown = cycle.slice(-max);
  const overflow = cycle.length - shown.length;
  const questions = shown.filter((row) => row.intent === "question").length;
  const changes = shown.length - questions;
  const lines = shown.map((row) => {
    const screen = row.screen;
    const ask = row.intent === "question" ? " (질문)" : "";
    // 핀 본문은 한 행에 눌러 담는다 — 새 줄이 그대로 들어가면 목록의 행이
    // 깨져 절의 끝이 어긋난다. (2026-09-21 상태 축 철거 — 행은 화면만 담는다.)
    const text = row.text.replace(/[\r\n\t]+/g, " ").trim();
    const words = text ? `"${text}"` : "(메모 없음)";
    return `- ${screen}${ask} — ${words}`;
  });
  const tail = overflow > 0 ? `\n- 외 ${overflow}건` : "";
  const title =
    questions > 0 && changes === 0
      ? "### 질문"
      : questions > 0
        ? "### 수정 요청 · 질문"
        : "### 수정 요청";
  const lead =
    questions > 0 && changes === 0
      ? "사용자가 미리보기에서 찍어 AI에게 보낸 질문입니다."
      : questions > 0
        ? "사용자가 미리보기에서 찍어 AI에게 보낸 수정 요청과 질문입니다."
        : "사용자가 미리보기에서 찍어 AI에게 보낸 수정 요청입니다.";
  return `${title}\n\n${lead}\n\n${lines.join("\n")}${tail}\n`;
}

/** numstat 한 줄 — 경로와 ±수(바이너리 · 이름 바꿈처럼 git 이 수를 주지 않으면 null). */
interface NumstatRow {
  path: string;
  added: number | null;
  removed: number | null;
}

/**
 * `git diff --numstat` 출력을 줄마다 읽는다 — `### 바뀐 파일` 과 `### 범위` 가 같은 입력을 같은 눈으로 읽는다.
 * 경로를 못 읽은 줄(탭이 모자라거나 경로가 빔)은 버리되 수는 센다: `### 범위` 는 못 읽은 줄이 있으면 「건드리지
 * 않았다」 고 말하지 않는다.
 */
function readNumstat(numstat: string): { rows: NumstatRow[]; unreadable: number } {
  const rows: NumstatRow[] = [];
  let unreadable = 0;
  for (const line of numstat.split(/\r?\n/)) {
    const text = line.trim();
    if (text === "") continue;
    const fields = text.split("\t");
    const path = fields.slice(2).join("\t").trim();
    if (!path) {
      unreadable += 1;
      continue;
    }
    const added = Number.parseInt(fields[0] ?? "", 10);
    const removed = Number.parseInt(fields[1] ?? "", 10);
    rows.push({
      path,
      added: Number.isNaN(added) ? null : added,
      removed: Number.isNaN(removed) ? null : removed,
    });
  }
  return { rows, unreadable };
}

/**
 * `### 바뀐 파일` 절 (저장·넘기기 목업 02): 이 사이클 브랜치의 numstat 을
 * 개발자가 읽는 목록으로 — 행마다 ±수, 머리줄에 합계. 개발자는 PR 의
 * Files 탭을 열기 전에 규모를 읽는다. 바이너리·이름 바꿈처럼 git 이 수를
 * 주지 않는 행은 ± 없이 경로만 말한다 — 추측한 크기는 거짓말이다.
 * 미리보기와 실제 본문이 같은 빌더를 지나므로 카드가 보여 준 것이 곧
 * 개발자에게 간다.
 */
export function buildFilesSection(numstat: string, max = 60): string | null {
  const { rows } = readNumstat(numstat);
  if (rows.length === 0) return null;
  const shown = rows.slice(0, max);
  const overflow = rows.length - shown.length;
  const counted = rows.filter((row) => row.added !== null && row.removed !== null);
  const totalAdded = counted.reduce((sum, row) => sum + (row.added ?? 0), 0);
  const totalRemoved = counted.reduce((sum, row) => sum + (row.removed ?? 0), 0);
  const lead =
    counted.length > 0
      ? `바뀐 파일 ${rows.length}개 · +${totalAdded} −${totalRemoved}`
      : `바뀐 파일 ${rows.length}개`;
  const lines = shown.map((row) =>
    row.added === null || row.removed === null
      ? `- ${row.path}`
      : `- ${row.path} (+${row.added} −${row.removed})`,
  );
  const tail = overflow > 0 ? `\n- 외 ${overflow}건` : "";
  return `### 바뀐 파일\n\n${lead}\n\n${lines.join("\n")}${tail}\n`;
}

/**
 * 범위 분류(2026-10-07 베타 준비 분석) — 개발자가 요청 본문에서 가장 먼저 묻는 것: 위험한 곳(의존성 · 락파일 · 설정 ·
 * CI)을 건드렸는가. 입력은 `### 바뀐 파일` 이 읽는 같은 numstat 이라 새 git 호출이 없고, **경로의 모양만** 본다 —
 * `package.json` 의 어느 항목이 바뀌었는지, `.env` 에 무엇이 적혔는지는 읽지 않으므로 말하지 않는다(파일이 건드려졌다는
 * 사실뿐). 표에 없는 파일은 `그 밖` 이다 — 모르는 것을 위험으로 몰지 않는다(과분류 금지).
 */
export type ScopeKind = "lockfile" | "package" | "ci" | "config";

export interface ScopeRule {
  kind: ScopeKind;
  /** 개발자가 읽는 분류 이름. */
  label: string;
  /** 소문자 · 슬래시로 고친 레포 기준 경로가 이 중 하나에 맞으면 이 분류다. */
  paths: readonly RegExp[];
}

/**
 * 분류 표 — 순서가 우선순위이자 본문에 서는 차례다(한 파일이 둘에 맞으면 앞의 것: CI 폴더 안의 `*.config.js` 는 CI).
 * AI 는 락파일을 고치지 않는다(공통 규칙) — 락파일이 서 있다는 것 자체가 신호라 맨 앞이다.
 */
export const SCOPE_RULES: readonly ScopeRule[] = [
  {
    kind: "lockfile",
    label: "락파일",
    paths: [
      /(^|\/)(pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?|cargo\.lock|poetry\.lock|pipfile\.lock|uv\.lock|composer\.lock|gemfile\.lock|go\.sum|podfile\.lock)$/,
    ],
  },
  {
    kind: "package",
    label: "의존성 정의",
    paths: [
      /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|cargo\.toml|go\.mod|gemfile|composer\.json)$/,
    ],
  },
  {
    kind: "ci",
    label: "CI · 배포",
    paths: [
      /^\.(github\/(workflows|actions)|circleci)\//,
      /(^|\/)(\.gitlab-ci\.ya?ml|jenkinsfile|azure-pipelines\.ya?ml|bitbucket-pipelines\.ya?ml|\.travis\.ya?ml)$/,
    ],
  },
  {
    kind: "config",
    label: "설정",
    paths: [
      /(^|\/)[^/]*\.config\.[^/]+$/,
      /(^|\/)(ts|js)config[^/]*\.json$/,
      /(^|\/)\.(eslintrc|prettierrc|stylelintrc|babelrc)[^/]*$/,
      /(^|\/)(biome\.jsonc?|\.npmrc|\.nvmrc|\.node-version|\.tool-versions|\.browserslistrc)$/,
      /(^|\/)\.env(rc|\.[^/]+)?$/,
      /(^|\/)dockerfile(\.[^/]+)?$/,
      /(^|\/)(docker-compose[^/]*|compose)\.ya?ml$/,
      /(^|\/)(vercel\.json|netlify\.toml|wrangler\.toml|firebase\.json)$/,
    ],
  },
];

/** 위험 분류의 파일 이름을 한 줄에 늘어놓는 상한 — 넘으면 `외 N개`. */
const SCOPE_PATHS_MAX = 5;
/**
 * numstat 출력이 이 길이에 닿으면 앞이 잘렸을 수 있다 — 데몬의 git 출력 보관 상한(`repo-core` 의 `capture` 가 뒤쪽 100만
 * 글자만 쥔다)과 같은 값. 잘린 목록으로는 「건드리지 않았다」 고 말하지 않는다.
 */
export const NUMSTAT_TRUST_CHARS = 1_000_000;

/** git 이 이름 바꿈을 `a/{b => c}/d` 나 `a => b` 로 적는다 — 분류는 바뀌기 전 · 후의 두 경로를 모두 본다. */
function renameSides(path: string): string[] {
  const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(path);
  if (brace) {
    const [, head = "", from = "", to = "", tail = ""] = brace;
    const side = (middle: string) =>
      `${head}${middle}${tail}`.replace(/\/{2,}/g, "/").replace(/^\//, "");
    return [side(from), side(to)];
  }
  const sides = path.split(" => ");
  return sides.length === 2 ? sides : [path];
}

/** git 은 특수 문자가 든 경로를 따옴표로 싼다 — 싼 따옴표를 벗긴 경로. */
function unquotePath(path: string): string {
  return path.length >= 2 && path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
}

/**
 * 경로 하나(이름 바꿈이면 두 쪽)가 표의 어느 위험 분류에 드는지 — 어디에도 안 들면 null(그 밖). 순수.
 */
export function classifyScopePath(path: string): ScopeRule | null {
  const sides = renameSides(unquotePath(path)).map((side) =>
    side.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase(),
  );
  return (
    SCOPE_RULES.find((rule) => sides.some((side) => rule.paths.some((test) => test.test(side)))) ??
    null
  );
}

/** 범위 판정 — 위험 분류별 파일과 그 밖의 수, 목록을 끝까지 믿을 수 있는지. */
export interface ChangeScope {
  /** 읽은 파일 수. */
  total: number;
  /** 위험 분류별 파일 — 분류 표의 차례, 없는 분류는 빠진다. */
  risky: Array<{ rule: ScopeRule; paths: string[] }>;
  /** 표에 없는 그 밖의 파일 수. */
  other: number;
  /** 목록을 끝까지 믿을 수 있다 — 출력이 잘렸거나 못 읽은 줄이 있으면 false. */
  complete: boolean;
}

/** numstat → 범위 판정. 읽은 파일이 하나도 없으면 null. 순수. */
export function scopeOfNumstat(numstat: string): ChangeScope | null {
  const { rows, unreadable } = readNumstat(numstat);
  if (rows.length === 0) return null;
  const byRule = new Map<ScopeRule, string[]>();
  let other = 0;
  for (const row of rows) {
    const rule = classifyScopePath(row.path);
    if (rule === null) {
      other += 1;
      continue;
    }
    byRule.set(rule, [...(byRule.get(rule) ?? []), unquotePath(row.path)]);
  }
  return {
    total: rows.length,
    risky: SCOPE_RULES.flatMap((rule) => {
      const paths = byRule.get(rule);
      return paths ? [{ rule, paths }] : [];
    }),
    other,
    complete: unreadable === 0 && numstat.length < NUMSTAT_TRUST_CHARS,
  };
}

/**
 * `### 범위` 절 — 위험 분류(의존성 · 락파일 · 설정 · CI)가 하나라도 있으면 머리줄에 ⚠ 를 세우고 그 파일 이름만 늘어놓는다.
 * 하나도 없으면 「의존성 · 설정 · CI 파일은 건드리지 않았습니다」 한 줄 — 개발자가 안심하는 근거라 가장 값진 문장이다.
 * 단 목록이 잘렸거나 못 읽은 줄이 있으면 그 말을 하지 않고 확인하지 못했다고 말한다. 내용은 읽지 않았으므로
 * `package.json` 은 어느 항목이 바뀌었는지 모른다고 밝힌다. 미리보기와 실제 본문이 같은 numstat 과 같은 빌더를 지난다.
 */
export function buildScopeSection(numstat: string, maxPaths = SCOPE_PATHS_MAX): string | null {
  const scope = scopeOfNumstat(numstat);
  if (scope === null) return null;
  const riskyCount = scope.risky.reduce((sum, group) => sum + group.paths.length, 0);
  const lines = scope.risky.map(({ rule, paths }) => {
    const names = paths.slice(0, maxPaths).join(", ");
    const more = paths.length > maxPaths ? ` 외 ${paths.length - maxPaths}개` : "";
    const note = rule.kind === "package" ? " (어느 항목이 바뀌었는지는 확인하지 않았습니다)" : "";
    return `- ⚠ ${rule.label} ${paths.length}개 — ${names}${more}${note}`;
  });
  let lead: string;
  if (riskyCount > 0) {
    lead = `⚠ 이번 변경의 범위 — 의존성 · 설정 · CI 파일이 바뀌었습니다 (파일 ${scope.total}개 중 ${riskyCount}개)`;
    if (scope.other > 0) lines.push(`- 그 밖의 파일 ${scope.other}개`);
    if (!scope.complete) lines.push("- 파일 목록을 끝까지 읽지 못해 이보다 더 있을 수 있습니다");
  } else if (scope.complete) {
    lead = `이번 변경의 범위 — 파일 ${scope.total}개`;
    lines.push("- 의존성 · 설정 · CI 파일은 건드리지 않았습니다");
  } else {
    lead = `이번 변경의 범위 — 읽은 파일 ${scope.total}개`;
    lines.push("- 의존성 · 설정 · CI 파일은 잘려서 확인하지 못했습니다");
  }
  return `### 범위\n\n${lead}\n\n${lines.join("\n")}\n`;
}

/** 도구가 이름을 아는 AI — 공급자 id → 개발자가 읽는 이름. 여기 없는 공급자는 이름 없이 AI 로만 말한다. */
const AI_NAMES: ReadonlyMap<string, string> = new Map([
  ["claude", "Claude Code"],
  ["codex", "Codex"],
]);

/**
 * 이번 제출에 담긴 화면 작업(보관)을 쓴 AI 의 종류(2026-10-07 베타 준비 분석) — 지도 행이 보관 때 적은 공급자다. 작업 하나라도
 * 공급자를 모르거나 이름을 모르는 공급자면 종류를 말하지 않는다(빈 목록) — 일부만 아는 채로 「Claude Code 가 썼다」 고
 * 말하지 않는다. 한 작업은 보관 하나(`sha`)다. 되돌리기 · 병합은 도구가 한 일이라 세지 않는다 — 코멘트 반영은 AI 가 쓴
 * 코드라 센다(`summarizeChecks` 와 다르다: 그쪽은 사용자의 화면 작업만 센다). 이름은 알파벳순이라 제출마다 같은 글이다.
 */
export function aiKindsOf(
  screens: ReadonlyArray<{ sha?: string; kind?: string; provider?: string }>,
): string[] {
  const works = new Map<string, string | undefined>();
  for (const screen of screens) {
    if (!screen.sha || screen.kind === "merge" || screen.kind === "restore") continue;
    if (!works.has(screen.sha)) works.set(screen.sha, screen.provider);
  }
  const names: string[] = [];
  for (const provider of works.values()) {
    const name = typeof provider === "string" ? AI_NAMES.get(provider) : undefined;
    if (name === undefined) return [];
    if (!names.includes(name)) names.push(name);
  }
  return names.sort();
}

/**
 * 「코드는 AI 가 썼습니다」 줄 — 개발자가 리뷰의 강도를 정하는 근거다. 사실만 말한다: 코드는 AI 가 썼고, 요청한 사람은
 * 코드가 아니라 화면으로 확인했다. 종류를 알면(`aiKindsOf`) 이름을 싣고, 모르면 이름 없이 AI 로만 말한다.
 */
export function buildAiLine(kinds: readonly string[] = []): string {
  const who = kinds.length > 0 ? `AI(${kinds.join(" · ")})가` : "AI 가";
  return `코드는 ${who} 썼고, 요청한 사람은 코드가 아니라 화면으로 확인했습니다.`;
}

/**
 * 이번 제출에 담긴 화면 작업(보관)마다의 자동 확인 기록을 센다(2026-10-07 UX 점검 3단계). 한 작업은 지도의 보관 하나
 * (`sha`)다 — 한 보관이 여러 화면을 고쳐도 하나로 센다. 되돌리기 · 병합 · 코멘트 반영(`kind`)은 사용자의 화면
 * 작업이 아니라 세지 않는다. 확인이 문제 없이 지난 작업만 기록이 있으므로, 기록이 하나도 없으면 null — 하지 않은
 * 확인을 말하지 않는다.
 */
export function summarizeChecks(
  screens: ReadonlyArray<{ sha?: string; kind?: string; checked?: GateChecked }>,
): HandoffChecks | null {
  const rows = new Map<string, GateChecked | null>();
  for (const screen of screens) {
    if (!screen.sha || screen.kind) continue;
    if (!rows.has(screen.sha)) rows.set(screen.sha, screen.checked ?? null);
  }
  const passed = [...rows.values()].filter((checked): checked is GateChecked => checked !== null);
  if (passed.length === 0) return null;
  // 타입 검사가 돌고 오류가 없었던 작업의 수(2026-10-07 베타 준비 분석) — 하나도 없으면 칸이 없다.
  const types = passed.filter((checked) => checked.types === true).length;
  return {
    total: rows.size,
    checked: passed.length,
    phone: passed.every((checked) => checked.phone),
    ...(types > 0 ? { types } : {}),
  };
}

/**
 * `### 확인한 것` 절 — 개발자가 이 화면 작업을 얼마나 믿어도 되는지 읽는 한 단락. 도구가 한 것(다시 열어 본 것)만 말하고,
 * 하지 않은 것(레포의 검사 · 빌드)은 하지 않았다고 말한다. 접근성 · 대비는 지난번에 본 문제를 다시 말하지 않으므로
 * 「새로 찾은 문제가 없었다」 고만 한다. 화면 이름 · 요소 · 경로는 쓰지 않는다(D38) — 숫자뿐이다. 타입 검사는 게이트가
 * 돌린 작업(`types`)만 한 줄로 센다 — 도구가 이 턴이 바꾼 TypeScript 파일에서 센 오류이지 레포 전체의 검사가 아니다.
 */
export function buildChecksSection(checks: HandoffChecks): string {
  const count =
    checks.checked >= checks.total
      ? `이번 제출에 담긴 화면 작업 ${checks.total}건 모두`
      : `이번 제출에 담긴 화면 작업 ${checks.total}건 중 ${checks.checked}건`;
  const kinds = [
    "콘솔 오류",
    "실패한 요청",
    "이름 없는 컨트롤",
    "너무 흐린 글자",
    ...(checks.phone ? ["휴대폰 폭의 가로 넘침"] : []),
  ].join(" · ");
  const rest =
    checks.checked < checks.total
      ? ` 나머지 ${checks.total - checks.checked}건은 확인 기록이 없습니다.`
      : "";
  // 타입 검사 한 줄(2026-10-07 베타 준비 분석) — 이 턴이 바꾼 TypeScript 파일에서만 센 오류다. 돌지 않은 작업은 기록이 없다고
  // 말하고, 하나도 돌지 않았으면 줄이 없다(돌리지 않은 검사를 통과라고 말하지 않는다).
  const typed = Math.min(checks.types ?? 0, checks.total);
  const types =
    typed > 0
      ? [
          typed >= checks.total
            ? `타입 검사: 이번 제출에 담긴 화면 작업 ${checks.total}건 모두에서 바뀐 TypeScript 파일의 타입 오류가 없었습니다.`
            : `타입 검사: 이번 제출에 담긴 화면 작업 ${checks.total}건 중 ${typed}건에서 바뀐 TypeScript 파일의 타입 오류가 없었습니다. 나머지 ${checks.total - typed}건은 검사 기록이 없습니다.`,
          "",
        ]
      : [];
  return [
    "### 확인한 것",
    "",
    `AI 가 작업을 끝낼 때마다 도구가 바뀐 화면을 다시 열어 봅니다. ${count}에서 확인이 문제 없이 지나갔습니다 — 화면이 끝까지 열렸고, ${kinds}에서 새로 찾은 문제가 없었습니다.${rest}`,
    "",
    ...types,
    "레포의 검사(check)와 빌드는 이 확인에 들어 있지 않습니다.",
    "",
  ].join("\n");
}

/** PR 본문에서 도구의 구간을 표시하는 말뭉치 (PLAN L6) — 이 안이 도구의
 *  것이고 바깥은 개발자의 것이다. */
export const TOOL_BLOCK_START = "<!-- colonova-design:start -->";
export const TOOL_BLOCK_END = "<!-- colonova-design:end -->";

/**
 * PR 본문의 도구 구간만 갱신한다 (PLAN L6) — 순수 함수.
 *
 * 구간이 없으면 본문 끝에 붙이고, 있으면 첫 구간의 내용만 바꾸고, 둘 이상이면
 * 첫 구간만 남기고 나머지는 지운다(옛 버전의 흔적). 구간 밖의 글은 개발자의
 * 것이므로 어떤 경우에도 그대로 둔다 — 다시 제출이 개발자가 쓴 본문을 덮어
 * 쓰는 일가지가 이 함수로 막힌다.
 */
export function mergeToolBlock(existing: string | null, block: string): string {
  const base = existing ?? "";
  // 이미 표식으로 싸인 구간(handoffToolBlock 의 결과)은 다시 싸지 않는다 —
  // 두 겹이 되면 갱신마다 짝 잃은 끝 표식이 본문에 하나씩 쌓인다.
  const inner = block.replace(/\n+$/, "");
  const wrapped =
    inner.startsWith(TOOL_BLOCK_START) && inner.endsWith(TOOL_BLOCK_END)
      ? inner
      : `${TOOL_BLOCK_START}\n${inner}\n${TOOL_BLOCK_END}`;
  const pattern = new RegExp(
    `${escapeRegExp(TOOL_BLOCK_START)}[\\s\\S]*?${escapeRegExp(TOOL_BLOCK_END)}\\s*`,
    "g",
  );
  const found = base.match(pattern);
  if (found === null) {
    // 구간이 없다 — 개발자의 글 뒤에 붙인다. 빈 본문이면 안내 문단 없이
    // 구간만 선다.
    return base.trim() === "" ? wrapped : `${base.replace(/\n+$/, "")}\n\n${wrapped}`;
  }
  // 첫 구간만 새 것으로 바꾸고 나머지는 지운다. 끝의 여백은 다듬는다 —
  // 갱신을 거듭할 때마다 빈 줄이 쌓이면 멱등이 아니다 (I5).
  let first = true;
  return base
    .replace(pattern, () => {
      if (first) {
        first = false;
        return `${wrapped}\n\n`;
      }
      return "";
    })
    .replace(/\s+$/, "");
}
/** 한마디 줄의 머리 — 요청 본문에서 작성자 줄 바로 아래에 선다(PLAN-UI P3). */
const NOTE_PREFIX = "> 한마디: ";

/**
 * 제출 확인의 `개발자에게 한마디`(PLAN-UI U3)를 본문의 인용 줄로 — 순수 함수.
 * 여러 줄이면 줄마다 `> ` 를 이어 한 인용 안에 둔다. 도구 구간의 표식처럼 읽힐
 * 수 있는 HTML 주석은 무르게 만든다 — 사용자의 말이 구간을 끊으면 다음 갱신이
 * 개발자의 글을 지운다. 빈 말은 null(줄이 서지 않는다).
 */
export function noteLine(note: string | null | undefined): string | null {
  const lines = (note ?? "")
    .replace(/<!--/g, "<!—")
    .replace(/-->/g, "—>")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length === 0) return null;
  return lines
    .map((line, index) => (index === 0 ? `${NOTE_PREFIX}${line}` : `> ${line}`))
    .join("\n");
}

/**
 * 열린 요청 본문의 도구 구간에서 지난 한마디를 되읽는다 — 한마디 없이 다시
 * 제출할 때 그 말을 잃지 않게. 없으면 null.
 */
export function readToolNote(body: string | null): string | null {
  const text = body ?? "";
  const start = text.indexOf(TOOL_BLOCK_START);
  if (start === -1) return null;
  const end = text.indexOf(TOOL_BLOCK_END, start);
  const lines = text.slice(start, end === -1 ? undefined : end).split(/\r?\n/);
  const first = lines.findIndex((line) => line.startsWith(NOTE_PREFIX));
  if (first === -1) return null;
  const out = [lines[first]?.slice(NOTE_PREFIX.length) ?? ""];
  for (const line of lines.slice(first + 1)) {
    if (!line.startsWith("> ")) break;
    out.push(line.slice(2));
  }
  const note = out.join("\n").trim();
  return note === "" ? null : note;
}

/** 정규식 특수문자를 피한다 — 표식은 고정 문장이지만 이스케이프가 재사용을
 *  안전하게 만든다. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * PR 제목은 생성할 때만 정한다 (PLAN L6) — 순수 함수. 초안(handoffDraft 의
 * 8초 안에 나온 제목)이 없으면 첫 커밋 제목, 그마저 없으면 도구의 기본
 * 제목을 쓴다. 모든 자동 제목은 같은 형식이다. 입양 · 다시 제출에서는 이 함수를
 * 부르지 않는다 — 제목은 개발자의 것이다.
 */
export function pickHandoffTitle(input: {
  draftTitle: string | null;
  firstCommitSubject: string | null;
  fallback: string;
  authorName?: string | null;
}): string {
  const draft = input.draftTitle?.trim();
  const subject = input.firstCommitSubject?.trim();
  return formatHandoffTitle(draft || subject || input.fallback, input.authorName);
}

/** 형식 없는 초안 · 폴백은 타입을 추측하지 않고 chore로 둔다. */
export function formatHandoffTitle(title: string, authorName?: string | null): string {
  const line =
    title
      .split(/\r?\n/)
      .find((part) => part.trim() !== "")
      ?.trim() ?? "";
  const conventional = /^(feat|fix|refactor|style|docs|test|chore)(\([^()\r\n]+\))?!?:\s*\S/.test(
    line,
  );
  // 2026-10-06 사용자 요청: 작성자는 도구가 붙인다. 긴 이름도 변경 제목의 자리를 남긴다.
  const author = Array.from((authorName ?? "").replace(/\s+/g, " ").trim());
  const name = author.length > 32 ? `${author.slice(0, 31).join("")}…` : author.join("");
  const suffix = name ? ` (작성: ${name})` : "";
  return (
    Array.from(conventional ? line : `chore: ${line}`)
      .slice(0, HANDOFF_TITLE_MAX_CHARS - Array.from(suffix).length)
      .join("")
      .trimEnd() + suffix
  );
}

/** 사용자의 말로 다시 읽은 요청 제목의 상한 (2026-10-08 베타 준비 분석 · A2b) — 성취 카드와 `반영된 일` 의 제목이다. */
export const PLAIN_TITLE_MAX_CHARS = 80;

/** `formatHandoffTitle` 이 알아보는 일곱 종류 접두어와 같다. */
const TITLE_KIND_PREFIX = /^(feat|fix|refactor|style|docs|test|chore)(\([^()\r\n]+\))?!?:\s*/;
/** `formatHandoffTitle` 이 끝에 붙이는 작성자 꼬리 ` (작성: 이름)`. */
const TITLE_AUTHOR_TAIL = /\s*\(작성:[^)\r\n]*\)\s*$/;

/**
 * 요청 제목에서 도구가 붙인 종류 접두어(`feat(scope): `)와 작성자 꼬리(` (작성: 이름)`)를 뗀 사용자의 말 —
 * `formatHandoffTitle` 의 거울이다(웹 `previewTitle` 과 같은 규칙). 첫 의미 줄만 쓰고 공백은 한 칸으로 접으며
 * `PLAIN_TITLE_MAX_CHARS` 에서 말줄임으로 닫는다. 읽을 말이 없으면 null. 순수 함수 — 병합 기록의 제목이 이 말이다.
 */
export function plainHandoffTitle(raw: string | null | undefined): string | null {
  const line =
    (raw ?? "")
      .split(/\r?\n/)
      .find((part) => part.trim() !== "")
      ?.trim() ?? "";
  const plain = line
    .replace(TITLE_AUTHOR_TAIL, "")
    .replace(TITLE_KIND_PREFIX, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain === "") return null;
  const chars = Array.from(plain);
  if (chars.length <= PLAIN_TITLE_MAX_CHARS) return plain;
  return `${chars
    .slice(0, PLAIN_TITLE_MAX_CHARS - 1)
    .join("")
    .trimEnd()}…`;
}
