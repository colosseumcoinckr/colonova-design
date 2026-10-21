import type { ProjectSummary } from "@colonova-design/protocol";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import type { ShellNav } from "../slots";
import { ArrowLeftIcon, ChevronRightIcon, RefreshIcon, Spin } from "../ui/icons";
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
  const { state, reset, refreshList, openDoc, closeDoc, importNow } = usePlans(daemon);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  // 마지막으로 본 문서 — 목록에서 줄이 눈에 뜨고, 문서를 닫으면 초점이 그 줄로 돌아온다.
  const [lastViewed, setLastViewed] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const slug = project?.slug ?? null;
  const summary = project?.confluence;
  const connected = summary !== undefined;
  const rows = useMemo(() => planRows(state.docs ?? []), [state.docs]);
  const openRow =
    state.openId === null ? null : (rows.find((row) => row.pageId === state.openId) ?? null);

  // 프로젝트가 바뀌면 처음으로 — 목록 · 열린 문서 · 찾는 말 · 마지막으로 본 문서는 각 프로젝트의 몫이다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 프로젝트가 바뀔 때만
  useEffect(() => {
    reset();
    setQuery("");
    setCollapsed(new Set());
    setLastViewed(null);
    setFocusId(null);
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
    setLastViewed(pageId);
    openDoc(pageId);
  };
  const back = () => {
    closeDoc();
    if (lastViewed !== null) setFocusId(lastViewed);
  };
  const toggle = (pageId: string) =>
    setCollapsed((before) => {
      const next = new Set(before);
      if (!next.delete(pageId)) next.add(pageId);
      return next;
    });
  const clearFocus = useCallback(() => setFocusId(null), []);

  const sync = syncLine(summary, state.importing, state.importEnd);
  const docOpen = state.openId !== null;
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // 문서 위에서 Esc 는 목록으로 — 찾기 칸의 Esc(찾는 말 지우기)가 먼저 이기도록 이미 처리된 것은 건너뛴다.
    if (event.key !== "Escape" || event.defaultPrevented || !docOpen) return;
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
          {docOpen ? (
            <>
              <button type="button" className="nx-pl-crumb nx-pl-crumb--btn" onClick={back}>
                {L.plans.listHeading}
              </button>
              <span className="nx-pl-sep" aria-hidden="true">
                <ChevronRightIcon />
              </span>
              <span className="nx-pl-crumb nx-pl-crumb--here" aria-current="page">
                {openRow?.title ?? ""}
              </span>
            </>
          ) : (
            <h2 className="nx-pl-crumb nx-pl-crumb--here">{L.plans.listHeading}</h2>
          )}
        </nav>
        {connected && (
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
        onRetry={refreshList}
        onImport={importNow}
        onSettings={nav.openSettings}
        hidden={docOpen}
        focusId={focusId}
        onFocused={clearFocus}
      />
      {state.openId !== null && (
        <div className="nx-pl-view">
          <PlanDocView
            key={state.openId}
            pageId={state.openId}
            row={openRow}
            site={summary?.site ?? null}
            phase={state.docPhase}
            doc={state.doc}
            onRetry={() => openDoc(state.openId as string)}
            onBack={back}
          />
        </div>
      )}
    </section>
  );
}
