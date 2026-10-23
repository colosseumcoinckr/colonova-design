import type { DocOpResult, DraftSummary } from "@colonova-design/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "../../components/Markdown";
import type { Daemon } from "../../lib/daemon-client";
import { timeAgo } from "../../lib/format";
import { linkClick } from "../../lib/open-link";
import { L } from "../labels";
import type { ShellNav } from "../slots";
import { ExternalIcon, InfoIcon, PencilIcon, Spin } from "../ui/icons";
import { DocComments } from "./comments/DocComments";
import { DocActions } from "./doc-actions/DocActions";
import { SendToScreen } from "./doc-actions/SendToScreen";
import {
  docUrl,
  macroHeadings,
  type PlanListRow,
  planBodyBlocks,
  splitFrontmatter,
} from "./plans-list";
import type { PlanDocBody, PlanPhase } from "./use-plans";

/**
 * 기획서 한 문서(2026-10-18 기획서 동기화 1단계 · M4 개선 패스) — 제목 · 판 · 고친 때 · Confluence 에서
 * 열기, 본문, 안 풀린 코멘트. 본문이 오기 전에도 제목과 판은 목록이 알아서 곧바로 선다 — 읽는 동안(몇 초
 * 걸린다: 문서와 코멘트는 그 자리에서 Confluence 에서 읽는다) 빈 화면을 보지 않게. 머리에는 화면 작업에
 * 근거 보내기와 문서 관리(복제 · 위치 옮기기 · 휴지통)가 함께 선다(2026-10-23 · 최종 구현 계획 F3 · F4).
 */
export function PlanDocView({
  pageId,
  row,
  site,
  phase,
  doc,
  draft,
  daemon,
  nav,
  rows,
  onRetry,
  onBack,
  onEdit,
  onApplied,
  onRefresh,
  writable,
}: {
  pageId: string;
  /** 목록이 아는 이 문서의 줄 — 목록이 아직 없으면 null. */
  row: PlanListRow | null;
  /** Confluence 사이트 주소 — 없으면 Confluence 에서 열기 링크가 서지 않는다. */
  site: string | null;
  phase: PlanPhase;
  doc: PlanDocBody | null;
  /** 이 문서의 초안 요약 — 있으면 고치기가 `초안 이어 쓰기` 가 된다(2026-10-23 · 최종 구현 계획 F2). */
  draft: DraftSummary | null;
  daemon: Daemon;
  nav: ShellNav;
  /** 목록의 줄 — 문서 관리의 들어갈 자리 고르기가 읽는다. */
  rows: PlanListRow[];
  onRetry: () => void;
  onBack: () => void;
  /** 고치기 — 이 문서의 초안 편집기를 연다(2026-10-23 · 최종 구현 계획 F1). */
  onEdit: (pageId: string) => void;
  /** 문서 관리가 마쳤음 — 목록을 다시 읽고(copy 면) 새 문서를 여는 일은 칸의 몫이다. */
  onApplied: (result: DocOpResult) => void;
  /** 문서를 조용히 다시 읽기 — 코멘트 쓰기가 마친 뒤 답만 바꾼다(2026-10-23 · 최종 구현 계획 F4). */
  onRefresh: (pageId: string) => void;
  /** 이 앱이 Confluence 에 쓸 수 있는가(발행 게이트) — 코멘트 절이 쓰기 전에 꺼짐을 말한다(2026-10-23 U2). */
  writable?: boolean;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  // 본문 덩어리 — 인라인 코멘트의 닻 단추가 듣는 자리다(2026-10-23 · 최종 구현 계획 F4).
  const body = useRef<HTMLDivElement>(null);
  const parsed = useMemo(() => (doc === null ? null : splitFrontmatter(doc.markdown)), [doc]);
  const blocks = useMemo(() => (parsed === null ? [] : planBodyBlocks(parsed.body)), [parsed]);
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
  // 근거 보내기의 절 목록 — 읽은 문서의 머리말이다(2026-10-23 · 최종 구현 계획 F3). 읽기 전이면
  // 문서 전체만 담는다.
  const [sendOpen, setSendOpen] = useState(false);
  const sections = useMemo(
    () => (doc === null ? [] : doc.sections.map((section) => section.heading)),
    [doc],
  );

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
          <button type="button" className="nx-btn nx-btn--sm" onClick={() => setSendOpen(true)}>
            {L.drafts.sendToScreen}
          </button>
          {/* 기획자의 다음 손은 고치기다 — 으뜸 단추로 세운다(2026-10-23 기획자 화면 손질 D6). */}
          <button
            type="button"
            className="nx-btn nx-btn--sm nx-btn--pri"
            onClick={() => onEdit(pageId)}
          >
            <PencilIcon />
            {draft !== null ? L.drafts.resume : L.drafts.edit}
          </button>
          <DocActions daemon={daemon} pageId={pageId} rows={rows} onApplied={onApplied} />
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
          <div className="nx-pl-body" ref={body}>
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
          {/* 코멘트 절 — 스레드로 읽고 바닥글 · 인라인 · 답글 · 고침 · 해결로 쓴다(정본 계획 §9). */}
          <DocComments
            daemon={daemon}
            pageId={pageId}
            comments={doc.comments}
            body={body}
            onRefresh={onRefresh}
            writable={writable}
          />
        </>
      )}
      {sendOpen && (
        <SendToScreen
          daemon={daemon}
          nav={nav}
          target={{ pageId }}
          sections={sections}
          onClose={() => setSendOpen(false)}
        />
      )}
    </article>
  );
}
