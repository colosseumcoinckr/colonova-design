import type { DraftConversationSummary } from "@colonova-design/protocol";
import { Ellipsis } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { composing } from "../../lib/ime";
import { linkClick } from "../../lib/open-link";
import { L } from "../labels";
import { groupByDay } from "../lib/thread-groups";
import { useToday } from "../lib/use-today";
import type { ShellNav } from "../slots";
import { InlineConfirm } from "../ui/InlineConfirm";
import {
  ExternalIcon,
  InfoIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  Spin,
  TrashIcon,
} from "../ui/icons";
import { Popover } from "../ui/Popover";
import { PlansList } from "./PlansList";
import { usePlansContext } from "./PlansWorkspace";
import { docUrl, initialPlanPage } from "./plans-list";

/** 줄의 `···` 단추들 — 줄마다 한 객체를 오래 쥔다(ConversationList 와 같은 결). */
const anchorOf = (map: Map<string, { current: HTMLButtonElement | null }>, id: string) => {
  let anchor = map.get(id);
  if (!anchor) {
    anchor = { current: null };
    map.set(id, anchor);
  }
  return anchor;
};

/** 사이드바의 목록 머리 · 트리 · 가져온 때(2026-10-23 화면 전면 재설계 §3.2). */
export function PlansSidebar({
  nav,
  daemon,
  hidden = false,
  sidebarHidden = false,
  onMenuHidden,
  onOpen,
}: {
  nav: ShellNav;
  daemon: Daemon;
  hidden?: boolean;
  sidebarHidden?: boolean;
  onMenuHidden?: () => void;
  onOpen?: () => void;
}) {
  const plans = usePlansContext();
  const { state, summary, connected, rows, sync, conversations, activeThreadId } = plans;
  const [menu, setMenu] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  // float 팝은 사이드바 밖에 있다. 숨김을 직접 받아 닫고 보이는 자리로 초점을 옮긴다(2026-10-24 RS 2).
  useEffect(() => {
    if (!menu || !(hidden || sidebarHidden)) return;
    setMenu(false);
    onMenuHidden?.();
  }, [menu, hidden, sidebarHidden, onMenuHidden]);
  const root = initialPlanPage(rows, state.roots, null);
  const rootLink = summary?.site && root ? docUrl(summary.site, root) : null;
  const warn = sync.tone === "warn" || sync.tone === "bad" || state.listPhase === "failed";
  const run = (action: () => void) => {
    setMenu(false);
    action();
  };
  // 기획 대화의 날짜 묶음(2026-11-03) — 화면 대화 목록과 같은 규칙. 자정이 지나면 useToday 가
  // 갈아 끼워 묶음이 저절로 한 칸씩 밀린다.
  const today = useToday();
  const convGroups = useMemo(
    () => (conversations === null ? [] : groupByDay(conversations, (one) => one.at, today)),
    [conversations, today],
  );
  // 줄 끝 `···` 메뉴와 그 안의 지우기 확인 — 열린 줄의 이름표와 확인을 쥔다.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteBusy = useRef(false);
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const rowAnchors = useRef(new Map<string, { current: HTMLButtonElement | null }>());
  const removeItem = useRef<HTMLButtonElement>(null);
  // 이름 바꾸기(2026-11-03) — 첫 말의 머리로 지은 자동 제목을 줄 안에서 고친다(화면 대화 목록과 같은 결).
  const [renaming, setRenaming] = useState<{ threadId: string; draft: string } | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const renameEnding = useRef(false);
  const renamingId = renaming?.threadId ?? null;
  useEffect(() => {
    if (renamingId !== null) renameInput.current?.select();
  }, [renamingId]);
  // 켜진 줄이 목록의 굴러간 자리 밖이면 보이는 곳으로(2026-11-03) — 화면 대화 목록과 같은 규칙.
  // 위쪽은 붙어 선 묶음 머리(약 24px)가 가리는 만큼 더 올린다.
  const convListRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 켜진 대화가 바뀔 때만 굴린다 — 몸은 지금 눈의 자리를 잰다.
  useEffect(() => {
    const list = convListRef.current;
    const row = list?.querySelector(".nx-pl-conv-row--on");
    if (!list || !row) return;
    const box = list.getBoundingClientRect();
    const at = row.getBoundingClientRect();
    if (at.top < box.top + 24) list.scrollTop -= box.top + 24 - at.top;
    else if (at.bottom > box.bottom - 8) list.scrollTop += at.bottom - box.bottom + 8;
  }, [activeThreadId]);
  // ↑ ↓ Home End — 대화 줄 사이를 오간다(화면 대화 목록과 같은 걸음).
  const moveFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const { key } = event;
    if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return;
    const stops = [
      ...(convListRef.current?.querySelectorAll<HTMLElement>(".nx-pl-conv-btn") ?? []),
    ];
    const at = stops.indexOf(event.currentTarget);
    if (at < 0) return;
    event.preventDefault();
    const next =
      key === "Home" ? 0 : key === "End" ? stops.length - 1 : at + (key === "ArrowDown" ? 1 : -1);
    stops[Math.min(stops.length - 1, Math.max(0, next))]?.focus();
  };
  /** 메뉴 · 이름 바꾸기가 끝난 뒤 초점이 제 줄로 돌아온다 — 손이 이미 다른 곳에 가 있으면 건드리지 않는다. */
  const focusRow = (id: string) =>
    requestAnimationFrame(() => {
      const now = document.activeElement;
      if (now && now !== document.body && !now.classList.contains("nx-pl-conv-menu")) return;
      convListRef.current
        ?.querySelector<HTMLElement>(`.nx-pl-conv-btn[data-thread="${CSS.escape(id)}"]`)
        ?.focus();
    });
  /**
   * 이름 바꾸기의 끝 — 저장이면 흰칸만 다듬어 남기고, 취소(Esc)면 아무것도 쓰지 않는다(화면 대화
   * 목록과 같은 결). 키로 끝나면 초점이 제 줄로 돌아온다.
   */
  const endRename = (save: boolean, byKeys: boolean) => {
    const target = renaming;
    if (!target || renameEnding.current) return;
    renameEnding.current = true;
    setRenaming(null);
    if (byKeys) focusRow(target.threadId);
    const name = target.draft.trim();
    if (!save || !name) return;
    void daemon.api
      .draftThreadRename(target.threadId, name)
      .then(() => plans.refreshConversations())
      .catch((err: unknown) => {
        nav.toast(err instanceof Error ? err.message : String(err));
      });
  };
  useEffect(() => {
    if (menuFor === null && confirmFor === null) return;
    if (!(hidden || sidebarHidden)) return;
    setMenuFor(null);
    setConfirmFor(null);
    onMenuHidden?.();
  }, [menuFor, confirmFor, hidden, sidebarHidden, onMenuHidden]);

  /**
   * 대화 지우기 — 이 컴퓨터의 대화 기록만 지우고 초안은 남는다(draft.threadDelete). 목록은
   * 다시 읽고, 지운 대화가 열려 있으면 대화 칸도 비우라고 알린다(nx:plan-thread-reload).
   */
  const removeConversation = (conv: DraftConversationSummary) => {
    if (deleteBusy.current) return;
    deleteBusy.current = true;
    setDeleting(conv.threadId);
    setDeleteError(null);
    void daemon.api
      .draftThreadDelete(conv.threadId)
      .then(() => {
        setMenuFor(null);
        setConfirmFor(null);
        plans.refreshConversations();
        window.dispatchEvent(new CustomEvent("nx:plan-thread-reload", { detail: conv.threadId }));
        nav.toast(L.convMenu.removeDone);
      })
      .catch((err: unknown) => {
        setDeleteError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        deleteBusy.current = false;
        setDeleting(null);
      });
  };

  const rowBody = (conv: DraftConversationSummary) => {
    // 켜진 줄은 대화를 따른다(2026-11-03) — 한 문서에 대화가 둘 붙으면 문서 일치는 갈라 못 한다.
    // 판이 아직 읽기 전이면(activeThreadId null) 문서 일치로 갈라 본다.
    const on =
      activeThreadId !== null
        ? conv.threadId === activeThreadId
        : conv.docKey !== null &&
          (conv.docKey === plans.draftKey || conv.docKey === `p-${plans.selectedPageId ?? ""}`);
    const menuOpen = menuFor === conv.threadId;
    const confirming = confirmFor === conv.threadId;
    const docName = conv.docTitle === "" ? L.drafts.convNoDoc : conv.docTitle;
    const label = [conv.title, docName, ...(conv.running ? [L.drafts.aiWorking] : [])].join(" · ");
    if (renaming?.threadId === conv.threadId) {
      return (
        <li key={conv.threadId}>
          <div className="nx-pl-conv-row nx-pl-conv-row--menu">
            <input
              ref={renameInput}
              className="nx-input nx-conv-rename"
              value={renaming.draft}
              aria-label={L.convMenu.renameLabel}
              onChange={(event) =>
                setRenaming({ threadId: conv.threadId, draft: event.target.value })
              }
              // 밖을 눌러 빠지면 저장한다 — 초점은 누른 곳에 둔다(키로 끝날 때만 줄로 돌아온다).
              onBlur={() => endRename(true, false)}
              onKeyDown={(event) => {
                // 한글이 조합 중이면 Enter 를 저장으로 읽지 않는다.
                if (composing(event)) return;
                if (event.key === "Enter") endRename(true, true);
                if (event.key === "Escape") endRename(false, true);
              }}
            />
          </div>
        </li>
      );
    }
    return (
      <li key={conv.threadId}>
        <div
          className={`nx-pl-conv-row${on ? " nx-pl-conv-row--on" : ""}${menuOpen ? " nx-pl-conv-row--menu" : ""}`}
        >
          <button
            type="button"
            className="nx-pl-conv-btn"
            title={label}
            aria-label={label}
            aria-current={on ? "true" : undefined}
            data-thread={conv.threadId}
            onClick={() => {
              if (conv.docKey === null) {
                nav.toast(L.drafts.convMissingDoc);
                return;
              }
              // 골른 대화로 다시 열기(2026-11-03) — 문서를 열고 그 대화를 골라 판이 문서의
              // 최신 대화 대신 이 대화를 읽게 한다. 옛 대화를 다시 볼 · 이어 말할 길이다.
              plans.openDraftKey(conv.docKey);
              plans.pickThread(conv.threadId);
              onOpen?.();
            }}
            onKeyDown={moveFocus}
            // 우클릭 — 줄 끝 `···` 와 같은 메뉴가 같은 자리에 뜬다(화면 대화 목록과 같은 규칙).
            onContextMenu={(event) => {
              event.preventDefault();
              if (deleteBusy.current) return;
              setConfirmFor(null);
              setMenuFor(conv.threadId);
            }}
          >
            <span className="nx-pl-conv-t">
              <span>{conv.title}</span>
              {conv.running ? <Spin /> : null}
            </span>
            <span className="nx-pl-conv-m">{docName}</span>
          </button>
          <button
            type="button"
            className="nx-ibtn nx-ibtn--xs nx-pl-conv-menu"
            ref={(element) => {
              anchorOf(rowAnchors.current, conv.threadId).current = element;
            }}
            aria-label={L.drafts.convRowMenu}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={deleting !== null}
            onClick={() => {
              setConfirmFor(null);
              setMenuFor(menuOpen ? null : conv.threadId);
            }}
          >
            <Ellipsis className="nx-i" size={14} aria-hidden="true" />
          </button>
          {menuOpen && (
            <Popover
              anchor={anchorOf(rowAnchors.current, conv.threadId)}
              role={confirming ? "dialog" : "menu"}
              label={confirming ? L.drafts.convRemoveTitle : L.drafts.convRowMenu}
              align="end"
              float
              onClose={() => {
                if (deleteBusy.current) return;
                setMenuFor(null);
                setConfirmFor(null);
              }}
            >
              {confirming ? (
                <InlineConfirm
                  title={L.drafts.convRemoveTitle}
                  body={L.drafts.convRemoveBody}
                  confirmLabel={L.drafts.convDelete}
                  cancelLabel={L.convMenu.removeCancel}
                  onConfirm={() => removeConversation(conv)}
                  busy={deleting === conv.threadId}
                  busyWhy={deleting === conv.threadId ? L.drafts.convDeleting : undefined}
                  onCancel={() => {
                    if (!deleteBusy.current) setConfirmFor(null);
                  }}
                  returnRef={removeItem}
                >
                  {conv.running && <p className="nx-iconf-why">{L.drafts.convRemoveRunning}</p>}
                  {deleteError && (
                    <p className="nx-iconf-error" role="alert">
                      {deleteError}
                    </p>
                  )}
                </InlineConfirm>
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="nx-mi"
                    onClick={() => {
                      setMenuFor(null);
                      renameEnding.current = false;
                      setRenaming({ threadId: conv.threadId, draft: conv.title });
                    }}
                  >
                    <span className="nx-mi-ic">
                      <PencilIcon />
                    </span>
                    <b>{L.convMenu.rename}</b>
                  </button>
                  <div className="nx-msep" />
                  <button
                    type="button"
                    role="menuitem"
                    ref={removeItem}
                    className="nx-mi nx-mi--dng"
                    onClick={() => {
                      setDeleteError(null);
                      setConfirmFor(conv.threadId);
                    }}
                  >
                    <TrashIcon />
                    {L.drafts.convDelete}
                  </button>
                </>
              )}
            </Popover>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="nx-pl-sidebar" hidden={hidden}>
      <div className="nx-side-list-head">
        <h2 title={summary?.rootTitle ?? L.plans.listHeading}>
          {summary?.rootTitle ?? L.plans.listHeading}
        </h2>
        {connected && (
          <>
            <button
              type="button"
              className="nx-btn nx-btn--sm nx-btn--ghost"
              disabled={summary?.expired}
              onClick={() => plans.setNewDraftOpen(true)}
            >
              <PlusIcon />
              {L.drafts.newDoc}
            </button>
            <button
              type="button"
              className="nx-ibtn nx-ibtn--sm"
              ref={anchor}
              title={L.plans.menu}
              aria-label={L.plans.menu}
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Ellipsis className="nx-i" size={16} aria-hidden="true" />
            </button>
            {menu && (
              <Popover
                anchor={anchor}
                role="menu"
                label={L.plans.menu}
                align="end"
                float
                onClose={() => setMenu(false)}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="nx-mi"
                  disabled={state.importing || summary?.expired}
                  onClick={() => run(plans.importNow)}
                >
                  {state.importing ? <Spin /> : <RefreshIcon />}
                  {L.plans.importNow}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="nx-mi"
                  onClick={() => run(() => plans.setTrashOpen(true))}
                >
                  <TrashIcon />
                  {L.docOps.trashList}
                </button>
                {rootLink && (
                  <a
                    role="menuitem"
                    className="nx-mi"
                    href={rootLink}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => {
                      linkClick(event);
                      setMenu(false);
                    }}
                  >
                    <ExternalIcon />
                    {L.plans.openInConfluence}
                  </a>
                )}
              </Popover>
            )}
          </>
        )}
      </div>
      {/* 기획 대화 목록(2026-10-31 3단계 · 2026-11-03 묶음 머리 · 줄 끝 `···`) — 위에 대화, 아래 기획서 두 묶음이다. */}
      {connected && (
        <section className="nx-pl-conv" aria-label={L.drafts.convList}>
          <div className="nx-side-list-head nx-pl-conv-head">
            <h2>{L.drafts.convList}</h2>
            <button
              type="button"
              className="nx-btn nx-btn--sm nx-btn--ghost"
              title={L.drafts.convNew}
              onClick={() => {
                window.dispatchEvent(new Event("nx:plan-new"));
                onOpen?.();
              }}
            >
              <PlusIcon />
              {L.drafts.convNew}
            </button>
          </div>
          {plans.conversationsFailed && (
            <div className="nx-pl-conv-none" role="alert">
              <p>{L.drafts.convLoadFailed}</p>
              <button
                type="button"
                className="nx-btn nx-btn--sm"
                onClick={plans.refreshConversations}
              >
                {L.plans.retry}
              </button>
            </div>
          )}
          {conversations === null ? (
            !plans.conversationsFailed && (
              <p className="nx-pl-conv-none" role="status">
                {L.plans.reading}
              </p>
            )
          ) : conversations.length === 0 ? (
            <p className="nx-pl-conv-none">{L.drafts.convNone}</p>
          ) : (
            <div className="nx-pl-conv-list" ref={convListRef}>
              {convGroups.map((group) => (
                <section
                  key={group.bucket}
                  className="nx-pl-conv-cg"
                  aria-label={L.sidebar.groups[group.bucket]}
                >
                  <h3 className="nx-pl-conv-g">{L.sidebar.groups[group.bucket]}</h3>
                  <ul className="nx-pl-conv-rows">{group.rows.map(rowBody)}</ul>
                </section>
              ))}
            </div>
          )}
        </section>
      )}
      <PlansList
        rows={rows}
        drafts={state.drafts}
        phase={state.listPhase}
        connected={connected}
        rooted={summary?.rootTitle != null}
        expired={summary?.expired === true}
        importing={state.importing}
        query={plans.query}
        onQuery={plans.setQuery}
        bodySearch={plans.bodySearch}
        collapsed={plans.collapsed}
        onToggle={plans.toggle}
        lastViewed={plans.selectedPageId}
        onOpen={(id, query) => {
          plans.open(id, query);
          onOpen?.();
        }}
        onOpenDraft={(key) => {
          plans.openDraftKey(key);
          onOpen?.();
        }}
        onRetry={plans.refreshList}
        onImport={plans.importNow}
        onSettings={() => nav.openSettings("connection")}
        hidden={hidden}
        activeDraftKey={plans.draftKey}
        focusId={plans.focusId}
        onFocused={plans.clearFocus}
        compact
      />
      {connected && state.listPhase !== "failed" && !summary?.expired && (
        <div
          className={warn ? "nx-banner nx-banner--amber nx-pl-sync" : "nx-pl-sync"}
          role="status"
        >
          {warn && <InfoIcon />}
          <span className="nx-banner-body">{sync.text}</span>
          {warn && (
            <button
              type="button"
              className="nx-btn nx-btn--sm nx-banner-act"
              onClick={() => nav.openSettings("connection")}
            >
              {L.plans.openSettings}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
