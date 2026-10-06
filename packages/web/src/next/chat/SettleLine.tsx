import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { L } from "../labels";
import { splitDuration } from "../lib/thread";
import { Popover } from "../ui/Popover";
import { CheckIcon, CopyIcon, ForkIcon, HistoryIcon, MoreIcon } from "./icons";

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
 * `···` 메뉴의 줄 하나 — 이름은 제목이, 한 줄 설명은 `aria-describedby` 가 맡는다(제목과 설명이
 * 한 이름으로 뭉쳐 읽히지 않게). 못 하는 일(`off`)은 사라지지 않고 이유와 함께 흐려져 있다:
 * `aria-disabled` 라 화살표 걸음에는 남아 이유를 읽을 수 있고, 눌러도 아무 일이 없다
 * (2026-10-06 겹판 조사 — 갈래를 못 내는 AI 에서는 줄과 안내가 통째로 사라져 이유가 안 보였다).
 */
function MenuRow({
  icon,
  title,
  sub,
  off = false,
  onPick,
}: {
  icon: ReactNode;
  title: string;
  /** 제목 밑의 한 줄 — 못 하는 줄이면 못 하는 이유가 선다. */
  sub?: string;
  off?: boolean;
  onPick: () => void;
}) {
  const id = useId();
  return (
    <button
      type="button"
      role="menuitem"
      className={`nx-mi${off ? " nx-mi--off" : ""}`}
      aria-disabled={off || undefined}
      aria-labelledby={`${id}-t`}
      aria-describedby={sub ? `${id}-s` : undefined}
      onClick={off ? undefined : onPick}
    >
      <span className="nx-mi-ic">{icon}</span>
      <span className="nx-mt">
        <b id={`${id}-t`} className="nx-mi-name">
          {title}
        </b>
        {sub && <small id={`${id}-s`}>{sub}</small>}
      </span>
    </button>
  );
}

/**
 * 정산 줄 — 한 답이 끝난 자리: 끝났다는 표시 · 걸린 시간 · 답변 복사 · 더 보기.
 * 구분선 없이 답 바로 아래에 조용히 앉는 한 줄이고, 단추는 글자 없이 그림만 선다 —
 * 이름은 aria-label 과 title 이 말한다(복사한 순간만 `복사했어요` 가 곁에 선다).
 * `···` 는 메뉴다(`role="menu"` — ↑ ↓ Home End · 글자 건너뛰기): `여기서 새 대화`(대화만 이 답까지
 * 이어받는다 — 화면은 그대로), `작업 기록에서 되돌리기`, `전체 복사`. 갈래를 못 내는 AI 면
 * `여기서 새 대화` 가 이유와 함께 흐려져 남는다.
 *
 * 복사했다는 말은 이 줄 한 곳에서만 한다 — 단추의 확인 표시와 낭독이고 토스트는 띄우지 않는다.
 * 메뉴의 `전체 복사` 도 같은 자리에 닿는다. 못 한 때만 토스트가 전체 안내를 말한다.
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
  /** 여기서 새 대화 — 갈래를 낼 수 없는 AI 면 없고, 메뉴가 그 이유를 흐린 줄로 말한다. */
  onFork: (() => void) | null;
  onOpenHistory: () => void;
  /** 복사에 실패했을 때의 안내 — 성공은 이 줄이 스스로 말한다. */
  onToast: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  // 복사가 닿았다는 답 — 아이콘이 잠깐 확인으로 바뀌고 낭독도 한 번 한다(1.5초 뒤 돌아온다).
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );
  const copy = (text: string) => {
    copyText(
      text,
      () => {
        setCopied(true);
        if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
      },
      () => onToast(L.transcript.copyFailed),
    );
  };
  const answer = lastAnswer ?? whole;
  const hasMenu = onFork !== null || whole !== null;
  if (durationMs == null && whole == null && !hasMenu) return null;
  return (
    <div className={`nx-settle${reward ? " nx-settle--draw" : ""}`}>
      <span className="nx-settle-mark" aria-hidden="true">
        <CheckIcon />
      </span>
      <span className="nx-settle-state">
        {durationMs != null ? L.transcript.took(durationText(durationMs)) : L.transcript.done}
      </span>
      {answer != null && (
        <button
          type="button"
          className={`nx-settle-btn${copied ? " nx-settle-btn--done" : ""}`}
          title={L.transcript.copyOne}
          aria-label={L.transcript.copyOne}
          onClick={() => copy(answer)}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied && <span>{L.transcript.copied}</span>}
        </button>
      )}
      {/* 복사한 결과는 눈이 아니라 낭독으로도 한 번 말한다. */}
      <span className="nx-sr" role="status">
        {copied ? L.transcript.copied : ""}
      </span>
      {hasMenu && (
        <span className="nx-anchor">
          <button
            ref={anchor}
            type="button"
            className="nx-settle-btn"
            title={L.transcript.settleMenuTip}
            aria-label={L.transcript.settleMenuTip}
            aria-haspopup="menu"
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
              role="menu"
              label={L.transcript.settleMenuTip}
              className="nx-settle-pop"
            >
              <MenuRow
                icon={<ForkIcon />}
                title={L.transcript.fork}
                sub={onFork ? L.transcript.forkSub : L.transcript.forkOff}
                off={onFork === null}
                onPick={() => {
                  setOpen(false);
                  onFork?.();
                }}
              />
              <MenuRow
                icon={<HistoryIcon />}
                title={L.transcript.forkRevertLink}
                sub={L.transcript.forkRevertSub}
                onPick={() => {
                  setOpen(false);
                  onOpenHistory();
                }}
              />
              {whole !== null && (
                <>
                  <hr className="nx-msep" />
                  <MenuRow
                    icon={<CopyIcon />}
                    title={L.transcript.copyAll}
                    onPick={() => {
                      setOpen(false);
                      copy(whole);
                    }}
                  />
                </>
              )}
            </Popover>
          )}
        </span>
      )}
    </div>
  );
}
