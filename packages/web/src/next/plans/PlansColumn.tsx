import type { ProjectSummary } from "@colonova-design/protocol";
import { type ReactNode, useContext, useEffect } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import type { ShellNav } from "../slots";
import { TrashDialog } from "./doc-actions/TrashDialog";
import { DraftEditor } from "./draft/DraftEditor";
import { NewDraftDialog } from "./draft/NewDraftDialog";
import { escapeOwnedByLayer } from "./escape-layer";
import { PlanDocView } from "./PlanDocView";
import { PlansStatus } from "./PlansEmpty";
import { PlansHeader } from "./PlansHeader";
import { PlansContext, usePlansContext, usePlansWorkspace } from "./PlansWorkspace";

/** 문서 · 초안은 같은 본문에 남는다(2026-10-23 화면 전면 재설계 §3.4). */
export function PlansColumn(props: {
  daemon: Daemon;
  project: ProjectSummary | null;
  nav: ShellNav;
  offstage?: boolean;
  onDraftOpen?: (open: boolean) => void;
  /** 셸에서는 문제 줄을 머리 바로 아래에 놓는다. */
  header?: boolean;
  onFocusTree?: () => void;
}) {
  const shared = useContext(PlansContext);
  if (shared === null) return <Standalone {...props} />;
  return <PlansBody {...props} />;
}

/** 기존 단독 호출의 계약도 지킨다. 앱에서는 Workspace 의 공유 상태를 쓴다. */
function Standalone(props: Parameters<typeof PlansColumn>[0]) {
  const plans = usePlansWorkspace({ ...props, active: !props.offstage });
  return (
    <PlansContext.Provider value={plans}>
      <PlansBody {...props} />
    </PlansContext.Provider>
  );
}

function PlansBody({
  daemon,
  nav,
  offstage = false,
  onDraftOpen,
  header = true,
  onFocusTree,
}: Parameters<typeof PlansColumn>[0]) {
  const plans = usePlansContext();
  const {
    state,
    summary,
    rows,
    connected,
    draftKey,
    draftPageId,
    draftSummary,
    editingDraft,
    openRow,
  } = plans;
  useEffect(() => {
    onDraftOpen?.(editingDraft);
  }, [editingDraft, onDraftOpen]);
  const focusTree = () => {
    onFocusTree?.();
    plans.back();
  };
  let body: ReactNode;
  if (editingDraft && draftKey !== null) {
    body = (
      <div className="nx-pl-view nx-pl-view--draft">
        <DraftEditor
          key={draftKey}
          daemon={daemon}
          {...(draftPageId !== null ? { pageId: draftPageId } : { docKey: draftKey })}
          pendingChanges={draftSummary?.changedBlocks}
          writable={summary?.writable}
          site={summary?.site ?? null}
          nav={nav}
          onClose={plans.closeDraft}
        />
      </div>
    );
  } else if (state.openId !== null && !summary?.expired) {
    const pageId = state.openId;
    body = (
      <div className={`nx-pl-view${state.docPhase === "failed" ? " nx-pl-view--failed" : ""}`}>
        <PlanDocView
          key={pageId}
          focusTitle={plans.focusDoc}
          pageId={pageId}
          row={openRow}
          site={summary?.site ?? null}
          phase={state.docPhase}
          doc={state.doc}
          draft={state.drafts.find((one) => one.pageId === pageId) ?? null}
          daemon={daemon}
          nav={nav}
          rows={rows}
          onRetry={() => plans.openDoc(pageId)}
          onBack={focusTree}
          onEdit={plans.editDoc}
          onApplied={plans.onDocApplied}
          onRefresh={plans.refreshDoc}
          writable={summary?.writable}
        />
      </div>
    );
  } else {
    body = (
      <div className="nx-pl-state">
        <PlansStatus
          connected={connected}
          expired={summary?.expired === true}
          rooted={summary?.rootTitle != null}
          phase={state.listPhase}
          importing={state.importing}
          onSettings={nav.openSettings}
          onImport={plans.importNow}
          onRetry={plans.refreshList}
        />
      </div>
    );
  }
  return (
    <section
      className={`nx-plans${offstage ? " nx-offstage" : ""}`}
      aria-hidden={offstage}
      inert={offstage}
      aria-label={L.plans.listHeading}
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          event.defaultPrevented ||
          editingDraft ||
          !plans.docOpen ||
          escapeOwnedByLayer()
        )
          return;
        event.preventDefault();
        focusTree();
      }}
    >
      {header && <PlansHeader daemon={daemon} nav={nav} />}
      {body}
      {plans.newDraftOpen && (
        <NewDraftDialog
          daemon={daemon}
          rows={rows}
          onImport={plans.importNow}
          onClose={() => plans.setNewDraftOpen(false)}
          onCreated={(view) => {
            plans.setNewDraftOpen(false);
            plans.openDraftKey(view.docKey);
          }}
        />
      )}
      {plans.trashOpen && (
        <TrashDialog
          daemon={daemon}
          onApplied={plans.refreshList}
          onClose={() => plans.setTrashOpen(false)}
        />
      )}
    </section>
  );
}
