import type { ScreenComparison } from "@colonova-design/protocol";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalEscape, useModalFocus } from "../../hooks/use-modal-focus";
import type { Daemon } from "../../lib/daemon-client";
import { screenPath } from "../../lib/screen-link";
import { L } from "../labels";
import { CloseIcon } from "./icons";

export interface ComparisonTarget {
  route: string;
  title: string;
  requestId?: string;
  sha?: string;
  submitted?: boolean;
}
const EVENT = "nx:comparison:open";
export function openComparison(target: ComparisonTarget): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: target }));
}

/** Read-only photos: historical requests never use today's preview as their 'after' picture. */
export function ComparisonDialog({ daemon }: { daemon: Daemon }) {
  const [target, setTarget] = useState<ComparisonTarget | null>(null);
  const [record, setRecord] = useState<ScreenComparison | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [side, setSide] = useState<"before" | "after">("after");
  const [zoom, setZoom] = useState({ before: 100, after: 100 });
  const panel = useRef<HTMLDivElement>(null);
  const close = () => setTarget(null);
  useModalFocus(panel, target !== null);
  useModalEscape(panel, close, target !== null);
  useEffect(() => {
    const open = (event: Event) => {
      const next = (event as CustomEvent<ComparisonTarget>).detail;
      if (!next?.route) return;
      setRecord(null);
      setPhase("loading");
      setSide("after");
      setZoom({ before: 100, after: 100 });
      setTarget({ ...next, route: screenPath(next.route) });
    };
    window.addEventListener(EVENT, open);
    return () => window.removeEventListener(EVENT, open);
  }, []);
  useEffect(() => {
    setTarget(null);
  }, [daemon.activeSlug]);
  useEffect(() => {
    if (!target) return;
    panel.current?.focus();
    let cancelled = false;
    void daemon.api
      .comparison(target)
      .then((next) => {
        if (cancelled) return;
        setRecord(next);
        setPhase("ready");
      })
      .catch(() => {
        if (!cancelled) setPhase("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [target, daemon.api]);
  if (!target) return null;
  const beforeLabel = target.submitted ? L.compare.lastSubmit : L.compare.before;
  const afterLabel = target.submitted ? L.compare.current : L.compare.after;
  const picture = (which: "before" | "after") => {
    const shot = record?.[which];
    const title = which === "before" ? beforeLabel : afterLabel;
    const safe =
      shot &&
      /^image\/(png|jpeg|webp)$/.test(shot.mediaType) &&
      shot.data.length <= 4 * 1024 * 1024;
    const scale = zoom[which];
    const at = shot?.at ? new Date(shot.at) : null;
    return (
      <section
        className={`nx-compare-side nx-compare-side--${which}${side === which ? " nx-compare-side--chosen" : ""}`}
        aria-label={title}
      >
        <h3>
          <span>{title}</span>
          <span className="nx-compare-tools">
            {at && !Number.isNaN(at.getTime()) && (
              <small>
                {at.toLocaleString("ko-KR", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </small>
            )}
            {safe && (
              <>
                <button
                  type="button"
                  aria-label={L.compare.zoomOut}
                  disabled={scale <= 100}
                  onClick={() =>
                    setZoom((current) => ({
                      ...current,
                      [which]: Math.max(100, current[which] - 25),
                    }))
                  }
                >
                  −
                </button>
                <button
                  type="button"
                  aria-label={L.compare.zoomReset}
                  disabled={scale === 100}
                  onClick={() => setZoom((current) => ({ ...current, [which]: 100 }))}
                >
                  {scale}%
                </button>
                <button
                  type="button"
                  aria-label={L.compare.zoomIn}
                  disabled={scale >= 250}
                  onClick={() =>
                    setZoom((current) => ({
                      ...current,
                      [which]: Math.min(250, current[which] + 25),
                    }))
                  }
                >
                  +
                </button>
              </>
            )}
          </span>
        </h3>
        <div className="nx-compare-photo">
          {safe ? (
            <img
              src={`data:${shot.mediaType};base64,${shot.data}`}
              alt={`${target.title} · ${title}`}
              style={{ width: `${scale}%` }}
            />
          ) : (
            <p>
              {which === "before"
                ? target.submitted
                  ? L.compare.noSubmitted
                  : L.compare.noBefore
                : L.compare.noAfter}
            </p>
          )}
        </div>
      </section>
    );
  };
  return createPortal(
    <div
      className="nx-modal-back nx-compare-back"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={panel}
        className="nx-compare"
        role="dialog"
        aria-modal="true"
        aria-label={`${L.compare.title} · ${target.title}`}
        tabIndex={-1}
      >
        <header>
          <div>
            <h2>{target.title || L.compare.title}</h2>
            <p>{L.compare.picture}</p>
          </div>
          <button type="button" className="nx-ibtn" aria-label={L.compare.close} onClick={close}>
            <CloseIcon />
          </button>
        </header>
        <div className="nx-compare-meta">
          {target.submitted ? L.compare.submittedDesktop : L.compare.desktop}
        </div>
        {phase === "loading" ? (
          <div className="nx-compare-empty" role="status">
            {L.compare.loading}
          </div>
        ) : phase === "failed" ? (
          <div className="nx-compare-empty" role="alert">
            {L.compare.failed}
          </div>
        ) : !record ? (
          <div className="nx-compare-empty" role="status">
            {L.compare.noRecord}
          </div>
        ) : (
          <>
            <div className="nx-compare-switch" role="group" aria-label={L.compare.title}>
              <button
                type="button"
                aria-pressed={side === "before"}
                onClick={() => setSide("before")}
              >
                {beforeLabel}
              </button>
              <button
                type="button"
                aria-pressed={side === "after"}
                onClick={() => setSide("after")}
              >
                {afterLabel}
              </button>
            </div>
            <div className="nx-compare-pair">
              {picture("before")}
              {picture("after")}
            </div>
          </>
        )}
      </div>
    </div>,
    document.querySelector(".nx") ?? document.body,
  );
}
