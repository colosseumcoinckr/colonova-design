import {
  alignThumbs,
  readTurn,
  type SessionPinHint,
  type TurnMarker,
} from "@colonova-design/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { connectionLock } from "../lib/connection-copy";
import { PIN_SHOT_MAX } from "../lib/pin-words";
import { isPreparing } from "../lib/project-note";
import { latestResult } from "../lib/request-results";
import { planRetry } from "../lib/retry-send";
import { dedupeScreens } from "../lib/thread";
import { undoTargetFor } from "../lib/undo-last";
import type { ChatColumnProps } from "../slots";
import { Elapsed } from "../status/Elapsed";
import { Composer, type ComposerHandle } from "./Composer";
import { AskCard } from "./cards";
import { ChevIcon, SparkIcon } from "./icons";
import { Thread } from "./Thread";

/**
 * 대화 칸(PLAN-UI 단계 2) — 문제 문장 · 대화록(카드 · `고친 화면` · 정산 줄) ·
 * 확인 카드 · 진행 시계 · 입력창. 훅은 셸이 한 번 부른 것을 받는다(`SlotProps`) —
 * 미리보기 칸과 같은 세션 · 같은 핀을 본다.
 *
 * 밖으로 나가는 신호 둘: `nx:history:open`(작업 기록 서랍 — 단계 3 이 듣는다. `방금 한 것 되돌리기` 는
 * `detail: { restoreTo, count }` 로 되돌아갈 곳의 확인을 미리 열어 달라고 부탁한다),
 * `nx:pins:toggle`(좁은 창의 찍기 — 미리보기 탭을 앞에 세운 뒤 단계 3 이 찍기를 켠다).
 * 들어오는 신호 둘(입력창이 듣는다): `nx:pins:send`(말풍선의 지금 보내기) ·
 * `nx:composer:attach`(미리보기의 AI에게 이 화면 보여 주기). 그리고 서랍이 되돌리기를 마치면 보내는
 * `nx:history:changed` 를 이 칸이 듣고 되돌아갈 곳을 다시 읽는다.
 */
export function ChatColumn({
  daemon,
  settings,
  sessions,
  pins,
  project,
  nav,
  narrow,
}: ChatColumnProps) {
  const { api, pending, resolvePending } = daemon;
  const { active, activeId } = sessions;
  const blocks = active?.blocks ?? [];
  const chat = settings.chat;
  const preparing = project !== null && isPreparing(project);

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
  // 마지막 결과 카드에만 선다 — 그 요청의 보관이 프로젝트 기록의 맨 위일 때만, 그래서 되돌리면 정확히 그 요청만
  // 사라질 때만(`lib/undo-last.ts`). 기록은 도는 답이 끝났을 때 · 새 보관이 쌓일 때 · 되돌린 뒤(`nx:history:changed`)에
  // 다시 읽는다. 단추는 서랍을 열어 그 되돌아갈 곳의 확인을 미리 열어 줄 뿐 — 되돌리는 일은 서랍의 확인이 한다.
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
  ) => {
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
      await sessions.submit(
        live
          ? rewordPinTurn(live.turn, text)
          : sent.length > 0
            ? pinsToTurn(sent, text, () => null)
            : text,
        [...pinImages, ...replayShots, ...attachments],
        { name },
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
  useEffect(() => {
    setEditHint(editTarget.current);
    editTarget.current = false;
  }, [activeId]);
  const [prefill, setPrefill] = useState<{
    text: string;
    nonce: number;
    append?: boolean;
    screen?: string;
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
  }, [blocks, pending.length]);
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

  // --- 진행 시계: 테이프가 조용한 동안만 ----------------------------------
  const tailLive = tailMoving(blocks, chat.showThinking, chat.showTools, isToolRunning);
  const awaiting = sessions.awaitingTurn?.sessionId === activeId ? sessions.awaitingTurn : null;
  const clockStart = active?.turnStartedAt ?? awaiting?.since ?? null;
  // 도는 동안 줄은 늘 그 자리에 서 있고 보이기만 바뀐다 — 붙였다 떨어졌다 하며
  // 대화를 밀어내지 않게.
  const clockMounted = sessions.running || awaiting !== null;
  const showClock = clockMounted && !tailLive;
  const empty = blocks.length === 0 && sessions.queue.length === 0 && !clockMounted;

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

  // --- 끌어다 놓기: 칸 어디에 놓아도 입력창의 첨부로 ---------------------------
  const composer = useRef<ComposerHandle | null>(null);
  const registerHandle = useCallback((handle: ComposerHandle | null) => {
    composer.current = handle;
  }, []);
  const [dragDepth, setDragDepth] = useState(0);

  const visiblePending = pending.filter((request) => request.sessionId === activeId);
  const lockReason = connectionLock(daemon.connection, L);
  const cycleMerged = daemon.repo?.handoff?.state === "merged";
  const placeholder = preparing
    ? L.composer.placeholderPreparing
    : pins.list.length > 0
      ? L.composer.placeholderPins
      : cycleMerged
        ? L.composer.placeholderMerged
        : L.composer.placeholder;
  const contextFull = sessions.usage !== null && Math.round(sessions.usage.percentage) >= 85;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 칸 전체가 파일을 놓는 자리다 — 드롭은 포인터의 일이고, 키보드는 입력창의 첨부 단추로 닿는다.
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: 위와 같다.
    <section
      className={`nx-chat${dragDepth > 0 ? " nx-chat--drop" : ""}`}
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
      {/* 화면 낭독 — 대화록을 log 로 읽어 흘러들어온 말과 카드가 차례로 들린다. */}
      <div className="nx-transcript" role="log" aria-live="polite" ref={scroll} onScroll={remember}>
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
            <h2>{L.transcript.emptyTitle}</h2>
            {project && <p className="nx-shared-hint">{L.transcript.sharedWork}</p>}
            {project && (
              <p>
                {preparing
                  ? L.transcript.emptyPreparing(project.name)
                  : narrow
                    ? L.transcript.emptyBodyNarrow(project.name)
                    : L.transcript.emptyBody(project.name)}
              </p>
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
            preparing={preparing}
            dropped={sessions.dropped}
            onFork={fork}
            onEditResend={editResend}
            onRetry={retry}
            onRetryDropped={retryDropped}
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
            loadComparison={api.comparison}
            onOpenHistory={() => window.dispatchEvent(new CustomEvent("nx:history:open"))}
            undoLast={
              lastRequestId !== null && undoTarget?.requestId === lastRequestId
                ? {
                    requestId: lastRequestId,
                    onUndo: () =>
                      window.dispatchEvent(
                        new CustomEvent("nx:history:open", {
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
        {clockMounted && (
          <div className={`nx-m-run${showClock ? "" : " nx-m-run--quiet"}`} role="status">
            <i className="nx-spin" aria-hidden="true" />
            <span>{L.chat.working}</span>
            {clockStart !== null && <Elapsed startedAt={clockStart} />}
          </div>
        )}
      </div>
      <div className="nx-cmp-wrap">
        {/* 맨 아래로 — 입력창 바로 위에 떠서 입력창이 커져도 겹치지 않는다. */}
        {unpinned && (
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
            <ChevIcon />
          </button>
        )}
        {editHint && (
          <div className="nx-cmp-hint" role="status">
            {L.transcript.editScreenHint}
          </div>
        )}
        {contextFull && (
          // 2026-10-04 ux-review: 85% 안내에 행동을 붙인다 — 이미 있는 새 대화 손.
          <div className="nx-cmp-hint" role="status">
            {L.chat.contextFull}{" "}
            <button type="button" className="nx-cmp-hint-act" onClick={() => void sessions.fresh()}>
              {L.sidebar.newConv}
            </button>
          </div>
        )}
        <Composer
          daemon={daemon}
          sessions={sessions}
          variant="thread"
          subject={sessions.activeId ? "session" : "next"}
          draftKey={activeId ?? `new:${daemon.activeSlug ?? "none"}`}
          placeholder={placeholder}
          pins={pins.list}
          pinNumberStart={pins.ghosts.length + 1}
          onPinNote={pins.setNote}
          onPinRemove={pins.remove}
          onPinFocus={(id) => void window.colonovaDesignDesktop?.preview?.pinFlash?.(id)}
          narrow={narrow}
          onPinMode={() => {
            nav.showTab("preview");
            window.dispatchEvent(new CustomEvent("nx:pins:toggle"));
          }}
          disabledProviders={chat.disabledProviders}
          lockReason={lockReason}
          running={sessions.running}
          onStop={stop}
          stopping={stopping}
          prefill={prefill}
          listenPinsSend
          registerHandle={registerHandle}
          onToast={nav.toast}
          onSend={send}
        />
      </div>
    </section>
  );
}
