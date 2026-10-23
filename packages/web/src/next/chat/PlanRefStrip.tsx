import type { DraftPlanRef, DraftRefEntry } from "@colonova-design/protocol";
import { useEffect, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import { openPlanTarget } from "../plans/open-plan";
import type { ShellNav } from "../slots";
import { refChipParts, refOpenTarget, stripRows } from "./plan-ref-strip";
import "./plan-ref-strip.css";

/** 접힌 줄에 보이는 칩 수 — 나머지는 `+n` 이 펼친다. */
const CHIPS_SHOWN = 2;

/** 칩의 열쇠 — 같은 근거(문서 · 초안 · 판 · 개정 · 절)는 한 칸이다. */
const chipKey = (ref: DraftPlanRef): string =>
  JSON.stringify([ref.pageId, ref.docKey, ref.version, ref.revision, ref.sections]);

/**
 * 대화의 기획 근거 줄(2026-10-23 · 최종 구현 계획 F3 · 작업 F3b) — 화면 대화의 입력창 바로
 * 위(RunPlan 과 같은 층)에 이번 대화가 삼은 근거가 한 줄로 선다. 근거가 없으면 아무것도 서지
 * 않는다. 칩을 누르면 기획서 칸이 그 문서 · 초안으로 돌아간다 — 칸이 받든(preventDefault) 칸이 없어
 * 요청을 맡기든(아직 마운트 전 · 2026-10-23 · R3 발견 4) 오른쪽 칸을 기획서로 바꾼다(`openPlanTarget`).
 */
export function PlanRefStrip({
  daemon,
  sessionId,
  sentCount,
  nav,
}: {
  daemon: Daemon;
  /** 지금 보는 대화 — 근거는 대화마다다. */
  sessionId: string | null;
  /** 이 대화의 사람 말 수 — 늘면(보낸 직후) 근거를 다시 읽는다. */
  sentCount: number;
  nav: ShellNav;
}) {
  const api = daemon.api;
  const [entries, setEntries] = useState<DraftRefEntry[]>([]);
  const [open, setOpen] = useState(false);

  // 다시 읽는 때 — 대화가 바뀔 때와 이 대화의 사람 말이 늘 때(보낼 때 기록된다). 프로젝트가
  // 바뀌면 대화도 바뀌니 지난 대화의 근거는 여기서 걷힌다. 늦게 온 답은 지금 대화의 것이
  // 아니면 버린다(이음이 풀리며 취소 표식이 선다). 못 읽으면 아무것도 서지 않는다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 사람 말 수는 다시 읽는 방아쇠일 뿐 — 몸에서 쓰지 않는다.
  useEffect(() => {
    if (sessionId === null) {
      setEntries([]);
      return undefined;
    }
    let cancelled = false;
    api
      .draftRefs(sessionId)
      .then(({ refs }) => {
        if (!cancelled) setEntries(refs);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api, sessionId, sentCount]);

  // 대화가 바뀌면 펼침도 접는다 — 새 대화의 근거는 두 칩부터.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 대화 id 는 접는 방아쇠일 뿐 — 몸에서 쓰지 않는다.
  useEffect(() => {
    setOpen(false);
  }, [sessionId]);

  if (entries.length === 0) return null;
  const { shown } = stripRows(entries, open ? entries.length : CHIPS_SHOWN);
  const foldable = entries.length - CHIPS_SHOWN;

  // 듣는 칸이 없으면(아직 마운트 전 — 2026-10-23 · R3 발견 4) 열기 요청을 맡겨 두고, 받았든 맡겼든 칸을 앞에 세운다.
  // 받은 칸이 숨은 채로 남던 틈은 2026-10-23 기획자 화면 손질에서 닫았다(`openPlanTarget`).
  const openRef = (ref: DraftPlanRef) => openPlanTarget(refOpenTarget(ref), nav);

  return (
    <div className="nx-pref">
      <span className="nx-pref-label">{L.planRefs.stripLabel}</span>
      <div className="nx-pref-chips">
        {shown.map((entry) => (
          <button
            type="button"
            key={chipKey(entry.ref)}
            className="nx-pref-chip"
            aria-label={L.planRefs.openAria(entry.ref.title)}
            onClick={() => openRef(entry.ref)}
          >
            <span className="nx-pref-title">{refChipParts(entry.ref).title}</span>
            {refChipParts(entry.ref).meta !== null && (
              <span className="nx-pref-meta">{refChipParts(entry.ref).meta}</span>
            )}
          </button>
        ))}
        {foldable > 0 && (
          <button
            type="button"
            className="nx-pref-more"
            aria-expanded={open}
            onClick={() => setOpen((before) => !before)}
          >
            {L.planRefs.more(foldable)}
          </button>
        )}
      </div>
    </div>
  );
}
