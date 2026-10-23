import type { DocOpResult, ProjectSummary } from "@colonova-design/protocol";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { PLANS_OPEN_EVENT, takePlanOpen } from "../chat/plan-ref-strip";
import { L } from "../labels";
import type { ShellNav } from "../slots";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  RefreshIcon,
  Spin,
  TrashIcon,
} from "../ui/icons";
import { TrashDialog } from "./doc-actions/TrashDialog";
import { DraftEditor } from "./draft/DraftEditor";
import { NewDraftDialog } from "./draft/NewDraftDialog";
import { escapeOwnedByLayer } from "./escape-layer";
import { PlanDocView } from "./PlanDocView";
import { PlansList } from "./PlansList";
import { planRows, syncLine } from "./plans-list";
import { usePlans } from "./use-plans";

/**
 * 기획서 칸(2026-10-18 기획서 동기화 1단계 · M4, 같은 날 개선 패스) — 오른쪽 칸의 두 번째 얼굴. 위 막대의
 * 이어 보기(미리보기 › 기획서 › 문서) · 가져오기 줄 · 목록 · 문서 한 장. 읽기만 하는 칸이다: 고치는 곳은
 * Confluence 다. 처음 열린 뒤로는 마운트된 채 숨는다(`offstage`) — 열린 문서 · 찾는 말이 미리보기로 갔다
 * 돌아와도 그대로이고, 칸이 앞에 설 때마다 목록은 조용히 새로 읽힌다.
 */
export function PlansColumn({
  daemon,
  project,
  nav,
  offstage = false,
}: {
  daemon: Daemon;
  project: ProjectSummary | null;
  nav: ShellNav;
  offstage?: boolean;
}) {
  const { state, reset, refreshList, openDoc, closeDoc, refreshDoc, importNow } = usePlans(daemon);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  // 마지막으로 본 문서 — 목록에서 줄이 눈에 뜨고, 문서를 닫으면 초점이 그 줄로 돌아온다.
  const [lastViewed, setLastViewed] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  // 초안 편집기(2026-10-23 · 최종 구현 계획 F1) — 열린 문서 대신 서서 블록을 고친다. 초안의 열쇠로
  // 연다(기존 문서는 `p-<pageId>`, 새 문서 초안은 그 문서의 열쇠).
  const [draftKey, setDraftKey] = useState<string | null>(null);
  // 새 문서 창(2026-10-23 · 최종 구현 계획 F2) — 목록 머리의 `새 문서` 가 연다.
  const [newDraftOpen, setNewDraftOpen] = useState(false);
  // 휴지통 창(2026-10-23 · 최종 구현 계획 F4) — 목록 머리의 `휴지통` 이 연다.
  const [trashOpen, setTrashOpen] = useState(false);

  const slug = project?.slug ?? null;
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

  // 프로젝트가 바뀌면 처음으로 — 목록 · 열린 문서 · 찾는 말 · 마지막으로 본 문서는 각 프로젝트의 몫이다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 프로젝트가 바뀔 때만
  useEffect(() => {
    reset();
    setQuery("");
    setCollapsed(new Set());
    setLastViewed(null);
    setFocusId(null);
    setDraftKey(null);
    setNewDraftOpen(false);
  }, [slug]);

  // 칸이 앞에 서면 목록을 조용히 다시 읽는다 — 숨어 있는 동안 자동 가져오기가 돌았을 수 있다.
  useEffect(() => {
    if (!offstage) refreshList();
  }, [offstage, refreshList]);
  // 자동 가져오기의 끝(방송된 마지막 가져온 시각이 바뀐다)도 같다.
  const lastImportAt = summary?.lastImportAt ?? null;
  useEffect(() => {
    if (lastImportAt !== null) refreshList();
  }, [lastImportAt, refreshList]);

  const open = (pageId: string) => {
    setDraftKey(null);
    setLastViewed(pageId);
    openDoc(pageId);
  };
  // 목록 · Esc · 문서의 목록 단추 — 초안을 고치는 중이면 편집기를 거두고 목록으로.
  const back = () => {
    setDraftKey(null);
    closeDoc();
    if (lastViewed !== null) setFocusId(lastViewed);
  };
  // 편집기의 닫기 — 읽는 화면으로 돌아온다.
  const closeDraft = useCallback(() => setDraftKey(null), []);
  const toggle = (pageId: string) =>
    setCollapsed((before) => {
      const next = new Set(before);
      if (!next.delete(pageId)) next.add(pageId);
      return next;
    });
  const clearFocus = useCallback(() => setFocusId(null), []);

  // 근거 칩이 돌아가는 길(2026-10-23 · 최종 구현 계획 F3 · 작업 F3b) — 화면 대화의 근거 줄이
  // 그 문서 · 초안을 청한다. 받았다고 알리면(preventDefault) 보내는 쪽이 오른쪽 칸을 기획서로
  // 바꾼다. 숨어 있어도 듣는다 — 마운트된 칸이 state 를 바꾸고 이음이 앞에 세운다.
  const openTarget = useCallback(
    (detail: { pageId?: unknown; docKey?: unknown }) => {
      const pageId = typeof detail?.pageId === "string" ? detail.pageId : null;
      const docKey = typeof detail?.docKey === "string" ? detail.docKey : null;
      if (docKey !== null) {
        // 초안의 편집기 — 기존 문서의 초안은 `p-<pageId>` 열쇠로, 새 문서 초안은 그 문서의 열쇠로.
        setDraftKey(docKey);
        return;
      }
      if (pageId === null) return;
      setDraftKey(null);
      setLastViewed(pageId);
      openDoc(pageId);
    },
    [openDoc],
  );
  useEffect(() => {
    const onPlanOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ pageId?: unknown; docKey?: unknown }>).detail;
      const pageId = typeof detail?.pageId === "string" ? detail.pageId : null;
      const docKey = typeof detail?.docKey === "string" ? detail.docKey : null;
      if (pageId === null && docKey === null) return;
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

  // 문서 관리가 마쳤음 — 목록을 다시 읽고, 복제면 새 문서를 열고, 휴지통이면 목록으로 돌아온다.
  const onDocApplied = (result: DocOpResult) => {
    refreshList();
    if (result.op === "copy" && result.pageId !== null) open(result.pageId);
    else if (result.op === "trash") back();
  };

  const sync = syncLine(summary, state.importing, state.importEnd);
  const docOpen = state.openId !== null;
  const editingDraft = draftKey !== null;
  // 이어 보기의 이름표 — 열린 문서 · 새 문서 초안의 이름 순으로 읽는다.
  const crumbTitle = openRow?.title ?? draftSummary?.title ?? L.drafts.newDoc;
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // 문서 위에서 Esc 는 목록으로 — 찾기 칸의 Esc(찾는 말 지우기)가 먼저 이기도록 이미 처리된 것은 건너뛴다.
    if (event.key !== "Escape" || event.defaultPrevented || !docOpen) return;
    // 창 · 메뉴가 열려 있으면 그것의 Esc 다 — 그 처리기는 문서 단위라 이 칸보다 늦게 돈다(2026-10-23 화면 확인).
    if (escapeOwnedByLayer()) return;
    event.preventDefault();
    back();
  };

  return (
    <section
      className={`nx-plans${offstage ? " nx-offstage" : ""}`}
      aria-hidden={offstage}
      aria-label={L.plans.listHeading}
      onKeyDown={onKeyDown}
    >
      <header className="nx-pl-bar">
        <nav className="nx-pl-crumbs" aria-label={L.plans.crumbNav}>
          <button
            type="button"
            className="nx-pl-crumb nx-pl-crumb--btn"
            title={L.plans.backToScreen}
            onClick={() => nav.showPane("preview")}
          >
            <ArrowLeftIcon />
            {L.plans.crumbPreview}
          </button>
          <span className="nx-pl-sep" aria-hidden="true">
            <ChevronRightIcon />
          </span>
          {docOpen || editingDraft ? (
            <>
              <button type="button" className="nx-pl-crumb nx-pl-crumb--btn" onClick={back}>
                {L.plans.listHeading}
              </button>
              <span className="nx-pl-sep" aria-hidden="true">
                <ChevronRightIcon />
              </span>
              <span className="nx-pl-crumb nx-pl-crumb--here" aria-current="page">
                {crumbTitle}
                {editingDraft && <span className="nx-dr-chip">{L.drafts.chip}</span>}
              </span>
            </>
          ) : (
            <h2 className="nx-pl-crumb nx-pl-crumb--here">{L.plans.listHeading}</h2>
          )}
        </nav>
        {connected && (
          <>
            <button
              type="button"
              className="nx-ibtn nx-ibtn--sm nx-pl-trash"
              aria-label={L.docOps.trashList}
              title={L.docOps.trashList}
              onClick={() => setTrashOpen(true)}
            >
              <TrashIcon />
            </button>
            <button
              type="button"
              className="nx-btn nx-btn--sm nx-pl-newdoc"
              // 연결이 끊겼으면 만들어도 Confluence 에 닿지 않는다 — 길은 설정의 다시 연결 하나다.
              disabled={summary.expired}
              onClick={() => setNewDraftOpen(true)}
            >
              <PlusIcon />
              {L.drafts.newDoc}
            </button>
            <button
              type="button"
              className="nx-btn nx-btn--sm nx-pl-import"
              // 연결이 끊겼으면 가져와도 진다 — 길은 아래 줄의 `설정 열기` 하나다.
              disabled={state.importing || summary.expired}
              onClick={importNow}
              title={L.plans.importNow}
            >
              {state.importing ? <Spin /> : <RefreshIcon />}
              <span className="nx-pl-import-t">
                {state.importing ? L.plans.importing : L.plans.importNow}
              </span>
            </button>
          </>
        )}
      </header>

      {connected && (
        <div className={`nx-pl-sync nx-pl-sync--${sync.tone}`} role="status">
          <span>{sync.text}</span>
          {summary.expired && (
            <button type="button" className="nx-btn nx-btn--sm" onClick={nav.openSettings}>
              {L.plans.openSettings}
            </button>
          )}
        </div>
      )}

      <PlansList
        rows={rows}
        drafts={state.drafts}
        phase={state.listPhase}
        connected={connected}
        rooted={summary?.rootTitle != null}
        expired={summary?.expired === true}
        importing={state.importing}
        query={query}
        onQuery={setQuery}
        collapsed={collapsed}
        onToggle={toggle}
        lastViewed={lastViewed}
        onOpen={open}
        onOpenDraft={(docKey) => setDraftKey(docKey)}
        onRetry={refreshList}
        onImport={importNow}
        onSettings={nav.openSettings}
        hidden={docOpen || editingDraft}
        focusId={focusId}
        onFocused={clearFocus}
      />
      {editingDraft && draftKey !== null ? (
        <div className="nx-pl-view">
          <DraftEditor
            key={draftKey}
            daemon={daemon}
            docKey={draftKey}
            site={summary?.site ?? null}
            nav={nav}
            onClose={closeDraft}
          />
        </div>
      ) : state.openId !== null ? (
        <div className="nx-pl-view">
          <PlanDocView
            key={state.openId}
            pageId={state.openId}
            row={openRow}
            site={summary?.site ?? null}
            phase={state.docPhase}
            doc={state.doc}
            draft={state.drafts.find((one) => one.pageId === state.openId) ?? null}
            daemon={daemon}
            nav={nav}
            rows={rows}
            onRetry={() => openDoc(state.openId as string)}
            onBack={back}
            onEdit={(pageId) => setDraftKey(`p-${pageId}`)}
            onApplied={onDocApplied}
            onRefresh={refreshDoc}
          />
        </div>
      ) : null}
      {newDraftOpen && (
        <NewDraftDialog
          daemon={daemon}
          rows={rows}
          onImport={importNow}
          onClose={() => setNewDraftOpen(false)}
          onCreated={(view) => {
            setNewDraftOpen(false);
            setDraftKey(view.docKey);
          }}
        />
      )}
      {trashOpen && (
        <TrashDialog
          daemon={daemon}
          onApplied={() => refreshList()}
          onClose={() => setTrashOpen(false)}
        />
      )}
    </section>
  );
}
