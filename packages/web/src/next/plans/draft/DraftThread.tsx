import type {
  DraftBlock,
  DraftMessage,
  DraftProposal,
  DraftReadRef,
  DraftRefInput,
} from "@colonova-design/protocol";
import { ChevronDown, ChevronUp, Ellipsis } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Markdown } from "../../../components/Markdown";
import type { Daemon } from "../../../lib/daemon-client";
import { EyeIcon } from "../../chat/icons";
import { ModelChip } from "../../chat/ModelChip";
import { L } from "../../labels";
import type { ShellNav } from "../../slots";
import { CloseIcon, PlusIcon, SendIcon, Spin } from "../../ui/icons";
import { ModalBody, ModalFoot, ModalFrame, ModalHead, useModalClose } from "../../ui/ModalFrame";
import { Popover } from "../../ui/Popover";
import { escapeOwnedByLayer } from "../escape-layer";
import { type PlanListRow, planRows } from "../plans-list";
import { DRAFT_LIMITS } from "./limits";
import {
  type DraftRefChoice,
  type OpCompare,
  opCompare,
  openOpIds,
  opSummary,
  parseRefSections,
  reaskRefs,
  refChoices,
  selectableOpIds,
} from "./thread-model";
import type { DraftHand } from "./use-draft";
import { draftRefreshUsage, useDraftPick } from "./use-draft-pick";
import { useDraftThread } from "./use-draft-thread";

/**
 * 기획 대화 칸(2026-10-23 · 최종 구현 계획 F1) — 초안 편집기 안에서 AI 와 문서를 다듬는다. 화면 작업의
 * 대화(가운데 입력창)와 섞이지 않게 이 칸은 기획서 칸 안에 있고, 머리에 지금 대상(초안 제목)을 늘 보인다.
 * AI 의 답은 설명과 변경안으로 나뉘고, 변경안은 사람이 걸음마다 채택하거나 거절한다 — 채택은 이 컴퓨터의
 * 초안에만 닿는다. 이 컴퓨터의 말은 전부 `L.drafts` 이고, 클래스는 `nx-dr-*` 로만 산다.
 */

/** 견주기의 한 쪽 — 이름표와 투영 글(빈 자리면 대신 서는 말). 카드의 짧은 견주기와 큰 판이 같은 모양으로 쓴다. */
function CompareSide({
  label,
  text,
  empty,
  after,
}: {
  label: string;
  text: string;
  empty: string;
  after?: boolean;
}) {
  return (
    <div className={`nx-dr-prop-version${after ? " nx-dr-prop-version--after" : ""}`}>
      <span className="nx-dr-prop-version-label">{label}</span>
      {text === "" ? (
        <p>{empty}</p>
      ) : (
        <div className="nx-dr-read">
          <Markdown text={text} />
        </div>
      )}
    </div>
  );
}

/**
 * 견주기 크게 보기 — 좁은 기획 대화 칸에서 표가 한 글자씩 접히는 걸음을 넓은 판에 나란히 펼친다
 * (2026-10-25 UX 심화 사용). 겹판 뼈대라 Esc · 스크림 · 초점 가두기 · 닫는 모션이 같다. 기획서 칸은
 * `container-type` 이 fixed 의 기준을 가두므로 앱 뿌리(`.nx`)로 옮겨 그린다(AskPreview 의 큰 보기와
 * 같은 이유).
 */
function CompareBig({
  head,
  compare,
  onClose,
}: {
  /** 걸음의 한 줄 요약 — 판 머리 아래 다시 세운다. */
  head: string;
  compare: OpCompare;
  onClose: () => void;
}) {
  const close = useModalClose();
  return createPortal(
    <ModalFrame onClose={onClose} className="nx-dr-cmp">
      <ModalHead title={L.drafts.compareBigTitle} sub={L.drafts.compareBigSub} />
      <ModalBody>
        <p className="nx-dr-cmp-head">{head}</p>
        <div className="nx-dr-cmp-sides">
          <CompareSide
            label={L.drafts.beforeChange}
            text={compare.before}
            empty={compare.beforeEmpty}
          />
          <CompareSide
            label={L.drafts.afterChange}
            text={compare.after}
            empty={compare.afterEmpty}
            after
          />
        </div>
      </ModalBody>
      <ModalFoot>
        <button type="button" className="nx-btn" onClick={close}>
          {L.modal.close}
        </button>
      </ModalFoot>
    </ModalFrame>,
    document.querySelector(".nx") ?? document.body,
  );
}

/** 변경안 카드 — 요약 한 줄, 걸음의 체크칸과 요약 · 미리보기 · 처지 배지, 채택 단추들. */
function ProposalCard({
  proposal,
  blocks,
  currentTitle,
  locked,
  busy,
  onAdopt,
  onReject,
  onReask,
}: {
  proposal: DraftProposal;
  blocks: readonly DraftBlock[];
  currentTitle: string;
  locked: boolean;
  busy: boolean;
  onAdopt: (proposalId: string, opIds: string[]) => void;
  onReject: (proposalId: string, opIds?: string[]) => void;
  onReask: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  // 크게 보기로 펼친 걸음 — 없으면 닫힘(2026-10-25 UX 심화 사용).
  const [zoomOpId, setZoomOpId] = useState<string | null>(null);
  const hintId = useId();
  const selectable = useMemo(() => new Set(selectableOpIds(proposal)), [proposal]);
  const open = useMemo(() => openOpIds(proposal), [proposal]);
  const picked = [...checked].filter((opId) => selectable.has(opId));
  // 아직 아무 걸음도 고르지 않은 동안 — 꺼진 채택 단추의 이유를 곁에서 말한다(2026-10-25 UX 관찰).
  const pickHint = !locked && !busy && picked.length === 0 && selectable.size > 0;

  const toggle = (opId: string) => {
    setChecked((before) => {
      const next = new Set(before);
      if (next.has(opId)) {
        next.delete(opId);
      } else {
        next.add(opId);
      }
      return next;
    });
  };

  return (
    <article className="nx-dr-prop">
      <p className="nx-dr-prop-sum">{proposal.summary}</p>
      <ul className="nx-dr-prop-steps" data-pick={pickHint ? "none" : undefined}>
        {proposal.ops.map((op) => {
          const checkable = selectable.has(op.opId);
          const head = opSummary(op, blocks);
          const compare = opCompare(op, blocks, currentTitle);
          return (
            <li key={op.opId} className="nx-dr-prop-step" data-state={op.state}>
              <div className="nx-dr-prop-step-hd">
                <label className="nx-dr-check">
                  <input
                    type="checkbox"
                    checked={checked.has(op.opId)}
                    disabled={!checkable || locked || busy}
                    onChange={() => toggle(op.opId)}
                  />
                  <span>{head}</span>
                </label>
                <span className="nx-dr-prop-step-acts">
                  {op.state !== "open" && (
                    <span
                      className={`nx-pill nx-dr-badge${op.state === "adopted" ? " nx-pill--blue" : op.state === "stale" ? " nx-pill--amber" : ""}`}
                      data-op={op.state}
                    >
                      {op.state === "adopted"
                        ? L.drafts.opAdopted
                        : op.state === "rejected"
                          ? L.drafts.opRejected
                          : L.drafts.staleBadge}
                    </span>
                  )}
                  <button
                    type="button"
                    className="nx-ibtn nx-ibtn--sm nx-dr-prop-zoom"
                    aria-label={L.drafts.compareBigOf(head)}
                    title={L.drafts.compareBig}
                    aria-haspopup="dialog"
                    onClick={() => setZoomOpId(op.opId)}
                  >
                    <EyeIcon />
                  </button>
                </span>
              </div>
              {op.state === "stale" && <p className="nx-dr-prop-note">{L.drafts.opStale}</p>}
              <div className="nx-dr-prop-compare">
                <CompareSide
                  label={op.state === "open" ? L.drafts.beforeChange : L.drafts.currentDraft}
                  text={compare.before}
                  empty={compare.beforeEmpty}
                />
                <CompareSide
                  label={L.drafts.afterChange}
                  text={compare.after}
                  empty={compare.afterEmpty}
                  after
                />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="nx-dr-prop-acts">
        <button
          type="button"
          className="nx-btn nx-btn--sm nx-btn--pri"
          disabled={locked || busy || picked.length === 0}
          title={locked ? L.drafts.locked : undefined}
          aria-describedby={pickHint ? hintId : undefined}
          onClick={() => onAdopt(proposal.proposalId, picked)}
        >
          {L.drafts.adoptSelected}
        </button>
        <button
          type="button"
          className="nx-ibtn nx-ibtn--sm"
          ref={menuAnchor}
          aria-label={L.drafts.proposalMenu}
          title={L.drafts.proposalMenu}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((before) => !before)}
        >
          <Ellipsis className="nx-i" size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
        {menuOpen && (
          <Popover
            anchor={menuAnchor}
            role="menu"
            label={L.drafts.proposalMenu}
            align="end"
            up
            float
            onClose={() => setMenuOpen(false)}
          >
            <button
              type="button"
              role="menuitem"
              className="nx-mi"
              disabled={locked || busy || open.length === 0}
              title={locked ? L.drafts.locked : undefined}
              onClick={() => {
                setMenuOpen(false);
                onAdopt(proposal.proposalId, open);
              }}
            >
              {L.drafts.adoptAll}
            </button>
            <button
              type="button"
              role="menuitem"
              className="nx-mi"
              disabled={busy}
              onClick={() => {
                setMenuOpen(false);
                onReject(proposal.proposalId, picked.length > 0 ? picked : undefined);
              }}
            >
              {L.drafts.reject}
            </button>
            <button
              type="button"
              role="menuitem"
              className="nx-mi"
              disabled={busy}
              onClick={() => {
                setMenuOpen(false);
                onReask();
              }}
            >
              {L.drafts.reask}
            </button>
          </Popover>
        )}
        {pickHint && (
          <p className="nx-dr-prop-hint" id={hintId}>
            {L.drafts.adoptPickHint}
          </p>
        )}
      </div>
      {zoomOpId !== null &&
        (() => {
          const op = proposal.ops.find((one) => one.opId === zoomOpId);
          if (op === undefined) return null;
          return (
            <CompareBig
              head={opSummary(op, blocks)}
              compare={opCompare(op, blocks, currentTitle)}
              onClose={() => setZoomOpId(null)}
            />
          );
        })()}
    </article>
  );
}

/** 근거 고르기 판 — 찾는 말로 문서를 걸러 고르고, 절 이름을 쉼표로 적어 담는다. */
function RefPicker({
  daemon,
  onAdd,
  onClose,
}: {
  daemon: Daemon;
  onAdd: (ref: DraftReadRef & { sections?: string[] }) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<PlanListRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<DraftRefChoice | null>(null);
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
    // 절 이름을 목록으로 — 선로의 한계(절 20개 · 이름 200자)를 넘으면 담지 않고 이유를 보인다
    // (2026-10-23 화면 확인 · R2 검토 3).
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
                onClick={() =>
                  setPicked((before) => (before?.pageId === choice.pageId ? null : choice))
                }
              >
                <span className="nx-dr-refrow-t">{choice.title}</span>
                <span className="nx-dr-refrow-m">
                  {L.drafts.refMeta(choice.version, choice.folder)}
                </span>
              </button>
            </li>
          ))}
          {choices.length === 0 && <li className="nx-dr-refnone">{L.drafts.refNone}</li>}
        </ul>
      )}
      {picked !== null && (
        <div className="nx-dr-refsec">
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
        </div>
      )}
    </div>
  );
}

/** 대화의 말 한 편 — 사람의 말과 근거 칩, AI 의 설명 · 읽은 문서 · 오류 · 변경안 카드. */
function MessageRow({
  message,
  proposal,
  blocks,
  currentTitle,
  locked,
  busy,
  onAdopt,
  onReject,
  onReask,
}: {
  message: DraftMessage;
  proposal: DraftProposal | null;
  blocks: readonly DraftBlock[];
  currentTitle: string;
  locked: boolean;
  busy: boolean;
  onAdopt: (proposalId: string, opIds: string[]) => void;
  onReject: (proposalId: string, opIds?: string[]) => void;
  /** 다시 요청 — 근거 채우기는 부르는 쪽이 앞의 사람 메시지에서 잰다(2026-10-23 화면 확인 · R2 검토 6). */
  onReask: () => void;
}) {
  if (message.role === "user") {
    return (
      <div className="nx-dr-msg" data-role="user">
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
      </div>
    );
  }
  return (
    <div className="nx-dr-msg" data-role="ai">
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
      {proposal !== null && (
        <ProposalCard
          proposal={proposal}
          blocks={blocks}
          currentTitle={currentTitle}
          locked={locked}
          busy={busy}
          onAdopt={onAdopt}
          onReject={onReject}
          onReask={onReask}
        />
      )}
    </div>
  );
}

/**
 * 기획 대화 칸 — 문서가 열리는 동안 편집기 곁에 선다. 채택이 끝나면 편집기를 다시 읽어 초안과
 * 대화의 판정을 맞춘다.
 */
export function DraftThread({
  daemon,
  docKey,
  draft,
  nav,
  inputRef,
}: {
  daemon: Daemon;
  docKey: string | null;
  draft: DraftHand;
  nav: ShellNav;
  /** 편집기의 빈 화면이 `AI 와 시작하기` 로 초점을 옮기는 입력 칸. */
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const thread = useDraftThread(daemon, docKey);
  // 기획 AI 의 모델 · 생각 시간 칩의 주인(2026-10-26 사용자 요청) — 화면 대화와 같은 부품, 다른 주인.
  const chip = useDraftPick(daemon);
  const [pendingRefs, setPendingRefs] = useState<Array<DraftReadRef & { sections?: string[] }>>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  // 근거 수의 한계 이유 — 선로의 상한(문서 20개)에 닿아 더 담지 못할 때 한 줄로 말한다.
  const [refNotice, setRefNotice] = useState<string | null>(null);

  // 개정이 어긋나 채택이 무산했을 때의 한 줄 — 셸의 토스트로 옮기고 거둔다(편집기와 같은 모양).
  useEffect(() => {
    if (thread.notice === null) return;
    nav.toast(thread.notice);
    thread.clearNotice();
  }, [thread, nav]);

  const blocks = draft.view?.blocks ?? [];
  const locked = draft.view?.state === "publishing" || draft.view?.state === "result-unknown";
  const proposals = useMemo(
    () => new Map((thread.thread?.proposals ?? []).map((one) => [one.proposalId, one])),
    [thread.thread],
  );

  const submit = () => {
    const text = inputText.trim();
    if (text === "" || thread.running) return;
    const refs: DraftRefInput[] = pendingRefs.map((ref) => {
      const sections = ref.sections?.filter((section) => section.trim() !== "");
      return sections !== undefined && sections.length > 0
        ? { pageId: ref.pageId, sections }
        : { pageId: ref.pageId };
    });
    void thread.ask(text, refs, { model: chip.pick.model, effort: chip.pick.effort }).then((ok) => {
      if (!ok) return;
      setInputText("");
      setPendingRefs([]);
      setPickerOpen(false);
      setRefNotice(null);
    });
  };

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // ⌘/Ctrl+Enter 로 보낸다 — 그냥 Enter 는 줄을 나눈다.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };

  const addRef = (ref: DraftReadRef & { sections?: string[] }) => {
    // 이미 담은 문서는 다시 담지 않는다.
    if (pendingRefs.some((one) => one.pageId === ref.pageId)) {
      setPickerOpen(false);
      return;
    }
    // 근거 수가 선로의 상한(문서 20개)에 닿았다 — 더 담지 못하게 막고 이유를 한 줄로 보인다
    // (2026-10-23 화면 확인 · R2 검토 3). 판은 그대로 열려 있다.
    if (pendingRefs.length >= DRAFT_LIMITS.refCount) {
      setRefNotice(L.drafts.limitRefCount);
      return;
    }
    setRefNotice(null);
    setPendingRefs([...pendingRefs, ref]);
    setPickerOpen(false);
  };

  // 채택은 이 컴퓨터의 초안에 닿는다 — 성패와 무관하게 편집기를 다시 읽어 판정을 맞춘다.
  const adoptOps = (proposalId: string, opIds: string[]) => {
    const view = draft.view;
    if (view === null || busy || opIds.length === 0) return;
    setBusy(true);
    void thread.adopt(proposalId, opIds, view.revision).then(() => {
      setBusy(false);
      draft.reload();
    });
  };

  const rejectOps = (proposalId: string, opIds?: string[]) => {
    if (busy) return;
    setBusy(true);
    void thread.reject(proposalId, opIds).then(() => setBusy(false));
  };

  // 다시 요청 — 같은 근거로 부탁의 말을 미리 채우고 입력 칸으로 초점을 옮긴다. 근거는 변경안을 낳은
  // 앞의 사람 메시지에서 다시 찾는다(AI 의 말에는 근거가 없다 · 2026-10-23 화면 확인 · R2 검토 6).
  const reask = (refs: Array<DraftReadRef & { sections?: string[] }>) => {
    setInputText(L.drafts.reaskPrompt);
    setPendingRefs(refs.map((ref) => ({ ...ref })));
    setRefNotice(null);
    inputRef.current?.focus();
  };

  // 대화의 말 — 다시 요청의 근거 찾기가 앞뒤 말을 본다(2026-10-23 화면 확인 · R2 검토 6).
  const messages = thread.thread?.messages ?? [];

  // 기록이 따로 구르는 넓은 칸(집중 배치)에서는 새 말 · 도는 글이 오면 바닥을 따라간다 — 사람이 위로 굴려 읽는
  // 중이면 붙잡지 않는다(2026-10-23 기획자 화면 손질 D2). 좁은 칸은 기록이 구르지 않아 아무 일도 없다.
  const logRef = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const onLogScroll = () => {
    const log = logRef.current;
    if (log === null) return;
    stick.current = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: 말 수 · 도는 글이 바뀔 때만 따라간다
  useEffect(() => {
    const log = logRef.current;
    if (log === null || !stick.current) return;
    log.scrollTop = log.scrollHeight;
  }, [messages.length, thread.running, thread.streamText]);

  // 대화 칸의 Esc — 근거 고르기 판이 열려 있으면 그것을 접고, 아니면 아무것도 닫지 않고 제 자리에서
  // 멈춘다(칸 · 편집기의 Esc 가 물러서게). 치던 글은 남는다(2026-10-23 화면 확인 · R2 검토 8).
  const onColumnKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    // 한글 조합 중의 Esc 는 조합을 취소하는 키다 — 칸까지 닫으면 쓰던 글이 날아간다.
    if (event.nativeEvent.isComposing) return;
    // 창 · 메뉴가 열려 있으면 그것의 Esc 다 — 그 처리기는 문서 단위라 이 칸보다 늦게 돈다.
    if (escapeOwnedByLayer()) return;
    event.preventDefault();
    event.stopPropagation();
    if (pickerOpen) setPickerOpen(false);
  };

  if (docKey === null) return null;

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: 대화 칸의 Esc 는 제 자리에서 멈추는 길이다
    <aside
      className="nx-dr-thread"
      data-expanded={expanded || undefined}
      aria-label={L.drafts.threadTitle}
      onKeyDown={onColumnKey}
    >
      <header className="nx-dr-thread-hd">
        <h3 className="nx-dr-thread-title">{L.drafts.threadTitle}</h3>
        {draft.view !== null && <span className="nx-dr-thread-target">{draft.view.title}</span>}
        <button
          type="button"
          className="nx-ibtn nx-ibtn--sm nx-dr-thread-toggle"
          aria-expanded={expanded}
          aria-label={expanded ? L.drafts.threadCollapse : L.drafts.threadExpand}
          title={expanded ? L.drafts.threadCollapse : L.drafts.threadExpand}
          onClick={() => setExpanded((before) => !before)}
        >
          {expanded ? (
            <ChevronDown className="nx-i" size={16} strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <ChevronUp className="nx-i" size={16} strokeWidth={1.8} aria-hidden="true" />
          )}
        </button>
        {/* 이 AI 가 무엇을 바꾸는지 입력 곁에서 말한다 — 화면 AI 와 헷갈리지 않게(정본 §6 실행 경계 · §11 첫 줄). */}
        <p className="nx-dr-thread-scope" title={L.drafts.threadScope}>
          {L.drafts.threadScope}
        </p>
      </header>
      {thread.phase === "failed" ? (
        <p className="nx-banner nx-banner--red nx-dr-fail" role="alert">
          {thread.error ?? L.drafts.loadFailed}
          <button type="button" className="nx-btn nx-btn--sm" onClick={thread.retry}>
            {L.plans.retry}
          </button>
        </p>
      ) : (
        <>
          {thread.error !== null && (
            <p className="nx-banner nx-banner--red nx-dr-fail" role="alert">
              {thread.error}
            </p>
          )}
          <div className="nx-dr-thread-log" ref={logRef} onScroll={onLogScroll}>
            {thread.phase === "loading" ? (
              <p className="nx-dr-thread-empty">
                <Spin /> {L.plans.reading}
              </p>
            ) : (
              <>
                {messages.map((message) => (
                  <MessageRow
                    key={message.messageId}
                    message={message}
                    proposal={
                      message.proposalId === undefined
                        ? null
                        : (proposals.get(message.proposalId) ?? null)
                    }
                    blocks={blocks}
                    currentTitle={draft.view?.title ?? ""}
                    locked={locked}
                    busy={busy}
                    onAdopt={adoptOps}
                    onReject={rejectOps}
                    onReask={() => reask(reaskRefs(messages, message.messageId))}
                  />
                ))}
                {(thread.thread?.messages.length ?? 0) === 0 && !thread.running && (
                  <p className="nx-dr-thread-empty">{L.drafts.threadEmpty}</p>
                )}
                {thread.running && (
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
                )}
              </>
            )}
          </div>
          <form
            className="nx-dr-thread-form"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
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
            {pickerOpen && (
              <RefPicker
                daemon={daemon}
                onAdd={addRef}
                onClose={() => {
                  setPickerOpen(false);
                  setRefNotice(null);
                }}
              />
            )}
            <div className="nx-dr-thread-row">
              <textarea
                ref={inputRef}
                className="nx-input nx-input--area nx-dr-area"
                rows={3}
                value={inputText}
                // 선로의 질문 한계 — 데몬의 검사에 부딪치기 전에 칸이 먼저 멈춘다(2026-10-23 화면 확인 · R2 검토 3).
                maxLength={DRAFT_LIMITS.questionLength}
                placeholder={L.drafts.inputHint}
                aria-label={L.drafts.threadTitle}
                onChange={(event) => setInputText(event.target.value)}
                onKeyDown={onInputKeyDown}
              />
              <div className="nx-dr-thread-acts">
                <button
                  type="button"
                  className="nx-btn nx-btn--sm nx-btn--ghost"
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
        </>
      )}
    </aside>
  );
}
