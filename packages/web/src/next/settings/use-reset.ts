import { useRef, useState } from "react";

/**
 * 전체 초기화의 걸음(2026-10-06 설정 손질 · S6). 확인 창은 웹이 아니라 데스크톱이 네이티브로 연다 —
 * desktop/src/main.ts 의 `requestReset` 이 `dialog.showMessageBox` 로 묻고 승인에만 다시 시작하며,
 * bridge.ts 의 `desktop:reset` 도 앱의 최상위 프레임만 받는다(2026-10-04 ux-review). 그래서 이 판은
 * 한 번 더 막지 않고 걸음만 말한다: 시트가 떠 있는 동안은 `asking`(확인하는 중), 승인이 나서 앱이
 * 닫히기 시작하면 `restarting`. 시트가 떠 있는 동안 「다시 시작하는 중」이라 말하던 거짓을 없앤다.
 */
export type ResetPhase = "idle" | "asking" | "restarting";

export interface ResetModel {
  /** 데스크톱 앱에서만 초기화가 있다. */
  available: boolean;
  phase: ResetPhase;
  /** 시작하지 못한 이유 — 데몬 · 데스크톱이 돌려준 원문(없을 수 있다). */
  failure: { detail: string | null } | null;
  run: () => void;
}

export function useReset(): ResetModel {
  const reset = window.colonovaDesignDesktop?.reset;
  const [phase, setPhase] = useState<ResetPhase>("idle");
  const [failure, setFailure] = useState<{ detail: string | null } | null>(null);
  const live = useRef(false);
  const run = () => {
    if (!reset || live.current) return;
    live.current = true;
    setFailure(null);
    setPhase("asking");
    reset()
      .then((result) => {
        if (result.restarting) {
          setPhase("restarting");
          return;
        }
        live.current = false;
        setPhase("idle");
        if (result.error) setFailure({ detail: result.error });
      })
      .catch(() => {
        live.current = false;
        setPhase("idle");
        setFailure({ detail: null });
      });
  };
  return { available: Boolean(reset), phase, failure, run };
}
