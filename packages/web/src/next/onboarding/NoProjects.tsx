import type { InviteImportController } from "../../hooks/use-invite-import";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import { Hero } from "./Hero";
import { InviteDrop } from "./InviteDrop";
import { gatePasses } from "./motion";
import "./onboarding.css";

/**
 * 마지막 프로젝트를 정리한 뒤 초대 파일로 다시 시작하는 화면. 머리의 링이 `도구 · AI 는 그대로,
 * 초대 파일만 남았다` 를 한눈에 말하고(2026-10-06 온보딩 손질), 첫 실행과 같은 놓는 자리가 선다.
 */
export function NoProjects({
  daemon,
  invite,
  importing,
}: {
  daemon: Daemon;
  invite: InviteImportController;
  importing: boolean;
}) {
  return (
    <div className="nx nx-ob nx-ob--empty" data-testid="next-empty-projects">
      <div className="nx-ob-inner">
        <Hero
          passes={gatePasses(daemon.onboarding, daemon.projects.length)}
          title={L.onboarding.emptyProjectsTitle}
          sub={L.onboarding.emptyProjectsSub}
        />
        <div className="nx-ob-solo">
          <InviteDrop invite={invite} importing={importing} />
        </div>
      </div>
    </div>
  );
}
