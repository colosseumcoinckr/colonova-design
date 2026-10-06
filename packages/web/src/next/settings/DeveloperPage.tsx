import { type UIEvent, useEffect, useRef, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { DEV, L } from "../labels";
import { SGroup, SPage, SRow } from "./parts";

/** 개발자용 쪽 — 보통은 열 일이 없다. 진단 세 줄은 담당자에게 보낼 수 있게 복사한다. */
export function DeveloperPage({
  active,
  daemon,
  onScroll,
}: {
  active: boolean;
  daemon: Daemon;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
}) {
  const bridge = window.colonovaDesignDesktop;
  const openHome = bridge && "openHome" in bridge ? bridge.openHome : undefined;
  const openDeveloperFolder = typeof openHome === "function" ? openHome : null;
  const project = daemon.projects.find((entry) => entry.slug === daemon.activeSlug) ?? null;
  const lines = [
    DEV.daemonLine(daemon.status?.protocolVersion ?? 0, daemon.connection === "open"),
    DEV.activeProject(project?.repoUrl ?? null, daemon.repo?.phase === "ready"),
    DEV.selfUpdateNote,
  ];

  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const copy = () => {
    void navigator.clipboard
      ?.writeText(lines.join("\n"))
      .then(() => {
        setCopied(true);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => undefined);
  };

  return (
    <SPage id="developer" active={active} onScroll={onScroll}>
      <SGroup>
        <SRow title={L.settings.toolFolder}>
          {openDeveloperFolder ? (
            <button
              type="button"
              className="nx-btn nx-btn--sm"
              onClick={() => void openDeveloperFolder()}
            >
              {L.settings.openFolder}
            </button>
          ) : (
            <span className="nx-snote">~/.colonova-design</span>
          )}
        </SRow>
        <SRow title={L.settings.dailyLog}>
          {openDeveloperFolder && (
            <button
              type="button"
              className="nx-btn nx-btn--sm"
              onClick={() => void openDeveloperFolder("logs")}
            >
              {L.settings.openLogFolder}
            </button>
          )}
        </SRow>
      </SGroup>
      <p className="nx-stbl">
        {lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 진단 줄은 고정된 세 줄이다.
          <span key={index} className="nx-stbl-l">
            {line}
          </span>
        ))}
      </p>
      <div className="nx-sfoot-act">
        <button type="button" className="nx-btn nx-btn--sm" onClick={copy}>
          {copied ? L.problem.copiedHelp : L.problem.copyHelp}
        </button>
      </div>
    </SPage>
  );
}
