import type { SubmitPreview } from "@colonova-design/protocol";
import { type RefObject, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useModalEscape, useModalFocus } from "../../hooks/use-modal-focus";
import { composing } from "../../lib/ime";
import { L } from "../labels";
import type { Journey } from "../lib/journey";
import { useScreenReview } from "../lib/use-screen-review";
import type { CycleScreen } from "../lib/work-ledger";
import { finalOutgoingChanges } from "../lib/work-ledger";
import { ReviewBadges } from "../ui/ReviewBadges";
import { ScreenRow } from "./parts";

/** The list is a fresh project snapshot. Submission checks the same saved version again. */
export function SubmitPopover({
  anchor,
  journey,
  snapshot,
  projectName,
  reviewers,
  loading,
  error,
  busy,
  changed,
  onRefresh,
  onClose,
  onConfirm,
  note,
  onNote,
  onPreview,
  onCompare,
}: {
  anchor: RefObject<HTMLElement | null>;
  journey: Journey;
  snapshot: SubmitPreview | null;
  projectName: string;
  since: string | null;
  reviewers: string[];
  loading: boolean;
  error: string | null;
  busy: boolean;
  changed: boolean;
  onRefresh: () => void;
  onClose: () => void;
  onConfirm: (note: string, head: string, token: string) => void;
  note: string;
  onNote: (note: string) => void;
  onPreview: (screen: CycleScreen) => void;
  onCompare: (screen: CycleScreen) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(panel, true, anchor);
  useModalEscape(panel, () => {
    if (!busy) onClose();
  });
  useEffect(() => {
    panel.current?.focus();
  }, []);
  const review = useScreenReview();
  const more = journey.submit.more;
  const { screens, outside } = finalOutgoingChanges(
    snapshot?.history.entries ?? [],
    snapshot?.repo.cycleScreens,
    snapshot?.finalFiles ?? [],
  );
  const outsideFiles = outside.reduce((sum, item) => sum + item.files, 0);
  const enabled =
    snapshot !== null &&
    snapshot.finalFiles.length > 0 &&
    !loading &&
    !error &&
    !busy &&
    !changed &&
    journey.submit.enabled;
  const confirm = () => {
    if (enabled && snapshot) onConfirm(note.trim(), snapshot.head, snapshot.expectedPreview);
  };
  const checked =
    snapshot?.expectedPreview === review?.snapshot?.expectedPreview
      ? screens.reduce(
          (n, screen) =>
            n +
            (["desktop", "tablet", "mobile"] as const).filter(
              (device) => review?.status(screen.route, device) === "checked",
            ).length,
          0,
        )
      : 0;
  return createPortal(
    <div className="nx-modal-back nx-submit-review-back">
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={more ? L.submitConfirm.titleMore : L.submitConfirm.title}
        className="nx-work-pop nx-submit-review"
      >
        <div className="nx-wp-h">
          <b>{more ? L.submitConfirm.titleMore : L.submitConfirm.title}</b>
          <div>{more ? L.submitConfirm.subMore : L.submitConfirm.sub}</div>
        </div>
        <div className="nx-submit-review-body">
          <div className="nx-wp-sec nx-submit-scope">
            <b>{L.submitConfirm.project(projectName)}</b>
            <p>{L.submitConfirm.shared}</p>
            <p>{L.submitConfirm.follows}</p>
          </div>
          <div className="nx-wp-sec" aria-busy={loading}>
            {loading ? (
              <div role="status" className="nx-wp-empty">
                {L.submitConfirm.loading}
              </div>
            ) : error ? (
              <div role="alert" className="nx-submit-warning">
                {error}
              </div>
            ) : snapshot ? (
              <>
                <h5>{L.submitConfirm.screens(screens.length)}</h5>
                <p className="nx-review-progress">
                  {L.screenReview.progress(checked, screens.length * 3)}
                </p>
                {checked < screens.length * 3 && (
                  <p className="nx-submit-warning">{L.screenReview.pending}</p>
                )}
                {screens.map((screen) => (
                  <div key={screen.route} className="nx-submit-screen">
                    <ScreenRow screen={screen} />
                    <ReviewBadges route={screen.route} version={snapshot.expectedPreview} />
                    <div className="nx-submit-screen-actions">
                      <button
                        type="button"
                        className="nx-btn nx-btn--sm"
                        disabled={busy}
                        onClick={() => onPreview(screen)}
                      >
                        {L.requestResult.latest}
                      </button>
                      <button
                        type="button"
                        className="nx-btn nx-btn--ghost nx-btn--sm"
                        disabled={busy}
                        onClick={() => onCompare(screen)}
                      >
                        {L.compare.open}
                      </button>
                    </div>
                  </div>
                ))}
                {outsideFiles > 0 && (
                  <details className="nx-wp-outside">
                    <summary>{L.submitConfirm.outsideScreens(outsideFiles)}</summary>
                    <p>{L.submitConfirm.outsideDetail}</p>
                    {outside.map((item) => (
                      <p key={item.key}>
                        {item.note
                          ? L.submitConfirm.relatedRequest(
                              item.note.split(/\r?\n/, 1)[0] ?? "",
                              item.files,
                            )
                          : L.submitConfirm.unassociated(item.files)}
                      </p>
                    ))}
                  </details>
                )}
                {snapshot.finalFiles.length === 0 && (
                  <div className="nx-wp-empty">{L.submitConfirm.empty}</div>
                )}
              </>
            ) : null}
            {!loading && changed && !error && (
              <div role="status" className="nx-submit-warning">
                {L.submitConfirm.changed}
              </div>
            )}
            {!loading && (error || changed) && (
              <button
                type="button"
                className="nx-btn nx-btn--sm"
                onClick={onRefresh}
                disabled={busy}
              >
                {L.submitConfirm.refresh}
              </button>
            )}
          </div>
          <div className="nx-wp-sec nx-wp-sec--last">
            <h5>
              {L.submitConfirm.note}
              <span className="nx-wp-hr">{L.submitConfirm.optional}</span>
            </h5>
            <input
              className="nx-note-input"
              value={note}
              maxLength={500}
              disabled={busy}
              placeholder={L.submitConfirm.notePlaceholder}
              aria-label={L.submitConfirm.note}
              onChange={(event) => onNote(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || composing(event)) return;
                event.preventDefault();
                confirm();
              }}
            />
          </div>
        </div>
        <div className="nx-wp-foot">
          {reviewers.length > 0 && (
            <span className="nx-snote">{L.submitConfirm.reviewers(reviewers.join(" · "))}</span>
          )}
          <button
            type="button"
            className="nx-btn nx-btn--ghost nx-btn--sm"
            onClick={onClose}
            disabled={busy}
          >
            {L.submitConfirm.cancel}
          </button>
          <button
            type="button"
            className="nx-btn nx-btn--pri nx-btn--sm"
            onClick={confirm}
            disabled={!enabled}
          >
            {busy ? L.submit.running : L.submitConfirm.confirm}
          </button>
        </div>
      </div>
    </div>,
    document.querySelector(".nx") ?? document.body,
  );
}
