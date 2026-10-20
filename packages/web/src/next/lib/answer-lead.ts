/**
 * 답의 머리 문장(2026-10-20 사용자 요청 — 답이 눈에 잘 들어오고 읽기 편하게).
 *
 * AI 의 답은 공통 규칙대로 「무엇이 달라졌는지」 한 문장으로 열고 그 아래 자세한 말을
 * 잇는다. 그 첫 문단이 짧고(한두 줄) 뒤에 더 할 말이 있을 때만 머리 문장으로 세워
 * 글자를 조금 키운다 — 한 줄짜리 답은 그대로 두고(키울 이유가 없다), 첫 문단이 길면
 * 본문의 하나다(긴 글을 통째로 키우면 오히려 무겁다).
 *
 * 흐르는 동안에는 첫 문단 뒤에 빈 줄과 다음 글이 올라온 순간 한 번만 바뀐다 — 그 전엔
 * 아직 뒤가 있는지 모르니 보통 글이다.
 */

/** 머리 문장의 길이 상한(글자 수) — 15px 한국어로 대화 칸 두 줄쯤. */
export const LEAD_MAX_CHARS = 90;

/** 문단이 아니라 다른 블록(머리 · 목록 · 인용 · 표 · 코드 · 그림 · 가로줄 · 표식)으로 시작하는 줄. */
// 백틱은 \x60 으로 — 라벨 시험의 글자 훑기가 정규식 속 백틱을 템플릿 문자열로 읽는다.
const BLOCK_START =
  /^(?:#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\x60\x60\x60|~~~|\||!\[|---|\*\*\*|___|<!--|<)/;

/** 마크다운 꾸밈을 걷은 글자 수 — 굵게 · 기울임 · 코드 표시와 링크의 주소는 길이에 세지 않는다. */
function plainLength(paragraph: string): number {
  return paragraph
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_\x60~]/g, "")
    .trim().length;
}

/** 이 답의 첫 문단을 머리 문장으로 세울 것인가. */
export function hasLeadSentence(answer: string): boolean {
  const text = answer.replace(/\r\n/g, "\n").trim();
  if (text === "") return false;
  const cut = text.search(/\n[ \t]*\n/);
  if (cut === -1) return false; // 문단 하나뿐 — 뒤에 이을 말이 없다.
  const first = text.slice(0, cut);
  const rest = text.slice(cut).trim();
  if (rest === "") return false;
  const lines = first.split("\n").map((line) => line.trim());
  if (lines.some((line) => line === "" || BLOCK_START.test(line))) return false;
  // 바로 아래 줄이 `---` · `===` 면 문단이 아니라 머리(setext)다 — rest 의 첫 줄로는 오지 않지만 first 안의 둘째 줄로 올 수 있다.
  if (lines.length > 1 && /^(?:-{3,}|={3,})$/.test(lines[lines.length - 1] ?? "")) return false;
  return plainLength(first) <= LEAD_MAX_CHARS;
}
