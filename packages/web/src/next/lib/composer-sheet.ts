/**
 * 좁은 창의 입력창 시트(2026-10-31 화면 자리 개선안 S12)의 자리 — 화면 탭 바닥에 선
 * 접힌 입력창이 펼쳐질 때 같은 입력창을 옮겨 그리는 곳이다. 셸 규칙(같은 입력창을 두
 * 자리에 마운트하지 않는다)을 지키려고, 대화 칸이 입력창을 포털로 이 칸에 보낸다.
 * 포털은 인스턴스를 옮길 뿐이라 쓰던 글 · 핀 · 첨부가 살아 있다.
 */

let host: HTMLElement | null = null;
const listeners = new Set<() => void>();

/** 화면 칸이 자리를 세우거나 거둔다(마운트 · 언마운트 · 좁은 창의 변화). */
export function setComposerSheetHost(el: HTMLElement | null): void {
  if (host === el) return;
  host = el;
  for (const notify of listeners) notify();
}

/** 지금의 자리 — 없으면 null(대화 칸의 제 자리에 선다). */
export function getComposerSheetHost(): HTMLElement | null {
  return host;
}

/** 자리의 변화를 듣는다 — `useSyncExternalStore` 의 몫이다. */
export function subscribeComposerSheet(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}
