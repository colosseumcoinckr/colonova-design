import type {
  DraftReadRef,
  DraftRefInput,
  DraftThread,
  EffortLevel,
} from "@colonova-design/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Daemon } from "../../../lib/daemon-client";
import { createLatestRequest } from "../../lib/latest-request";

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
  /** 기획 AI 의 모델 · 생각 시간 — 없으면 CLI 기본(2026-10-26 사용자 요청). */
  ask: (
    text: string,
    refs: DraftRefInput[],
    pick?: { model?: string | null; effort?: EffortLevel | null },
    /** 이어 가는 대화 — null 이면 새 기획 대화를 만든다(2026-10-31 3단계). */
    threadId?: string | null,
  ) => Promise<boolean>;
  cancel: () => void;
  reject: (proposalId: string, opIds?: string[]) => Promise<boolean>;
  reload: () => void;
  retry: () => void;
}

export function useDraftThread(
  daemon: Daemon,
  docKey: string | null,
  /** 골라 읽는 대화(2026-11-03) — 사이드바 목록의 줄이 옛 대화를 다시 열 때 쓴다. null · undefined 면 문서의 최신 대화. */
  pickedThreadId?: string | null,
): DraftThreadHand {
  const [thread, setThread] = useState<DraftThread | null>(null);
  // 2026-11-12 UI 조사 U-113 — 전송의 실패도 시작한 문서·대화에만 남는다.
  const askGate = useRef(createLatestRequest<object>()).current;
  const askScope = useMemo(
    () => ({ api: daemon.api, docKey, pickedThreadId }),
    [daemon.api, docKey, pickedThreadId],
  );
  const askScopeRef = useRef(askScope);
  askScopeRef.current = askScope;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 대상을 바꾸거나 떠나면 전송 응답을 무효화한다.
  useEffect(() => () => askGate.invalidate(), [askGate, askScope]);

  const [phase, setPhase] = useState<DraftThreadPhase>("idle");
  const [running, setRunning] = useState(false);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [reads, setReads] = useState<DraftReadRef[]>([]);
  const [error, setError] = useState<string | null>(null);

  const apiRef = useRef(daemon.api);
  apiRef.current = daemon.api;
  const eventsRef = useRef(daemon.onDraftEvent);
  eventsRef.current = daemon.onDraftEvent;
  /** 지금 판이 보는 문서 — 늦게 온 답의 docKey 대조와 방송 거름의 기준이다. */
  const keyRef = useRef<string | null>(docKey);
  keyRef.current = docKey;
  const seqRef = useRef(0);
  const progressSeq = useRef(0);
  const [loadedScope, setLoadedScope] = useState(askScope);
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
    const progress = progressSeq.current;
    apiRef.current
      .draftThread(key, pickedThreadId ?? undefined)
      .then((next) => {
        if (seq !== seqRef.current || keyRef.current !== next.docKey) return;
        haveRef.current = true;
        setThread(next);
        setPhase("ready");
        // 2026-11-12 U-113·114 — 읽는 동안 받은 진행 방송이 더 새롭다.
        if (progress === progressSeq.current) {
          setRunning(next.running);
          if (!next.running) {
            setStreamText(null);
            setReads([]);
          }
        }
        // 읽기가 성공했으면 지난 실패 문장은 거둔다 — 성공한 읽기가 실패의 말보다 새로운 것이다
        // (2026-11-02 실사용 관찰: 고치기 첫 진입의 실패 문장이 초안이 생긴 뒤에도 남았다).
        setError(null);
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return;
        setError(fail(err));
        // 처음 읽기가 실패했을 때만 실패 면으로 — 이미 읽은 대화는 지우지 않는다.
        if (!haveRef.current) setPhase("failed");
      });
    // 골른 대화가 바뀌면 읽기 자체가 달라진다 — 사이드바의 줄이 옛 대화를 다시 여는 길이다(2026-11-03).
  }, [fail, pickedThreadId]);

  // 문서가 열릴 때(문서가 없을 때는 아무것도 하지 않는다) — 편집기가 docKey 를 알아낸 뒤에 연다.
  useEffect(() => {
    seqRef.current += 1;
    progressSeq.current += 1;
    setLoadedScope(askScope);
    setThread(null);
    setRunning(false);
    setStreamText(null);
    setReads([]);
    setError(null);
    haveRef.current = false;
    if (docKey === null) {
      setThread(null);
      setPhase("idle");
      haveRef.current = false;
      return;
    }
    setPhase("loading");
    reload();
    return () => {
      seqRef.current += 1;
    };
  }, [docKey, reload, askScope]);

  // 같은 문서의 방송 — AI 의 진행은 눈으로, 초안의 변화는 대화의 다시 읽기로.
  // biome-ignore lint/correctness/useExhaustiveDependencies: API·대화 범위가 바뀌면 방송 구독도 옮긴다.
  useEffect(
    () =>
      eventsRef.current((message) => {
        if (message.docKey !== keyRef.current) return;
        if (message.type === "draft.changed") {
          reload();
          return;
        }
        // running은 데몬의 문서 단위 잠금이다. 다른 대화의 본문만 숨기고 종료는 받는다.
        if (pickedThreadId != null && message.threadId !== pickedThreadId) {
          progressSeq.current += 1;
          const active =
            message.phase === "started" || message.phase === "text" || message.phase === "read";
          setRunning(active);
          if (!active) {
            setStreamText(null);
            setReads([]);
            reload();
          }
          return;
        }
        progressSeq.current += 1;
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
    [reload, pickedThreadId, askScope],
  );

  const ask = useCallback(
    (
      text: string,
      refs: DraftRefInput[],
      pick?: { model?: string | null; effort?: EffortLevel | null },
      threadId?: string | null,
    ): Promise<boolean> => {
      const key = keyRef.current;
      if (key === null) return Promise.resolve(false);
      const ticket = askGate.begin(askScopeRef.current);
      setError(null);
      return apiRef.current
        .draftAsk(key, text, refs, pick, threadId)
        .then(() => {
          if (!askGate.isCurrent(ticket, askScopeRef.current)) return false;
          reload(); // 사람의 말이 곧 대화에 선다
          return true;
        })
        .catch((err: unknown) => {
          if (askGate.isCurrent(ticket, askScopeRef.current)) setError(fail(err));
          return false;
        });
    },
    [fail, reload, askGate],
  );

  const cancel = useCallback(() => {
    const key = keyRef.current;
    if (key === null) return;
    apiRef.current.draftCancel(key).catch((err: unknown) => {
      setError(fail(err));
    });
  }, [fail]);

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

  return {
    thread: loadedScope === askScope ? thread : null,
    phase: loadedScope === askScope ? phase : docKey === null ? "idle" : "loading",
    running: loadedScope === askScope && running,
    streamText: loadedScope === askScope ? streamText : null,
    reads: loadedScope === askScope ? reads : [],
    error: loadedScope === askScope ? error : null,
    ask,
    cancel,
    reject,
    reload,
    retry: reload,
  };
}
