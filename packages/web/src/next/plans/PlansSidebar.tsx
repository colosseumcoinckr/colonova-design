import { Ellipsis } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { linkClick } from "../../lib/open-link";
import { L } from "../labels";
import type { ShellNav } from "../slots";
import { ExternalIcon, InfoIcon, PlusIcon, RefreshIcon, Spin, TrashIcon } from "../ui/icons";
import { Popover } from "../ui/Popover";
import { PlansList } from "./PlansList";
import { usePlansContext } from "./PlansWorkspace";
import { docUrl, initialPlanPage } from "./plans-list";

/** 사이드바의 목록 머리 · 트리 · 가져온 때(2026-10-23 화면 전면 재설계 §3.2). */
export function PlansSidebar({
  nav,
  hidden = false,
  sidebarHidden = false,
  onMenuHidden,
  onOpen,
}: {
  nav: ShellNav;
  hidden?: boolean;
  sidebarHidden?: boolean;
  onMenuHidden?: () => void;
  onOpen?: () => void;
}) {
  const plans = usePlansContext();
  const { state, summary, connected, rows, sync } = plans;
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
        collapsed={plans.collapsed}
        onToggle={plans.toggle}
        lastViewed={plans.selectedPageId}
        onOpen={(id) => {
          plans.open(id);
          onOpen?.();
        }}
        onOpenDraft={(key) => {
          plans.openDraftKey(key);
          onOpen?.();
        }}
        onRetry={plans.refreshList}
        onImport={plans.importNow}
        onSettings={nav.openSettings}
        hidden={hidden}
        activeDraftKey={plans.draftKey}
        focusId={plans.focusId}
        onFocused={plans.clearFocus}
        compact
      />
      {connected && (
        <div
          className={warn ? "nx-banner nx-banner--amber nx-pl-sync" : "nx-pl-sync"}
          role="status"
        >
          {warn && <InfoIcon />}
          <span className="nx-banner-body">
            {state.listPhase === "failed" ? L.plans.listFailed : sync.text}
          </span>
          {warn && (
            <button
              type="button"
              className="nx-btn nx-btn--sm nx-banner-act"
              onClick={nav.openSettings}
            >
              {L.plans.openSettings}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
