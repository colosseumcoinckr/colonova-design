import type { DraftSummary } from "@colonova-design/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Daemon, PlanDocComment } from "../../lib/daemon-client";
import type { PlanDoc, PlanFolder, PlanImportEnd, PlanUnsupported } from "./plans-list";

/**
 * 기획서 칸의 판(2026-10-18 기획서 동기화 1단계 · M4, 같은 날 개선 패스) — 원장 목록과 열린 문서,
 * 가져오기. 칸은 처음 연 뒤로 마운트된 채 숨는다(열린 문서 · 찾는 말 · 목록 자리가 살아 있게) —
 * 그래서 호출 손은 모두 `daemon.api` 가 아니라 늘 최신인 ref 를 읽어, 앱이 다시 그려질 때마다(`daemon`
 * 은 렌더마다 새 겉모습이다) 손의 정체가 바뀌어 목록을 다시 읽는 일이 없다.
 */

export type PlanPhase = "idle" | "loading" | "ready" | "failed";

/** 열린 문서의 몸 — `doc.read` 의 답. */
export interface PlanDocBody {
  markdown: string;
  sections: Array<{ heading: string; macro: boolean }>;
  /** 안 풀린 코멘트 — 읽지 못했으면 null(원장의 수가 대신하지 않고 칸이 한 줄로 알린다). id · 종류 ·
   * 판은 코멘트 쓰기의 재료다(2026-10-23 · 최종 구현 계획 F4). */
  comments: PlanDocComment[] | null;
}

export interface PlansState {
  /** 원장 목록 — 아직 읽기 전이면 null, 읽었는데 아무것도 없으면 빈 배열이다. */
  docs: PlanDoc[] | null;
  /** Confluence 폴더 — 문서와 같은 나눔 경로로 목록에 폴더 줄을 세운다. */
  folders: PlanFolder[];
  /** 이 앱이 열지 못하는 Confluence 전용 항목(화이트보드 · 데이터베이스 등) — 읽기 전용 줄이다. */
  unsupported: PlanUnsupported[];
  /** 초안 요약 — 문서 줄의 `초안` 칩과 목록 맨 위의 새 문서 초안 묶음이 읽는다. */
  drafts: DraftSummary[];
  listPhase: PlanPhase;
  /** 열린 문서의 pageId — 본문이 오기 전에도 선다(제목은 목록이 안다). */
  openId: string | null;
  doc: PlanDocBody | null;
  docPhase: PlanPhase;
  importing: boolean;
  importEnd: PlanImportEnd | null;
}

const INITIAL: PlansState = {
  docs: null,
  folders: [],
  unsupported: [],
  drafts: [],
  listPhase: "idle",
  openId: null,
  doc: null,
  docPhase: "idle",
  importing: false,
  importEnd: null,
};

/** 가져오기의 끝 표시가 머무는 시간 — 한참 뒤에 `이미 최신이에요` 가 남아 있으면 오해가 된다. */
const END_SHOWN_MS = 8000;

export interface PlansHand {
  state: PlansState;
  /** 처음으로 — 프로젝트가 바뀔 때. 열린 문서를 닫고 목록을 다시 읽는다. */
  reset: () => void;
  /** 목록을 조용히 다시 읽는다 — 이미 읽은 목록은 지우지 않고, 읽는 중이면 건너뛴다. */
  refreshList: () => void;
  /** 열린 문서를 조용히 다시 읽는다(2026-10-23 · 최종 구현 계획 F4) — 코멘트 쓰기가 마친 뒤 답만 바꾼다. */
  refreshDoc: (pageId: string) => void;
  openDoc: (pageId: string) => void;
  closeDoc: () => void;
  importNow: () => void;
}

export function usePlans(daemon: Daemon): PlansHand {
  const [state, setState] = useState<PlansState>(INITIAL);
  const apiRef = useRef(daemon.api);
  apiRef.current = daemon.api;
  const eventsRef = useRef(daemon.onDraftEvent);
  eventsRef.current = daemon.onDraftEvent;
  // 늦게 온 답을 버리는 번호 — 문서 A 를 읽는 중에 B 를 열면 A 의 답이 B 의 자리를 덮지 않게.
  const listSeq = useRef(0);
  const docSeq = useRef(0);
  const draftSeq = useRef(0);
  const listBusy = useRef(false);
  const endTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(endTimer.current), []);

  /** 초안 요약을 조용히 다시 읽는다 — 못 읽으면 이전 것을 그대로 둔다(칩은 곁가지다). */
  const loadDrafts = useCallback(() => {
    draftSeq.current += 1;
    const seq = draftSeq.current;
    apiRef.current
      .draftList()
      .then((drafts) => {
        if (seq !== draftSeq.current) return;
        setState((before) => ({ ...before, drafts }));
      })
      .catch(() => {
        // 칩이 사라지는 것보다 오래된 칩이 낫다.
      });
  }, []);

  const loadList = useCallback(
    (quiet: boolean) => {
      loadDrafts();
      listSeq.current += 1;
      const seq = listSeq.current;
      listBusy.current = true;
      setState((before) =>
        quiet && before.docs !== null ? before : { ...before, listPhase: "loading" },
      );
      apiRef.current
        .docList()
        .then((reply) => {
          if (seq !== listSeq.current) return;
          listBusy.current = false;
          setState((before) => ({
            ...before,
            docs: reply.docs ?? [],
            folders: reply.folders ?? [],
            unsupported: reply.unsupported ?? [],
            listPhase: "ready",
          }));
        })
        .catch(() => {
          if (seq !== listSeq.current) return;
          listBusy.current = false;
          // 이미 읽어 둔 목록은 조용한 새로 고침의 실패로 지우지 않는다.
          setState((before) => ({
            ...before,
            listPhase: quiet && before.docs !== null ? "ready" : "failed",
          }));
        });
    },
    [loadDrafts],
  );

  const reset = useCallback(() => {
    docSeq.current += 1;
    window.clearTimeout(endTimer.current);
    setState(INITIAL);
    loadList(false);
  }, [loadList]);

  const refreshList = useCallback(() => {
    if (!listBusy.current) loadList(true);
  }, [loadList]);

  const openDoc = useCallback((pageId: string) => {
    docSeq.current += 1;
    const seq = docSeq.current;
    setState((before) => ({ ...before, openId: pageId, doc: null, docPhase: "loading" }));
    apiRef.current
      .docRead(pageId)
      .then((doc) => {
        if (seq !== docSeq.current) return;
        setState((before) => ({ ...before, doc, docPhase: "ready" }));
      })
      .catch(() => {
        if (seq !== docSeq.current) return;
        setState((before) => ({ ...before, docPhase: "failed" }));
      });
  }, []);

  // 문서를 조용히 다시 읽는다(2026-10-23 · 최종 구현 계획 F4) — openDoc 과 달리 단계를 loading 으로
  // 돌리지 않는다. 지금 문서가 그대로 보이다가 새 답이 오면 바뀐다. 실패하면 지금 화면을 지키고 아무
  // 일도 없다(다음 열기가 다시 읽는다). 다른 문서로 옮겨 간 뒤 늦게 온 답은 버린다.
  const refreshDoc = useCallback((pageId: string) => {
    docSeq.current += 1;
    const seq = docSeq.current;
    apiRef.current
      .docRead(pageId)
      .then((doc) => {
        if (seq !== docSeq.current) return;
        setState((before) =>
          before.openId === pageId ? { ...before, doc, docPhase: "ready" } : before,
        );
      })
      .catch(() => {
        // 조용한 다시 읽기의 실패는 화면에 알리지 않는다 — 지금 화면이 옳다.
      });
  }, []);

  const closeDoc = useCallback(() => {
    docSeq.current += 1;
    setState((before) => ({ ...before, openId: null, doc: null, docPhase: "idle" }));
  }, []);

  const importNow = useCallback(() => {
    window.clearTimeout(endTimer.current);
    setState((before) => ({ ...before, importing: true, importEnd: null }));
    const finish = (importEnd: PlanImportEnd) => {
      setState((before) => ({ ...before, importing: false, importEnd }));
      endTimer.current = window.setTimeout(
        () => setState((before) => ({ ...before, importEnd: null })),
        END_SHOWN_MS,
      );
    };
    // 같은 종류가 이미 도는 중이면 데몬이 그 바퀴에 합류시킨다 — 끝나면 목록도 다시 읽는다.
    apiRef.current
      .confluenceImportNow()
      .then((result) => {
        finish({ kind: "done", imported: result.imported, capped: result.capped });
        loadList(true);
      })
      .catch(() => finish({ kind: "failed" }));
  }, [loadList]);

  // 초안이 바뀌면(어느 창에서든) 요약을 다시 읽는다 — 칩과 새 문서 초안 묶음이 이것으로 움직인다.
  useEffect(
    () =>
      eventsRef.current((message) => {
        if (message.type === "draft.changed") loadDrafts();
      }),
    [loadDrafts],
  );

  return { state, reset, refreshList, openDoc, closeDoc, refreshDoc, importNow };
}
