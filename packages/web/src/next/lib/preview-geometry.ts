/**
 * 미리보기 칸의 순수 계산 — 말풍선의 자리(U4)와 준비 화면의 걸음(U8). 형제
 * 모듈을 부르지 않는다(시험이 src 에서 곧장 읽는다).
 */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 말풍선이 한쪽에 서려면 최소한 이만큼은(px) 있어야 한다 — 머리 · 한 줄 입력 · 바닥 단추가 들어갈 높이. */
export const BUBBLE_MIN_ROOM = 120;

export interface BubblePlace {
  left: number;
  /** 위끝의 자리. 위로 열렸으면(`up`) 요소 위의 말풍선 위끝이다. */
  top: number;
  up: boolean;
  arrowLeft: number;
  /**
   * 말풍선이 붙들리는 가장자리 — 아래로 열면 위끝(`top`), 위로 열면 아랫끝(`bottom`: 칸 바닥에서 잰 거리)이다.
   * 높이가 늘어도(요소 정보를 펼침 · 메모가 여러 줄이 됨) 요소와의 간격이 그대로라 화살표가 요소에서 떨어지지
   * 않는다(2026-10-06 겹판 조사).
   */
  anchor: { edge: "top" | "bottom"; at: number };
  /** 이 자리에서 말풍선이 가질 수 있는 가장 큰 높이 — 넘치면 안쪽이 굴러간다. */
  maxHeight: number;
}

/**
 * 핀 말풍선의 자리 — 오버레이가 보고한 요소의 `rect`(게스트 뷰포트의 CSS px)를
 * 게스트 요소의 화면 위치(`frame`, 칸 기준)와 배율로 옮긴다. 요소 바로 아래에
 * 서고, 칸의 바닥을 넘으면 요소 위로 올라간다(`up`). 가로는 칸 안으로 묶는다.
 * `arrowLeft` 는 말풍선 안 화살표의 자리 — 요소의 가운데를 가리키되 말풍선
 * 안으로 묶는다(CSS 변수 `--pv-arrow` 로 흘러간다).
 *
 * 높이가 변할 때마다 다시 부른다. `prefer` 는 지금 서 있는 쪽 — 그쪽에 아직 들어가면 옮기지 않는다(위로
 * 열린 말풍선이 한 글자 때문에 아래로 뛰지 않게). 어느 쪽에도 통째로 안 들어가면 더 넓은 쪽에 서고
 * (`maxHeight` 가 그 자리의 높이다 — 넘치는 안쪽이 굴러간다), 양쪽 다 `BUBBLE_MIN_ROOM` 보다 좁으면(칸보다 큰
 * 요소) 칸 안에 붙들어 둔다.
 */
export function bubblePlacement(input: {
  rect: Rect;
  /** 게스트 요소의 왼쪽 위 — 말풍선이 사는 칸의 좌표계. */
  frame: { left: number; top: number };
  zoom: number;
  /** 말풍선이 사는 칸의 크기. */
  box: { width: number; height: number };
  /** 말풍선의 자연스러운 크기(높이 제한을 풀었을 때). */
  bubble: { width: number; height: number };
  gap?: number;
  prefer?: "up" | "down";
}): BubblePlace {
  const { rect, frame, box, bubble } = input;
  const zoom = input.zoom > 0 ? input.zoom : 1;
  const gap = input.gap ?? 10;
  const margin = 8;
  const elLeft = frame.left + rect.x * zoom;
  const elTop = frame.top + rect.y * zoom;
  const elBottom = elTop + rect.height * zoom;
  const roomBelow = box.height - margin - (elBottom + gap);
  const roomAbove = elTop - gap - margin;
  const fitsBelow = bubble.height <= roomBelow;
  const fitsAbove = bubble.height <= roomAbove;
  const roomier = (): "up" | "down" | "trapped" => {
    if (Math.max(roomAbove, roomBelow) < BUBBLE_MIN_ROOM) return "trapped";
    return roomAbove > roomBelow ? "up" : "down";
  };
  const first = input.prefer === "up" ? "up" : "down";
  const second = first === "up" ? "down" : "up";
  const fits = (side: "up" | "down") => (side === "up" ? fitsAbove : fitsBelow);
  const side = fits(first) ? first : fits(second) ? second : roomier();

  let top: number;
  let anchor: BubblePlace["anchor"];
  let maxHeight: number;
  if (side === "down") {
    top = elBottom + gap;
    anchor = { edge: "top", at: Math.round(top) };
    maxHeight = roomBelow;
  } else if (side === "up") {
    top = elTop - gap - Math.min(bubble.height, roomAbove);
    anchor = { edge: "bottom", at: Math.round(box.height - (elTop - gap)) };
    maxHeight = roomAbove;
  } else {
    // 위에도 아래에도 자리가 없다(칸보다 큰 요소) — 칸 안에 붙들어 둔다.
    top = Math.max(margin, box.height - margin - bubble.height);
    anchor = { edge: "top", at: Math.round(top) };
    maxHeight = box.height - margin * 2;
  }
  const maxLeft = Math.max(margin, box.width - bubble.width - margin);
  const left = Math.min(maxLeft, Math.max(margin, elLeft - 14));
  // 화살표는 요소의 가운데를 가리킨다 — 말풍선이 묶여 밀려도 화살표가
  // 요소를 좇게, 자리는 말풍선 폭 안으로 다시 묶는다.
  const elCenter = elLeft + (rect.width * zoom) / 2;
  const arrowLeft = Math.round(Math.min(bubble.width - 20, Math.max(10, elCenter - left)));
  return {
    left: Math.round(left),
    top: Math.round(top),
    up: side === "up",
    arrowLeft,
    anchor,
    maxHeight: Math.max(0, Math.floor(maxHeight)),
  };
}

/**
 * 말풍선이 볼 핀의 상자 — 요소 핀의 `rect` 는 찍은 순간의 화면 좌표지만,
 * 영역 핀의 `rect` 는 스크롤이 남아 있는 페이지 좌표(재설계 C9)라 찍은
 * 순간의 화면 좌표(`rectView`)를 함께 싣는다. 없는 봉투(옛 클라이언트)는
 * `rect` 로 돌아간다.
 */
export function bubbleRect(element: { rect: Rect; rectView?: Rect }): Rect {
  return element.rectView ?? element.rect;
}

/**
 * 작업 기록 서랍이 옆 서랍이 아니라 시트(뒤를 어둡게 하고 바깥을 누르면 닫히는)가 되는 칸의 폭 —
 * 서랍(348px)이 칸을 거의 다 덮으면 남는 띠가 쓸모없고 닫는 손이 ✕ 뿐이다(2026-10-06 겹판 조사).
 * 값은 컨테이너(`.nx-preview`)의 가로 px 이다.
 */
export const HISTORY_SHEET_MAX = 480;

export function historyAsSheet(columnWidth: number): boolean {
  return Number.isFinite(columnWidth) && columnWidth > 0 && columnWidth <= HISTORY_SHEET_MAX;
}

/** 줌의 한계 — main 이 배율을 조이는 값(preview-view.ts 의 setZoom)과 같다. */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;

/** 줌 막대의 진실 — 100% 칸은 배율이 1 일 때만 켜지고, 한계에서는 바깥
 *  단추(− · +)가 더 갈 데가 없어 꺼진다. */
export function zoomButtons(zoom: number): { out: boolean; in: boolean; reset: boolean } {
  const value = Number.isFinite(zoom) ? zoom : 1;
  return {
    out: value <= ZOOM_MIN + 1e-9,
    in: value >= ZOOM_MAX - 1e-9,
    reset: Math.abs(value - 1) < 1e-9,
  };
}

/** 준비의 세 걸음 — `내려받기 · 설치하기 · 미리보기 켜기`. 준비가 아니면 null. */
export function prepStep(phase: string): 0 | 1 | 2 | null {
  switch (phase) {
    case "missing":
    case "cloning":
    case "pulling":
      return 0;
    case "installing":
      return 1;
    case "starting":
      return 2;
    default:
      return null;
  }
}

/** 걸음마다 흔히 걸리는 시간(ms) — 막대가 그 걸음 안에서 차오르는 빠르기. */
const TYPICAL_MS = [20_000, 120_000, 30_000] as const;

/**
 * 진행 막대의 퍼센트 — 선로에 숫자 진행이 없으므로 걸음과 그 걸음에서 흐른
 * 시간으로 짓는다. 한 걸음 안에서는 끝까지 차지 않는다(다음 걸음이 채운다).
 */
export function prepProgress(phase: string, elapsedMs: number): number {
  const step = prepStep(phase);
  if (step === null) return phase === "ready" ? 100 : 0;
  const typical = TYPICAL_MS[step];
  const inStep = 1 - Math.exp(-Math.max(0, elapsedMs) / typical);
  const pct = ((step + 0.9 * inStep) / 3) * 100;
  return Math.max(2, Math.min(99, Math.round(pct)));
}

/** 흐른 시간 → 분 · 초. */
export function elapsedParts(ms: number): { minutes: number; seconds: number } {
  const total = Math.max(0, Math.floor(ms / 1000));
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
}

/**
 * 답이 끝났을 때 미리보기의 한 번의 신호 — 「옮겨 감」과 「이미 거기서
 * 바뀜」을 한 곳에서 판정한다. 턴이 끝나지 않았거나(흐르는 중 · 다른
 * 대화), 사람이 일부러 밖으로 나가 있거나, 이번 턴이 화면을 말하지
 * 않았으면 신호가 없다(null). 신호가 있으면 첫 화면의 주소와 이미 그
 * 화면에 있는지를 돌려준다 — 칸은 이 값을 하나로 받아 이동과 옅은
 * 빛줄기를 함께 일으킨다.
 */
export function arriveOnTurnEnd(input: {
  /** 이번 턴이 끝났는가 — 같은 대화의 턴이 살아 있다가 끝난 순간만 true. */
  ended: boolean;
  /** 사람이 일부러 밖(예. 링크)을 보고 있는가 — 그때는 칸이 움직이지 않는다. */
  external: boolean;
  /** 이번 턴이 말한 화면들 — `path` 는 주소, `key` 는 화면의 같음 잣대. */
  screens: { path: string; key: string }[];
  /** 지금 보고 있는 화면의 같음 잣대. */
  hereKey: string;
}): { path: string; already: boolean } | null {
  if (!input.ended || input.external) return null;
  const first = input.screens[0];
  if (!first) return null;
  const already = input.screens.some((screen) => screen.key === input.hereKey);
  return { path: first.path, already };
}
