import { L } from "../labels";
import { SealCheckIcon } from "./icons";
import { GATE_ORDER, type GatePasses, gatesDone, ringGeometry, ringSegments } from "./motion";

/** 링의 크기 — 조각 셋이 위(12시)의 틈에서 시계 방향으로 이어진다(기하는 motion.ts). */
const RADIUS = 42;
const STROKE = 4;
const GEOMETRY = ringGeometry({
  radius: RADIUS,
  stroke: STROKE,
  gap: 12,
  count: GATE_ORDER.length,
});

/**
 * 처음 한 번 · `프로젝트가 없어요` 의 머리 — 진행 링 속에 로고가 앉고, 그 아래에 제목과 한 줄
 * 설명이 선다(2026-10-06 온보딩 손질). 링은 세 항목(도구 · AI · 초대)의 통과를 조각으로 말한다:
 * 지난 조각은 초록으로 차오르고, 지금 손이 갈 조각은 숨 쉬고, 아직인 조각은 비어 있다. 앱을 켰을
 * 때 이미 지난 조각은 처음부터 차 있다 — 마운트의 첫 그림에는 전환이 없다. 끝(`done`)에는 조각이
 * 모두 차고 로고에 체크가 앉는다. 낭독은 `3개 중 1개 준비됐어요` 한 문장이 바뀔 때만 읽는다.
 */
export function Hero({
  passes,
  waiting,
  done = false,
  title,
  sub,
}: {
  passes: GatePasses;
  /** 눌러 볼 것이 없이 기다리는 항목 — 링이 거기를 `지금` 으로 말하지 않는다. */
  waiting?: Partial<GatePasses>;
  done?: boolean;
  title: string;
  sub: string;
}) {
  const segments = ringSegments(passes, waiting);
  return (
    <header className="nx-ob-hero">
      <div className={`nx-ring${done ? " nx-ring--done" : ""}`}>
        <svg className="nx-ring-svg" viewBox="0 0 96 96" aria-hidden="true">
          {segments.map((segment, index) => (
            <g
              key={GATE_ORDER[index]}
              transform={`rotate(${-90 + GEOMETRY.step * index + GEOMETRY.lead} 48 48)`}
            >
              <circle
                className={`nx-ring-track nx-ring-track--${segment}`}
                cx="48"
                cy="48"
                r={RADIUS}
                strokeWidth={STROKE}
                pathLength={100}
                strokeDasharray={`${GEOMETRY.dash} ${100 - GEOMETRY.dash}`}
              />
              <circle
                className={`nx-ring-fill${segment === "ok" ? " nx-ring-fill--on" : ""}`}
                cx="48"
                cy="48"
                r={RADIUS}
                strokeWidth={STROKE}
                pathLength={100}
                style={{ ["--ring-dash" as string]: GEOMETRY.dash }}
              />
            </g>
          ))}
        </svg>
        <span className="nx-ring-logo" aria-hidden="true">
          <img src="/colonova-icon.svg" alt="" width={30} height={30} />
        </span>
        {done && (
          <span className="nx-ring-seal" aria-hidden="true">
            <SealCheckIcon />
          </span>
        )}
        <span className="nx-sr" role="status">
          {L.onboarding.progress(gatesDone(passes), GATE_ORDER.length)}
        </span>
      </div>
      <h1 className="nx-ob-title">{title}</h1>
      <p className="nx-ob-sub">{sub}</p>
    </header>
  );
}
