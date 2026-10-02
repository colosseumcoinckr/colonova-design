import { L } from "../labels";
import { useScreenReview } from "../lib/use-screen-review";

export function ReviewBadges({
  route,
  requestId,
  version,
}: {
  route: string;
  requestId?: string;
  version?: string;
}) {
  const review = useScreenReview();
  return (
    <span className="nx-review-badges" aria-label={L.screenReview.sizes}>
      {(["desktop", "tablet", "mobile"] as const).map((device) => {
        const state =
          version && version !== review?.snapshot?.expectedPreview
            ? "unknown"
            : (review?.status(route, device, requestId) ?? "unknown");
        return (
          <span key={device} className={`nx-review-badge nx-review-badge--${state}`}>
            {L.screenReview.devices[device]} · {L.screenReview.states[state]}
          </span>
        );
      })}
    </span>
  );
}
