import { type UIEvent, useEffect, useRef, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { DEV, L } from "../labels";
import { useCopied } from "../lib/use-copied";
import { useDiagnosticsText } from "../lib/use-diagnostics";
import { SGroup, SPage, SRow } from "./parts";

/**
 * 개발자용 쪽 — 보통은 열 일이 없다. 진단 한 덩어리(앱 버전 · OS · 도구 · AI 종류와 요금제 종류 · 최근 7일 턴 통계 요약 ·
 * 최근 오류의 종류)가 `키: 값` 으로 서고 `담당자에게 보낼 내용 복사` 가 그 글을 그대로 복사한다(2026-10-07 베타 준비 분석).
 * 종류 · 숫자 · 버전만 담긴다 — 이메일 · 경로 · 프로젝트 이름은 없다. 막힘 보고는 공개 게시판이 아니라 비공개 채널에 붙인다.
 */
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

  // 쪽이 열릴 때 한 번 모은다 — 상태가 방송될 때마다 다시 묻지 않게 함수는 ref 로 쥔다.
  const buildText = useDiagnosticsText(daemon);
  const build = useRef(buildText);
  build.current = buildText;
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    let live = true;
    setText(null);
    void build.current().then((built) => {
      if (live) setText(built);
    });
    return () => {
      live = false;
    };
  }, [active]);

  const { copied, copy } = useCopied();
  const [gathering, setGathering] = useState(false);
  const copyText = async () => {
    // 이미 보이는 글이면 그대로(누른 손짓 안에서 바로 복사), 아직이면 지금 모아 복사한다.
    if (text !== null) return copy(text);
    setGathering(true);
    try {
      copy(await build.current());
    } finally {
      setGathering(false);
    }
  };
  const lines = text === null ? [] : text.split("\n");

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
      <div className="nx-sfoot-act">
        <button
          type="button"
          className="nx-btn nx-btn--sm"
          disabled={gathering}
          onClick={() => void copyText()}
        >
          {copied ? L.problem.copiedHelp : gathering ? L.report.gathering : L.problem.copyHelp}
        </button>
        <p className="nx-snote">{L.report.privateNote}</p>
      </div>
      <p className="nx-stbl" aria-busy={text === null}>
        {text === null ? (
          <span className="nx-stbl-l">{L.report.gathering}</span>
        ) : (
          lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 진단 줄은 한 번 모아 고정된 글이다.
            <span key={index} className="nx-stbl-l">
              {line}
            </span>
          ))
        )}
        <span className="nx-stbl-l">{DEV.selfUpdateNote}</span>
      </p>
    </SPage>
  );
}
