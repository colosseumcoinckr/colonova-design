import type { DocOpResult, DraftCompareResult, DraftSummary } from "@colonova-design/protocol";
import { Link2, Maximize2, Monitor } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "../../components/Markdown";
import type { Daemon, MapReadResult } from "../../lib/daemon-client";
import { timeAgo } from "../../lib/format";
import { openScreenPath } from "../../lib/screen-link";
import { L } from "../labels";
import {
  applyMismatchToDraft,
  offerMismatchToComposer,
  sendMismatchNow,
} from "../lib/mismatch-model";
import type { ShellNav } from "../slots";
import { CloseIcon, InfoIcon, SparkIcon, Spin } from "../ui/icons";
import { MismatchCard, type MismatchHand } from "../ui/MismatchCard";
import { DocComments } from "./comments/DocComments";
import { DocDrawer } from "./comments/DocDrawer";
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
  searchTarget,
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
  searchTarget?: { query: string; request: number } | null;
}) {
  const article = useRef<HTMLElement>(null);
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
  const drawerTrigger = useRef<HTMLButtonElement | null>(null);
  const drawerClose = useRef<HTMLButtonElement | null>(null);
  const closeDrawer = () => {
    setDrawer(null);
    drawerTrigger.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (drawer !== null) drawerClose.current?.focus({ preventScroll: true });
  }, [drawer]);
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
  const [linksFailed, setLinksFailed] = useState(false);
  const [syncedFailed, setSyncedFailed] = useState(false);
  const [screenRetry, setScreenRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 재시도 번호가 같은 범위를 다시 읽는다
  useEffect(() => {
    if (drawer !== "screens") return;
    setLinks(null);
    setSyncedScreens(null);
    setScreenTitles(new Map());
    setLinksFailed(false);
    setSyncedFailed(false);
    setUnlinkNote(null);
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
        if (live) setLinksFailed(true);
      });
    daemon.api
      .draftSyncScreens(pageId)
      .then((result) => {
        if (live) setSyncedScreens(result.screens);
      })
      .catch(() => {
        if (live) setSyncedFailed(true);
      });
    return () => {
      live = false;
    };
  }, [daemon.api, drawer, pageId, screenRetry]);
  // 화면과 맞춰 보기(2026-11-02 · 같이 고치기 UX 계획 C7) — 판정만 돌고 어디에도 쓰지 않는다.
  const [comparing, setComparing] = useState(false);
  const [compareFailed, setCompareFailed] = useState(false);
  const [compareResult, setCompareResult] = useState<DraftCompareResult | null>(null);
  const compareScope = useRef({ api: daemon.api, pageId, live: true });
  compareScope.current.api = daemon.api;
  compareScope.current.pageId = pageId;
  useEffect(() => {
    compareScope.current.live = true;
    return () => {
      compareScope.current.live = false;
    };
  }, []);
  const runCompare = async () => {
    const current = () =>
      compareScope.current.live &&
      compareScope.current.api === daemon.api &&
      compareScope.current.pageId === pageId;
    if (comparing) return;
    setComparing(true);
    setCompareFailed(false);
    try {
      const result = await daemon.api.draftCompare(pageId);
      if (current()) setCompareResult(result);
    } catch {
      if (current()) setCompareFailed(true);
    } finally {
      if (current()) setComparing(false);
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
      sendMismatchNow({
        api: daemon.api,
        brief: L.compare.sendBrief(row, compareResult?.title ?? shownTitle),
        target: { pageId },
      }).then((result) => {
        if (result === false) throw new Error("composer away");
        nav.showTab("chat");
        nav.toast(result === "sent" ? L.compare.sentNowToast : L.compare.sentToast);
        return result;
      }),
    sendEdit: (row) =>
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
  const captureSelection = () => {
    const selected = window.getSelection();
    if (!selected || selected.rangeCount === 0) return;
    const range = selected.getRangeAt(0);
    if (!body.current?.contains(range.commonAncestorContainer)) return;
    const text = selected.toString().trim();
    const anchor = article.current?.offsetParent;
    const box = anchor?.getBoundingClientRect();
    if (!text || !box) {
      setSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setSelection({
      text,
      x: Math.max(8, Math.min(rect.left - box.left, box.width - 200)),
      y: rect.bottom - box.top + (anchor?.scrollTop ?? 0) + 8,
    });
  };
  const scrolledSearch = useRef<object | null>(null);
  useEffect(() => {
    if (
      phase !== "ready" ||
      !doc ||
      !searchTarget ||
      !body.current ||
      scrolledSearch.current === searchTarget
    )
      return;
    const query = searchTarget.query.trim().toLocaleLowerCase();
    if (!query) return;
    const walker = document.createTreeWalker(body.current, NodeFilter.SHOW_TEXT);
    let target: HTMLElement | null = null;
    while (walker.nextNode()) {
      if (walker.currentNode.textContent?.toLocaleLowerCase().includes(query)) {
        target = walker.currentNode.parentElement;
        break;
      }
    }
    if (!target) return;
    let ancestor = target.parentElement;
    while (ancestor && ancestor !== body.current) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      ancestor = ancestor.parentElement;
    }
    scrolledSearch.current = searchTarget;
    target.setAttribute("data-search-hit", "true");
    target.scrollIntoView({ block: "center" });
    return () => target?.removeAttribute("data-search-hit");
  }, [phase, doc, searchTarget]);
  const commentCount = doc?.comments?.filter((one) => one.resolved !== true).length ?? 0;
  const screenCount =
    links === null || syncedScreens === null || linksFailed || syncedFailed
      ? null
      : new Set([
          ...links.map((link) => link.route),
          ...syncedScreens.map((screen) => screen.route),
        ]).size;
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
    <article ref={article} className="nx-pl-doc" aria-busy={phase === "loading"}>
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
          {phase === "ready" && doc !== null && (
            <div className="nx-pl-doc-drawers">
              <button
                type="button"
                className="nx-btn nx-btn--sm"
                aria-expanded={drawer === "comments"}
                onClick={(event) => {
                  drawerTrigger.current = event.currentTarget;
                  setDrawer((before) => (before === "comments" ? null : "comments"));
                }}
              >
                {L.plans.drawerComments(commentCount)}
              </button>
              <button
                type="button"
                className="nx-btn nx-btn--sm"
                aria-expanded={drawer === "screens"}
                onClick={(event) => {
                  drawerTrigger.current = event.currentTarget;
                  setDrawer((before) => (before === "screens" ? null : "screens"));
                }}
              >
                {L.plans.drawerScreens(screenCount)}
              </button>
            </div>
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
          <div
            className="nx-pl-body"
            ref={body}
            onMouseUp={captureSelection}
            onKeyUp={captureSelection}
          >
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

      {/* 코멘트 서랍(2026-10-31 D) — 지금 본문 아래에 있던 코멘트 절이 옮겨 왔다. 초안 머리도 같은
          서랍을 쓴다(2026-11-12 B8 — 발행 창이 `안 풀린 코멘트` 를 점검해도 읽을 곳이 없었다). */}
      {phase === "ready" && doc !== null && drawer === "comments" && (
        <DocDrawer
          label={L.plans.drawerComments(commentCount)}
          closeRef={drawerClose}
          onClose={closeDrawer}
        >
          {writable === false && (
            <p className="nx-banner nx-banner--amber nx-pl-drawer-note" role="status">
              <InfoIcon />
              {L.drafts.writeOffHint}
            </p>
          )}
          <DocComments
            daemon={daemon}
            pageId={pageId}
            comments={doc.comments}
            body={body}
            onRefresh={onRefresh}
            writable={writable}
          />
        </DocDrawer>
      )}

      {/* 이어진 화면 서랍(2026-10-31 D) — 연결 자리를 걷은 뒤 연결을 보는 곳이 옮겨 왔다. */}
      {phase === "ready" && drawer === "screens" && (
        // biome-ignore lint/a11y/noNoninteractiveElementInteractions: 안의 단추에서 올라온 Esc로 서랍을 접는다
        <aside
          className="nx-pl-drawer"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.defaultPrevented) {
              event.preventDefault();
              event.stopPropagation();
              closeDrawer();
            }
          }}
          aria-label={L.plans.drawerScreens(screenCount)}
        >
          <header className="nx-pl-drawer-hd">
            <h3>
              <Monitor className="nx-i" size={14} aria-hidden="true" />
              {L.plans.drawerScreens(screenCount)}
            </h3>
            <button
              type="button"
              className="nx-ibtn nx-ibtn--sm"
              aria-label={L.plans.drawerClose}
              ref={drawerClose}
              onClick={closeDrawer}
            >
              <CloseIcon />
            </button>
          </header>
          <div className="nx-pl-drawer-body">
            {((links === null && !linksFailed) || (syncedScreens === null && !syncedFailed)) && (
              <p className="nx-pl-note" role="status">
                <Spin /> {L.plans.reading}
              </p>
            )}
            {(linksFailed || syncedFailed) && (
              <div className="nx-pl-note" role="alert">
                {linksFailed && <p>{L.plans.screensLoadFailed}</p>}
                {syncedFailed && <p>{L.plans.syncedLoadFailed}</p>}
                <button
                  type="button"
                  className="nx-btn nx-btn--sm"
                  onClick={() => setScreenRetry((n) => n + 1)}
                >
                  {L.plans.retry}
                </button>
              </div>
            )}
            {links?.length === 0 &&
              syncedScreens?.length === 0 &&
              !linksFailed &&
              !syncedFailed && <p className="nx-pl-note">{L.plans.docScreensNone}</p>}
            <ul className="nx-pl-scrlist">
              {(links ?? []).map((link) => (
                <li
                  key={`${link.route}
${link.section ?? ""}`}
                  className="nx-pl-scrrow"
                >
                  <Link2 className="nx-i" size={14} aria-hidden="true" />
                  <span className="nx-pl-scrname">
                    {screenTitles.get(link.route) || L.transcript.unknownScreen}
                    {link.section !== null && <span className="nx-pl-scrsub">{link.section}</span>}
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
                            void window.colonovaDesignDesktop?.preview?.navigate?.(screen.route);
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
            {unlinkNote !== null && (
              <p className="nx-pl-note" role="alert">
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
