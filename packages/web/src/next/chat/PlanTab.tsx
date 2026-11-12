import type { DraftCompareResult } from "@colonova-design/protocol";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "../../components/Markdown";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import { COMPOSER_ATTACH_EVENT } from "../lib/composer-attach";
import { routePath } from "../lib/follow-edit";
import {
  applyMismatchToDraft,
  offerMismatchToComposer,
  sendMismatchNow,
} from "../lib/mismatch-model";
import { attachEventDetail } from "../plans/doc-actions/doc-actions-model";
import { DraftReadBlock } from "../plans/draft/DraftReadBlock";
import { openPlanTarget } from "../plans/open-plan";
import { DocView } from "../plans/view/DocView";
import type { ShellNav } from "../slots";
import { Spin } from "../ui/icons";
import { MismatchCard, type MismatchHand } from "../ui/MismatchCard";
import { ClipIcon, FileSmIcon, XIcon } from "./icons";
import {
  comparePlanTarget,
  createPlanComparison,
  createPlanFocusConsumer,
  createPlanRequest,
  type PlanBody,
  type PlanRow,
  type PlanSource,
  readPlanBody,
  readPlanSources,
  sendPlanReference,
} from "./plan-tab-model";

/** 결과 띠의 `보기` — 이 문서의 바뀐 절을 찾는다. 과거판을 읽는 요청은 아니다. */
export interface PlanFocus {
  pageId: string | null;
  docKey: string | null;
  section: string | null;
  nonce: number;
}

interface PlanTabProps {
  daemon: Daemon;
  nav: ShellNav;
  screenRoute: string | null;
  sessionId: string | null;
  sentCount: number;
  onCount?: (count: number) => void;
  focus?: PlanFocus | null;
  onFocusConsumed?: (nonce: number) => void;
  tabpanelId?: string;
  tabpanelLabel?: string;
}

/** 대화 · 화면 · 프로젝트 API가 바뀌면 이전 목록과 선택을 첫 렌더부터 비운다. */
export function PlanTab(props: PlanTabProps) {
  const { daemon, sessionId, screenRoute } = props;
  const [scope, setScope] = useState({
    api: daemon.api,
    project: daemon.activeSlug,
    sessionId,
    screenRoute,
    key: 0,
    ignoredFocusNonce: null as number | null,
  });
  if (
    scope.api !== daemon.api ||
    scope.project !== daemon.activeSlug ||
    scope.sessionId !== sessionId ||
    scope.screenRoute !== screenRoute
  ) {
    setScope({
      api: daemon.api,
      project: daemon.activeSlug,
      sessionId,
      screenRoute,
      key: scope.key + 1,
      ignoredFocusNonce: props.focus?.nonce ?? null,
    });
    return null;
  }
  return (
    <ScopedPlanTab
      key={scope.key}
      {...props}
      focus={props.focus?.nonce === scope.ignoredFocusNonce ? null : props.focus}
    />
  );
}

/** 연결 · 대화 근거 · 같이 고친 기록은 역할별로 나눈다(2026-11-11 화면 탭 검토). */
function ScopedPlanTab({
  daemon,
  nav,
  screenRoute,
  sessionId,
  sentCount,
  onCount,
  focus = null,
  onFocusConsumed,
  tabpanelId,
  tabpanelLabel,
}: PlanTabProps) {
  const api = daemon.api;
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [failedSources, setFailedSources] = useState<PlanSource[]>([]);
  const [picked, setPicked] = useState<PlanRow | null>(null);
  const [body, setBody] = useState<{ rowKey: string; content: PlanBody } | null>(null);
  const [bodyFailed, setBodyFailed] = useState(false);
  const [bodyTick, setBodyTick] = useState(0);
  const [unlinkFailed, setUnlinkFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [picking, setPicking] = useState(false);
  const [pickDocs, setPickDocs] = useState<Array<{ pageId: string; title: string }> | null>(null);
  const [pickFailed, setPickFailed] = useState(false);
  const [pickTick, setPickTick] = useState(0);
  const [pickFilter, setPickFilter] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkedFailed, setLinkedFailed] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [compareFailed, setCompareFailed] = useState(false);
  const [compareResult, setCompareResult] = useState<DraftCompareResult | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const focusSection = useRef<string | null | undefined>(undefined);
  const [focusConsumer] = useState(createPlanFocusConsumer);
  const [requests] = useState(() => ({
    list: createPlanRequest(),
    body: createPlanRequest(),
    pick: createPlanRequest(),
    compare: createPlanComparison(),
    card: createPlanRequest(),
    send: createPlanRequest(),
    link: createPlanRequest(),
    unlink: createPlanRequest(),
  }));
  useLayoutEffect(
    () => () => {
      for (const request of Object.values(requests)) request.cancel();
    },
    [requests],
  );

  const selectRow = useCallback(
    (row: PlanRow | null) => {
      requests.body.cancel();
      requests.compare.cancel();
      requests.card.cancel();
      focusSection.current = undefined;
      setBody(null);
      setBodyFailed(false);
      setCompareResult(null);
      setCompareFailed(false);
      setComparing(false);
      setPicked(row);
    },
    [requests],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: 사람 말 수 · 다시 읽음은 읽기 방아쇠다.
  useEffect(() => {
    const isCurrent = requests.list.begin();
    void readPlanSources(api, screenRoute, sessionId).then(({ rows: list, failed }) => {
      if (!isCurrent()) return;
      setRows(list);
      setFailedSources(failed);
      setPicked((was) =>
        was !== null && (list.some((row) => row.key === was.key) || failed.includes(was.source))
          ? was
          : null,
      );
    });
    return () => requests.list.cancel();
  }, [api, screenRoute, sessionId, sentCount, reloadTick, requests]);

  useEffect(() => {
    onCount?.(rows?.length ?? 0);
  }, [rows, onCount]);

  // 문서 교체 순간 이전 몸을 가리고, 실패도 같은 읽기 번호로 거른다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: bodyTick은 다시 읽기 방아쇠다.
  useEffect(() => {
    const isCurrent = requests.body.begin();
    requests.compare.cancel();
    setBody(null);
    setBodyFailed(false);
    setCompareResult(null);
    setCompareFailed(false);
    setComparing(false);
    if (picked !== null) {
      void readPlanBody(api, picked).then(
        (content) => {
          if (isCurrent()) setBody({ rowKey: picked.key, content });
        },
        () => {
          if (isCurrent()) setBodyFailed(true);
        },
      );
    }
    return () => requests.body.cancel();
  }, [api, picked, bodyTick, requests]);

  // 실제 계약은 필수 구독이다. 예전 격리 견본에만 방송 창구가 없을 수 있다.
  const onDraftEvent = daemon.onDraftEvent;
  useEffect(
    () =>
      onDraftEvent?.((message) => {
        if (message.type !== "draft.changed") return;
        if (requests.compare.onDraftChanged(message.docKey)) {
          requests.card.cancel();
          setCompareResult(null);
          setCompareFailed(false);
          setComparing(false);
        }
        if (picked?.docKey === message.docKey) {
          requests.body.cancel();
          requests.compare.cancel();
          requests.card.cancel();
          setBody(null);
          setBodyFailed(false);
          setBodyTick((n) => n + 1);
        }
        if (sessionId !== null) setReloadTick((n) => n + 1);
      }),
    [onDraftEvent, picked?.docKey, requests, sessionId],
  );

  const runCompare = async () => {
    if (picked === null || picked.pageId === null || comparing) return;
    const comparison = requests.compare.begin(picked);
    setComparing(true);
    setCompareFailed(false);
    try {
      const result = await comparison.read(() => api.draftCompare(picked.pageId ?? ""));
      if (result !== null && comparison.isCurrent()) setCompareResult(result);
    } catch {
      if (comparison.isCurrent()) setCompareFailed(true);
    } finally {
      if (comparison.isCurrent()) setComparing(false);
    }
  };

  // 어긋남 카드의 손 — 세 손이 어느 쪽도 으뜸이 아니다(계획 §2). 보내기는 사람이다.
  const compareHand: MismatchHand = {
    apply:
      compareResult === null || picked === null || picked.pageId === null
        ? undefined
        : (row) =>
            applyMismatchToDraft({
              api,
              brief: L.compare.applyBrief(row),
              pageId: picked.pageId ?? "",
              docKey: compareResult.docKey,
            }).then(() => nav.toast(L.compare.appliedToast)),
    send:
      picked === null
        ? () => Promise.reject(new Error("no doc"))
        : (row) => {
            const isCurrent = requests.card.begin();
            return sendMismatchNow({
              api,
              brief: L.compare.sendBrief(row, compareResult?.title ?? picked.title),
              target: comparePlanTarget(picked, compareResult?.docKey ?? null),
              isCurrent,
            }).then((result) => {
              if (!isCurrent()) return "prefilled";
              if (result === false) throw new Error("composer away");
              nav.showTab("chat");
              // 실제로 보냈을 때만 `보냈어요` — 미리 채우기로 떨어졌으면 예전 토스트.
              nav.toast(result === "sent" ? L.compare.sentNowToast : L.compare.sentToast);
              return result;
            });
          },
    sendEdit:
      picked === null
        ? () => Promise.reject(new Error("no doc"))
        : (row) => {
            const isCurrent = requests.card.begin();
            return offerMismatchToComposer({
              api,
              brief: L.compare.sendBrief(row, compareResult?.title ?? picked.title),
              target: comparePlanTarget(picked, compareResult?.docKey ?? null),
              isCurrent,
            }).then((taken) => {
              if (!isCurrent()) return;
              if (!taken) throw new Error("composer away");
              nav.showTab("chat");
              nav.toast(L.compare.sentToast);
            });
          },
    decline: (row) => {
      if (picked?.pageId == null) return Promise.resolve();
      return api.draftCompareDecline(picked.pageId, row.screenName).then(() => undefined);
    },
  };

  // 결과 띠의 `보기`(C4) — 그 문서를 골라 절을 기억해 둔다. 몸이 오면 그 절으로 스크롤하고 잠깐 빛난다.
  useEffect(() => {
    if (focus === null || rows === null) return;
    const row =
      rows.find(
        (one) =>
          (focus.docKey !== null && one.docKey === focus.docKey) ||
          (focus.pageId !== null && one.pageId === focus.pageId),
      ) ?? null;
    if (!focusConsumer.consume(focus.nonce, row !== null) || row === null) return;
    selectRow(row);
    focusSection.current = focus.section;
    onFocusConsumed?.(focus.nonce);
  }, [focus, rows, selectRow, focusConsumer, onFocusConsumed]);

  // 몸이 오면 기억한 절로 간다 — 절이 사라졌으면 문서 맨 위로 열고 하이라이트는 건너뛴다(계획 §3 C4 검토).
  useEffect(() => {
    if (body === null || body.rowKey !== picked?.key || focusSection.current === undefined) return;
    const want = focusSection.current;
    focusSection.current = undefined;
    const root = bodyRef.current;
    if (root === null) return;
    if (want !== null) {
      const hit = [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")].find((el) =>
        (el.textContent ?? "").includes(want),
      );
      if (hit !== undefined) {
        hit.scrollIntoView({ block: "start", behavior: "smooth" });
        hit.classList.add("nx-plantab-flash");
        window.setTimeout(() => hit.classList.remove("nx-plantab-flash"), 1600);
        return;
      }
    }
    root.scrollIntoView({ block: "start" });
  }, [body, picked]);

  const openInPlans = (row: PlanRow) => {
    if (row.docKey !== null) openPlanTarget({ docKey: row.docKey }, nav);
    else if (row.pageId !== null) openPlanTarget({ pageId: row.pageId }, nav);
  };

  // 선택 목록도 실패를 빈 목록과 구분한다. 닫기 · 자리 이동 후 늦게 온 답은 버린다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pickTick은 다시 읽기 방아쇠다.
  useEffect(() => {
    if (!picking) return;
    const isCurrent = requests.pick.begin();
    setPickFailed(false);
    setPickDocs(null);
    void api.docList().then(
      (result) => {
        if (isCurrent())
          setPickDocs((result.docs ?? []).map(({ pageId, title }) => ({ pageId, title })));
      },
      () => {
        if (isCurrent()) setPickFailed(true);
      },
    );
    return () => requests.pick.cancel();
  }, [picking, pickTick, api, requests]);

  const shownDocs = useMemo(() => {
    const needle = pickFilter.trim().toLowerCase();
    const all = pickDocs ?? [];
    return all.filter((doc) => doc.title.toLowerCase().includes(needle)).slice(0, 8);
  }, [pickDocs, pickFilter]);
  const linkedPages = new Set(
    (rows ?? []).filter((row) => row.source === "linked").map((row) => row.pageId),
  );

  const linkDoc = async (doc: { pageId: string; title: string }) => {
    if (screenRoute === null || linking || linkedPages.has(doc.pageId)) return;
    const isCurrent = requests.link.begin();
    setLinking(true);
    setLinkedFailed(false);
    try {
      await api.mapWrite([{ op: "add", pageId: doc.pageId, route: screenRoute }]);
      if (!isCurrent()) return;
      setReloadTick((n) => n + 1);
      setPicking(false);
      setPickFilter("");
      nav.toast(L.planTab.linkedDone(doc.title));
    } catch {
      if (isCurrent()) setLinkedFailed(true);
    } finally {
      if (isCurrent()) setLinking(false);
    }
  };

  const sendAsRef = async (row: PlanRow) => {
    if (sending) return;
    const isCurrent = requests.send.begin();
    setSending(true);
    const result = await sendPlanReference({
      api,
      row,
      isCurrent,
      offer: (snapshot) => {
        const offer = new CustomEvent(COMPOSER_ATTACH_EVENT, {
          cancelable: true,
          detail: attachEventDetail(snapshot),
        });
        window.dispatchEvent(offer);
        return offer.defaultPrevented;
      },
    });
    if (!isCurrent()) return;
    setSending(false);
    if (result === "attached") nav.toast(L.planTab.sentToComposer);
    else if (result === "failed") nav.toast(L.drafts.sendFailed);
    else if (result === "unavailable") nav.toast(L.drafts.noComposer);
  };

  const unlink = async (row: PlanRow) => {
    if (row.pageId === null || screenRoute === null) return;
    const isCurrent = requests.unlink.begin();
    setUnlinkFailed(false);
    try {
      await api.mapWrite([{ op: "remove", pageId: row.pageId, route: routePath(screenRoute) }]);
      if (!isCurrent()) return;
      nav.toast(L.planTab.unlinkDone(row.title));
      setReloadTick((n) => n + 1);
    } catch {
      if (isCurrent()) setUnlinkFailed(true);
    }
  };

  const groups = [
    { source: "linked", title: L.planTab.listLabel, failure: L.planTab.linkedReadFailed },
    { source: "refs", title: L.planTab.refsGroup, failure: L.planTab.refsReadFailed },
    { source: "changed", title: L.planTab.changedGroup, failure: L.planTab.changedReadFailed },
  ] as const;
  const content = body?.rowKey === picked?.key ? (body?.content ?? null) : null;

  return (
    <div
      className="nx-plantab"
      role="tabpanel"
      id={tabpanelId}
      aria-label={tabpanelLabel}
      data-f6="body"
      tabIndex={-1}
    >
      <div className="nx-plantab-head">
        <b>{L.planTab.title}</b>
        {picked !== null ? (
          <>
            {picked.pageId !== null && (
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
            <button type="button" className="nx-mlink" onClick={() => selectRow(null)}>
              {L.chat.dismiss}
            </button>
          </>
        ) : screenRoute !== null ? (
          <button
            type="button"
            className="nx-btn nx-btn--sm"
            aria-expanded={picking}
            onClick={() => setPicking((before) => !before)}
          >
            {L.planTab.pick}
          </button>
        ) : null}
      </div>
      {picked === null ? (
        <div className="nx-plantab-scroll">
          <p className="nx-plantab-readonly">{L.planTab.readOnly}</p>
          {picking && screenRoute !== null && (
            <fieldset className="nx-psync-pick" aria-label={L.planTab.pickTitle}>
              <input
                className="nx-input nx-psync-filter"
                type="search"
                value={pickFilter}
                placeholder={L.planSync.pickFilter}
                aria-label={L.planSync.pickFilter}
                onChange={(event) => setPickFilter(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setPicking(false);
                }}
              />
              {pickFailed && (
                <p className="nx-psync-foot" role="alert">
                  {L.planSync.pickFailed}{" "}
                  <button
                    type="button"
                    className="nx-btn nx-btn--sm"
                    onClick={() => setPickTick((n) => n + 1)}
                  >
                    {L.planTab.retry}
                  </button>
                </p>
              )}
              {!pickFailed && pickDocs === null && (
                <p className="nx-psync-foot">{L.planSync.pickLoading}</p>
              )}
              {!pickFailed && pickDocs !== null && shownDocs.length === 0 && (
                <p className="nx-psync-foot">{L.planSync.pickEmpty}</p>
              )}
              <ul className="nx-psync-list">
                {shownDocs.map((doc) => (
                  <li key={doc.pageId}>
                    <button
                      type="button"
                      className="nx-psync-doc"
                      disabled={linking || linkedPages.has(doc.pageId)}
                      onClick={() => void linkDoc(doc)}
                    >
                      <FileSmIcon />
                      <span>{doc.title}</span>
                      {linkedPages.has(doc.pageId) && <span>{L.planTab.alreadyLinked}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          {linkedFailed && (
            <p className="nx-m-note nx-tone--red" role="alert">
              {L.planTab.linkedFailed}
            </p>
          )}
          {rows === null && <div className="nx-plantab-loading" aria-busy="true" />}
          {rows !== null && rows.length === 0 && failedSources.length === 0 && (
            <p className="nx-plantab-empty">{L.planTab.empty}</p>
          )}
          {groups.map((group) => {
            const members = (rows ?? []).filter((row) => row.source === group.source);
            const failed = failedSources.includes(group.source);
            if (members.length === 0 && !failed) return null;
            return (
              <section key={group.source} aria-label={group.title}>
                <h3 className="nx-plantab-group">{group.title}</h3>
                {failed && (
                  <p className="nx-m-note nx-tone--red" role="alert">
                    {group.failure}{" "}
                    <button
                      type="button"
                      className="nx-btn nx-btn--sm"
                      onClick={() => setReloadTick((n) => n + 1)}
                    >
                      {L.planTab.retry}
                    </button>
                  </p>
                )}
                <ul className="nx-plantab-list" aria-label={group.title}>
                  {members.map((row) => (
                    <li key={row.key} className="nx-plantab-row">
                      <button
                        type="button"
                        className="nx-plantab-open"
                        title={row.title}
                        onClick={() => selectRow(row)}
                      >
                        <FileSmIcon />
                        <span className="nx-plantab-title">{row.title}</span>
                        {row.synced !== undefined ? (
                          <span className="nx-plantab-sec">
                            {L.planTab.changedBlocks(row.synced.changes)}
                          </span>
                        ) : (
                          row.section !== null && (
                            <span className="nx-plantab-sec">{row.section}</span>
                          )
                        )}
                      </button>
                      <button
                        type="button"
                        className="nx-ibtn nx-ibtn--sm"
                        title={L.planTab.send}
                        aria-label={`${L.planTab.send} · ${row.title}`}
                        disabled={sending}
                        onClick={() => void sendAsRef(row)}
                      >
                        <ClipIcon />
                      </button>
                      <button
                        type="button"
                        className="nx-ibtn nx-ibtn--sm"
                        title={L.planTab.open}
                        aria-label={`${L.planTab.open} · ${row.title}`}
                        onClick={() => openInPlans(row)}
                      >
                        <FileSmIcon />
                      </button>
                      {row.source === "linked" && (
                        <button
                          type="button"
                          className="nx-ibtn nx-ibtn--sm"
                          title={L.planTab.unlink}
                          aria-label={`${L.planTab.unlink} · ${row.title}`}
                          onClick={() => void unlink(row)}
                        >
                          <XIcon />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {unlinkFailed && (
            <p className="nx-m-note nx-tone--red" role="alert">
              {L.planTab.unlinkFailed}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="nx-plantab-meta">
            <h3>{content?.kind === "draft" ? content.title : picked.title}</h3>
            <p>{L.planTab.section(picked.section)}</p>
            <p>{picked.docKey !== null ? L.planTab.latestDraft : L.planTab.importedBody}</p>
          </div>
          {content !== null ? (
            <div className="nx-plantab-body" ref={bodyRef}>
              {content.kind === "draft" ? (
                content.blocks.map((block) => (
                  <DraftReadBlock key={block.id} block={block} api={api} pageId={content.pageId} />
                ))
              ) : content.blocks !== null ? (
                <DocView blocks={content.blocks} api={api} pageId={content.pageId} />
              ) : (
                <Markdown text={content.markdown} />
              )}
            </div>
          ) : bodyFailed ? (
            <p className="nx-m-note nx-tone--red" role="alert">
              {L.planTab.readFailed}{" "}
              <button
                type="button"
                className="nx-btn nx-btn--sm"
                onClick={() => setBodyTick((n) => n + 1)}
              >
                {L.planTab.retry}
              </button>
            </p>
          ) : (
            <div className="nx-plantab-loading" aria-busy="true" />
          )}
          {compareResult !== null &&
            (compareResult.rows.length > 0 ? (
              <MismatchCard
                title={compareResult.title}
                source={compareResult.source}
                rows={compareResult.rows}
                note={compareResult.note}
                hand={compareHand}
              />
            ) : (
              <p className="nx-plantab-readonly">{L.compare.same}</p>
            ))}
          {compareFailed && (
            <p className="nx-m-note nx-tone--red" role="alert">
              {L.compare.failed}
            </p>
          )}
        </>
      )}
    </div>
  );
}
