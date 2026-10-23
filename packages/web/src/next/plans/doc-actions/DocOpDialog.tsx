import type { DocOpKind, DocOpPreview, DocOpResult } from "@colonova-design/protocol";
import { useEffect, useRef, useState } from "react";
import type { Daemon } from "../../../lib/daemon-client";
import { L } from "../../labels";
import { Spin } from "../../ui/icons";
import { ModalBody, ModalFoot, ModalFrame, ModalHead } from "../../ui/ModalFrame";
import type { PlanListRow } from "../plans-list";
import { defaultCopyTitle, docOpBlockerLines, docOpResultLine } from "./doc-actions-model";
import "./doc-actions.css";

/**
 * 문서 관리 확인 창(2026-10-23 · 최종 구현 계획 F4) — 복제 · 위치 옮기기 · 휴지통 · 복구의 한 장.
 * 누르기 전에 미리보기로 원격 대상과 자식 영향 범위를 확인하고, 막는 이유가 남으면 확인이 열리지
 * 않는다. 부모를 고르면 미리보기를 다시 읽는다. 한 창에서 한 번만 보낸다 — 결과를 모른 채 다시
 * 보내는 일이 없게(자동 재전송은 없다).
 */
export function DocOpDialog({
  daemon,
  op,
  pageId,
  rows = [],
  onApplied,
  onClose,
}: {
  daemon: Daemon;
  op: DocOpKind;
  pageId: string;
  /** 목록의 줄 — 복제 · 옮기기의 들어갈 자리를 고르는 칸이 읽는다. */
  rows?: PlanListRow[];
  /** 마쳤음 — 창을 거두고 목록을 다시 읽는 일은 부르는 쪽의 몫이다(copy 면 새 문서를 연다). */
  onApplied: (result: DocOpResult) => void;
  onClose: () => void;
}) {
  const apiRef = useRef(daemon.api);
  apiRef.current = daemon.api;
  const picksParent = op === "copy" || op === "move";
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [preview, setPreview] = useState<DocOpPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 들어갈 자리 — `page:<id>` · `folder:<id>` 꼴의 고르기 값(NewDraftDialog 와 같은 모양).
  const [parent, setParent] = useState("");
  const [title, setTitle] = useState("");
  const [sending, setSending] = useState(false);
  // 한 번 보내면 같은 창에서 다시 보내지 않는다 — 결과를 못 받았어도(연결이 끊겨도) 잠긴다.
  const [locked, setLocked] = useState(false);
  const [result, setResult] = useState<DocOpResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 미리보기 — 창이 설 때와 자리를 다시 고를 때 읽는다. 늦게 온 답은 창이 닫혔으면 버린다.
  useEffect(() => {
    let alive = true;
    setPhase("loading");
    const at = parent.indexOf(":");
    const parentId = picksParent && at > 0 ? parent.slice(at + 1) : undefined;
    apiRef.current
      .docOpPreview(op, pageId, parentId)
      .then((next) => {
        if (!alive) return;
        setPreview(next);
        setPhase("ready");
        // 복제의 처음 제목 — 문서의 지금 제목에서 사본 이름을 만든다(미리보기가 제목을 안다).
        if (op === "copy")
          setTitle((before) => (before === "" ? defaultCopyTitle(next.title) : before));
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setPhase("failed");
        setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [op, pageId, parent, picksParent]);

  const send = async () => {
    if (sending || locked || phase !== "ready" || preview === null) return;
    setSending(true);
    setError(null);
    const commandId = crypto.randomUUID().toLowerCase();
    const at = parent.indexOf(":");
    const parentId = at > 0 ? parent.slice(at + 1) : "";
    try {
      const next =
        op === "trash"
          ? await apiRef.current.docTrash(pageId, commandId)
          : op === "restore"
            ? await apiRef.current.docRestore(pageId, commandId)
            : op === "copy"
              ? await apiRef.current.docCopy(pageId, commandId, title.trim(), parentId)
              : await apiRef.current.docMove(pageId, commandId, parentId);
      setResult(next);
      if (next.state === "applied") {
        onApplied(next);
        onClose();
        return;
      }
      setSending(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setSending(false);
    } finally {
      // 마쳤음은 창이 곧 거둬지고, 나머지는 결과 줄이 서게 — 어느 쪽이든 다시 보내지 않는다.
      setLocked(true);
    }
  };

  // 초안 안내는 막는 이유 목록에 서지 않고 창의 안내 줄이 말한다(2026-10-23 화면 확인 · R2 검토 7) —
  // 나머지 이유가 확인 단추를 닫는다.
  const blockers = preview === null ? [] : preview.blockers.filter((name) => name !== "has-draft");
  const blockerTexts = preview === null ? [] : docOpBlockerLines(preview);
  const targetMissing = picksParent && parent === "";
  const titleMissing = op === "copy" && title.trim() === "";
  const ready =
    phase === "ready" &&
    preview !== null &&
    blockers.length === 0 &&
    !targetMissing &&
    !titleMissing;
  // 초안 안내 — 복제에서는 아예 두지 않는다(사본에는 이 컴퓨터의 초안이 얽히지 않는다).
  const showDraftNote = preview !== null && preview.hasDraft === true && op !== "copy";
  const showChildren =
    preview !== null && op === "trash" && preview.childCount !== null && preview.childCount > 0;

  return (
    <ModalFrame
      onClose={onClose}
      locked={sending}
      label={L.docOps.dialogTitle(op)}
      className="nx-da"
    >
      <ModalHead title={L.docOps.dialogTitle(op)} sub={L.docOps.dialogSub} />
      <ModalBody>
        {phase === "loading" && (
          <p className="nx-da-note" role="status">
            <Spin /> {L.docOps.checking}
          </p>
        )}
        {phase === "failed" && (
          <p className="nx-da-fail" role="alert">
            {loadError}
          </p>
        )}
        {phase === "ready" && preview !== null && (
          <>
            <dl className="nx-da-facts">
              <div className="nx-da-fact">
                <dt>{L.drafts.previewTitle}</dt>
                <dd>{preview.title}</dd>
              </div>
            </dl>
            {showChildren && (
              <p className="nx-da-children" role="note">
                {L.docOps.childCount(preview.childCount ?? 0)}
              </p>
            )}
            {showDraftNote && (
              <p className="nx-da-note" role="note">
                {L.docOps.hasDraft}
              </p>
            )}
            {picksParent && (
              <label className="nx-da-field">
                <span>{L.docOps.target}</span>
                <select
                  aria-label={L.docOps.target}
                  value={parent}
                  disabled={sending}
                  onChange={(event) => setParent(event.target.value)}
                >
                  <option value="">{L.docOps.targetPick}</option>
                  {rows
                    .filter((row) => row.kind !== "unsupported")
                    .map((row) => (
                      <option key={`${row.kind}:${row.pageId}`} value={`${row.kind}:${row.pageId}`}>
                        {"\u00A0\u00A0".repeat(row.depth)}
                        {row.title}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {op === "copy" && (
              <label className="nx-da-field">
                <span>{L.docOps.newTitle}</span>
                <input
                  aria-label={L.docOps.newTitle}
                  value={title}
                  disabled={sending}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
            )}
            {blockerTexts.length > 0 && (
              <ul className="nx-da-blockers">
                {blockerTexts.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            {result !== null && result.state !== "applied" && (
              <p className="nx-da-result" role="status">
                {docOpResultLine(result)}
              </p>
            )}
            {error !== null && (
              <p className="nx-da-fail" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </ModalBody>
      <ModalFoot>
        <button
          type="button"
          className="nx-btn nx-btn--pri"
          disabled={!ready || sending || locked}
          onClick={() => void send()}
        >
          {sending ? (
            <>
              <Spin /> {L.docOps.sending}
            </>
          ) : (
            L.docOps.confirm(op)
          )}
        </button>
      </ModalFoot>
    </ModalFrame>
  );
}
