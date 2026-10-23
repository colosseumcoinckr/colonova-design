import type { DraftPlanRef, DraftRefEntry } from "@colonova-design/protocol";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import { openPlanTarget } from "../plans/open-plan";
import type { ShellNav } from "../slots";
import { FileSmIcon } from "./icons";
import {
  CHIPS_SHOWN,
  chipsShownAt,
  refChipParts,
  refChipText,
  refOpenTarget,
  stripRows,
} from "./plan-ref-strip";
import "./plan-ref-strip.css";

/** 칩의 열쇠 — 같은 근거(문서 · 초안 · 판 · 개정 · 절)는 한 칸이다. */
const chipKey = (ref: DraftPlanRef): string =>
  JSON.stringify([ref.pageId, ref.docKey, ref.version, ref.revision, ref.sections]);

/**
 * 대화의 기획 근거 줄(2026-10-23 · 최종 구현 계획 F3 · 작업 F3b) — 화면 대화의 입력창 바로
 * 위(RunPlan 과 같은 층)에 이번 대화가 삼은 근거가 한 줄로 선다. 근거가 없으면 아무것도 서지
 * 않는다. 칩을 누르면 기획서 칸이 그 문서 · 초안으로 돌아간다 — 칸이 받든(preventDefault) 칸이 없어
 * 요청을 맡기든(아직 마운트 전 · 2026-10-23 · R3 발견 4) 오른쪽 칸을 기획서로 바꾼다(`openPlanTarget`).
 *
 * 접힌 줄의 칩은 줄의 폭에 맞춰 줄어든다(제목 말줄임) — `+N` 은 칩의 칸 밖에 서서 폭이 모자라도 늘 보인다
 * (2026-10-24 QA 12: 420 · 560 칸에서 둘째 칩과 `+N` 이 오른쪽으로 밀려 가려졌다). 펼치면 칩은 제 폭으로 서고 옆으로 굴러간다.
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
  // 줄의 폭 — 둘째 칩이 읽히지 않을 만큼 좁은 칸에서는 첫 칩 하나와 `+N` 만 세운다(칩 수 셈이 실제 폭을 읽는다 — 2026-10-24 QA 12).
  const strip = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const standing = entries.length > 0;

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

  // 줄이 서 있는 동안 폭을 읽는다 — 칸을 끌어 좁히면 그 자리에서 칩 수가 바뀐다. 줄이 없으면(근거 0) 읽을 것이 없다.
  useLayoutEffect(() => {
    const el = strip.current;
    if (!standing || !el) return undefined;
    const read = () => setWidth(el.getBoundingClientRect().width);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [standing]);

  // 대화가 바뀌면 펼침도 접는다 — 새 대화의 근거는 접힌 줄부터.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 대화 id 는 접는 방아쇠일 뿐 — 몸에서 쓰지 않는다.
  useEffect(() => {
    setOpen(false);
  }, [sessionId]);

  if (entries.length === 0) return null;
  const fit = Math.min(CHIPS_SHOWN, chipsShownAt(width));
  const { shown } = stripRows(entries, open ? entries.length : fit);
  // 접힌 줄이 가리는 칩의 수 — 좁은 칸에서는 둘째 칩도 센다. 하나도 가리지 않으면 `+N` 도 없다.
  const foldable = entries.length - fit;

  // 듣는 칸이 없으면(아직 마운트 전 — 2026-10-23 · R3 발견 4) 열기 요청을 맡겨 두고, 받았든 맡겼든 칸을 앞에 세운다.
  // 받은 칸이 숨은 채로 남던 틈은 2026-10-23 기획자 화면 손질에서 닫았다(`openPlanTarget`).
  const openRef = (ref: DraftPlanRef) => openPlanTarget(refOpenTarget(ref), nav);

  return (
    <div className="nx-pref" ref={strip}>
      <span className="nx-pref-label">{L.planRefs.stripLabel}</span>
      <div className={`nx-pref-chips${open ? " nx-pref-chips--open" : ""}`}>
        {shown.map((entry) => {
          const parts = refChipParts(entry.ref);
          return (
            <button
              type="button"
              key={chipKey(entry.ref)}
              className="nx-pref-chip"
              // 줄어든 칩의 전체 글(제목 · 판 · 절)은 손을 올리면 풍선으로 읽힌다.
              title={refChipText(entry.ref)}
              aria-label={L.planRefs.openAria(parts.title)}
              onClick={() => openRef(entry.ref)}
            >
              <FileSmIcon />
              <span className="nx-pref-title">{parts.title}</span>
              {parts.stage !== null &&
                (parts.stage.draft ? (
                  // 아직 발행하지 않은 초안 — 호박색 알약으로 눈에 남긴다(2026-10-23 화면 전면 재설계 §4 E).
                  <span className="nx-pill nx-pill--amber">{parts.stage.text}</span>
                ) : (
                  <span className="nx-pref-meta">{parts.stage.text}</span>
                ))}
              {parts.section !== null && (
                <span className="nx-pref-meta nx-pref-sec">{parts.section}</span>
              )}
            </button>
          );
        })}
      </div>
      {foldable > 0 && (
        // 칩의 칸 밖 — 칩이 줄어들거나 굴러가도 `+N` 은 오른쪽 끝에서 늘 보인다.
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
  );
}
