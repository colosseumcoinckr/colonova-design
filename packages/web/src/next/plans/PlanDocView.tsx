import { useEffect, useMemo, useRef } from "react";
import { Markdown } from "../../components/Markdown";
import { timeAgo } from "../../lib/format";
import { linkClick } from "../../lib/open-link";
import { L } from "../labels";
import { ExternalIcon, InfoIcon, Spin } from "../ui/icons";
import {
  docUrl,
  macroHeadings,
  type PlanListRow,
  planBodyBlocks,
  planCommentRows,
  splitFrontmatter,
} from "./plans-list";
import type { PlanDocBody, PlanPhase } from "./use-plans";

/**
 * 기획서 한 문서(2026-10-18 기획서 동기화 1단계 · M4 개선 패스) — 제목 · 판 · 고친 때 · Confluence 에서
 * 열기, 본문, 안 풀린 코멘트. 본문이 오기 전에도 제목과 판은 목록이 알아서 곧바로 선다 — 읽는 동안(몇 초
 * 걸린다: 문서와 코멘트는 그 자리에서 Confluence 에서 읽는다) 빈 화면을 보지 않게.
 */
export function PlanDocView({
  pageId,
  row,
  site,
  phase,
  doc,
  onRetry,
  onBack,
}: {
  pageId: string;
  /** 목록이 아는 이 문서의 줄 — 목록이 아직 없으면 null. */
  row: PlanListRow | null;
  /** 기획서 사이트 주소 — 없으면 Confluence 에서 열기 링크가 서지 않는다. */
  site: string | null;
  phase: PlanPhase;
  doc: PlanDocBody | null;
  onRetry: () => void;
  onBack: () => void;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  const parsed = useMemo(() => (doc === null ? null : splitFrontmatter(doc.markdown)), [doc]);
  const blocks = useMemo(() => (parsed === null ? [] : planBodyBlocks(parsed.body)), [parsed]);
  const comments = useMemo(
    () => (doc?.comments == null ? null : planCommentRows(doc.comments)),
    [doc],
  );
  const macros = doc === null ? [] : macroHeadings(doc.sections);

  // 문서가 열리면 초점이 제목으로 온다 — 키보드로 연 사람이 보이지 않는 목록 위에 남지 않게.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 문서가 바뀔 때만
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, [pageId]);

  const shownTitle = row?.title ?? parsed?.meta.title ?? "";
  const version = row?.version ?? parsed?.meta.version ?? null;
  const updatedAt = parsed?.meta.updatedAt ?? null;
  const link = site === null ? null : docUrl(site, pageId);

  return (
    <article className="nx-pl-doc" aria-busy={phase === "loading"}>
      <header className="nx-pl-doc-hd">
        <h3 className="nx-pl-doc-title" ref={title} tabIndex={-1}>
          {shownTitle}
        </h3>
        <div className="nx-pl-doc-meta">
          {version !== null && <span className="nx-pl-chip">{L.plans.docVersions(version)}</span>}
          {updatedAt !== null && <span>{L.plans.docUpdated(timeAgo(Date.parse(updatedAt)))}</span>}
          {row !== null && row.folder !== "" && (
            <span className="nx-pl-doc-folder">{row.folder}</span>
          )}
          {link !== null && (
            <a
              className="nx-pl-ext"
              href={link}
              target="_blank"
              rel="noreferrer"
              onClick={linkClick}
            >
              {L.plans.openInConfluence}
              <ExternalIcon />
            </a>
          )}
        </div>
      </header>

      {phase === "loading" && (
        <>
          <div className="nx-pl-skel" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <p className="nx-pl-note" role="status">
            <Spin /> {L.plans.reading}
            <span className="nx-pl-note-sub">{L.plans.readingNote}</span>
          </p>
        </>
      )}

      {phase === "failed" && (
        <div className="nx-pl-fail" role="alert">
          <p>{L.plans.docFailed}</p>
          <div className="nx-pl-fail-act">
            <button type="button" className="nx-btn nx-btn--sm" onClick={onRetry}>
              {L.plans.retry}
            </button>
            <button type="button" className="nx-btn nx-btn--sm nx-btn--ghost" onClick={onBack}>
              {L.plans.backToList}
            </button>
          </div>
        </div>
      )}

      {phase === "ready" && doc !== null && (
        <>
          {macros.length > 0 && (
            <div className="nx-pl-macro" role="note">
              <span className="nx-pl-macro-ic" aria-hidden="true">
                <InfoIcon />
              </span>
              <div>
                <b>{L.plans.macroNoteTitle}</b>
                <p>{L.plans.macroNoteBody}</p>
                <ul className="nx-pl-macro-list">
                  {macros.map((heading, at) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 머리말이 겹칠 수 있다 — 자리가 열쇠다
                    <li key={`${at}-${heading}`}>{heading}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <div className="nx-pl-body">
            {blocks.map((block, at) =>
              block.kind === "md" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: 본문 덩어리는 순서가 곧 자리다
                <Markdown key={at} text={block.text} />
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: 본문 덩어리는 순서가 곧 자리다
                <p key={at} className="nx-pl-note-box">
                  {block.text}
                </p>
              ),
            )}
          </div>
          {comments === null ? (
            <p className="nx-pl-note">{L.plans.commentsUnavailable}</p>
          ) : (
            comments.length > 0 && (
              <section className="nx-pl-comments">
                <h4 className="nx-pl-comments-t">{L.plans.commentHeading(comments.length)}</h4>
                <p className="nx-pl-note">{L.plans.commentNote}</p>
                <ul className="nx-pl-comment-list">
                  {comments.map((comment) => (
                    <li key={comment.key} className="nx-pl-comment">
                      <p className="nx-pl-comment-hd">
                        <b>{comment.author}</b>
                        {comment.when !== null && <span>{comment.when}</span>}
                      </p>
                      {comment.anchor !== null && (
                        <p className="nx-pl-comment-anchor">{comment.anchor}</p>
                      )}
                      <p className="nx-pl-comment-body">{comment.body}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )
          )}
        </>
      )}
    </article>
  );
}
