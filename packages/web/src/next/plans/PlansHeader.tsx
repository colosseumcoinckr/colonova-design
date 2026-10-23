import { useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { linkClick } from "../../lib/open-link";
import { L } from "../labels";
import { keyHint } from "../lib/key-hint";
import type { ShellNav } from "../slots";
import { ChevronRightIcon, ExternalIcon, MenuIcon, PanelIcon, PencilIcon } from "../ui/icons";
import { DocActions } from "./doc-actions/DocActions";
import { SendToScreen } from "./doc-actions/SendToScreen";
import { usePlansContext } from "./PlansWorkspace";
import { docUrl } from "./plans-list";

/** 기획서의 위치와 지금 할 일(2026-10-23 화면 전면 재설계 §3.3). */
export function PlansHeader({
  daemon,
  nav,
  sidebarHidden = false,
  narrow = false,
  onOpenSidebar,
}: {
  daemon: Daemon;
  nav: ShellNav;
  sidebarHidden?: boolean;
  narrow?: boolean;
  onOpenSidebar?: () => void;
}) {
  const plans = usePlansContext();
  const { state, rows, summary, openRow, editingDraft, crumbTitle, editDoc, onDocApplied } = plans;
  const [sendOpen, setSendOpen] = useState(false);
  const pageId = state.openId;
  const link = pageId !== null && summary?.site ? docUrl(summary.site, pageId) : null;
  const draft = state.drafts.find((one) => one.pageId === pageId);
  const folder = editingDraft
    ? rows.find((row) => row.pageId === plans.draftSummary?.pageId)?.folder
    : openRow?.folder;
  const docId = editingDraft ? plans.draftSummary?.pageId : pageId;
  const docPath = state.docs?.find((doc) => doc.pageId === docId)?.path;
  const locationTitle = docPath
    ? docPath.split("/").join(" › ")
    : [L.plans.listHeading, folder, crumbTitle].filter(Boolean).join(" › ");
  return (
    <header className="nx-topbar nx-pl-bar">
      {sidebarHidden && (
        <button
          type="button"
          className="nx-ibtn"
          onClick={onOpenSidebar}
          title={narrow ? L.shell.menu : keyHint(L.sidebar.expand)}
          aria-label={narrow ? L.shell.menu : keyHint(L.sidebar.expand)}
        >
          {narrow ? <MenuIcon /> : <PanelIcon />}
        </button>
      )}
      <nav className="nx-pl-crumbs" aria-label={L.plans.crumbNav} title={locationTitle}>
        <button
          type="button"
          className="nx-btn nx-btn--ghost nx-pl-root"
          onClick={() => {
            onOpenSidebar?.();
            plans.back();
          }}
          title={L.plans.focusTree}
        >
          {L.plans.listHeading}
        </button>
        {folder && (
          <>
            <ChevronRightIcon />
            <span className="nx-pl-crumb-folder" title={locationTitle}>
              {folder}
            </span>
          </>
        )}
        {crumbTitle && (
          <>
            <ChevronRightIcon />
            <span className="nx-pl-crumb-here" title={crumbTitle} aria-current="page">
              {crumbTitle}
            </span>
          </>
        )}
        {editingDraft && <span className="nx-pill nx-pill--accent">{L.drafts.chip}</span>}
      </nav>
      {!editingDraft && pageId !== null && !summary?.expired && (
        <div className="nx-pl-actions">
          {link !== null && (
            <a
              className="nx-ibtn"
              href={link}
              target="_blank"
              rel="noreferrer"
              onClick={linkClick}
              title={L.plans.openInConfluence}
              aria-label={L.plans.openInConfluence}
            >
              <ExternalIcon />
            </a>
          )}
          <button type="button" className="nx-btn" onClick={() => setSendOpen(true)}>
            {L.drafts.sendToScreen}
          </button>
          <button type="button" className="nx-btn nx-btn--pri" onClick={() => editDoc(pageId)}>
            <PencilIcon />
            {draft ? L.drafts.resume : L.drafts.edit}
          </button>
          <DocActions daemon={daemon} pageId={pageId} rows={rows} onApplied={onDocApplied} />
        </div>
      )}
      {sendOpen && pageId !== null && (
        <SendToScreen
          daemon={daemon}
          nav={nav}
          target={{ pageId }}
          sections={state.doc?.sections.map((section) => section.heading) ?? []}
          onSent={() => nav.showPane("preview")}
          onClose={() => setSendOpen(false)}
        />
      )}
    </header>
  );
}
