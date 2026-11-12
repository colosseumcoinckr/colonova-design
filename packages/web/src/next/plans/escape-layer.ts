import { overlayOpen } from "../../hooks/use-modal-focus";

/**
 * 이 Esc 가 창 · 메뉴의 것인가(2026-10-23 화면 확인) — 겹판(`overlayOpen`)이나 열린 팝(`.nx-pop`)이 있으면
 * 그것들이 Esc 를 받는다. 팝은 캡처 단계에서 먼저 받고, 모달은 문서 수신기에서 받는다(2026-11-12 감독자 NOTE-1).
 * 칸도 소유층을 확인해 창을 닫는 Esc 가 문서 · 편집기까지 닫지 않게 한다.
 */
export function escapeOwnedByLayer(): boolean {
  return overlayOpen() || document.querySelector(".nx-pop") !== null;
}
