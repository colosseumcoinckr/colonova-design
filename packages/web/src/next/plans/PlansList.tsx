import type { DraftSummary } from "@colonova-design/protocol";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { L } from "../labels";
import { ChevronRightIcon, CloseIcon, SearchIcon, Spin } from "../ui/icons";
import { draftsInProgress } from "./home-drafts";
import { PlansEmpty as Empty } from "./PlansEmpty";
import { filterPlanRows, type PlanListRow, visiblePlanRows } from "./plans-list";
import type { PlanPhase } from "./use-plans";

/** 찾기 · 작성 중인 초안 · 문서 트리. 자리를 옮겨도 접힘과 스크롤을 지킨다(2026-10-23 화면 전면 재설계 §3.2). */

/** 줄에 붙일 초안 칩의 글 — 결과를 모르면 `결과 확인 필요` 로, 바뀜이 있으면 수를 더한다. */
function draftChipText(draft: DraftSummary): string {
  if (draft.state === "result-unknown") return L.drafts.resultUnknownTitle;
  return draft.changedBlocks > 0 ? L.drafts.chipCount(draft.changedBlocks) : L.drafts.chip;
}

export function PlansList({
  rows,
  drafts,
  phase,
  connected,
  rooted,
  expired,
  importing,
  query,
  onQuery,
  collapsed,
  onToggle,
  lastViewed,
  onOpen,
  onOpenDraft,
  onRetry,
  onImport,
  onSettings,
  hidden,
  focusId,
  onFocused,
  compact = false,
  activeDraftKey,
}: {
  rows: PlanListRow[];
  /** 초안 요약 — 문서 줄의 칩과 목록 맨 위의 새 문서 초안 묶음이 읽는다. */
  drafts: DraftSummary[];
  phase: PlanPhase;
  /** 프로젝트에 기획서 연결이 있는가. */
  connected: boolean;
  /** 기준 페이지를 정했는가 — 가져올 곳이 있어야 `새로 가져오기` 가 길이 된다. */
  rooted: boolean;
  /** 연결이 끊겼는가(만료) — 가져와도 지므로 길은 설정의 다시 연결 하나다. */
  expired: boolean;
  importing: boolean;
  query: string;
  onQuery: (next: string) => void;
  collapsed: ReadonlySet<string>;
  onToggle: (pageId: string) => void;
  lastViewed: string | null;
  onOpen: (pageId: string) => void;
  /** 새 문서 초안 줄 — 그 초안의 편집기를 연다. */
  onOpenDraft: (docKey: string) => void;
  onRetry: () => void;
  onImport: () => void;
  onSettings: () => void;
  /** 다른 자리로 가서 목록이 숨는 중이다. */
  hidden: boolean;
  /** 문서 보기에서 Esc 를 누르면 초점을 받을 줄. */
  focusId: string | null;
  onFocused: () => void;
  compact?: boolean;
  activeDraftKey?: string | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const tree = useRef<HTMLUListElement>(null);
  const savedTop = useRef(0);
  const filtering = query.trim() !== "";
  const shown = filtering ? filterPlanRows(rows, query) : visiblePlanRows(rows, collapsed);
  // 문서 수는 문서 줄만 센다 — 폴더 · Confluence 전용 항목은 문서가 아니다.
  const docTotal = rows.reduce((count, row) => (row.kind === "doc" ? count + 1 : count), 0);
  // 초안 요약 — 문서 줄의 칩은 pageId 로 걷고, 아직 Confluence 에 없는 초안은 맨 위 묶음으로 선다.
  const draftByPage = new Map<string, DraftSummary>();
  const freshDrafts = draftsInProgress(drafts).slice(0, 5);
  for (const draft of drafts) {
    if (draft.pageId !== null) draftByPage.set(draft.pageId, draft);
  }

  // 숨은 목록은 스크롤 자리를 잃는다 — 눈에 보이는 동안 기억했다가 다시 나타날 때 되돌린다.
  useLayoutEffect(() => {
    if (!hidden && scroller.current) scroller.current.scrollTop = savedTop.current;
  }, [hidden]);

  // Esc 는 열린 문서를 지키고 트리의 같은 줄로 초점을 돌린다.
  useEffect(() => {
    if (hidden || focusId === null) return;
    const node = tree.current?.querySelector<HTMLElement>(
      `[data-page-id="${CSS.escape(focusId)}"]`,
    );
    if (node) node.focus({ preventScroll: false });
    onFocused();
  }, [hidden, focusId, onFocused]);

  const onTreeKey = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const row = (event.target as HTMLElement).closest<HTMLButtonElement>(".nx-pl-row");
    if (row === null) return;
    // 전용 항목의 읽기 전용 줄은 단추가 아니다 — 화살표 걸음은 단추 줄만 밟는다.
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button.nx-pl-row"),
    );
    const at = buttons.indexOf(row);
    let to: number;
    if (event.key === "ArrowDown") to = Math.min(at + 1, buttons.length - 1);
    else if (event.key === "ArrowUp") to = Math.max(at - 1, 0);
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = buttons.length - 1;
    else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      // 폴더 줄은 오른쪽 화살표로 펼치고 왼쪽 화살표로 접는다.
      const fold = row.dataset.fold;
      const id = row.dataset.pageId;
      const wanted = event.key === "ArrowRight" ? "closed" : "open";
      if (id !== undefined && fold === wanted) {
        event.preventDefault();
        onToggle(id);
      }
      return;
    } else return;
    event.preventDefault();
    buttons[to]?.focus();
  };

  const draftGroup = freshDrafts.length > 0 && (
    <details className="nx-pl-fresh" open>
      <summary className="nx-pl-fresh-t">
        <ChevronRightIcon />
        {L.plans.draftsInProgress}
      </summary>
      <ul className="nx-pl-fresh-list">
        {freshDrafts.map((draft) => {
          const current = activeDraftKey === draft.docKey;
          const inTree = rows.some((row) => row.kind === "doc" && row.pageId === draft.pageId);
          return (
            <li key={draft.docKey}>
              <button
                type="button"
                className={`nx-pl-row${current ? (inTree ? " nx-pl-row--current" : " nx-pl-row--on") : ""}`}
                aria-current={current && !inTree ? "true" : undefined}
                aria-label={
                  draft.pageId === null ? `${draft.title} · ${L.drafts.newDraftGroup}` : undefined
                }
                title={draft.title}
                onClick={() => onOpenDraft(draft.docKey)}
              >
                <span className="nx-pl-title">{draft.title}</span>
                <span
                  className={`nx-pill ${draft.state === "result-unknown" ? "nx-pill--amber" : "nx-pill--accent"}`}
                >
                  {draftChipText(draft)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
  let body: ReactNode;
  // 안내 한 장(연결 전 · 비었을 때 · 읽지 못했을 때)은 칸의 세로 한가운데에 선다 — 목록은 위에서부터 선다.
  let centered = true;
  if (compact && rows.length === 0) {
    centered = false;
    body = (
      <p className="nx-pl-note" role="status">
        {!connected
          ? L.plans.statusNotConnected
          : phase === "loading" || phase === "idle"
            ? L.plans.listLoading
            : phase === "failed"
              ? L.plans.listFailed
              : L.plans.docCount(0)}
      </p>
    );
  } else if (!connected) {
    body = (
      <Empty title={L.plans.emptyNoneTitle} body={L.plans.emptyNoneBody}>
        <button type="button" className="nx-btn nx-btn--pri" onClick={onSettings}>
          {L.plans.connectNow}
        </button>
      </Empty>
    );
  } else if (rows.length === 0 && (phase === "idle" || phase === "loading")) {
    centered = false;
    body = (
      <p className="nx-pl-note" role="status">
        <Spin /> {L.plans.listLoading}
      </p>
    );
  } else if (rows.length === 0 && phase === "failed") {
    body = (
      <Empty title={L.plans.listFailed} body={L.plans.listFailedBody}>
        <button type="button" className="nx-btn" onClick={onRetry}>
          {L.plans.retry}
        </button>
      </Empty>
    );
  } else if (rows.length === 0) {
    body = (
      <Empty
        title={L.plans.emptyListTitle}
        body={
          expired
            ? L.plans.emptyListExpired
            : rooted
              ? L.plans.emptyListRooted
              : L.plans.emptyListNoRoot
        }
      >
        {rooted && !expired ? (
          <button
            type="button"
            className="nx-btn nx-btn--pri"
            disabled={importing}
            onClick={onImport}
          >
            {importing ? (
              <>
                <Spin /> {L.plans.importing}
              </>
            ) : (
              L.plans.importNow
            )}
          </button>
        ) : (
          <button type="button" className="nx-btn" onClick={onSettings}>
            {L.plans.openSettings}
          </button>
        )}
      </Empty>
    );
  } else {
    centered = false;
    body = (
      <>
        <div className="nx-pl-find">
          <SearchIcon />
          <input
            className="nx-input nx-pl-find-in"
            type="search"
            value={query}
            placeholder={L.plans.filterPlaceholder}
            aria-label={L.plans.filterLabel}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query !== "") {
                event.preventDefault();
                onQuery("");
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                // 읽기 전용 줄은 초점이 서지 않는다 — 첫 단추 줄로 들어간다.
                tree.current?.querySelector<HTMLElement>("button.nx-pl-row")?.focus();
              }
            }}
          />
          {query !== "" && (
            <button
              type="button"
              className="nx-ibtn nx-ibtn--sm"
              aria-label={L.plans.filterClear}
              title={L.plans.filterClear}
              onClick={() => onQuery("")}
            >
              <CloseIcon />
            </button>
          )}
        </div>
        <p className="nx-pl-count" role="status">
          {filtering ? L.plans.filterResult(shown.length) : L.plans.docCount(docTotal)}
        </p>
        {draftGroup}
        {shown.length === 0 ? (
          <p className="nx-pl-note">{L.plans.filterNone}</p>
        ) : (
          // biome-ignore lint/a11y/noNoninteractiveElementInteractions: 줄 단추들 사이의 화살표 걸음을 한 곳에서 받는다(위임) — 누르는 것은 안의 단추의 몫이다
          <ul
            className="nx-pl-tree"
            ref={tree}
            aria-label={L.plans.treeLabel}
            onKeyDown={onTreeKey}
          >
            {shown.map((row) => {
              const isClosed = collapsed.has(row.pageId);
              const folding = !filtering && row.hasChildren;
              // 문서 줄의 초안 — 칩의 글과 빛은 초안 처지가 정한다.
              const draft = row.kind === "doc" ? (draftByPage.get(row.pageId) ?? null) : null;
              return (
                <li
                  key={row.pageId}
                  className="nx-pl-item"
                  style={{ "--nx-pl-depth": filtering ? 0 : row.depth } as CSSProperties}
                >
                  {folding ? (
                    <button
                      type="button"
                      className={`nx-ibtn nx-ibtn--xs nx-pl-fold${isClosed ? "" : " nx-pl-fold--open"}`}
                      aria-expanded={!isClosed}
                      aria-label={
                        isClosed ? L.plans.foldOpen(row.title) : L.plans.foldClose(row.title)
                      }
                      onClick={() => onToggle(row.pageId)}
                    >
                      <ChevronRightIcon />
                    </button>
                  ) : (
                    // 찾기 결과는 들여쓰기도 접는 단추도 없는 납작한 줄이다 — 빈 자리도 남기지 않는다.
                    !filtering && (
                      <span
                        className="nx-ibtn nx-ibtn--xs nx-pl-fold nx-pl-fold--none"
                        aria-hidden="true"
                      />
                    )
                  )}
                  {row.kind === "unsupported" ? (
                    // Confluence 전용 항목 — 여기서는 열지 못하니 단추 대신 읽기 전용 줄로 선다.
                    <span
                      className="nx-pl-row nx-pl-row--off"
                      title={`${row.title} · ${L.plans.unsupportedKind(row.type ?? "")}`}
                    >
                      <span className="nx-pl-title">{row.title}</span>
                      <span className="nx-pl-kind">{L.plans.unsupportedKind(row.type ?? "")}</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={`nx-pl-row${row.kind === "folder" ? " nx-pl-row--folder" : ""}${
                        lastViewed === row.pageId ? " nx-pl-row--on" : ""
                      }`}
                      data-page-id={row.pageId}
                      data-fold={folding ? (isClosed ? "closed" : "open") : undefined}
                      aria-current={lastViewed === row.pageId ? "true" : undefined}
                      title={row.title}
                      onClick={() =>
                        row.kind === "folder" ? onToggle(row.pageId) : onOpen(row.pageId)
                      }
                    >
                      <span className="nx-pl-title">{row.title}</span>
                      {filtering && row.folder !== "" && (
                        <span className="nx-pl-folder">{row.folder}</span>
                      )}
                      {draft !== null && (
                        <span
                          className={`nx-pill ${draft.state === "result-unknown" ? "nx-pill--amber" : "nx-pill--accent"}`}
                        >
                          {draftChipText(draft)}
                        </span>
                      )}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  }

  return (
    <div
      ref={scroller}
      className={`nx-pl-list${centered ? " nx-pl-list--center" : ""}`}
      hidden={hidden}
      onScroll={(event) => {
        if (!hidden) savedTop.current = event.currentTarget.scrollTop;
      }}
    >
      {rows.length === 0 && draftGroup}
      {body}
    </div>
  );
}
