/**
 * 상태 줄에서 대화 제목을 바꾼 결과 — 흰칸을 다듬어 남기고, 비었거나 지금 제목과 같으면
 * null(바꿀 것이 없다). 사이드바의 이름 바꾸기(ConversationList)와 같은 규칙이다.
 */
export function renamedTitle(current: string, draft: string): string | null {
  const name = draft.trim();
  return name && name !== current ? name : null;
}
