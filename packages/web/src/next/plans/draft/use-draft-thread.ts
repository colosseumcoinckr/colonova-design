import type {
  DraftReadRef,
  DraftRefInput,
  DraftThread,
  EffortLevel,
} from "@colonova-design/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Daemon } from "../../../lib/daemon-client";
import { L } from "../../labels";

/**
 * 기획 대화의 판(2026-10-23 · 최종 구현 계획 F1) — 한 초안의 대화와 변경안을 읽고 옮기는 손.
 * `use-draft.ts` 와 같은 이유로 `daemon` 은 ref 로 쥐고(렌더마다 새 겉모습이다), 늦게 온 답은
 * 번호와 docKey 로 버린다 — 다른 문서 화면에 낡은 답이 닿지 않는다.
 */

export type DraftThreadPhase = "idle" | "loading" | "ready" | "failed";

export interface DraftThreadHand {
  thread: DraftThread | null;
  phase: DraftThreadPhase;
  /** AI 가 지금 변경안을 만드는 중 — `draft.ai` 의 시작부터 끝까지. */
  running: boolean;
  /** 도는 중의 누적 설명 — 데몬이 맨 마지막 판을 보낸다. */
  streamText: string | null;
  /** 도는 중 AI 가 스스로 읽은 문서 — 알림이 올 때마다 더한다. */
  reads: DraftReadRef[];
  error: string | null;
  /** 개정이 어긋나 채택이 무산했을 때의 한 줄 — 판이 토스트로 옮기고 거둔다. */
  notice: string | null;
  /** 기획 AI 의 모델 · 생각 시간 — 없으면 CLI 기본(2026-10-26 사용자 요청). */
  ask: (
    text: string,
    refs: DraftRefInput[],
    pick?: { model?: string | null; effort?: EffortLevel | null },
  ) => Promise<boolean>;
  cancel: () => void;
  /** 채택은 이 컴퓨터의 초안에만 닿는다 — 성패와 무관하게 초안을 다시 읽는 것은 부른 쪽의 몫이다. */
  adopt: (proposalId: string, opIds: string[], revision: number) => Promise<boolean>;
  reject: (proposalId: string, opIds?: string[]) => Promise<boolean>;
  reload: () => void;
  retry: () => void;
  clearNotice: () => void;
}

/** 오류 객체에서 기계 코드를 읽는다 — 문장만 오는 답도 있어 코드가 실리지 않으면 null 이다. */
function errorCodeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code: unknown = error.code;
  return typeof code === "string" && code !== "" ? code : null;
}

export function useDraftThread(daemon: Daemon, docKey: string | null): DraftThreadHand {
  const [thread, setThread] = useState<DraftThread | null>(null);
  const [phase, setPhase] = useState<DraftThreadPhase>("idle");
  const [running, setRunning] = useState(false);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [reads, setReads] = useState<DraftReadRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const apiRef = useRef(daemon.api);
  apiRef.current = daemon.api;
  const eventsRef = useRef(daemon.onDraftEvent);
  eventsRef.current = daemon.onDraftEvent;
  /** 지금 판이 보는 문서 — 늦게 온 답의 docKey 대조와 방송 거름의 기준이다. */
  const keyRef = useRef<string | null>(docKey);
  const seqRef = useRef(0);
  /** 대화를 한 번이라도 읽었는가 — 이미 읽은 판은 읽기 실패에도 지우지 않는다. */
  const haveRef = useRef(false);

  const fail = useCallback(
    (err: unknown) => (err instanceof Error ? err.message : String(err)),
    [],
  );

  /** 대화를 조용히 다시 읽는다 — 변경안의 stale 판정이 초안과 함께 바뀐다. */
  const reload = useCallback(() => {
    const key = keyRef.current;
    if (key === null) return;
    seqRef.current += 1;
    const seq = seqRef.current;
    apiRef.current
      .draftThread(key)
      .then((next) => {
        if (seq !== seqRef.current || keyRef.current !== next.docKey) return;
        haveRef.current = true;
        setThread(next);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return;
        setError(fail(err));
        // 처음 읽기가 실패했을 때만 실패 면으로 — 이미 읽은 대화는 지우지 않는다.
        if (!haveRef.current) setPhase("failed");
      });
  }, [fail]);

  // 문서가 열릴 때(문서가 없을 때는 아무것도 하지 않는다) — 편집기가 docKey 를 알아낸 뒤에 연다.
  useEffect(() => {
    keyRef.current = docKey;
    if (docKey === null) {
      setThread(null);
      setPhase("idle");
      haveRef.current = false;
      return;
    }
    setPhase("loading");
    reload();
  }, [docKey, reload]);

  // 같은 문서의 방송 — AI 의 진행은 눈으로, 초안의 변화는 대화의 다시 읽기로.
  useEffect(
    () =>
      eventsRef.current((message) => {
        if (message.docKey !== keyRef.current) return;
        if (message.type === "draft.changed") {
          reload();
          return;
        }
        if (message.phase === "started") {
          setRunning(true);
          setStreamText(null);
          setReads([]);
          return;
        }
        if (message.phase === "text") {
          setRunning(true);
          if (typeof message.text === "string") setStreamText(message.text);
          return;
        }
        if (message.phase === "read") {
          setRunning(true);
          const read = message.read;
          if (read !== undefined) {
            setReads((before) =>
              before.some((one) => one.pageId === read.pageId) ? before : [...before, read],
            );
          }
          return;
        }
        // done · failed · cancelled — 대화를 다시 읽는다(변경안이 생겼거나 이야기가 끝났다).
        setRunning(false);
        setStreamText(null);
        setReads([]);
        reload();
      }),
    [reload],
  );

  const ask = useCallback(
    (
      text: string,
      refs: DraftRefInput[],
      pick?: { model?: string | null; effort?: EffortLevel | null },
    ): Promise<boolean> => {
      const key = keyRef.current;
      if (key === null) return Promise.resolve(false);
      setError(null);
      return apiRef.current
        .draftAsk(key, text, refs, pick)
        .then(() => {
          reload(); // 사람의 말이 곧 대화에 선다
          return true;
        })
        .catch((err: unknown) => {
          setError(fail(err));
          return false;
        });
    },
    [fail, reload],
  );

  const cancel = useCallback(() => {
    const key = keyRef.current;
    if (key === null) return;
    apiRef.current.draftCancel(key).catch((err: unknown) => {
      setError(fail(err));
    });
  }, [fail]);

  const adopt = useCallback(
    (proposalId: string, opIds: string[], revision: number): Promise<boolean> => {
      const key = keyRef.current;
      if (key === null) return Promise.resolve(false);
      setError(null);
      return apiRef.current
        .draftAdopt(key, proposalId, opIds, revision)
        .then((view) => {
          if (keyRef.current === view.docKey) reload();
          return true;
        })
        .catch((err: unknown) => {
          if (keyRef.current !== key) return false;
          if (errorCodeOf(err) === "draft.stale") {
            // 기대 개정이 어긋났다 — 초안과 대화를 다시 읽고 한 줄로 알린다(2026-10-23 · 최종 구현 계획 F1).
            reload();
            setNotice(L.drafts.staleReloaded);
          } else {
            setError(fail(err));
          }
          return false;
        });
    },
    [fail, reload],
  );

  const reject = useCallback(
    (proposalId: string, opIds?: string[]): Promise<boolean> => {
      const key = keyRef.current;
      if (key === null) return Promise.resolve(false);
      setError(null);
      return apiRef.current
        .draftReject(key, proposalId, opIds)
        .then((next) => {
          if (keyRef.current === next.docKey) {
            haveRef.current = true;
            setThread(next);
            setPhase("ready");
          }
          return true;
        })
        .catch((err: unknown) => {
          setError(fail(err));
          return false;
        });
    },
    [fail],
  );

  const clearNotice = useCallback(() => setNotice(null), []);

  return {
    thread,
    phase,
    running,
    streamText,
    reads,
    error,
    notice,
    ask,
    cancel,
    adopt,
    reject,
    reload,
    retry: reload,
    clearNotice,
  };
}
