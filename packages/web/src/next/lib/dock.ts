/**
 * 작업 독(2026-10-31 화면 자리 개선안 S4)의 순수 판정 — 입력창 바로 위 한 줄에 무엇이 서는지,
 * 차례는 어느 것인지를 내린다. 독은 한 번에 한 줄만 세운다: ① AI 가 도는 중 ② 묻는 일
 * ③ 알림(고쳐 보내기 힌트 · 길어진 대화) ④ 근거 — 가운데 넷은 줄을 두지 않고 오른쪽 끝의
 * `기획서 N` 칩으로 접는다. 근거 칩은 도는 중에도 남는다(줄을 차지하지 않는다).
 *
 * 문장은 `labels.ts` 에서 오지만 이 파일은 그것을 부르지 않고 인자로 받는다 — 단위 시험이
 * src 에서 곧장 읽는 순수 모듈은 형제를 부르지 않는다(journey.ts 와 같은 규칙).
 */

/** 독의 몸 줄 한 종류 — 한 번에 하나만 선다. */
export type DockRow =
  | { kind: "run" }
  | { kind: "ask"; count: number }
  | { kind: "notice"; text: string };

export interface DockInput {
  /** AI 가 이 대화에서 도는 중인가(진행 시계가 서는 조건과 같다). */
  running: boolean;
  /** 답을 기다리는 묻는 카드 수 — 0 이면 없다. */
  asks: number;
  /**
   * 알림 줄들 — 차례대로(먼저 온 것이 앞선다). 독은 첫 줄만 세우고 나머지는 물러선다:
   * 한 번에 한 줄 규칙(2026-10-31 화면 자리 개선안 S4)이다.
   */
  notices: readonly string[];
  /** 이 대화의 근거 문서 수 — 0 보다 크면 오른쪽 끝에 `기획서 N` 칩이 선다. */
  refs: number;
}

export interface DockDecision {
  /** 독의 몸 줄 — 서는 것이 없으면 null(독 자리는 비고, 근거 칩만 남는다). */
  main: DockRow | null;
  /** 오른쪽 끝 칩의 근거 수 — 0 이면 칩이 없다. */
  refs: number;
}

/** 근거 칩의 표기 — `기획서 1`. 문장은 부르는 쪽의 것이다. */
export function refsChipText(count: number, words: (n: number) => string): string {
  return count > 0 ? words(count) : "";
}

/** 독의 판정 — ① 도는 중 ② 묻는 일 ③ 알림(첫 줄만)의 차례로 하나를 고른다. */
export function dockOf(input: DockInput): DockDecision {
  if (input.running) return { main: { kind: "run" }, refs: input.refs };
  if (input.asks > 0) return { main: { kind: "ask", count: input.asks }, refs: input.refs };
  const notice = input.notices.find((text) => text.trim() !== "");
  if (notice !== undefined) return { main: { kind: "notice", text: notice }, refs: input.refs };
  return { main: null, refs: input.refs };
}
