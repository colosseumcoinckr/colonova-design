import type { DocOpResult, DocTrashEntry } from "@colonova-design/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Daemon } from "../../../lib/daemon-client";
import { timeAgo } from "../../../lib/format";
import { L } from "../../labels";
import { RefreshIcon, Spin, TrashIcon } from "../../ui/icons";
import { ModalBody, ModalFrame, ModalHead } from "../../ui/ModalFrame";
import { DocOpDialog } from "./DocOpDialog";
import "./doc-actions.css";

/**
 * 휴지통 창(2026-10-23 · 최종 구현 계획 F4) — 기획서 목록 머리의 `휴지통` 이 여는 한 장. 이 앱이
 * 휴지통으로 옮긴 문서의 목록이 서고, 줄마다 복구가 확인 창(`DocOpDialog`)을 거쳐 닿는다.
 * 영구 삭제는 없다 — Confluence 의 휴지통에서도 되살릴 수 있어요.
 */
export function TrashDialog({
  daemon,
  onApplied,
  onClose,
}: {
  daemon: Daemon;
  /** 복구가 마쳤음 — 기획서 목록을 다시 읽는 일은 부르는 쪽의 몫이다. */
  onApplied: (result: DocOpResult) => void;
  onClose: () => void;
}) {
  const apiRef = useRef(daemon.api);
  apiRef.current = daemon.api;
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [entries, setEntries] = useState<DocTrashEntry[]>([]);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(() => {
    apiRef.current
      .docTrashed()
      .then((reply) => {
        setEntries(reply.entries);
        setPhase("ready");
      })
      .catch(() => setPhase("failed"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const applied = (result: DocOpResult) => {
    setRestoring(null);
    load();
    onApplied(result);
  };

  return (
    <ModalFrame onClose={onClose} label={L.docOps.trashTitle} className="nx-da nx-da-trash">
      <ModalHead title={L.docOps.trashTitle} sub={L.docOps.trashEmptyBody} />
      <ModalBody>
        {phase === "loading" && (
          <p className="nx-da-note" role="status">
            <Spin /> {L.docOps.trashLoading}
          </p>
        )}
        {phase === "failed" && (
          <div className="nx-banner nx-banner--red nx-da-failed" role="alert">
            <p>{L.docOps.trashListFailed}</p>
            <button type="button" className="nx-btn nx-btn--sm" onClick={load}>
              <RefreshIcon />
              {L.plans.retry}
            </button>
          </div>
        )}
        {phase === "ready" && entries.length === 0 && (
          <div className="nx-empty">
            <span className="nx-empty-mark" aria-hidden="true">
              <TrashIcon />
            </span>
            <b className="nx-empty-title">{L.docOps.trashEmptyTitle}</b>
          </div>
        )}
        {phase === "ready" && entries.length > 0 && (
          <ul className="nx-da-trash-list">
            {entries.map((entry) => (
              <li key={entry.pageId} className="nx-da-trash-row">
                <span className="nx-da-trash-t">{entry.title}</span>
                <span className="nx-da-trash-when">
                  {L.docOps.trashedAt(timeAgo(Date.parse(entry.trashedAt)))}
                </span>
                <button
                  type="button"
                  className="nx-btn nx-btn--sm"
                  disabled={restoring !== null}
                  onClick={() => setRestoring(entry.pageId)}
                >
                  {L.docOps.restore}
                </button>
              </li>
            ))}
          </ul>
        )}
      </ModalBody>
      {restoring !== null && (
        <DocOpDialog
          daemon={daemon}
          op="restore"
          pageId={restoring}
          onApplied={applied}
          onClose={() => setRestoring(null)}
        />
      )}
    </ModalFrame>
  );
}
