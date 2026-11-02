import type { DocSearchHit } from "@colonova-design/protocol";
import { useEffect, useRef, useState } from "react";
import type { Daemon } from "../../../lib/daemon-client";

/**
 * 본문 찾기(2026-10-30 사용자 요청) — 트리 찾기 칸의 말로 가져온 사본의 본문도 찾는다. 치는 동안은
 * 기다렸다가(250ms) 한 번 묻고, 늦게 온 답은 번호로 버린다. 두 글자 아래는 묻지 않는다.
 */

export type BodySearch =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; hits: DocSearchHit[] }
  | { phase: "failed" };

const WAIT_MS = 250;
const MIN_CHARS = 2;

export function useBodySearch(daemon: Daemon, query: string, enabled: boolean): BodySearch {
  const apiRef = useRef(daemon.api);
  apiRef.current = daemon.api;
  const seq = useRef(0);
  const [state, setState] = useState<BodySearch>({ phase: "idle" });
  const trimmed = query.trim();
  useEffect(() => {
    seq.current += 1;
    const mine = seq.current;
    if (!enabled || trimmed.length < MIN_CHARS) {
      setState({ phase: "idle" });
      return;
    }
    setState({ phase: "loading" });
    const timer = window.setTimeout(() => {
      apiRef.current
        .docSearch(trimmed)
        .then((reply) => {
          if (mine === seq.current) setState({ phase: "ready", hits: reply.results });
        })
        .catch(() => {
          if (mine === seq.current) setState({ phase: "failed" });
        });
    }, WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [trimmed, enabled]);
  return state;
}
