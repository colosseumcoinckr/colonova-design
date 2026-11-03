import type {
  DraftConversationSummary,
  DraftMessage,
  DraftProposal,
  DraftReadRef,
  DraftRefInput,
} from "@colonova-design/protocol";
import { Ellipsis } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Markdown } from "../../../components/Markdown";
import type { Daemon } from "../../../lib/daemon-client";
import { timeAgo } from "../../../lib/format";
import { ModelChip } from "../../chat/ModelChip";
import { L } from "../../labels";
import { hasLeadSentence } from "../../lib/answer-lead";
import { offerMismatchToComposer, sendMismatchNow } from "../../lib/mismatch-model";
import type { ShellNav } from "../../slots";
import { CloseIcon, PlusIcon, SendIcon, SparkIcon, Spin } from "../../ui/icons";
import { MismatchCard } from "../../ui/MismatchCard";
import { Popover } from "../../ui/Popover";
import { escapeOwnedByLayer } from "../escape-layer";
import { type PlanListRow, planRows } from "../plans-list";
import { DRAFT_LIMITS } from "./limits";
import { takeAsk } from "./pending-ask";
import { parseRefSections, refChoices } from "./thread-model";
import type { DraftHand } from "./use-draft";
import { draftRefreshUsage, useDraftPick } from "./use-draft-pick";
import type { DraftThreadHand } from "./use-draft-thread";

/**
 * 기획 대화 칸(2026-10-31 기획서 칸 개선 — Claude 앱의 대화 칸) — 문서 판의 오른쪽에 늘 서 있는
 * 주인공 칸이다. AI 의 고침은 채택 없이 초안에 바로 들어가고(2026-10-31 사용자 결정 — 추천안 채택),
 * 대화에는 무엇이 들어갔는지의 문서 카드와 되돌리기만 선다. 대화는 문서를 옮겨 다닌다 — 머리의
 * 문서 고르기로 이 대화가 다룰 문서를 바꾼다. 이 컴퓨터의 말은 전부 `L.drafts` 이고, 클래스는
 * `nx-dr-*` 로만 산다.
 */

/** 근거 고르기 판 — 찾는 말로 문서를 걸러 고르고, 절 이름을 쉼표로 적어 담는다. 대화의 문서 옮기기도 같은 판을 쓴다. */
function RefPicker({
  daemon,
  onAdd,
  moveTo,
  onClose,
}: {
  daemon: Daemon;
  onAdd: (ref: DraftReadRef & { sections?: string[] }) => void;
  /** 문서 옮기기(2026-10-31 3단계) — 있으면 절 고르기가 없어지고 고른 문서로 대화를 옮긴다. */
  moveTo?: (pageId: string) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<PlanListRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<{ pageId: string; title: string; version: number } | null>(
    null,
  );
  const [sectionsText, setSectionsText] = useState("");
  // 절 이름의 한계 이유 — 절 수나 이름 길이가 선로의 상한을 넘으면 한 줄로 말하고 판은 그대로 선다.
  const [sectionNotice, setSectionNotice] = useState<string | null>(null);

  // `daemon` 은 렌더마다 새 겉모습이다 — 판을 여는 때 한 번만 읽는다(use-plans.ts 와 같은 이유).
  const apiRef = useRef(daemon.api);
  apiRef.current = daemon.api;
  useEffect(() => {
    let alive = true;
    apiRef.current
      .docList()
      .then((reply) => {
        if (!alive) return;
        setRows(planRows(reply.docs ?? [], reply.folders ?? [], reply.unsupported ?? []));
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const choices = useMemo(() => refChoices(rows ?? [], query), [rows, query]);

  const add = () => {
    if (picked === null) return;
    const parsed = parseRefSections(sectionsText);
    if ("error" in parsed) {
      setSectionNotice(parsed.error);
      return;
    }
    onAdd({
      pageId: picked.pageId,
      title: picked.title,
      version: picked.version,
      ...(parsed.sections.length > 0 ? { sections: parsed.sections } : {}),
    });
    setPicked(null);
    setSectionsText("");
    setSectionNotice(null);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: 찾기 · 고르기 · 절 이름을 한 판에 담는 자리라 fieldset 의 기본 꼴이 어울리지 않는다
    <div className="nx-dr-refpick" role="group" aria-label={L.drafts.addRef}>
      <div className="nx-dr-refpick-hd">
        <input
          className="nx-input nx-dr-line"
          value={query}
          placeholder={L.drafts.refSearchHint}
          aria-label={L.drafts.refSearchLabel}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" className="nx-btn nx-btn--sm nx-btn--ghost" onClick={onClose}>
          {L.drafts.editCancel}
        </button>
      </div>
      {failed ? (
        <p className="nx-dr-refnone" role="alert">
          {L.drafts.refLoadFailed}
        </p>
      ) : rows === null ? (
        <p className="nx-dr-refnone">
          <Spin /> {L.plans.reading}
        </p>
      ) : (
        <ul className="nx-dr-reflist">
          {choices.map((choice) => (
            <li key={choice.pageId}>
              <button
                type="button"
                className="nx-dr-refrow"
                aria-pressed={picked?.pageId === choice.pageId}
                aria-label={`${choice.title} · ${L.drafts.refMeta(choice.version, "")}`}
                onClick={() =>
                  setPicked((before) => (before?.pageId === choice.pageId ? null : choice))
                }
              >
                <span className="nx-dr-refrow-t">{choice.title}</span>
                <span className="nx-dr-refrow-m">{L.drafts.refMeta(choice.version, "")}</span>
              </button>
            </li>
          ))}
          {choices.length === 0 && <li className="nx-dr-refnone">{L.drafts.refNone}</li>}
        </ul>
      )}
      {picked !== null && (
        <div className="nx-dr-refsec">
          {moveTo === undefined ? (
            <>
              <input
                className="nx-input nx-dr-line"
                value={sectionsText}
                placeholder={L.drafts.refSectionsHint}
                aria-label={L.drafts.refSectionsLabel}
                onChange={(event) => {
                  setSectionsText(event.target.value);
                  setSectionNotice(null);
                }}
              />
              <button type="button" className="nx-btn nx-btn--sm" onClick={add}>
                {L.drafts.refAdd}
              </button>
              {sectionNotice !== null && <p className="nx-dr-limit">{sectionNotice}</p>}
            </>
          ) : (
            <button
              type="button"
              className="nx-btn nx-btn--sm"
              onClick={() => {
                moveTo(picked.pageId);
                setPicked(null);
              }}
            >
              {L.drafts.convMoveHere}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 바로 반영의 문서 카드(2026-10-31 2단계) — 무엇이 초안에 들어갔는지와 되돌리기만 선다. */
function DocCard({
  proposal,
  busy,
  onShowInDoc,
  onUndo,
}: {
  proposal: DraftProposal;
  busy: boolean;
  onShowInDoc: (blockIds: string[]) => void;
  onUndo: (proposalId: string) => void;
}) {
  const applied = proposal.appliedAt !== undefined;
  const undone = proposal.ops.every((op) => op.state === "rejected") && !proposal.undoable;
  const changed = proposal.appliedOps ?? 0;
  const touchedBlocks = useMemo(
    () =>
      proposal.ops
        .filter((op) => op.state === "adopted")
        .map((op) => (op.type === "replace" || op.type === "delete" ? op.blockId : null))
        .filter((id): id is string => id !== null),
    [proposal],
  );
  // 남은 고침의 블록(2026-11-02 D9) — 사람이 고치던 블록에 남은 걸음(stale) 이 겨눈 자리.
  // 문서 판의 남은 걸음 띠가 replace · delete 만 겨누므로(DraftEditor keptStepOf 와 같은 판정) 여기도 그 둘만.
  const keptBlocks = useMemo(
    () =>
      proposal.ops
        .filter((op) => op.state === "stale")
        .map((op) => (op.type === "replace" || op.type === "delete" ? op.blockId : null))
        .filter((id): id is string => id !== null),
    [proposal],
  );
  const kept = proposal.keptOps ?? 0;
  return (
    <article
      className="nx-dr-doccard"
      data-state={undone ? "undone" : applied ? "applied" : "stale"}
    >
      <p className="nx-dr-doccard-h">
        {undone ? L.drafts.appliedUndone : applied ? L.drafts.appliedCard : proposal.summary}
        {applied && !undone && changed > 0 && (
          <span className="nx-dr-doccard-n">{L.drafts.appliedOps(changed)}</span>
        )}
        {applied && !undone && kept > 0 && (
          <button
            type="button"
            className="nx-pill nx-pill--amber nx-dr-doccard-kept"
            title={L.drafts.appliedKeptHint}
            onClick={() => onShowInDoc(keptBlocks)}
          >
            {L.drafts.appliedKept(kept)}
          </button>
        )}
      </p>
      {applied && !undone && proposal.summary !== "" && (
        <p className="nx-dr-doccard-sum" title={proposal.summary}>
          {proposal.summary}
        </p>
      )}
      {!applied && !undone && <p className="nx-dr-doccard-note">{L.drafts.opStale}</p>}
      {applied && !undone && (
        <div className="nx-dr-doccard-acts">
          <button
            type="button"
            className="nx-btn nx-btn--sm"
            onClick={() => onShowInDoc(touchedBlocks)}
          >
            {L.drafts.viewInDoc}
          </button>
          {proposal.undoable === true && (
            <button
              type="button"
              className="nx-btn nx-btn--sm nx-btn--ghost"
              disabled={busy}
              title={L.drafts.undoHint}
              onClick={() => onUndo(proposal.proposalId)}
            >
              {L.drafts.revert}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

/** 대화의 말 한 편 — 사람의 말(고쳐 보내기)과 AI 의 설명 · 읽은 문서 · 오류 · 문서 카드.
 *  AI 의 말은 화면 대화와 같은 닻을 단다(2026-11-02 D2) — 스파크 얼굴과 몸의 두 칸, 첫 문장이
 *  살짝 크다. 닻의 얼굴은 연속한 AI 말에서 첫 말에만 선다(first). */
function MessageRow({
  message,
  proposal,
  busy,
  first,
  last,
  onShowInDoc,
  onUndo,
  onFill,
  mismatchDoc,
}: {
  message: DraftMessage;
  proposal: DraftProposal | null;
  busy: boolean;
  /** 연속한 AI 말의 첫 말 — 스파크 얼굴이 이 말에만 선다. */
  first?: boolean;
  /** 대화의 마지막 말 — 손이 hover 없이도 늘 보인다(2026-11-02 D4). */
  last?: boolean;
  onShowInDoc: (blockIds: string[]) => void;
  onUndo: (proposalId: string) => void;
  /** 내 말을 고쳐 보낸다 · AI 말을 다시 요청한다 — 입력 칸에 말을 채운다(앞의 기록은 남는다). */
  onFill: (text: string) => void;
  /** 화면 제안 카드(C8)의 손이 쓸 문서 — 데몬 · 이동 · 문서 이름. */
  mismatchDoc: {
    daemon: Daemon;
    nav: ShellNav;
    docTitle: string;
    pageId: string | null;
    docKey: string | null;
  };
}) {
  const [copied, setCopied] = useState(false);
  // 판정 실패의 다시 시도(2026-11-03 A안 1A-2) — 돌고 실패 여부는 이 답 아래에만 둔다.
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const at = timeAgo(Date.parse(message.at));
  if (message.role === "user") {
    return (
      <div className="nx-dr-msg" data-role="user" data-last={last || undefined}>
        {/* 화면 요청에서 온 말(2026-10-30 같이 고치기) — 사람이 이 칸에 쓴 말과 가른다. */}
        {message.origin === "screen" && <p className="nx-dr-msg-origin">{L.drafts.fromScreen}</p>}
        <p className="nx-dr-msg-text">{message.text}</p>
        {(message.refs?.length ?? 0) > 0 && (
          <ul className="nx-dr-refchips">
            {(message.refs ?? []).map((ref) => (
              <li key={ref.pageId} className="nx-dr-refchip">
                {L.drafts.refChip(ref.title, ref.version, ref.sections)}
              </li>
            ))}
          </ul>
        )}
        {at !== "" && <p className="nx-dr-msg-at">{at}</p>}
        <div className="nx-dr-msg-acts">
          <button
            type="button"
            className="nx-btn nx-btn--xs nx-btn--ghost"
            onClick={() => onFill(message.text)}
          >
            {L.drafts.editResend}
          </button>
        </div>
      </div>
    );
  }
  const lead = message.text !== "" && hasLeadSentence(message.text);
  return (
    <div
      className="nx-dr-msg"
      data-role="ai"
      data-lead={lead || undefined}
      data-last={last || undefined}
    >
      <div className="nx-av" data-spark={first ? "on" : "off"} aria-hidden="true">
        {first && (
          <span className="nx-av-spark">
            <SparkIcon />
          </span>
        )}
      </div>
      <div className="nx-dr-msg-body">
        {message.text !== "" && (
          <div className="nx-dr-msg-md">
            <Markdown text={message.text} />
          </div>
        )}
        {(message.reads?.length ?? 0) > 0 && (
          <p className="nx-dr-msg-reads">{L.drafts.readBy((message.reads ?? []).length)}</p>
        )}
        {message.error !== undefined && (
          <p className="nx-dr-msg-err" role="alert">
            {message.error === "" ? L.drafts.aiFailed : `${L.drafts.aiFailed} — ${message.error}`}
          </p>
        )}
        {/* 화면 제안 카드(2026-11-02 · 같이 고치기 UX 계획 C8) — 정책을 바꾼 고침 뒤 화면이 옛 규칙이면 답 아래에
            선다. 손은 둘뿐이다 — 되돌리기는 판에 이미 있어 `기획서를 화면대로` 는 세우지 않는다(같은 계획 §3). */}
        {message.mismatch !== undefined && message.mismatch.rows.length > 0 && (
          <MismatchCard
            title={mismatchDoc.docTitle}
            rows={message.mismatch.rows}
            hand={{
              send: (row) =>
                sendMismatchNow({
                  api: mismatchDoc.daemon.api,
                  brief: L.compare.sendBrief(row, mismatchDoc.docTitle),
                  target:
                    mismatchDoc.pageId !== null
                      ? { pageId: mismatchDoc.pageId }
                      : { docKey: mismatchDoc.docKey ?? "" },
                }).then((result) => {
                  if (result === false) throw new Error("composer away");
                  mismatchDoc.nav.showTab("chat");
                  mismatchDoc.nav.toast(
                    result === "sent" ? L.compare.sentNowToast : L.compare.sentToast,
                  );
                }),
              sendEdit: (row) =>
                offerMismatchToComposer({
                  api: mismatchDoc.daemon.api,
                  brief: L.compare.sendBrief(row, mismatchDoc.docTitle),
                  target:
                    mismatchDoc.pageId !== null
                      ? { pageId: mismatchDoc.pageId }
                      : { docKey: mismatchDoc.docKey ?? "" },
                }).then((taken) => {
                  if (!taken) throw new Error("composer away");
                  mismatchDoc.nav.showTab("chat");
                  mismatchDoc.nav.toast(L.compare.sentToast);
                }),
              decline: (row) =>
                mismatchDoc.pageId === null
                  ? Promise.resolve()
                  : mismatchDoc.daemon.api
                      .draftCompareDecline(mismatchDoc.pageId, row.screenName)
                      .then(() => undefined),
            }}
          />
        )}
        {/* 판정 실패 알림(2026-11-03 A안 1A-2 — 조용한 실패 알림) — 화면 제안의 판정이 실패한 답 아래에
            실패 한 줄과 `다시 시도` 가 선다. 다시 시도가 카드를 세우거나 같다고 판정하면 이 표시는 걷힌다. */}
        {message.mismatchFailed === true && (
          <>
            <p className="nx-dr-msg-err" role="alert">
              {L.compare.judgeFailed}
            </p>
            <div className="nx-dr-msg-acts">
              <button
                type="button"
                className="nx-btn nx-btn--xs nx-btn--ghost"
                disabled={busy || retrying || mismatchDoc.docKey === null}
                onClick={() => {
                  if (mismatchDoc.docKey === null) return;
                  setRetryFailed(false);
                  setRetrying(true);
                  mismatchDoc.daemon.api
                    .draftMismatchRetry(mismatchDoc.docKey, message.messageId)
                    .catch(() => {
                      setRetryFailed(true);
                    })
                    .finally(() => setRetrying(false));
                }}
              >
                {retrying ? <Spin /> : null}
                {L.compare.retry}
              </button>
            </div>
            {retryFailed && (
              <p className="nx-dr-msg-err" role="alert">
                {L.compare.retryFailed}
              </p>
            )}
          </>
        )}
        {at !== "" && <p className="nx-dr-msg-at">{at}</p>}
        {message.text !== "" && (
          <div className="nx-dr-msg-acts">
            <button
              type="button"
              className="nx-btn nx-btn--xs nx-btn--ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(message.text).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1_600);
                });
              }}
            >
              {copied ? L.drafts.copied : L.drafts.copyText}
            </button>
            <button
              type="button"
              className="nx-btn nx-btn--xs nx-btn--ghost"
              onClick={() => {
                // 다시 요청 — 근거는 이 말의 앞 사람 메시지에서 찾지 않고 비운 채 둔다(말만 다시 쓴다).
                onFill(L.drafts.reaskPrompt);
              }}
            >
              {L.drafts.reask}
            </button>
          </div>
        )}
        {proposal !== null && (
          <DocCard proposal={proposal} busy={busy} onShowInDoc={onShowInDoc} onUndo={onUndo} />
        )}
      </div>
    </div>
  );
}

/** 비어 있는 대화의 시작 문장 — 누르면 입력 칸에 채운다(Claude 앱의 시작 화면과 같은 모양). */
function Starters({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="nx-dr-starters">
      <p className="nx-dr-starters-h">{L.drafts.startersHead}</p>
      <div className="nx-dr-starters-list">
        {[L.drafts.starter1, L.drafts.starter2, L.drafts.starter3].map((text) => (
          <button key={text} type="button" className="nx-dr-starter" onClick={() => onPick(text)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 기획 대화 칸 — 문서 판의 오른쪽에 늘 선다. 대화의 판(thread)은 칸이 아니라 위(PlansColumn)가
 * 쥐므로 문서 판의 남은 걸음 · 바로 반영의 표시와 같은 판을 본다.
 */
export function PlanChat({
  daemon,
  nav,
  docKey,
  pageId,
  onStartDraft,
  docTitle,
  thread,
  draft,
  inputRef,
  conversation,
  pickedThreadId,
  pickThread,
  onShowInDoc,
  onConversationsChanged,
}: {
  daemon: Daemon;
  nav: ShellNav;
  /** 지금 다루는 문서의 초안 열쇠 — 아직 초안이 없는 문서면 null 이다(보내면 열린다). */
  docKey: string | null;
  /** 읽는 문서의 페이지 id — 초안이 없을 때의 첫 말이 이 문서의 초안을 연다(2026-10-30). */
  pageId?: string;
  /** 읽는 문서에서 보낸 첫 말 — 초안을 열고 말을 건네는 손(칸의 고치기와 같은 길). */
  onStartDraft?: (pageId: string, text: string) => void;
  docTitle: string;
  thread: DraftThreadHand;
  /** 초안의 판 — 있으면 남은 걸음의 채택이 이 판의 개정을 쓴다. */
  draft: DraftHand | null;
  /** 편집기의 빈 화면이 초점을 옮기는 입력 칸. */
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  /** 사이드바의 기획 대화 목록 줄 — 머리의 문서 고르기가 쓴다. */
  conversation: DraftConversationSummary | null;
  /** 사이드바 목록에서 골른 대화(2026-11-03) — 바뀔 때 `새 기획 대화` 표식을 거둔다. */
  pickedThreadId: string | null;
  /** 골른 대화를 거두는 손(2026-11-03) — 새 대화로 보내는 말이 옛 고름 뒤에 묻히지 않게. */
  pickThread: (threadId: string | null) => void;
  /** 문서 카드의 `문서에서 보기` — 문서 판이 그 블록을 칠한다. */
  onShowInDoc: (blockIds: string[]) => void;
  /** 대화 목록을 다시 읽게 한다 — 물기 · 옮기기 · 지우기 뒤에. */
  onConversationsChanged: () => void;
}) {
  // 기획 AI 의 모델 · 생각 시간 칩의 주인(2026-10-26 사용자 요청) — 화면 대화와 같은 부품, 다른 주인.
  const chip = useDraftPick(daemon);
  const [pendingRefs, setPendingRefs] = useState<Array<DraftReadRef & { sections?: string[] }>>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  // 근거 고르기 팝의 닻(2026-11-02 D8) — `+ 근거 더하기` 단추에 붙어 뜬다.
  const addAnchor = useRef<HTMLButtonElement>(null);
  const [inputText, setInputText] = useState("");
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  // `새 기획 대화`(2026-10-31 3단계 · G) — 사이드바의 단추가 켠다. 다음 말은 붙은 대화를 이어 받지 않고 새 대화로 간다.
  const [fresh, setFresh] = useState(false);
  // 근거 수의 한계 이유 — 선로의 상한(문서 20개)에 닿아 더 담지 못할 때 한 줄로 말한다.
  const [refNotice, setRefNotice] = useState<string | null>(null);

  // 고쳐 보내기 · 다시 요청 · 시작 문장 — 입력 칸에 말을 채우고 초점을 옮긴다(앞의 기록은 남는다).
  const fillInput = (text: string) => {
    setInputText(text);
    inputRef.current?.focus();
  };

  // 고른 글 붙이기(2026-10-31 4단계) — 문서 판의 `AI 에게 묻기` 가 채우는 칩이다.
  useEffect(() => {
    const onSelection = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: unknown }>).detail;
      if (typeof detail?.text !== "string" || detail.text === "") return;
      setSelection(detail.text);
      inputRef.current?.focus();
    };
    window.addEventListener("nx:plan-selection", onSelection);
    return () => window.removeEventListener("nx:plan-selection", onSelection);
  }, [inputRef]);

  // 빈 초안의 `AI 와 시작하기`(2026-10-23 · F1) — 문서 판의 단추가 이 입력 칸으로 초점을 옮긴다.
  useEffect(() => {
    const onFocus = () => inputRef.current?.focus();
    window.addEventListener("nx:plan-focus-input", onFocus);
    return () => window.removeEventListener("nx:plan-focus-input", onFocus);
  }, [inputRef]);

  // 발행 뒤의 카드(2026-10-31 F) — 문서 판의 발행이 대화에 `Confluence 판 N 로 발행했어요` 로 남는다.
  const [published, setPublished] = useState<{ docKey: string; version: number } | null>(null);
  useEffect(() => {
    const onPublished = (event: Event) => {
      const detail = (event as CustomEvent<{ docKey?: string; version?: number }>).detail;
      if (typeof detail?.docKey !== "string" || typeof detail.version !== "number") return;
      if (detail.docKey !== docKey) return;
      setPublished({ docKey: detail.docKey, version: detail.version });
      thread.reload();
    };
    window.addEventListener("nx:plan-published", onPublished);
    return () => window.removeEventListener("nx:plan-published", onPublished);
  }, [docKey, thread]);

  // 사이드바의 `새 기획 대화`(2026-10-31 3단계) — 다음 말이 새 대화로 간다.
  useEffect(() => {
    const onNew = () => {
      setFresh(true);
      setInputText("");
      inputRef.current?.focus();
    };
    window.addEventListener("nx:plan-new", onNew);
    return () => window.removeEventListener("nx:plan-new", onNew);
  }, [inputRef]);

  // `새 기획 대화`의 표식은 자리가 바뀌면 흘려 보낸다(2026-11-03 수리) — 눌어 있으면 이어
  // 말하려던 대화가 새 대화로 갈라져 나왔다. 칸은 문서가 바뀌어도 마운트된 채라 표식이 눌어 있었다.
  // 사이드바 목록에서 다른 대화를 골랐을 때도 거둔다 — 줄을 눌러 온 사람은 그 대화를 이어 말하려는 것이다.
  const threadId = thread.thread?.threadId ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 자리(문서 · 대화 · 고름)가 바뀌는 것 자체가 이 효과의 몫이다.
  useEffect(() => {
    setFresh(false);
  }, [docKey, threadId, pickedThreadId]);

  /** 이어 말하기는 지금 보이는 대화로(2026-11-03) — 옛 대화를 골라 열어도 묵묵히 최신 대화로
   * 가지 않게. 판이 아직 못 읽었거나 열쇠가 어긋나면(문서가 바뀌는 중) 데몬의 문서 최신 대화에 맡긴다. */
  const shownThreadId =
    thread.thread !== null && thread.thread.docKey === docKey && thread.thread.threadId !== ""
      ? thread.thread.threadId
      : undefined;

  // 사이드바의 줄 `···` 로 대화를 지웠을 때(2026-11-03) — 지워진 것이 지금 열린 대화면 판이 제
  // 기록을 다시 읽어 빈 자리로 돌아간다. 남의 대화가 지워진 것은 이 칸의 일이 아니다.
  useEffect(() => {
    const onThreadGone = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail !== "string" || detail !== threadId) return;
      thread.reload();
    };
    window.addEventListener("nx:plan-thread-reload", onThreadGone);
    return () => window.removeEventListener("nx:plan-thread-reload", onThreadGone);
  }, [threadId, thread]);

  const proposals = useMemo(
    () => new Map((thread.thread?.proposals ?? []).map((one) => [one.proposalId, one])),
    [thread.thread],
  );

  // 읽는 문서의 대화 칸에서 맡긴 첫 말(2026-10-30) — 초안이 열려 대화를 읽고 나면 한 번 보낸다.
  // `새 기획 대화`의 표식도 여기서 존중한다(2026-11-03 수리) — 안 넘기면 붙은 대화를 묵묵히 이어 받았다.
  const { phase: threadPhase, running: threadRunning, ask: threadAsk } = thread;
  useEffect(() => {
    if (docKey === null || threadPhase !== "ready" || threadRunning) return;
    const waiting = takeAsk(docKey);
    if (waiting === null) return;
    // 새 대화로 보내는 말은 고름을 먼저 거둔다(2026-11-03) — 옛 대화를 골라 둔 채 새 말을
    // 보내면 판이 읽을 때마다 골른 대화로 돌아와 새 대화가 만들어지고도 묻히는 일이 생긴다.
    if (fresh) pickThread(null);
    void threadAsk(
      waiting,
      [],
      { model: chip.pick.model, effort: chip.pick.effort },
      fresh ? null : shownThreadId,
    ).then((ok) => {
      // 보내지 못했으면 입력 칸에 돌려 둔다 — 쓴 말을 잃지 않게. 표식은 성공에만 거둔다.
      if (ok) setFresh(false);
      else setInputText(waiting);
    });
  }, [
    docKey,
    threadPhase,
    threadRunning,
    threadAsk,
    chip.pick.model,
    chip.pick.effort,
    fresh,
    shownThreadId,
    pickThread,
  ]);

  const submit = (override?: string) => {
    const text = (override ?? inputText).trim();
    if (text === "" || thread.running) return;
    // 아직 초안이 없는 문서의 첫 말(2026-10-30) — 초안이 열리고 말이 건네진다.
    if (docKey === null) {
      if (pageId === undefined || onStartDraft === undefined) return;
      onStartDraft(pageId, text);
      setInputText("");
      setPendingRefs([]);
      return;
    }
    const refs: DraftRefInput[] = pendingRefs.map((ref) => {
      const sections = ref.sections?.filter((section) => section.trim() !== "");
      return sections !== undefined && sections.length > 0
        ? { pageId: ref.pageId, sections }
        : { pageId: ref.pageId };
    });
    // 새 대화로 보내는 말은 고름을 먼저 거둔다(2026-11-03) — 위 맡긴 첫 말과 같은 이유다.
    if (fresh) pickThread(null);
    void threadAsk(
      text,
      refs,
      { model: chip.pick.model, effort: chip.pick.effort },
      fresh ? null : shownThreadId,
    ).then((ok) => {
      if (!ok) return;
      setInputText("");
      setPendingRefs([]);
      setPickerOpen(false);
      setRefNotice(null);
      setSelection(null);
      setFresh(false);
      onConversationsChanged();
    });
  };

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // ⌘/Ctrl+Enter 로 보낸다 — 그냥 Enter 는 줄을 나눈다.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };

  // 입력창은 글에 맞춰 자란다(2026-11-02 D7) — 화면 대화의 입력창과 같은 규칙. 두 줄부터 여섯 줄쯤까지.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 글이 바뀔 때마다 높이를 다시 잡는다.
  useEffect(() => {
    const el = inputRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [inputText]);

  const addRef = (ref: DraftReadRef & { sections?: string[] }) => {
    // 이미 담은 문서는 다시 담지 않는다.
    if (pendingRefs.some((one) => one.pageId === ref.pageId)) {
      setPickerOpen(false);
      return;
    }
    if (pendingRefs.length >= DRAFT_LIMITS.refCount) {
      setRefNotice(L.drafts.limitRefCount);
      return;
    }
    setRefNotice(null);
    setPendingRefs([...pendingRefs, ref]);
    setPickerOpen(false);
  };

  // 바로 반영의 되돌리기 — 성패와 무관하게 초안과 대화를 다시 읽는다.
  const undo = (proposalId: string) => {
    if (busy || docKey === null) return;
    setBusy(true);
    void daemon.api
      .draftUndo(docKey, proposalId)
      .then((result) => {
        nav.toast(L.drafts.undoDone(result.restored, result.kept));
      })
      .catch((err: unknown) => {
        nav.toast(err instanceof Error ? err.message : L.drafts.undoFailed);
      })
      .finally(() => {
        setBusy(false);
        thread.reload();
        draft?.reload();
      });
  };

  // 대화의 말 — 기록이 따로 구르는 넓은 칸에서는 새 말 · 도는 글이 오면 바닥을 따라간다. 바닥에서
  // 떠나 올려 읽는 동안에는 `맨 아래로` 가 뜨고, 그 사이 새 글이 오면 `새 내용` 이 된다(2026-11-02 D5 —
  // 화면 대화와 같은 부품).
  const messages = thread.thread?.messages ?? [];
  const logRef = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const [unpinned, setUnpinned] = useState(false);
  const [hasNew, setHasNew] = useState(false);
  const onLogScroll = () => {
    const log = logRef.current;
    if (log === null) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    stick.current = atBottom;
    if (atBottom) {
      setUnpinned(false);
      setHasNew(false);
    } else {
      setUnpinned(true);
    }
  };
  const toBottom = () => {
    const log = logRef.current;
    if (log === null) return;
    stick.current = true;
    setUnpinned(false);
    setHasNew(false);
    log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: 말 수 · 도는 글이 바뀔 때만 따라간다
  useEffect(() => {
    const log = logRef.current;
    if (log === null) return;
    if (stick.current) {
      log.scrollTop = log.scrollHeight;
      return;
    }
    if (messages.length > 0 || thread.running) setHasNew(true);
  }, [messages.length, thread.running, thread.streamText]);

  // 대화 칸의 Esc — 근거 고르기 판이 열려 있으면 그것을 접고, 아니면 아무것도 닫지 않고 제 자리에서
  // 멈춘다(칸 · 편집기의 Esc 가 물러서게). 치던 글은 남는다(2026-10-23 화면 확인 · R2 검토 8).
  const onColumnKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (event.nativeEvent.isComposing) return;
    if (escapeOwnedByLayer()) return;
    event.preventDefault();
    event.stopPropagation();
    if (pickerOpen) setPickerOpen(false);
  };

  const empty = messages.length === 0 && !thread.running;
  const hintId = useId();

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: 대화 칸의 Esc 는 제 자리에서 멈추는 길이다
    <aside
      className="nx-dr-thread nx-pl-chat"
      aria-label={L.drafts.threadTitle}
      onKeyDown={onColumnKey}
    >
      {/* 머리는 세 줄의 위계다(2026-11-02 D6) — 대화 제목과 ⋯ 메뉴 / 다루는 문서 / 이 AI 의 담당 한 줄. */}
      <header className="nx-dr-thread-hd">
        <div className="nx-dr-thread-top">
          <h3 className="nx-dr-thread-title">{conversation?.title ?? L.drafts.threadTitle}</h3>
          <button
            type="button"
            className="nx-ibtn nx-ibtn--sm"
            ref={menuAnchor}
            aria-expanded={menuOpen}
            aria-label={L.drafts.convMenu}
            title={L.drafts.convMenu}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((before) => !before)}
          >
            <Ellipsis className="nx-i" size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        <p className="nx-dr-thread-target" title={docTitle}>
          {docTitle}
        </p>
        <p className="nx-dr-thread-scope" title={L.drafts.threadScope} id={hintId}>
          {L.drafts.threadScope}
        </p>
        {menuOpen && (
          <Popover
            anchor={menuAnchor}
            role="menu"
            label={L.drafts.convMenu}
            align="end"
            float
            onClose={() => setMenuOpen(false)}
          >
            <button
              type="button"
              role="menuitem"
              className="nx-mi"
              disabled={conversation === null}
              title={L.drafts.convMoveHint}
              onClick={() => {
                setMenuOpen(false);
                if (conversation === null) return;
                // 문서 고르기 — 목록의 문서를 고르는 작은 판은 근거 고르기 판을 다시 쓴다.
                setMoveOpen(true);
              }}
            >
              {L.drafts.convOtherDoc}
            </button>
            {conversation !== null && (
              <button
                type="button"
                role="menuitem"
                className="nx-mi nx-mi--dng"
                onClick={() => {
                  setMenuOpen(false);
                  void daemon.api
                    .draftThreadDelete(conversation.threadId)
                    .then(() => {
                      onConversationsChanged();
                      thread.reload();
                    })
                    .catch((err: unknown) => {
                      nav.toast(err instanceof Error ? err.message : String(err));
                    });
                }}
              >
                {L.drafts.convDelete}
              </button>
            )}
          </Popover>
        )}
      </header>
      {/* 편집기가 초안을 여는 동안(첫 고치기 — 초안이 이제 생긴다)의 실패 문장은 누른다:
          문서로 여는 길(draft.open)이 초안을 만들고 방송하면 대화는 곧 읽힌다. 그 자리를
          실패 면이 앞질러 「열려 있는 초안이 없습니다」 를 번쩍이는 일을 막는다
          (2026-11-02 실사용 관찰 — 고치기 첫 진입에서 실패 문장이 열림 내내 남았다). */}
      {thread.phase === "failed" && draft?.phase !== "loading" ? (
        <p className="nx-banner nx-banner--red nx-dr-fail" role="alert">
          {thread.error ?? L.drafts.loadFailed}
          <button type="button" className="nx-btn nx-btn--sm" onClick={thread.retry}>
            {L.plans.retry}
          </button>
        </p>
      ) : (
        <>
          {thread.error !== null && draft?.phase !== "loading" && (
            <p className="nx-banner nx-banner--red nx-dr-fail" role="alert">
              {thread.error}
            </p>
          )}
          <div className="nx-dr-thread-log" ref={logRef} onScroll={onLogScroll}>
            {thread.phase === "loading" || draft?.phase === "loading" ? (
              <p className="nx-dr-thread-empty">
                <Spin /> {L.plans.reading}
              </p>
            ) : (
              <>
                {published !== null && (
                  <p className="nx-dr-doccard nx-dr-doccard--pub" role="status">
                    {L.drafts.publishedCard(published.version)}
                  </p>
                )}
                {messages.map((message, at) => (
                  <MessageRow
                    key={message.messageId}
                    message={message}
                    proposal={
                      message.proposalId === undefined
                        ? null
                        : (proposals.get(message.proposalId) ?? null)
                    }
                    busy={busy}
                    // 연속한 AI 말의 첫 말에만 스파크 얼굴이 선다 · 마지막 말의 손은 늘 보인다(2026-11-02 D2 · D4).
                    first={message.role === "assistant" && messages[at - 1]?.role !== "assistant"}
                    last={at === messages.length - 1}
                    onShowInDoc={onShowInDoc}
                    onUndo={undo}
                    onFill={fillInput}
                    mismatchDoc={{ daemon, nav, docTitle, pageId: pageId ?? null, docKey }}
                  />
                ))}
                {empty && <Starters onPick={(text) => setInputText(text)} />}
                {thread.running && (
                  <div className="nx-dr-msg nx-dr-turn nx-m-ai--live" data-role="ai">
                    {/* 도는 중에도 닻은 제자리(2026-11-02 D2) — 얼굴이 숨 쉬고 답이 그 자리에 이어진다. */}
                    <div className="nx-av" data-spark="on" aria-hidden="true">
                      <span className="nx-av-spark">
                        <SparkIcon />
                      </span>
                    </div>
                    <div className="nx-dr-working" role="status">
                      {thread.streamText !== null && thread.streamText !== "" && (
                        <div className="nx-dr-msg-md">
                          <Markdown text={thread.streamText} />
                        </div>
                      )}
                      {thread.reads.length > 0 && (
                        <p className="nx-dr-msg-reads">{L.drafts.readBy(thread.reads.length)}</p>
                      )}
                      <div className="nx-dr-working-row">
                        <p className="nx-dr-working-line">
                          <Spin /> {L.drafts.aiWorking}
                        </p>
                        <button
                          type="button"
                          className="nx-btn nx-btn--sm nx-btn--ghost"
                          onClick={thread.cancel}
                        >
                          {L.drafts.editCancel}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="nx-dr-formwrap">
            {/* 바닥에서 떠나 올려 읽는 동안 입력창 위에 뜬다(2026-11-02 D5) — 화면 대화의 떠 있는 단추와 같은 부품. */}
            {unpinned && (
              <button type="button" className="nx-jump" onClick={toBottom}>
                {hasNew ? L.drafts.newContent : L.drafts.toBottom}
              </button>
            )}
            <form
              className="nx-dr-thread-form"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              {selection !== null && (
                <p className="nx-dr-refchip nx-dr-selchip">
                  {L.drafts.selectionChip}:{" "}
                  {selection.length > 80 ? `${selection.slice(0, 80)}…` : selection}
                  <button
                    type="button"
                    className="nx-ibtn nx-ibtn--xs nx-dr-refchip-x"
                    title={L.drafts.selectionRemove}
                    aria-label={L.drafts.selectionRemove}
                    onClick={() => setSelection(null)}
                  >
                    <CloseIcon />
                  </button>
                </p>
              )}
              {pendingRefs.length > 0 && (
                <ul className="nx-dr-refchips">
                  {pendingRefs.map((ref) => (
                    <li key={ref.pageId} className="nx-dr-refchip">
                      {L.drafts.refChip(ref.title, ref.version, ref.sections)}
                      <button
                        type="button"
                        className="nx-ibtn nx-ibtn--xs nx-dr-refchip-x"
                        title={L.drafts.removeRef}
                        aria-label={`${L.drafts.removeRef}: ${ref.title}`}
                        onClick={() => {
                          setPendingRefs((before) =>
                            before.filter((one) => one.pageId !== ref.pageId),
                          );
                          setRefNotice(null);
                        }}
                      >
                        <CloseIcon />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {refNotice !== null && <p className="nx-dr-limit">{refNotice}</p>}
              <div className="nx-dr-thread-row">
                <textarea
                  ref={inputRef}
                  className="nx-input nx-input--area nx-dr-area"
                  rows={2}
                  value={inputText}
                  maxLength={DRAFT_LIMITS.questionLength}
                  placeholder={L.drafts.inputHint}
                  aria-label={L.drafts.threadTitle}
                  aria-describedby={hintId}
                  onChange={(event) => setInputText(event.target.value)}
                  onKeyDown={onInputKeyDown}
                />
                <div className="nx-dr-thread-acts">
                  <button
                    type="button"
                    className="nx-btn nx-btn--sm nx-btn--ghost"
                    ref={addAnchor}
                    aria-expanded={pickerOpen}
                    onClick={() => setPickerOpen((before) => !before)}
                  >
                    <PlusIcon />
                    {L.drafts.addRef}
                  </button>
                  {/* 화면 대화와 같은 모델 칩 — 이 대화의 AI 는 모델 · 생각 시간만 고른다(2026-10-26 사용자 요청). */}
                  <ModelChip
                    daemon={daemon}
                    sessions={{ refreshUsage: draftRefreshUsage(daemon) }}
                    target={chip.target}
                  />
                  <button
                    type="submit"
                    className="nx-btn nx-btn--accent"
                    disabled={thread.running || inputText.trim() === ""}
                  >
                    <SendIcon />
                    {L.drafts.send}
                  </button>
                </div>
              </div>
              {inputText.length >= DRAFT_LIMITS.questionLength && (
                <p className="nx-dr-limit">{L.drafts.limitQuestionLength}</p>
              )}
            </form>
            {/* 근거 고르기 · 문서 옮기기 판은 팝으로 뜬다(2026-11-02 D8) — 입력창을 밀치지 않고
                단추에 붙어 뜬다(머리 ⋯ 메뉴와 같은 겹판 부품). */}
            {pickerOpen && (
              <Popover
                anchor={addAnchor}
                label={L.drafts.addRef}
                align="start"
                float
                onClose={() => setPickerOpen(false)}
              >
                <RefPicker daemon={daemon} onAdd={addRef} onClose={() => setPickerOpen(false)} />
              </Popover>
            )}
            {moveOpen && conversation !== null && (
              <Popover
                anchor={menuAnchor}
                label={L.drafts.convOtherDoc}
                align="end"
                float
                onClose={() => setMoveOpen(false)}
              >
                <RefPicker
                  daemon={daemon}
                  onAdd={() => undefined}
                  onClose={() => setMoveOpen(false)}
                  moveTo={(pageId) => {
                    setMoveOpen(false);
                    void daemon.api
                      .draftThreadMove(conversation.threadId, `p-${pageId}`)
                      .then(() => {
                        onConversationsChanged();
                        thread.reload();
                      })
                      .catch((err: unknown) => {
                        nav.toast(err instanceof Error ? err.message : String(err));
                      });
                  }}
                />
              </Popover>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
