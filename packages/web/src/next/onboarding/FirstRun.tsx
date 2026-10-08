import type { OnboardingStep } from "@colonova-design/protocol";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useInstallStep } from "../../hooks/use-install-step";
import type { InviteImportController } from "../../hooks/use-invite-import";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import { accountLine, accountText } from "../lib/account-line";
import { INSTALL_STEPS } from "../lib/install-step";
import { CheckIcon, Spin } from "../ui/icons";
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
  const agentState: "pass" | "installing" | "login" | "blocked" | "plan" | "idle" = agentPass
    ? "pass"
    : installing
      ? "installing"
      : loginLive
        ? "login"
        : installFailed
          ? "blocked"
          : planBlocked
            ? "plan"
            : "idle";
  // 로그인 뒤의 한 줄 — Claude 의 계정만 읽는다(Codex 의 계정은 상태에 없다). 모르면 예전 문구로 둔다.
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

  // ── Codex — 건너뛰어도 되는 선택 줄.
  const codexMissing =
    daemon.status?.providers?.find((entry) => entry.id === "codex" && !entry.available) ?? null;
  const codexInstalling = daemon.install?.kind === "install-codex";
  const codexFailed =
    daemon.installDone?.kind === "install-codex" && !daemon.installDone.ok
      ? daemon.installDone
      : null;
  const [codexSkipped, setCodexSkipped] = useState(false);
  const codexState: "none" | "ask" | "installing" | "ok" | "skip" | "failed" = !codexMissing
    ? "none"
    : codexInstalling
      ? "installing"
      : daemon.installDone?.kind === "install-codex" && daemon.installDone.ok
        ? "ok"
        : codexSkipped
          ? "skip"
          : codexFailed
            ? "failed"
            : "ask";

  const agentFix = claudeStep && claudeStep.status !== "pass" ? (claudeStep.fix ?? null) : null;
  const agentBusy = installing || loginLive || checking;

  const agentRight =
    agentState === "pass"
      ? (account ?? L.onboarding.agentOk)
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
  const agentWaiting = agentState === "idle" && !agentFix;
  const current = done ? null : currentGate(passes, { agent: agentWaiting });
  const agentCard: CardState =
    agentState === "pass"
      ? "ok"
      : agentState === "blocked" || agentState === "plan"
        ? "fail"
        : agentState === "installing" || agentState === "login"
          ? "run"
          : agentFix
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
        />

        <ol className="nx-ob-steps">
          {/* 도구 준비 */}
          <Step
            glyph={<WrenchIcon />}
            state={toolsPass ? "ok" : toolsFailed ? "act" : "run"}
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
            <Fold open={toolsOpen.length > 0}>
              {toolsOpen.map((step) => (
                <div key={step.id}>
                  <p className="nx-ob-d">{step.detail}</p>
                  {step.fix && (
                    <div className="nx-ob-acts">
                      {step.fix.href ? (
                        <a
                          className="nx-btn nx-btn--pri"
                          href={step.fix.href}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {step.fix.label}
                        </a>
                      ) : (
                        <button
                          type="button"
                          className="nx-btn nx-btn--pri"
                          onClick={() => runFix(step)}
                        >
                          {step.fix?.label}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
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
              <p className="nx-ob-d nx-ob-d--red">{loginFailed}</p>
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

        {/* Codex — 건너뛰어도 되는 선택 줄 */}
        {codexState !== "none" && (
          <div className="nx-ob-opt">
            {codexState === "ok" ? (
              <>
                <CheckIcon />
                <span className="nx-grow">{L.onboarding.codexOk}</span>
              </>
            ) : codexState === "installing" ? (
              <>
                <Spin />
                <span className="nx-grow">{L.onboarding.codexInstalling}</span>
              </>
            ) : codexState === "skip" ? (
              <span className="nx-grow nx-muted">{L.onboarding.codexSkipped}</span>
            ) : (
              <>
                <span className="nx-grow">
                  {L.onboarding.codexAsk}
                  <small>{codexFailed ? codexFailed.detail : L.onboarding.codexAskSub}</small>
                </span>
                {codexState === "failed" && (
                  <button
                    type="button"
                    className="nx-btn"
                    disabled={installing}
                    onClick={() =>
                      void daemon.api.onboardingFix("install-codex").catch(() => undefined)
                    }
                  >
                    {L.onboarding.retry}
                  </button>
                )}
                {codexState === "ask" && (
                  <>
                    <button
                      type="button"
                      className="nx-btn"
                      onClick={() =>
                        void daemon.api.onboardingFix("install-codex").catch(() => undefined)
                      }
                    >
                      {L.onboarding.codexInstall}
                    </button>
                    <button
                      type="button"
                      className="nx-btn nx-btn--ghost"
                      onClick={() => setCodexSkipped(true)}
                    >
                      {L.onboarding.codexSkip}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
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
        <span className="nx-ob-r" aria-live="polite" title={status}>
          {status}
        </span>
      </div>
      {children}
    </li>
  );
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
