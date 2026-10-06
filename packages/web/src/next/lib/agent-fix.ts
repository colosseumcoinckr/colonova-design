/**
 * AI 카드 안의 설치 · 로그인 진행과 실패의 판정(2026-10-06 설정 손질 · S2). 데몬이 끝까지 지켜보는
 * 설치와 로그인은 방송(`install` · `installDone` · `login` · `loginDone`)으로 말하고, 방송이 닿기
 * 전의 틈과 요청이 닿지 않은 일은 부르는 쪽이 `starting` · `startError` 로 보탠다.
 *
 * 설정은 한때 성공만 읽었다 — 실패하면 진행 문구가 사라진 채 데몬의 낡은 한 줄만 남았다. 이 판정이
 * 실패를 카드의 한 상태로 세워 말하게 한다(온보딩의 `FirstRun` 은 처음부터 읽던 것이다).
 * 시험이 src 에서 곧장 읽는 순수 모듈이라 형제를 부르지 않는다.
 */

export type FixKind = "install" | "login";

export interface FixInput {
  /** 이 카드의 AI(`claude` · `codex`). */
  id: string;
  /** 요청을 보냈고 방송이 닿기 전의 틈 — 그 사이에 단추가 다시 서면 두 번 눌린다. */
  starting: FixKind | null;
  /** 요청이 닿지 않았거나 시작하지 못한 이유 — 데몬이 돌려준 원문. */
  startError: { kind: FixKind; detail: string } | null;
  install: { kind: string; line: string } | null;
  installDone: { kind: string; ok: boolean; detail: string } | null;
  login: { url: string; wantsCode: boolean } | null;
  loginDone: { ok: boolean; detail: string } | null;
  /** 마지막으로 로그인을 시작한 AI — 로그인 방송은 어느 AI 의 것인지 싣지 않는다. */
  loginFor: string | null;
}

export type FixView =
  | { phase: "idle" }
  | { phase: "installing" }
  | { phase: "starting-login" }
  | { phase: "login"; url: string; wantsCode: boolean }
  | { phase: "failed"; kind: FixKind; detail: string };

/**
 * 한 카드의 지금 — 도는 일이 먼저고(설치 · 로그인), 도는 일이 없을 때 마지막 실패가 말한다.
 * 새로 시작하면(`starting` · 도는 방송) 낡은 실패가 곧바로 물러난다.
 */
export function fixState(input: FixInput): FixView {
  const { id, starting, startError, install, installDone, login, loginDone, loginFor } = input;
  if (install?.kind === `install-${id}` || starting === "install") return { phase: "installing" };
  // 로그인 방송은 AI 를 모른다 — 이 창에서 시작한 AI 의 카드에, 시작한 적이 없으면 모든 카드에 선다.
  if (login !== null && (loginFor === null || loginFor === id)) {
    return { phase: "login", url: login.url, wantsCode: login.wantsCode };
  }
  if (starting === "login") return { phase: "starting-login" };
  if (startError) return { phase: "failed", kind: startError.kind, detail: startError.detail };
  if (installDone && installDone.kind === `install-${id}` && !installDone.ok && install === null) {
    return { phase: "failed", kind: "install", detail: installDone.detail };
  }
  if (loginDone && !loginDone.ok && login === null && loginFor === id) {
    return { phase: "failed", kind: "login", detail: loginDone.detail };
  }
  return { phase: "idle" };
}
