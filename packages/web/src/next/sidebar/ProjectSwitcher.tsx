import type { ProjectSummary } from "@colonova-design/protocol";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { composing } from "../../lib/ime";
import { requestInvitePicker } from "../../lib/invite-bus";
import { openLink } from "../../lib/open-link";
import { setEmptyAfterProjectRemoval } from "../../lib/project-empty-bus";
import { L } from "../labels";
import { neverPrepared, projectCycle, projectStatus } from "../lib/project-note";
import { Count } from "../ui/Count";
import { InlineConfirm } from "../ui/InlineConfirm";
import { CheckIcon, ChevronsUpDownIcon, InfoIcon, PlusIcon, Spin } from "../ui/icons";
import { Popover } from "../ui/Popover";
import { NoteMark, ProjectMark } from "../ui/ProjectMark";

/** 줄 앞 점의 색 — 한 번도 연 적 없는 프로젝트는 회색이다. */
export function cycleDotOf(project: ProjectSummary): string {
  return neverPrepared(project) ? "none" : projectCycle(project);
}

/**
 * 사이드바 머리의 전환기(U7) — 머리는 한 덩어리 단추다: 누르면 프로젝트마다 상태 점 · 기다리는
 * 숫자 · `처음 열 때 준비해요` 가 선 목록이 떠 고르면 `project.activate` 한다. 목록 맨 아래의 두 줄은
 * 지금 프로젝트의 카드(아래 `ProjectInfo`)와 새 프로젝트 들이기(초대 파일)로 간다.
 *
 * 2026-10-06 사이드바 개선 — 머리가 이름 누름(카드)과 셰브론 누름(목록)으로 갈라져 있었다. 고르는
 * 상자처럼 보이는 머리의 이름 쪽을 눌러도 목록이 아니라 프로젝트를 빼는 줄이 든 카드가 열렸고, 두
 * 누름이 한 테두리에 붙어 어느 쪽이 무엇을 여는지 겉으로 알 수 없었다. 이제 머리는 고르는 상자 하나
 * (오른쪽 끝 위아래 화살표)로 목록만 열고, 카드는 그 목록의 한 줄로 내렸다.
 *
 * 2026-10-06 겹판 조사 — 목록은 `role="menu"` 다: 프로젝트 줄은 `menuitemradio`(고른 줄이 `aria-checked`,
 * 키보드로 열면 그 줄이 첫 초점) · 아래 두 줄은 `menuitem` 이라 ↑ ↓ Home End · 글자 건너뛰기가 붙는다.
 * 줄을 눌러 옮기는 동안 그 줄에 도는 표식이 서고(`aria-busy`), 실패는 셸이 한 문장으로 알린다.
 */
export function ProjectSwitcher({
  daemon,
  projects,
  active,
  onSwitch,
  onToast,
  openSignal = 0,
}: {
  daemon: Daemon;
  projects: ProjectSummary[];
  active: ProjectSummary | null;
  /** 프로젝트를 옮긴다 — 끝나면 옮겼는지(true) 알린다(셸의 `nav.switchProject`). 알리지 않으면 옮긴 것으로 본다. */
  onSwitch: (slug: string) => Promise<boolean> | undefined;
  onToast: (text: string) => void;
  /** 올라갈 때마다 목록을 연다 — `다른 프로젝트` 의 `더 보기` 가 전환기를 부르는 길이다. */
  openSignal?: number;
}) {
  const [pop, setPop] = useState<"list" | "info" | null>(null);
  /** 옮기는 중인 프로젝트 — 그 줄에 도는 표식이 서고 다른 줄의 눌림은 잠깐 닫힌다. */
  const [moving, setMoving] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // 머리 밖에서 목록을 열라는 신호 — 초점을 머리로 먼저 옮겨야 키보드로 누른 손이 열린 목록에 닿는다
  // (팝은 여는 단추에 키보드 초점이 있을 때만 첫 줄로 초점을 건넨다).
  const lastSignal = useRef(openSignal);
  useEffect(() => {
    if (openSignal === lastSignal.current) return;
    lastSignal.current = openSignal;
    trigger.current?.focus();
    setPop("list");
  }, [openSignal]);
  if (!active) return null;
  const status = projectStatus(active, L);
  const choose = (project: ProjectSummary) => {
    if (project.slug === active.slug) {
      setPop(null);
      return;
    }
    if (moving !== null) return;
    setMoving(project.slug);
    // 옮기면 목록이 걷히고, 못 옮기면 열린 채 남는다(실패는 셸이 알림으로 말한다).
    void Promise.resolve(onSwitch(project.slug)).then((moved) => {
      setMoving(null);
      if (moved !== false) setPop(null);
    });
  };
  return (
    <div className="nx-proj nx-anchor">
      <button
        ref={trigger}
        type="button"
        className="nx-proj-btn"
        aria-haspopup="menu"
        aria-expanded={pop !== null}
        title={L.shell.projectMenu}
        onClick={() => setPop((value) => (value === null ? "list" : null))}
      >
        <ProjectMark slug={active.slug} name={active.name} />
        <span className="nx-proj-nm">
          <b>{active.name}</b>
          <span>
            <NoteMark note={status} cycle={cycleDotOf(active)} />
            {status.text}
          </span>
        </span>
        <span className="nx-proj-caret">
          <ChevronsUpDownIcon />
        </span>
      </button>
      {pop === "list" && (
        <Popover
          anchor={trigger}
          onClose={() => setPop(null)}
          className="nx-proj-pop"
          label={L.shell.projectMenu}
          role="menu"
        >
          <div className="nx-mh">{L.sidebar.projects}</div>
          {projects.map((project) => {
            const row = projectStatus(project, L);
            const current = project.slug === active.slug;
            const busy = moving === project.slug;
            return (
              <button
                key={project.slug}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                aria-busy={busy || undefined}
                className={`nx-mi nx-proj-row${current ? " nx-proj-row--now" : ""}`}
                onClick={() => choose(project)}
              >
                <ProjectMark slug={project.slug} name={project.name} />
                <span className="nx-mt">
                  <b>{project.name}</b>
                  <small>
                    <NoteMark note={row} cycle={cycleDotOf(project)} />
                    {row.text}
                    {neverPrepared(project) && ` · ${L.sidebar.prepareOnFirstOpen}`}
                  </small>
                </span>
                {busy ? (
                  <span className="nx-r nx-proj-busy">
                    <Spin />
                    <span className="nx-vh">{L.palette.moving}</span>
                  </span>
                ) : project.pendingCount > 0 ? (
                  <Count n={project.pendingCount} className="nx-r" />
                ) : current ? (
                  <span className="nx-ck nx-r">
                    <CheckIcon />
                  </span>
                ) : null}
              </button>
            );
          })}
          <div className="nx-msep" />
          <button
            type="button"
            role="menuitem"
            className="nx-mi"
            onClick={() => {
              // 목록이 걷히며 눌린 단추가 사라지니 초점을 머리로 돌려 놓는다 — 카드가 그 뒤에 선다.
              setPop("info");
              trigger.current?.focus();
            }}
          >
            <span className="nx-mi-ic">
              <InfoIcon />
            </span>
            <b>{L.sidebar.projectInfo}</b>
          </button>
          <button
            type="button"
            role="menuitem"
            className="nx-mi"
            onClick={() => {
              setPop(null);
              requestInvitePicker();
            }}
          >
            <span className="nx-mi-ic">
              <PlusIcon />
            </span>
            <b>{L.sidebar.addProject}</b>
          </button>
        </Popover>
      )}
      {pop === "info" && (
        <ProjectInfo
          daemon={daemon}
          project={active}
          lastProject={projects.length === 1}
          anchor={trigger}
          onClose={() => setPop(null)}
          onToast={onToast}
        />
      )}
    </div>
  );
}

/** 브라우저가 여는 주소의 모양 — 개발 실행의 로컬 저장소는 자리가 다르다. */
const WEB_URL = /^https?:\/\//i;

/**
 * 프로젝트 카드 — 전환기 목록의 `프로젝트 정보` 를 누르면 그 아래에 뜬다. 저장소 · 미리보기는
 * 링크의 규칙대로 열고(open-link), `지켜 줄 것` 은 흐림 · ⌘↵ 로 저장한다
 * (README 「프로젝트와 목록」 — 새로 시작하는 대화부터 끝에 붙는다). 바깥을 눌러
 * 닫혀도 적던 초안은 놓치지 않는다: 닫힘과 같은 커밋에서 저장한다.
 *
 * 맨 아래 `목록에서 빼기` 는 파일을 지우지 않는다(데몬의 `project.remove` — 대화와 작업 파일이 이
 * 컴퓨터에 남는다). 그래도 되돌리려면 초대 파일이 필요하니 확인을 거친다 — 대화 지우기와 같은
 * 한 칸(`InlineConfirm`): 일을 이름으로 말하고, 영향의 크기를 말하고, 초점은 `그만두기` 에 선다.
 */
function ProjectInfo({
  daemon,
  project,
  lastProject,
  anchor,
  onClose,
  onToast,
}: {
  daemon: Daemon;
  project: ProjectSummary;
  lastProject: boolean;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  onToast: (text: string) => void;
}) {
  const stored = project.instructions ?? "";
  const [guide, setGuide] = useState(stored);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  // 확인이 접히면(그만두기 · Esc) 초점이 돌아올 줄 — 확인이 떠 있는 동안은 줄이 없다.
  const removeRow = useRef<HTMLButtonElement>(null);
  const removeBox = useRef<HTMLDivElement>(null);
  // 카드는 낮은 창에서 안쪽이 굴러가고 확인은 그 맨 아래에 선다 — 확인이 뜨면 보이는 자리로 올린다
  // (초점은 굴리지 않고 `그만두기` 에 서므로 단추가 접힌 곳에 숨을 수 있다).
  useEffect(() => {
    if (confirmingRemove) removeBox.current?.scrollIntoView({ block: "nearest" });
  }, [confirmingRemove]);
  const latest = useRef({ guide, stored });
  latest.current = { guide, stored };
  const sent = useRef<string>(stored);
  const removingProject = useRef(false);
  /** 저장 — 같은 값은 다시 쓰지 않고, 비우면 지운다(null). */
  const commit = useRef(() => {});
  commit.current = () => {
    const { guide: value, stored: now } = latest.current;
    if (value === now || value === sent.current) return;
    sent.current = value;
    void daemon.api
      .projectUpdate(project.slug, { instructions: value.trim() ? value : null })
      .then(() => onToast(L.projInfo.guideSavedToast))
      .catch(() => {
        sent.current = now;
        onToast(L.projInfo.guideSaveFailed);
      });
  };
  // 바깥 누름 · Esc 로 카드가 떼어지는 길도 저장과 같은 커밋으로 나간다.
  useEffect(
    () => () => {
      if (!removingProject.current) commit.current();
    },
    [],
  );
  const submitPhase = daemon.activeSlug === project.slug ? daemon.repo?.submit?.phase : undefined;
  const projectBusy =
    project.working ||
    ["cloning", "pulling", "installing", "starting"].includes(project.phase) ||
    submitPhase === "running" ||
    submitPhase === "retrying";
  const removeProject = async () => {
    if (removing || projectBusy) return;
    if (lastProject) setEmptyAfterProjectRemoval(true);
    removingProject.current = true;
    setRemoving(true);
    try {
      await daemon.api.projectRemove(project.slug);
      onClose();
      onToast(L.projInfo.removeDone(project.name));
    } catch {
      if (lastProject) setEmptyAfterProjectRemoval(false);
      removingProject.current = false;
      setRemoving(false);
      setConfirmingRemove(false);
      onToast(L.projInfo.removeFailed);
    }
  };
  const repoUrl = project.repoUrl ?? null;
  const repo = repoUrl !== null && WEB_URL.test(repoUrl) ? repoUrl : null;
  const preview = daemon.repo?.phase === "ready" ? daemon.repo.previewUrl : null;
  return (
    <Popover anchor={anchor} onClose={onClose} className="nx-proj-info" label={project.name}>
      <div className="nx-pi-head">
        <ProjectMark slug={project.slug} name={project.name} />
        <b>{project.name}</b>
      </div>
      <div className="nx-pi-links">
        {repo && (
          <button type="button" className="nx-mi" onClick={() => openLink(repo)}>
            <b>{L.projInfo.openRepo}</b>
            <span className="nx-ext" aria-hidden="true">
              ↗
            </span>
          </button>
        )}
        {preview && (
          <button type="button" className="nx-mi" onClick={() => openLink(preview)}>
            <b>{L.projInfo.openPreview}</b>
            <span className="nx-ext" aria-hidden="true">
              ↗
            </span>
          </button>
        )}
        <button
          type="button"
          className="nx-mi"
          onClick={() => {
            onClose();
            requestInvitePicker();
          }}
        >
          <b>{L.projInfo.openInvite}</b>
        </button>
      </div>
      <div className="nx-pi-guide">
        <b>{L.projInfo.guide}</b>
        <p className="nx-pi-help">{L.projInfo.guideHelp}</p>
        <textarea
          className="nx-pi-box"
          rows={5}
          value={guide}
          /* 2026-10-04 ux-review(2차): 눈에 보이는 제목(`지켜 줄 것`)이 칸과 이어져 있지
             않다 — 접근 이름을 붙인다. */
          aria-label={L.projInfo.guide}
          placeholder={L.projInfo.guidePlaceholder}
          onChange={(event) => setGuide(event.target.value)}
          onBlur={() => commit.current()}
          onKeyDown={(event) => {
            // 한글이 조합 중이면 ⌘↵ 를 저장으로 읽지 않는다.
            if (composing(event)) return;
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) commit.current();
          }}
        />
        <p className="nx-pi-note">{L.projInfo.guideNote}</p>
      </div>
      <div className="nx-pi-remove" ref={removeBox}>
        {confirmingRemove ? (
          <InlineConfirm
            title={L.projInfo.removeTitle(project.name)}
            body={L.projInfo.removeBody}
            confirmLabel={removing ? L.projInfo.removing : L.projInfo.remove}
            cancelLabel={L.projInfo.removeCancel}
            busy={removing}
            // 바쁜 이유는 눌러야 보이지 않는다 — 막힌 동안 단추 위에 늘 선다.
            busyWhy={projectBusy ? L.projInfo.removeBusy : undefined}
            onConfirm={() => void removeProject()}
            onCancel={() => setConfirmingRemove(false)}
            returnRef={removeRow}
          >
            {lastProject && <p className="nx-iconf-why">{L.projInfo.removeLast}</p>}
          </InlineConfirm>
        ) : (
          <button
            ref={removeRow}
            type="button"
            className="nx-mi nx-mi--dng"
            disabled={removing}
            onClick={() => setConfirmingRemove(true)}
          >
            <b>{L.projInfo.remove}</b>
          </button>
        )}
      </div>
    </Popover>
  );
}
