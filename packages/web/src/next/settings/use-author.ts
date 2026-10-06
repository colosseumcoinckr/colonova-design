import { useCallback, useEffect, useRef, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";

/** 작업에 적을 이름 — 데몬이 기억하고(`machine.author.set`) 제출에 작성자로 적힌다. */
export type AuthorPhase = "idle" | "saving" | "saved" | "failed";

export interface AuthorModel {
  draft: string;
  setDraft: (value: string) => void;
  /** 칸에 저장하지 않은 글이 있다. */
  dirty: boolean;
  phase: AuthorPhase;
  /** 저장한다 — 이미 같으면 아무 일도 없다. 저장되었거나 같으면 true. */
  commit: () => Promise<boolean>;
  /** 저장이 도는 중이면 끝나길 기다린다(닫기 보호가 쓴다). */
  settle: () => Promise<boolean>;
  /** 칸을 저장된 글로 되돌린다. */
  revert: () => void;
}

/** 저장 뒤 ✓ 가 떠 있는 시간. */
const SAVED_MS = 1500;

/**
 * 이름 칸의 글과 저장(2026-10-06 설정 손질 · S0 · S5). 저장의 성공 · 실패는 칸 곁에서 말하고,
 * 닫기가 저장과 겹치면 껍데기가 `settle()` 로 끝나길 기다린다 — 닫으며 쏜 저장의 실패가 언마운트
 * 뒤에 써져 사라지던 것을 막는다. 저장한 글은 방송이 따라올 때까지 기준으로 기억한다.
 */
export function useAuthorName(daemon: Daemon): AuthorModel {
  const fromStatus = daemon.status?.authorName ?? "";
  const [draft, setDraftState] = useState(fromStatus);
  const [localSaved, setLocalSaved] = useState<string | null>(null);
  const [phase, setPhase] = useState<AuthorPhase>("idle");
  const inflight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<number | null>(null);
  const baseline = localSaved ?? fromStatus;
  const dirty = draft.trim() !== baseline;

  // 방송이 저장한 글을 따라잡으면 다리를 걷는다. 다른 창이 바꾼 이름은 칸이 깨끗할 때만 따라간다.
  const lastStatus = useRef(fromStatus);
  useEffect(() => {
    if (localSaved !== null && fromStatus === localSaved) setLocalSaved(null);
    if (fromStatus !== lastStatus.current) {
      const wasClean = draft.trim() === (localSaved ?? lastStatus.current);
      lastStatus.current = fromStatus;
      if (wasClean && localSaved === null) setDraftState(fromStatus);
    }
  }, [fromStatus, localSaved, draft]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const setDraft = useCallback((value: string) => {
    setDraftState(value);
    // 낡은 「저장했어요」와 지난 실패는 새로 치는 순간 걷는다.
    setPhase((now) => (now === "saved" || now === "failed" ? "idle" : now));
  }, []);

  const commit = useCallback((): Promise<boolean> => {
    if (inflight.current) return inflight.current;
    const next = draft.trim();
    // 칸도 저장된 값과 같게 — 공백만 친 칸이 「저장됨」처럼 남지 않게.
    if (next !== draft) setDraftState(next);
    if (next === baseline) return Promise.resolve(true);
    setPhase("saving");
    const run = daemon.api
      .machineAuthorSet(next === "" ? null : next)
      .then(() => {
        setLocalSaved(next);
        setPhase("saved");
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(
          () => setPhase((now) => (now === "saved" ? "idle" : now)),
          SAVED_MS,
        );
        return true;
      })
      .catch(() => {
        setPhase("failed");
        return false;
      })
      .finally(() => {
        inflight.current = null;
      });
    inflight.current = run;
    return run;
  }, [draft, baseline, daemon.api]);

  const settle = useCallback(() => inflight.current ?? Promise.resolve(true), []);

  const revert = useCallback(() => {
    setDraftState(baseline);
    setPhase("idle");
  }, [baseline]);

  return { draft, setDraft, dirty, phase, commit, settle, revert };
}
