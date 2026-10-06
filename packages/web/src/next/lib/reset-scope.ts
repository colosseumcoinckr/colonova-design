/**
 * 전체 초기화가 지우는 것의 크기(2026-10-06 설정 손질 · S6) — 확인은 네이티브 시트가 마지막으로
 * 묻지만, 단추 곁의 부제가 먼저 실제 수를 말한다. 새 선로 필드는 없다: `ProjectSummary` 의 `branch`
 * (이번 사이클의 보관 가지) · `handoff`(열린 제출) · `pendingChanges` · `working` 에서 읽는다.
 * 시험이 src 에서 곧장 읽는 순수 모듈이라 형제를 부르지 않는다.
 */

export interface ResetProject {
  /** 이번 사이클의 보관 가지 — 첫 보관 전에는 없다. */
  branch?: string | null;
  /** 아직 보관하지 않은 바뀐 파일의 수. */
  pendingChanges: number;
  /** 이 프로젝트에서 AI 가 지금 답을 만드는 중이다. */
  working: boolean;
  /** 이번 사이클의 제출(열린 요청) — 없으면 아직 제출하지 않았다. 옛 데몬의 값에는 키가 없을 수 있다. */
  handoff?: { state: string } | null;
}

export interface ResetScope {
  /** 지워지는 프로젝트의 수 — 등록된 전부다. */
  projects: number;
  /** 제출하지 않은 작업이 있는 프로젝트의 수 — 이 작업은 사라진다. */
  unsubmitted: number;
}

/**
 * 제출하지 않은 작업이 있나 — 바뀐 파일이 있거나 AI 가 만드는 중이거나, 보관해 둔 가지가 있는데
 * 제출이 없다(처음이거나, 반영된 뒤 새 사이클이 시작됐다). 열린 제출이 있으면 개발자에게 닿은
 * 작업이라 그대로 남는다.
 */
function holdsUnsubmitted(project: ResetProject): boolean {
  if (project.working || project.pendingChanges > 0) return true;
  const state = project.handoff?.state;
  const submitted = state !== undefined && state !== "merged";
  return Boolean(project.branch) && !submitted;
}

export function resetScope(projects: readonly ResetProject[]): ResetScope {
  return { projects: projects.length, unsubmitted: projects.filter(holdsUnsubmitted).length };
}
