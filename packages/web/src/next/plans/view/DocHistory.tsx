import type { DocVersion, DocVersionBody } from "@colonova-design/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Daemon } from "../../../lib/daemon-client";
import { timeAgo } from "../../../lib/format";
import { L } from "../../labels";
import { ArrowLeftIcon, RefreshIcon, Spin } from "../../ui/icons";
import { ModalBody, ModalFrame, ModalHead } from "../../ui/ModalFrame";
import { DocView } from "./DocView";

/**
 * 판 기록(2026-10-30 사용자 요청) — Confluence 에 올라간 판을 최근 것부터(번호 · 쓴 사람 · 때 · 남긴 말)
 * 읽고, 옛 판 한 장을 읽기 전용으로 연다. 되돌리기 같은 쓰기는 없다 — 고치는 길은 초안(→ 발행)이다.
 */
export function DocHistory({
  daemon,
  pageId,
  title,
  current,
  onClose,
}: {
  daemon: Daemon;
  pageId: string;
  title: string;
  /** 지금 판 — 목록에서 `지금 판` 이 붙는다. 모르면 null. */
  current: number | null;
  onClose: () => void;
}) {
  const apiRef = useRef(daemon.api);
  apiRef.current = daemon.api;
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [versions, setVersions] = useState<DocVersion[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [body, setBody] = useState<DocVersionBody | null>(null);
  const [bodyPhase, setBodyPhase] = useState<"loading" | "ready" | "failed">("loading");
  const seq = useRef(0);

  const load = useCallback(() => {
    setPhase("loading");
    apiRef.current
      .docVersions(pageId)
      .then((reply) => {
        setVersions(reply.versions);
        setPhase("ready");
      })
      .catch(() => setPhase("failed"));
  }, [pageId]);

  useEffect(() => {
    load();
  }, [load]);

  const view = (version: number) => {
    seq.current += 1;
    const mine = seq.current;
    setOpen(version);
    setBody(null);
    setBodyPhase("loading");
    apiRef.current
      .docVersionRead(pageId, version)
      .then((reply) => {
        if (mine !== seq.current) return;
        setBody(reply);
        setBodyPhase("ready");
      })
      .catch(() => {
        if (mine === seq.current) setBodyPhase("failed");
      });
  };

  return (
    <ModalFrame onClose={onClose} label={L.confluence.history} className="nx-da">
      <ModalHead title={`${L.confluence.history} · ${title}`} sub={L.confluence.historySub} />
      <ModalBody>
        {open === null ? (
          <div className="nx-dm-hist">
            {phase === "loading" && (
              <p className="nx-dm-line" role="status">
                <Spin /> {L.confluence.historyLoading}
              </p>
            )}
            {phase === "failed" && (
              <div className="nx-banner nx-banner--red" role="alert">
                <p className="nx-banner-body">{L.confluence.historyFailed}</p>
                <button type="button" className="nx-btn nx-btn--sm nx-banner-act" onClick={load}>
                  <RefreshIcon />
                  {L.plans.retry}
                </button>
              </div>
            )}
            {phase === "ready" && (
              <ul>
                {versions.map((version) => (
                  <li key={version.number} className="nx-li">
                    <span className="nx-li-main">
                      <span className="nx-li-title">
                        {L.plans.docVersions(version.number)}
                        {version.number === current && ` · ${L.confluence.historyCurrent}`}
                        {version.minorEdit && ` · ${L.confluence.historyMinor}`}
                      </span>
                      <span className="nx-li-sub">
                        {L.confluence.historyBy(
                          version.author,
                          version.createdAt === null ? "" : timeAgo(Date.parse(version.createdAt)),
                        )}
                      </span>
                      {version.message !== "" && (
                        <span className="nx-dm-hist-msg">{version.message}</span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="nx-btn nx-btn--sm"
                      onClick={() => view(version.number)}
                    >
                      {L.confluence.historyView}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="nx-dm-hist">
            <div>
              <button
                type="button"
                className="nx-btn nx-btn--sm nx-btn--ghost"
                onClick={() => {
                  seq.current += 1;
                  setOpen(null);
                }}
              >
                <ArrowLeftIcon />
                {L.confluence.historyBack}
              </button>
            </div>
            <p className="nx-dm-line">{L.confluence.versionNote(open)}</p>
            {bodyPhase === "loading" && (
              <p className="nx-dm-line" role="status">
                <Spin /> {L.confluence.versionReading}
              </p>
            )}
            {bodyPhase === "failed" && (
              <div className="nx-banner nx-banner--red" role="alert">
                <p className="nx-banner-body">{L.confluence.versionFailed}</p>
                <button
                  type="button"
                  className="nx-btn nx-btn--sm nx-banner-act"
                  onClick={() => view(open)}
                >
                  <RefreshIcon />
                  {L.plans.retry}
                </button>
              </div>
            )}
            {bodyPhase === "ready" && body !== null && (
              <div className="nx-dm-old nx-pl-body">
                <h3 className="nx-pl-doc-title">{body.title}</h3>
                <DocView blocks={body.view} api={daemon.api} pageId={pageId} />
              </div>
            )}
          </div>
        )}
      </ModalBody>
    </ModalFrame>
  );
}
