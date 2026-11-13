import { useEffect, useState } from "react";
import type { Block } from "../../lib/daemon-client";
import { waitedFor } from "../../lib/format";
import { toolLabel } from "../../lib/labels";
import { isToolRunning } from "../../lib/progress";
import { L } from "../../next/labels";
import { CopyButton } from "../../next/ui/CopyButton";
import { CheckIcon, ChevronRightIcon, CloseIcon } from "../icons";
import { Tip } from "../Tip";
import { type TaskControls, type ToolStatus, toolHeadline } from "./shared";

/**
 * 도는 도구의 경과 시계 — "몇 분째인가"는 심장박동(`tool.progress`)이 오기
 * 전부터 뜻이 있으니, 행이 뜬 시각(`startedAt`)에서 창이 직접 센다. 1초
 * tick 은 이 글자만 다시 그린다(TurnClock 과 같은 이유로 컴포넌트를 나눴다).
 */
function ToolElapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  return <>{waitedFor(now - startedAt)}</>;
}

function ToolBlock({
  block,
  onBackgroundTask,
  onStopTask,
}: { block: Extract<Block, { type: "tool" }> } & TaskControls) {
  const [open, setOpen] = useState(false);
  const headline = toolHeadline(block.input);
  // 뒤로 보낸 작업의 도구 결과는 자리표시자다: done 하나로 판정하면
  // 아직 도는 일이 끝난 것처럼 보인다 — 판정은 progress.ts 한 곳에서.
  const running = isToolRunning(block);
  const status: ToolStatus = running ? "running" : block.isError ? "error" : "done";
  const task = block.progress?.task;
  const elapsed = block.progress?.elapsedSeconds ?? 0;
  const retry = block.progress?.retry;

  // 2026-11-12 UI 조사 U-040 — 누른 손은 기다리는 동안 잠기고, Promise 가
  // 실패({moved:false} 포함)를 알리면 같은 자리에서 다시 누를 수 있게
  // 머무른다. 결과가 없는 콜백(오래된 호출부)도 실패로 남지 않게
  // 이미 끝난 Promise 로 친다.
  const [acting, setActing] = useState<"back" | "stop" | null>(null);
  const [actError, setActError] = useState<"back" | "stop" | null>(null);
  const act = (kind: "back" | "stop", call: () => unknown) => {
    setActError(null);
    let outcome: unknown;
    try {
      outcome = call();
    } catch {
      setActError(kind);
      return;
    }
    if (outcome === undefined || outcome === null) return;
    setActing(kind);
    void Promise.resolve(outcome)
      .then((result) => {
        if (result && typeof result === "object" && "moved" in result && result.moved === false)
          setActError(kind);
      })
      .catch(() => setActError(kind))
      .finally(() => setActing(null));
  };

  return (
    <div className={`tool tool--${status}`}>
      <div className="tool__bar">
        <button
          className="tool__head"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          type="button"
        >
          <span className={`tool__chevron${open ? " tool__chevron--open" : ""}`}>
            <ChevronRightIcon />
          </span>
          <span className={`tool__sign tool__sign--${status}`}>
            {status === "running" ? (
              <span className="spinner" />
            ) : status === "error" ? (
              <CloseIcon size={11} />
            ) : (
              <CheckIcon size={11} />
            )}
          </span>
          <span className="tool__name">{toolLabel(block.name)}</span>
          {headline && <span className="tool__headline">{headline}</span>}
          {block.agentId && <span className="tag">{L.tape.subagentTag}</span>}
          <span className={`tool__status tool__status--${status}`}>
            {status === "error" ? (
              L.tape.toolFailed
            ) : running ? (
              // 몇 초째인지는 도는 동안에만 뜻이 있다: 끝난 행에
              // 남으면 지금 도는 것처럼 읽힌다. 시계는 행이 뜬 시각에서
              // 센다 — 심장박동이 안 오는 도구도 멈춘 것처럼 보이지 않게.
              block.startedAt !== undefined ? (
                <ToolElapsed startedAt={block.startedAt} />
              ) : elapsed > 0 ? (
                L.tape.seconds(Math.round(elapsed))
              ) : (
                L.tape.toolRunning
              )
            ) : (
              ""
            )}
          </span>
        </button>
        {/* 작업 버튼은 머리 버튼 바깥에 산다 — 버튼 안의 버튼은 클릭이 겹친다.
            U-040: 누른 손은 기다리는 동안 잠기고 실패는 같은 자리에서 알린다. */}
        {task && task.status === "running" && (
          <span className="tool__acts">
            {!task.backgrounded && onBackgroundTask && (
              <Tip label={L.tape.sendBackTip}>
                <button
                  type="button"
                  className="ghost tool__act"
                  disabled={acting !== null}
                  aria-busy={acting === "back"}
                  onClick={() => act("back", () => onBackgroundTask(block.id))}
                >
                  {acting === "back" ? L.tape.sendBackBusy : L.tape.sendBack}
                </button>
              </Tip>
            )}
            {onStopTask && (
              <Tip label={L.tape.stopTaskTip}>
                <button
                  type="button"
                  className="ghost tool__act"
                  disabled={acting !== null}
                  aria-busy={acting === "stop"}
                  onClick={() => act("stop", () => onStopTask(task.id))}
                >
                  {acting === "stop" ? L.tape.stopTaskBusy : L.tape.stopTask}
                </button>
              </Tip>
            )}
          </span>
        )}
      </div>
      {/* 작업의 한 줄: 모델이 쓴 근황이 있으면 그것이 가장 최신이고,
          없으면 무엇을 하러 떠난 작업인지가 남는다. 전체 문장은 title 로 —
          말줄임 뒤의 끝이 읽히게(U-041). */}
      {task && (
        <div className="tool__task">
          <span className="tool__tasktext" title={task.summary || task.description}>
            {task.summary || task.description}
          </span>
          {task.toolUses > 0 && (
            <span className="tool__taskmeta">{L.tape.toolUses(task.toolUses)}</span>
          )}
          {task.lastTool && <span className="tool__taskmeta">{toolLabel(task.lastTool)}</span>}
          {task.backgrounded && task.status === "running" && (
            <span className="tag">{L.tape.bgTag}</span>
          )}
        </div>
      )}
      {actError !== null && (
        <div className="tool__task tool__task--error" role="alert">
          <span className="tool__tasktext">
            {actError === "back" ? L.tape.sendBackFailed : L.tape.stopTaskFailed}
          </span>
        </div>
      )}
      {retry && (
        <div className="tool__task">
          <span className="tool__tasktext">
            {L.tape.retryLine(retry.attempt, retry.maxRetries)}
          </span>
        </div>
      )}
      {open && (
        <div className="tool__body">
          {task && <p className="tool__taskfull">{task.summary || task.description}</p>}
          <div className="tool__label">{L.tape.toolInput}</div>
          <RawView value={block.input} />
          {block.done && (
            <>
              <div className="tool__label">{L.tape.toolResult}</div>
              <RawView value={block.result} tail={block.isError} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 도구의 긴 입력 · 결과 — 앞 4,000자만 DOM 에 올리던 자리(2026-11-12 UI 조사
 * U-041). 자른 것은 그 끝이 어디인지 모르므로 잘렸음을 말하고 «전체 보기»
 * 로 펼친다(스크롤은 CSS 의 320px 가 받는다). 실패한 결과는 앞이 아니라
 * 끝에 이유가 쓰여 있으므로 꼬리 조각도 함께 둔다.
 */
const RAW_PREVIEW_CHARS = 4000;

function rawText(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
}

function RawView({ value, tail = false }: { value: unknown; tail?: boolean }) {
  const [whole, setWhole] = useState(false);
  const text = rawText(value);
  const truncated = text.length > RAW_PREVIEW_CHARS && !whole;
  return (
    <>
      <pre>{truncated ? `${text.slice(0, RAW_PREVIEW_CHARS)}…` : text}</pre>
      <CopyButton text={text} label={L.transcript.copyAll} small />
      {truncated && (
        <div className="tool__more">
          {tail && <span className="tool__tail">{L.tape.toolTail}</span>}
          {tail && <pre>{text.slice(-1000)}</pre>}
          <button type="button" className="ghost tool__whole" onClick={() => setWhole(true)}>
            {L.tape.toolWhole}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * the agent.s private reasoning — off unless 설정's `생각 과정 보기` asks for it
 * (Transcript drops the blocks before grouping). When it is on the fold is
 * still closed: while the turn is running it reads as live ("생각 중…"); once
 * the turn ends the same fold reads as a record ("생각 과정") — a finished
 * transcript must not look like it is still thinking. The closed fold carries
 * the thought's first line as a peek, so a planner scanning the tape reads the
 * shape of the reasoning without opening it.
 */
function ThinkingBlock({ block }: { block: Extract<Block, { type: "thinking" }> }) {
  const peek = block.text.trimStart().split("\n", 1)[0] ?? "";
  return (
    <details className={block.streaming ? "thinking thinking--live" : "thinking"}>
      <summary>
        <span className="thinking__label">
          {block.streaming ? L.tape.thinkLive : L.tape.thinkDone}
        </span>
        {!block.streaming && peek && <span className="thinking__peek">{peek}</span>}
      </summary>
      <pre>{block.text}</pre>
    </details>
  );
}

export { ThinkingBlock, ToolBlock };
