import type { DocCommentResult } from "@colonova-design/protocol";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Daemon, PlanDocComment } from "../../../lib/daemon-client";
import { L } from "../../labels";
import { composing } from "../../lib/ime";
import { createLatestRequest } from "../../lib/latest-request";
import { Spin } from "../../ui/icons";
import { escapeOwnedByLayer } from "../escape-layer";
import { type CommentKind, type CommentOp, commentFailLine, composerCount } from "./comments-model";

/** 입력의 네 쓰임 — 새 바닥글 · 인라인 · 답글 · 고치기. 요청의 모양만 다르고 몸은 하나다. */
export type ComposerMode =
  | { kind: "footer" }
  | { kind: "inline"; anchor: { selection: string; index: number } }
  | { kind: "reply"; parentId: string; parentKind: CommentKind }
  | { kind: "edit"; commentId: string; commentKind: CommentKind; version: number };

/** 보내기의 결과 — 모름은 처음 명령으로 확인한다(2026-11-12 UI 조사 U-076). */
type ComposerPhase =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "failed"; line: string; sub: string | null }
  | { state: "unknown" };

/** 쓰임의 자리 표시 글. */
const PLACEHOLDER: Record<ComposerMode["kind"], string> = {
  footer: L.comments.footerPlaceholder,
  inline: L.comments.inlinePlaceholder,
  reply: L.comments.replyPlaceholder,
  edit: L.comments.editPlaceholder,
};

/** 쓰임이 보내는 명령의 종류 — 알림 한 줄의 문장을 고른다. */
function opOf(mode: ComposerMode): CommentOp {
  if (mode.kind === "reply") return "reply";
  if (mode.kind === "edit") return "update";
  return "create";
}

/**
 * 코멘트 입력(2026-10-23 · 최종 구현 계획 F4 · 작업 D2b) — 한 구성 요소가 네 쓰임을 맡는다. 여러 줄
 * 입력에 Enter 는 줄바꿈 · ⌘/Ctrl+Enter 가 보내기 · Esc 는 닫기(바닥글 입력은 비우기)다. 명령 아이디는
 * 입력이 열릴 때 하나 만들고, 실패한 뒤의 다음 보내기는 새 아이디로(실패는 확정이다). 모름은 같은 명령으로 다시 확인한다. 그래도 모르면 목록 읽기가 끝난 뒤 글을 남기고 잠금을 푼다.
 */
export function CommentComposer({
  daemon,
  pageId,
  mode,
  initialText = "",
  onClose,
  onApplied,
  onReread,
}: {
  daemon: Daemon;
  pageId: string;
  mode: ComposerMode;
  /** 고치기의 처음 글 — 지금 본문(맨 글)이다. */
  initialText?: string;
  /** 닫기 — 바닥글 입력은 비우고 그 자리에 남는다(닫힐 자리가 없다). */
  onClose: () => void;
  /** 적용됨 — 한 줄 알림과 조용한 다시 읽기는 부르는 쪽의 몫이다. */
  onApplied: (op: CommentOp) => void;
  /** 다시 읽기 — 명령 결과가 계속 모르면 읽은 코멘트 목록을 적용한다. */
  onReread: (comments: PlanDocComment[]) => void;
}) {
  const apiRef = useRef(daemon.api);
  apiRef.current = daemon.api;
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initialText);
  const [commandId, setCommandId] = useState(() => crypto.randomUUID().toLowerCase());
  const [phase, setPhase] = useState<ComposerPhase>({ state: "idle" });

  const pending = useRef<(() => Promise<DocCommentResult>) | null>(null);
  const inFlight = useRef(false);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<string | null>(null);
  const requests = useRef(createLatestRequest<string>()).current;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 문서나 API가 바뀌면 진행 중인 읽기를 무효화한다.
  useEffect(() => () => requests.invalidate(), [requests, pageId, daemon.api]);

  // 열리면 초점이 입력으로 온다 — 사람이 연 입력(답글 · 인라인 · 고치기)만. 바닥글 입력은 문서와 함께 늘 서
  // 있어서, 초점을 잡으면 문서를 연 순간 화면이 코멘트 절까지 끌려 내려간다(2026-10-23 화면 확인).
  // biome-ignore lint/correctness/useExhaustiveDependencies: 열릴 때 한 번만
  useEffect(() => {
    if (mode.kind !== "footer") area.current?.focus();
  }, []);

  const count = composerCount(text);
  const locked = phase.state === "sending" || phase.state === "unknown";

  const send = async () => {
    if (locked || inFlight.current || !count.sendable) return;
    inFlight.current = true;
    setReadNote(null);
    setPhase({ state: "sending" });
    // 2026-11-12 UI 조사 U-076 — 재확인은 처음 보낸 명령과 입력을 그대로 쓴다.
    const command = () =>
      mode.kind === "footer"
        ? apiRef.current.docCommentCreate({ pageId, commandId, text })
        : mode.kind === "inline"
          ? apiRef.current.docCommentCreate({
              pageId,
              commandId,
              text,
              anchor: mode.anchor,
            })
          : mode.kind === "reply"
            ? apiRef.current.docCommentReply({
                pageId,
                commandId,
                parentId: mode.parentId,
                kind: mode.parentKind,
                text,
              })
            : apiRef.current.docCommentUpdate({
                pageId,
                commandId,
                commentId: mode.commentId,
                kind: mode.commentKind,
                version: mode.version,
                text,
              });

    pending.current = command;
    try {
      const result = await command();
      if (result.state === "applied") {
        pending.current = null;
        // 바닥글 입력은 그 자리에 남으므로 스스로 비운다 — 답글 · 인라인 · 고치기는 부르는 쪽이 거둔다.
        if (mode.kind === "footer") {
          setText("");
          setPhase({ state: "idle" });
          setCommandId(crypto.randomUUID().toLowerCase());
        }
        onApplied(opOf(mode));
        return;
      }
      if (result.state === "unknown") {
        setPhase({ state: "unknown" });
        return;
      }
      // 실패는 확정이다 — 다음 보내기는 새 명령 아이디로.
      pending.current = null;
      setPhase({ state: "failed", ...commentFailLine(result.detail) });
      setCommandId(crypto.randomUUID().toLowerCase());
    } catch {
      // 요청 자체가 던지면(연결 끊김 등) 모름과 같이 다룬다.
      setPhase({ state: "unknown" });
    } finally {
      inFlight.current = false;
    }
  };

  // 2026-11-12 UI 조사 U-076 — 목록 차이 대신 같은 명령의 기록된 결과를 확인한다.
  const reread = async () => {
    if (reading || inFlight.current || pending.current === null) return;
    inFlight.current = true;
    setReading(true);
    setReadNote(null);
    const ticket = requests.begin(pageId);
    try {
      const result = await pending.current();
      if (!requests.isCurrent(ticket, pageId)) return;
      if (result.state === "applied") {
        setText("");
        setPhase({ state: "idle" });
        setCommandId(crypto.randomUUID().toLowerCase());
        pending.current = null;
        onApplied(opOf(mode));
      } else if (result.state === "failed") {
        setPhase({ state: "failed", ...commentFailLine(result.detail) });
        setCommandId(crypto.randomUUID().toLowerCase());
        pending.current = null;
      } else {
        const reply = await apiRef.current.docRead(pageId);
        if (!requests.isCurrent(ticket, pageId)) return;
        if (reply.comments === null) throw new Error("comments unavailable");
        onReread(reply.comments);
        setReadNote(L.comments.stillUnknown);
        setPhase({ state: "idle" });
        setCommandId(crypto.randomUUID().toLowerCase());
        pending.current = null;
      }
    } catch {
      if (requests.isCurrent(ticket, pageId)) setReadNote(L.comments.rereadFailed);
    } finally {
      if (requests.isCurrent(ticket, pageId)) {
        inFlight.current = false;
        setReading(false);
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (composing(event)) return;
    if (event.key === "Escape") {
      // 창 · 메뉴(겹판 · 팝)가 열려 있으면 그것의 Esc 다 — 치던 글을 지우지 않는다(2026-10-23 · R3 발견 3).
      if (escapeOwnedByLayer()) return;
      if (locked) {
        event.preventDefault();
        return;
      }
      // 문서 보기의 Esc(목록으로)가 이기지 않게 — 처리됨으로 표시한다.
      event.preventDefault();
      if (mode.kind === "footer") {
        setText("");
        setPhase({ state: "idle" });
        setCommandId(crypto.randomUUID().toLowerCase());
        return;
      }
      onClose();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="nx-dc-composer">
      {mode.kind === "inline" && (
        <p className="nx-pl-comment-anchor nx-dc-quote">
          {L.plans.commentAnchor(mode.anchor.selection)}
        </p>
      )}
      <textarea
        ref={area}
        className="nx-input nx-input--area nx-dc-area"
        rows={mode.kind === "footer" ? 2 : 3}
        aria-label={PLACEHOLDER[mode.kind]}
        placeholder={PLACEHOLDER[mode.kind]}
        value={text}
        disabled={phase.state === "sending"}
        readOnly={phase.state === "unknown"}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {readNote !== null && (
        <p className="nx-dc-fail" role="status">
          {readNote}
        </p>
      )}
      <div className="nx-dc-bar">
        {count.note !== null && <span className="nx-dc-count">{count.note}</span>}
        {phase.state === "failed" && (
          <span className="nx-dc-fail" role="alert">
            {phase.line}
            {phase.sub !== null && <small>{phase.sub}</small>}
          </span>
        )}
        {phase.state === "unknown" && (
          <span className="nx-dc-fail" role="alert">
            {L.comments.recheckUnknown}
          </span>
        )}
        {mode.kind !== "footer" && (
          <button
            type="button"
            className="nx-btn nx-btn--sm nx-btn--ghost"
            disabled={locked}
            onClick={onClose}
          >
            {L.comments.cancel}
          </button>
        )}
        {phase.state === "unknown" ? (
          <button
            type="button"
            className="nx-btn nx-btn--sm"
            disabled={reading}
            onClick={() => void reread()}
          >
            {reading ? <Spin /> : null}
            {reading ? L.plans.reading : L.comments.recheck}
          </button>
        ) : (
          <button
            type="button"
            className="nx-btn nx-btn--sm"
            disabled={locked || !count.sendable}
            onClick={() => void send()}
          >
            {phase.state === "sending" ? <Spin /> : null}
            {phase.state === "sending" ? L.comments.sending : L.comments.send}
          </button>
        )}
      </div>
    </div>
  );
}
