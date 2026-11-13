// 2026-11-12 UI 조사 U-010 — daemon/src/common-instructions.ts의 turnSubjectOf가 자르는 상한.
const REQUEST_TITLE_LIMIT = 80;

/** 원문은 선로에 없다. 보관 제목은 두고 표시와 접근 이름에만 잘림을 알린다. */
export function historyRequestTitle(title: string): string {
  return title.length >= REQUEST_TITLE_LIMIT && !title.endsWith("…") ? `${title}…` : title;
}
