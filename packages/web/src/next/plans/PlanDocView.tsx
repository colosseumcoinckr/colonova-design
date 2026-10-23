import type { DocOpResult, DraftSummary } from "@colonova-design/protocol";
import { useEffect, useMemo, useRef } from "react";
import { Markdown } from "../../components/Markdown";
import type { Daemon } from "../../lib/daemon-client";
import { timeAgo } from "../../lib/format";
import { L } from "../labels";
import type { ShellNav } from "../slots";
import { InfoIcon, Spin } from "../ui/icons";
import { DocComments } from "./comments/DocComments";
import { PlansEmpty } from "./PlansEmpty";
import { macroHeadings, type PlanListRow, planBodyBlocks, splitFrontmatter } from "./plans-list";
import type { PlanDocBody, PlanPhase } from "./use-plans";

/** 종이 한 장에 제목 · 판 · 본문 · 코멘트를 놓는다. 동작은 PlansHeader 가 맡는다(2026-10-23 화면 전면 재설계 §4 C). */
export function PlanDocView({
  pageId,
  row,
  phase,
  doc,
  draft,
  daemon,
  onRetry,
  onBack,
  onRefresh,
  writable,
  focusTitle = true,
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
  focusTitle?: boolean;
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
    if (focusTitle) title.current?.focus({ preventScroll: true });
  }, [pageId]);

  const shownTitle = row?.title ?? parsed?.meta.title ?? "";
  const version = row?.version ?? parsed?.meta.version ?? null;
  const updatedAt = parsed?.meta.updatedAt ?? null;
  if (phase === "failed")
    return (
      <article className="nx-pl-doc--failed" role="alert">
        <PlansEmpty title={L.plans.docFailed}>
          <button type="button" className="nx-btn" onClick={onRetry}>
            {L.plans.retry}
          </button>
          <button type="button" className="nx-btn nx-btn--ghost" onClick={onBack}>
            {L.plans.backToList}
          </button>
        </PlansEmpty>
      </article>
    );
  return (
    <article className="nx-pl-doc" aria-busy={phase === "loading"}>
      <header className="nx-pl-doc-hd">
        <h3 className="nx-pl-doc-title" ref={title} tabIndex={-1}>
          {shownTitle}
        </h3>
        <div className="nx-pl-doc-meta">
          {version !== null && <span>{L.plans.docVersions(version)}</span>}
          {updatedAt !== null && <span>{L.plans.docUpdated(timeAgo(Date.parse(updatedAt)))}</span>}
          {draft !== null && <span>{L.plans.hasDraft}</span>}
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

      {phase === "ready" && doc !== null && (
        <>
          {macros.length > 0 && (
            <div className="nx-banner nx-banner--blue nx-pl-macro" role="note">
              <span className="nx-pl-macro-ic" aria-hidden="true">
                <InfoIcon />
              </span>
              <div className="nx-banner-body">
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
    </article>
  );
}
