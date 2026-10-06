import type { ProjectSummary, RepoPhase } from "@colonova-design/protocol";
import type { L } from "../labels";

/**
 * 다른 프로젝트 줄(PLAN-UI U7) — 한 줄에 이름과 가장 급한 것 하나. 전부
 * `ProjectSummary` 에서 나온다. 문장은 journey.ts 와 같은 이유로 인자로 받는다
 * (`projectNote(summary, L)`).
 */
export type ProjectNoteWords = Pick<typeof L, "sidebar" | "journey" | "cycle" | "shell" | "vocab">;

/** 줄의 색 — `accent` 도는 중 · `amber` 기다림 · `red` 실패 · `green` 반영 · `muted` 평소. */
export type NoteTone = "accent" | "amber" | "red" | "green" | "muted";

export interface ProjectNote {
  kind: "preparing" | "making" | "waiting" | "failed" | "comments" | "merged" | "cycle";
  text: string;
  tone: NoteTone;
  /** 도는 표식(회전)을 그릴까 — 준비 중 · 만드는 중. */
  spin: boolean;
}

/**
 * 선로에 없는 두 사실 — 부르는 쪽이 알면 넘긴다. `aiFailed` 는 그 프로젝트의
 * 대화가 `AI가 답을 못 했어요` 에서 멈춰 있는가(살아 있는 세션을 아는 활성
 * 프로젝트만 안다 — 다른 프로젝트 줄은 활성이 아닌 프로젝트만 그리므로 지금은 넘기는
 * 곳이 없고, 그 실패는 그 프로젝트의 대화 안 카드가 기다린다), `comments` 는 도착한
 * 코멘트 수(단계 4 의 장부).
 */
export interface ProjectNoteExtra {
  aiFailed?: boolean;
  comments?: number;
}

const PREPARING: Record<RepoPhase, boolean> = {
  missing: false,
  cloning: true,
  pulling: true,
  installing: true,
  starting: true,
  ready: false,
  error: false,
};

/** 준비가 도는 중인가 — 내려받기 · 받아오기 · 설치 · 미리보기 켜기. */
export function isPreparing(summary: Pick<ProjectSummary, "phase">): boolean {
  return PREPARING[summary.phase];
}

/** 한 번도 준비한 적이 없는가 — 등록만 된 프로젝트는 클론이 없다(`missing`). */
export function neverPrepared(summary: Pick<ProjectSummary, "phase">): boolean {
  return summary.phase === "missing";
}

/** 이번 사이클의 자리 — 전환기의 점 색과 줄 끝의 한 단어가 이것을 읽는다. */
export function projectCycle(summary: ProjectSummary): "draft" | "review" | "merged" {
  const state = summary.handoff?.state;
  if (state === "merged") return summary.branch || summary.pendingChanges > 0 ? "draft" : "merged";
  return state ? "review" : "draft";
}

/**
 * 사이클 상태의 한 단어 — 우선순위의 맨 끝이자 전환기의 둘째 줄. 준비 중 ·
 * 아직 열지 않음 · 만드는 중이 사이클보다 앞선다(목업 `cycleLabel`).
 */
export function projectStatus(summary: ProjectSummary, words: ProjectNoteWords): ProjectNote {
  if (isPreparing(summary)) {
    return { kind: "preparing", text: words.sidebar.preparing, tone: "accent", spin: true };
  }
  if (neverPrepared(summary)) {
    return { kind: "cycle", text: words.sidebar.notOpened, tone: "muted", spin: false };
  }
  if (summary.working) {
    return { kind: "making", text: words.journey.making, tone: "accent", spin: true };
  }
  const cycle = projectCycle(summary);
  return { kind: "cycle", text: words.cycle[cycle], tone: "muted", spin: false };
}

/**
 * 가장 급한 것 하나 — 준비 중 > 만드는 중 > 답을 기다려요 N > AI가 답을 못
 * 했어요 > 코멘트 N > 반영됐어요 > 사이클 상태.
 */
export function projectNote(
  summary: ProjectSummary,
  words: ProjectNoteWords,
  extra: ProjectNoteExtra = {},
): ProjectNote {
  const S = words.sidebar;
  if (isPreparing(summary)) {
    return { kind: "preparing", text: S.preparing, tone: "accent", spin: true };
  }
  if (summary.working) {
    return { kind: "making", text: words.journey.making, tone: "accent", spin: true };
  }
  if (summary.pendingCount > 0) {
    return {
      kind: "waiting",
      text: S.waitingAnswerCount(summary.pendingCount),
      tone: "amber",
      spin: false,
    };
  }
  if (extra.aiFailed) {
    return { kind: "failed", text: words.vocab.aiFailed, tone: "red", spin: false };
  }
  const cycle = projectCycle(summary);
  const event = summary.lastEventKind;
  if (cycle === "review" && (event === "comments" || event === "changes_requested")) {
    const n = extra.comments ?? 0;
    return {
      kind: "comments",
      text: n > 0 ? S.comments(n) : words.shell.commentsArrived,
      tone: "amber",
      spin: false,
    };
  }
  // 반영은 도구가 스스로 받아 오는 소식이라 초록 한 번이면 된다 — 병합이 그
  // 사이클의 자리이므로 사건 기록이 늦어도 같은 말이다.
  if (cycle === "merged") {
    return { kind: "merged", text: words.cycle.merged, tone: "green", spin: false };
  }
  return projectStatus(summary, words);
}

/** 급한 순서 — 사용자의 손이 필요한 것(답 · 코멘트 · 실패)이 먼저, 도는 일이 그다음, 조용한 것이 맨 뒤다. */
const URGENCY: Record<ProjectNote["kind"], number> = {
  waiting: 0,
  comments: 1,
  failed: 2,
  making: 3,
  preparing: 4,
  merged: 5,
  cycle: 6,
};

/**
 * 사이드바의 `다른 프로젝트` 에 세울 줄 — 낮은 창에서는 이 줄들이 대화 목록의 자리를 먹는다(최소 높이
 * 560px 에서 다른 프로젝트가 여섯이면 목록이 한두 줄이었다, 2026-10-06 겹판 조사). 활성이 아닌 프로젝트가
 * `limit` 개를 넘으면 가장 급한 `limit` 개만 세우고 나머지 수를 `hidden` 으로 돌려준다(그 수가 `프로젝트
 * N개 더 보기` 의 N 이다). 같은 급함은 등록 순서를 지킨다. 하나만 가려지는 경우(`limit` + 1 개)는 `1개 더
 * 보기` 줄이 그 한 줄과 같은 자리를 먹으니 숨기지 않고 모두를 등록 순서대로 세운다 — `limit` 개 이하도 같다.
 */
export function pickOthers(
  projects: readonly ProjectSummary[],
  activeSlug: string | null,
  words: ProjectNoteWords,
  limit = 3,
): { shown: ProjectSummary[]; hidden: number } {
  const others = projects.filter((project) => project.slug !== activeSlug);
  if (others.length <= limit + 1) return { shown: others, hidden: 0 };
  const ranked = others
    .map((project, order) => ({
      project,
      order,
      urgency: URGENCY[projectNote(project, words).kind],
    }))
    .sort((a, b) => a.urgency - b.urgency || a.order - b.order);
  return {
    shown: ranked.slice(0, limit).map((entry) => entry.project),
    hidden: others.length - limit,
  };
}
