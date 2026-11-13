/**
 * 좁은 창의 입력창 시트(2026-10-31 화면 자리 개선안 S12)의 자리와 열림 — 화면 탭 바닥에 선
 * 접힌 입력창이 펼쳐질 때 같은 입력창을 옮겨 그리는 곳이다. 셸 규칙(같은 입력창을 두
 * 자리에 마운트하지 않는다)을 지키려고, 대화 칸이 포털이 그리는 상자 하나를 이 자리와
 * 제 자리 사이에서 옮긴다 — 포털의 대상은 늘 그 상자라 인스턴스가 재마운트되지 않고
 * 쓰던 글 · 핀 · 첨부가 살아 있다(2026-11-12 — 포털 대상을 원소끼리 바꾸면 React 가
 * 새 포털로 만들어 입력창이 재마운트되어 붙인 첨부를 잃는다).
 * 열림 상태도 이 모듈이 쥔다 — 화면 칸의 접힌 한 줄이 읽고, 대화 칸이 보내기 · 접기 ·
 * Esc 로 거둔다. 자리와 따로 두어 탭을 옮겨도(자리는 남고 칸만 숨음) 판정이 흔들리지 않는다.
 */

export interface ComposerSheet {
  /** 화면 칸이 세운 시트 자리 — 없으면 null(입력창은 대화 칸의 제 자리에 선다). */
  host: HTMLElement | null;
  /** 시트가 펼쳐져 있는가. */
  open: boolean;
}

let sheet: ComposerSheet = { host: null, open: false };
const listeners = new Set<() => void>();

function update(next: ComposerSheet): void {
  if (next.host === sheet.host && next.open === sheet.open) return;
  sheet = next;
  for (const notify of listeners) notify();
}

/** 화면 칸이 자리를 세우거나 거둔다(마운트 · 언마운트 · 좁은 창의 변화). */
export function setComposerSheetHost(el: HTMLElement | null): void {
  update({ host: el, open: sheet.open });
}

/** 시트를 열고 닫는다 — 접힌 한 줄(토글)과 대화 칸의 보내기 · 접기 · Esc(닫기)가 부른다. */
export function setComposerSheetOpen(open: boolean): void {
  update({ host: sheet.host, open });
}

/** 접힌 한 줄의 누름 — 열려 있으면 접고, 접혀 있으면 펼친다. */
export function toggleComposerSheet(): void {
  setComposerSheetOpen(!sheet.open);
}

/** 지금의 자리와 열림 — `useSyncExternalStore` 의 몫이다(같은 값이면 같은 객체를 돌려준다). */
export function getComposerSheet(): ComposerSheet {
  return sheet;
}

/** 자리 · 열림의 변화를 듣는다. */
export function subscribeComposerSheet(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}
