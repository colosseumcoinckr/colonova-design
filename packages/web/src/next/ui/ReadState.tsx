import type { ReactNode } from "react";
import { L } from "../labels";
import { PlansEmptyIcon, Spin } from "./icons";

type ReadStatus =
  | { phase: "loading" | "empty" | "ready" }
  | { phase: "failed"; onRetry: () => void };

/** 2026-11-12 UI 조사 — PlansEmpty · PlanDocView 의 기존 빈 면과 재시도 손을 함께 쓴다. */
export function ReadState({
  state,
  title,
  body,
  children,
}: {
  state: ReadStatus;
  title?: string;
  body?: string;
  children?: ReactNode;
}) {
  if (state.phase === "ready") return <>{children}</>;
  return (
    <div
      className="nx-empty"
      role={state.phase === "failed" ? "alert" : "status"}
      aria-busy={state.phase === "loading"}
    >
      <span className="nx-empty-mark" aria-hidden="true">
        {state.phase === "loading" ? <Spin /> : <PlansEmptyIcon />}
      </span>
      <p className="nx-empty-title">
        {title ??
          (state.phase === "loading"
            ? L.readState.loading
            : state.phase === "empty"
              ? L.readState.empty
              : L.readState.failed)}
      </p>
      {body && <p className="nx-empty-desc">{body}</p>}
      {state.phase === "failed" && (
        <div className="nx-empty-act">
          <button type="button" className="nx-btn" onClick={state.onRetry}>
            {L.readState.retry}
          </button>
        </div>
      )}
    </div>
  );
}
