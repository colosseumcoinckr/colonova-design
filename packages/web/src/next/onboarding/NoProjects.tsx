import { L } from "../labels";

/** 마지막 프로젝트를 정리한 뒤 초대 파일로 다시 시작하는 화면. */
export function NoProjects({
  openInvite,
  importing,
}: {
  openInvite: () => void;
  importing: boolean;
}) {
  return (
    <div className="nx nx-ob nx-ob--empty" data-testid="next-empty-projects">
      <div className="nx-ob-inner">
        <div className="nx-ob-logo" aria-hidden="true">
          <img src="/colonova-icon.svg" alt="" width={36} height={36} />
        </div>
        <h1 className="nx-ob-title">{L.onboarding.emptyProjectsTitle}</h1>
        <p className="nx-ob-sub">{L.onboarding.emptyProjectsSub}</p>
        {importing ? (
          <p className="nx-empty-projects-progress" role="status">
            {L.onboarding.inviteOpening}
          </p>
        ) : (
          <button type="button" className="nx-btn nx-btn--pri" onClick={openInvite}>
            {L.onboarding.emptyProjectsInvite}
          </button>
        )}
      </div>
    </div>
  );
}
