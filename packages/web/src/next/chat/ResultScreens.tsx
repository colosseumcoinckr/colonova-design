import { useEffect, useRef, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { screenPath } from "../../lib/screen-link";
import { L } from "../labels";
import { ReviewBadges } from "../ui/ReviewBadges";
import { EyeIcon, FwdIcon, ImageIcon } from "./icons";

export type LoadComparison = Daemon["api"]["comparison"];

/** Only show the saved picture belonging to this request, never today's screen. */
export function ResultScreen({
  title,
  route,
  requestId,
  loadComparison,
  onOpen,
  onCompare,
  onEdit,
}: {
  title: string;
  route: string;
  requestId?: string;
  loadComparison: LoadComparison;
  onOpen: () => void;
  onCompare: () => void;
  onEdit?: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [picture, setPicture] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(requestId));
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    setPicture(null);
    setLoading(Boolean(requestId));
    setUnavailable(false);
    if (!requestId || !card.current) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        void loadComparison({ route, requestId })
          .then((record) => {
            if (cancelled) return;
            const shot =
              record?.requestId === requestId && screenPath(record.route) === screenPath(route)
                ? record.after
                : null;
            if (
              shot &&
              shot.data.length > 0 &&
              /^image\/(png|jpeg|webp)$/.test(shot.mediaType) &&
              shot.data.length <= 4 * 1024 * 1024
            ) {
              setPicture(`data:${shot.mediaType};base64,${shot.data}`);
            }
          })
          .catch(() => {
            if (!cancelled) setUnavailable(true);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      { rootMargin: "200px" },
    );
    observer.observe(card.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [route, requestId, loadComparison]);

  return (
    <div ref={card} className="nx-result-screen">
      <button
        type="button"
        className="nx-result-open"
        onClick={onOpen}
        aria-label={`${title} · ${L.transcript.shotGo}`}
      >
        {picture ? (
          <span className="nx-result-photo">
            {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Handles image decoding failure, not user interaction. */}
            <img
              src={picture}
              alt=""
              onError={() => {
                setPicture(null);
                setUnavailable(true);
              }}
            />
            <span className="nx-result-photo-label">{L.transcript.shotCaptured}</span>
          </span>
        ) : (
          <span
            className={`nx-result-placeholder${loading ? " nx-result-placeholder--loading" : ""}`}
          >
            <ImageIcon />
            <span>
              {loading
                ? L.transcript.shotLoading
                : unavailable
                  ? L.transcript.shotFailed
                  : L.transcript.shotNoPhoto}
            </span>
          </span>
        )}
        <span className="nx-result-info">
          <b>{title}</b>
          <span className="nx-result-go">
            <EyeIcon />
            {L.requestResult.latest}
            <FwdIcon />
          </span>
        </span>
      </button>
      <p className="nx-result-provenance">{L.requestResult.historical}</p>
      <ReviewBadges route={route} requestId={requestId} />
      {onEdit && (
        <button type="button" className="nx-result-compare" onClick={onEdit}>
          {L.requestResult.edit}
        </button>
      )}
      <button
        type="button"
        className="nx-result-compare"
        onClick={onCompare}
        aria-label={`${title} · ${L.compare.open}`}
      >
        {L.compare.open}
        <FwdIcon />
      </button>
    </div>
  );
}
