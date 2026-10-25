/**
 * 도구 준비 칸의 진행 판정(2026-10-25 설치 인지 손질). 고침 단추를 누른 뒤에도
 * 화면이 가만히 있으면 설치가 도는지 알 수 없었다 — 두 고침의 사정이 다르다.
 * pnpm 설치는 요청이 corepack 을 끝까지 돌리고 돌아오는 길이라 그 사이 방송이
 * 없고(최대 60 초), macOS git 설치는 OS 설치 창에서 진행되므로 앱이 끝을 모른다.
 * 여기가 그 두 세계의 타일과 상태 말을 정한다. 시험이 src 에서 곧장 읽는 순수
 * 모듈이라 형제를 부르지 않는다(lib/agent-fix.ts 와 같은 모양).
 */

export interface ToolProgressInput {
  /** 두 단계(git · 런타임)가 모두 통과했다. */
  pass: boolean;
  /** 데몬에 보낸 고침의 종류 — 요청이 살아 있는 동안. */
  fixing: string | null;
  /** macOS — OS 설치 창을 열었다는 답. 끝은 다시 확인만이 안다. */
  installOpened: boolean;
  /** 검사 실패가 남아 있다 — 손이 필요한 칸. */
  failed: boolean;
  /** 다시 확인이 돌고 있다. */
  rechecking: boolean;
  /** 첫 검사의 답이 오래 없다 — 도는 표시 대신 다시 확인을 건넨다(2026-10-20). */
  slowFirstCheck: boolean;
}

export type ToolTile = "ok" | "run" | "act";
/** 상태 말의 열쇠 — FirstRun 이 L 의 문장으로 바꾼다. */
export type ToolWord = "ready" | "installing" | "outside" | "checking" | "blocked";

export function toolProgress(input: ToolProgressInput): { tile: ToolTile; word: ToolWord } {
  if (input.pass) return { tile: "ok", word: "ready" };
  // 누름의 즉시 — 방송이 없어도 돌림부터 선다.
  if (input.fixing !== null) return { tile: "run", word: "installing" };
  // OS 설치 창이 열려 있다 — 앱 안은 잠잠하니 기다림을 말로 남긴다.
  if (input.installOpened) return { tile: "act", word: "outside" };
  // 다시 확인이 도는 동안은 낡은 실패보다 지금의 확인이 먼저다.
  if (input.rechecking) return { tile: "run", word: "checking" };
  if (input.failed) return { tile: "act", word: "blocked" };
  if (input.slowFirstCheck) return { tile: "act", word: "checking" };
  return { tile: "run", word: "checking" };
}
