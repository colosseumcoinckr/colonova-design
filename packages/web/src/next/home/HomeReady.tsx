import type { ProjectSummary } from "@colonova-design/protocol";
import { L } from "../labels";
import { CheckIcon, CloseIcon } from "../ui/icons";

/**
 * 서비스가 떴어요(2026-10-07 베타 준비 분석 · 첫 5분) — 첫 준비가 끝난 프로젝트의 줄. 첫 프로젝트의 준비는 3~5분이고
 * 사용자는 그동안 홈에 있다(미리보기 칸이 숨는다). 끝난 순간이 이 제품의 첫 `와` — 내 서비스가 내 컴퓨터에서 떴다 —
 * 인데 예전에는 `처음 켜는 준비` 줄이 말없이 사라졌다. 이제 그 줄이 `화면 보기` 가 있는 줄로 이어 선다. 토스트는 잠깐이고
 * 이 줄은 그 프로젝트의 작업 화면을 볼 때까지(또는 닫을 때까지) 남는다.
 *
 * 몇 개인지는 `ready`(셸이 쥔다 — `use-shell-nav.ts`)가 정한다. 프로젝트가 목록에서 사라졌으면 서지 않는다.
 *
 * 지금 프로젝트의 줄에는 서비스의 첫 화면 사진 한 장이 얹힐 수 있다(`use-first-look.ts` — 데스크톱의 숨은 창이 찍는다).
 * 사진은 늦게 오고 못 찍을 수도 있어서, 줄은 사진 없이도 온전하다.
 */
export function HomeReady({
  projects,
  ready,
  photo = null,
  onSee,
  onDismiss,
}: {
  projects: ReadonlyArray<Pick<ProjectSummary, "slug" | "name">>;
  /** 서비스가 떴는데 아직 그 화면을 보지 않은 프로젝트의 slug. */
  ready: readonly string[];
  /** 그 서비스의 첫 화면 사진(데이터 주소) — 지금 프로젝트의 줄에만 서고, 못 찍었으면 사진 없는 줄이다(2026-10-07). */
  photo?: { slug: string; url: string } | null;
  /** 그 프로젝트의 작업 화면으로 간다. */
  onSee: (slug: string) => void;
  onDismiss: (slug: string) => void;
}) {
  const rows = ready
    .map((slug) => projects.find((project) => project.slug === slug))
    .filter((project): project is Pick<ProjectSummary, "slug" | "name"> => project !== undefined);
  if (rows.length === 0) return null;
  return (
    <div className="nx-ready-list">
      {rows.map((project) => (
        <div key={project.slug} className="nx-ready" role="status">
          {photo?.slug === project.slug && (
            <div className="nx-ready-shot" aria-hidden="true">
              {/* 장식이다 — 줄의 말이 이미 같은 것을 말한다. 그림이 풀리는지는 부르는 쪽(`use-first-look.ts`)이 먼저 확인했다. */}
              <img src={photo.url} alt="" />
            </div>
          )}
          <div className="nx-ready-row">
            <span className="nx-ready-ic" aria-hidden="true">
              <CheckIcon />
            </span>
            <span className="nx-ready-tx">
              <span className="nx-ready-t">{L.firstReady.title(project.name)}</span>
              <span className="nx-ready-s">{L.firstReady.sub}</span>
            </span>
            <button
              type="button"
              className="nx-btn nx-btn--pri nx-ready-go"
              onClick={() => onSee(project.slug)}
            >
              {L.firstReady.see}
            </button>
            <button
              type="button"
              className="nx-ready-x"
              aria-label={L.toast.close}
              onClick={() => onDismiss(project.slug)}
            >
              <CloseIcon />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
