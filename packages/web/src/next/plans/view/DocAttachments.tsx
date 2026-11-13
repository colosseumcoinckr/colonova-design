import type { DocAttachment } from "@colonova-design/protocol";
import { Paperclip } from "lucide-react";
import { useState } from "react";
import type { Daemon } from "../../../lib/daemon-client";
import { timeAgo } from "../../../lib/format";
import { L } from "../../labels";
import { DownloadIcon, Spin } from "../../ui/icons";
import { downloadAttachment } from "./use-attachment";

/**
 * 본문 아래의 첨부 목록(2026-10-30 사용자 요청) — 이름 · 크기 · 올린 때와 `내려받기`. 바이트는 데몬이 앱의
 * 자격으로 받아 건넨다. 10MB 가 넘으면 Confluence 에서 받게 한다. 첨부가 없으면 절이 서지 않는다.
 */
export function DocAttachments({
  daemon,
  pageId,
  attachments,
}: {
  daemon: Daemon;
  pageId: string;
  attachments: DocAttachment[] | null | undefined;
}) {
  if (attachments === undefined) return null;
  if (attachments === null)
    return <p className="nx-dm-line">{L.confluence.attachmentsUnavailable}</p>;
  if (attachments.length === 0) return null;
  return (
    <section className="nx-dm-att" aria-label={L.confluence.attachmentsHeading(attachments.length)}>
      <h4>{L.confluence.attachmentsHeading(attachments.length)}</h4>
      <ul>
        {attachments.map((attachment) => (
          <AttachmentRow
            key={attachment.id}
            daemon={daemon}
            pageId={pageId}
            attachment={attachment}
          />
        ))}
      </ul>
    </section>
  );
}

function AttachmentRow({
  daemon,
  pageId,
  attachment,
}: {
  daemon: Daemon;
  pageId: string;
  attachment: DocAttachment;
}) {
  const [phase, setPhase] = useState<"idle" | "busy" | "failed" | "too-large">("idle");
  const sub = [
    attachment.size === null ? null : L.confluence.size(attachment.size),
    attachment.createdAt === null ? null : timeAgo(Date.parse(attachment.createdAt)),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
  return (
    <li className="nx-li">
      <Paperclip className="nx-i" size={16} aria-hidden="true" />
      <span className="nx-li-main">
        <span className="nx-li-title" title={attachment.title}>
          {attachment.title}
        </span>
        {phase === "failed" || phase === "too-large" ? (
          <span className="nx-li-sub nx-dm-line--bad" role="alert">
            {phase === "failed" ? L.confluence.downloadFailed : L.confluence.tooLarge}
          </span>
        ) : (
          sub !== "" && <span className="nx-li-sub">{sub}</span>
        )}
      </span>
      <button
        type="button"
        className="nx-btn nx-btn--sm nx-btn--ghost"
        aria-label={L.confluence.downloadOf(attachment.title)}
        disabled={phase === "busy"}
        onClick={() => {
          setPhase("busy");
          void downloadAttachment(daemon.api, pageId, attachment.title).then((done) =>
            setPhase(done === "ok" ? "idle" : done),
          );
        }}
      >
        {phase === "busy" ? <Spin /> : <DownloadIcon />}
        {phase === "busy" ? L.confluence.downloading : L.confluence.download}
      </button>
    </li>
  );
}
