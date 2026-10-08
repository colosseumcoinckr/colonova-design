import type { ProjectSummary } from "@colonova-design/protocol";
import { useMemo, useRef, useState } from "react";
import type { Sessions } from "../../hooks/useSessions";
import type { Attachment } from "../../lib/attachment";
import type { Daemon } from "../../lib/daemon-client";
import { Composer, type ComposerHandle } from "../chat/Composer";
import { L } from "../labels";
import { connectionLock } from "../lib/connection-copy";
import { firstScreenName, recentScreenName, startersOf } from "../lib/home-starters";
import { CheckIcon, ChevronDownIcon, DropIcon, Spin } from "../ui/icons";
import { Popover } from "../ui/Popover";
import { ProjectMark } from "../ui/ProjectMark";
import { HomeStarters } from "./HomeStarters";

/**
 * 홈의 큰 입력창(U6) — 대화 칸과 같은 입력창(`chat/Composer`)에 프로젝트 칩을
 * 앞에 세운 것. 보내면 `session.create` → `session.send` 로 활성 프로젝트의 새
 * 대화가 열리고 대화 보기로 넘어간다. 첨부 · 설정 칩도 대화 칸과 같다.
 *
 * 프로젝트 칩은 활성 프로젝트를 따라간다 — 다른 것을 고르면 그 프로젝트로
 * 옮긴다(홈은 그대로). 세션은 활성 프로젝트의 클론에서만 태어나기 때문이다.
 *
 * 입력창 아래에는 안내 한 줄과 시작점 칩이 선다(2026-10-06 홈 개선) — 칩은 보내지 않고 고쳐 쓸
 * 초안을 입력창에 담는다. 파일을 끌어다 놓는 자리는 홈 전체다(`HomeView`) — 이 입력창은 놓는
 * 동안 덮개만 입고, 받은 파일은 `registerHandle` 로 넘긴 손이 첨부한다.
 */
export function HomeComposer({
  daemon,
  sessions,
  projects,
  active,
  dropping,
  registerHandle,
  onSwitch,
  onOpened,
  onToast,
}: {
  daemon: Daemon;
  sessions: Sessions;
  projects: ProjectSummary[];
  active: ProjectSummary | null;
  /** 파일을 끌어 홈 위에 올려 둔 동안 — 입력창이 덮개를 입는다. */
  dropping: boolean;
  registerHandle: (handle: ComposerHandle | null) => void;
  /** 프로젝트를 옮긴다 — 끝나면 옮겼는지(true) 알린다(셸의 `nav.switchProject`). 알리지 않으면 옮긴 것으로 본다. */
  onSwitch: (slug: string) => Promise<boolean> | undefined;
  /** 새 대화가 태어났다 — 셸이 대화 보기로 넘어간다. */
  onOpened: () => void;
  onToast: (text: string) => void;
}) {
  const [pickOpen, setPickOpen] = useState(false);
  /** 옮기는 중인 프로젝트 — 그 줄에 도는 표식이 서고 다른 줄의 눌림은 잠깐 닫힌다(사이드바 전환기와 같은 문법). */
  const [moving, setMoving] = useState<string | null>(null);
  const chip = useRef<HTMLButtonElement>(null);
  // 시작점 칩이 입력창에 담는 초안 — 같은 칩을 다시 눌러도 다시 담기도록 차례를 단다.
  const [prefill, setPrefill] = useState<{
    text: string;
    nonce: number;
    select?: [number, number];
  } | null>(null);
  const [filled, setFilled] = useState(false);
  const lock = connectionLock(daemon.connection, L);
  const cycleScreens = daemon.repo?.cycleScreens;
  // 이번 작업이 만진 화면이 없으면(처음 켠 서비스) 서비스의 첫 화면 이름으로 선다 — 데몬이 준비가 끝나면 읽어 온다.
  const firstName = firstScreenName(daemon.repo?.firstScreen);
  const starters = useMemo(
    () => startersOf(recentScreenName(cycleScreens) ?? firstName, L.home.starters),
    [cycleScreens, firstName],
  );

  const send = async (text: string, attachments: Attachment[]) => {
    if (!active) throw new Error(L.chat.somethingWrong);
    // create 가 돌려준 id 로 곧장 보낸다 — 클로저의 activeId 는 아직 create
    // 전의 값이라, 그것을 믿으면 이름 없는 두 번째 대화가 열린다(useSessions).
    const id = await sessions.create();
    if (!id) throw new Error(L.chat.somethingWrong);
    // 2026-10-04 ux-review(2차): 보내기가 거절되면 실패 문장의 주인(컴포저)이 살아
    // 있어야 한다 — onOpened 를 먼저 부르면 홈이 언마운트해 실패가 무반응으로 끝난다.
    // sendTurn 은 데몬이 받아들일 때만 돌아오므로(답을 기다리지 않는다), 성공 뒤의
    // 전환 지연은 데몬 왕복 한 번이다.
    await sessions.sendTurn(
      text,
      attachments.map(({ name, mediaType, data }) => ({ name, mediaType, data })),
      id,
    );
    onOpened();
  };

  const choose = (project: ProjectSummary) => {
    if (!active) return;
    if (project.slug === active.slug) {
      setPickOpen(false);
      return;
    }
    if (moving !== null) return;
    setMoving(project.slug);
    // 옮기면 목록이 걷히고, 못 옮기면 열린 채 남는다(실패는 셸이 알림으로 말한다).
    void Promise.resolve(onSwitch(project.slug)).then((moved) => {
      setMoving(null);
      if (moved !== false) setPickOpen(false);
    });
  };

  const projectChip = active && (
    <div className="nx-anchor nx-pchip-wrap">
      <button
        ref={chip}
        type="button"
        className="nx-pchip"
        aria-haspopup="menu"
        aria-expanded={pickOpen}
        onClick={() => setPickOpen((open) => !open)}
      >
        <ProjectMark slug={active.slug} name={active.name} size="sm" />
        <span className="nx-pchip-n">{active.name}</span>
        <ChevronDownIcon />
      </button>
      {pickOpen && (
        /* 모델 칩과 같은 줄 — 홈에서는 아래로 열어 팝이 창 위로 나가지 않게. 사이드바 전환기와 같은
           메뉴 문법(2026-10-06 겹판 조사): 이름 있는 menu · 줄은 menuitemradio 로 현재를 말하고(칩 자신의
           aria-current 는 눌러 여는 단추가 `현재` 라는 어색한 낭독이라 걷었다) · 옮기는 중은 줄에서 돈다. */
        <Popover
          anchor={chip}
          onClose={() => setPickOpen(false)}
          role="menu"
          label={L.home.whichService}
        >
          <div className="nx-mh">{L.home.whichService}</div>
          {projects.map((project) => {
            const current = project.slug === active.slug;
            const busy = moving === project.slug;
            return (
              <button
                key={project.slug}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                aria-busy={busy || undefined}
                className="nx-mi"
                onClick={() => choose(project)}
              >
                <ProjectMark slug={project.slug} name={project.name} size="sm" />
                <b>{project.name}</b>
                {busy ? (
                  <span className="nx-r nx-proj-busy">
                    <Spin />
                    <span className="nx-vh">{L.palette.moving}</span>
                  </span>
                ) : (
                  current && (
                    <span className="nx-ck nx-r">
                      <CheckIcon />
                    </span>
                  )
                )}
              </button>
            );
          })}
        </Popover>
      )}
    </div>
  );

  return (
    <div className="nx-hero">
      <div className="nx-hc">
        <Composer
          daemon={daemon}
          sessions={sessions}
          variant="home"
          subject="next"
          draftKey={`home:${active?.slug ?? "none"}`}
          placeholder={L.home.placeholder}
          leading={projectChip}
          lockReason={lock}
          prefill={prefill}
          registerHandle={registerHandle}
          onContentChange={setFilled}
          onToast={onToast}
          onSend={(text, attachments) => send(text, attachments)}
        />
        {dropping && (
          <div className="nx-hdrop" aria-hidden="true">
            <DropIcon />
            {L.home.dropHere}
          </div>
        )}
      </div>
      {/* 첫 준비가 도는 동안은 기다리는 사람에게 말한다 — 먼저 써 두어도 되고, 보낸 말은 준비가 끝나면 나간다(데몬이 대기 줄에 세운다). */}
      <div className="nx-home-hint">{active?.firstPrep ? L.home.hintPreparing : L.home.hint}</div>
      <HomeStarters
        starters={starters}
        away={filled || lock !== null}
        onPick={(starter) =>
          setPrefill((prev) => ({
            text: starter.text,
            select: starter.pick ?? undefined,
            nonce: (prev?.nonce ?? 0) + 1,
          }))
        }
      />
    </div>
  );
}
