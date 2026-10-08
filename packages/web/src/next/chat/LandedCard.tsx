import type { Block } from "../../lib/daemon-client";
import { L } from "../labels";
import { landedFacts } from "../lib/landed";
import { whenText } from "../status/parts";
import { CheckIcon } from "./icons";

/**
 * 반영된 일의 성취 카드(2026-10-08 베타 준비 분석 · A2b) — 제출한 일이 병합된 순간. 이 제품에서 사용자가 받는 가장 큰
 * 보상(`내 말이 서비스가 됐다`)인데 병합 뒤에는 사이클이 새로 시작돼 작업 기록이 비므로 대화에 카드로 남긴다.
 * `‘제목’ 일이 반영됐어요` + `3일 만에 · 화면 2곳` — 아는 것만 말한다(제목 · 며칠 · 화면 수는 모르면 그 말이 서지 않는다).
 *
 * 조용하되 기억에 남게: 이번 창에서 막 도착한 카드에만 체크가 한 번 그려진다(`fresh`). 색종이 · 소리 · 큰 효과는 없다.
 * 필드 없는 옛 사건은 이 카드가 아니라 지금의 얇은 한 줄(`nx-mile`)로 읽힌다 — 부르는 쪽(`Thread`)이 가른다.
 */
export function LandedCard({
  block,
  fresh,
}: {
  block: Extract<Block, { type: "milestone" }>;
  /** 이번 창에서 막 도착했다 — 체크가 그려진다. 다시 열어 본 카드는 이미 끝난 일이라 조용히 선다. */
  fresh: boolean;
}) {
  const facts = landedFacts(block.days, block.screens, {
    took: L.landed.took,
    screens: L.landed.screens,
  });
  const when = whenText(block.at);
  return (
    <div className={`nx-landed${fresh ? " nx-landed--new" : ""}`}>
      <span className="nx-landed-mark" aria-hidden="true">
        <CheckIcon />
      </span>
      <div className="nx-landed-body">
        <b className="nx-landed-head">
          {block.title ? L.landed.head(block.title) : L.landed.headPlain}
        </b>
        {(facts || when) && (
          <div className="nx-landed-meta">
            {facts && <span className="nx-landed-facts">{facts}</span>}
            {when && <span className="nx-landed-time">{when}</span>}
          </div>
        )}
        <div className="nx-landed-next">{L.landed.next}</div>
      </div>
    </div>
  );
}
