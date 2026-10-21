import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { L } from "../labels";
import { ChevronRightIcon, CloseIcon, PlansEmptyIcon, SearchIcon, Spin } from "../ui/icons";
import { filterPlanRows, type PlanListRow, visiblePlanRows } from "./plans-list";
import type { PlanPhase } from "./use-plans";

/**
 * 기획서 목록(2026-10-18 기획서 동기화 1단계 · M4 개선 패스) — 찾기 칸 · 접을 수 있는 폴더 목록 · 비었을
 * 때의 안내. 문서가 열려 있는 동안에도 마운트된 채 `hidden` 으로 숨는다 — 찾는 말 · 접은 폴더 · 스크롤 자리가
 * 문서를 닫고 돌아왔을 때 그대로다.
 */

function Empty({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="nx-pl-empty">
      <span className="nx-pl-empty-ic" aria-hidden="true">
        <PlansEmptyIcon />
      </span>
      <h3 className="nx-pl-empty-t">{title}</h3>
      <p className="nx-pl-empty-b">{body}</p>
      {children && <div className="nx-pl-empty-act">{children}</div>}
    </div>
  );
}

export function PlansList({
  rows,
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
  onRetry,
  onImport,
  onSettings,
  hidden,
  focusId,
  onFocused,
}: {
  rows: PlanListRow[];
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
  onRetry: () => void;
  onImport: () => void;
  onSettings: () => void;
  /** 문서가 열려 있어 목록이 숨는 중이다. */
  hidden: boolean;
  /** 문서를 닫고 돌아올 때 초점을 받을 줄. */
  focusId: string | null;
  onFocused: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const tree = useRef<HTMLUListElement>(null);
  const savedTop = useRef(0);
  const filtering = query.trim() !== "";
  const shown = filtering ? filterPlanRows(rows, query) : visiblePlanRows(rows, collapsed);

  // 숨은 목록은 스크롤 자리를 잃는다 — 눈에 보이는 동안 기억했다가 다시 나타날 때 되돌린다.
  useLayoutEffect(() => {
    if (!hidden && scroller.current) scroller.current.scrollTop = savedTop.current;
  }, [hidden]);

  // 문서를 닫으면 방금 보던 줄로 초점이 돌아온다 — 키보드로 연 사람이 목록의 맨 위로 떨어지지 않게.
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
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(".nx-pl-row"),
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

  let body: ReactNode;
  // 안내 한 장(연결 전 · 비었을 때 · 읽지 못했을 때)은 칸의 세로 한가운데에 선다 — 목록은 위에서부터 선다.
  let centered = true;
  if (!connected) {
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
            className="nx-pl-find-in"
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
                tree.current?.querySelector<HTMLElement>(".nx-pl-row")?.focus();
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
          {filtering ? L.plans.filterResult(shown.length) : L.plans.docCount(rows.length)}
        </p>
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
              return (
                <li
                  key={row.pageId}
                  className="nx-pl-item"
                  style={{ "--nx-pl-depth": filtering ? 0 : row.depth } as CSSProperties}
                >
                  {!filtering && row.hasChildren ? (
                    <button
                      type="button"
                      className={`nx-pl-fold${isClosed ? "" : " nx-pl-fold--open"}`}
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
                      <span className="nx-pl-fold nx-pl-fold--none" aria-hidden="true" />
                    )
                  )}
                  <button
                    type="button"
                    className={`nx-pl-row${lastViewed === row.pageId ? " nx-pl-row--on" : ""}`}
                    data-page-id={row.pageId}
                    data-fold={
                      !filtering && row.hasChildren ? (isClosed ? "closed" : "open") : undefined
                    }
                    aria-current={lastViewed === row.pageId ? "true" : undefined}
                    title={lastViewed === row.pageId ? L.plans.lastViewed : undefined}
                    onClick={() => onOpen(row.pageId)}
                  >
                    <span className="nx-pl-title">{row.title}</span>
                    {filtering && row.folder !== "" && (
                      <span className="nx-pl-folder">{row.folder}</span>
                    )}
                    <span className="nx-pl-ver">{L.plans.docVersions(row.version)}</span>
                  </button>
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
      {body}
    </div>
  );
}
