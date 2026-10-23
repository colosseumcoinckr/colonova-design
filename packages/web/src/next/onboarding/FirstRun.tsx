import type { OnboardingStep } from "@colonova-design/protocol";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useInstallStep } from "../../hooks/use-install-step";
import type { InviteImportController } from "../../hooks/use-invite-import";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import { accountLine, accountText } from "../lib/account-line";
import { INSTALL_STEPS } from "../lib/install-step";
import { useDiagnosticsText } from "../lib/use-diagnostics";
import { Spin } from "../ui/icons";
import { CopyButton } from "./CopyButton";
import { Fold } from "./Fold";
import { Hero } from "./Hero";
import { InviteDrop } from "./InviteDrop";
import {
  AlertIcon,
  Caret,
  GlobeIcon,
  MailIcon,
  SparklesIcon,
  TileCheckIcon,
  WrenchIcon,
} from "./icons";
import { currentGate, type GateKey, gatePasses, takeFreshPasses } from "./motion";
import "./onboarding.css";

/**
 * 처음 한 번(PLAN-UI U11) — 마법사 대신 체크리스트 한 장. `도구 준비 · AI 연결 ·
 * 초대 파일` 세 항목이 스스로 채워지고, `시작하기` 버튼은 없다: 게이트가 모두
 * 지나가고 프로젝트가 생기면 셸(NextShell)이 저절로 작업 화면으로 넘어간다.
 * 판정 · 설치 진행 · 로그인은 데몬의 것(onboarding.check · install 진행기 ·
 * agent.login)을 그대로 읽고, 초대 파일은 셸이 둔 컨트롤러(use-invite-import)가
 * 맡는다 — 이 화면은 놓는 자리를 그릴 뿐이다.
 *
 * 2026-10-06 온보딩 손질: 머리는 진행 링(Hero)이 맡고, 카드는 위계를 가진다 — 지난 항목은 한 줄로
 * 가라앉고, 지금 손이 갈 항목(`currentGate`)은 강조되고, 나머지는 평평히 기다린다. 한 카드의 상태별
 * 몸통은 접히고 펴져(Fold) 상태가 바뀌어도 높이가 튀지 않는다.
 *
 * 2026-10-20 온보딩 손질(비개발자 Windows · mac 설치 검토): 막다른 칸을 없앤다 — 첫 검사가 오래 걸리거나,
 * 도구 칸이 막히거나, 고칠 단추가 없는 AI 칸에는 `다시 확인` 이 서고, AI 칸은 도구가 알려 준 이유를
 * 말한다. 도구 칸의 고침 단추가 돌려준 안내는 버리지 않고 단추 아래에 둔다. 머리는 준비물(유료 계정 ·
 * 초대 파일)을 먼저 말하고, 체크리스트 아래에는 `막혔나요?` 진단 복사가 선다.
 */
export function FirstRun({
  daemon,
  provider,
  invite,
  checking,
  done,
}: {
  daemon: Daemon;
  /** 설정이 고른 에이전트 — 로그인 명령이 에이전트마다 다르다. */
  provider: string;
  /** 셸의 가져오기 컨트롤러 — 상태와 행동의 주인. */
  invite: InviteImportController;
  /** 게이트 검사가 도는 중(첫 상태 · 프로바이더 불일치 재검사). */
  checking: boolean;
  /** 첫 실행이 끝나는 순간 — 제목을 바꾸고 체크리스트가 흐려진다(셸이 붙드는 동안). */
  done: boolean;
}) {
  const steps = daemon.onboarding ?? [];
  const byId = new Map(steps.map((step) => [step.id, step]));
  const gitStep = byId.get("git") ?? null;
  const runtimeStep = byId.get("runtime") ?? null;
  const claudeStep = byId.get("claude") ?? null;

  // ── 도구 준비 — git · 런타임. 데몬이 함께 실어 오는 github 행은 이 판의
  //    일이 아니다(연결은 초대 파일이 맡는다).
  const toolSteps = [gitStep, runtimeStep].filter((step): step is OnboardingStep => step !== null);
  const toolsOpen = toolSteps.filter((step) => step.status !== "pass");
  // 확인이 실패한 항목 — 도는 표시 대신 손이 필요하다는 말을 낸다.
  const toolsFailed = toolSteps.some((step) => step.status === "fail");

  // ── 세 항목의 통과 — 링 · 카드의 위계 · 통과의 순간이 같은 판을 읽는다.
  const projects = daemon.projects;
  const passes = gatePasses(daemon.onboarding, projects.length);
  const { tools: toolsPass, agent: agentPass, invite: invitePass } = passes;

  // ── AI 연결 — 설치 진행기와 로그인 판이 데몬에 산다.
  const installing = daemon.install?.kind === "install-claude";
  const installFailed =
    daemon.installDone?.kind === "install-claude" && !daemon.installDone.ok
      ? daemon.installDone
      : null;
  const loginLive = daemon.login !== null;
  const loginFailed = daemon.loginDone && !daemon.loginDone.ok ? daemon.loginDone.detail : null;
  // 로그인은 됐는데 이 요금제로는 쓸 수 없다고 알려졌다(2026-10-07 베타 준비 분석) — 데몬이 막았다.
  const planBlocked = claudeStep?.reason === "plan" && claudeStep.status !== "pass";
  // 검사가 답했는데 고칠 단추가 없다(bash 를 못 찾음 · 환경의 API 키 경고 …) — `기다리는 중` 으로 두면 끝없이
  // 기다리게 된다. 도구가 알려 준 이유를 말하고 다시 확인을 건넨다(2026-10-20 온보딩 손질).
  const agentStuck = claudeStep !== null && claudeStep.status !== "pass" && !claudeStep.fix;
  const agentState: "pass" | "installing" | "login" | "blocked" | "plan" | "stuck" | "idle" =
    agentPass
      ? "pass"
      : installing
        ? "installing"
        : loginLive
          ? "login"
          : installFailed
            ? "blocked"
            : planBlocked
              ? "plan"
              : agentStuck
                ? "stuck"
                : "idle";
  // 로그인 뒤의 한 줄 — Claude 의 계정을 읽는다. 모르면 예전 문구로 둔다.
  const status = daemon.status;
  const account =
    provider === "claude" && status
      ? accountText(
          accountLine({
            loggedIn: status.loggedIn,
            authMethod: status.authMethod,
            email: status.email,
            subscriptionType: status.subscriptionType,
          }),
          L,
        )
      : null;
  const failureParts = installFailed ? splitInstallDetail(installFailed.detail) : null;

  // 설치가 끝나면 로그인이 저절로 이어진다(목업의 흐름) — 단, 한 번만. 사용자가
  // 필요할 때 누르는 `설치` 버튼과 달리 로그인은 브라우저를 여는 것뿐이라
  // 체크리스트의 "스스로 채워진다" 약속을 지키는 쪽으로 읽는다.
  const [loginStarted, setLoginStarted] = useState(false);
  // 시작의 직후 갭 — fix 요청이 로그인 판(loginLive)으로 이어지기까지. 이 동안만
  // 예고 문장이 서고 수동 시작의 재눌림이 막힌다(2026-10-04 ux-review).
  const [loginLaunching, setLoginLaunching] = useState(false);
  useEffect(() => {
    if (loginStarted || loginLive || installing) return;
    if (claudeStep?.fix?.kind !== "login-claude") return;
    // 요금제가 막은 계정은 브라우저를 저절로 열지 않는다 — 같은 계정으로 다시 돌아오는 헛걸음이 된다.
    if (claudeStep.reason === "plan") return;
    setLoginStarted(true);
    setLoginLaunching(true);
    void daemon.api
      .onboardingFix("login-claude", provider)
      .catch(() => undefined)
      .finally(() => setLoginLaunching(false));
  }, [loginStarted, loginLive, installing, claudeStep, daemon.api, provider]);

  const runFix = (step: OnboardingStep) => {
    void daemon.api
      .onboardingFix(
        step.fix?.kind ?? "install-claude",
        step.fix?.kind === "login-claude" ? provider : undefined,
      )
      .catch(() => undefined);
  };

  // ── 다시 확인 — 앱 밖에서 고친 것(설치 창 · IT 의 허용 · 다시 설치)을 앱을 다시 켜지 않고 읽는다.
  const [rechecking, setRechecking] = useState(false);
  const recheck = () => {
    if (rechecking) return;
    setRechecking(true);
    void daemon.api
      .onboardingCheck(provider)
      .catch(() => undefined)
      .finally(() => setRechecking(false));
  };
  // 첫 검사의 답이 오래 오지 않으면 도는 표시만 두지 않는다 — 검사는 AI 의 로그인 확인까지 돌아 몇 초는 걸린다.
  const firstCheckPending = daemon.onboarding === null;
  const [checkSlow, setCheckSlow] = useState(false);
  useEffect(() => {
    if (!firstCheckPending) {
      setCheckSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setCheckSlow(true), CHECK_SLOW_MS);
    return () => window.clearTimeout(timer);
  }, [firstCheckPending]);
  // 도구 칸의 고침 단추가 돌려준 한 줄(설치 창을 열었어요 · 직접 설치하는 안내 …) — 버리지 않고 단추 아래에 둔다.
  const [toolNote, setToolNote] = useState<string | null>(null);
  const runToolFix = (step: OnboardingStep) => {
    const kind = step.fix?.kind;
    if (!kind) return;
    setToolNote(null);
    void daemon.api
      .onboardingFix(kind)
      .then((reply) => {
        setToolNote(fixReplyLine(reply));
        // 이 고침은 끝까지 돌고 돌아온다 — 곧바로 다시 확인한다.
        if (kind === "install-pnpm") recheck();
      })
      .catch(() => undefined);
  };
  const recheckButton = (primary: boolean) => (
    <button
      type="button"
      className={`nx-btn${primary ? " nx-btn--pri" : ""}`}
      disabled={rechecking || checking}
      onClick={recheck}
    >
      {rechecking ? L.onboarding.toolsChecking : L.onboarding.recheck}
    </button>
  );

  // ── 막혔나요 — 도움말 메뉴와 같은 진단 글을 첫 화면에서 바로 복사한다.
  const buildReport = useDiagnosticsText(daemon);

  // ── 초대 파일 — 첫 프로젝트가 생기면 끝난다.
  const inviteImporting = invite.state.phase === "reading" || invite.state.phase === "applying";

  // 이번에 통과한 항목만 반응한다 — 앱을 켰을 때 이미 통과한 항목은 첫 그림에서
  // '본 것'으로 새겨 튀지 않는다(onboarding/motion 의 판정).
  const passesSeen = useRef<ReadonlySet<GateKey> | null>(null);
  const [freshPasses, setFreshPasses] = useState<GateKey[]>([]);
  useEffect(() => {
    const passed: GateKey[] = [
      ...(toolsPass ? (["tools"] as const) : []),
      ...(agentPass ? (["agent"] as const) : []),
      ...(invitePass ? (["invite"] as const) : []),
    ];
    const taken = takeFreshPasses(passesSeen.current, passed);
    passesSeen.current = taken.seen;
    if (taken.fresh.length > 0) setFreshPasses(taken.fresh);
  }, [toolsPass, agentPass, invitePass]);

  // 설치 진행기의 날 줄은 화면에 내리지 않는다 — 세 칸 막대와 단계 말만 선다.
  const installStep = useInstallStep(daemon.install?.line ?? null);
  const installStepWord =
    installStep === null ? L.settings.installBusy : L.onboarding.installSteps[installStep];
  const installPhase = installStep === null ? 0 : INSTALL_STEPS.indexOf(installStep);

  const agentFix = claudeStep && claudeStep.status !== "pass" ? (claudeStep.fix ?? null) : null;
  const agentBusy = installing || loginLive || checking;

  const agentRight =
    agentState === "pass"
      ? (account ?? L.onboarding.agentOk)
      : agentState === "stuck"
        ? L.onboarding.agentStuck
        : agentState === "plan"
          ? L.account.planBlockedPill
          : agentState === "installing"
            ? L.onboarding.agentInstalling
            : agentState === "login"
              ? L.onboarding.agentLogin
              : agentState === "blocked"
                ? failureParts?.itLine
                  ? L.onboarding.agentBlocked
                  : L.onboarding.agentFailed
                : agentFix?.kind === "install-claude"
                  ? L.onboarding.agentNeedInstall
                  : agentFix?.kind === "login-claude"
                    ? L.onboarding.agentNeedLogin
                    : L.onboarding.agentIdle;

  // 카드의 모양 — 지금 손이 갈 곳은 하나다. 눌러 볼 것이 없는 칸(검사 답을 기다리는 AI)은 건너뛴다.
  // 경고(warn)의 막힘은 길을 막지 않는다(환경의 API 키 — 초대 파일이 들어오면 넘어간다) — 이유는 말하되 차례는 뺏지 않는다.
  const agentStuckWarn = agentState === "stuck" && claudeStep?.status !== "fail";
  const agentWaiting = (agentState === "idle" && !agentFix) || agentStuckWarn;
  const current = done ? null : currentGate(passes, { agent: agentWaiting });
  const agentCard: CardState =
    agentState === "pass"
      ? "ok"
      : agentState === "blocked" || agentState === "plan"
        ? "fail"
        : agentState === "installing" || agentState === "login"
          ? "run"
          : agentFix || (agentState === "stuck" && !agentStuckWarn)
            ? "act"
            : "wait";
  // 로그인은 사용자가 브라우저에서 할 일을 기다리는 칸 — 도는 표시 대신 지구본이 숨 쉰다.
  const agentPulse = agentState === "login";

  return (
    <div className={`nx nx-ob${done ? " nx-ob--done" : ""}`} data-testid="next-first-run">
      <div className="nx-ob-inner">
        <Hero
          passes={passes}
          waiting={{ agent: agentWaiting }}
          done={done}
          title={done ? L.onboarding.doneTitle : L.onboarding.title}
          sub={done ? L.onboarding.doneSub : L.onboarding.sub}
          need={done ? [] : L.onboarding.needs}
        />

        <ol className="nx-ob-steps">
          {/* 도구 준비 */}
          <Step
            glyph={<WrenchIcon />}
            state={
              toolsPass ? "ok" : toolsFailed || (firstCheckPending && checkSlow) ? "act" : "run"
            }
            current={current === "tools"}
            fresh={freshPasses.includes("tools")}
            title={L.onboarding.tools}
            status={
              toolsPass
                ? L.vocab.toolsReady
                : toolsFailed
                  ? L.onboarding.toolsBlocked
                  : L.onboarding.toolsChecking
            }
          >
            {/* 막힌 도구 — 이유 문장들, 그 고침 단추들과 `다시 확인` 이 한 줄에 선다. 고침이 돌려준 안내는 그 아래. */}
            <Fold open={toolsOpen.length > 0}>
              {toolsOpen.map((step) => (
                <p key={step.id} className="nx-ob-d">
                  {step.detail}
                </p>
              ))}
              <div className="nx-ob-acts">
                {toolsOpen.map((step) =>
                  !step.fix ? null : step.fix.href ? (
                    <a
                      key={step.id}
                      className="nx-btn nx-btn--pri"
                      href={step.fix.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {step.fix.label}
                    </a>
                  ) : (
                    <button
                      key={step.id}
                      type="button"
                      className="nx-btn nx-btn--pri"
                      onClick={() => runToolFix(step)}
                    >
                      {step.fix.label}
                    </button>
                  ),
                )}
                {recheckButton(toolsOpen.every((step) => !step.fix))}
              </div>
              {toolNote && (
                <p className="nx-ob-d" role="status">
                  {toolNote}
                </p>
              )}
            </Fold>

            {/* 첫 검사의 답이 오래 오지 않는다 — 도는 표시만 두지 않고 다시 확인을 건넨다. */}
            <Fold open={firstCheckPending && checkSlow}>
              <p className="nx-ob-d">{L.onboarding.checkSlow}</p>
              <div className="nx-ob-acts">{recheckButton(true)}</div>
            </Fold>
          </Step>

          {/* AI 연결 — 갈림길이 있는 칸은 흐리지 않는다. 정말 기다릴 때만 흐린다. */}
          <Step
            glyph={<SparklesIcon />}
            loginGlyph={<GlobeIcon />}
            state={agentCard}
            current={current === "agent"}
            fresh={freshPasses.includes("agent")}
            pulse={agentPulse}
            title={L.onboarding.agent}
            status={agentRight}
          >
            {/* 무엇을 설치하는지 먼저 말한다 — 설치가 도는 동안에도 같은 말이 남는다. */}
            <Fold open={(agentState === "idle" && !loginFailed) || agentState === "installing"}>
              <p className="nx-ob-d">{L.onboarding.agentWhat}</p>
              <p className="nx-ob-d">{L.account.planNeed}</p>
            </Fold>

            {/* 요금제가 막은 계정 — 이유와 요금제가 필요하다는 말, 다른 계정으로 다시 로그인하는 단추 하나. */}
            <Fold open={agentState === "plan"}>
              <p className="nx-ob-d nx-ob-d--red" role="alert">
                {L.account.planBlocked}
              </p>
              <p className="nx-ob-d">{L.account.planNeed}</p>
              <div className="nx-ob-acts">
                <button
                  type="button"
                  className="nx-btn nx-btn--pri"
                  disabled={agentBusy || loginLaunching}
                  onClick={() => claudeStep && runFix(claudeStep)}
                >
                  {agentFix?.label ?? L.account.switchAccount}
                </button>
              </div>
            </Fold>

            {/* 고칠 단추가 없는 막힘 — 도구가 알려 준 이유와 다시 확인. */}
            <Fold open={agentState === "stuck"}>
              <p className="nx-ob-d">{claudeStep?.detail}</p>
              <div className="nx-ob-acts">{recheckButton(true)}</div>
            </Fold>

            {/* 아직 시작 전 — 설치 · 로그인의 첫 걸음. */}
            <Fold open={agentState === "idle" && !loginFailed && agentFix !== null}>
              {/* 시작이 나간 뒤 로그인 판이 서기까지의 빈틈 — 예고 없이 브라우저가 뜨지 않게. */}
              {loginLaunching && (
                <p className="nx-ob-d" role="status">
                  {L.onboarding.loginStarting}
                </p>
              )}
              <div className="nx-ob-acts">
                <button
                  type="button"
                  className="nx-btn nx-btn--pri"
                  disabled={agentBusy || loginLaunching}
                  onClick={() => claudeStep && runFix(claudeStep)}
                >
                  {agentFix?.label}
                </button>
              </div>
            </Fold>

            {/* 설치 중 — 세 칸 막대가 단계를 따라 차고, 설치 프로그램의 날 줄 대신 단계 말만 바뀐다. */}
            <Fold open={agentState === "installing"}>
              <div className="nx-phase" aria-hidden="true">
                {INSTALL_STEPS.map((key, index) => (
                  <i
                    key={key}
                    className={`nx-phase-s nx-phase-s--${
                      index < installPhase ? "ok" : index === installPhase ? "run" : "todo"
                    }`}
                  />
                ))}
              </div>
              <div className="nx-ob-log" role="status">
                <b key={installStepWord} className="nx-inst-word">
                  {installStepWord}
                </b>
              </div>
            </Fold>

            {/* 설치가 막혔다 — 이유와 IT 담당자에게 보낼 문장, 다시 시도. */}
            <Fold open={agentState === "blocked" && failureParts !== null}>
              {failureParts && (
                <>
                  <p className="nx-ob-d nx-ob-d--red">{failureParts.body}</p>
                  {failureParts.itLine && (
                    <div className="nx-codebox nx-codebox--ask">{failureParts.itLine}</div>
                  )}
                  <div className="nx-ob-acts">
                    {failureParts.itLine && (
                      <CopyButton
                        primary
                        text={failureParts.itLine}
                        label={L.onboarding.copyText}
                        doneLabel={L.onboarding.copied}
                      />
                    )}
                    <button
                      type="button"
                      className="nx-btn"
                      disabled={agentBusy}
                      onClick={() =>
                        void daemon.api.onboardingFix("install-claude").catch(() => undefined)
                      }
                    >
                      {L.onboarding.retry}
                    </button>
                  </div>
                </>
              )}
            </Fold>

            {/* 로그인 — 브라우저가 열렸고, 돌아오기를 기다린다. */}
            <Fold open={agentState === "login" && daemon.login !== null}>
              {daemon.login && (
                <>
                  <p className="nx-ob-d">{L.onboarding.loginBody}</p>
                  <div className="nx-ob-acts">
                    <button
                      type="button"
                      className="nx-btn nx-btn--pri"
                      onClick={() => window.open(daemon.login?.url, "_blank", "noopener")}
                    >
                      {L.onboarding.loginReopen}
                    </button>
                  </div>
                  <details className="nx-ob-help">
                    <summary>
                      <Caret />
                      {L.onboarding.loginFallback}
                    </summary>
                    <div className="nx-ob-help-b">
                      <p className="nx-ob-d">{L.onboarding.loginFallbackBody}</p>
                      <div className="nx-codebox">{daemon.login.url}</div>
                      {daemon.login.wantsCode && <LoginCodeForm daemon={daemon} />}
                    </div>
                  </details>
                </>
              )}
            </Fold>

            {/* 로그인이 실패로 끝났다 — 다시 여는 길. 진행판이 살아 있는 동안은 숨는다. */}
            <Fold open={agentState === "idle" && Boolean(loginFailed)}>
              <LoginFailLine detail={loginFailed ?? ""} />
              {agentFix && (
                <div className="nx-ob-acts">
                  <button
                    type="button"
                    className="nx-btn nx-btn--pri"
                    disabled={agentBusy}
                    onClick={() => claudeStep && runFix(claudeStep)}
                  >
                    {agentFix.label}
                  </button>
                </div>
              )}
            </Fold>
          </Step>

          {/* 초대 파일 */}
          <Step
            glyph={<MailIcon />}
            state={invitePass ? "ok" : inviteImporting ? "run" : "act"}
            current={current === "invite"}
            fresh={freshPasses.includes("invite")}
            title={L.onboarding.invite}
            status={
              invitePass
                ? L.vocab.projectCount(projects.length)
                : inviteImporting
                  ? L.onboarding.inviteOpening
                  : L.onboarding.inviteFrom
            }
          >
            {invitePass ? (
              <>
                <div className="nx-ob-done">
                  {L.onboarding.inviteDone(projects.map((project) => project.name).join(" · "))}
                  <br />
                  {L.onboarding.inviteFirst(projects[0]?.name ?? "")}
                </div>
                <div className="nx-ob-warn">
                  <AlertIcon />
                  <span>{L.onboarding.inviteWarn}</span>
                </div>
              </>
            ) : (
              <>
                {/* 도구가 준비됐는데 AI 가 아직이면 — 파일을 먼저 놓아도 되고, 그러면 서비스 준비가 AI 설치와 겹쳐 돈다. */}
                {toolsPass && !agentPass && !inviteImporting && (
                  <p className="nx-ob-early">{L.onboarding.inviteEarly}</p>
                )}
                <InviteDrop invite={invite} importing={inviteImporting} />
              </>
            )}
          </Step>
        </ol>

        {/* 막혔나요 — 도움말 메뉴를 찾지 않아도(Windows 는 Alt 뒤에 숨는다) 담당자에게 보낼 진단을 복사한다. */}
        {!done && (
          <div className="nx-ob-foot">
            <span>{L.onboarding.stuckAsk}</span>
            <CopyButton
              small
              text={() => buildReport()}
              label={L.onboarding.stuckCopy}
              doneLabel={L.help.reportCopied}
              failLabel={L.help.reportFailed}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** 첫 검사의 답을 기다리는 시간 — 넘으면 `다시 확인` 이 선다. 검사는 AI 의 로그인 확인까지 돈다. */
const CHECK_SLOW_MS = 20_000;

/**
 * 고침 단추의 답에서 화면에 둘 한 줄 — git 설치는 `guidance`, pnpm 설치는 `detail` 로 답한다(데몬의
 * startGitInstall · runPnpmInstall). 모양이 다르면 아무것도 두지 않는다.
 */
function fixReplyLine(reply: unknown): string | null {
  if (typeof reply !== "object" || reply === null) return null;
  const { guidance, detail } = reply as { guidance?: unknown; detail?: unknown };
  if (typeof guidance === "string" && guidance !== "") return guidance;
  if (typeof detail === "string" && detail !== "") return detail;
  return null;
}

/** 카드 한 칸의 상태 — 통과 · 도는 중 · 손이 필요 · 기다림 · 막힘. */
type CardState = "ok" | "run" | "act" | "wait" | "fail";

/**
 * 체크리스트 카드 한 칸 — 머리(타일 · 이름 · 상태 알약)와 몸통. 타일은 통과하면 체크, 도는 동안은
 * 돌림, 그 밖에는 항목의 그림이다. 사용자가 브라우저에서 할 일을 기다리는 칸(`pulse`)은 도는 대신
 * `loginGlyph` 가 숨 쉰다. 모양은 `data-state` · `data-current` 로 CSS 가 입힌다.
 */
function Step({
  glyph,
  loginGlyph,
  state,
  current,
  fresh,
  pulse = false,
  title,
  status,
  children,
}: {
  glyph: ReactNode;
  loginGlyph?: ReactNode;
  state: CardState;
  current: boolean;
  fresh: boolean;
  pulse?: boolean;
  title: string;
  status: string;
  children: ReactNode;
}) {
  return (
    <li
      className={`nx-ob-step${fresh ? " nx-ob-step--passed" : ""}`}
      data-state={state}
      data-current={current ? "" : undefined}
      aria-current={current ? "step" : undefined}
    >
      <div className="nx-ob-hd">
        <span className={`nx-ob-tile${pulse ? " nx-ob-tile--pulse" : ""}`} aria-hidden="true">
          {state === "ok" ? (
            <TileCheckIcon />
          ) : pulse ? (
            (loginGlyph ?? glyph)
          ) : state === "run" ? (
            <Spin />
          ) : (
            glyph
          )}
        </span>
        <span className="nx-ob-name">{title}</span>
        <span
          className={`nx-pill nx-ob-r${pillToneOf(state, current)}`}
          aria-live="polite"
          title={status}
        >
          {/* 알약은 flex 라 글에 곧장 말줄임이 먹지 않는다 — 글을 감싼 칸이 줄고 전체는 title 로(2026-10-24 RF 검토). */}
          <span className="nx-ob-r-t">{status}</span>
        </span>
      </div>
      {children}
    </li>
  );
}

/** 상태 알약의 색 — 통과는 초록, 막힘은 빨강, 서 있는 카드는 포인트, 나머지는 물 알약.
 *  색은 늘 상태 말과 함께 선다(정본 §11). */
function pillToneOf(state: CardState, current: boolean): string {
  if (state === "ok") return " nx-pill--green";
  if (state === "fail") return " nx-pill--red";
  if (current) return " nx-pill--accent";
  return "";
}

/**
 * policy 실패의 detail 은 안내 문장과 IT 담당자용 복사 한 줄이 개행으로 이어진
 * 형태다(onboarding-gates 의 규칙 그대로) — 마지막 줄을 떼어 상자에 넣는다.
 * policy 가 아니면(네트워크 · 디스크 · 그 밖) 상자는 없다.
 */
function splitInstallDetail(detail: string): { body: string; itLine: string | null } {
  const lines = detail
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length < 2) return { body: detail, itLine: null };
  const itLine = lines[lines.length - 1] ?? null;
  return { body: lines.slice(0, -1).join("\n"), itLine };
}

/** 로그인 실패 문장을 `한국어 머리 — 날 원문` 으로 가른다(F4, 2026-10-10 UX 조사) —
 *  데몬이 낡은 문장부터 쓰는 구분자 ` — ` 하나로 잡는다. */
function splitLoginDetail(detail: string): { head: string; tail: string | null } {
  const at = detail.indexOf(" — ");
  if (at === -1) return { head: detail, tail: null };
  return { head: detail.slice(0, at), tail: detail.slice(at + 3) };
}

/** 로그인 실패 줄(F4) — 한국어 머리만 붉게 세우고 날 원문(주로 영어)은 자세히 접힘으로
 *  내려 사용자가 영어를 읽고 멈추지 않게 한다. 원문은 담당자 전달을 위해 남긴다. */
function LoginFailLine({ detail }: { detail: string }) {
  const { head, tail } = splitLoginDetail(detail);
  return (
    <>
      <p className="nx-ob-d nx-ob-d--red">{head}</p>
      {tail !== null && (
        <details className="nx-ob-help">
          <summary>
            <Caret />
            {L.onboarding.loginRawDetail}
          </summary>
          <div className="nx-ob-help-b">
            <p className="nx-ob-d">{tail}</p>
          </div>
        </details>
      )}
    </>
  );
}

/** 로그인 코드 붙여넣기 — 데몬이 자식의 stdin 으로 흘려 보낸다. */
function LoginCodeForm({ daemon }: { daemon: Daemon }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await daemon.api.agentLoginCode(code.trim());
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="nx-row">
        <input
          className="nx-input"
          type="password"
          value={code}
          spellCheck={false}
          autoComplete="off"
          placeholder={L.onboarding.loginCode}
          aria-label={L.onboarding.loginCode}
          disabled={busy}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && code.trim() && !busy) void send();
          }}
        />
        <button
          type="button"
          className="nx-btn"
          disabled={!code.trim() || busy}
          onClick={() => void send()}
        >
          {L.onboarding.confirm}
        </button>
      </div>
      {error && (
        <p className="nx-ob-d nx-ob-d--red" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
