import type { ProjectSummary } from "@colonova-design/protocol";
import { L } from "../labels";
import { pickOthers, projectNote } from "../lib/project-note";
import { NoteMark, ProjectMark } from "../ui/ProjectMark";
import { cycleDotOf } from "./ProjectSwitcher";

/**
 * 다른 프로젝트 줄(U7) — 활성이 아닌 프로젝트마다 한 줄, 이름과 가장 급한 것
 * 하나(`projectNote`). 누르면 그 프로젝트로 옮긴다.
 *
 * 2026-10-06 겹판 조사 — 가장 급한 셋만 세운다(`pickOthers`). 낮은 창(최소 560px)에서는 이 줄들이 대화
 * 목록의 자리를 먹어, 다른 프로젝트가 여섯이면 목록이 한두 줄이었다. 나머지는 `프로젝트 N개 더 보기` 가
 * 전환기 목록으로 열어 준다.
 */
export function OtherProjects({
  projects,
  activeSlug,
  onSwitch,
  onMore,
}: {
  projects: ProjectSummary[];
  activeSlug: string | null;
  onSwitch: (slug: string) => void;
  /** `더 보기` — 전환기 목록을 연다. */
  onMore: () => void;
}) {
  const { shown, hidden } = pickOthers(projects, activeSlug, L);
  if (shown.length === 0) return null;
  return (
    <div className="nx-others">
      <div className="nx-side-label nx-side-label--tight">{L.sidebar.others}</div>
      {shown.map((project) => {
        const note = projectNote(project, L);
        return (
          <button
            key={project.slug}
            type="button"
            className="nx-orow"
            title={L.sidebar.switchTo(project.name)}
            onClick={() => onSwitch(project.slug)}
          >
            <ProjectMark slug={project.slug} name={project.name} size="sm" />
            <span className="nx-orow-name">{project.name}</span>
            <span className={`nx-onote nx-tone--${note.tone}`}>
              <NoteMark note={note} cycle={cycleDotOf(project)} />
              {note.text}
            </span>
          </button>
        );
      })}
      {hidden > 0 && (
        <button type="button" className="nx-orow nx-omore" onClick={onMore}>
          {L.sidebar.moreProjects(hidden)}
        </button>
      )}
    </div>
  );
}
