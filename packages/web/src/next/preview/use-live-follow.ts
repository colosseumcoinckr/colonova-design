import { type MutableRefObject, useEffect, useRef, useState } from "react";
import { overlayOpen } from "../../hooks/use-modal-focus";
import type { EditingScreen } from "../../lib/daemon-client";
import {
  DRIVING_FOCUS_GRACE_MS,
  DRIVING_HOLD_MS,
  type FollowModes,
  type FollowView,
  judgeSignal,
  type LiveLine,
  MOVED_LINE_MS,
  pickLiveLine,
} from "../lib/follow-edit";

export interface LiveFollowInput {
  /** 열린 대화 — 없으면 이 훅은 아무것도 하지 않는다. */
  sessionId: string | null;
  /** 이 대화의 턴이 살아 있다. */
  turnLive: boolean;
  /** 이번 턴이 시작한 시각(데몬 시계 ms) — 모르면 null. */
  turnStartedAt: number | null;
  /** AI 가 이 대화의 미리보기를 직접 조작 중이다(`browser.driving`). 다른 대화의 조작은 넘기지 않는다. */
  driving: boolean;
  /** 이 대화의 마지막 `session.editing` 신호 — 신호마다 새 객체다. */
  editing: EditingScreen | null;
  /** 지금 미리보기가 보이는 화면의 경로 — 링크 너머이거나 서버가 없으면 null. */
  here: string | null;
  view: FollowView & {
    /** 아래 가운데에 다른 알약(핀 보내기)이 서 있다 — 라이브 한 줄이 비켜 선다. */
    crowded: boolean;
  };
  /** `modal`(열린 겹판)은 판정하는 순간 이 훅이 직접 본다. */
  modes: Omit<FollowModes, "modal">;
  /** 화면 경로 → 이름(제목) — 모르면 null. */
  titleOf: (route: string) => string | null;
  /** 미리보기를 그 화면으로 옮긴다 — 칸이 이미 가진 이동의 길(`go`)을 그대로 쓴다. */
  onFollow: (route: string) => void;
  /**
   * 사용자가 미리보기를 마지막으로 직접 만진 시각(ms) — 칸의 손(주소 이동 · 뒤로 · 새로 고침 · 핀 · 기기 · 답변의 화면 링크)이
   * 남기고, 이 훅이 게스트에 초점이 들어오는 것도 같은 자리에 남긴다. 한 번도 없으면 null.
   */
  touchedAt: MutableRefObject<number | null>;
}

/**
 * 라이브감(2026-10-08 베타 준비 분석 · 개쩐다) — 미리보기가 AI 의 일을 같이 따라간다. 세 가지를 맡는다.
 *
 * 1. `AI가 화면을 직접 눌러 보는 중` — `browser.driving` 이 켜진 동안(도구와 도구 사이의 틈은 잠깐 붙든다).
 * 2. `AI가 지금 ‘…’ 화면을 고치는 중` — 데몬이 알린 `session.editing` 의 화면, 턴이 끝나면 사라진다.
 * 3. 첫 편집에서 그 화면으로 옮기기 — **턴당 한 번, 그 턴의 첫 신호에서만**. 이번 턴이 시작된 뒤 사용자가 미리보기를
 *    직접 만지지 않았을 때만 옮기고(판정은 `shouldFollow`), 옮겼으면 한 줄로 말한다. 판정은 신호가 막 도착한
 *    순간에만 내린다 — 대화를 옮겨 만난 낡은 신호로 미리보기를 움직이지 않는다.
 *
 * 사용자가 만졌다는 기록은 칸이 `touchedAt` 에 남기고(주소 이동 · 뒤로 · 새로 고침 · 핀 · 기기 · 답변의 화면 링크), 이
 * 훅이 게스트(webview)에 초점이 들어오는 것도 같은 기록으로 센다 — AI 가 조작하는 동안과 직후의 초점 이동은 AI 의 것이다.
 */
export function useLiveFollow(input: LiveFollowInput): { line: LiveLine | null; ring: boolean } {
  const { sessionId, turnLive, turnStartedAt, driving, editing, here, view, modes } = input;
  const { titleOf, onFollow, touchedAt } = input;

  // --- 사용자가 미리보기를 직접 만진 시각 ---------------------------------
  // AI 가 조작하는 동안과 그 직후의 게스트 초점 이동은 AI 의 것이다 — 사람의 누름으로 세지 않는다.
  const aiUntil = useRef(0);
  useEffect(() => {
    aiUntil.current = driving ? Number.POSITIVE_INFINITY : Date.now() + DRIVING_FOCUS_GRACE_MS;
  }, [driving]);
  // 게스트 안의 누름은 문서의 mousedown 에 닿지 않는다 — 게스트가 초점을 가져가는 순간이 사람의 손길이다. 데스크톱의 `<webview>` 는
  // 초점이 들어올 때 `focusin` 이 오고(팝 · 말풍선 · 주소 목록이 바깥을 누른 신호로 읽는 것과 같다), 같은 문서의 iframe(개발용 브라우저
  // 경로)은 `focusin` 없이 창의 `blur` 만 온다 — 한 틱 뒤 초점이 무대의 게스트에 있고 창이 아직 초점을 쥐고 있으면(앱을 떠난 blur 가
  // 아니면) 사람이 누른 것이다.
  useEffect(() => {
    const guestOf = (element: Element | null): boolean =>
      element !== null &&
      (element.tagName === "WEBVIEW" || element.tagName === "IFRAME") &&
      element.closest(".nx-pvstage") !== null;
    const onFocusIn = (event: FocusEvent) => {
      if (!guestOf(event.target instanceof Element ? event.target : null)) return;
      if (Date.now() < aiUntil.current) return;
      touchedAt.current = Date.now();
    };
    const onBlur = () => {
      window.setTimeout(() => {
        if (!document.hasFocus() || !guestOf(document.activeElement)) return;
        if (Date.now() < aiUntil.current) return;
        touchedAt.current = Date.now();
      }, 0);
    };
    document.addEventListener("focusin", onFocusIn);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("blur", onBlur);
    };
  }, [touchedAt]);

  // --- 첫 편집에서 그 화면으로 ---------------------------------------------
  const decidedTurn = useRef<string | null>(null);
  const [moved, setMoved] = useState<{ name: string; at: number } | null>(null);
  // 대화를 옮기면 지난 대화의 줄은 낡았다 — 아래 판정보다 먼저 돌아야 그 순간의 새 줄이 지워지지 않는다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 대화가 바뀐 순간만 본다.
  useEffect(() => setMoved(null), [sessionId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 신호(새 객체)가 올 때만 판정한다 — 나머지는 그 순간의 값을 읽는다.
  useEffect(() => {
    if (sessionId === null || editing === null) return;
    const verdict = judgeSignal({
      decidedTurn: decidedTurn.current,
      sessionId,
      turnStartedAt,
      signal: editing,
      now: Date.now(),
      titleOf,
      lastUserPreviewActionAt: touchedAt.current,
      currentRoute: here,
      view,
      modes: { ...modes, modal: overlayOpen() },
    });
    decidedTurn.current = verdict.turn;
    if (verdict.follow === null) return;
    onFollow(verdict.follow.route);
    setMoved({ name: verdict.follow.name, at: Date.now() });
  }, [editing]);
  useEffect(() => {
    if (moved === null) return;
    const timer = window.setTimeout(() => setMoved(null), MOVED_LINE_MS);
    return () => window.clearTimeout(timer);
  }, [moved]);

  // --- 눌러 보는 중 -------------------------------------------------------
  // 도구와 도구 사이(AI 가 다음 걸음을 생각하는 몇 초)에도 한 줄이 머문다 — 켜졌다 꺼졌다 깜빡이지 않게.
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (driving) {
      setHeld(true);
      return;
    }
    const timer = window.setTimeout(() => setHeld(false), DRIVING_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [driving]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 대화를 옮기면 지난 대화의 조작 표시는 낡았다.
  useEffect(() => setHeld(false), [sessionId]);
  const drivingShown = turnLive && (driving || held);

  // --- 고치는 중 ----------------------------------------------------------
  const editingName =
    turnLive && editing !== null ? (editing.title ?? titleOf(editing.route)) : null;

  // 찍기 · 얼린 화면 · 덮개 · 다른 알약이 같은 자리를 쓰면 비켜 선다 — 사람이 하는 일이 먼저다. 작업 기록 서랍이 열리면
  // 무대의 오른쪽을 덮어 가운데의 한 줄이 반쯤 잘리므로 함께 접는다.
  const hidden =
    !view.visible || view.covered || view.crowded || modes.frozen || modes.pin || modes.history;
  return {
    line: hidden
      ? null
      : pickLiveLine({ moved: moved?.name ?? null, driving: drivingShown, editingName }),
    ring: !hidden && drivingShown,
  };
}
