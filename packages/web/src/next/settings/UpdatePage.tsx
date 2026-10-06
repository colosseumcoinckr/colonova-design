import { RELEASES_REPO } from "@colonova-design/protocol";
import { type ReactElement, type UIEvent, useEffect, useRef } from "react";
import { useInstallStep } from "../../hooks/use-install-step";
import type { Daemon } from "../../lib/daemon-client";
import { ProviderMark } from "../chat/icons";
import { L } from "../labels";
import { hhmm } from "../lib/update-row";
import { CheckIcon, Spin } from "../ui/icons";
import { BandAlertIcon, BandDownIcon, BandInfoIcon, BandOkIcon } from "./icons";
import { type BandTone, SBand, SGroup, SPage, SRow, Switch, useAnnounce } from "./parts";
import type { AgentUpdateRow, UpdatesModel } from "./use-updates";

/** 요약 띠의 얼굴 — 줄들의 상태에서 파생한 말과 색(2026-10-06 설정 손질 · S7). */
function summaryBand(updates: UpdatesModel): {
  tone: BandTone;
  icon: ReactElement;
  title: string;
  sub: string | null;
  bar: boolean;
} {
  const { summary } = updates;
  const time =
    updates.lastCheckedAt === null ? "" : hhmm(new Date(updates.lastCheckedAt).toISOString());
  const last = time ? L.update.lastChecked(time) : null;
  switch (summary.kind) {
    case "checking":
      return {
        tone: "plain",
        icon: <Spin />,
        title: L.update.summaryChecking,
        sub: last,
        bar: true,
      };
    case "updating":
      return {
        tone: "blue",
        icon: <Spin />,
        title: L.update.summaryUpdating,
        sub: last,
        bar: true,
      };
    case "available":
      return {
        tone: "blue",
        icon: <BandDownIcon />,
        title:
          summary.failed > 0
            ? L.update.foundButFailed(summary.count)
            : L.update.foundCount(summary.count),
        sub: last,
        bar: false,
      };
    case "failed":
      return {
        tone: "amber",
        icon: <BandAlertIcon />,
        title: L.update.checkFailed,
        sub: L.update.summaryFailedHint,
        bar: false,
      };
    case "unknown":
      return {
        tone: "plain",
        icon: <BandInfoIcon />,
        title: L.update.summaryUnknown,
        sub: last,
        bar: false,
      };
    case "latest":
      return {
        tone: "green",
        icon: <BandOkIcon />,
        title: L.update.allLatest,
        sub: last,
        bar: false,
      };
    default:
      return {
        tone: "plain",
        icon: <BandInfoIcon />,
        title: L.update.updateNone,
        sub: L.update.updateNoneSub,
        bar: false,
      };
  }
}

/** 앱 줄 — 새 버전 → 내려받는 중 → 준비됨 → 다시 시작. 단추는 걸음이 정하고, 말은 거짓이 없다. */
function AppRow({ updates }: { updates: UpdatesModel }) {
  const { app, appError } = updates;
  const tint = app.state !== "latest" && app.state !== "checking" && app.state !== "failed";
  const busy = app.state === "downloading" || app.state === "restarting";
  return (
    <div className={`nx-urow${tint ? " nx-urow--new" : ""}`}>
      <span className="nx-pmk nx-pmk--sm">
        <img src="/colonova-icon.svg" alt="" width={18} height={18} />
      </span>
      <span className="nx-urow-body">
        <b className="nx-un">{L.update.app}</b>
        <span className="nx-uv">
          {(app.state === "checking" || busy) && <Spin />}
          {app.state === "failed" ? (
            <span className="nx-snote nx-snote--red">{app.line}</span>
          ) : app.state === "ready" || app.state === "restartDeferred" ? (
            <span className="nx-ok">
              <CheckIcon />
              {app.line}
            </span>
          ) : (
            app.line
          )}
          {app.state === "latest" && (
            <span className="nx-ok">
              <CheckIcon />
              {L.update.latest}
            </span>
          )}
        </span>
        {app.note && <span className="nx-urow-note">{app.note}</span>}
      </span>
      <span className="nx-urow-act">
        {app.action === "update" && (
          <button
            type="button"
            className="nx-btn nx-btn--sm nx-btn--pri"
            onClick={updates.startApp}
          >
            {L.update.run}
          </button>
        )}
        {app.action === "retry" && (
          <button type="button" className="nx-btn nx-btn--sm" onClick={updates.startApp}>
            {L.update.retry}
          </button>
        )}
        {app.action === "restart" && (
          <>
            <button
              type="button"
              className={`nx-btn nx-btn--sm${app.later ? " nx-btn--pri" : ""}`}
              onClick={updates.restartApp}
            >
              {L.update.appRestartNow}
            </button>
            {app.later && (
              <button
                type="button"
                className="nx-btn nx-btn--sm nx-btn--ghost"
                onClick={updates.snoozeApp}
              >
                {L.update.appLater}
              </button>
            )}
          </>
        )}
        {app.action === "link" && (
          <a
            className="nx-snote"
            href={`https://github.com/${RELEASES_REPO}/releases/latest`}
            target="_blank"
            rel="noreferrer"
          >
            {L.update.releasesLink}
          </a>
        )}
      </span>
      {app.bar && (
        <div className="nx-urow-foot">
          <div className="nx-upd-bar" aria-hidden="true" />
        </div>
      )}
      {appError && (
        <div className="nx-urow-foot">
          <p className="nx-snote nx-snote--red" role="alert">
            {L.update.updateFailed}
          </p>
          <p className="nx-snote">{appError}</p>
        </div>
      )}
    </div>
  );
}

/** AI 줄 — Claude Code · Codex. 깔려 있지 않으면 `—` 대신 어디서 설치하는지 말한다. */
function AgentRow({
  row,
  updates,
  daemon,
  stepWord,
  onGoAi,
}: {
  row: AgentUpdateRow;
  updates: UpdatesModel;
  daemon: Daemon;
  stepWord: string;
  onGoAi: () => void;
}) {
  const { copy } = row;
  return (
    <div className={`nx-urow${copy.state === "available" ? " nx-urow--new" : ""}`}>
      <span className="nx-pmk nx-pmk--sm">
        <ProviderMark provider={row.id} />
      </span>
      <span className="nx-urow-body">
        <b className="nx-un">{row.label}</b>
        <span className="nx-uv">
          {row.installed ? copy.version || "—" : L.update.notInstalledRow}
          {copy.state === "latest" && (
            <span className="nx-ok">
              <CheckIcon />
              {L.update.latest}
            </span>
          )}
          {copy.state === "latest" && copy.note && <span>· {copy.note}</span>}
          {copy.state === "failed" && copy.note && (
            <span className="nx-snote nx-snote--red">{copy.note}</span>
          )}
        </span>
      </span>
      <span className="nx-urow-act">
        {!row.installed && (
          <button type="button" className="nx-btn nx-btn--sm" onClick={onGoAi}>
            {L.update.goAi}
          </button>
        )}
        {copy.state === "pending" && <span className="nx-snote">{copy.note}</span>}
        {copy.action === "update" && (
          <button
            type="button"
            className="nx-btn nx-btn--sm nx-btn--pri"
            onClick={() => updates.runAgent(row.id)}
          >
            {L.update.run}
          </button>
        )}
        {copy.action === "retry" && (
          <button
            type="button"
            className="nx-btn nx-btn--sm"
            onClick={() => updates.runAgent(row.id)}
          >
            {L.update.retry}
          </button>
        )}
      </span>
      {copy.state === "running" && (
        <div className="nx-urow-foot">
          <div className="nx-upd-bar" aria-hidden="true" />
          {daemon.install?.kind === `update-${row.id}` && (
            <span key={stepWord} className="nx-inst-word">
              {stepWord}
            </span>
          )}
        </div>
      )}
      {row.error && (
        <div className="nx-urow-foot">
          <p className="nx-snote nx-snote--red" role="alert">
            {L.update.updateFailed}
          </p>
          <p className="nx-snote">{row.error}</p>
        </div>
      )}
    </div>
  );
}

/** 업데이트 쪽 — 맨 위 요약 띠, 앱 · AI 줄, 자동 설치 스위치. */
export function UpdatePage({
  active,
  daemon,
  updates,
  onGoAi,
  onScroll,
}: {
  active: boolean;
  daemon: Daemon;
  updates: UpdatesModel;
  onGoAi: () => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
}) {
  const announce = useAnnounce();
  const band = summaryBand(updates);
  const stepNow = useInstallStep(daemon.install?.line ?? null);
  const stepWord = stepNow === null ? L.settings.installBusy : L.onboarding.installSteps[stepNow];
  const claude = updates.agents.find((row) => row.id === "claude");
  const codex = updates.agents.find((row) => row.id === "codex");

  // 상태가 바뀌면 한 번 말한다 — 처음 그릴 때는 조용하다.
  const spoken = useRef<string | null>(null);
  const line = [band.title, updates.app.state === "ready" ? updates.app.line : ""].join(" ");
  useEffect(() => {
    if (spoken.current !== null && spoken.current !== line) announce(line.trim());
    spoken.current = line;
  }, [line, announce]);

  const checkBusy = updates.summary.kind === "checking";
  return (
    <SPage id="update" active={active} onScroll={onScroll}>
      <SBand tone={band.tone} icon={band.icon} title={band.title} sub={band.sub} bar={band.bar}>
        {updates.summary.kind !== "none" && (
          <button
            type="button"
            className="nx-btn nx-btn--sm"
            disabled={checkBusy}
            onClick={updates.checkNow}
          >
            {updates.checking ? (
              <>
                <Spin /> {L.update.checking}
              </>
            ) : (
              L.update.checkNow
            )}
          </button>
        )}
      </SBand>
      <SGroup>
        {updates.hasApp && <AppRow updates={updates} />}
        {claude && (
          <AgentRow
            row={claude}
            updates={updates}
            daemon={daemon}
            stepWord={stepWord}
            onGoAi={onGoAi}
          />
        )}
        {codex?.installed && (
          <AgentRow
            row={codex}
            updates={updates}
            daemon={daemon}
            stepWord={stepWord}
            onGoAi={onGoAi}
          />
        )}
      </SGroup>
      <p className="nx-snote nx-sfoot">{L.update.useNextTime}</p>
      <SGroup>
        <SRow title={L.update.autoLabel} sub={L.update.autoNote} id="nx-autoupd">
          <Switch on={updates.auto.on} labelledBy="nx-autoupd" onChange={updates.auto.set} />
        </SRow>
        {updates.auto.error && (
          <p className="nx-snote nx-snote--row nx-snote--red" role="alert">
            {updates.auto.error}
          </p>
        )}
      </SGroup>
    </SPage>
  );
}
