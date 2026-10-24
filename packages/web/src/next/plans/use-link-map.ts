import { useCallback, useEffect, useRef, useState } from "react";
import type { Daemon, MapChange, MapReadResult } from "../../lib/daemon-client";

/**
 * 연결 지도의 상태 갈고리(F6 2조각) — `use-plans` 의 낡은 답 버리기 패턴을 본뜬다. 칸은
 * 마운트된 채 숨으므로 손은 늘 최신인 `daemon.api` ref 로 읽고, 늦게 온 답은 번호(seq)로
 * 버린다. 읽기(mapRead)와 고치기(mapWrite)를 다룬다.
 */

export type LinkMapPhase = "idle" | "loading" | "ready" | "failed";

export interface LinkMapState {
  result: MapReadResult | null;
  phase: LinkMapPhase;
}

const INITIAL: LinkMapState = { result: null, phase: "idle" };

export interface LinkMapHand {
  state: LinkMapState;
  /** 조용히 다시 읽는다 — 이미 읽은 지도는 지우지 않는다. */
  refresh: () => void;
  /** 잇기·끊기 — 쓴 뒤의 연결 목록 전체로 갈아끼운다. 거절은 예외로 돌아간다(한국어 문장). */
  write: (changes: readonly MapChange[]) => Promise<void>;
}

export function useLinkMap(daemon: Daemon, enabled: boolean): LinkMapHand {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const apiRef = useRef(daemon.api);
  apiRef.current = daemon.api;
  // 늦게 온 답을 버리는 번호 — 두 번 누르면 먼저 시작한 읽기의 답이 자리를 덮지 않게.
  const seq = useRef(0);
  const [state, setState] = useState<LinkMapState>(INITIAL);

  const load = useCallback((quiet: boolean) => {
    if (!enabledRef.current) return;
    seq.current += 1;
    const at = seq.current;
    setState((before) =>
      quiet && before.result !== null ? before : { ...before, phase: "loading" },
    );
    apiRef.current
      .mapRead()
      .then((result) => {
        if (at !== seq.current) return;
        setState({ result, phase: "ready" });
      })
      .catch(() => {
        if (at !== seq.current) return;
        // 이미 읽어 둔 지도는 조용한 새로 고침의 실패로 지우지 않는다.
        setState((before) => ({
          ...before,
          phase: quiet && before.result !== null ? "ready" : "failed",
        }));
      });
  }, []);
  const refresh = useCallback(() => load(true), [load]);

  const write = useCallback(
    (changes: readonly MapChange[]): Promise<void> =>
      apiRef.current.mapWrite(changes).then((links) => {
        setState((before) =>
          before.result === null ? before : { result: { ...before.result, links }, phase: "ready" },
        );
      }),
    [],
  );

  // 처음 앞에 설 때 한 번 읽는다 — 이후에는 숨는 동안 지도가 바뀌지 않는다(읽기 전용).
  useEffect(() => {
    if (enabled && state.phase === "idle") load(false);
  }, [enabled, state.phase, load]);

  return { state, refresh, write };
}
