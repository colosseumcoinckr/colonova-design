import type { DraftBlock, DraftRevisionView } from "@colonova-design/protocol";
import { useState } from "react";
import type { Daemon } from "../../../lib/daemon-client";
import { L } from "../../labels";
import { draftChangeRows } from "./change-review-model";
import { DraftReadBlock } from "./DraftReadBlock";

/** 편집기와 발행 창이 같은 수정 전후를 보여 준다. 원문을 고치는 손은 없다. */
export function DraftChanges({
  base,
  title,
  blocks,
  api,
  pageId,
}: {
  base: Pick<DraftRevisionView, "title" | "blocks"> | null;
  title: string;
  blocks: DraftBlock[];
  api: Daemon["api"];
  pageId: string | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const rows = draftChangeRows(base?.blocks ?? [], blocks);
  const changed = rows.filter((row) => row.kind !== "same");
  const titleChanged = base === null || base.title !== title;
  const unchanged = rows.length - changed.length;
  return (
    <section className="nx-dr-compare" aria-label={L.drafts.compareTitle}>
      <div className="nx-dr-compare-tools">
        <p className="nx-dr-compare-sub">{L.drafts.compareSub}</p>
        {unchanged > 0 && (
          <button
            type="button"
            className="nx-btn nx-btn--sm"
            aria-pressed={showAll}
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll ? L.drafts.compareOnlyChanges : L.drafts.compareShowAll(unchanged)}
          </button>
        )}
      </div>
      {titleChanged && (
        <div className="nx-dr-review-row">
          <h4>{L.drafts.previewTitle}</h4>
          {base !== null && (
            <ReviewSide label={L.drafts.reviewBefore}>
              <p>{base.title}</p>
            </ReviewSide>
          )}
          <ReviewSide label={L.drafts.reviewAfter}>
            <p>{title}</p>
          </ReviewSide>
        </div>
      )}
      {!titleChanged && changed.length === 0 && <p>{L.drafts.compareNone}</p>}
      <ol className="nx-dr-review-list">
        {(showAll ? rows : changed).map((row) => (
          <li key={row.id} className="nx-dr-review-row">
            <h4>
              {row.kind === "inserted"
                ? L.drafts.compareInserted
                : row.kind === "deleted"
                  ? L.drafts.compareDeleted
                  : row.kind === "same"
                    ? L.drafts.statusSame
                    : L.drafts.statusChanged}
            </h4>
            {row.moved && (
              <p className="nx-dr-compare-sub">
                {row.beforePosition === row.afterPosition
                  ? L.drafts.compareMovedAmong
                  : L.drafts.compareMoved(row.beforePosition ?? 0, row.afterPosition ?? 0)}
              </p>
            )}
            {row.before !== undefined && row.kind !== "same" && (
              <ReviewSide label={L.drafts.reviewBefore}>
                <DraftReadBlock block={row.before} api={api} pageId={pageId} />
              </ReviewSide>
            )}
            {row.after !== undefined && (
              <ReviewSide label={L.drafts.reviewAfter}>
                <DraftReadBlock block={row.after} api={api} pageId={pageId} />
              </ReviewSide>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ReviewSide({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="nx-dr-review-side">
      <b>{label}</b>
      <div className="nx-dr-read">{children}</div>
    </div>
  );
}
