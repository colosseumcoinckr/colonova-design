import type { DocBlock, DraftCompareResult } from "@colonova-design/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "../../components/Markdown";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import { routePath } from "../lib/follow-edit";
import {
  applyMismatchToDraft,
  offerMismatchToComposer,
  sendMismatchNow,
} from "../lib/mismatch-model";
import { attachEventDetail } from "../plans/doc-actions/doc-actions-model";
import { openPlanTarget } from "../plans/open-plan";
import { DocView } from "../plans/view/DocView";
import { COMPOSER_ATTACH_EVENT } from "../preview/PreviewColumn";
import type { ShellNav } from "../slots";
import { Spin } from "../ui/icons";
import { MismatchCard, type MismatchHand } from "../ui/MismatchCard";
import { ClipIcon, FileSmIcon, XIcon } from "./icons";

/**
 * 오른쪽 칸의 기획서 탭(2026-10-31 화면 자리 개선안 S10) — 지금 화면에 이어진 기획서를
 * 이 자리에서 읽는다. 연결 자리를 세우지 않는 2026-10-30 결정을 그대로 지킨다: 연결은
 * 화면 곁에서 보고 끊는다. 이어진 문서는 셋에서 온다 — 연결의 정본(`map.read` 의 연결 중
 * 지금 화면의 주소에 이어진 것)과 이 대화가 근거로 보낸 문서(`draft.refs`), 그리고 같이 고친
 * 기록(2026-11-02 · 같이 고치기 UX 계획 C4 — 실제로 같이 고쳐진 문서가 저절로 보인다). 하나를
 * 고르면 읽기 전용으로 보인다 — 고치는 곳은 기획서 자리(초안)다. 문서 곁의 `화면과 맞춰 보기`
 * (같은 계획 C7)는 판정만 돌고 어디에도 쓰지 않는다.
 */

/** 결과 띠의 `보기`(C4) — 이 탭을 그 문서의 바뀐 절로 연다. `nonce` 가 바뀔 때마다 한 번 움직인다. */
export interface PlanFocus {
  pageId: string | null;
  docKey: string | null;
  section: string | null;
  nonce: number;
}

/** 목록의 한 줄 — 연결의 정본과 근거를 한 모양으로 묶는다. */
interface PlanRow {
  key: string;
  pageId: string | null;
  docKey: string | null;
  title: string;
  /** 연결의 정본(`plans-map.json`)에서 온 줄 — 끊기가 서고, 이어진 절을 같이 읽는다. */
  linked: boolean;
  section: string | null;
  /** 같이 고친 기록에서 온 줄(C4) — 묶음 머리 `초안에서 바뀐 곳` 아래에 서고 바뀐 수를 읽는다. */
  synced?: { changes: number; sections: string[] };
}

/** 문서의 미리 본 내용 — 읽기 전용 몸이 그린다. */
interface PlanBody {
  pageId: string;
  /** 풀어 둔 본문 — 데몬이 그림을 못 보냈으면 원문 마크다운으로 대신 읽는다. */
  blocks: readonly DocBlock[] | null;
  markdown: string;
}

export function PlanTab({
  daemon,
  nav,
  screenRoute,
  sessionId,
  sentCount,
  onCount,
  focus = null,
  tabpanelId,
  tabpanelLabel,
}: {
  daemon: Daemon;
  nav: ShellNav;
  /** 지금 미리보기가 보는 화면의 주소 — 이 주소에 이어진 연결을 가른다. */
  screenRoute: string | null;
  /** 이 대화의 근거를 읽는 열쇠 — 대화가 바뀌면 다시 읽는다. */
  sessionId: string | null;
  /** 이 대화의 사람 말 수 — 늘면 근거를 다시 읽는다. */
  sentCount: number;
  /** 연결 수가 바뀌면 탭 이름 곁의 수가 다시 센다. */
  onCount?: (count: number) => void;
  /** 결과 띠의 `보기` 가 열 곳(C4) — 문서의 바뀐 절로 스크롤하고 잠깐 하이라이트가 선다. */
  focus?: PlanFocus | null;
  /** 탭 몸의 `id` — 오른쪽 칸의 탭(`aria-controls`)과 짝짓는다(2026-11-03 탭 알약식과 함께). */
  tabpanelId?: string;
  /** 탭 몸의 이름 — 낭독기가 탭 몸을 부를 때 쓴다. */
  tabpanelLabel?: string;
}) {
  const api = daemon.api;
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [picked, setPicked] = useState<PlanRow | null>(null);
  const [body, setBody] = useState<PlanBody | null>(null);
  const [bodyFailed, setBodyFailed] = useState(false);
  const [unlinkFailed, setUnlinkFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  // 곁줄의 고르기 손과 같은 길(2026-11-01 실사용) — 자리를 기획서 칸으로 옮기지 않고
  // 이 탭에서 바로 문서를 골라 지금 화면에 잇는다. 연결의 정본은 그대로 plans-map.json 이다.
  const [picking, setPicking] = useState(false);
  const [pickDocs, setPickDocs] = useState<Array<{ pageId: string; title: string }> | null>(null);
  const [pickFailed, setPickFailed] = useState(false);
  const [pickFilter, setPickFilter] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkedFailed, setLinkedFailed] = useState(false);
  // 화면과 맞춰 보기(2026-11-02 C7) — 판정만 돌고 어디에도 쓰지 않는다. 손을 눌렀을 때만 그 방향으로 간다.
  const [comparing, setComparing] = useState(false);
  const [compareFailed, setCompareFailed] = useState(false);
  const [compareResult, setCompareResult] = useState<DraftCompareResult | null>(null);
  // 결과 띠의 `보기` 가 도착한 절(C4) — 몸이 오면 스크롤하고 비운다.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const focusSection = useRef<string | null | undefined>(undefined);

  // 이어진 문서의 목록 — 지금 화면의 연결과 이 대화의 근거, 같이 고친 기록을 한 줄로 합친다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 사람 말 수 · 다시 읽음은 방아쇠일 뿐 — 몸에서 쓰지 않는다.
  useEffect(() => {
    let cancelled = false;
    const here = screenRoute === null ? null : routePath(screenRoute);
    Promise.all([
      api.mapRead().catch(() => null),
      sessionId === null
        ? Promise.resolve({ refs: [] as never[] })
        : api.draftRefs(sessionId).catch(() => ({ refs: [] as never[] })),
      sessionId === null
        ? Promise.resolve({ docs: [] as never[] })
        : api.draftSyncDocs(sessionId).catch(() => ({ docs: [] as never[] })),
    ]).then(([map, refs, synced]) => {
      if (cancelled) return;
      const seen = new Set<string>();
      const list: PlanRow[] = [];
      const push = (row: PlanRow) => {
        if (seen.has(row.key)) return;
        seen.add(row.key);
        list.push(row);
      };
      // 같이 고친 기록(C4) — 실제로 같이 고쳐진 문서가 묶음 머리 아래 저절로 선다. 새것부터.
      for (const doc of synced.docs) {
        push({
          key: `sync:${doc.docKey}`,
          pageId: doc.pageId,
          docKey: doc.docKey,
          title: doc.title,
          linked: false,
          section: doc.sections[0] ?? null,
          synced: { changes: doc.changes, sections: doc.sections },
        });
      }
      for (const link of map?.links ?? []) {
        if (here !== null && routePath(link.route) !== here) continue;
        const title = map?.docs.find((doc) => doc.pageId === link.pageId)?.title ?? link.pageId;
        push({
          key: `map:${link.pageId}:${link.route}`,
          pageId: link.pageId,
          docKey: null,
          title,
          linked: true,
          section: link.section,
        });
      }
      for (const entry of refs.refs) {
        push({
          key: `ref:${entry.ref.pageId ?? ""}:${entry.ref.docKey ?? ""}`,
          pageId: entry.ref.pageId,
          docKey: entry.ref.docKey,
          title: entry.ref.title,
          linked: false,
          section: entry.ref.sections[0] ?? null,
        });
      }
      setRows(list);
      setPicked((was) => (was !== null && list.some((row) => row.key === was.key) ? was : null));
      onCount?.(list.length);
    });
    return () => {
      cancelled = true;
    };
  }, [api, screenRoute, sessionId, sentCount, reloadTick]);

  // 고른 문서를 읽어 온다 — 읽기 전용이므로 문서 읽기 요청 하나면 된다.
  const readBody = useCallback(
    async (row: PlanRow) => {
      if (row.pageId === null) {
        // 초안은 기획서 자리의 편집기가 읽는다 — 이 탭은 가져온 문서만 읽는다.
        setBody(null);
        return;
      }
      setBodyFailed(false);
      try {
        const read = await api.docRead(row.pageId);
        setBody({
          pageId: row.pageId,
          blocks: read.view ?? null,
          markdown: read.markdown,
        });
      } catch {
        setBody(null);
        setBodyFailed(true);
      }
    },
    [api],
  );
  useEffect(() => {
    if (picked === null) {
      setBody(null);
      return;
    }
    // 문서를 갈아탈 때 맞춰 보기의 결과도 비운다 — 카드는 그 문서의 것이다(C7).
    setCompareResult(null);
    setCompareFailed(false);
    void readBody(picked);
  }, [picked, readBody]);

  // 화면과 맞춰 보기(2026-11-02 C7) — 판정만 돌고 초안 · 화면 어디에도 쓰지 않는다.
  const runCompare = async () => {
    if (picked === null || picked.pageId === null || comparing) return;
    setComparing(true);
    setCompareFailed(false);
    try {
      setCompareResult(await api.draftCompare(picked.pageId));
    } catch {
      setCompareFailed(true);
    } finally {
      setComparing(false);
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
        : (row) =>
            sendMismatchNow({
              api,
              brief: L.compare.sendBrief(row, compareResult?.title ?? picked.title),
              target:
                picked.pageId !== null
                  ? { pageId: picked.pageId }
                  : { docKey: picked.docKey ?? "" },
            }).then((result) => {
              if (result === false) throw new Error("composer away");
              nav.showTab("chat");
              // 실제로 보냈을 때만 `보냈어요` — 미리 채우기로 떨어졌으면 예전 토스트.
              nav.toast(result === "sent" ? L.compare.sentNowToast : L.compare.sentToast);
            }),
    sendEdit:
      picked === null
        ? () => Promise.reject(new Error("no doc"))
        : (row) =>
            offerMismatchToComposer({
              api,
              brief: L.compare.sendBrief(row, compareResult?.title ?? picked.title),
              target:
                picked.pageId !== null
                  ? { pageId: picked.pageId }
                  : { docKey: picked.docKey ?? "" },
            }).then((taken) => {
              if (!taken) throw new Error("composer away");
              nav.showTab("chat");
              nav.toast(L.compare.sentToast);
            }),
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
    if (row === null) return;
    focusSection.current = focus.section;
    setPicked(row);
  }, [focus, rows]);

  // 몸이 오면 기억한 절로 간다 — 절이 사라졌으면 문서 맨 위로 열고 하이라이트는 건너뛴다(계획 §3 C4 검토).
  useEffect(() => {
    if (body === null || focusSection.current === undefined) return;
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
  }, [body]);

  const openInPlans = (row: PlanRow) => {
    if (row.docKey !== null) openPlanTarget({ docKey: row.docKey }, nav);
    else if (row.pageId !== null) openPlanTarget({ pageId: row.pageId }, nav);
  };

  // 고르기 팝이 열릴 때 문서 목록을 한 번 읽는다 — 곁줄의 고르기 손과 같은 원장 목록이다.
  useEffect(() => {
    if (!picking || pickDocs !== null) return;
    setPickFailed(false);
    api
      .docList()
      .then((result) =>
        setPickDocs((result.docs ?? []).map(({ pageId, title }) => ({ pageId, title }))),
      )
      .catch(() => setPickFailed(true));
  }, [picking, pickDocs, api]);

  const shownDocs = useMemo(() => {
    const needle = pickFilter.trim().toLowerCase();
    const all = pickDocs ?? [];
    return needle === ""
      ? all.slice(0, 8)
      : all.filter((doc) => doc.title.toLowerCase().includes(needle)).slice(0, 8);
  }, [pickDocs, pickFilter]);

  // 고른 문서와 지금 화면을 잇는다 — 연결 지도 쓰기 하나다. 주소는 데몬이 정규 경로로 폈다.
  const linkDoc = async (doc: { pageId: string; title: string }) => {
    if (screenRoute === null || linking) return;
    setLinking(true);
    setLinkedFailed(false);
    try {
      await api.mapWrite([{ op: "add", pageId: doc.pageId, route: screenRoute }]);
      setReloadTick((n) => n + 1);
      setPicking(false);
      setPickFilter("");
      nav.toast(L.planTab.linkedDone(doc.title));
    } catch {
      setLinkedFailed(true);
    } finally {
      setLinking(false);
    }
  };

  // 근거로 보내기 — 문서 스냅샷을 입력창 첨부로 담는다(기획서 자리의 근거 보내기와 같은 길).
  const sendAsRef = async (row: PlanRow) => {
    if (sending) return;
    setSending(true);
    try {
      const target = row.docKey !== null ? { docKey: row.docKey } : { pageId: row.pageId ?? "" };
      const snapshot = await api.draftSnapshot(target);
      const offer = new CustomEvent(COMPOSER_ATTACH_EVENT, {
        cancelable: true,
        detail: attachEventDetail(snapshot),
      });
      window.dispatchEvent(offer);
      nav.toast(L.planTab.sentToComposer);
    } finally {
      setSending(false);
    }
  };

  const unlink = async (row: PlanRow) => {
    if (row.pageId === null || screenRoute === null) return;
    setUnlinkFailed(false);
    try {
      await api.mapWrite([{ op: "remove", pageId: row.pageId, route: routePath(screenRoute) }]);
      nav.toast(L.planTab.unlinkDone(row.title));
      // 목록을 다시 읽는다 — 연결의 정본이 바뀌었다.
      setReloadTick((n) => n + 1);
    } catch {
      setUnlinkFailed(true);
    }
  };

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
            <button
              type="button"
              className="nx-mlink"
              onClick={() => {
                setPicked(null);
                setBody(null);
              }}
            >
              {L.chat.dismiss}
            </button>
          </>
        ) : (
          <span className="nx-plantab-readonly">{L.planTab.readOnly}</span>
        )}
      </div>
      {picked === null ? (
        <>
          {rows === null && <div className="nx-plantab-loading" aria-busy="true" />}
          {rows !== null && rows.length === 0 && (
            <div className="nx-plantab-empty">
              <p>{L.planTab.empty}</p>
              {screenRoute !== null && (
                <button
                  type="button"
                  className="nx-btn nx-btn--sm"
                  aria-expanded={picking}
                  onClick={() => setPicking((before) => !before)}
                >
                  {L.planTab.pick}
                </button>
              )}
              {picking && (
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
                  {pickFailed && <p className="nx-psync-foot">{L.planSync.pickFailed}</p>}
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
                          disabled={linking}
                          onClick={() => void linkDoc(doc)}
                        >
                          <FileSmIcon />
                          <span>{doc.title}</span>
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
            </div>
          )}
          {/* 같이 고친 기록 묶음(C4) — 실제로 같이 고쳐진 문서가 새것부터 저절로 보인다. */}
          {(rows ?? []).some((row) => row.synced !== undefined) && (
            <ul className="nx-plantab-list" aria-label={L.planTab.changedGroup}>
              <li className="nx-plantab-group">{L.planTab.changedGroup}</li>
              {(rows ?? [])
                .filter((row) => row.synced !== undefined)
                .map((row) => (
                  <li key={row.key} className="nx-plantab-row">
                    <button
                      type="button"
                      className="nx-plantab-open"
                      title={row.title}
                      onClick={() => setPicked(row)}
                    >
                      <FileSmIcon />
                      <span className="nx-plantab-title">{row.title}</span>
                      <span className="nx-plantab-sec">
                        {L.planTab.changedBlocks(row.synced?.changes ?? 0)}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
          <ul className="nx-plantab-list" aria-label={L.planTab.listLabel}>
            {(rows ?? [])
              .filter((row) => row.synced === undefined)
              .map((row) => (
                <li key={row.key} className="nx-plantab-row">
                  <button
                    type="button"
                    className="nx-plantab-open"
                    title={row.title}
                    onClick={() => setPicked(row)}
                  >
                    <FileSmIcon />
                    <span className="nx-plantab-title">{row.title}</span>
                    {row.section !== null && <span className="nx-plantab-sec">{row.section}</span>}
                  </button>
                  <button
                    type="button"
                    className="nx-ibtn nx-ibtn--sm"
                    title={L.planTab.send}
                    aria-label={L.planTab.send}
                    disabled={sending}
                    onClick={() => void sendAsRef(row)}
                  >
                    <ClipIcon />
                  </button>
                  <button
                    type="button"
                    className="nx-ibtn nx-ibtn--sm"
                    title={L.planTab.open}
                    aria-label={L.planTab.open}
                    onClick={() => openInPlans(row)}
                  >
                    <FileSmIcon />
                  </button>
                  {row.linked && (
                    <button
                      type="button"
                      className="nx-ibtn nx-ibtn--sm"
                      title={L.planTab.unlink}
                      aria-label={L.planTab.unlink}
                      onClick={() => void unlink(row)}
                    >
                      <XIcon />
                    </button>
                  )}
                </li>
              ))}
          </ul>
          {unlinkFailed && (
            <p className="nx-m-note nx-tone--red" role="alert">
              {L.planTab.unlinkFailed}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="nx-plantab-meta">
            <span>{L.planTab.section(picked.section)}</span>
          </div>
          {body !== null ? (
            <div className="nx-plantab-body" ref={bodyRef}>
              {body.blocks !== null ? (
                <DocView blocks={body.blocks} api={api} pageId={body.pageId} />
              ) : (
                <Markdown text={body.markdown} />
              )}
            </div>
          ) : bodyFailed ? (
            <p className="nx-m-note nx-tone--red" role="alert">
              {L.history.readFailed}
            </p>
          ) : (
            <div className="nx-plantab-loading" aria-busy="true" />
          )}
          {/* 맞춰 보기의 결과(C7) — 판정만 보이고 손을 눌렀을 때만 그 방향으로 간다. */}
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
