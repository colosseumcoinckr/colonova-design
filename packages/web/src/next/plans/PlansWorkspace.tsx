import type { DocOpResult, ProjectSummary } from "@colonova-design/protocol";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Daemon } from "../../lib/daemon-client";
import { PLANS_OPEN_EVENT, takePlanOpen } from "../chat/plan-ref-strip";
import { L } from "../labels";
import { initialPlanPage, planRows, selectedPlanPage, syncLine } from "./plans-list";
import { usePlans } from "./use-plans";

/** 트리 · 본문 · 찾기가 한 목록을 읽는다(2026-10-23 화면 전면 재설계 §3.4 · §3.7). */
export function usePlansWorkspace({
  daemon,
  project,
  active,
  paletteOpen = false,
}: {
  daemon: Daemon;
  project: ProjectSummary | null;
  active: boolean;
  paletteOpen?: boolean;
}) {
  const slug = project?.slug ?? null;
  const resetFor = useRef(slug);
  const currentProject = resetFor.current === slug;
  // 프로젝트마다 처음 쓰기 전에는 목록을 읽지 않는다. 찾기는 연결된 프로젝트만 깨운다.
  const [visited, setVisited] = useState<string | null>(null);
  const enabled =
    project?.confluence !== undefined &&
    currentProject &&
    (active || paletteOpen || visited === slug);
  useEffect(() => {
    if (enabled) setVisited(slug);
  }, [enabled, slug]);
  const { state, reset, refreshList, openDoc, closeDoc, refreshDoc, importNow } = usePlans(
    daemon,
    enabled,
  );
  const [focusDoc, setFocusDoc] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  // 마지막 문서를 다시 열고 Esc 로 트리의 같은 줄에 초점을 돌린다.
  const [lastViewed, setLastViewed] = useState<string | null>(null);
  const justTrashed = useRef<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  // 초안 편집기(2026-10-23 · 최종 구현 계획 F1) — 열린 문서 대신 서서 블록을 고친다. 초안의 열쇠로
  // 연다(기존 문서는 `p-<pageId>`, 새 문서 초안은 그 문서의 열쇠).
  const [draftKey, setDraftKey] = useState<string | null>(null);
  // 아직 초안이 없는 문서의 `고치기` — 편집기가 열쇠(`draft.get`)가 아니라 문서(`draft.open`)로 연다. 데몬은 없는 열쇠를
  // 거절하고(「열려 있는 초안이 없습니다」), 초안은 문서로 열 때 처음 생긴다(2026-10-23 기획자 화면 손질에서 찾은 틈 —
  // 견본의 가짜 데몬은 아무 열쇠에나 초안을 돌려줘 가려졌다). 초안이 이미 있으면 그 열쇠로 연다 — 문서가 Confluence 에서
  // 사라져도 이 컴퓨터의 초안은 열린다(정본 §8).
  const [draftPageId, setDraftPageId] = useState<string | null>(null);
  const openDraftKey = useCallback((docKey: string | null) => {
    setDraftPageId(null);
    setDraftKey(docKey);
  }, []);
  // 새 문서 창(2026-10-23 · 최종 구현 계획 F2) — 목록 머리의 `새 문서` 가 연다.
  const [newDraftOpen, setNewDraftOpen] = useState(false);
  // 홈이 청한 새 문서 창 — 목록이 서면 연다(아래 효과 · 2026-10-23 기획자 화면 손질 D4).
  const [newDocPending, setNewDocPending] = useState(false);
  // 휴지통 창(2026-10-23 · 최종 구현 계획 F4) — 목록 머리의 `휴지통` 이 연다.
  const [trashOpen, setTrashOpen] = useState(false);

  const summary = project?.confluence;
  const connected = summary !== undefined;
  const rows = useMemo(
    () => planRows(state.docs ?? [], state.folders, state.unsupported),
    [state.docs, state.folders, state.unsupported],
  );
  const openRow =
    state.openId === null ? null : (rows.find((row) => row.pageId === state.openId) ?? null);
  // 지금 편집기가 보는 초안 — 새 문서 초안은 목록 줄이 없으니 이름표를 요약에서 읽는다.
  const draftSummary =
    draftKey === null ? null : (state.drafts.find((draft) => draft.docKey === draftKey) ?? null);

  const selectedPageId = selectedPlanPage(state.openId, draftKey, draftPageId, state.drafts);

  // 프로젝트가 바뀌면 처음으로 — 목록 · 열린 문서 · 찾는 말 · 마지막으로 본 문서는 각 프로젝트의 몫이다.
  // 마운트 때는 돌지 않는다 — 칸은 처음 상태로 서고, 목록은 아래 「칸이 앞에 서면」 효과가 읽는다. 마운트 때 돌면
  // (StrictMode 의 두 번 실행도 같다) 마운트 직후 맡겨 둔 열기(근거 칩 · 홈의 초안 줄)가 방금 연 초안 · 문서를
  // 지웠다(2026-10-23 기획자 화면 손질에서 찾은 틈).
  // biome-ignore lint/correctness/useExhaustiveDependencies: 프로젝트가 바뀔 때만
  useEffect(() => {
    if (resetFor.current === slug) return;
    resetFor.current = slug;
    reset();
    setVisited(null);
    setQuery("");
    setFocusDoc(false);
    setCollapsed(new Set());
    setLastViewed(null);
    justTrashed.current = null;
    setFocusId(null);
    openDraftKey(null);
    setNewDraftOpen(false);
    setNewDocPending(false);
    setTrashOpen(false);
  }, [slug]);

  // 칸이 앞에 서면 목록을 조용히 다시 읽는다 — 숨어 있는 동안 자동 가져오기가 돌았을 수 있다.
  useEffect(() => {
    if (active && enabled) refreshList();
  }, [active, enabled, refreshList]);
  // 자동 가져오기의 끝(방송된 마지막 가져온 시각이 바뀐다)도 같다.
  const lastImportAt = summary?.lastImportAt ?? null;
  useEffect(() => {
    if (enabled && lastImportAt !== null) refreshList();
  }, [lastImportAt, enabled, refreshList]);

  const open = (pageId: string) => {
    setFocusDoc(true);
    openDraftKey(null);
    setLastViewed(pageId);
    openDoc(pageId);
  };
  // 문서는 남기고 트리의 같은 줄로 초점을 옮긴다(2026-10-23 화면 전면 재설계 §3.4).
  const back = () => {
    const id = selectedPageId ?? (draftKey === null ? lastViewed : null);
    if (id === null) return;
    setQuery("");
    setCollapsed((before) => {
      const next = new Set(before);
      const at = rows.findIndex((row) => row.pageId === id);
      let depth = rows[at]?.depth ?? 0;
      for (let i = at - 1; i >= 0 && depth > 0; i -= 1) {
        const row = rows[i];
        if (row && row.depth < depth) {
          next.delete(row.pageId);
          depth = row.depth;
        }
      }
      return next;
    });
    setFocusId(id);
  };
  // 편집기의 닫기 — 읽는 화면으로 돌아온다.
  const closeDraft = useCallback(() => openDraftKey(null), [openDraftKey]);
  // 문서 보기의 `고치기` · `초안 이어 쓰기` — 초안이 있으면 그 열쇠로, 없으면 문서로 연다(위 `draftPageId`).
  const editDoc = (pageId: string) => {
    const existing = state.drafts.find((one) => one.pageId === pageId);
    if (existing !== undefined) {
      openDraftKey(existing.docKey);
      return;
    }
    setDraftPageId(pageId);
    setDraftKey(`p-${pageId}`);
  };
  const toggle = (pageId: string) =>
    setCollapsed((before) => {
      const next = new Set(before);
      if (!next.delete(pageId)) next.add(pageId);
      return next;
    });
  const clearFocus = useCallback(() => setFocusId(null), []);

  // 근거 칩이 돌아가는 길(2026-10-23 · 최종 구현 계획 F3 · 작업 F3b) — 화면 대화의 근거 줄이
  // 그 문서 · 초안을 청한다. 받았다고 알리면(preventDefault) 기획서 자리로 간다.
  // 숨어 있어도 듣는다. 마운트된 칸이 state 를 바꾸고 이음이 앞에 세운다.
  const openTarget = useCallback(
    (detail: { pageId?: unknown; docKey?: unknown; newDoc?: unknown }) => {
      const pageId = typeof detail?.pageId === "string" ? detail.pageId : null;
      const docKey = typeof detail?.docKey === "string" ? detail.docKey : null;
      if (detail?.newDoc === true) {
        // 홈의 `새 문서`(2026-10-23 기획자 화면 손질 D4) — 들어갈 자리를 고를 목록이 선 뒤에 창을 연다. 읽는 동안 열면
        // 창이 「들어갈 자리가 아직 없어요」 를 잠깐 말한다.
        setNewDocPending(true);
        return;
      }
      if (docKey !== null) {
        // 초안의 편집기 — 기존 문서의 초안은 `p-<pageId>` 열쇠로, 새 문서 초안은 그 문서의 열쇠로.
        openDraftKey(docKey);
        return;
      }
      if (pageId === null) return;
      openDraftKey(null);
      setFocusDoc(true);
      setLastViewed(pageId);
      openDoc(pageId);
    },
    [openDoc, openDraftKey],
  );
  useEffect(() => {
    const onPlanOpen = (event: Event) => {
      const detail = (
        event as CustomEvent<{ pageId?: unknown; docKey?: unknown; newDoc?: unknown }>
      ).detail;
      const pageId = typeof detail?.pageId === "string" ? detail.pageId : null;
      const docKey = typeof detail?.docKey === "string" ? detail.docKey : null;
      if (pageId === null && docKey === null && detail?.newDoc !== true) return;
      event.preventDefault();
      openTarget(detail);
    };
    window.addEventListener(PLANS_OPEN_EVENT, onPlanOpen);
    return () => window.removeEventListener(PLANS_OPEN_EVENT, onPlanOpen);
  }, [openTarget]);
  // 칩을 눌렀는데 칸이 아직 마운트 전이던 요청(2026-10-23 · R3 발견 4) — 마운트의 첫 몸에서 한 번
  // 꺼내고 비운다. 프로젝트가 바뀌어 다시 마운트하는 일은 없다(마운트된 채 숨는다).
  useEffect(() => {
    const stashed = takePlanOpen();
    if (stashed !== null) openTarget(stashed);
  }, [openTarget]);
  // 기다리던 새 문서 창 — 목록이 섰거나(ready) 못 읽었으면(failed — 창이 가져오기를 건넨다) 연다. 연결이 없으면 접는다.
  useEffect(() => {
    if (!newDocPending) return;
    if (!connected) {
      setNewDocPending(false);
      return;
    }
    if (state.listPhase === "ready" || state.listPhase === "failed") {
      setNewDocPending(false);
      setNewDraftOpen(true);
    }
  }, [newDocPending, connected, state.listPhase]);

  // 휴지통으로 옮긴 문서는 목록의 늦은 갱신으로 다시 열지 않는다(2026-10-23 화면 전면 재설계 §3.4).
  const onDocApplied = (result: DocOpResult) => {
    refreshList();
    if (result.op === "copy" && result.pageId !== null) open(result.pageId);
    else if (result.op === "trash") {
      justTrashed.current = state.openId;
      closeDoc();
      setLastViewed(null);
    }
  };

  const sync = syncLine(summary, state.importing, state.importEnd);
  const docOpen = state.openId !== null;
  const editingDraft = draftKey !== null;
  // 이어 보기의 이름표 — 열린 문서 · 새 문서 초안의 이름 순으로 읽는다.
  const crumbTitle = editingDraft
    ? (draftSummary?.title ?? (draftPageId ? openRow?.title : null) ?? L.drafts.newDoc)
    : (openRow?.title ?? "");

  // 처음에는 기준 문서, 다음에는 마지막 문서를 지킨다. 맡겨 둔 요청이 먼저 이긴다.
  useEffect(() => {
    if (
      !currentProject ||
      !active ||
      !connected ||
      summary?.expired ||
      state.listPhase !== "ready" ||
      state.openId !== null ||
      draftKey !== null ||
      newDocPending
    )
      return;
    const first = initialPlanPage(rows, state.roots, lastViewed, justTrashed.current);
    if (first !== null) {
      setLastViewed(first);
      openDoc(first);
    }
  }, [
    currentProject,
    active,
    connected,
    summary?.expired,
    state.listPhase,
    state.roots,
    state.openId,
    draftKey,
    newDocPending,
    rows,
    lastViewed,
    openDoc,
  ]);

  // 팔레트를 열었고 아직 목록이 없을 때만 읽는다. 이미 읽은 목록은 그대로 쓴다.
  useEffect(() => {
    if (paletteOpen && connected && state.listPhase === "idle") refreshList();
  }, [paletteOpen, connected, state.listPhase, refreshList]);

  return {
    state,
    rows,
    summary,
    focusDoc,
    connected,
    query,
    setQuery,
    collapsed,
    toggle,
    lastViewed,
    focusId,
    clearFocus,
    open,
    back,
    openDoc,
    refreshList,
    refreshDoc,
    importNow,
    draftKey,
    draftPageId,
    draftSummary,
    selectedPageId,
    openDraftKey,
    closeDraft,
    editDoc,
    editingDraft,
    openRow,
    crumbTitle,
    docOpen,
    onDocApplied,
    sync,
    newDraftOpen,
    setNewDraftOpen,
    trashOpen,
    setTrashOpen,
  };
}

export const PlansContext = createContext<ReturnType<typeof usePlansWorkspace> | null>(null);
export function usePlansContext() {
  const value = useContext(PlansContext);
  if (value === null) throw new Error("PlansContext is required");
  return value;
}
