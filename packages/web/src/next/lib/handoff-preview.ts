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
  /** AI 가 쓴 설명의 첫 대목 — 마크다운 기호를 걷은 한 덩이. 없으면 null. */
  summary: string | null;
  /** 함께 가는 화면 사진의 수. */
  photos: number;
  /** 함께 가는 자동 확인 결과 — 화면 작업 몇 건 중 몇 건의 확인이 문제 없이 지났는가. 기록이 없으면 null. */
  checks: { total: number; checked: number } | null;
  /** 글의 주인 — `ai` 는 AI 가 쓴 제목 · 설명, `request` 는 AI 가 못 써서 처음 한 말이 제목이 된 것. */
  by: "ai" | "request";
}

/** 데몬이 제목에 붙이는 종류 접두어 — `formatHandoffTitle` 이 알아보는 것과 같은 일곱이다. */
const KIND_PREFIX = /^(feat|fix|refactor|style|docs|test|chore)(\([^()\r\n]+\))?!?:\s*/;
/**
 * 데몬이 제목 끝에 붙이는 작성자 꼬리 ` (작성: 이름)`. 한글 리터럴 린트가 정규식을 읽지 못하고 따옴표 · 역따옴표를
 * 문자열의 시작으로 오해하므로, `작성` 은 `\uC791\uC131` 으로, 역따옴표는 `\u0060` 으로 적는다.
 */
const AUTHOR_TAIL = /\s*\(\uC791\uC131:[^)\r\n]*\)\s*$/;
/** 설명을 한 덩이로 보이는 글자 수의 상한 — 넘으면 말줄임으로 닫는다. */
export const SUMMARY_MAX_CHARS = 220;

/**
 * 제목의 종류 접두어(`feat(members): `)와 작성자 꼬리(` (작성: 이름)`)를 뗀다 — 두 가지 모두 개발자 쪽 형식이고
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
 * 설명의 첫 문단을 한 덩이 글로 — 목록 기호 · 제목 기호 · 강조 · 코드 따옴표 · 링크 주소를 걷는다. 항목만 있는
 * 문단은 항목을 이어 붙인다. 읽을 글이 없으면 null.
 */
export function previewSummary(body: string): string | null {
  const first = body
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .find((paragraph) => paragraph !== "");
  if (first === undefined) return null;
  const plain = first
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").replace(/^\s*#+\s*/, ""))
    .join(" ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\u0060([^\u0060]*)\u0060/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (plain === "") return null;
  const chars = Array.from(plain);
  if (chars.length <= SUMMARY_MAX_CHARS) return plain;
  const cut = chars
    .slice(0, SUMMARY_MAX_CHARS - 1)
    .join("")
    .trimEnd();
  return `${cut}…`;
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
  };
}
