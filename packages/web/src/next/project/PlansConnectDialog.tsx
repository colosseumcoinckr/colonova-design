import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import { connectionLock } from "../lib/connection-copy";
import { ConfluenceConnect } from "../settings/ConfluenceConnect";
import { ModalBody, ModalFrame, ModalHead } from "../ui/ModalFrame";
import "./project.css";

/**
 * 기획서 연결 대화상자(2026-11-13 사용자 결정 — 기획서 연결을 프로젝트 쪽으로).
 * 설정은 이 컴퓨터 전체의 값인데 기획서(Confluence) 연결만 활성 프로젝트의 값이라,
 * 프로젝트 전환기의 `프로젝트 정보` 카드와 설정 → 연결의 한 줄이 여기로 보낸다.
 * 폼은 설정에 있던 `ConfluenceConnect` 를 그대로 쓰고, 잠금은 설정이 계산하던
 * 것과 같은 `connectionLock` 이다. 프로젝트를 옮기면 `key` 가 갈려 폼이 새로 선다.
 */
export function PlansConnectDialog({ daemon, onClose }: { daemon: Daemon; onClose: () => void }) {
  const projectName =
    daemon.projects.find((project) => project.slug === daemon.activeSlug)?.name ?? null;
  // 설정이 계산하던 것과 같은 잠금 — 데몬 연결이 열려 있지 않으면 입력이 죽고
  // 이유를 띠로 말한다(말 없이 잠긴 입력은 남기지 않는다).
  const lockReason = connectionLock(daemon.connection, L);
  const locked = lockReason !== null;
  return (
    <ModalFrame onClose={onClose} className="nx-pcd">
      <ModalHead
        title={L.plans.title}
        sub={projectName !== null ? L.plans.connectDialogSub(projectName) : L.plans.titleSub}
      />
      <ModalBody>
        {lockReason !== null && (
          <div className="nx-banner nx-banner--amber nx-pc-lock" role="status">
            <span className="nx-banner-body">{lockReason}</span>
          </div>
        )}
        <ConfluenceConnect key={daemon.activeSlug ?? ""} daemon={daemon} locked={locked} />
      </ModalBody>
    </ModalFrame>
  );
}
