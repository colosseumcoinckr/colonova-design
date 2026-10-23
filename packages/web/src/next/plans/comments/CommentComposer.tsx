import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Daemon } from "../../../lib/daemon-client";
import { L } from "../../labels";
import { Spin } from "../../ui/icons";
import { escapeOwnedByLayer } from "../escape-layer";
import { type CommentKind, type CommentOp, commentFailLine, composerCount } from "./comments-model";

/** 입력의 네 쓰임 — 새 바닥글 · 인라인 · 답글 · 고치기. 요청의 모양만 다르고 몸은 하나다. */
export type ComposerMode =
  | { kind: "footer" }
  | { kind: "inline"; anchor: { selection: string; index: number } }
  | { kind: "reply"; parentId: string; parentKind: CommentKind }
  | { kind: "edit"; commentId: string; commentKind: CommentKind; version: number };

/** 보내기의 결과 — 모름은 다시 보내지 않는다(정본 계획 §9). */
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
 * 입력이 열릴 때 하나 만들고, 실패한 뒤의 다음 보내기는 새 아이디로(실패는 확정이다). 모름은 다시 읽기
 * 단추만 세우고 같은 입력에서 다시 보내지 않는다 — 글은 남겨 복사할 수 있게.
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
  /** 다시 읽기 — 모름의 단추가 문서를 조용히 다시 읽게 한다. */
  onReread: () => void;
}) {
  const apiRef = useRef(daemon.api);
  apiRef.current = daemon.api;
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initialText);
  const [commandId, setCommandId] = useState(() => crypto.randomUUID().toLowerCase());
  const [phase, setPhase] = useState<ComposerPhase>({ state: "idle" });

  // 열리면 초점이 입력으로 온다 — 사람이 연 입력(답글 · 인라인 · 고치기)만. 바닥글 입력은 문서와 함께 늘 서
  // 있어서, 초점을 잡으면 문서를 연 순간 화면이 코멘트 절까지 끌려 내려간다(2026-10-23 화면 확인).
  // biome-ignore lint/correctness/useExhaustiveDependencies: 열릴 때 한 번만
  useEffect(() => {
    if (mode.kind !== "footer") area.current?.focus();
  }, []);

  const count = composerCount(text);
  const locked = phase.state === "sending" || phase.state === "unknown";

  const send = async () => {
    if (locked || !count.sendable) return;
    setPhase({ state: "sending" });
    try {
      const result =
        mode.kind === "footer"
          ? await apiRef.current.docCommentCreate({ pageId, commandId, text })
          : mode.kind === "inline"
            ? await apiRef.current.docCommentCreate({
                pageId,
                commandId,
                text,
                anchor: mode.anchor,
              })
            : mode.kind === "reply"
              ? await apiRef.current.docCommentReply({
                  pageId,
                  commandId,
                  parentId: mode.parentId,
                  kind: mode.parentKind,
                  text,
                })
              : await apiRef.current.docCommentUpdate({
                  pageId,
                  commandId,
                  commentId: mode.commentId,
                  kind: mode.commentKind,
                  version: mode.version,
                  text,
                });
      if (result.state === "applied") {
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
      setPhase({ state: "failed", ...commentFailLine(result.detail) });
      setCommandId(crypto.randomUUID().toLowerCase());
    } catch {
      // 요청 자체가 던지면(연결 끊김 등) 모름과 같이 다룬다.
      setPhase({ state: "unknown" });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      // 창 · 메뉴(겹판 · 팝)가 열려 있으면 그것의 Esc 다 — 치던 글을 지우지 않는다(2026-10-23 · R3 발견 3).
      if (escapeOwnedByLayer()) return;
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
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="nx-dc-bar">
        {count.note !== null && <span className="nx-dc-count">{count.note}</span>}
        {phase.state === "failed" && (
          <span className="nx-dc-fail">
            {phase.line}
            {phase.sub !== null && <small>{phase.sub}</small>}
          </span>
        )}
        {phase.state === "unknown" && <span className="nx-dc-fail">{L.comments.unknown}</span>}
        {mode.kind !== "footer" && (
          <button
            type="button"
            className="nx-btn nx-btn--sm nx-btn--ghost"
            disabled={phase.state === "sending"}
            onClick={onClose}
          >
            {L.comments.cancel}
          </button>
        )}
        {phase.state === "unknown" ? (
          <button
            type="button"
            className="nx-btn nx-btn--sm"
            onClick={() => {
              onReread();
              // 바닥글 입력은 늘 그 자리에 있다 — 다시 읽은 뒤에는 글을 지닌 채 새 명령 아이디로 풀어 둔다.
              // 다시 보낼지는 다시 읽은 목록을 본 사람이 정한다(자동 재전송은 없다 · 2026-10-23 오케스트레이터 검토).
              if (mode.kind === "footer") {
                setPhase({ state: "idle" });
                setCommandId(crypto.randomUUID().toLowerCase());
              }
            }}
          >
            {L.comments.reread}
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
