import {
  Check,
  CircleAlert,
  ExternalLink,
  History,
  Lock,
  type LucideIcon,
  Mail,
  RefreshCw,
  Send,
} from "lucide-react";
import { L } from "../labels";
import { historyKindOf } from "../lib/history-kind";
import { type CycleScreen, clockParts } from "../lib/work-ledger";
import { ChevronRightIcon } from "../ui/icons";

/**
 * 상태 줄의 두 팝오버(제출 확인 · 이번 작업)가 함께 쓰는 조각 — 목업의 `.thumb`
 * 화면 줄, 시각 한 칸, 그림. 그림은 ui/icons 와 같은 선 굵기로 여기서만 쓴다.
 */
function make(Glyph: LucideIcon, size: number, strokeWidth = 1.8) {
  return function Icon() {
    return <Glyph className="nx-i" size={size} strokeWidth={strokeWidth} aria-hidden="true" />;
  };
}

export const SentIcon = make(Check, 14, 2.2);

/**
 * 그려지는 체크 — 제출이 답하는 순간 선이 길을 그리듯 나타난다(status.css 의
 * `nx-draw`). `pathLength` 를 24 로 못 박아 대시의 셈이 길과 상관없게 한다.
 */
export function DrawnCheck() {
  return (
    <svg
      className="nx-i nx-draw-check"
      viewBox="0 0 14 14"
      width={14}
      height={14}
      aria-hidden="true"
    >
      <path
        d="M2.5 7.5 L5.5 10.5 L11.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={24}
      />
    </svg>
  );
}
export const FailIcon = make(CircleAlert, 14);
export const ExtIcon = make(ExternalLink, 12);
/** 작업 기록 서랍을 여는 단추의 그림 — 막대의 단추 · 서랍 머리 · 대화의 메뉴와 같은 `History` 다. */
export const HistoryIcon = make(History, 13);
export const MailIcon = make(Mail, 13);
export const FixingIcon = make(RefreshCw, 11, 2);
/** 제출 확인 머리의 그림(34px 알) · 잠긴 이유 앞의 자물쇠(2026-10-06 겹판 손질). */
export const SubmitIcon = make(Send, 17);
export const LockIcon = make(Lock, 13);

/** 시각 한 칸 — 오늘이면 `10:12`, 아니면 `9월 24일 10:12`. 읽을 수 없으면 빈 칸. */
export function whenText(iso: string | null | undefined): string {
  if (!iso) return "";
  const parts = clockParts(iso, new Date());
  return parts ? L.work.time(parts.today, parts.hhmm, parts.month, parts.day) : "";
}

/** 시작일 — `9월 25일`. */
export function dayText(iso: string | null): string | null {
  if (!iso) return null;
  const parts = clockParts(iso, new Date());
  return parts ? L.work.day(parts.month, parts.day) : null;
}

/**
 * 화면 한 줄 — 작은 그림 · 제목 · 그 화면을 만든 말 · 시각(목업 `.wp-row`). `onOpen` 을 건네면 줄 전체가
 * 그 화면을 여는 단추가 되고 끝에 `›` 가 선다(`이번 작업` — 제출 확인에는 열기 단추가 따로 있는데 여기에는
 * 없었다, 2026-10-06 겹판 조사). 건네지 않으면 읽는 줄이다.
 */
export function ScreenRow({
  screen,
  onOpen,
}: {
  screen: CycleScreen;
  onOpen?: (screen: CycleScreen) => void;
}) {
  const eventKind = historyKindOf(screen.note, screen.kind, {
    restore: L.history.restorePrefix,
    comment: L.history.commentPrefix,
  });
  const note =
    eventKind === "merge"
      ? L.history.eventMerge
      : eventKind === "restore"
        ? L.history.eventRestore
        : eventKind === "comment"
          ? L.history.eventComment
          : screen.note;
  const body = (
    <>
      <span className="nx-thumb" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="nx-wp-t">
        <b>{screen.title}</b>
        {note && <span>{note}</span>}
      </span>
      <span className="nx-wp-r">{whenText(screen.at)}</span>
    </>
  );
  if (!onOpen) {
    return (
      <div className="nx-wp-row" title={screen.route}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="nx-wp-row nx-wp-row--btn"
      title={L.requestResult.latest}
      aria-label={`${screen.title} · ${L.requestResult.latest}`}
      onClick={() => onOpen(screen)}
    >
      {body}
      <span className="nx-wp-go" aria-hidden="true">
        <ChevronRightIcon />
      </span>
    </button>
  );
}

/**
 * 제출이 막혔을 때 담당자에게 건넬 글 — 문제 문장 줄의 복사 단추와 `이번 작업` 의 복사 단추가 같은 글을 복사한다
 * (줄의 ✕ 로 문제를 닫아도 이 길이 남는다).
 */
export function blockedHelpText(
  projectName: string | null | undefined,
  body: string,
  lastError: string | null | undefined,
): string {
  return L.problem.helpText(projectName ?? L.sidebar.brand, `${body}\n${lastError ?? ""}`);
}
