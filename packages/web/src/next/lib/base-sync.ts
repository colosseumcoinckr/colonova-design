import type { RepoStatus } from "@colonova-design/protocol";

/**
 * 받아오기 칸의 지금(2026-10-20 사용자 요청) — 개발자가 반영한 내용은 사용자가 누를 때만 받아온다.
 * 상태 줄의 작은 단추와 `이번 작업` 의 칸이 같은 판정을 읽는다. 받을 것도 요청도 없으면 숨는다.
 */
export type BaseSyncRow =
  | { kind: "hidden" }
  | { kind: "ready"; behind: number }
  /** 요청이 서서 AI 작업이 끝나기를 기다린다. */
  | { kind: "waiting" }
  | { kind: "pulling" }
  /** 겹친 부분을 AI 가 정리하는 중 — 단추를 다시 세우지 않는다. */
  | { kind: "overlap" };

export function baseSyncRow(repo: RepoStatus | null | undefined, making: boolean): BaseSyncRow {
  const sync = repo?.baseSync;
  if (!sync) return { kind: "hidden" };
  if (sync.requested) return making ? { kind: "waiting" } : { kind: "pulling" };
  if (sync.last?.outcome === "overlap" && repo?.attention?.kind === "ai-fixing") {
    return { kind: "overlap" };
  }
  if (sync.behind > 0) return { kind: "ready", behind: sync.behind };
  return { kind: "hidden" };
}

/**
 * 마지막으로 본 결과의 신원 — 같은 상태 객체의 클론 자리(`RepoStatus.root`)와 결과의 시각. 프로젝트가 바뀌어 다른
 * 결과가 보인 것을 새 소식으로 읽지 않는다.
 */
export interface BaseSyncSeen {
  root: string;
  at: string | null;
}

/** 지금 상태가 기억할 신원 — `baseSync` 를 싣지 않은 상태(연결 중 · 옛 데몬)는 기억하지 않는다. */
export function baseSyncSeenOf(repo: RepoStatus | null | undefined): BaseSyncSeen | null {
  if (!repo?.baseSync) return null;
  return { root: repo.root, at: repo.baseSync.last?.at ?? null };
}

/**
 * 받아오기가 끝난 소식 — 같은 클론에서 `last.at` 이 바뀐 순간에만 결과를 돌려준다. 처음 본 값(창을 연 순간 ·
 * 프로젝트를 옮긴 순간 · 연결 뒤 첫 상태)은 소식이 아니다 — 앞선 결과로 성공을 말하지 않는다.
 */
export function baseSyncNews(
  seen: BaseSyncSeen | null,
  repo: RepoStatus | null | undefined,
): NonNullable<NonNullable<RepoStatus["baseSync"]>["last"]>["outcome"] | null {
  const now = baseSyncSeenOf(repo);
  const last = repo?.baseSync?.last;
  if (seen === null || now === null || !last) return null;
  if (seen.root !== now.root || seen.at === now.at) return null;
  return last.outcome;
}
