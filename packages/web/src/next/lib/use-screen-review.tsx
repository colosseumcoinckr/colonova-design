import type { SubmitPreview } from "@colonova-design/protocol";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { screenKey } from "../../lib/turn-screens";
import {
  type HumanReviewState,
  type HumanScreenReview,
  humanReviewState,
  markHumanReview,
  parseHumanReviews,
  type ReviewDevice,
  ReviewGeneration,
  verifyHumanReview,
} from "./screen-review";

export interface ScreenReview {
  snapshot: SubmitPreview | null;
  status: (route: string, device: ReviewDevice, requestId?: string) => HumanReviewState;
  mark: (route: string, device: ReviewDevice, isCurrent: () => boolean) => Promise<boolean>;
  refresh: () => void;
}
const Context = createContext<ScreenReview | null>(null);
export const ScreenReviewProvider = Context.Provider;
export const useScreenReview = () => useContext(Context);

export function useProjectScreenReview(daemon: Daemon, running: boolean): ScreenReview {
  const scope = JSON.stringify([
    daemon.activeSlug,
    daemon.repo?.url,
    daemon.repo?.root,
    daemon.repo?.branch,
  ]);
  const key = `colonova-design.screen-review:${scope}`;
  const revision = useRef(new ReviewGeneration());
  const signal = JSON.stringify([
    revision.current.observe(daemon.repo),
    scope,
    running,
    daemon.repo?.pendingChanges,
    daemon.repo?.cycleScreens,
    daemon.diffStatus?.stage,
    daemon.diffStatus?.stage === "published" ? daemon.diffStatus.commit : null,
  ]);
  const current = useRef({ signal, key, running, pending: daemon.repo?.pendingChanges ?? -1 });
  current.current = { signal, key, running, pending: daemon.repo?.pendingChanges ?? -1 };
  const [saved, setSaved] = useState<{ signal: string; snapshot: SubmitPreview } | null>(null);
  const [rows, setRows] = useState<{ key: string; rows: HumanScreenReview[] }>({ key, rows: [] });
  const generation = useRef(0);
  const refresh = useCallback(() => {
    const asked = current.current;
    const id = ++generation.current;
    setSaved(null);
    if (asked.running || asked.pending !== 0) return;
    void daemon.api
      .submitPreview()
      .then((snapshot) => {
        if (
          id === generation.current &&
          current.current.signal === asked.signal &&
          snapshot.repo.pendingChanges === 0
        )
          setSaved({ signal: asked.signal, snapshot });
      })
      .catch(() => {});
  }, [daemon.api]);
  useEffect(() => {
    refresh();
  }, [signal, refresh]);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  useEffect(() => {
    const read = () => {
      try {
        setRows({ key, rows: parseHumanReviews(localStorage.getItem(key)) });
      } catch {
        setRows({ key, rows: [] });
      }
    };
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, [key]);
  const snapshot =
    saved?.signal === signal && !running && daemon.repo?.pendingChanges === 0
      ? saved.snapshot
      : null;
  const status = (route: string, device: ReviewDevice, requestId?: string): HumanReviewState => {
    const target = screenKey(route);
    const latest = snapshot?.repo.cycleScreens?.find(
      (screen) => screenKey(screen.route) === target,
    );
    const currentRequest = !snapshot || !latest || !requestId || latest.requestId === requestId;
    return humanReviewState(
      rows.key === key ? rows.rows : [],
      target,
      device,
      snapshot && latest?.sha ? snapshot.expectedPreview : null,
      currentRequest,
    );
  };
  const mark = async (
    route: string,
    device: ReviewDevice,
    isCurrent: () => boolean,
  ): Promise<boolean> => {
    const asked = current.current;
    if (!snapshot || asked.running || asked.pending !== 0 || !isCurrent()) return false;
    const fresh = await verifyHumanReview(
      snapshot.expectedPreview,
      () => daemon.api.submitPreview(),
      () =>
        isCurrent() &&
        current.current.signal === asked.signal &&
        !current.current.running &&
        current.current.pending === 0,
    );
    if (!fresh) {
      refresh();
      return false;
    }
    const target = screenKey(route);
    if (
      !fresh.repo.cycleScreens?.some((screen) => screenKey(screen.route) === target && screen.sha)
    )
      return false;
    try {
      const next = markHumanReview(parseHumanReviews(localStorage.getItem(key)), {
        route: target,
        device,
        version: fresh.expectedPreview,
        at: new Date().toISOString(),
      });
      localStorage.setItem(key, JSON.stringify(next));
      setRows({ key, rows: next });
      setSaved({ signal: asked.signal, snapshot: fresh });
      return true;
    } catch {
      return false;
    }
  };
  return { snapshot, status, mark, refresh };
}
