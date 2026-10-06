import type { SubmitPreview } from "@colonova-design/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";

/** Every status receipt invalidates an earlier read, even when visible counts stayed identical. */
export class ReviewGeneration {
  private source: unknown;
  private revision = 0;
  observe(source: unknown): number {
    if (source !== this.source) {
      this.source = source;
      ++this.revision;
    }
    return this.revision;
  }
}

/**
 * 제출 확인 창과 나란히 저장 기준을 지켜본다 — 모든 repo.status 수신과 앱 focus 는
 * 이전 읽기를 무효화하고 `submitPreview` 를 다시 읽는다. 크기별 직접 확인 표시는
 * 2026-10-06 사용자 요청으로 없앴다 — 사람이 알아서 다시 본다.
 */
export function useSubmitReview(daemon: Daemon): SubmitPreview | null {
  const revision = useRef(new ReviewGeneration());
  const signal = JSON.stringify([
    revision.current.observe(daemon.repo),
    daemon.activeSlug,
    daemon.repo?.url,
    daemon.repo?.root,
    daemon.repo?.branch,
    daemon.repo?.pendingChanges,
    daemon.repo?.cycleScreens,
    daemon.diffStatus?.stage,
    daemon.diffStatus?.stage === "published" ? daemon.diffStatus.commit : null,
  ]);
  const current = useRef({ signal, pending: daemon.repo?.pendingChanges ?? -1 });
  current.current = { signal, pending: daemon.repo?.pendingChanges ?? -1 };
  const [saved, setSaved] = useState<{ signal: string; snapshot: SubmitPreview } | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(() => {
    const asked = current.current;
    const id = ++generation.current;
    setSaved(null);
    if (asked.pending !== 0) return;
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: signal 은 상태 수신마다 새 문자열 — 수신마다 다시 읽는다.
  useEffect(() => {
    refresh();
  }, [signal, refresh]);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  return saved?.signal === signal && (daemon.repo?.pendingChanges ?? 0) === 0
    ? saved.snapshot
    : null;
}
