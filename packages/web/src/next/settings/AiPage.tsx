import { isUnusablePlan, type OnboardingFixKind } from "@colonova-design/protocol";
import { type UIEvent, useEffect, useState } from "react";
import { useInstallStep } from "../../hooks/use-install-step";
import type { Daemon } from "../../lib/daemon-client";
import { composing } from "../../lib/ime";
import { type ChatSettings, type Settings, switchProviderPatch } from "../../lib/settings";
import { ProviderMark } from "../chat/icons";
import { L } from "../labels";
import { accountLine, accountText } from "../lib/account-line";
import { type FixKind, type FixView, fixState } from "../lib/agent-fix";
import { useFreshKeys } from "../lib/use-fresh-keys";
import { Spin } from "../ui/icons";
import { BandAlertIcon } from "./icons";
import {
  radioArrowStep,
  rovingTab,
  SBand,
  SGroup,
  SPage,
  SRow,
  Switch,
  useAnnounce,
} from "./parts";

type Provider = NonNullable<NonNullable<Daemon["status"]>["providers"]>[number];

/** 요청을 보낸 뒤 방송이 닿기 전의 틈 — 그동안 단추가 다시 서면 두 번 눌린다. */
interface Starting {
  id: string;
  kind: FixKind;
  /** 시작할 때의 끝 방송 — 이것과 달라지면 새 끝이 닿은 것이다. */
  installDone: Daemon["installDone"];
  loginDone: Daemon["loginDone"];
}

/**
 * AI 쪽 — 쓸 수 있는 AI 는 카드로 고르고, 아직 못 쓰는 AI 는 같은 격자의 점선 카드가 다음 걸음
 * (설치 · 로그인)을 든다. 진행과 실패는 카드 안에서 말한다(2026-10-06 설정 손질 · S2).
 */
export function AiPage({
  active,
  daemon,
  settings,
  onChatChange,
  onSettingsChange,
  loginExpired,
  onScroll,
}: {
  active: boolean;
  daemon: Daemon;
  settings: Settings;
  onChatChange: (patch: Partial<ChatSettings>) => void;
  /** AI 가 고치는 화면으로 따라가기(2026-10-08) — 미리보기의 동작이라 채팅 설정이 아니라 앱 설정에 저장된다. */
  onSettingsChange: (patch: Partial<Settings>) => void;
  /** AI 로그인이 끝났다는 주의가 서 있다(연결 코드의 만료와 다른 일이다). */
  loginExpired: boolean;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
}) {
  const providers = daemon.status?.providers ?? [];
  // 로그인은 됐는데 이 요금제로는 쓸 수 없다고 알려진 Claude 계정(2026-10-07 베타 준비 분석) — 쓸 수 있는 카드가 아니라
  // 다른 계정으로 로그인하는 점선 카드로 선다. 모르는 값(null)으로는 막지 않는다.
  const planBlocked = isUnusablePlan(daemon.status?.subscriptionType);
  const blockedByPlan = (provider: Provider) => provider.id === "claude" && planBlocked;
  // 쓸 수 있는 AI — 설치되어 있고 로그인돼 있는 것만 카드로 선다(README B1).
  const usable = providers.filter(
    (provider) => provider.available && provider.loggedIn !== false && !blockedByPlan(provider),
  );
  // 설치는 됐지만 로그인이 없는 AI — 미설치와 갈라 읽는다(2026-09-28).
  const needsLogin = providers.filter(
    (provider) => provider.available && (provider.loggedIn === false || blockedByPlan(provider)),
  );
  // 로그인 뒤의 한 줄 — Claude 의 계정만 상태에 있다(이메일 · 요금제로 연결됨).
  const status = daemon.status;
  const claudeAccount = status
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
  const missing = providers.filter((provider) => !provider.available);
  const usableAt = usable.findIndex((provider) => provider.id === settings.chat.provider);
  const pick = (provider: Provider | undefined) => {
    if (!provider || settings.chat.provider === provider.id) return;
    onChatChange(switchProviderPatch(settings.chat, provider.id));
  };
  // 옮겨 앉는 카드는 내려앉으며 들어온다 — 설치가 끝나면 점선 카드가 쓸 수 있는 격자로 올라온다.
  const fresh = useFreshKeys(
    usable.map((provider) => provider.id),
    "ai",
  );

  const [starting, setStarting] = useState<Starting | null>(null);
  const [startError, setStartError] = useState<{
    id: string;
    kind: FixKind;
    detail: string;
  } | null>(null);
  const [loginFor, setLoginFor] = useState<string | null>(null);

  // 방송이 닿으면 틈이 닫힌다 — 도는 방송이든 끝의 방송이든. 방송이 끝내 안 와도 한참 뒤에는 단추가 다시 선다.
  useEffect(() => {
    if (!starting) return;
    const reached =
      starting.kind === "install"
        ? daemon.install?.kind === `install-${starting.id}` ||
          daemon.installDone !== starting.installDone
        : daemon.login !== null || daemon.loginDone !== starting.loginDone;
    if (reached) {
      setStarting(null);
      return;
    }
    const timer = window.setTimeout(() => setStarting(null), 20_000);
    return () => window.clearTimeout(timer);
  }, [starting, daemon.install, daemon.installDone, daemon.login, daemon.loginDone]);

  // 로그인이 끝나면 목록이 스스로 바뀌게 — 상태를 다시 읽는다(설치의 끝은 클라이언트가 읽는다).
  useEffect(() => {
    if (daemon.loginDone?.ok) void daemon.api.refreshStatus();
  }, [daemon.loginDone, daemon.api]);

  const start = async (id: string, kind: FixKind) => {
    setStartError(null);
    if (kind === "login") setLoginFor(id);
    setStarting({ id, kind, installDone: daemon.installDone, loginDone: daemon.loginDone });
    try {
      const reply = (await daemon.api.onboardingFix(`${kind}-${id}` as OnboardingFixKind)) as
        | { started?: boolean; guidance?: unknown }
        | undefined;
      // 로그인을 앱이 대신 못 여는 AI — 데몬의 원문이 이유다. 설치의 `started: false` 는 이미 도는 중이라 방송이 말한다.
      if (kind === "login" && reply?.started === false) {
        setStarting(null);
        setStartError({ id, kind, detail: String(reply.guidance ?? "") });
      }
    } catch (error) {
      setStarting(null);
      setStartError({
        id,
        kind,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const stepNow = useInstallStep(daemon.install?.line ?? null);
  const stepWord = stepNow === null ? L.settings.installBusy : L.onboarding.installSteps[stepNow];
  const viewOf = (provider: Provider, kind: FixKind): FixView =>
    fixState({
      id: provider.id,
      starting: starting?.id === provider.id ? starting.kind : null,
      startError: startError?.id === provider.id ? startError : null,
      install: daemon.install,
      installDone: daemon.installDone,
      // 로그인 방송은 로그인이 필요한 카드에만 선다 — 미설치 카드에 로그인 판이 뜨지 않게.
      login: kind === "login" ? daemon.login : null,
      loginDone: daemon.loginDone,
      loginFor,
    });

  const picked = providers.find((provider) => provider.id === settings.chat.provider);
  const gone =
    usable.length > 0 && !usable.some((provider) => provider.id === settings.chat.provider);

  return (
    <SPage id="ai" active={active} onScroll={onScroll}>
      {loginExpired && (
        <SBand tone="red" role="alert" icon={<BandAlertIcon />} title={L.problem.reconnectLogin}>
          {needsLogin[0] && (
            <button
              type="button"
              className="nx-btn nx-btn--sm"
              disabled={starting !== null}
              onClick={() => void start(needsLogin[0]?.id ?? "claude", "login")}
            >
              {L.settings.login}
            </button>
          )}
        </SBand>
      )}
      {gone && (
        <SBand
          tone="amber"
          icon={<BandAlertIcon />}
          title={L.settings.aiPickedGone(picked?.label ?? settings.chat.provider)}
        />
      )}
      {/* 쓸 수 있는 AI 는 카드 — 고르면 다음 새 대화부터 그 AI 가 쓰인다. */}
      {usable.length > 0 && (
        <div
          className="nx-sgrid"
          role="radiogroup"
          aria-label={L.settings.ai}
          onKeyDown={(event) =>
            radioArrowStep(event, usableAt, usable.length, (index) => pick(usable[index]))
          }
        >
          {usable.map((provider, index) => {
            const on = settings.chat.provider === provider.id;
            const connected =
              (provider.id === "claude" ? claudeAccount : null) ?? L.settings.loggedIn;
            return (
              // biome-ignore lint/a11y/useSemanticElements: 카드 전체가 누르는 과녁이다 — 동그라미 입력칸 없이 radio 로 읽힌다(radiogroup 안).
              <button
                key={provider.id}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={rovingTab(index, usableAt)}
                className={`nx-ptile${on ? " nx-ptile--on" : ""}${fresh.has(provider.id) ? " nx-row--new" : ""}`}
                onClick={() => pick(provider)}
              >
                <span className="nx-pmk">
                  <ProviderMark provider={provider.id} />
                </span>
                <span className="nx-ptxt">
                  <b>{provider.label}</b>
                  <span>
                    <i className="nx-dot nx-dot--green" />
                    <span className="nx-ptxt-t" title={connected}>
                      {connected}
                    </span>
                  </span>
                  {on && <span className="nx-ptxt-now">{L.settings.aiPickedNow}</span>}
                </span>
                <span className="nx-rd" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
      {/* 아직 못 쓰는 AI 도 같은 격자에 흐린 카드로 선다 — 접힘 속에 「쓸 수 없는」으로 숨기면 고장 난
          것처럼 읽히고 이 쪽이 휑하다. 카드 안의 단추가 다음 걸음(설치 · 로그인)이고, 진행과 실패도 카드가 말한다. */}
      {(missing.length > 0 || needsLogin.length > 0) && (
        <div className="nx-sgrid">
          {missing.map((provider) => (
            <FixCard
              key={provider.id}
              provider={provider}
              kind="install"
              view={viewOf(provider, "install")}
              stepWord={stepWord}
              daemon={daemon}
              locked={starting !== null}
              onStart={() => void start(provider.id, "install")}
            />
          ))}
          {needsLogin.map((provider) => (
            <FixCard
              key={provider.id}
              provider={provider}
              kind="login"
              view={viewOf(provider, "login")}
              stepWord={stepWord}
              daemon={daemon}
              locked={starting !== null}
              onStart={() => void start(provider.id, "login")}
              {...(blockedByPlan(provider)
                ? {
                    note: L.account.planBlockedPill,
                    foot: L.account.planBlocked,
                    loginLabel: L.account.switchAccount,
                  }
                : {})}
            />
          ))}
        </div>
      )}
      {providers.length === 0 && <EmptyProviders loading={daemon.status === null} />}
      {/* AI 가 일하는 동안 미리보기가 고치는 화면으로 옮겨 간다 — 기본 켜짐, 끄는 길이 이 한 줄이다(2026-10-08 베타 준비 분석). */}
      <SGroup>
        <SRow title={L.live.followRow} id="nx-ai-follow" sub={L.live.followRowSub}>
          <Switch
            on={settings.followEdits}
            labelledBy="nx-ai-follow"
            onChange={(followEdits) => onSettingsChange({ followEdits })}
          />
        </SRow>
      </SGroup>
    </SPage>
  );
}

/** 점선 카드 한 장 — 설치 전 · 로그인 전. 단추 · 진행 · 실패가 이 안에서 바뀐다. */
function FixCard({
  provider,
  kind,
  view,
  stepWord,
  daemon,
  locked,
  onStart,
  note,
  foot,
  loginLabel,
}: {
  provider: Provider;
  kind: FixKind;
  view: FixView;
  stepWord: string;
  daemon: Daemon;
  locked: boolean;
  onStart: () => void;
  /** 카드의 둘째 줄을 대신하는 짧은 이유 — 요금제가 막은 계정이 이유를 말한다. */
  note?: string;
  /** 카드 아래 한 줄로 서는 긴 설명 — 짧은 이유(`note`) 곁에서 해야 할 일까지 말한다. */
  foot?: string;
  /** 로그인 단추의 글 — 다른 계정으로 로그인하는 길은 `다른 계정으로 로그인`. */
  loginLabel?: string;
}) {
  const announce = useAnnounce();
  const phase = view.phase;
  // 도는 일이 바뀌면 한 번 말한다 — 실패는 눈에 보이는 줄의 `role="alert"` 가 말한다.
  useEffect(() => {
    if (phase === "installing") announce(L.settings.installBusy);
    else if (phase === "login") announce(L.settings.aiLoginWaiting);
  }, [phase, announce]);
  const known = provider.id === "claude" || provider.id === "codex";
  // 긴 설명(`foot`)이 있는 카드는 단추도 그 아래에 선다 — 좁은 카드에서 오른쪽 단추가 글줄을 짓눌러 글자가 세로로 서지 않게.
  const buttonBelow = known && foot !== undefined && phase === "idle";
  const sub =
    note ??
    provider.reason ??
    (kind === "install" ? L.settings.notInstalled : L.settings.loginNeeded);
  const busy = phase === "installing" || phase === "starting-login" || phase === "login";
  return (
    <div
      className={`nx-ptile nx-ptile--off${phase === "login" ? " nx-ptile--wide" : ""}`}
      aria-busy={busy || undefined}
    >
      <span className="nx-pmk">
        <ProviderMark provider={provider.id} />
      </span>
      <span className="nx-ptxt">
        <b>{provider.label}</b>
        {phase === "installing" ? (
          <span key={stepWord} className="nx-inst-word">
            <Spin />
            {daemon.install?.kind === `install-${provider.id}` ? stepWord : L.settings.installBusy}
          </span>
        ) : phase === "starting-login" ? (
          <span>
            <Spin />
            {L.settings.loginBusy}
          </span>
        ) : phase === "login" ? (
          <span>
            <Spin />
            {L.settings.aiLoginWaiting}
          </span>
        ) : phase === "failed" ? (
          <span className="nx-snote nx-snote--red" role="alert">
            {view.kind === "install" ? L.settings.aiInstallFailed : L.settings.aiLoginFailed}
          </span>
        ) : (
          <span>{sub}</span>
        )}
      </span>
      {known && (phase === "idle" || phase === "failed") && !buttonBelow && (
        <button type="button" className="nx-btn nx-btn--sm" disabled={locked} onClick={onStart}>
          {phase === "failed"
            ? L.vocab.retry
            : kind === "install"
              ? L.settings.install
              : (loginLabel ?? L.settings.login)}
        </button>
      )}
      {phase === "installing" && (
        <div className="nx-ptile-foot">
          <div className="nx-upd-bar" aria-hidden="true" />
        </div>
      )}
      {view.phase === "login" && (
        <div className="nx-ptile-foot">
          <div className="nx-slogin">
            <button
              type="button"
              className="nx-btn nx-btn--sm"
              onClick={() => window.open(view.url, "_blank", "noopener")}
            >
              {L.settings.loginReopen}
            </button>
          </div>
          {view.wantsCode && <AgentLoginCode daemon={daemon} />}
        </div>
      )}
      {buttonBelow && (
        <div className="nx-ptile-foot">
          <p className="nx-snote nx-snote--red" role="alert">
            {foot}
          </p>
          <div>
            <button type="button" className="nx-btn nx-btn--sm" disabled={locked} onClick={onStart}>
              {loginLabel ?? L.settings.login}
            </button>
          </div>
        </div>
      )}
      {view.phase === "failed" && view.detail && (
        <div className="nx-ptile-foot">
          <details className="nx-sdet">
            <summary>{L.settings.detail}</summary>
            <p className="nx-sdet-b">{view.detail}</p>
          </details>
        </div>
      )}
    </div>
  );
}

/** AI 목록이 비었을 때 — 불러오는 중이거나 정말 없다. 휑한 쪽 대신 점선 자리 두 칸과 한 줄이 선다. */
function EmptyProviders({ loading }: { loading: boolean }) {
  return (
    <>
      <div className="nx-sgrid" aria-hidden="true">
        {[0, 1].map((slot) => (
          <div
            key={slot}
            className={`nx-ptile nx-ptile--off nx-ptile--ghost${loading ? " nx-ptile--loading" : ""}`}
          >
            <span className="nx-pmk nx-pmk--ghost" />
            <span className="nx-ptxt">
              <i className="nx-sk" />
              <i className="nx-sk nx-sk--s" />
            </span>
          </div>
        ))}
      </div>
      <p className="nx-snote nx-sfoot" role="status">
        {loading ? L.settings.aiLoading : L.settings.aiNone}
      </p>
    </>
  );
}

/** 로그인 코드 붙여넣기 — 데몬이 로그인 자식의 stdin 으로 흘려 보낸다(온보딩의 것과 같은 길). */
function AgentLoginCode({ daemon }: { daemon: Daemon }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const send = async () => {
    if (code.trim() === "") return;
    setBusy(true);
    setFailed(false);
    try {
      await daemon.api.agentLoginCode(code.trim());
      setCode("");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="nx-slogin-code">
      <input
        className="nx-sinput nx-sinput--code"
        type="password"
        value={code}
        spellCheck={false}
        autoComplete="off"
        placeholder={L.settings.loginCode}
        aria-label={L.settings.loginCode}
        disabled={busy}
        onChange={(event) => setCode(event.target.value)}
        onKeyDown={(event) => {
          if (composing(event)) return;
          if (event.key === "Enter" && code.trim() && !busy) void send();
        }}
      />
      <button
        type="button"
        className="nx-btn nx-btn--sm"
        disabled={!code.trim() || busy}
        onClick={() => void send()}
      >
        {busy ? L.settings.codeSending : L.settings.loginCodeSend}
      </button>
      {failed && (
        <span className="nx-snote nx-snote--red" role="alert">
          {L.settings.aiCodeFailed}
        </span>
      )}
    </span>
  );
}
