import type { DraftEdit, DraftView } from "@colonova-design/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Daemon } from "../../../lib/daemon-client";
import { L } from "../../labels";

/**
 * 초안 편집기의 판(2026-10-23 · 최종 구현 계획 F1) — 한 문서의 초안을 열고 고치는 손. `use-plans.ts` 와
 * 같은 이유로 `daemon` 은 ref 로 쥐고(렌더마다 새 겉모습이다), 늦게 온 답은 번호와 docKey 로 버린다.
 */

export type DraftPhase = "loading" | "ready" | "failed";

export interface DraftHand {
  view: DraftView | null;
  phase: DraftPhase;
  /** 마지막 손의 실패 문장 — 편집기가 붉은 줄로 세운다. */
  error: string | null;
  /** 다시 읽었음의 한 줄 — 편집기가 토스트로 옮기고 거둔다. */
  notice: string | null;
  /** 여러 걸음을 한 요청에 싣는다 — 성공하면 새 뷰, 실패하면 null. */
  apply: (edits: DraftEdit[]) => Promise<DraftView | null>;
  resolve: (blockId: string, choice: "mine" | "theirs") => void;
  /** 초안을 버린다 — Confluence 의 문서는 그대로다. */
  discard: () => Promise<boolean>;
  /** 조용히 다시 읽는다 — 이미 뷰가 설 때의 방송 뒤편이다. */
  reload: () => void;
  /** 처음 열기가 실패한 뒤 같은 문으로 다시 연다. */
  retry: () => void;
  clearNotice: () => void;
}

/** 오류 객체에서 기계 코드를 읽는다 — 문장만 오는 답도 있어 코드가 실리지 않으면 null 이다. */
function errorCodeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code: unknown = error.code;
  return typeof code === "string" && code !== "" ? code : null;
}

export function useDraft(daemon: Daemon, input: { pageId?: string; docKey?: string }): DraftHand {
  const pageId = input.pageId ?? null;
  const firstKey = input.docKey ?? null;
  const [view, setView] = useState<DraftView | null>(null);
  const [phase, setPhase] = useState<DraftPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const apiRef = useRef(daemon.api);
  apiRef.current = daemon.api;
  const eventsRef = useRef(daemon.onDraftEvent);
  eventsRef.current = daemon.onDraftEvent;
  /** 지금 편집기가 보는 문서 — 늦게 온 답의 docKey 대조와 방송 거름의 기준이다. */
  const keyRef = useRef<string | null>(firstKey);
  const viewRef = useRef<DraftView | null>(null);
  viewRef.current = view;
  const seqRef = useRef(0);

  const fail = useCallback(
    (err: unknown) => (err instanceof Error ? err.message : String(err)),
    [],
  );

  /** 조용히 다시 읽는다 — 이미 뷰가 설 때의 방송 뒤편이다. */
  const reload = useCallback(() => {
    const key = keyRef.current;
    if (key === null) return;
    seqRef.current += 1;
    const seq = seqRef.current;
    apiRef.current
      .draftGet(key)
      .then((next) => {
        if (seq !== seqRef.current || keyRef.current !== next.docKey) return;
        setView(next);
        setPhase("ready");
      })
      .catch(() => {
        // 이미 읽은 뷰는 지우지 않는다 — 한 줄로 알린다.
        if (seq !== seqRef.current) return;
        setError(L.drafts.loadFailed);
      });
  }, []);

  /** 처음 열기 — 기존 문서는 pageId 로(없으면 원격 최신본을 기준으로 만들어 돌려준다), 알면 docKey 로. */
  const open = useCallback(() => {
    const initial = pageId ?? firstKey;
    if (initial === null) return;
    seqRef.current += 1;
    const seq = seqRef.current;
    setPhase("loading");
    const hand =
      pageId !== null ? apiRef.current.draftOpen(pageId) : apiRef.current.draftGet(initial);
    hand
      .then((next) => {
        if (seq !== seqRef.current) return;
        keyRef.current = next.docKey;
        setView(next);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return;
        setPhase("failed");
        setError(fail(err));
      });
  }, [pageId, firstKey, fail]);

  useEffect(() => {
    open();
  }, [open]);

  // 다른 창에서 초안이 바뀌면 다시 읽는다 — 내 편집의 방송은 개정이 이미 같아 건너뛴다.
  useEffect(
    () =>
      eventsRef.current((message) => {
        if (message.type !== "draft.changed") return;
        if (message.docKey !== keyRef.current) return;
        if (message.revision === viewRef.current?.revision) return;
        reload();
      }),
    [reload],
  );

  const apply = useCallback(
    (edits: DraftEdit[]): Promise<DraftView | null> => {
      const key = keyRef.current;
      const current = viewRef.current;
      if (key === null || current === null) return Promise.resolve(null);
      setError(null);
      return apiRef.current
        .draftEdit(key, current.revision, edits)
        .then((next) => {
          if (keyRef.current === next.docKey) setView(next);
          return next;
        })
        .catch((err: unknown) => {
          if (keyRef.current !== key) return null;
          if (errorCodeOf(err) === "draft.stale") {
            // 기대 개정이 어긋났다 — 다시 읽고 한 줄로 알린다(2026-10-23 · 최종 구현 계획 F1).
            reload();
            setNotice(L.drafts.staleReloaded);
          } else {
            setError(fail(err));
          }
          return null;
        });
    },
    [fail, reload],
  );

  const resolve = useCallback(
    (blockId: string, choice: "mine" | "theirs") => {
      const key = keyRef.current;
      if (key === null) return;
      setError(null);
      apiRef.current
        .draftResolve(key, blockId, choice)
        .then((next) => {
          if (keyRef.current === next.docKey) setView(next);
        })
        .catch((err: unknown) => {
          if (keyRef.current === key) setError(fail(err));
        });
    },
    [fail],
  );

  const discard = useCallback((): Promise<boolean> => {
    const key = keyRef.current;
    if (key === null) return Promise.resolve(false);
    return apiRef.current
      .draftDiscard(key)
      .then(() => true)
      .catch((err: unknown) => {
        setError(fail(err));
        return false;
      });
  }, [fail]);

  const clearNotice = useCallback(() => setNotice(null), []);

  return { view, phase, error, notice, apply, resolve, discard, reload, retry: open, clearNotice };
}
