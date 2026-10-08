import type { ProjectSummary, RepoStatus } from "@colonova-design/protocol";
import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { openLink } from "../../lib/open-link";
import { canOpenScreen } from "../../lib/screen-link";
import { clockOf } from "../chat/cards";
import { L } from "../labels";
import { ciLine } from "../lib/ci-line";
import type { Journey } from "../lib/journey";
import { ledgerLine } from "../lib/submit-copy";
import { handoffOpen } from "../lib/thread";
import { useCopied } from "../lib/use-copied";
import type { CycleScreen } from "../lib/work-ledger";
import { commentRows, cycleStart, outgoingScreens, submitLogLines } from "../lib/work-ledger";
import { Spin } from "../ui/icons";
import { Popover } from "../ui/Popover";
import { NoteBox } from "./NoteBox";
import {
  blockedHelpText,
  dayText,
  ExtIcon,
  FailIcon,
  FixingIcon,
  HistoryIcon,
  MailIcon,
  ScreenRow,
  SentIcon,
  whenText,
} from "./parts";
import type { WorkLedger } from "./use-work-ledger";

/** Stage 3 의 작업 기록 서랍이 듣는 신호 — 서랍은 미리보기 칸의 것이다. */
export const HISTORY_OPEN_EVENT = "nx:history:open";

/** 처음에 보이는 화면 줄의 수 — 나머지는 `바뀐 화면 N개 더 보기` 뒤에(머리 · 바닥은 서 있고 몸만 굴러간다). */
const SCREEN_LIMIT = 4;

/**
 * `이번 작업`(PLAN-UI U2) — 여정을 누르면 뜬다. 옛 셸의 상태 칩 팝오버 ·
 * 변경 목록 · 영수증 카드 · 개발자 코멘트 창이 여기 한 장으로 모인다:
 * 바뀐 화면(제목 · 그 말 · 시각) · 제출(시각 · 작성자 · 받은 개발자 · 제출한
 * 내용 · 제출 기록 세 줄) · 개발자 코멘트(사람 · 글 · 반영 상태) · `작업 기록 열기`.
 *
 * 2026-10-06 겹판 손질 — 읽는 팝이자 가는 팝이다: 화면 줄은 눌러서 그 화면으로 가고, 코멘트는 읽는 중 ·
 * 읽지 못함을 정직하게 말하고(`아직 없어요` 라는 거짓 빈 상태가 아니라), 한마디는 쓰던 글이 안 날아가고,
 * 제출이 막혔으면 담당자에게 건넬 글을 복사할 수 있다. 머리 · 여정 · 바닥은 서 있고 몸만 굴러간다.
 */
export function WorkPopover({
  anchor,
  journey,
  project,
  repo,
  ledger,
  author,
  since,
  noteDraft,
  onNoteDraft,
  onNote,
  onOpenScreen,
  onToast,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  journey: Journey;
  project: ProjectSummary | null;
  repo: RepoStatus | null;
  ledger: WorkLedger;
  /** 요청에 적히는 작성자 이름(`DaemonStatus.authorName`). */
  author: string | null;
  /** 마지막 제출의 시각(`submitCopy.lastAt`). */
  since: string | null;
  /** 쓰던 한마디 — 상태 줄이 쥔다(팝이 닫혀도 남는다). */
  noteDraft: string;
  onNoteDraft: (text: string) => void;
  /** 영수증의 `한마디 더` 와 같은 상자(U20) — 영수증이 멀리 올라간 뒤의 자리. */
  onNote: (text: string) => Promise<void>;
  /** 화면 줄을 눌렀다 — 미리보기를 그 화면으로 옮긴다. */
  onOpenScreen: (screen: CycleScreen) => void;
  onToast: (text: string) => void;
  onClose: () => void;
}) {
  const { cycle } = journey;
  const where =
    cycle === "draft" ? L.work.subDraft : cycle === "review" ? L.work.subReview : L.work.subMerged;
  const start = dayText(cycleStart(repo?.cycleScreens, ledger.history));
  const name = project?.name ?? "";

  const screens = outgoingScreens(repo?.cycleScreens, null);
  const newSince =
    cycle === "review" && since ? outgoingScreens(repo?.cycleScreens, since).length : 0;
  const [allScreens, setAllScreens] = useState(false);
  const shownScreens = allScreens ? screens : screens.slice(0, SCREEN_LIMIT);
  // 열 수 있는 미리보기 칸이 없으면(홈에서 열었다 등) 줄은 읽기만 한다.
  const open = canOpenScreen()
    ? (screen: CycleScreen) => {
        onClose();
        onOpenScreen(screen);
      }
    : undefined;

  // 이번 사이클의 요청 — 반영 뒤 새로 쌓인 작업(draft)은 아직 보내지 않은 것이다.
  const handoff = cycle !== "draft" ? (repo?.handoff ?? null) : null;
  // 한마디 더(U20) — 열린 요청이 있을 때만. 상태 줄이 daemon.api 에 닿는 길을
  // 준다(props 로 받는다).
  const noteOk = handoffOpen(handoff);
  // 자동 검사의 한 줄(2026-10-07) — 읽힌 만큼만. 검사를 못 읽는 연결에서는 줄이 없다.
  const checks = ciLine(handoff, repo?.attention, L);
  // 쓰던 글이 있으면 상자는 열린 채 선다 — 팝을 다시 열어도 이어 쓴다.
  const [noteOpen, setNoteOpen] = useState(() => noteDraft !== "");
  const [noteSentAt, setNoteSentAt] = useState<string | null>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const refocusMore = useRef(false);
  // 상자가 접히면 초점이 허공으로 떨어진다 — 연 단추로 되돌린다.
  useEffect(() => {
    if (!noteOpen && refocusMore.current) {
      refocusMore.current = false;
      moreButton.current?.focus();
    }
  }, [noteOpen]);
  const reviewers =
    handoff?.reviewers && handoff.reviewers.length > 0
      ? handoff.reviewers
      : (project?.reviewers ?? []);
  // 원장의 제출 기록은 병합 뒤 새 draft 로 이월된다 — 경계 앞의 옛 사이클
  // 줄은 가린다(2026-10-04 ux-plan PR 3, 결함 6). draft 의 경계는 마지막
  // 넘김이고, review · merged 는 마지막 제출(since) 뒤만 본다(comments 칸의
  // draft 분기와 같은 패턴).
  const log = submitLogLines(
    repo?.submit?.log ?? [],
    cycle === "draft" ? ledger.handedAt : since,
  ).slice(0, 3);
  // 제출 칸의 지금 한 줄(W1) — 도는 제출의 상태 문장 · 막힘의 이유. 쉬면 null.
  const submitLine = ledgerLine(repo?.submit, L);
  const submitBlocked = repo?.submit?.phase === "blocked";
  // 문제 문장 줄의 ✕ 로 막힘을 닫아도 담당자에게 건넬 글은 여기서 복사된다.
  const { copied, copy } = useCopied(() => onToast(L.chat.somethingWrong));
  const comments =
    cycle === "draft"
      ? []
      : commentRows(ledger.reviews, ledger.history, {
          merged: cycle === "merged",
          reflectionPrefix: L.work.reflectionPrefix,
        });

  return (
    <Popover
      anchor={anchor}
      onClose={onClose}
      align="end"
      className="nx-work-pop"
      label={L.work.title}
    >
      <div className="nx-wp-h">
        <b>{L.work.title}</b>
        <div>{L.work.headerSub(name, start, where)}</div>
      </div>
      <div className={`nx-wp-journey nx-cycle--${cycle}`}>
        {journey.points.map((point, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 계단의 자리가 곧 정체다 — 글자를 key 로 쓰면 국면이 바뀔 때 자리가 버려져 채움이 끊긴다.
          <div key={index} className={`nx-wp-step nx-wp-step--${point.state}`}>
            {point.label}
          </div>
        ))}
      </div>

      <div className="nx-wp-body">
        {/* 2026-10-04 ux-review: 초안이고 바뀐 화면이 없으면 `아직 없다` 류 안내가
            겹친다 — 바뀐 화면 칸을 접고 제출 칸의 `아직 제출하지 않았어요` 한 문장만
            둔다. */}
        {!(cycle === "draft" && screens.length === 0) && (
          <div className="nx-wp-sec">
            <h5>
              {screens.length > 0 ? L.work.changedCount(screens.length) : L.work.changed}
              {newSince > 0 && <span className="nx-wp-hr">{L.work.changedSince(newSince)}</span>}
            </h5>
            {screens.length > 0 ? (
              <>
                {shownScreens.map((screen) => (
                  <ScreenRow key={screen.route} screen={screen} onOpen={open} />
                ))}
                {shownScreens.length < screens.length && (
                  <button
                    type="button"
                    className="nx-btn nx-btn--ghost nx-btn--sm nx-wp-more"
                    onClick={() => setAllScreens(true)}
                  >
                    {L.work.moreScreens(screens.length - shownScreens.length)}
                  </button>
                )}
              </>
            ) : (
              <div className="nx-wp-empty">
                {cycle === "merged" ? L.work.changedEmptyMerged : L.work.changedEmpty}
              </div>
            )}
          </div>
        )}

        <div className="nx-wp-sec">
          <h5>{L.work.submitHeading}</h5>
          {handoff && (
            <>
              <div className="nx-wp-receipt">
                <span>
                  <SentIcon />
                  {L.work.submittedBy(whenText(ledger.handedAt ?? since), author) ||
                    L.journey.submittedDone}
                </span>
                <button
                  type="button"
                  className="nx-btn nx-btn--sm"
                  onClick={() => openLink(handoff.url)}
                >
                  {L.vocab.openSubmitted}
                  <ExtIcon />
                </button>
              </div>
              {reviewers.length > 0 && (
                <div className="nx-wp-empty nx-wp-gap">
                  {L.work.receivedBy(reviewers.join(" · "))}
                </div>
              )}
              {checks && (
                <div
                  className={`nx-wp-empty nx-wp-gap nx-wp-icon nx-wp-ci nx-wp-ci--${checks.tone}`}
                >
                  <span className="nx-wp-ci-i">
                    {checks.tone === "passing" ? (
                      <SentIcon />
                    ) : checks.tone === "notified" ? (
                      <MailIcon />
                    ) : checks.tone === "failing" ? (
                      <FailIcon />
                    ) : (
                      <Spin />
                    )}
                  </span>
                  {checks.text}
                </div>
              )}
            </>
          )}
          {submitLine ? (
            <div
              className={`nx-wp-empty${handoff ? " nx-wp-gap" : ""}${submitBlocked ? " nx-wp-icon" : ""}`}
            >
              {submitBlocked && <MailIcon />}
              {submitLine}
            </div>
          ) : (
            !handoff && <div className="nx-wp-empty">{L.work.notSubmitted}</div>
          )}
          {submitBlocked && (
            <div className="nx-wp-copy">
              <button
                type="button"
                className="nx-btn nx-btn--sm"
                onClick={() =>
                  copy(
                    blockedHelpText(
                      project?.name,
                      repo?.submit?.lastError === "permission"
                        ? L.problem.blockedPermission
                        : L.problem.blockedBody,
                      repo?.submit?.lastError,
                    ),
                  )
                }
              >
                {copied ? L.problem.copiedHelp : L.problem.copyHelp}
              </button>
              {/* 복사했다는 답은 눈이 아니라 낭독으로도 한 번 말한다. */}
              <span className="nx-sr" role="status">
                {copied ? L.problem.copiedHelp : ""}
              </span>
            </div>
          )}
          {log.length > 0 && (
            <div className="nx-slog">
              {log.map((line) => (
                <div key={`${line.at}${line.text}`}>
                  <small>{whenText(line.at)}</small>
                  <span>{line.text}</span>
                </div>
              ))}
            </div>
          )}
          {noteOk && (
            <div className="nx-wp-note">
              {noteOpen ? (
                <NoteBox
                  placeholder={L.work.notePlaceholder}
                  draft={noteDraft}
                  onDraft={onNoteDraft}
                  onSend={onNote}
                  onSent={() => {
                    const time = clockOf(Date.now());
                    setNoteSentAt(time);
                    refocusMore.current = true;
                    setNoteOpen(false);
                    onToast(L.work.noteSent(time));
                  }}
                  onCancel={() => {
                    refocusMore.current = true;
                    setNoteOpen(false);
                  }}
                />
              ) : (
                <button
                  ref={moreButton}
                  type="button"
                  className="nx-btn nx-btn--sm"
                  onClick={() => setNoteOpen(true)}
                >
                  {L.work.noteMore}
                </button>
              )}
              {noteSentAt && (
                <div className="nx-reply-sent">
                  <SentIcon />
                  <span>{L.work.noteSent(noteSentAt)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="nx-wp-sec nx-wp-sec--last">
          <h5>
            {comments.length > 0 ? L.work.commentsCount(comments.length) : L.work.comments}
            {comments.length > 0 && <span className="nx-wp-hr">{L.work.commentsAuto}</span>}
          </h5>
          {cycle === "draft" ? (
            <div className="nx-wp-empty">{L.work.commentsEmptyDraft}</div>
          ) : ledger.status === "loading" ? (
            // 읽는 중에는 빈 상태를 말하지 않는다 — 뼈대와 한 줄.
            <div role="status" aria-busy="true" className="nx-st-load">
              <p className="nx-st-loadtext">
                <Spin />
                {L.work.loading}
              </p>
              <div className="nx-st-skel" aria-hidden="true">
                <div />
                <div />
              </div>
            </div>
          ) : ledger.status === "failed" ? (
            <div role="alert" className="nx-st-note nx-st-note--red">
              <FailIcon />
              <span className="nx-st-note-t">{L.work.readFailed}</span>
              <button type="button" className="nx-btn nx-btn--sm" onClick={ledger.retry}>
                {L.vocab.retry}
              </button>
            </div>
          ) : comments.length > 0 ? (
            comments.map((comment) => (
              <div key={comment.id} className="nx-wp-cm">
                <span className="nx-avt" aria-hidden="true">
                  {comment.author.trim().slice(0, 1) || "?"}
                </span>
                <div className="nx-wp-cb">
                  <div className="nx-wp-ch">
                    <b>{comment.author.trim() || L.work.commentAuthor}</b>
                    <time dateTime={comment.at}>{whenText(comment.at)}</time>
                    {comment.state !== "unknown" && (
                      <span className={`nx-wp-r nx-wp-state nx-wp-state--${comment.state}`}>
                        {comment.state === "done" ? <SentIcon /> : <FixingIcon />}
                        {comment.state === "done" ? L.work.commentDone : L.work.commentFixing}
                      </span>
                    )}
                  </div>
                  <p title={comment.text}>{comment.text}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="nx-wp-empty">{L.work.commentsEmpty}</div>
          )}
        </div>
      </div>

      <div className="nx-wp-foot">
        <button
          type="button"
          className="nx-btn nx-btn--sm"
          onClick={() => {
            onClose();
            window.dispatchEvent(new CustomEvent(HISTORY_OPEN_EVENT));
          }}
        >
          <HistoryIcon />
          {L.work.openHistory}
        </button>
      </div>
    </Popover>
  );
}
