import type { RepoHandoffDraft } from "@colonova-design/protocol";

/**
 * 제출 확인의 「개발자에게는 이렇게 보여요」(2026-10-07 UX 점검 3단계) — 데몬이 요청을 처음 열 때 쓰는 초안(제목 ·
 * 설명)을 사용자의 말로 다시 읽는다. 개발자가 보는 글은 AI 가 쓰고 사용자는 고칠 길이 `한마디` 뿐이라, 보내기 전에
 * 무엇이 어떻게 적히는지를 먼저 보여 틀린 곳이 있으면 한마디로 바로잡게 한다.
 *
 * 순수 함수만 산다 — 단위 시험이 src 에서 곧장 읽는다(형제 모듈을 부르지 않는다). 문장은 부르는 쪽(`labels.ts`)의 것이다.
 */

export interface HandoffPreview {
  /** 개발자가 처음 읽는 한 줄 — 종류 접두어와 작성자 꼬리를 뗀 문장. */
  title: string;
  /** AI 가 쓴 설명에서 사람이 읽을 첫 대목 — 마크다운 기호를 걷은 한 덩이. 없으면 null. */
  summary: string | null;
  /** 함께 가는 화면 사진의 수. */
  photos: number;
  /** 함께 가는 자동 확인 결과 — 화면 작업 몇 건 중 몇 건의 확인이 문제 없이 지났는가. 기록이 없으면 null. */
  checks: { total: number; checked: number } | null;
  /** 글의 주인 — `ai` 는 AI 가 쓴 제목 · 설명, `request` 는 AI 가 못 써서 처음 한 말이 제목이 된 것. */
  by: "ai" | "request";
  /**
   * 개발자가 받는 본문의 범위가 의존성 · 락파일 · 설정 · CI 파일을 포함한다(2026-10-07 베타 준비 분석) — 사용자는 그 말을
   * 몰라도 되지만 숨기지는 않는다. 아니면 칸이 없다.
   */
  scopeRisk?: boolean;
}

/**
 * 데몬이 제목에 붙이는 종류 접두어 — 조직 commitlint 의 일곱 종류(2026-10-13 · feat · fix · refactor ·
 * style · docs · test · chore)에 옛 제목이 쓰던 perf · build · ci 를 더한 읽기용 목록이다. 읽는 쪽은 너그럽다.
 */
const KIND_PREFIX =
  /^(feat|fix|perf|refactor|style|docs|test|build|ci|chore)(\([^()\r\n]+\))?!?:\s*/;
/**
 * 데몬이 제목 끝에 붙이는 작성자 꼬리 ` (작성자: 이름)`. 옛 표기 ` (작성: 이름)` 도 읽는다. 한글 리터럴 린트는 src 의
 * 한글 글자와 따옴표 · 역따옴표를 보고, 유니코드 이스케이프는 biome 이 글자로 되돌리므로(2026-10-13), 한글 낱말과
 * 역따옴표는 코드 번호로 만든다.
 */
const AUTHOR_LABEL = String.fromCharCode(0xc791, 0xc131);
const AUTHOR_JA = String.fromCharCode(0xc790);
const AUTHOR_TAIL = new RegExp(`\\s*\\(${AUTHOR_LABEL}(?:${AUTHOR_JA})?:[^)\\r\\n]*\\)\\s*$`);
/** 설명을 한 덩이로 보이는 글자 수의 상한 — 넘으면 말줄임으로 닫는다. */
export const SUMMARY_MAX_CHARS = 220;
/** 코드 따옴표(역따옴표) 한 쌍 — 위와 같은 이유로 코드 번호로 만든다. */
const BACKTICK = String.fromCharCode(96);
const CODE_SPAN = new RegExp(`${BACKTICK}([^${BACKTICK}]*)${BACKTICK}`, "g");
/** 제목 줄 — `## Context` 처럼 머리만 있는 줄은 글이 아니다. */
const HEADING_LINE = /^\s*#+(\s|$)/;
/** 레포 템플릿의 링크 자리 — `Jira: -` · `Figma:` 처럼 라벨만 있는 줄은 글이 아니다(2026-10-13 조직 템플릿 대응). */
const SLOT_LINE = /^[^:：]{1,24}[:：]\s*-?\s*$/;

/**
 * 제목의 종류 접두어(`feat(members): `)와 작성자 꼬리(` (작성자: 이름)`)를 뗀다 — 두 가지 모두 개발자 쪽 형식이고
 * 사용자가 읽는 것은 문장이다. 첫 의미 줄만 쓴다.
 */
export function previewTitle(raw: string): string {
  const line =
    raw
      .split(/\r?\n/)
      .find((part) => part.trim() !== "")
      ?.trim() ?? "";
  return line.replace(AUTHOR_TAIL, "").replace(KIND_PREFIX, "").trim();
}

/**
 * 설명에서 사람이 읽을 첫 문단을 한 덩이 글로 — 목록 기호 · 강조 · 코드 따옴표 · 링크 주소를 걷는다. 제목 줄과
 * 라벨만 있는 줄(레포 템플릿의 링크 자리)과 HTML 주석은 글이 아니라 건너뛰고(2026-10-13: 초안이 레포의 PR 템플릿을
 * 채우면서 첫 문단이 `## Context` 와 `Jira: -` 가 됐다), 항목만 있는 문단은 항목을 이어 붙인다. 읽을 글이 없으면 null.
 */
export function previewSummary(body: string): string | null {
  const paragraphs = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
  for (const paragraph of paragraphs) {
    const plain = paragraph
      .split(/\r?\n/)
      .filter((line) => !HEADING_LINE.test(line))
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""))
      .filter((line) => !SLOT_LINE.test(line.trim()))
      .join(" ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\*\*([^*]*)\*\*/g, "$1")
      .replace(CODE_SPAN, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (plain === "") continue;
    const chars = Array.from(plain);
    if (chars.length <= SUMMARY_MAX_CHARS) return plain;
    const cut = chars
      .slice(0, SUMMARY_MAX_CHARS - 1)
      .join("")
      .trimEnd();
    return `${cut}…`;
  }
  return null;
}

/** 사이클의 첫 보관 제목 — 기록은 새것부터라 맨 끝이 첫 것이다. 데몬의 제목 고르기(`pickHandoffTitle`)와 같은 자리. */
export function firstSubjectOf(entries: ReadonlyArray<{ message: string }>): string | null {
  const first = entries.at(-1)?.message;
  if (first === undefined) return null;
  return (
    first
      .split(/\r?\n/)
      .find((line) => line.trim() !== "")
      ?.trim() ?? null
  );
}

/**
 * 초안에서 사용자가 읽는 모습을 뽑는다. AI 가 제목을 못 낸 초안(`title` 이 빔)은 데몬이 첫 보관의 제목을 대신
 * 쓰므로 같은 대신을 쓴다. 보여 줄 글이 하나도 없으면 null — 빈 상자를 세우지 않는다.
 */
export function handoffPreviewOf(
  draft: Pick<RepoHandoffDraft, "title" | "body" | "extras">,
  firstSubject: string | null,
): HandoffPreview | null {
  const drafted = previewTitle(draft.title);
  const title = drafted || previewTitle(firstSubject ?? "");
  const summary = previewSummary(draft.body);
  if (title === "" && summary === null) return null;
  const checks = draft.extras?.checks;
  return {
    title,
    summary,
    photos: draft.extras?.shotCount ?? 0,
    checks: checks ? { total: checks.total, checked: checks.checked } : null,
    by: drafted !== "" || summary !== null ? "ai" : "request",
    ...(draft.extras?.scopeRisk ? { scopeRisk: true } : {}),
  };
}
