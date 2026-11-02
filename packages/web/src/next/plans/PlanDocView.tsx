import type { DocOpResult, DraftCompareResult, DraftSummary } from "@colonova-design/protocol";
import { Link2, Maximize2, Monitor } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "../../components/Markdown";
import type { Daemon, MapReadResult } from "../../lib/daemon-client";
import { timeAgo } from "../../lib/format";
import { openScreenPath } from "../../lib/screen-link";
import { L } from "../labels";
import { applyMismatchToDraft, offerMismatchToComposer } from "../lib/mismatch-model";
import type { ShellNav } from "../slots";
import { CloseIcon, InfoIcon, SparkIcon, Spin } from "../ui/icons";
import { MismatchCard, type MismatchHand } from "../ui/MismatchCard";
import { DocComments } from "./comments/DocComments";
import { DocMenu } from "./doc-actions/DocMenu";
import { PlansEmpty } from "./PlansEmpty";
import { macroHeadings, type PlanListRow, planBodyBlocks, splitFrontmatter } from "./plans-list";
import type { PlanDocBody, PlanPhase } from "./use-plans";
import { DocAttachments } from "./view/DocAttachments";
import { DocHistory } from "./view/DocHistory";
import { DocLabels } from "./view/DocLabels";
import { DocView } from "./view/DocView";
import { unknownMacros } from "./view/doc-view-model";

/** 종이 한 장에 제목 · 판 · 본문 · 코멘트를 놓는다. 동작은 PlansHeader 가 맡는다(2026-10-23 화면 전면 재설계 §4 C). */
export function PlanDocView({
  pageId,
  row,
  phase,
  docError,
  doc,
  draft,
  daemon,
  rows,
  onRetry,
  onBack,
  onRefresh,
  onOpenPage,
  site,
  nav,
  onApplied,
  writable,
  onSelectionAsk,
  focusTitle = true,
}: {
  pageId: string;
  /** 목록이 아는 이 문서의 줄 — 목록이 아직 없으면 null. */
  row: PlanListRow | null;
  /** Confluence 사이트 주소 — 없으면 Confluence 에서 열기 링크가 서지 않는다. */
  site: string | null;
  phase: PlanPhase;
  /** 마지막 읽기의 실패 문장 — 실패 면이 원인별 말을 고른다(2026-11-02 실사용 관찰). */
  docError: string | null;
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
  /** 본문의 다른 기획 문서 링크 — 목록의 그 문서를 연다(2026-10-30 사용자 요청). */
  onOpenPage?: (pageId: string) => void;
  /** 고른 글로 묻기(2026-10-31 4단계) — 고른 글이 기획 대화 입력창 위 칩으로 붙는다. */
  onSelectionAsk?: (text: string) => void;
  focusTitle?: boolean;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  // 본문 덩어리 — 인라인 코멘트의 닻 단추가 듣는 자리다(2026-10-23 · 최종 구현 계획 F4).
  const body = useRef<HTMLDivElement>(null);
  const parsed = useMemo(() => (doc === null ? null : splitFrontmatter(doc.markdown)), [doc]);
  const blocks = useMemo(() => (parsed === null ? [] : planBodyBlocks(parsed.body)), [parsed]);
  // 보기 블록(2026-10-30)이 있으면 상자 · 상태 · 목차 · 그림까지 그리고, 알림은 그리지 못한 매크로만 말한다.
  const view = doc?.view;
  const unknown = useMemo(() => (view === undefined ? [] : unknownMacros(view)), [view]);
  const macros = doc === null || view !== undefined ? [] : macroHeadings(doc.sections);
  const [history, setHistory] = useState(false);
  // 서랍(2026-10-31 D) — 코멘트 · 이어진 화면이 문서 판 안에서 열린다(대화 칸 쪽 가장자리에서 나온다).
  const [drawer, setDrawer] = useState<"comments" | "screens" | null>(null);
  // 이어진 화면(연결 자리를 걷은 뒤 연결을 보는 곳 · 2026-10-30 사용자 결정) — 서랍이 열릴 때 읽는다.
  const [links, setLinks] = useState<MapReadResult["links"] | null>(null);
  const [screenTitles, setScreenTitles] = useState<ReadonlyMap<string, string>>(new Map());
  // 같이 고침으로 닿은 화면(2026-11-02 · 같이 고치기 UX 계획 C4) — 연결 파일 줄 아래 기록 도출 줄로 보인다.
  const [syncedScreens, setSyncedScreens] = useState<Array<{
    route: string;
    title: string | null;
    at: string;
  }> | null>(null);
  const [unlinkNote, setUnlinkNote] = useState<string | null>(null);
  useEffect(() => {
    if (drawer !== "screens") return;
    let live = true;
    daemon.api
      .mapRead()
      .then((result) => {
        if (!live) return;
        setLinks(result.links.filter((link) => link.pageId === pageId));
        setScreenTitles(
          new Map(
            result.screens
              .filter((screen) => screen.title !== null)
              .map((screen) => [screen.route, screen.title ?? ""]),
          ),
        );
      })
      .catch(() => {
        if (live) setLinks([]);
      });
    daemon.api
      .draftSyncScreens(pageId)
      .then((result) => {
        if (live) setSyncedScreens(result.screens);
      })
      .catch(() => {
        if (live) setSyncedScreens([]);
      });
    return () => {
      live = false;
    };
  }, [daemon.api, drawer, pageId]);
  // 화면과 맞춰 보기(2026-11-02 · 같이 고치기 UX 계획 C7) — 판정만 돌고 어디에도 쓰지 않는다.
  const [comparing, setComparing] = useState(false);
  const [compareFailed, setCompareFailed] = useState(false);
  const [compareResult, setCompareResult] = useState<DraftCompareResult | null>(null);
  const runCompare = async () => {
    if (comparing) return;
    setComparing(true);
    setCompareFailed(false);
    try {
      setCompareResult(await daemon.api.draftCompare(pageId));
    } catch {
      setCompareFailed(true);
    } finally {
      setComparing(false);
    }
  };
  const compareHand: MismatchHand = {
    apply:
      compareResult === null
        ? undefined
        : (row) =>
            applyMismatchToDraft({
              api: daemon.api,
              brief: L.compare.applyBrief(row),
              pageId,
              docKey: compareResult.docKey,
            }).then(() => nav.toast(L.compare.appliedToast)),
    send: (row) =>
      offerMismatchToComposer({
        api: daemon.api,
        brief: L.compare.sendBrief(row, compareResult?.title ?? shownTitle),
        target: { pageId },
      }).then((taken) => {
        if (!taken) throw new Error("composer away");
        nav.showTab("chat");
        nav.toast(L.compare.sentToast);
      }),
    decline: (row) => daemon.api.draftCompareDecline(pageId, row.screenName).then(() => undefined),
  };
  // 고른 글의 작은 판(2026-10-31 4단계) — 문장을 고르면 `AI 에게 묻기` 가 선다.
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const onBodyMouseUp = () => {
    const pick = window.getSelection()?.toString() ?? "";
    const box = body.current?.getBoundingClientRect();
    if (pick.trim() === "" || box === undefined) {
      setSelection(null);
      return;
    }
    const rect = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
    setSelection({
      text: pick.trim(),
      x: rect === undefined ? box.width / 2 : rect.left - box.left + rect.width / 2,
      y: rect === undefined ? 0 : rect.bottom - box.top + 8,
    });
  };
  const commentCount = doc?.comments?.filter((one) => one.resolved !== true).length ?? 0;
  const screenCount = links?.length ?? 0;
  // 본문의 문서 링크 — 목록에서 같은 제목의 문서를 찾는다(같은 제목이 여럿이면 첫 줄).
  const openPage = (target: string): boolean => {
    const found = rows.find((one) => one.kind === "doc" && one.title === target);
    if (found === undefined || onOpenPage === undefined) return false;
    onOpenPage(found.pageId);
    return true;
  };

  // 문서가 열리면 초점이 제목으로 온다 — 키보드로 연 사람이 보이지 않는 목록 위에 남지 않게.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 문서가 바뀔 때만
  useEffect(() => {
    if (focusTitle) title.current?.focus({ preventScroll: true });
  }, [pageId]);

  const shownTitle = row?.title ?? parsed?.meta.title ?? "";
  const version = row?.version ?? parsed?.meta.version ?? null;
  const updatedAt = parsed?.meta.updatedAt ?? null;
  if (phase === "failed") {
    // 실패 사본을 원인별로 고른다(2026-11-02 실사용 관찰). 데몬의 한국어 문장은 그 문장이
    // 사용자의 말이다 — 연결이 필요한 경우(`docFailedConnectMark` 머리)는 연결 사본이,
    // 그 밖의 한국어 문장은 그 문장이, 글자만 남는 기계 탓(fetch failed 같은)은 인터넷 사본이 선다.
    const detail = docError ?? "";
    const connectNeeded = detail.startsWith(L.plans.docFailedConnectMark);
    const body = connectNeeded
      ? L.plans.docFailedConnect
      : /[\p{Script=Hangul}]/u.test(detail)
        ? detail
        : L.plans.docFailedNet;
    return (
      <article className="nx-pl-doc--failed" role="alert">
        <PlansEmpty title={L.plans.docFailedTitle} body={body}>
          <button type="button" className="nx-btn" onClick={onRetry}>
            {L.plans.retry}
          </button>
          <button type="button" className="nx-btn nx-btn--ghost" onClick={onBack}>
            {L.plans.backToList}
          </button>
        </PlansEmpty>
      </article>
    );
  }
  return (
    <article className="nx-pl-doc" aria-busy={phase === "loading"}>
      <header className="nx-pl-doc-hd">
        <div className="nx-pl-doc-titleline">
          <h3 className="nx-pl-doc-title" ref={title} tabIndex={-1}>
            {shownTitle}
          </h3>
          {/* 판을 넓혀 대화를 접는다(2026-10-31 A — Claude 앱의 판 넓히기). */}
          <button
            type="button"
            className="nx-ibtn nx-pl-doc-expand"
            title={L.drafts.threadExpand}
            aria-label={L.drafts.threadExpand}
            onClick={() => window.dispatchEvent(new Event("nx:plans-expand-chat"))}
          >
            <Maximize2 className="nx-i" size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        <div className="nx-pl-doc-meta">
          {version !== null && <span>{L.plans.docVersions(version)}</span>}
          {updatedAt !== null && <span>{L.plans.docUpdated(timeAgo(Date.parse(updatedAt)))}</span>}
          {draft !== null && <span>{L.plans.hasDraft}</span>}
        </div>
        {phase === "ready" && doc !== null && (
          <DocLabels
            daemon={daemon}
            pageId={pageId}
            labels={doc.labels}
            writable={writable === true}
            onRefresh={onRefresh}
          />
        )}
        {/* 머리의 동작은 자리가 고정이다(2026-10-31 C) — 읽기에서 으뜸 자리는 비고(말로 고치는 곳)다. */}
        <div className="nx-pl-doc-acts">
          {writable === false && (
            <span className="nx-pill nx-dr-writeoff" title={L.drafts.writeOffHint} role="note">
              {L.drafts.writeOff}
            </span>
          )}
          {/* 화면과 맞춰 보기(2026-11-02 C7) — 문서 곁에서 어긋난 곳을 찾는다. 판정만 보이고 손이 방향을 고른다. */}
          {phase === "ready" && (
            <button
              type="button"
              className="nx-btn nx-btn--sm"
              disabled={comparing}
              onClick={() => void runCompare()}
            >
              {comparing ? <Spin /> : null}
              {L.compare.run}
            </button>
          )}
          <DocMenu
            daemon={daemon}
            site={site}
            pageId={pageId}
            rows={rows}
            onApplied={onApplied}
            onHistory={() => setHistory(true)}
          />
        </div>
      </header>
      {history && (
        <DocHistory
          daemon={daemon}
          pageId={pageId}
          title={shownTitle}
          current={version}
          onClose={() => setHistory(false)}
        />
      )}

      {/* 맞춰 보기의 결과(2026-11-02 C7) — 어긋남이 없으면 아무것도 서지 않는다. */}
      {compareResult !== null && compareResult.rows.length > 0 && (
        <MismatchCard
          title={compareResult.title}
          source={compareResult.source}
          rows={compareResult.rows}
          note={compareResult.note}
          hand={compareHand}
        />
      )}
      {compareResult !== null && compareResult.rows.length === 0 && (
        <p className="nx-pl-note" role="status">
          {L.compare.same}
        </p>
      )}
      {compareFailed && (
        <p className="nx-pl-note" role="alert">
          {L.compare.failed}
        </p>
      )}

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
          {unknown.length > 0 && (
            <div className="nx-banner nx-banner--blue nx-pl-macro" role="note">
              <span className="nx-pl-macro-ic" aria-hidden="true">
                <InfoIcon />
              </span>
              <div className="nx-banner-body">
                <b>{L.confluence.macroBanner}</b>
                <p>{L.confluence.macroBannerBody(unknown.join(" · "))}</p>
              </div>
            </div>
          )}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: 본문의 글 고르기(2026-10-31 4단계)가 본문 전체의 손이다 */}
          {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: 본문의 글 고르기(2026-10-31 4단계)가 본문 전체의 손이다 */}
          <div className="nx-pl-body" ref={body} onMouseUp={onBodyMouseUp}>
            {view !== undefined ? (
              <DocView
                blocks={view}
                api={daemon.api}
                pageId={pageId}
                openPage={onOpenPage === undefined ? undefined : openPage}
              />
            ) : (
              blocks.map((block, at) =>
                block.kind === "md" ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 본문 덩어리는 순서가 곧 자리다
                  <Markdown key={at} text={block.text} />
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 본문 덩어리는 순서가 곧 자리다
                  <p key={at} className="nx-pl-note-box">
                    {block.text}
                  </p>
                ),
              )
            )}
          </div>
          <DocAttachments daemon={daemon} pageId={pageId} attachments={doc.attachments} />
        </>
      )}

      {/* 판 바닥의 두 줄 단추(2026-10-31 C) — 서랍은 문서 판 안에서 대화 칸 쪽 가장자리에서 나온다. */}
      {phase === "ready" && doc !== null && (
        <div className="nx-pl-foot">
          <button
            type="button"
            className={`nx-pl-footbtn${drawer === "comments" ? " nx-pl-footbtn--on" : ""}`}
            aria-expanded={drawer === "comments"}
            onClick={() => setDrawer((before) => (before === "comments" ? null : "comments"))}
          >
            {L.plans.drawerComments(commentCount)}
          </button>
          <button
            type="button"
            className={`nx-pl-footbtn${drawer === "screens" ? " nx-pl-footbtn--on" : ""}`}
            aria-expanded={drawer === "screens"}
            onClick={() => setDrawer((before) => (before === "screens" ? null : "screens"))}
          >
            {L.plans.drawerScreens(screenCount)}
          </button>
        </div>
      )}

      {/* 코멘트 서랍(2026-10-31 D) — 지금 본문 아래에 있던 코멘트 절이 옮겨 왔다. */}
      {phase === "ready" && doc !== null && drawer === "comments" && (
        <aside className="nx-pl-drawer" aria-label={L.plans.drawerComments(commentCount)}>
          <header className="nx-pl-drawer-hd">
            <h3>{L.plans.drawerComments(commentCount)}</h3>
            <button
              type="button"
              className="nx-ibtn nx-ibtn--sm"
              aria-label={L.plans.drawerClose}
              onClick={() => setDrawer(null)}
            >
              <CloseIcon />
            </button>
          </header>
          {writable === false && (
            <p className="nx-banner nx-banner--amber nx-pl-drawer-note" role="status">
              <InfoIcon />
              {L.drafts.writeOffHint}
            </p>
          )}
          <div className="nx-pl-drawer-body">
            <DocComments
              daemon={daemon}
              pageId={pageId}
              comments={doc.comments}
              body={body}
              onRefresh={onRefresh}
              writable={writable}
            />
          </div>
        </aside>
      )}

      {/* 이어진 화면 서랍(2026-10-31 D) — 연결 자리를 걷은 뒤 연결을 보는 곳이 옮겨 왔다. */}
      {phase === "ready" && drawer === "screens" && (
        <aside className="nx-pl-drawer" aria-label={L.plans.drawerScreens(screenCount)}>
          <header className="nx-pl-drawer-hd">
            <h3>
              <Monitor className="nx-i" size={14} aria-hidden="true" />
              {L.plans.drawerScreens(screenCount)}
            </h3>
            <button
              type="button"
              className="nx-ibtn nx-ibtn--sm"
              aria-label={L.plans.drawerClose}
              onClick={() => setDrawer(null)}
            >
              <CloseIcon />
            </button>
          </header>
          <div className="nx-pl-drawer-body">
            {links === null ? (
              <p className="nx-pl-note">
                <Spin /> {L.plans.reading}
              </p>
            ) : links.length === 0 && (syncedScreens ?? []).length === 0 ? (
              <p className="nx-pl-note">{L.plans.docScreensNone}</p>
            ) : (
              <>
                <ul className="nx-pl-scrlist">
                  {links.map((link) => (
                    <li
                      key={`${link.route}
${link.section ?? ""}`}
                      className="nx-pl-scrrow"
                    >
                      <Link2 className="nx-i" size={14} aria-hidden="true" />
                      <span className="nx-pl-scrname">
                        {screenTitles.get(link.route) || L.transcript.unknownScreen}
                        {link.section !== null && (
                          <span className="nx-pl-scrsub">{link.section}</span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="nx-btn nx-btn--sm nx-btn--ghost"
                        onClick={() => {
                          nav.showScreen();
                          if (!openScreenPath(link.route)) {
                            void window.colonovaDesignDesktop?.preview?.navigate?.(link.route);
                          }
                        }}
                      >
                        {L.plans.docScreenOpen}
                      </button>
                      <button
                        type="button"
                        className="nx-btn nx-btn--sm nx-btn--ghost"
                        onClick={() => {
                          setUnlinkNote(null);
                          void daemon.api
                            .mapWrite([
                              {
                                op: "remove",
                                pageId: link.pageId,
                                route: link.route,
                                ...(link.section ? { section: link.section } : {}),
                              },
                            ])
                            .then((after) => setLinks(after.filter((one) => one.pageId === pageId)))
                            .catch(() => setUnlinkNote(L.planSync.unlinkFailed));
                        }}
                      >
                        {L.planSync.unlink}
                      </button>
                    </li>
                  ))}
                </ul>
                {/* 같이 고침으로 닿은 화면(C4) — 기록 도출 줄. 연결 파일에는 같이 고치기가 아무것도 쓰지 않는다. */}
                {(syncedScreens ?? []).length > 0 && (
                  <>
                    <p className="nx-pl-scrhead">{L.plans.docScreensSynced}</p>
                    <ul className="nx-pl-scrlist">
                      {(syncedScreens ?? []).map((screen) => (
                        <li key={screen.route} className="nx-pl-scrrow">
                          <Monitor className="nx-i" size={14} aria-hidden="true" />
                          <span className="nx-pl-scrname">
                            {screen.title ?? screen.route}
                            <span className="nx-pl-scrsub">{timeAgo(Date.parse(screen.at))}</span>
                          </span>
                          <button
                            type="button"
                            className="nx-btn nx-btn--sm nx-btn--ghost"
                            onClick={() => {
                              nav.showScreen();
                              if (!openScreenPath(screen.route)) {
                                void window.colonovaDesignDesktop?.preview?.navigate?.(
                                  screen.route,
                                );
                              }
                            }}
                          >
                            {L.plans.docScreenOpen}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
            {unlinkNote !== null && (
              <p className="nx-pl-note" role="status">
                {unlinkNote}
              </p>
            )}
          </div>
        </aside>
      )}

      {/* 고른 글의 작은 판(2026-10-31 4단계) — `AI 에게 묻기` 가 고른 글을 대화 입력창 위 칩으로 붙인다. */}
      {selection !== null && phase === "ready" && (
        // biome-ignore lint/a11y/useSemanticElements: 고른 글 곁에 뜨는 작은 판이라 group 의 기본 꼴이 어울리지 않는다
        <div
          className="nx-pl-selpick"
          role="group"
          aria-label={L.drafts.selectionAsk}
          style={{ left: `${Math.max(24, selection.x)}px`, top: `${selection.y}px` }}
        >
          <button
            type="button"
            className="nx-btn nx-btn--sm"
            onClick={() => {
              onSelectionAsk?.(selection.text);
              setSelection(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            <SparkIcon />
            {L.drafts.selectionAsk}
          </button>
          <button
            type="button"
            className="nx-ibtn nx-ibtn--sm"
            aria-label={L.plans.drawerClose}
            onClick={() => setSelection(null)}
          >
            <CloseIcon />
          </button>
        </div>
      )}
    </article>
  );
}
