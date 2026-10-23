import { overlayOpen } from "../../hooks/use-modal-focus";

/**
 * 이 Esc 가 창 · 메뉴의 것인가(2026-10-23 화면 확인) — 겹판(`overlayOpen`)이나 열린 팝(`.nx-pop`)이 있으면
 * 그것들이 Esc 를 받는다. 그 처리기는 문서 단위 수신기라 칸의 React 처리기보다 늦게 돈다 — 칸이 먼저 물러서지
 * 않으면 창을 닫는 Esc 가 문서 · 편집기까지 닫는다.
 */
export function escapeOwnedByLayer(): boolean {
  return overlayOpen() || document.querySelector(".nx-pop") !== null;
}
