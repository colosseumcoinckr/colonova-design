import type { DraftRefEntry } from "@colonova-design/protocol";
import { useRef, useState } from "react";
import { todoProgress } from "../../lib/todo-plan";
import { L } from "../labels";
import type { DockRow } from "../lib/dock";
import type { RunPlan as PlanShape } from "../lib/run-plan";
import { Elapsed } from "../status/Elapsed";
import { Popover } from "../ui/Popover";
import { ReadState } from "../ui/ReadState";
import { ChevIcon, FileSmIcon, SparkIcon } from "./icons";
import { PlanRefStrip } from "./PlanRefStrip";
import { RunPlanList } from "./RunPlan";

/**
 * 작업 독(2026-10-31 화면 자리 개선안 S4) — 입력창 바로 위의 한 줄. 한 번에 하나의
 * 몸 줄만 선다(`lib/dock.ts` 의 판정): ① AI 가 도는 중(단계 말 · 할 일 · 시계 · 멈추기)
 * ② 묻는 일 ③ 알림. 근거는 줄을 차지하지 않고 오른쪽 끝의 `기획서 N` 칩으로 접혀
 * 도는 중에도 남는다 — 누르면 근거 줄이 아래로 펼쳐진다. 옛 대화 끝의 진행 줄(RunLine)과
 * 입력창 위에 겹치던 줄들은 이 독 한 곳으로 모였다.
 */
export function WorkDock({
  row,
  runWord,
  screenName = null,
  startedAt,
  plan,
  onStop,
  stopping,
  onAskGo,
  entries,
  refEntries,
  refPhase = "ready",
  onRefsRetry = () => {},
  daemon,
  sessionId,
  nav,
}: {
  /** `lib/dock.ts` 가 고른 몸 줄 — null 이면 칩만 선다. */
  row: DockRow | null;
  /** 지금의 단계 말 — 묶음을 모르면 `작업 중`. */
  runWord: string;
  /** 지금 고치는 화면의 이름(라이브 신호) — 모르면 말만 선다. */
  screenName?: string | null;
  /** 데몬의 시계 — 없으면 시간을 말하지 않는다. */
  startedAt: number | null;
  /** 이 턴의 할 일 · 보조 작업 — 없으면 요약도 없다. */
  plan: PlanShape | null;
  onStop: () => void;
  stopping: boolean;
  /** ② 묻는 일의 단추 — 답을 기다리는 카드로 굴러간다. */
  onAskGo: () => void;
  /** 이 대화의 근거 — 0 이면 칩이 없다. */
  entries: number;
  refEntries?: DraftRefEntry[];
  refPhase?: "loading" | "ready" | "failed";
  onRefsRetry?: () => void;
  daemon: Parameters<typeof PlanRefStrip>[0]["daemon"];
  sessionId: string | null;
  nav: Parameters<typeof PlanRefStrip>[0]["nav"];
}) {
  const [open, setOpen] = useState(false);
  const [refsOpen, setRefsOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  if (row === null && entries === 0 && refPhase === "ready") return null;
  return (
    <div className="nx-dock" role="status">
      {row?.kind === "run" && (
        <>
          <span className="nx-dock-dot" aria-hidden="true" />
          <button
            ref={anchor}
            type="button"
            className="nx-dock-main"
            disabled={plan === null}
            aria-haspopup={plan === null ? undefined : "dialog"}
            aria-expanded={plan === null ? undefined : open}
            title={L.chat.plan.title}
            onClick={() => setOpen((was) => !was)}
          >
            <SparkIcon />
            <span className="nx-dock-word">{runWord}</span>
            {screenName !== null && <span className="nx-dock-name">‘{screenName}’</span>}
            {plan !== null && <RunPlanSummary plan={plan} />}
            {startedAt !== null && <Elapsed startedAt={startedAt} />}
            <i className="nx-dock-chev" aria-hidden="true">
              <ChevIcon />
            </i>
          </button>
          <button type="button" className="nx-dock-stop" disabled={stopping} onClick={onStop}>
            {stopping ? L.chat.stopping : L.composer.stop}
          </button>
          {open && plan !== null && (
            <Popover
              anchor={anchor}
              onClose={() => setOpen(false)}
              up
              label={L.chat.plan.title}
              className="nx-plan-pop"
            >
              <RunPlanList plan={plan} />
            </Popover>
          )}
        </>
      )}
      {row?.kind === "ask" && (
        <button type="button" className="nx-dock-main" onClick={onAskGo}>
          <SparkIcon />
          <span>{L.chat.dock.ask}</span>
          <span className="nx-dock-act">{L.chat.dock.askGo}</span>
        </button>
      )}
      {row?.kind === "notice" && (
        <div className="nx-dock-note" title={row.text}>
          {row.text}
        </div>
      )}
      {refPhase !== "ready" && (
        <ReadState
          state={
            refPhase === "failed" ? { phase: "failed", onRetry: onRefsRetry } : { phase: "loading" }
          }
          title={refPhase === "failed" ? L.planTab.refsReadFailed : L.readState.loading}
        />
      )}
      {entries > 0 && (
        <button
          type="button"
          className={`nx-dock-refs${refsOpen ? " nx-dock-refs--on" : ""}`}
          aria-expanded={refsOpen}
          title={L.chat.dock.refsTip(entries)}
          onClick={() => setRefsOpen((was) => !was)}
        >
          <FileSmIcon />
          {L.chat.dock.refsChip(entries)}
        </button>
      )}
      {/* 근거 줄은 칩이 열 때만 아래로 펼쳐진다 — 펼침은 사람이 청한 두 번째 줄이라
          한 줄 규칙을 깨지 않는다(알약의 목록과 같은 길). */}
      {refsOpen && entries > 0 && (
        <PlanRefStrip
          daemon={daemon}
          sessionId={sessionId}
          sentCount={0}
          nav={nav}
          entries={refEntries}
          forceOpen
        />
      )}
    </div>
  );
}

/** 독 줄의 할 일 · 보조 작업 요약 — `할 일 2/5 · 보조 작업 3`. */
function RunPlanSummary({ plan }: { plan: PlanShape }) {
  const progress = plan.todos === null ? null : todoProgress(plan.todos);
  const pill = [
    progress && L.chat.plan.todo(progress.done, progress.total),
    plan.agents.length > 0 ? L.chat.plan.agents(plan.agents.length) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return pill === "" ? null : <span className="nx-dock-plan">{pill}</span>;
}
