import type { DraftSummary, ProjectSummary } from "@colonova-design/protocol";
import { timeAgo } from "../../lib/format";
import { L } from "../labels";
import { draftRowStatus, draftsInProgress } from "../plans/home-drafts";
import { openPlanTarget } from "../plans/open-plan";
import type { ShellNav } from "../slots";
import { ChevronRightIcon, PencilIcon, PlansDocIcon, PlusIcon } from "../ui/icons";

/** 묶음에 서는 초안 줄의 수 — 나머지는 끝 줄이 기획서 목록으로 연다. */
const SHOWN = 3;

/**
 * 홈의 `기획서` 시작 카드(2026-10-23 기획자 화면 손질 D4 · 화면 전면 재설계 §3.6) — 기획서를 연결한 프로젝트의
 * 홈에만 선다. `화면` 카드와 같은 머리 모양(아이콘 · 이름 · 오른쪽 단추)에 작성 중인 초안 셋이 몸통이다.
 * 줄을 누르면 그 초안이 기획서 칸의 편집기로 열리고(넓은 창은 집중 배치), `새 문서` 로 시작한다.
 *
 * 초안 목록은 셸이 한 번 읽은 것(`useDraftSummaries` — 이 컴퓨터의 초안 저장소)이다. 아직 읽기 전이면(null) 줄 자리를 비워
 * 두고, 읽었는데 없으면 그렇게 말한다. 연결이 끊겼으면 머리 줄이 그 사실을 말하고 `새 문서` 가 잠긴다(기획서 칸의 막대와 같다).
 */
export function HomePlans({
  project,
  drafts,
  nav,
}: {
  project: ProjectSummary;
  drafts: DraftSummary[] | null;
  nav: ShellNav;
}) {
  const summary = project.confluence;
  if (summary === undefined) return null;
  const rows = drafts === null ? null : draftsInProgress(drafts);
  const shown = rows?.slice(0, SHOWN) ?? [];
  const more = rows === null ? 0 : rows.length - shown.length;
  return (
    <section className="nx-hcard" aria-label={L.home.plansTitle}>
      <div className="nx-hcard-hd">
        <span className="nx-hcard-ic" aria-hidden="true">
          <PlansDocIcon />
        </span>
        <div className="nx-hcard-t">
          <b className="nx-hcard-name">{L.home.plansTitle}</b>
          <span className={`nx-hcard-sub${summary.expired ? " nx-hcard-sub--warn" : ""}`}>
            {summary.expired
              ? L.plans.statusExpired
              : L.home.plansScope(summary.rootTitle, summary.pages)}
          </span>
        </div>
        <div className="nx-hcard-acts">
          <button
            type="button"
            className="nx-btn nx-btn--sm"
            // 연결이 끊겼으면 만들어도 Confluence 에 닿지 않는다 — 기획서 칸의 `새 문서` 와 같은 잠금이다.
            disabled={summary.expired}
            onClick={() => openPlanTarget({ newDoc: true }, nav)}
          >
            <PlusIcon />
            {L.drafts.newDoc}
          </button>
          <button type="button" className="nx-btn nx-btn--sm" onClick={nav.openPlans}>
            {L.plans.open}
            <ChevronRightIcon />
          </button>
        </div>
      </div>
      {rows !== null && (
        <div className="nx-hcard-bd">
          <h3 className="nx-hplans-sub">{L.home.plansInProgress}</h3>
          {shown.length === 0 ? (
            <p className="nx-hplans-none">{L.home.plansNone}</p>
          ) : (
            shown.map((draft) => {
              const status = draftRowStatus(draft);
              return (
                <button
                  key={draft.docKey}
                  type="button"
                  className="nx-irow"
                  onClick={() => openPlanTarget({ docKey: draft.docKey }, nav)}
                >
                  <span className="nx-ilead nx-tone--accent">
                    <PencilIcon />
                  </span>
                  <span className="nx-itext">
                    <span className="nx-it">{draft.title}</span>
                    {/* 손이 필요한 처지는 색과 글이 함께 말한다(정본 §11 — 색만으로 알리지 않는다). */}
                    <span className={`nx-isub${status.warn ? " nx-hplans-warn" : ""}`}>
                      {status.text}
                    </span>
                  </span>
                  <span className="nx-ir">{timeAgo(Date.parse(draft.updatedAt))}</span>
                </button>
              );
            })
          )}
          {more > 0 && (
            <button type="button" className="nx-hplans-more" onClick={nav.openPlans}>
              {L.home.plansMore(more)}
              <ChevronRightIcon />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
