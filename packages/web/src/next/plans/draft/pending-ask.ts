/**
 * 읽는 문서에서 보낸 기획 대화의 첫 말(2026-10-30 사용자 요청 — 기획서 칸에서도 AI 와 바로 이야기한다). 읽기 화면의
 * 대화 칸은 초안이 없으니 말을 여기 맡기고 초안 편집기를 연다. 편집기의 기획 대화가 열리며 꺼내 보낸다. 한 문서에
 * 하나뿐이고 나중 말이 앞의 것을 덮는다.
 */
const pending = new Map<string, string>();

/** 기존 문서의 초안 열쇠 — 데몬의 `p-<pageId>` 와 같은 모양. */
export function pageDraftKey(pageId: string): string {
  return `p-${pageId}`;
}

export function stashAsk(docKey: string, text: string): void {
  pending.set(docKey, text);
}

/** 맡긴 말을 꺼낸다 — 꺼내면 비워 한 번만 보낸다. 없으면 null. */
export function takeAsk(docKey: string): string | null {
  const text = pending.get(docKey) ?? null;
  pending.delete(docKey);
  return text;
}
