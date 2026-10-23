import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { Daemon, PlanDocComment } from "../../../lib/daemon-client";
import { L } from "../../labels";
import { Spin } from "../../ui/icons";
import { type PlanCommentRow, planCommentRows } from "../plans-list";
import { CommentComposer, type ComposerMode } from "./CommentComposer";
import {
  type CommentAction,
  type CommentOp,
  commentActions,
  commentFailLine,
  commentThreads,
  type InlineAnchorFailReason,
  inlineAnchor,
} from "./comments-model";
import { InlineAnchorButton } from "./InlineAnchorButton";
import "./comments.css";

/** 열려 있는 입력 — 인라인 · 답글 · 고치기 하나만 열린다(바닥글 입력은 늘 선다). */
type OpenInput =
  | { kind: "inline"; anchor: { selection: string; index: number } }
  | { kind: "reply"; row: PlanCommentRow }
  | { kind: "edit"; row: PlanCommentRow };

/** 해결의 진행 — 확인 · 보내는 중 · 결과. */
type ResolvePhase =
  | { state: "confirm" }
  | { state: "sending" }
  | { state: "failed"; line: string; sub: string | null }
  | { state: "unknown" };

/** 단추의 사람 말 — 줄마다 설 단추의 이름표다. */
const ACTION_LABEL: Record<CommentAction, string> = {
  reply: L.comments.reply,
  edit: L.comments.edit,
  resolve: L.comments.resolve,
};

/** 닻 판정의 막힌 이유 → 안내 문장. */
const ANCHOR_FAIL_LINE: Record<InlineAnchorFailReason, string> = {
  empty: L.comments.anchor.empty,
  "multi-block": L.comments.anchor.multiBlock,
  "too-long": L.comments.anchor.tooLong,
  repeated: L.comments.anchor.repeated,
};

/** 적용됨 알림이 머무는 시간 — 지나간 일이 눈에 박히지 않게. */
const NOTICE_MS = 6000;

/**
 * 기획서 문서의 코멘트 절(2026-10-23 · 최종 구현 계획 F4 · 작업 D2b) — 안 풀린 코멘트를 스레드로 읽고
 * 바닥글 · 인라인 · 답글 · 고치기 · 해결로 쓴다. 코멘트는 정본인 Confluence 에 바로 기록된다. 읽기에
 * 실패했으면 한 줄 알림만 서고 쓰기 단추는 서지 않는다.
 */
export function DocComments({
  daemon,
  pageId,
  comments,
  body,
  onRefresh,
  writable,
}: {
  daemon: Daemon;
  pageId: string;
  /** doc.read 의 코멘트 — 읽지 못했으면 null. */
  comments: PlanDocComment[] | null;
  /** 본문 덩어리 — 인라인 닻 단추가 듣는 자리. */
  body: RefObject<HTMLDivElement | null>;
  /** 조용한 다시 읽기 — 적용됨 · 모름의 다시 읽기가 부른다. */
  onRefresh: (pageId: string) => void;
  /** 이 앱이 Confluence 에 쓸 수 있는가(발행 게이트) — 모르면 없다. 막는 것은 데몬이다. */
  writable?: boolean;
}) {
  const apiRef = useRef(daemon.api);
  apiRef.current = daemon.api;
  const rows = useMemo(() => (comments === null ? [] : planCommentRows(comments)), [comments]);
  const threads = useMemo(() => commentThreads(rows), [rows]);
  // 머리글의 수 — 실제 보이는 줄의 수다(숨은 답글은 세지 않는다).
  const shown = useMemo(
    () => threads.reduce((sum, thread) => sum + 1 + thread.replies.length, 0),
    [threads],
  );

  const [input, setInput] = useState<OpenInput | null>(null);
  const [anchorFail, setAnchorFail] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  // 해결 중인 줄과 그 진행 — 한 줄씩만.
  const [resolveRow, setResolveRow] = useState<string | null>(null);
  const [resolvePhase, setResolvePhase] = useState<ResolvePhase>({ state: "confirm" });

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  // 문서를 다시 읽으면 해결 자리와 닻 실패 줄을 거둔다 — 새 읽기가 다시 세운다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: comments 가 바뀔 때만
  useEffect(() => {
    setResolveRow(null);
    setResolvePhase({ state: "confirm" });
    setAnchorFail(null);
  }, [comments]);

  /** 적용됨 — 한 줄 알림을 잠깐 보이고 문서를 조용히 다시 읽는다. */
  const appliedNotice = (op: CommentOp) => {
    setNotice(L.comments.applied[op]);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
    onRefresh(pageId);
  };

  /** 본문에서 고른 문장 — 닻 판정을 지나 인라인 입력을 열거나 다시 고르게 하는 안내를 세운다. */
  const askInline = (selection: string) => {
    const check = inlineAnchor(body.current?.textContent ?? "", selection);
    if (!check.ok) {
      setInput(null);
      setAnchorFail(ANCHOR_FAIL_LINE[check.reason]);
      return;
    }
    setAnchorFail(null);
    setInput({ kind: "inline", anchor: { selection: check.selection, index: check.index } });
  };

  /** 입력의 요청 모양 — 단추가 있는 줄은 재료가 갖춰져 있다(commentActions 이 보증). */
  const composerMode = (open: OpenInput): ComposerMode =>
    open.kind === "inline"
      ? { kind: "inline", anchor: open.anchor }
      : open.kind === "reply"
        ? {
            kind: "reply",
            parentId: open.row.id ?? "",
            parentKind: open.row.kind ?? "footer",
          }
        : {
            kind: "edit",
            commentId: open.row.id ?? "",
            commentKind: open.row.kind ?? "footer",
            version: open.row.version ?? 1,
          };

  /** 줄의 단추 누르기 — 해결은 확인을, 답글 · 고치기는 입력을 연다(하나만 열린다). */
  const openFor = (row: PlanCommentRow, action: CommentAction) => {
    setAnchorFail(null);
    if (action === "resolve") {
      setInput(null);
      setResolveRow(row.key);
      setResolvePhase({ state: "confirm" });
      return;
    }
    setResolveRow(null);
    setInput(action === "reply" ? { kind: "reply", row } : { kind: "edit", row });
  };

  /** 해결 보내기 — 확인 한 번 뒤에만. 모름은 다시 보내지 않는다(정본 계획 §9). */
  const sendResolve = async (row: PlanCommentRow) => {
    if (resolvePhase.state === "sending" || resolvePhase.state === "unknown") return;
    if (row.id === null || row.version === null) return;
    setResolvePhase({ state: "sending" });
    const commandId = crypto.randomUUID().toLowerCase();
    try {
      const result = await apiRef.current.docCommentResolve({
        pageId,
        commandId,
        commentId: row.id,
        version: row.version,
        resolved: true,
      });
      if (result.state === "applied") {
        setResolveRow(null);
        setResolvePhase({ state: "confirm" });
        appliedNotice("resolve");
        return;
      }
      if (result.state === "unknown") {
        setResolvePhase({ state: "unknown" });
        return;
      }
      setResolvePhase({ state: "failed", ...commentFailLine(result.detail) });
    } catch {
      // 요청 자체가 던지면(연결 끊김 등) 모름과 같이 다룬다.
      setResolvePhase({ state: "unknown" });
    }
  };

  /** 해결의 줄 안 판 — 확인 · 보내는 중 · 실패 · 모름. */
  const resolveNode = (row: PlanCommentRow): ReactNode => {
    if (resolvePhase.state === "sending") {
      return (
        <p className="nx-dc-resolve" role="status">
          <Spin /> {L.comments.sending}
        </p>
      );
    }
    if (resolvePhase.state === "unknown") {
      return (
        <div className="nx-dc-resolve">
          <span className="nx-dc-fail">{L.comments.unknown}</span>
          <button type="button" className="nx-btn nx-btn--sm" onClick={() => onRefresh(pageId)}>
            {L.comments.reread}
          </button>
          <button
            type="button"
            className="nx-btn nx-btn--sm nx-btn--ghost"
            onClick={() => setResolveRow(null)}
          >
            {L.comments.cancel}
          </button>
        </div>
      );
    }
    if (resolvePhase.state === "failed") {
      return (
        <div className="nx-dc-resolve">
          <span className="nx-dc-fail">
            {resolvePhase.line}
            {resolvePhase.sub !== null && <small>{resolvePhase.sub}</small>}
          </span>
          <button
            type="button"
            className="nx-btn nx-btn--sm nx-btn--ghost"
            onClick={() => setResolveRow(null)}
          >
            {L.comments.cancel}
          </button>
        </div>
      );
    }
    return (
      <div className="nx-dc-resolve">
        <span>{L.comments.resolveConfirm}</span>
        <button
          type="button"
          className="nx-btn nx-btn--sm nx-btn--pri"
          onClick={() => void sendResolve(row)}
        >
          {L.comments.resolveGo}
        </button>
        <button
          type="button"
          className="nx-btn nx-btn--sm nx-btn--ghost"
          onClick={() => setResolveRow(null)}
        >
          {L.comments.cancel}
        </button>
      </div>
    );
  };

  /** 코멘트 줄 하나 — 머리 · (인라인이면) 닻 문장 · 본문 · 단추, 그리고 열린 입력 · 해결 판. */
  const rowNode = (row: PlanCommentRow, top: boolean): ReactNode => {
    const actions = commentActions(row, top);
    return (
      <li key={row.key} className={`nx-pl-comment nx-dc-row${top ? "" : " nx-dc-row--reply"}`}>
        <p className="nx-pl-comment-hd">
          <b>{row.author}</b>
          {row.when !== null && <span>{row.when}</span>}
        </p>
        {row.anchor !== null && <p className="nx-pl-comment-anchor">{row.anchor}</p>}
        <p className="nx-pl-comment-body">{row.body}</p>
        {actions.length > 0 && (
          <div className="nx-dc-act">
            {actions.map((action) => (
              <button
                key={action}
                type="button"
                className="nx-btn nx-btn--sm nx-btn--ghost"
                onClick={() => openFor(row, action)}
              >
                {ACTION_LABEL[action]}
              </button>
            ))}
          </div>
        )}
        {resolveRow === row.key && resolveNode(row)}
        {input !== null && input.kind === "edit" && input.row.key === row.key && (
          <CommentComposer
            key={`edit-${row.key}`}
            daemon={daemon}
            pageId={pageId}
            mode={composerMode(input)}
            initialText={row.body}
            onClose={() => setInput(null)}
            onApplied={(op) => {
              setInput(null);
              appliedNotice(op);
            }}
            onReread={() => onRefresh(pageId)}
          />
        )}
        {input !== null && input.kind === "reply" && input.row.key === row.key && (
          <CommentComposer
            key={`reply-${row.key}`}
            daemon={daemon}
            pageId={pageId}
            mode={composerMode(input)}
            onClose={() => setInput(null)}
            onApplied={(op) => {
              setInput(null);
              appliedNotice(op);
            }}
            onReread={() => onRefresh(pageId)}
          />
        )}
      </li>
    );
  };

  // 읽기에 실패했으면 한 줄만 — 쓰기 단추도 인라인 닻 단추도 없다.
  if (comments === null) {
    return (
      <section className="nx-pl-comments">
        <p className="nx-pl-note">{L.plans.commentsUnavailable}</p>
      </section>
    );
  }

  return (
    <section className="nx-pl-comments">
      <InlineAnchorButton onSelect={askInline} body={body} />
      {notice !== null && (
        <p className="nx-dc-notice" role="status">
          {notice}
        </p>
      )}
      {anchorFail !== null && (
        <p className="nx-dc-anchor-fail" role="note">
          {anchorFail}
        </p>
      )}
      {/* 인라인 입력 — 코멘트 절 맨 위에 닻 문장을 인용해 선다(정본 계획 §9). */}
      {input !== null && input.kind === "inline" && (
        <CommentComposer
          key="inline"
          daemon={daemon}
          pageId={pageId}
          mode={composerMode(input)}
          onClose={() => setInput(null)}
          onApplied={(op) => {
            setInput(null);
            appliedNotice(op);
          }}
          onReread={() => onRefresh(pageId)}
        />
      )}
      {shown > 0 && <h4 className="nx-pl-comments-t">{L.plans.commentHeading(shown)}</h4>}
      {/* 쓰기가 꺼져 있으면(발행 게이트) 「바로 남아요」 대신 그 사실을 쓰기 전에 말한다(2026-10-23 기획자 화면 손질 U2). */}
      <p className="nx-pl-note">
        {writable === false ? L.comments.reason["publish-disabled"] : L.plans.commentNote}
      </p>
      {threads.map((thread) => (
        <ul className="nx-pl-comment-list" key={thread.top.key}>
          {rowNode(thread.top, true)}
          {thread.replies.map((reply) => rowNode(reply, false))}
        </ul>
      ))}
      {/* 바닥글 입력 — 코멘트가 0개여도 늘 선다. */}
      <CommentComposer
        daemon={daemon}
        pageId={pageId}
        mode={{ kind: "footer" }}
        onClose={() => {
          // 바닥글 입력은 닫히지 않는다 — Esc 가 스스로 비운다(CommentComposer).
        }}
        onApplied={appliedNotice}
        onReread={() => onRefresh(pageId)}
      />
    </section>
  );
}
