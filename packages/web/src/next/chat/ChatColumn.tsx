import type { DraftRefEntry, PlanSyncDoc } from "@colonova-design/protocol";
import {
  alignThumbs,
  readTurn,
  type SessionPinHint,
  type TurnMarker,
} from "@colonova-design/protocol";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import type { PinAttachment } from "../../hooks/usePins";
import type { Attachment } from "../../lib/attachment";
import type { Block } from "../../lib/daemon-client";
import { koreanNoticeWords } from "../../lib/error-words";
import { pinsToTurn, rewordPinTurn } from "../../lib/preview-turns";
import { isToolRunning } from "../../lib/progress";
import { openScreenPath, screenPath } from "../../lib/screen-link";
import { tailMoving } from "../../lib/tape-visibility";
import type { TurnScreen } from "../../lib/turn-screens";
import { L } from "../labels";
import {
  getComposerSheet,
  setComposerSheetOpen,
  subscribeComposerSheet,
} from "../lib/composer-sheet";
import { connectionLock } from "../lib/connection-copy";
import { dockOf } from "../lib/dock";
import { makingPhase, makingWordOf } from "../lib/making";
import { PIN_SHOT_MAX } from "../lib/pin-words";
import { isPreparing } from "../lib/project-note";
import { latestResult } from "../lib/request-results";
import { planRetry } from "../lib/retry-send";
import { runPlan } from "../lib/run-plan";
import { shownScreenName, startersOf } from "../lib/starters";
import { nextTabIndex } from "../lib/tab-keys";
import { dedupeScreens } from "../lib/thread";
import { undoTargetFor } from "../lib/undo-last";
import { useHeldPhase } from "../lib/use-held-phase";
import { HISTORY_DRAWER_EVENT, HISTORY_OPEN_EVENT, HistoryPanel } from "../preview/HistoryDrawer";
import type { ChatColumnProps } from "../slots";
import { Composer, type ComposerHandle } from "./Composer";
import { AskCard } from "./cards";
import { SparkIcon } from "./icons";
import type { PlanSyncHand } from "./PlanSyncLine";
import { type PlanFocus, PlanTab } from "./PlanTab";
import { PublishFromSync } from "./PublishFromSync";
import { Starters } from "./Starters";
import { Thread } from "./Thread";
import { WorkDock } from "./WorkDock";

/** 오른쪽 칸 탭의 차례(S10) — 화살표 걸음과 탭 · 몸의 `id` 짝이 이 차례 하나를 본다. */
const RTABS = ["chat", "plans", "history"] as const;
type RTab = (typeof RTABS)[number];
/** 탭 단추의 `id` — `aria-controls` 로 몸과 짝짓는다(2026-11-03 탭 알약식과 함께). */
const RTAB_IDS: Record<RTab, string> = {
  chat: "nx-rtab-chat",
  plans: "nx-rtab-plans",
  history: "nx-rtab-history",
};
/** 탭 몸의 `id` — 대화록은 `role="log"`(살아있는 칸)를 지키고 나머지는 `tabpanel` 이다. */
const RTAB_BODY_IDS: Record<RTab, string> = {
  chat: "nx-rbody-chat",
  plans: "nx-rbody-plans",
  history: "nx-rbody-history",
};

/**
 * 오른쪽 칸(2026-10-31 화면 자리 개선안 S10 · S15) — 화면 자리에서 대화 · 기획서 · 작업 기록이
 * 탭으로 서는 오른쪽 칸이다. 위쪽만 탭으로 바뀌고, 작업 독(S4)과 입력창은 어느 탭에서도 바닥에
 * 남는다. 훅(`useSessions` · `usePins`)은 셸이 한 번만 부른 것을 받는다(`SlotProps`) —
 * 미리보기 칸과 같은 세션 · 같은 핀을 본다.
 *
 * 밖으로 나가는 신호: `nx:history:open` 은 이 칸이 받아 넓은 창의 작업 기록 탭으로 바꾸고,
 * 좁은 창은 `nx:history:drawer`(서랍 — 화면 칸이 듣는다)로 돌린다. `nx:addr:hint` 는 결과
 * 띠의 화면 칩에 손이 올 때 주소창을 잠깐 물들인다(S9의 거꾸로). 들어오는 신호:
 * `nx:thread:goto`(지금 화면을 바꾼 말 — 결과 띠로 굴러간다), `nx:pins:send`(말풍선의 지금 보내기),
 * `nx:composer:attach`(미리보기의 AI에게 이 화면 보여 주기). 좁은 창의 입력창 시트는
 * `lib/composer-sheet` 의 열림이 고른다. 그리고 되돌리기가 마치면
 * 보내는 `nx:history:changed` 를 듣고 되돌아갈 곳을 다시 읽는다.
 */
export function ChatColumn({
  daemon,
  settings,
  sessions,
  pins,
  project,
  nav,
  narrow,
  offstage = false,
  rightTab = "chat",
  screenRoute = null,
  screenName = null,
  sheetOn = false,
}: ChatColumnProps) {
  const { api, pending, resolvePending } = daemon;
  const { active, activeId } = sessions;
  const blocks = active?.blocks ?? [];
  const tab = rightTab;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;

  // 같이 고치기의 곁줄 손(2026-10-30) — 초안 열기 · 되돌리기 · 연결 끊기 · 문서 고르기 · 곁줄 발행(2026-11-02 C3).
  // `보기` 는 기획서 칸으로 옮기지 않고 오른쪽 칸의 기획서 탭을 그 문서의 바뀐 절로 연다(2026-11-02 C4).
  const planFocusScope = useMemo(
    () => ({ api, activeId, project: daemon.activeSlug, screenRoute }),
    [api, activeId, daemon.activeSlug, screenRoute],
  );
  const planFocusScopeRef = useRef(planFocusScope);
  planFocusScopeRef.current = planFocusScope;
  const [planFocus, setPlanFocus] = useState<(PlanFocus & { scope: typeof planFocusScope }) | null>(
    null,
  );
  const planFocusNonce = useRef(0);
  // 곁줄 발행 팝 — 열려 있는 동안 약속을 쥐고, 창이 닫히면 결과를 돌려준다(곁줄 문구가 바뀐다).
  const [publishTarget, setPublishTarget] = useState<{
    doc: PlanSyncDoc;
    changes: number;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const planSync = useMemo<PlanSyncHand>(
    () => ({
      open: (doc) => {
        const nonce = ++planFocusNonce.current;
        const isCurrent = () =>
          planFocusScopeRef.current === planFocusScope && planFocusNonce.current === nonce;
        // 바뀐 절을 찾아 그 문서로 간다(C4) — 절은 같이 고친 기록에서 푼다. 못 찾으면 문서 맨 위로 열린다.
        if (activeId !== null) {
          void api
            .draftSyncDocs(activeId)
            .then(({ docs }) => {
              if (!isCurrent()) return;
              const hit = docs.find((one) => one.docKey === doc.docKey) ?? null;
              setPlanFocus({
                scope: planFocusScope,
                pageId: doc.pageId,
                docKey: doc.docKey,
                section: hit?.sections[0] ?? null,
                nonce,
              });
            })
            .catch(() => {
              if (!isCurrent()) return;
              setPlanFocus({
                scope: planFocusScope,
                pageId: doc.pageId,
                docKey: doc.docKey,
                section: null,
                nonce,
              });
            });
        } else {
          setPlanFocus({
            scope: planFocusScope,
            pageId: doc.pageId,
            docKey: doc.docKey,
            section: null,
            nonce,
          });
        }
        nav.showRightTab("plans");
      },
      undo: (entryId) => api.draftSyncUndo(entryId).then(() => undefined),
      unlink: (link) =>
        api
          .mapWrite([{ op: "remove", pageId: link.pageId, route: link.route }])
          .then(() => undefined),
      pick: (requestId, pageId) => {
        if (activeId === null) return Promise.reject(new Error("no session"));
        return api.draftSyncPick(activeId, requestId, pageId).then(() => undefined);
      },
      // 같이 고치기 게이트(2026-11-03 A안 1A-1) — 세 손 모두 결과는 `plans.synced` 방송으로 온다.
      apply: (requestId, docKey) => {
        if (activeId === null) return Promise.reject(new Error("no session"));
        return api.draftSyncApply(activeId, requestId, docKey).then(() => undefined);
      },
      skip: (requestId, docKey) => {
        if (activeId === null) return Promise.reject(new Error("no session"));
        return api.draftSyncSkip(activeId, requestId, docKey).then(() => undefined);
      },
      retry: (requestId) => {
        if (activeId === null) return Promise.reject(new Error("no session"));
        return api.draftSyncRetry(activeId, requestId).then(() => undefined);
      },
      docs: () => api.docList().then((result) => result.docs ?? []),
      // 곁줄 발행(C3) — 쓰기 게이트가 열려 있을 때만 손이 선다. 확인 창은 그대로 화면 자리 팝으로 뜬다.
      ...(project?.confluence?.writable === true
        ? {
            publish: (doc: PlanSyncDoc) =>
              new Promise<boolean>((resolve) => {
                setPublishTarget({ doc, changes: doc.changes, resolve });
              }),
          }
        : {}),
    }),
    [api, nav, activeId, project, planFocusScope],
  );

  // 이 대화의 사람 말 수 — 근거 줄이 다시 읽는 셈(보내기 중인 말도 센다 — 보낸 직후에 늘고,
  // 기록이 남는 때와 마친다). 대화가 바뀌면 0부터 다시 센다.
  const sentCount =
    blocks.filter((block) => block.type === "user").length + sessions.outgoing.length;
  const chat = settings.chat;
  const preparing = project !== null && isPreparing(project);
  const contextFull = sessions.usage !== null && Math.round(sessions.usage.percentage) >= 85;

  // 이 대화의 근거 — 작업 독의 `기획서 N` 칩과 펼쳐진 근거 줄, 기획서 탭이 같은 목록을 읽는다.
  const [refEntries, setRefEntries] = useState<DraftRefEntry[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 사람 말 수는 다시 읽는 방아쇠일 뿐 — 몸에서 쓰지 않는다.
  useEffect(() => {
    if (activeId === null) {
      setRefEntries([]);
      return undefined;
    }
    let cancelled = false;
    api
      .draftRefs(activeId)
      .then(({ refs }) => {
        if (!cancelled) setRefEntries(refs);
      })
      .catch(() => {
        if (!cancelled) setRefEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api, activeId, sentCount]);

  // 좁은 창이면 미리보기 탭을 앞에 세운 뒤 옮긴다 — 옮긴 곳이 보여야 한다.
  const openScreen = useCallback(
    (screen: TurnScreen) => {
      if (narrow) nav.showTab("preview");
      if (!openScreenPath(screen.path)) {
        void window.colonovaDesignDesktop?.preview?.navigate?.(screen.path);
      }
    },
    [narrow, nav],
  );

  // --- 방금 한 것 되돌리기 ---------------------------------------------------
  // 결과 띠에만 선다 — 그 요청의 보관이 프로젝트 기록의 맨 위일 때만, 그래서 되돌리면 정확히 그 요청만
  // 사라질 때만(`lib/undo-last.ts`). 기록은 도는 답이 끝났을 때 · 새 보관이 쌓일 때 · 되돌린 뒤(`nx:history:changed`)에
  // 다시 읽는다. 단추는 작업 기록을 열어 그 되돌아갈 곳의 확인을 미리 열어 줄 뿐 — 되돌리는 일은 기록의 확인이 한다.
  const cycleScreens = daemon.repo?.cycleScreens;
  const lastRequestId = sessions.running
    ? null
    : (latestResult(blocks, cycleScreens)?.requestId ?? null);
  // 읽어 온 되돌아갈 곳은 어느 요청의 것인지 함께 든다 — 마지막 결과가 바뀐 직후 옛 요청의 곳이 새 카드에 서지 않게.
  const [undoTarget, setUndoTarget] = useState<{
    requestId: string;
    sha: string;
    count: number;
  } | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  useEffect(() => {
    const bump = () => setHistoryTick((n) => n + 1);
    window.addEventListener("nx:history:changed", bump);
    return () => window.removeEventListener("nx:history:changed", bump);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 기록을 다시 읽어야 하는 때(요청 · 보관 수 · 기록이 바뀐 신호)만 센다.
  useEffect(() => {
    if (lastRequestId === null) {
      setUndoTarget(null);
      return undefined;
    }
    let cancelled = false;
    api
      .saveHistory()
      .then(({ entries }) => {
        if (cancelled) return;
        const target = undoTargetFor(entries, cycleScreens, lastRequestId);
        setUndoTarget(target === null ? null : { requestId: lastRequestId, ...target });
      })
      .catch(() => {
        if (!cancelled) setUndoTarget(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    api,
    lastRequestId,
    cycleScreens?.length,
    daemon.repo?.pendingChanges,
    daemon.repo?.branch,
    historyTick,
  ]);

  // 보낸 핀의 회색 배지는 답이 끝나면 떠난다 — 답의 끝을 아는 것은 이 칸이다.
  const wasRunning = useRef(sessions.running);
  useEffect(() => {
    if (wasRunning.current && !sessions.running) pins.dismissGhosts();
    wasRunning.current = sessions.running;
  }, [sessions.running, pins]);

  // --- 멈추기 ----------------------------------------------------------
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    if (!sessions.running) setStopping(false);
  }, [sessions.running]);
  const stop = () => {
    if (!activeId) return;
    setStopping(true);
    void api.interrupt(activeId).catch(() => setStopping(false));
  };

  // --- 보내기: 글 · 첨부 · 핀이 한 턴 ---------------------------------------
  // 핀 묶음의 고쳐서 보내기(2026-10-04 ux-plan PR1) — 문장은 입력창에서 고치고
  // 표식 · 찍은 그림 · 화면은 원래 턴에서 온다. 다음 보내기 한 번을 먹고,
  // 같은 대화에서 보낼 때만 쓴다.
  const pinReplay = useRef<{
    sessionId: string | null;
    turn: string;
    thumbs: string[];
    screens: Array<{ screen: string }>;
  } | null>(null);
  const send = async (
    text: string,
    attachments: Attachment[],
    sent: PinAttachment[],
    shown: Array<{ screen: string }>,
    onTarget?: (id: string) => void,
  ) => {
    // 보내면 좁은 창의 펼친 입력창은 접힌다(화면 칸의 한 줄이 다시 선다) — 초점
    // 복귀 의지는 액션 시점에 적는다: 커밋에서 상자가 먼저 걷히면 layout effect
    // 에서는 초점이 이미 body 로 떨어져 읽을 수 없다(2026-11-12 실앱 확인).
    if (sheetLive) foldIntent.current = true;
    setComposerSheetOpen(false);
    // 핀의 크롭은 그림으로 함께 간다 — 맨 앞에 세운다(데몬이 앞 여섯 장을 카드 썸네일로 쓴다).
    const pinImages: Attachment[] = sent.slice(0, PIN_SHOT_MAX).flatMap((pin) =>
      pin.shot
        ? [
            {
              kind: "image" as const,
              name: `pin-${pin.id}.jpg`,
              mediaType: pin.shot.mediaType,
              data: pin.shot.data,
              size: 0,
            },
          ]
        : [],
    );
    // 핀의 정체를 데이터로도 싣는다 — 데몬이 클론에서 `파일 후보:` 를 찾는다.
    const hints: SessionPinHint[] = sent.map((pin) => ({
      id: pin.id,
      screen: pin.screen,
      ...(pin.element.kind === "region"
        ? {}
        : {
            ...(pin.element.text ? { text: pin.element.text } : {}),
            ...(pin.element.owners?.length ? { owners: pin.element.owners } : {}),
            ...(pin.element.attrs?.testId ? { testId: pin.element.attrs.testId } : {}),
          }),
    }));
    const replay = pinReplay.current;
    pinReplay.current = null;
    const live =
      replay !== null && replay.sessionId === (sessions.activeId ?? null) ? replay : null;
    // 되살린 찍은 그림 — 이 창의 화면 응답이 실어 준 것(라이브 화면에서 본 몫).
    const replayShots: Attachment[] = (live?.thumbs ?? []).map((thumb, index) => ({
      kind: "image" as const,
      name: `pin-${index + 1}.jpg`,
      mediaType: "image/jpeg",
      data: thumb,
      size: 0,
    }));
    // 핀으로 처음 여는 대화는 첫 핀의 화면 이름을 얻는다 — 화면 id(`index` ·
    // `member/list`)가 아니라 사람의 이름으로: 첫 화면, 아니면 이번 작업의 화면
    // 제목. 둘 다 모르면 데몬의 자리 표시(새 화면)에 맡긴다(단계 8 에서 봄).
    const first = !activeId ? sent[0] : undefined;
    const firstPath = first ? screenPath(first.screen) : null;
    const name =
      firstPath === null
        ? undefined
        : firstPath === "/"
          ? L.preview.homeScreen
          : (daemon.repo?.cycleScreens?.find(
              (s) => s.title.trim() && screenPath(s.route) === firstPath,
            )?.title ?? undefined);
    setEditHint(false);
    try {
      pinned.current = true;
      setUnpinned(false);
      setHasNew(false);
      await sessions.submit(
        live
          ? rewordPinTurn(live.turn, text)
          : sent.length > 0
            ? pinsToTurn(sent, text, () => null)
            : text,
        [...pinImages, ...replayShots, ...attachments],
        { name, onTarget },
        dedupeScreens([
          ...(live?.screens ?? []),
          ...sent.map((pin) => ({ screen: pin.screen })),
          ...shown,
        ]),
        sent.length > 0 ? hints : undefined,
      );
    } catch (error) {
      // 삼킨 보내기의 몫을 돌려놓는다 — 입력창의 말과 첨부가 남는 것과 같은 이유다.
      if (live !== null) pinReplay.current = live;
      throw error;
    }
    if (sent.length > 0) void pins.markSent(sent);
  };

  // 표식의 화면 낱말을 화면 id 로 되걷는다 — 이번 작업의 화면 이름표가 거꾸로
  // 답하는 길이다(2026-10-04 ux-plan PR1). 못 찾은 낱말은 그대로 쓴다: 옛
  // 표식은 이름표를 못 얻으면 id 를 그대로 실었다.
  const pinScreens = (
    marker: Extract<TurnMarker, { kind: "comments" }>,
  ): Array<{ screen: string }> => {
    const titled = daemon.repo?.cycleScreens;
    const idOf = (word: string) => titled?.find((s) => s.title === word)?.route ?? word;
    const words = marker.items.some((item) => item.screen)
      ? marker.items.flatMap((item) => (item.screen ? [item.screen] : []))
      : [marker.screen];
    return [...new Set(words.map(idOf))].map((screen) => ({ screen }));
  };
  // 다시 시도 — 같은 말을 한 번만(두 번 눌러도 두 번 가지 않게). 대화 기록에는 첨부의 바이트가
  // 없어서(개수와 이름뿐) 길이 셋이다(2026-10-06 UX 점검):
  //  · 이 실행에서 보낸 원본을 쥐고 있으면 글 · 첨부 · 핀을 그대로 다시 보낸다.
  //  · 원본이 없고 되살릴 수 없는 첨부가 있으면 보내지 않는다 — 말만 가면 AI 가 없는 그림을
  //    어림짐작한다. 말을 입력창에 돌려주고 다시 붙이라고 알린다.
  //  · 잃는 것이 없으면 기록이 가진 몫으로 다시 짠다: 핀 묶음의 화면(게이트 입력)과 찍은 그림,
  //    그리고 표석째의 글(핀의 행은 그 안에 산다).
  const retrying = useRef(false);
  const retry = (send: Extract<Block, { type: "user" }>) => {
    if (retrying.current) return;
    const { marker } = readTurn(send.text);
    const pins = marker?.kind === "comments" ? pinScreens(marker) : undefined;
    // 되살린 찍은 그림 — 이 창의 화면 응답이 실어 준 몫(라이브 화면에서 본 것).
    const shots: Attachment[] =
      marker?.kind === "comments"
        ? alignThumbs(marker.items, send.thumbs)
            .filter((thumb): thumb is string => thumb !== null)
            .map((thumb, index) => ({
              kind: "image" as const,
              name: `pin-${index + 1}.jpg`,
              mediaType: "image/jpeg",
              data: thumb,
              size: 0,
            }))
        : [];
    const plan = planRetry(send, sessions.sentOriginal(sessions.activeId), shots.length);
    if (plan.kind === "putBack") {
      putBack(send);
      nav.toast(L.chat.retryReattach);
      return;
    }
    retrying.current = true;
    const { original } = plan.kind === "replay" ? plan : { original: null };
    const run = original
      ? sessions.submit(
          original.text,
          original.attachments,
          undefined,
          original.pins,
          original.pinHints,
        )
      : sessions.submit(send.text, shots, undefined, pins);
    void run
      .catch(() => undefined)
      .finally(() => {
        retrying.current = false;
      });
  };

  // 잃은 말의 다시 시도(W8) — 데몬의 방에서 통째로 되살려(입력창이 쓰던 길) 그
  // 말을 그대로 다시 보낸다. 방에서 꺼낸 말은 카드로 남지 않게 치운다.
  const retryDropped = (itemId: string) => {
    void sessions
      .takeDropped(itemId)
      .then((payload) => {
        if (!payload) return undefined;
        sessions.dismissDropped(itemId);
        return send(payload.text, payload.attachments, [], payload.pins ?? []);
      })
      .catch(() => undefined);
  };

  // --- 고쳐서 다시 보내기(U15) · 여기서 새 대화 ----------------------------
  const [editHint, setEditHint] = useState(false);
  const editTarget = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 대화 전환 시 되보내기 힌트를 초기화하는 의도된 의존성입니다.
  useEffect(() => {
    setEditHint(editTarget.current);
    editTarget.current = false;
  }, [activeId]);
  const [prefill, setPrefill] = useState<{
    text: string;
    nonce: number;
    append?: boolean;
    screen?: string;
    select?: [number, number];
  } | null>(null);
  const nonce = useRef(0);
  const fill = (text: string, append = false, screen?: string) => {
    nonce.current += 1;
    setPrefill({ text, nonce: nonce.current, append, screen });
  };
  const editResend = (prompt: number, send: Extract<Block, { type: "user" }>) => {
    // k 번째 말 앞까지 = k-1 번째 답까지. 첫 말이면 이어받을 것이 없다 — 새 대화다.
    editTarget.current = true;
    const branched =
      prompt > 1 ? sessions.branchFrom(prompt - 1) : Promise.resolve(sessions.fresh());
    void branched.then(() => {
      putBack(send);
      setEditHint(true);
      nav.toast(L.transcript.editResendToast);
    });
  };
  // 보낸 말을 입력창으로 돌려 놓는다 — 고쳐서 다시 보내기와, 첨부를 되살릴 수 없는 다시 시도가
  // 같은 길이다. 핀 묶음은 문장만 입력창으로 오고, 몫(표석 · 찍은 그림 · 화면)은 다음 보내기에
  // 원래 턴에서 온다(2026-10-04 ux-plan PR1).
  const putBack = (send: Extract<Block, { type: "user" }>) => {
    const { marker } = readTurn(send.text);
    if (marker?.kind === "comments") {
      pinReplay.current = {
        sessionId: sessions.activeId,
        turn: send.text,
        thumbs: alignThumbs(marker.items, send.thumbs).filter(
          (thumb): thumb is string => thumb !== null,
        ),
        screens: pinScreens(marker),
      };
      fill(marker.note ?? "");
    } else {
      fill(send.text);
    }
  };
  const fork = (turn: number) => {
    void sessions.branchFrom(turn).then(() => nav.toast(L.transcript.forkToast));
  };
  const provider = sessions.chipTarget(sessions.activeId ? "session" : "next").provider;
  const canBranch =
    daemon.status?.providers?.find((p) => p.id === provider)?.capabilities?.branch === true;

  // --- 스크롤: 맨 아래를 보고 있으면 따라간다 ---------------------------------
  const scroll = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [unpinned, setUnpinned] = useState(false);
  // 바닥을 떠난 동안 온 변화 — `맨 아래로` 가 `새 내용` 로 바뀌는 조건이다.
  const [hasNew, setHasNew] = useState(false);
  const remember = () => {
    const el = scroll.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    pinned.current = atBottom;
    setUnpinned(!atBottom);
    if (atBottom) setHasNew(false);
  };
  const toBottom = useCallback((smooth = false) => {
    const el = scroll.current;
    if (!el) return;
    // 부드러운 이동은 사람이 누른 길에만 — 따라가기는 흐르는 답과 싸우지 않게 즉시.
    if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 블록이 바뀔 때마다(흐르는 답 포함) 따라간다.
  useEffect(() => {
    if (pinned.current) toBottom();
    else setHasNew(true);
  }, [blocks, pending.length, sessions.outgoing.length]);
  // 입력창이 커져 대화가 줄어들 때도 바닥에 붙어 있으면 그 자리를 지킨다 —
  // 여러 줄 · 핀 줄 · 첨부가 늘어나도 마지막 말이 가려지지 않게.
  useEffect(() => {
    const el = scroll.current;
    if (el === null || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      if (pinned.current) toBottom();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [toBottom]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 다른 대화는 새로 보는 것 — 맨 아래부터.
  useEffect(() => {
    pinned.current = true;
    setUnpinned(false);
    setHasNew(false);
    requestAnimationFrame(() => toBottom());
  }, [activeId]);

  // --- 작업 독의 재료(S4) ----------------------------------------------
  const tailLive = tailMoving(blocks, chat.showThinking, chat.showTools, isToolRunning);
  const awaiting = sessions.awaitingTurn?.sessionId === activeId ? sessions.awaitingTurn : null;
  const clockStart = active?.turnStartedAt ?? awaiting?.since ?? null;
  // 도는 동안 독은 늘 그 자리에 선다 — 붙였다 떨어졌다 하며 대화를 밀어내지 않게.
  const clockMounted = sessions.running || awaiting !== null;
  const empty =
    blocks.length === 0 &&
    sessions.queue.length === 0 &&
    sessions.outgoing.length === 0 &&
    !clockMounted;
  // 독의 말 — 지금 도는 도구의 묶음이 말을 고른다(`화면 파일을 고치는 중`). 말은 1.5초 이상 산다.
  // 지금 고치는 화면의 이름은 미리보기의 라이브 신호가 알려 준다(이름을 모르면 말만 선다).
  const runPhase = useHeldPhase(clockMounted ? makingPhase(blocks) : null, clockMounted);
  const runWord = makingWordOf(runPhase, {
    read: L.journey.makingRead,
    file: L.journey.makingFile,
    command: L.journey.makingCheck,
    fallback: L.chat.working,
  });
  const editingScreen = activeId === null ? null : (daemon.editingScreens.get(activeId) ?? null);
  const editingName = clockMounted && !tailLive ? (editingScreen?.title ?? null) : null;
  const runningPlan = clockMounted ? runPlan(blocks) : null;

  // --- 작업 독의 줄 — 차례는 lib/dock.ts 가 정한다 -----------------------------
  const visiblePending = pending.filter((request) => request.sessionId === activeId);
  const notices = [
    editHint ? L.transcript.editScreenHint : "",
    contextFull ? L.chat.contextFull : "",
  ].filter((line) => line !== "");
  const dock = dockOf({
    running: clockMounted,
    asks: visiblePending.length,
    notices,
    refs: refEntries.length,
  });

  // --- 빈 화면이 빠지는 모습 · 대화록의 열쇠 ----------------------------------
  // 첫 말이 올라오면 빈 화면은 흐려지며 빠진다 — 깜빡이며 사라지지 않게.
  const [emptyFade, setEmptyFade] = useState(false);
  const wasEmpty = useRef(empty);
  useEffect(() => {
    const was = wasEmpty.current;
    wasEmpty.current = empty;
    if (empty) {
      setEmptyFade(false);
      return undefined;
    }
    if (!was) return undefined;
    setEmptyFade(true);
    const timer = window.setTimeout(() => setEmptyFade(false), 240);
    return () => window.clearTimeout(timer);
  }, [empty]);
  // 입력창에 보낼 것이 있는가 — 시작점 칩이 쓰던 말을 덮지 않게 물러난다(Composer 가 알린다).
  const [filled, setFilled] = useState(false);
  // 빈 대화와 칩은 지금 미리보기의 이름만 쓴다.
  const emptyScreenName = shownScreenName(screenName);
  const starters = useMemo(
    () => startersOf(emptyScreenName, L.composer.starters),
    [emptyScreenName],
  );
  // 대화가 갈리면 대화록은 새로 마운트되지만, 첫 말로 대화가 태어나는 순간(대화
  // 없음 → 첫 대화)은 그대로 이어 받는다 — 다시 마운트되면 모든 줄의 등장
  // 애니메이션이 한 번 더 돈다.
  const threadKeyNav = useRef<{ id: string | null; key: string }>({ id: null, key: "new" });
  if (activeId !== threadKeyNav.current.id) {
    threadKeyNav.current =
      activeId === null || threadKeyNav.current.id === null
        ? { id: activeId, key: "new" }
        : { id: activeId, key: activeId };
  }

  // --- 오른쪽 칸의 탭(S10) ----------------------------------------------
  // 탭이 대화가 아니면 새 답 · 묻는 카드가 와도 눈에 안 보인다 — 대화 탭 곁의 점이 말하고,
  // 묻는 카드는 작업 독의 ② 칸이 대신한다. 대화 탭으로 돌아오면 점은 거둔다.
  const [freshNews, setFreshNews] = useState(false);
  useEffect(() => {
    if (tab === "chat") setFreshNews(false);
  }, [tab]);
  useEffect(() => {
    if (wasRunning.current && !sessions.running && tabRef.current !== "chat") {
      setFreshNews(true);
    }
  }, [sessions.running]);
  // 탭은 ref 로 읽는다 — 점을 다시 세우는 것은 묻는 카드 수의 변화뿐이다.
  useEffect(() => {
    if (visiblePending.length > 0 && tabRef.current !== "chat") setFreshNews(true);
  }, [visiblePending.length]);

  // 작업 기록 탭의 되돌아갈 곳 — `nx:history:open` 은 이 칸이 받는다. 넓은 창은 작업 기록
  // 탭으로(S10), 좁은 창은 화면 칸의 서랍으로 돌린다(S12 — 화면 덮는 시트의 몫이다).
  const [histArm, setHistArm] = useState<{ sha: string; count: number } | null>(null);
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ restoreTo?: unknown; count?: unknown } | null>).detail;
      if (narrowRef.current) {
        window.dispatchEvent(new CustomEvent(HISTORY_DRAWER_EVENT, { detail }));
        nav.showTab("preview");
        return;
      }
      setHistArm(
        typeof detail?.restoreTo === "string"
          ? { sha: detail.restoreTo, count: typeof detail.count === "number" ? detail.count : -1 }
          : null,
      );
      nav.showRightTab("history");
    };
    window.addEventListener(HISTORY_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(HISTORY_OPEN_EVENT, onOpen);
  }, [nav]);

  // 지금 화면을 바꾼 말(S9) — 미리보기의 단추가 부르면 대화 탭으로 돌아와 그 답의
  // 결과 띠로 굴러가고, 띠가 한 번 빛난다.
  useEffect(() => {
    const onGoto = (event: Event) => {
      const turnId = (event as CustomEvent<{ turnId?: unknown }>).detail?.turnId;
      if (typeof turnId !== "string") return;
      nav.showRightTab("chat");
      nav.showTab("chat");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = scroll.current?.querySelector(`[data-turn='${CSS.escape(turnId)}']`);
          if (!el) return;
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          el.classList.add("nx-band--flash");
          window.setTimeout(() => el.classList.remove("nx-band--flash"), 1600);
        });
      });
    };
    window.addEventListener("nx:thread:goto", onGoto);
    return () => window.removeEventListener("nx:thread:goto", onGoto);
  }, [nav]);
  // 결과 띠의 화면 칩에 손이 올 때 주소창이 그 이름으로 잠깐 빛난다(S9의 거꾸로 — 옮기지는 않는다).
  const onScreenHover = useCallback((path: string | null) => {
    window.dispatchEvent(new CustomEvent("nx:addr:hint", { detail: { route: path } }));
  }, []);

  // --- 기획서 탭의 이어진 문서 수(S10) ---------------------------------------
  const [planCount, setPlanCount] = useState(0);

  // --- 작업 기록 탭의 재료 — 제출의 순간(구분선) -------------------------------
  const handoff = daemon.repo?.handoff ?? null;
  const submits = useMemo(() => {
    if (!handoff) return [];
    const times: string[] = [];
    for (const view of Object.values(daemon.sessions)) {
      for (const block of view.blocks) {
        if (
          block.type === "milestone" &&
          block.subtype === "handed" &&
          block.pr === handoff.number
        ) {
          times.push(block.at);
        }
      }
    }
    return times.sort();
  }, [daemon.sessions, handoff]);

  // --- 좁은 창의 입력창 시트(S12) ------------------------------------------
  // 화면 탭에서도 쓸 수 있게 같은 입력창을 화면 칸의 자리로 옮겨 그린다 — 포털의
  // 대상은 늘 `cmpBox` 하나이고 그 상자만 시트 자리와 제 자리 사이를 옮긴다. 포털의
  // 대상을 원소끼리 바꾸면 React 가 새 포털로 만들어 입력창이 재마운트되므로
  // (2026-11-12 — 붙인 첨부 · 보내는 중 · 거절 문구가 날아간다) 대상은 고정한다.
  // 열림은 `lib/composer-sheet` 가 쥐고, 접힌 한 줄(화면 칸)이 토글한다. 보내면
  // 접히고(send), 입력창의 접기 손과 Esc 도 같은 길로 거둔다.
  const sheet = useSyncExternalStore(subscribeComposerSheet, getComposerSheet, getComposerSheet);
  useEffect(() => {
    if (!sheetOn) setComposerSheetOpen(false);
  }, [sheetOn]);
  // 포털이 그리는 상자 — 대상이 이 상자로 고정되어 자리를 옮겨도 입력창이 재마운트되지 않는다.
  const [cmpBox] = useState<HTMLDivElement | null>(() =>
    typeof document === "undefined" ? null : document.createElement("div"),
  );
  // 포털의 빠진 자리 — 화면 탭이 아니면 상자가 이곳(제 자리)에 선다.
  const [cmpFallback, setCmpFallback] = useState<HTMLDivElement | null>(null);
  const sheetLive = sheetOn && sheet.open && sheet.host !== null;
  // 접기 의도 — 액션 시점에 적는다(커밋 후에는 초점 상태를 읽을 수 없다).
  const foldIntent = useRef(false);
  const wasSheetLive = useRef(false);
  useLayoutEffect(() => {
    if (cmpBox === null) return;
    const parent = sheetLive && sheet.host !== null ? sheet.host : cmpFallback;
    if (parent !== null && cmpBox.parentNode !== parent) parent.appendChild(cmpBox);
    if (!wasSheetLive.current && sheetLive) {
      // 펼치면 바로 칠 수 있게 — 상자가 자리에 들어선 뒤에 초점을 부른다.
      window.dispatchEvent(new Event("nx:composer:focus"));
    } else if (wasSheetLive.current && !sheetLive && sheetOn && foldIntent.current) {
      // 화면 탭에 머문 채 접기 · 보내기 · Esc 로 접힐 때(sheetOn 은 그대로 true)
      // 초점은 접힌 한 줄로 돌아간다. 대화 탭으로 옮겨 상자가 제 자리로 간
      // 때(sheetOn 이 false)는 상자째 초점이 살아 있으니 건드리지 않는다 —
      // 원소를 DOM 사이에서 옮겨도 초점은 따라간다.
      foldIntent.current = false;
      document.querySelector<HTMLElement>(".nx-fold-cmp")?.focus();
    }
    if (!sheetLive) foldIntent.current = false;
    wasSheetLive.current = sheetLive;
  }, [cmpBox, cmpFallback, sheetLive, sheet.host, sheetOn]);
  // 칸이 걷히면 문서 밖 상자도 거둔다 — 포털의 대상은 늘 살아 있는 하나다.
  useLayoutEffect(() => () => cmpBox?.remove(), [cmpBox]);

  // --- 끌어다 놓기: 칸 어디에 놓아도 입력창의 첨부로 ---------------------------
  const composer = useRef<ComposerHandle | null>(null);
  const registerHandle = useCallback((handle: ComposerHandle | null) => {
    composer.current = handle;
  }, []);
  const [dragDepth, setDragDepth] = useState(0);

  const lockReason = connectionLock(daemon.connection, L);
  const cycleMerged = daemon.repo?.handoff?.state === "merged";
  const placeholder = preparing
    ? L.composer.placeholderPreparing
    : pins.list.length > 0
      ? L.composer.placeholderPins
      : cycleMerged
        ? L.composer.placeholderMerged
        : L.composer.placeholder;
  // 다음 말 제안(2026-10-14 사용자 요청) — 준비 중과 반영 뒤의 자리 표시는 지금 할 일을 말하니 제안이
  // 대신하지 않는다. 핀이 담겼을 때와 일하는 중에 물러나는 것은 입력창이 안다.
  const nextSay = preparing || cycleMerged ? null : (active?.suggestion ?? null);

  const tabOff = tab !== "chat";
  // 맨 아래로 — 입력창 오른쪽 위에 떠서(S4) 줄을 차지하지 않는다. 입력창이 커져도 겹치지 않게
  // 감싸개 기준의 뜬 단추다.
  const jumpButton = unpinned ? (
    <button
      type="button"
      className="nx-jump"
      onClick={() => {
        pinned.current = true;
        setUnpinned(false);
        setHasNew(false);
        toBottom(true);
      }}
    >
      {hasNew ? L.chat.newContent : L.chat.toBottom}
    </button>
  ) : null;

  const composerBlock = (
    <div className="nx-cmp-wrap">
      {jumpButton}
      <WorkDock
        row={dock.main}
        runWord={runWord}
        screenName={editingName}
        startedAt={clockStart}
        plan={runningPlan}
        onStop={stop}
        stopping={stopping}
        onAskGo={() => {
          nav.showRightTab("chat");
          toBottom(true);
        }}
        entries={refEntries.length}
        daemon={daemon}
        sessionId={activeId}
        nav={nav}
      />
      <Composer
        daemon={daemon}
        sessions={sessions}
        subject={sessions.activeId ? "session" : "next"}
        draftKey={activeId ?? `new:${daemon.activeSlug ?? "none"}`}
        placeholder={placeholder}
        pins={pins.list}
        pinNumberStart={pins.ghosts.length + 1}
        onPinNote={pins.setNote}
        onPinRemove={pins.remove}
        onPinFocus={(id) => void window.colonovaDesignDesktop?.preview?.pinFlash?.(id)}
        narrow={narrow}
        onPinMode={
          (empty || emptyFade) && project !== null && !preparing
            ? undefined
            : () => {
                nav.showTab("preview");
                window.dispatchEvent(new CustomEvent("nx:pins:toggle"));
              }
        }
        disabledProviders={chat.disabledProviders}
        lockReason={lockReason}
        running={sessions.running}
        onStop={stop}
        stopping={stopping}
        suggestion={nextSay}
        prefill={prefill}
        listenPinsSend
        registerHandle={registerHandle}
        onContentChange={setFilled}
        onToast={nav.toast}
        onSend={send}
        onSheetFold={
          sheetLive
            ? () => {
                foldIntent.current = true;
                setComposerSheetOpen(false);
              }
            : undefined
        }
      />
    </div>
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 칸 전체가 파일을 놓는 자리다 — 드롭은 포인터의 일이고, 키보드는 입력창의 첨부 단추로 닿는다.
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: 위와 같다.
    <section
      // 비켜선 동안(집중 배치)은 `nx-offstage` 의 visibility 가 낭독과 초점에서도 칸을 뺀다.
      className={`nx-chat${dragDepth > 0 ? " nx-chat--drop" : ""}${offstage ? " nx-offstage" : ""}`}
      onDragOver={(event) => event.preventDefault()}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragDepth((depth) => depth + 1);
      }}
      onDragLeave={() => setDragDepth((depth) => Math.max(0, depth - 1))}
      onDrop={(event) => {
        event.preventDefault();
        setDragDepth(0);
        if (event.dataTransfer.files.length > 0) composer.current?.attach(event.dataTransfer.files);
      }}
    >
      {/* 탭 머리(S10 · 2026-11-03 사용자 결정으로 알약식 — 좁은 창의 세 탭과 한 얼굴, 칸 폭을
          셋이 나눈다) — 넓은 창의 오른쪽 칸이다. 좁은 창은 셸의 세 탭(화면 · 대화 · 기획서)이
          대신한다. 화살표 · Home/End 로 탭을 옮긴다(lib/tab-keys). */}
      {!narrow && (
        <div
          className="nx-rtabs"
          role="tablist"
          data-f6="rtabs"
          onKeyDown={(event) => {
            const next = nextTabIndex(event.key, RTABS.length, RTABS.indexOf(tab));
            if (next === null) return;
            event.preventDefault();
            const target = RTABS[next];
            if (target) {
              nav.showRightTab(target);
              event.currentTarget
                .querySelectorAll<HTMLButtonElement>("[role='tab']")
                [next]?.focus();
            }
          }}
        >
          <button
            type="button"
            role="tab"
            id={RTAB_IDS.chat}
            aria-selected={tab === "chat"}
            aria-controls={RTAB_BODY_IDS.chat}
            tabIndex={tab === "chat" ? 0 : -1}
            className={tab === "chat" ? "nx-rtab--on" : ""}
            onClick={() => nav.showRightTab("chat")}
          >
            <span className="nx-rtab-label">{L.tabs.chat}</span>
            {freshNews && <i className="nx-rtab-dot" role="status" aria-label={L.tabs.news} />}
          </button>
          <button
            type="button"
            role="tab"
            id={RTAB_IDS.plans}
            aria-selected={tab === "plans"}
            aria-controls={RTAB_BODY_IDS.plans}
            aria-label={planCount > 0 ? L.tabs.plansAria(planCount) : undefined}
            tabIndex={tab === "plans" ? 0 : -1}
            className={tab === "plans" ? "nx-rtab--on" : ""}
            onClick={() => nav.showRightTab("plans")}
          >
            <span className="nx-rtab-label">{L.tabs.plans}</span>
            {planCount > 0 && (
              <span className="nx-rtab-n" key={planCount}>
                {planCount}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            id={RTAB_IDS.history}
            aria-selected={tab === "history"}
            aria-controls={RTAB_BODY_IDS.history}
            tabIndex={tab === "history" ? 0 : -1}
            className={tab === "history" ? "nx-rtab--on" : ""}
            onClick={() => nav.showRightTab("history")}
          >
            <span className="nx-rtab-label">{L.tabs.history}</span>
          </button>
        </div>
      )}

      {/* 대화 탭의 몸 — 마운트를 지킨다(탭이 바뀌어도 스크롤 · 흐르는 답이 살아 있다). */}
      <div
        id={RTAB_BODY_IDS.chat}
        className={`nx-transcript${tabOff ? " nx-tab-off" : ""}`}
        role="log"
        aria-live="polite"
        aria-hidden={tabOff || undefined}
        inert={tabOff || undefined}
        data-f6="body"
        tabIndex={tabOff ? -1 : undefined}
        ref={scroll}
        onScroll={remember}
      >
        {sessions.historyFailed && (
          <div className="nx-m-note nx-tone--red">
            <span>{L.chat.historyFailed}</span>
            <button type="button" className="nx-mlink" onClick={sessions.reopen}>
              {L.chat.reopen}
            </button>
          </div>
        )}
        {(empty || emptyFade) && (
          <div className={`nx-empty-chat${emptyFade && !empty ? " nx-empty-chat--out" : ""}`}>
            <span className="nx-empty-sp">
              <SparkIcon />
            </span>
            {/* 빈 대화는 지금 화면에서 시작한다(S5) — 화면 이름을 모르면 서비스 전체의 말이다. */}
            <h2>
              {preparing || project === null
                ? L.transcript.emptyTitle
                : emptyScreenName !== null
                  ? L.transcript.emptyTitleScreen(emptyScreenName)
                  : L.transcript.emptyTitleAny}
            </h2>
            {project && (
              <p>
                {preparing
                  ? L.transcript.emptyPreparing(project.name)
                  : narrow
                    ? L.transcript.emptyBodyNarrow(project.name)
                    : L.transcript.emptyBody(project.name)}
              </p>
            )}
            {/* 시작점 칩 — 새 대화의 빈 자리에서만 선다. 첫 칸은 찍기다(S5). 입력창에 말이 있거나
                잠겨 있으면 물러난다. */}
            {empty && (
              <Starters
                starters={starters}
                away={filled || lockReason !== null}
                onPick={(starter) => {
                  nonce.current += 1;
                  setPrefill({
                    text: starter.text,
                    nonce: nonce.current,
                    ...(starter.pick ? { select: starter.pick } : {}),
                  });
                }}
                onPin={
                  project !== null && !preparing
                    ? () => {
                        if (narrow) nav.showTab("preview");
                        window.dispatchEvent(new CustomEvent("nx:pins:toggle"));
                      }
                    : undefined
                }
              />
            )}
          </div>
        )}
        {!empty && (
          <Thread
            key={threadKeyNav.current.key}
            blocks={blocks}
            live={sessions.running}
            showThinking={chat.showThinking}
            showTools={chat.showTools}
            previewUrl={daemon.repo?.previewUrl ?? null}
            cycleScreens={daemon.repo?.cycleScreens}
            handoff={daemon.repo?.handoff ?? null}
            projectWorking={project?.working === true}
            canBranch={canBranch}
            queue={sessions.queue}
            outgoing={sessions.outgoing}
            preparing={preparing}
            dropped={sessions.dropped}
            onFork={fork}
            onEditResend={editResend}
            onRetry={retry}
            onRetryDropped={retryDropped}
            onLogin={() =>
              void api.onboardingFix("login-claude").catch(() => nav.toast(L.chat.somethingWrong))
            }
            onAdditionalEdit={(screen) => {
              fill(
                L.requestResult.draft(screen.title ?? L.transcript.unknownScreen),
                true,
                screen.path,
              );
              nav.showThread();
              nav.showTab("chat");
              nav.toast(L.requestResult.draftReady);
            }}
            onOpenScreen={openScreen}
            onOpenHistory={() => window.dispatchEvent(new CustomEvent(HISTORY_OPEN_EVENT))}
            onScreenHover={onScreenHover}
            planSync={planSync}
            undoLast={
              lastRequestId !== null && undoTarget?.requestId === lastRequestId
                ? {
                    requestId: lastRequestId,
                    onUndo: () =>
                      window.dispatchEvent(
                        new CustomEvent(HISTORY_OPEN_EVENT, {
                          detail: { restoreTo: undoTarget.sha, count: undoTarget.count },
                        }),
                      ),
                  }
                : null
            }
            onReply={async (id, text) => {
              await api.replyToReview(id, text);
            }}
            onNote={async (text) => {
              await api.noteToDeveloper(text);
            }}
            onToast={nav.toast}
            onQueueEdit={(itemId) => {
              void sessions
                .queueRemove(itemId)
                .then((payload) => payload && fill(payload.text))
                .catch(() => undefined);
            }}
            onQueueNow={(itemId) => void sessions.queueSendNow(itemId).catch(() => undefined)}
            onBackgroundTask={(toolUseId) => {
              if (activeId) void api.backgroundTask(activeId, toolUseId).catch(() => undefined);
            }}
            onStopTask={(taskId) => {
              if (activeId) void api.stopTask(activeId, taskId).catch(() => undefined);
            }}
          />
        )}
        {sessions.error && (
          <div className="nx-m-note nx-tone--red" role="alert">
            <span>
              {koreanNoticeWords(sessions.error) ? sessions.error : L.chat.somethingWrong}
            </span>
            <button type="button" className="nx-mlink" onClick={() => sessions.setError(null)}>
              {L.chat.dismiss}
            </button>
          </div>
        )}
        {visiblePending.map((request) => (
          <AskCard
            key={request.requestId}
            request={request}
            commands={daemon.repo?.commands}
            onQuestion={(answers) =>
              // 실패는 카드가 받는다 — 거절이 돌아와 옵션이 다시 눌리는 자리가 된다.
              api.respondQuestion(request.requestId, answers, {}).then(() => {
                resolvePending(request.requestId);
              })
            }
            onPermission={(decision) =>
              api.respondPermission(request.requestId, decision).then(() => {
                resolvePending(request.requestId);
              })
            }
          />
        ))}
      </div>

      {/* 기획서 탭의 몸(S10) — 지금 화면에 이어진 기획서를 그 자리에서 읽는다. */}
      {tab === "plans" && (
        <PlanTab
          daemon={daemon}
          nav={nav}
          screenRoute={screenRoute}
          sessionId={activeId}
          sentCount={sentCount}
          onCount={setPlanCount}
          focus={planFocus?.scope === planFocusScope ? planFocus : null}
          onFocusConsumed={(nonce) =>
            setPlanFocus((current) =>
              current?.scope === planFocusScope && current.nonce === nonce ? null : current,
            )
          }
          tabpanelId={RTAB_BODY_IDS.plans}
          tabpanelLabel={L.tabs.plans}
        />
      )}
      {/* 곁줄 발행의 감싸개 팝(2026-11-02 · 같이 고치기 UX 계획 C3) — 확인 창은 그대로, 이동만 없앤다. */}
      {publishTarget !== null && (
        <PublishFromSync
          daemon={daemon}
          nav={nav}
          doc={publishTarget.doc}
          changes={publishTarget.changes}
          onDone={(ok) => {
            publishTarget.resolve(ok);
            setPublishTarget(null);
          }}
        />
      )}
      {/* 작업 기록 탭의 몸(S10) — 옛 서랍과 같은 몸(`HistoryPanel`)이다. */}
      {tab === "history" && (
        <div
          id={RTAB_BODY_IDS.history}
          className="nx-histtab"
          role="tabpanel"
          aria-label={L.tabs.history}
          data-f6="body"
          tabIndex={-1}
        >
          <HistoryPanel
            daemon={daemon}
            repo={daemon.repo}
            submits={submits}
            onRestored={() => {
              window.dispatchEvent(new CustomEvent("nx:history:restored"));
            }}
            toast={nav.toast}
            arm={histArm}
            onArmed={() => setHistArm(null)}
            active
            headless
          />
        </div>
      )}

      {/* 입력창 — 포털의 대상 `cmpBox` 를 고정해 두고 그 상자만 시트 자리와 이곳
          사이로 옮긴다(위의 layout effect). 상자째 옮기므로 재마운트 없이 쓰던
          글 · 핀 · 첨부가 살아 있다. */}
      <div className="nx-cmp-anchor" ref={setCmpFallback} />
      {cmpBox !== null && createPortal(composerBlock, cmpBox)}
    </section>
  );
}
