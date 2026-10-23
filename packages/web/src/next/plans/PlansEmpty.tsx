import type { ReactNode } from "react";
import { L } from "../labels";
import { PlansEmptyIcon, Spin } from "../ui/icons";
import type { PlanPhase } from "./use-plans";

export function PlansEmpty({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <div className="nx-empty">
      <span className="nx-empty-mark" aria-hidden="true">
        <PlansEmptyIcon />
      </span>
      <h3 className="nx-empty-title">{title}</h3>
      {body && <p className="nx-empty-desc">{body}</p>}
      {children && <div className="nx-empty-act">{children}</div>}
    </div>
  );
}

/** 연결 · 빈 목록 · 실패는 본문의 한 장이다(2026-10-23 화면 전면 재설계 §4 C). */
export function PlansStatus({
  connected,
  expired,
  rooted,
  phase,
  importing,
  onSettings,
  onImport,
  onRetry,
}: {
  connected: boolean;
  expired: boolean;
  rooted: boolean;
  phase: PlanPhase;
  importing: boolean;
  onSettings: () => void;
  onImport: () => void;
  onRetry: () => void;
}) {
  if (!connected)
    return (
      <PlansEmpty title={L.plans.emptyNoneTitle} body={L.plans.emptyNoneBody}>
        <button type="button" className="nx-btn nx-btn--pri" onClick={onSettings}>
          {L.plans.connectNow}
        </button>
      </PlansEmpty>
    );
  if (expired)
    return (
      <PlansEmpty title={L.plans.statusExpired} body={L.plans.emptyListExpired}>
        <button type="button" className="nx-btn" onClick={onSettings}>
          {L.plans.openSettings}
        </button>
      </PlansEmpty>
    );
  if (phase === "idle" || phase === "loading")
    return (
      <div className="nx-empty" role="status">
        <Spin />
        <p className="nx-empty-title">{L.plans.listLoading}</p>
      </div>
    );
  if (phase === "failed")
    return (
      <PlansEmpty title={L.plans.listFailed} body={L.plans.listFailedBody}>
        <button type="button" className="nx-btn" onClick={onRetry}>
          {L.plans.retry}
        </button>
      </PlansEmpty>
    );
  return (
    <PlansEmpty
      title={L.plans.emptyListTitle}
      body={rooted ? L.plans.emptyListRooted : L.plans.emptyListNoRoot}
    >
      {rooted ? (
        <button
          type="button"
          className="nx-btn nx-btn--pri"
          disabled={importing}
          onClick={onImport}
        >
          {importing ? (
            <>
              <Spin />
              {L.plans.importing}
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
    </PlansEmpty>
  );
}
