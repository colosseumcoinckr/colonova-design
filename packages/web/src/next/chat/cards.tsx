import type {
  AskQuestion,
  DeveloperReview,
  RepoStatus,
  TurnMarker,
} from "@colonova-design/protocol";
import { useId, useState } from "react";
import type { Block, PendingPermission, PendingQuestion } from "../../lib/daemon-client";
import { composing } from "../../lib/ime";
import { bashHeadline, toolLabel } from "../../lib/labels";
import { linkClick } from "../../lib/open-link";
import { L } from "../labels";
import { noteAllowed } from "../lib/thread";
import { AlertIcon, CheckIcon, ClockIcon, ExtIcon, EyeIcon, SparkIcon } from "./icons";

/** `오후 3:12` 가 아니라 `15:12` — 목업의 시각 표기. */
export function clockOf(at: string | number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** 카드 머리의 상태 알약 — `AI가 고치는 중` · `AI가 고쳤어요` 같은 것. */
function Stat({ done, doneText, runText }: { done: boolean; doneText: string; runText: string }) {
  return done ? (
    <span className="nx-stat nx-stat--ok">
      <CheckIcon />
      {doneText}
    </span>
  ) : (
    <span className="nx-stat nx-stat--run">
      <i className="nx-spin" aria-hidden="true" />
      {runText}
    </span>
  );
}

/** AI 가 실제로 받은 글 — 한 겹 접혀 있다(개발자 말이라 몰라도 된다). */
function Received({ body }: { body: string }) {
  if (body.trim() === "") return null;
  return (
    <details className="nx-card-fold">
      <summary>{L.cards.gateBody}</summary>
      <pre>{body}</pre>
    </details>
  );
}

/**
 * 화면 확인 카드 — 게이트(`gate`)와 미리보기 오류를 맡긴 턴(`error`)이 같은 모양이다:
 * 무엇을 찾았는지 한 문장, 하실 일은 없다는 한 문장, 받은 글은 접혀 있다.
 */
export function GateCard({
  marker,
  body,
  fixing,
  result,
}: {
  marker: Extract<TurnMarker, { kind: "gate" | "error" }>;
  body: string;
  /** 이 턴이 아직 도는 중인가 — 알약이 `AI가 고치는 중` 이 된다. */
  fixing: boolean;
  result?: import("@colonova-design/protocol").GateResult;
}) {
  const title =
    marker.kind === "error" && marker.errorKind === "look" ? L.chat.lookTitle : L.cards.screenCheck;
  const summary =
    marker.kind === "gate"
      ? L.chat.gateSummary(marker.step)
      : marker.errorKind === "look"
        ? L.chat.lookSummary
        : L.chat.errorSummary;
  return (
    <div className="nx-card nx-card--gate">
      <div className="nx-ch">
        <EyeIcon />
        <b>{title}</b>
        {fixing ? (
          <Stat done={false} doneText={L.cards.gateFixed} runText={L.cards.gateFixing} />
        ) : (
          <span className={`nx-stat${result === "verified" ? " nx-stat--done" : ""}`}>
            {L.cards.gateResult[result ?? "unverified"]}
          </span>
        )}
      </div>
      <div className="nx-cs">
        {summary}{" "}
        {fixing ? L.cards.nothingToDoYet : L.cards.gateResultDetail[result ?? "unverified"]}
      </div>
      <Received body={body} />
    </div>
  );
}

/** 도구가 연 대화의 첫 브리프(연결 준비 · 받아오기 · 화면 만들기) — 한 줄과 접힌 글. */
export function BriefCard({
  marker,
  body,
}: {
  marker: Extract<TurnMarker, { kind: "brief" }>;
  body: string;
}) {
  const title =
    marker.purpose === "bootstrap"
      ? L.chat.briefBootstrap
      : marker.purpose === "refresh"
        ? L.chat.briefRefresh
        : marker.purpose === "conventions"
          ? L.chat.briefConventions
          : L.chat.briefScreen(marker.title);
  return (
    <div className="nx-card nx-card--gate">
      <div className="nx-ch">
        <SparkIcon />
        <b>{title}</b>
      </div>
      <Received body={body} />
    </div>
  );
}

/**
 * 기계의 알림 카드 — AI 가 읽어야 하지만 행동을 부르지 않는 턴(지금 보내기가
 * 돌아가던 답을 자른 것)이 한 줄로 선다. 받은 글은 다른 카드와 같이 접힌다.
 */
export function NoticeCard({
  marker,
  body,
}: {
  marker: Extract<TurnMarker, { kind: "notice" }>;
  body: string;
}) {
  return (
    <div className="nx-card nx-card--gate">
      <div className="nx-ch">
        <ClockIcon />
        <b>{marker.text}</b>
      </div>
      <Received body={body} />
    </div>
  );
}

/** 답하기 한 줄 — 카드를 떠나지 않고 개발자에게 간다(`comments.reply` · `repo.note`). */
export function ReplyBox({
  placeholder,
  onSend,
  onSent,
}: {
  /** 입력칸의 지시문 — 답하기는 `…님에게 답하기`, 한마디 더는 그 자리의 말. */
  placeholder: string;
  onSend: (text: string) => Promise<void>;
  onSent: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // 접근 이름은 고정으로 — placeholder 는 답할 사람에 따라 바뀌어도 이름이
  // 흔들리지 않게 하고, 바뀌는 자리 표시는 힌트로 묶는다(2026-10-04 ux-review).
  const hintId = useId();
  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onSend(text);
      setDraft("");
      onSent(text);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="nx-reply">
        <input
          // biome-ignore lint/a11y/noAutofocus: 답하기를 누른 손이 곧 쓸 자리다.
          autoFocus
          value={draft}
          placeholder={placeholder}
          aria-label={L.composer.noteToDev}
          aria-describedby={hintId}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (composing(event)) return;
            if (event.key === "Enter") {
              event.preventDefault();
              void send();
            }
          }}
        />
        <span id={hintId} className="nx-sr">
          {placeholder}
        </span>
        <button
          type="button"
          className="nx-btn nx-btn--sm nx-btn--pri"
          disabled={busy || draft.trim() === ""}
          onClick={() => void send()}
        >
          {L.cards.replySend}
        </button>
      </div>
      {failed && <div className="nx-reply-sent nx-tone--red">{L.chat.sendFailed}</div>}
    </>
  );
}

/**
 * 개발자 코멘트 카드(U14) — 사람 · 글 · 상태(`AI가 반영하는 중` → `반영해 같은
 * 요청에 다시 제출했어요`) · `답하기`. 코멘트는 AI 가 바로 반영한다(L9) — 카드는
 * 할 일을 만들지 않고 알린다. 화면 이름은 선로가 아직 싣지 않아 비운다.
 */
export function ReviewCard({
  author,
  at,
  texts,
  replyId,
  fixing,
  body = "",
  onReply,
  onToast,
}: {
  author: string;
  at: string | null;
  texts: Array<{ key: string; text: string }>;
  /** 답하기가 갈 스레드 — 없으면 답하기 없이 읽는 자리. */
  replyId: number | null;
  fixing: boolean;
  /** AI 가 받은 글(반영 턴) — 있으면 한 겹 접혀 선다. */
  body?: string;
  onReply: (id: number, text: string) => Promise<void>;
  onToast: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<Array<{ key: number; text: string }>>([]);
  const name = author.trim() || L.chat.reviewAuthor;
  return (
    <div className="nx-card nx-card--review">
      <div className="nx-ch">
        <span className="nx-avt">{name.slice(0, 1)}</span>
        <b>{name}</b>
        <span className="nx-muted">{L.cards.developer}</span>
        {at && <span className="nx-time">{clockOf(at)}</span>}
      </div>
      {texts.map((row) => (
        <div key={row.key} className="nx-ctext">
          {row.text}
        </div>
      ))}
      <div className="nx-cfoot">
        <Stat done={!fixing} doneText={L.cards.reviewDone} runText={L.cards.reviewFixing} />
        <span className="nx-grow" />
        {replyId !== null && (
          <button type="button" className="nx-btn nx-btn--sm" onClick={() => setOpen((v) => !v)}>
            {L.cards.reply}
          </button>
        )}
      </div>
      {replies.map((row) => (
        <div key={row.key} className="nx-reply-sent">
          <CheckIcon />
          <span>{L.cards.replyMine(row.text)}</span>
        </div>
      ))}
      <Received body={body} />
      {open && replyId !== null && (
        <ReplyBox
          placeholder={L.cards.replyTo(name)}
          onSend={(text) => onReply(replyId, text)}
          onSent={(text) => {
            setReplies((prev) => [...prev, { key: prev.length, text }]);
            setOpen(false);
            onToast(L.cards.replyToast(name));
          }}
        />
      )}
    </div>
  );
}

/** 코멘트 도착 블록(`review.arrived`)을 카드의 재료로. */
export function reviewParts(reviews: DeveloperReview[]): {
  author: string;
  at: string | null;
  texts: Array<{ key: string; text: string }>;
  replyId: number | null;
} {
  const first = reviews[0];
  // 리뷰 본문이 먼저, 줄마다 단 코멘트가 뒤 — 옛 대화록과 같은 차례.
  const ordered = [
    ...reviews.filter((review) => review.kind === "review"),
    ...reviews.filter((review) => review.kind === "inline"),
  ].filter((review) => review.body.trim() !== "");
  return {
    author: first?.author ?? "",
    at: first?.at ?? null,
    texts:
      ordered.length > 0
        ? ordered.map((review) => ({ key: String(review.id), text: review.body }))
        : [{ key: "empty", text: L.chat.reviewText }],
    replyId: first?.id ?? null,
  };
}

/**
 * 제출 영수증(U3 · E5) — `개발자에게 제출했어요`(같은 요청에 더했으면 그 말) ·
 * 받을 개발자 · 내 한마디 · `제출한 내용 열기`. 요청이 아직 열려 있으면
 * `한마디 더` 상자가 같은 발 밑에 선다(U20): 잘못 보냈거나 덧붙일 말을
 * 대화를 떠나지 않고 개발자에게 남긴다.
 */
export function ReceiptCard({
  block,
  more,
  handoff,
  onNote,
  onToast,
}: {
  block: Extract<Block, { type: "milestone" }>;
  more: boolean;
  handoff: RepoStatus["handoff"];
  onNote: (text: string) => Promise<void>;
  onToast: (text: string) => void;
}) {
  const same = handoff && handoff.number === block.pr ? handoff : null;
  const reviewers = same?.reviewers?.length
    ? same.reviewers
    : block.reviewer
      ? [block.reviewer]
      : [];
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteSentAt, setNoteSentAt] = useState<string | null>(null);
  const noteOk = noteAllowed(block, handoff);
  return (
    <div className="nx-card nx-card--receipt">
      <div className="nx-ch">
        <span className="nx-okc">
          <CheckIcon />
        </span>
        <b>{more ? L.cards.receiptMore : L.cards.receiptFirst}</b>
        <span className="nx-time">{clockOf(block.at)}</span>
      </div>
      {(reviewers.length > 0 || block.note) && (
        <div className="nx-cs">
          {reviewers.length > 0 && (
            <div>
              {L.cards.receiptReviewers(reviewers.length)} · {reviewers.join(" · ")}
            </div>
          )}
          {block.note && <div>{L.cards.receiptNote(block.note)}</div>}
        </div>
      )}
      {(same?.url || noteOk) && (
        <div className="nx-cfoot">
          {same?.url && (
            <a
              className="nx-btn nx-btn--sm"
              href={same.url}
              target="_blank"
              rel="noreferrer"
              onClick={linkClick}
            >
              {L.vocab.openSubmitted}
              <ExtIcon />
            </a>
          )}
          {noteOk && (
            <button
              type="button"
              className="nx-btn nx-btn--sm"
              onClick={() => setNoteOpen((open) => !open)}
            >
              {L.cards.noteMore}
            </button>
          )}
        </div>
      )}
      {noteOpen && noteOk && (
        <ReplyBox
          placeholder={L.cards.notePlaceholder}
          onSend={onNote}
          onSent={() => {
            const time = clockOf(Date.now());
            setNoteSentAt(time);
            setNoteOpen(false);
            onToast(L.cards.noteSent(time));
          }}
        />
      )}
      {noteSentAt && (
        <div className="nx-reply-sent">
          <CheckIcon />
          <span>{L.cards.noteSent(noteSentAt)}</span>
        </div>
      )}
    </div>
  );
}

type RepoCommands = NonNullable<RepoStatus["commands"]>;

/**
 * 확인 카드가 나타났다는 공지 — 마운트 한 번만 말한다(2026-10-06 겹판 조사). 카드 전체가 `alert` 이면
 * 안의 어떤 변화(도는 표시 · 실패 줄)에도 카드가 통째로 다시 읽히고, 안의 실패 줄(`alert`)과 공지가
 * 서로 경쟁했다. 카드는 이름 있는 묶음(`group`)이고 공지는 이 한 줄이 맡는다.
 */
function Announce({ text }: { text: string }) {
  return (
    <span className="nx-sr" role="alert">
      {text}
    </span>
  );
}

/**
 * 확인 카드 — AI 가 물어보거나(질문) 무엇을 해도 되는지 묻는다(허용). 질문이 하나
 * · 고르기 하나면 누르는 순간 답이 간다(목업 `card.ask`); 여럿이면 다 고른 뒤
 * 보낸다. 어느 질문이든 `직접 답하기` 로 자기 말을 쓸 수 있다.
 */
export function AskCard({
  request,
  commands,
  onQuestion,
  onPermission,
}: {
  request: PendingQuestion | PendingPermission;
  commands?: RepoCommands;
  /** 답을 보내는 길 — 전하지 못하면 거절로 돌아와 옵션이 다시 눌리는 자리가 된다. */
  onQuestion: (answers: Record<string, string | string[]>) => void | Promise<void>;
  onPermission: (decision: "allow" | "deny") => void | Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [free, setFree] = useState<Record<string, string>>({});
  const [freeOpen, setFreeOpen] = useState<Record<string, boolean>>({});
  const [sent, setSent] = useState(false);
  // 전하지 못했음을 카드 안에서 말한다 — 조용히 되돌려 다시 눌리는 자리만
  // 남기면 실패가 통하지 않은 채로 끝난다(2026-10-04 ux-review).
  const [sendFailed, setSendFailed] = useState(false);
  /** 보내는 중인 버튼 — 누른 버튼만 고른 모양과 작은 도는 표시를 입는다. */
  const [pressed, setPressed] = useState<string | null>(null);
  const titleId = useId();
  const needId = useId();
  const dispatch = (mark: string, call: () => unknown) => {
    if (sent) return;
    setSent(true);
    setSendFailed(false);
    setPressed(mark);
    void Promise.resolve()
      .then(call)
      .catch(() => {
        setSent(false);
        setPressed(null);
        setSendFailed(true);
      });
  };

  if (request.kind === "permission") {
    // 레포가 정한 명령은 이름으로(`레포 검사`) — 날 명령줄은 보이지 않는다(홈 인박스와 같은 판정).
    const raw = (() => {
      if (request.toolName === "Bash") {
        const input = request.input as { command?: unknown } | null;
        const line = typeof input?.command === "string" ? input.command.trim() : "";
        const named = bashHeadline(line, commands);
        if (line && named !== line) return named;
      }
      return toolLabel(request.toolName);
    })();
    return (
      // biome-ignore lint/a11y/useSemanticElements: 카드는 제목으로 이름 붙은 묶음이다 — fieldset 의 테두리 · legend 틀이 필요 없는 자리라 group 으로 읽힌다.
      <div className="nx-card nx-card--ask" role="group" aria-labelledby={titleId}>
        <Announce text={`${L.cards.askTitle} ${L.inbox.askPermission(raw)}`} />
        <div className="nx-ch">
          <SparkIcon />
          <b id={titleId}>{L.cards.askTitle}</b>
        </div>
        <div className="nx-ctext">{L.inbox.askPermission(raw)}</div>
        <div className="nx-opts">
          <button
            type="button"
            className={`nx-btn nx-btn--pri${pressed === "allow" ? " nx-btn--picked" : ""}`}
            disabled={sent}
            onClick={() => dispatch("allow", () => onPermission("allow"))}
          >
            {L.inbox.allow}
            {pressed === "allow" && <i className="nx-spin" aria-hidden="true" />}
          </button>
          <button
            type="button"
            className={`nx-btn${pressed === "deny" ? " nx-btn--picked" : ""}`}
            disabled={sent}
            onClick={() => dispatch("deny", () => onPermission("deny"))}
          >
            {L.inbox.deny}
            {pressed === "deny" && <i className="nx-spin" aria-hidden="true" />}
          </button>
        </div>
        {sendFailed && (
          /* 실패는 alert — 카드는 더 이상 alert 가 아니니 공지가 겹치지 않는다(`Announce`). */
          <div className="nx-cs nx-tone--red" role="alert">
            {L.chat.sendFailed}
          </div>
        )}
      </div>
    );
  }

  const questions = request.questions;
  const single = questions.length === 1 && !questions[0]?.multiSelect;
  const picked = (q: AskQuestion, label: string) => {
    const value = answers[q.question];
    return Array.isArray(value) ? value.includes(label) : value === label;
  };
  const merged = (): Record<string, string | string[]> => {
    const out = { ...answers };
    for (const [question, text] of Object.entries(free))
      if (text.trim()) out[question] = text.trim();
    return out;
  };
  const complete = questions.every((q) => {
    const value = merged()[q.question];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
  const send = (out: Record<string, string | string[]>, mark: string) => {
    dispatch(mark, () => onQuestion(out));
  };
  const pick = (q: AskQuestion, label: string) => {
    if (single) {
      // 눌림은 먼저 선다 — 고른 것이 곧 보이고, 전하지 못했으면 조용히 풀린다.
      setAnswers((prev) => ({ ...prev, [q.question]: label }));
      send({ [q.question]: label }, label);
      return;
    }
    setAnswers((prev) => {
      if (!q.multiSelect) return { ...prev, [q.question]: label };
      const current = prev[q.question];
      const list = Array.isArray(current) ? current : current ? [current] : [];
      return {
        ...prev,
        [q.question]: list.includes(label) ? list.filter((l) => l !== label) : [...list, label],
      };
    });
  };

  // 선택지에 AI 가 쓴 설명이 딸려 있으면 툴팁이 아니라 라벨 아래에 보인다 — 고를 근거가 숨지 않게.
  const described = (q: AskQuestion) => q.options.some((option) => option.description);
  // 고른 개수 — 여럿 고르기에서만 센다. 직접 쓴 말이 있으면 그 말이 답이 되니 센 수를 말하지 않는다.
  const countOf = (q: AskQuestion): number => {
    const value = answers[q.question];
    return q.multiSelect && Array.isArray(value) && !(free[q.question] ?? "").trim()
      ? value.length
      : 0;
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: 카드는 제목으로 이름 붙은 묶음이다 — fieldset 의 테두리 · legend 틀이 필요 없는 자리라 group 으로 읽힌다.
    <div className="nx-card nx-card--ask" role="group" aria-labelledby={titleId}>
      <Announce text={`${L.cards.askTitle} ${questions.map((q) => q.question).join(" ")}`} />
      <div className="nx-ch">
        <SparkIcon />
        <b id={titleId}>{L.cards.askTitle}</b>
      </div>
      {questions.map((q, index) => {
        const count = countOf(q);
        const asked = `${titleId}-q${index}`;
        return (
          <div key={q.question} className="nx-ask-q">
            <div id={asked} className="nx-ctext">
              {q.question}
            </div>
            {/* biome-ignore lint/a11y/useSemanticElements: 질문 한 줄과 그 선택지의 묶음 — fieldset 의 테두리 · legend 틀이 필요 없는 자리라 group 으로 읽힌다. */}
            <div
              role="group"
              aria-labelledby={asked}
              className={`nx-opts${described(q) ? " nx-opts--described" : ""}`}
            >
              {q.options.map((option) => {
                const on = picked(q, option.label);
                return (
                  <button
                    key={option.label}
                    type="button"
                    className={`nx-btn${described(q) ? " nx-btn--opt" : ""}`}
                    // 고른 상태는 색만으로 말하지 않는다 — 눌림 상태(낭독)와 체크(눈)가 함께 선다.
                    aria-pressed={on}
                    disabled={sent}
                    onClick={() => pick(q, option.label)}
                  >
                    {described(q) ? (
                      <span className="nx-opt-t">
                        <b>{option.label}</b>
                        {option.description && <small>{option.description}</small>}
                      </span>
                    ) : (
                      option.label
                    )}
                    {pressed === option.label ? (
                      <i className="nx-spin" aria-hidden="true" />
                    ) : (
                      on && (
                        <span className="nx-opt-ck">
                          <CheckIcon />
                        </span>
                      )
                    )}
                  </button>
                );
              })}
              <button
                type="button"
                className="nx-btn nx-btn--ghost"
                aria-expanded={freeOpen[q.question] === true}
                disabled={sent}
                onClick={() => setFreeOpen((prev) => ({ ...prev, [q.question]: true }))}
              >
                {L.cards.askFree}
              </button>
            </div>
            {count > 0 && <p className="nx-snote nx-ask-count">{L.cards.pickedCount(count)}</p>}
            {freeOpen[q.question] && (
              <div className="nx-reply">
                <input
                  // biome-ignore lint/a11y/noAutofocus: 직접 답하기를 누른 손이 곧 쓸 자리다.
                  autoFocus
                  value={free[q.question] ?? ""}
                  placeholder={L.cards.askFree}
                  aria-label={L.cards.askFree}
                  onChange={(event) =>
                    setFree((prev) => ({ ...prev, [q.question]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (composing(event)) return;
                    if (event.key === "Enter" && single) {
                      event.preventDefault();
                      const text = (free[q.question] ?? "").trim();
                      if (text) send({ [q.question]: text }, `free:${q.question}`);
                    }
                  }}
                />
                {single && (
                  <button
                    type="button"
                    className={`nx-btn nx-btn--sm nx-btn--pri${
                      pressed === `free:${q.question}` ? " nx-btn--picked" : ""
                    }`}
                    disabled={sent || !(free[q.question] ?? "").trim()}
                    onClick={() =>
                      send({ [q.question]: (free[q.question] ?? "").trim() }, `free:${q.question}`)
                    }
                  >
                    {L.inbox.send}
                    {pressed === `free:${q.question}` && (
                      <i className="nx-spin" aria-hidden="true" />
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {!single && (
        <div className="nx-cfoot">
          {/* 잠긴 이유는 눈에도 한 줄로 서고 `aria-describedby` 로 묶인다. */}
          <button
            type="button"
            className="nx-btn nx-btn--sm nx-btn--pri"
            disabled={!complete || sent}
            aria-describedby={complete ? undefined : needId}
            onClick={() => send(merged(), "send")}
          >
            {L.inbox.send}
            {pressed === "send" && <i className="nx-spin" aria-hidden="true" />}
          </button>
          {!complete && (
            <span id={needId} className="nx-snote">
              {questions.length === 1 ? L.cards.needOne : L.cards.needAll}
            </span>
          )}
        </div>
      )}
      {sendFailed && (
        <div className="nx-cs nx-tone--red" role="alert">
          {L.chat.sendFailed}
        </div>
      )}
    </div>
  );
}

/**
 * AI 답 실패 카드 — `AI가 답을 못 했어요` · 이유 한 문장 · `다시 시도`(마지막
 * 실패만, 같은 말을 다시 보낸다). 스스로 다시 묻기를 다 쓴 실패(escalated)는
 * 앞에 `조금씩 기다리며 다섯 번 다시 물었어요` 줄이 선다(부르는 쪽).
 */
export function FailCard({
  why,
  notified,
  retry,
  live,
}: {
  why: string;
  notified: boolean;
  retry: (() => void) | null;
  live: boolean;
}) {
  const whyId = useId();
  return (
    <div className="nx-card nx-card--fail">
      <div className="nx-ch">
        <AlertIcon />
        <b>{L.cards.failTitle}</b>
      </div>
      <div className="nx-cs">
        {why}
        {notified && ` ${L.chat.failNotified}`}
      </div>
      {retry && (
        <div className="nx-cfoot">
          {/* 잠긴 이유를 title 에만 두지 않는다 — 눈에도 한 줄로 서고
              `aria-describedby` 로 묶인다(2026-10-04 ux-review). */}
          {live && (
            <span id={whyId} className="nx-fail-why" role="status">
              {L.chat.retryLive}
            </span>
          )}
          <button
            type="button"
            className="nx-btn nx-btn--sm nx-btn--pri"
            disabled={live}
            aria-describedby={live ? whyId : undefined}
            title={live ? L.chat.retryLive : undefined}
            onClick={retry}
          >
            {L.vocab.retry}
          </button>
        </div>
      )}
    </div>
  );
}
