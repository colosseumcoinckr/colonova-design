/**
 * 턴의 보관 계획 — 일하는 AI 가 `describe_changes` 도구로 적는 논리적 변경의
 * 목록이다(2026-10-11 피드백: 보관이 턴 하나짜리 뭉치라 개발자가 받는 요청의
 * 커밋이 읽히지 않는다). 저장 때 이 계획대로 승인된 파일을 나눠 커밋하므로
 * 커밋이 변경 단위가 되고, 제목도 요청 문장의 첫 줄이 아니라 바뀐 결과를 말하는
 * 한 줄이 된다. 데몬은 계획을 집행할 뿐 문장을 지어내지 않는다 — 모델 턴을
 * 하나 더 돌리면 턴마다 구독이 두 배로 탄다(자동 보관의 원칙, PLAN P2-1).
 *
 * 순수 모듈 — 와이어의 날것을 여기서 정리하고(normalizeDescribeChanges),
 * 승인된 경로를 변경마다 가른다(partitionApproved). 계획이 없거나 못 쓰면
 * 저장은 종전의 한 커밋으로 흘러가므로, 도구를 부르지 않은 턴도 잃는 것이 없다.
 */

/**
 * 커밋 종류 — 조직 레포의 commitlint `type-enum`(feat · refactor · fix · test · docs · chore · style ·
 * revert · hotfix: 2026-10-13 조직 레포 분석, 프론트 레포 7곳이 같은 목록)에서 사람만 쓰는 revert · hotfix 를
 * 뺀 것. scope 괄호는 티켓 자리라 AI 가 지어내지 않는다(Jira 는 사용자 결정으로 제외).
 */
export const COMMIT_KINDS = ["feat", "fix", "refactor", "style", "docs", "test", "chore"] as const;

export type CommitKind = (typeof COMMIT_KINDS)[number];

/** 계획의 변경 하나 — 커밋 하나가 된다. */
export interface PlannedChange {
  kind: CommitKind;
  /** 바뀐 결과 — 명사형으로 끝맺은 한 줄. */
  subject: string;
  /** 왜 바꿨는지 한두 문장(선택) — 커밋 본문. 한 줄 50자에서 도구가 나눈다. */
  body?: string;
  /** 이 변경에 담일 경로 — 클론 루트 기준. 폴더면 그 아래 전부. */
  files: string[];
}

/** 계획의 변경 수 상한 — 한 턴의 논리적 변경이 이보다 많다는 말은 계획이 틀렸다는 뜻이다. */
export const PLAN_MAX_CHANGES = 10;
/** 커밋 제목의 길이 상한 — 저장 메모(80자)와 같은 어울림의 72자(조직 관습은 40자 안팎, 설명이 권한다). */
export const PLAN_SUBJECT_MAX_CHARS = 72;
/** 커밋 본문의 길이 상한 — 왜를 말하는 한두 문장이면 충분하다(조직 규칙: 두 줄을 넘는 설명은 PR 본문의 몫). */
export const PLAN_BODY_MAX_CHARS = 300;
/** 커밋 본문 한 줄의 상한 — 조직 프론트 레포의 commitlint `body-max-line-length: 50`(코드 유닛 기준, 2026-10-13). */
export const PLAN_BODY_LINE_MAX = 50;

/** 커밋 종류의 자리표 — `BROWSER_OPS` 의 같은 모양이다. */
const KIND_BY_NAME: Record<string, true> = Object.fromEntries(
  COMMIT_KINDS.map((kind) => [kind, true as const]),
);
/** AI 가 어쨌든 붙여 보낸 접두 — 종류는 데몬이 kind 로 다시 붙이므로 벗긴다. */
const KIND_PREFIX = /^[a-z]+(\([^()]*\))?!?:\s*/i;
/** 사람이 쓰는 소속 표식은 커밋에 옮기지 않는다 — 쓴이는 커밋의 작성자다. */
const TRAILER_PREFIX = /^(co-authored-by|signed-off-by)\s*:/i;

/** 경로 하나를 클론 기준 비교형으로 — 역슬래시 · 앞의 `./` · `/` · 끝의 `/` 를 벗긴다. */
function normalizePath(raw: string): string | null {
  let path = raw.trim().replace(/\\/g, "/");
  while (path.startsWith("./")) path = path.slice(2);
  while (path.startsWith("/")) path = path.slice(1);
  path = path.replace(/\/+$/, "");
  return path === "" ? null : path;
}

/** 제목 한 줄로 — 첫 줄만, 따옴표 · 매듭 기호 · 이미 붙은 접두를 벗기고 72자에서 닫는다. */
function cleanSubject(raw: string): string {
  const first = raw.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
  let subject = first
    .replace(/^[-·•*#>\s]+/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  const prefixed = KIND_PREFIX.exec(subject);
  if (prefixed && KIND_BY_NAME[prefixed[0].split(/[(:!]/)[0]?.toLowerCase() ?? ""] === true) {
    subject = subject.slice(prefixed[0].length).trim();
  }
  subject = subject
    // 조직 글쓰기 규칙(2026-10-13): 제목 뒤 설명의 줄표는 콜론이다. 낱말 사이의 줄표만 — 숫자 범위(1–3)는 그대로.
    .replace(/\s+[—–]\s+/g, ": ")
    .replace(/\s+/g, " ")
    .replace(/[.。]+$/, "")
    .trim();
  const chars = Array.from(subject);
  return (
    chars.length <= PLAN_SUBJECT_MAX_CHARS
      ? subject
      : chars.slice(0, PLAN_SUBJECT_MAX_CHARS).join("")
  ).trim();
}

/** 본문 한 단락으로 — 소속 표식 줄은 버리고 300자에서 닫은 뒤, 한 줄을 50자(코드 유닛)에서 띄어쓰기 자리로 나눈다. */
function cleanBody(raw: string): string | null {
  const body = raw
    .split(/\r?\n/)
    .filter((line) => !TRAILER_PREFIX.test(line.trim()))
    .join("\n")
    .trim()
    .slice(0, PLAN_BODY_MAX_CHARS)
    .trimEnd();
  if (body === "") return null;
  return body
    .split("\n")
    .flatMap((line) => wrapLine(line.trim(), PLAN_BODY_LINE_MAX))
    .join("\n");
}

/**
 * 한 줄을 `max` 코드 유닛 안으로 — commitlint 가 세는 단위(`.length`)와 같다. 띄어쓰기 자리에서만 나누고,
 * 그보다 긴 낱말 하나는 그대로 둔다(끊긴 낱말은 50자 위반보다 읽기 나쁘다). 빈 줄은 빈 줄로 남는다.
 */
export function wrapLine(line: string, max: number): string[] {
  if (line.length <= max) return [line];
  const out: string[] = [];
  let current = "";
  for (const word of line.split(/\s+/)) {
    if (word === "") continue;
    if (current === "") current = word;
    else if (`${current} ${word}`.length > max) {
      out.push(current);
      current = word;
    } else current = `${current} ${word}`;
  }
  if (current !== "") out.push(current);
  return out;
}

/**
 * 도구 인자의 날것을 계획으로 — 못 쓴 변경은 버리고(도구 결과가 그 사실을 말한다)
 * 하나도 남지 않으면 빈 목록을 내려 저장이 종전의 한 커밋으로 흐르게 한다.
 */
export function normalizeDescribeChanges(
  input: unknown,
): { ok: true; changes: PlannedChange[] } | { ok: false; error: string } {
  const raw = (input ?? {}) as { changes?: unknown };
  if (!Array.isArray(raw.changes)) {
    return { ok: false, error: "changes 는 변경의 목록(배열)이어야 합니다." };
  }
  const changes: PlannedChange[] = [];
  for (const entry of raw.changes.slice(0, PLAN_MAX_CHANGES)) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as { kind?: unknown; subject?: unknown; body?: unknown; files?: unknown };
    const subject = typeof item.subject === "string" ? cleanSubject(item.subject) : "";
    const files = Array.isArray(item.files)
      ? [
          ...new Set(
            item.files
              .filter((path): path is string => typeof path === "string")
              .map(normalizePath)
              .filter((path): path is string => path !== null),
          ),
        ]
      : [];
    if (subject === "" || files.length === 0) continue;
    const kindRaw = typeof item.kind === "string" ? item.kind.trim().toLowerCase() : "";
    const change: PlannedChange = {
      kind: KIND_BY_NAME[kindRaw] === true ? (kindRaw as CommitKind) : "chore",
      subject,
      files,
    };
    const body = typeof item.body === "string" ? cleanBody(item.body) : null;
    if (body !== null) change.body = body;
    changes.push(change);
  }
  return { ok: true, changes };
}

/** 커밋 메시지 — 제목(`kind: 제목`)과, 있으면 한 줄 띄운 본문. */
export interface CommitGroup {
  /** 커밋 제목 줄 — `cycle.saved` 사건과 상태의 `message` 도 이것이다. */
  subject: string;
  /** `git commit -m` 에 그대로 가는 온전한 메시지. */
  message: string;
  /** 이 커밋에 담을 승인된 경로. */
  paths: string[];
}

/**
 * 승인된 경로를 계획대로 나눈다 — 변경이 적은 순서대로 경로를 가져가고(첫 판이
 * 이긴다), 계획에 없던 경로는 leftover 로 돌아가 폴백 커밋 하나에 담긴다.
 * 계획이 없으면 groups 는 비고 전부가 leftover 다 — 저장은 종전대로 한 커밋이다.
 */
export function partitionApproved(
  approved: readonly string[],
  plan: readonly PlannedChange[] | null,
): { groups: CommitGroup[]; leftover: string[] } {
  if (!plan || plan.length === 0) return { groups: [], leftover: [...approved] };
  const pool = [...approved];
  const groups: CommitGroup[] = [];
  for (const change of plan) {
    const roots = [
      ...new Set(change.files.map((file) => file.replace(/\/+$/, "")).filter(Boolean)),
    ];
    const paths = pool.filter((path) =>
      roots.some((root) => path === root || path.startsWith(`${root}/`)),
    );
    if (paths.length === 0) continue;
    for (const path of paths) pool.splice(pool.indexOf(path), 1);
    const subject = `${change.kind}: ${change.subject}`;
    groups.push({
      subject,
      message: change.body ? `${subject}\n\n${change.body}` : subject,
      paths,
    });
  }
  return { groups, leftover: pool };
}
