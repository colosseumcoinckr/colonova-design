import { useEffect, useRef, useState } from "react";
import { L } from "../labels";
import { splitDuration } from "../lib/thread";
import { Popover } from "../ui/Popover";
import { CheckIcon, CopyIcon, ForkIcon, MoreIcon } from "./icons";

/** `12초` · `1분 5초` — 걸린 시간. */
export function durationText(ms: number): string {
  const { minutes, seconds } = splitDuration(ms);
  return minutes === 0
    ? L.transcript.seconds(seconds)
    : L.transcript.minutesSeconds(minutes, seconds);
}

/** Report clipboard failures as well as successful copies. */
export function copyText(text: string, onDone: () => void, onError: () => void): void {
  void navigator.clipboard.writeText(text).then(onDone).catch(onError);
}

/**
 * 정산 줄 — 한 답이 끝난 자리: 걸린 시간 · 답변 복사 · 더 보기.
 * `···` 안에 `여기서 새 대화`(대화만 이 답까지 이어받는다 — 화면은 그대로라는
 * 문장과 `작업 기록에서 되돌리기` 링크가 함께), 그리고 `전체 복사`.
 */
export function SettleLine({
  durationMs,
  whole,
  lastAnswer,
  reward,
  onFork,
  onOpenHistory,
  onToast,
}: {
  durationMs: number | null;
  /** 이 요청이 낸 답 전부 — 없으면 전체 복사가 없다. */
  whole: string | null;
  /** 마지막 답 한 조각 — `이 답변만 복사`. */
  lastAnswer: string | null;
  /** 이번 창에서 막 끝난 답인가 — 체크가 그려지듯 등장하는 보상은 이때만. */
  reward: boolean;
  /** 여기서 새 대화 — 갈래를 낼 수 없는 AI 면 없다. */
  onFork: (() => void) | null;
  onOpenHistory: () => void;
  onToast: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  // 복사가 닿았다는 답 — 아이콘이 잠깐 확인으로 바뀐다(토스트와 함께).
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );
  const answer = lastAnswer ?? whole;
  const copyAnswer = () => {
    if (answer === null) return;
    copyText(
      answer,
      () => {
        onToast(lastAnswer !== null ? L.transcript.copyOneToast : L.transcript.copyAllToast);
        setCopied(true);
        if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
      },
      () => onToast(L.transcript.copyFailed),
    );
  };
  const hasMenu = onFork !== null || whole !== null;
  if (durationMs == null && whole == null && !hasMenu) return null;
  return (
    <div className={`nx-settle${reward ? " nx-settle--draw" : ""}`}>
      <CheckIcon />
      {durationMs != null && <span>{L.transcript.took(durationText(durationMs))}</span>}
      {answer != null && (
        <>
          {durationMs != null && <span className="nx-sep">·</span>}
          <button type="button" onClick={copyAnswer} aria-live="polite">
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? L.transcript.copied : L.transcript.copyOne}
          </button>
        </>
      )}
      {hasMenu && (
        <span className="nx-anchor">
          <button
            ref={anchor}
            type="button"
            title={L.transcript.settleMenuTip}
            aria-label={L.transcript.settleMenuTip}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <MoreIcon />
          </button>
          {open && (
            <Popover
              anchor={anchor}
              onClose={() => setOpen(false)}
              up
              float
              className="nx-settle-pop"
            >
              {onFork && (
                <>
                  <button
                    type="button"
                    className="nx-mi"
                    onClick={() => {
                      setOpen(false);
                      onFork();
                    }}
                  >
                    <ForkIcon />
                    <span className="nx-mt">
                      <b>{L.transcript.fork}</b>
                      <small>{L.transcript.forkSub}</small>
                    </span>
                  </button>
                  <div className="nx-mnote">
                    {L.transcript.forkNote}{" "}
                    <button
                      type="button"
                      className="nx-mlink"
                      onClick={() => {
                        setOpen(false);
                        onOpenHistory();
                      }}
                    >
                      {L.transcript.forkRevertLink}
                    </button>
                  </div>
                </>
              )}
              {onFork && whole !== null && <div className="nx-msep" />}
              {whole !== null && (
                <button
                  type="button"
                  className="nx-mi"
                  onClick={() => {
                    setOpen(false);
                    copyText(
                      whole,
                      () => onToast(L.transcript.copyAllToast),
                      () => onToast(L.transcript.copyFailed),
                    );
                  }}
                >
                  <CopyIcon />
                  {L.transcript.copyAll}
                </button>
              )}
            </Popover>
          )}
        </span>
      )}
    </div>
  );
}
