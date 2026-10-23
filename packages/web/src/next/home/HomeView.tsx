import type { DraftSummary, ThreadSummary } from "@colonova-design/protocol";
import { useCallback, useRef, useState } from "react";
import type { Sessions } from "../../hooks/useSessions";
import type { Daemon } from "../../lib/daemon-client";
import type { ComposerHandle } from "../chat/Composer";
import { L } from "../labels";
import type { ShellNav } from "../slots";
import { ChevronRightIcon } from "../ui/icons";
import { HomeComposer } from "./HomeComposer";
import { HomeInbox } from "./HomeInbox";
import { HomePlans } from "./HomePlans";
import { HomeReady } from "./HomeReady";
import { ScreenCardIcon } from "./icons";

/** 끌고 온 것에 파일이 들었는가 — 글이나 링크를 끄는 손에는 덮개를 펴지 않는다. */
function carriesFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

/**
 * 홈 — 현관(2026-10-23 화면 전면 재설계 §3.6). 위에서부터: 인사(프로젝트 한 줄) · `답을 기다려요`(있을 때만) ·
 * `기획서` · `화면` 두 시작 카드 · (처음인 프로젝트만) 세 걸음 · `서비스가 떴어요` 줄 · 나머지 받은 편지함 묶음.
 *
 * 기다리는 일이 맨 위다 — 내 손이 필요한 일을 찾으려고 화면을 끝까지 내리지 않게(설계 M5).
 * `HomeInbox` 를 두 번 부른다(묶음을 고르는 `part` — 겉 계약은 넓히기만): 편지함의 셈 · 접힘 · 거둠 규칙은
 * `GUIDE` §3 그대로고 순서만 바뀐다.
 *
 * 파일은 홈 어디에 놓아도 입력창의 첨부가 된다(2026-10-06) — 대화 칸이 칸 전체를 놓는 자리로 삼는
 * 것과 같다. 끄는 동안은 입력창이 덮개를 입어 놓을 자리를 말한다.
 */
export function HomeView({
  daemon,
  sessions,
  nav,
  titleFor,
  ready = [],
  drafts = null,
}: {
  daemon: Daemon;
  sessions: Sessions;
  nav: ShellNav;
  /** 대화의 표시 이름 — 사용자가 바꾼 이름을 따른다(사이드바와 같은 이름). */
  titleFor?: (thread: ThreadSummary) => string;
  /** 첫 준비가 끝났는데 아직 그 화면을 보지 않은 프로젝트 — `서비스가 떴어요` 줄이 선다(2026-10-07). */
  ready?: readonly string[];
  /** 지금 프로젝트의 초안 요약 — 기획서 카드가 읽는다. 연결 전 · 읽기 전이면 null(2026-10-23 기획자 화면 손질 D4). */
  drafts?: DraftSummary[] | null;
}) {
  const active = daemon.projects.find((project) => project.slug === daemon.activeSlug) ?? null;
  const author = daemon.status?.authorName?.trim();
  const composer = useRef<ComposerHandle | null>(null);
  const registerHandle = useCallback((handle: ComposerHandle | null) => {
    composer.current = handle;
  }, []);
  // 들어온 · 나간 짝을 세어 덮개를 편다 — 자식 위를 지날 때마다 enter/leave 가 번갈아 오므로 깊이로 센다.
  const [dragDepth, setDragDepth] = useState(0);
  // 기획서를 연결한 프로젝트 — 인사 아래 한 줄과 세 걸음이 기획의 한 바퀴를 말한다(2026-10-23 U4).
  const planning = active?.confluence !== undefined;
  // 세 걸음의 머리 셋 — 처음인 프로젝트에서만 두 카드 아래 한 줄로 선다.
  const steps = planning
    ? [L.home.guidePlan, L.home.guideBuild, L.home.guideShip]
    : [L.home.guideAsk, L.home.guideCheck, L.home.guideSubmit];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 홈 전체가 파일을 놓는 자리다 — 드롭은 포인터의 일이고, 키보드는 입력창의 첨부 단추로 닿는다.
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: 위와 같다.
    <div
      className="nx-home"
      onDragOver={(event) => {
        if (carriesFiles(event)) event.preventDefault();
      }}
      onDragEnter={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDragDepth((depth) => depth + 1);
      }}
      onDragLeave={(event) => {
        if (!carriesFiles(event)) return;
        setDragDepth((depth) => Math.max(0, depth - 1));
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDragDepth(0);
        if (event.dataTransfer.files.length > 0) composer.current?.attach(event.dataTransfer.files);
      }}
    >
      <div className="nx-home-inner">
        <div className="nx-home-intro">
          <h1 className="nx-greet">
            <span>{author ? L.home.greet(author) : L.transcript.emptyTitle}</span>
          </h1>
          {/* 프로젝트는 이 한 줄과 사이드바가 말한다 — 머리의 `현재 프로젝트 · 화면 열기` 줄은 걷었다(설계 §3.6). */}
          {active && (
            <p className="nx-home-where">
              {L.home.where(active.name, active.confluence?.rootTitle || null)}
            </p>
          )}
        </div>
        {/* ① 답을 기다려요 — 있을 때만. 이 면에서 가장 두드러진다(지금 카드 그대로). */}
        <HomeInbox
          part="waiting"
          daemon={daemon}
          titleFor={titleFor}
          onOpenThread={nav.openThread}
          onSwitch={nav.switchProject}
          onOpenWork={nav.showThread}
          onShowScreen={nav.showScreen}
        />
        {/* ② 두 시작 카드 — 기획서 왼쪽 · 화면 오른쪽. 본문 폭 1000px 이상에서 나란히 선다(home.css). */}
        <div className="nx-start">
          {active && <HomePlans project={active} drafts={drafts} nav={nav} />}
          {active && (
            <section className="nx-hcard" aria-label={L.home.screenTitle}>
              <div className="nx-hcard-hd">
                <span className="nx-hcard-ic" aria-hidden="true">
                  <ScreenCardIcon />
                </span>
                <div className="nx-hcard-t">
                  <b className="nx-hcard-name">{L.home.screenTitle}</b>
                  {/* 한 줄 소개 — `기획서` 카드와 같은 해부로 서서 두 머리의 구분선이 같은 높이에 선다(2026-10-24 QA 13). */}
                  <span className="nx-hcard-sub">{L.home.screenIntro}</span>
                </div>
                <div className="nx-hcard-acts">
                  {/* 예전 홈 머리의 단추 — 화면은 이제 이 카드가 말한다(설계 §3.6). */}
                  <button
                    type="button"
                    className="nx-btn nx-btn--sm"
                    onClick={() => nav.openProjectScreen(active.slug)}
                  >
                    {L.home.openScreen}
                    <ChevronRightIcon />
                  </button>
                </div>
              </div>
              <div className="nx-hcard-bd">
                <HomeComposer
                  daemon={daemon}
                  sessions={sessions}
                  projects={daemon.projects}
                  active={active}
                  dropping={dragDepth > 0}
                  registerHandle={registerHandle}
                  onSwitch={nav.switchProject}
                  onOpened={nav.showThread}
                  onToast={nav.toast}
                />
              </div>
            </section>
          )}
        </div>
        {/* ③ 세 걸음 — 처음인 프로젝트에서만(대화도 일도 없을 때). */}
        {active &&
          (active.threads?.length ?? 0) === 0 &&
          !active.working &&
          active.pendingCount === 0 && (
            <ol className="nx-home-guide" aria-label={L.home.guideLabel}>
              {steps.map((head, at) => (
                <li key={head}>
                  <span className="nx-home-guide-n" aria-hidden="true">
                    {at + 1}
                  </span>
                  <b>{head}</b>
                  {at < steps.length - 1 && <ChevronRightIcon />}
                </li>
              ))}
            </ol>
          )}
        <HomeReady
          projects={daemon.projects}
          ready={ready}
          photo={null}
          onSee={nav.openProjectScreen}
          onDismiss={nav.dismissReady}
        />
        {/* ④ 나머지 묶음 — 지금 진행 중 · 이어서 하기 · 방금 있던 일 · 반영된 일(순서 · 접힘 그대로). */}
        <HomeInbox
          part="rest"
          daemon={daemon}
          titleFor={titleFor}
          onOpenThread={nav.openThread}
          onSwitch={nav.switchProject}
          onOpenWork={nav.showThread}
          onShowScreen={nav.showScreen}
        />
      </div>
    </div>
  );
}
