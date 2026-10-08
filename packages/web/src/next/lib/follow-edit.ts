/**
 * 라이브감 — AI 가 고치는 화면을 같이 따라간다(2026-10-08 베타 준비 분석 · 개쩐다). 순수 판정만 산다: 첫 편집에서 미리보기를
 * 그 화면으로 옮길지, 미리보기 가장자리의 한 줄이 무엇을 말할지. 형제 모듈을 부르지 않는다(시험이 src 에서 곧장 읽는다).
 *
 * 원칙은 하나다 — 사용자를 방해하지 않는다. 확실하지 않으면(이번 턴에 미리보기를 만졌는지 · 어디를 보는지 · 어떤 판이
 * 열려 있는지) 옮기지 않는다. 옮긴 뒤에는 늘 한 줄로 말한다(`moved`).
 */

/** AI 가 브라우저 도구를 한 번 놓은 뒤에도 `직접 눌러 보는 중` 이 머무는 시간 — 도구와 도구 사이의 틈에서 깜빡이지 않게. */
export const DRIVING_HOLD_MS = 3_000;
/** AI 의 조작이 끝난 뒤에도 게스트의 초점 이동을 AI 의 것으로 보는 틈 — 사람의 누름으로 오해하지 않게. */
export const DRIVING_FOCUS_GRACE_MS = 2_000;
/** `옮겼어요` 한 줄이 서 있는 시간. */
export const MOVED_LINE_MS = 5_000;
/** 막 도착한 신호로 치는 시간 — 대화를 옮겨 낡은 신호를 다시 만나면 그것으로 미리보기를 옮기지 않는다. */
export const EDITING_FRESH_MS = 3_000;

/** 신호가 막 도착한 것인가 — 시계가 거꾸로 가도(음수) 낡은 것으로 치지 않는다. */
export function isFreshSignal(receivedAt: number, now: number): boolean {
  return now - receivedAt <= EDITING_FRESH_MS;
}

/** 미리보기 칸이 지금 어떤 모습인가. */
export interface FollowView {
  /** 칸이 눈에 보인다 — 홈이 떠 있거나 좁은 창이 대화 탭에 있으면 false. */
  visible: boolean;
  /** 준비 중 · 다시 켜는 중 · 실패 · 고치는 중 · 서버 없음의 덮개가 무대를 가린다. */
  covered: boolean;
  /** 링크 너머의 외부 페이지를 보는 중 — 사람이 일부러 나간 것이다. */
  external: boolean;
}

/** 사용자가 정한 것과 사람이 하고 있는 일. */
export interface FollowModes {
  /** 설정 `AI가 고치는 화면으로 따라가기`. */
  follow: boolean;
  /** 찍기가 켜져 있다 — 사람이 화면을 짚는 중이다. */
  pin: boolean;
  /** 비교 대화상자 같은 겹판이 열려 있다. */
  modal: boolean;
  /** 제출한 때의 화면을 보는 중. */
  frozen: boolean;
  /** 작업 기록 서랍이 열려 있다. */
  history: boolean;
}

/** 같은 화면의 잣대 — 쿼리 · 해시 · 끝 슬래시는 화면을 바꾸지 않는다. */
export function routePath(route: string): string {
  const noHash = route.split("#")[0] ?? "";
  const path = (noHash.split("?")[0] ?? "").replace(/\/+$/, "");
  return path === "" ? "/" : path.startsWith("/") ? path : `/${path}`;
}

/**
 * 첫 편집에서 미리보기를 그 화면으로 옮겨도 되는가. 하나라도 걸리면 옮기지 않는다.
 * ① 설정이 꺼져 있다 ② 이번 턴이 언제 시작했는지 모른다 ③ 칸이 안 보이거나 덮여 있거나 외부 페이지를 본다
 * ④ 찍기 · 겹판 · 얼린 화면 · 작업 기록이 열려 있다 ⑤ 지금 어느 화면인지 모른다 ⑥ 이번 턴이 시작된 뒤 사용자가
 * 미리보기를 직접 만졌다(주소 이동 · 누름 · 핀) ⑦ 이미 그 화면이다.
 */
export function shouldFollow(input: {
  /** 이번 턴이 시작한 시각(ms) — 모르면 null. */
  turnStartedAt: number | null;
  /** 사용자가 미리보기를 마지막으로 직접 만진 시각(ms) — 한 번도 없으면 null. 같은 시계다. */
  lastUserPreviewActionAt: number | null;
  /** 지금 미리보기가 보이는 화면의 경로 — 모르면 null. */
  currentRoute: string | null;
  /** 옮겨 갈 화면의 경로. */
  target: string;
  view: FollowView;
  modes: FollowModes;
}): boolean {
  const { view, modes } = input;
  if (!modes.follow) return false;
  if (input.turnStartedAt === null) return false;
  if (!view.visible || view.covered || view.external) return false;
  if (modes.pin || modes.modal || modes.frozen || modes.history) return false;
  if (input.currentRoute === null || !input.target.startsWith("/")) return false;
  const touched = input.lastUserPreviewActionAt;
  if (touched !== null && touched >= input.turnStartedAt) return false;
  return routePath(input.currentRoute) !== routePath(input.target);
}

/**
 * `session.editing` 신호 하나를 맞이한다 — 그 턴의 첫 신호인가, 막 도착했는가, 옮겨도 되는가, 어디로 갔다고 말할 수 있는가.
 * 턴의 열쇠(`turn`)는 호출한 쪽이 다음 부름에 `decidedTurn` 으로 돌려준다: **한 턴의 기회는 첫 신호 하나뿐이다** — 옮겼든
 * 거절했든 같은 턴의 두 번째 화면 신호는 옮기지 않는다(사용자가 이미 거절당한 판에서 뒤늦게 끌려가지 않는다).
 * 옮기는 쪽은 이름을 말할 수 있을 때만이다 — 이름 없이 옮기면 투명하지 않다.
 */
export function judgeSignal(input: {
  /** 앞서 판정을 내린 턴의 열쇠 — 아직 없으면 null. */
  decidedTurn: string | null;
  sessionId: string;
  turnStartedAt: number | null;
  /** 데몬의 `session.editing` — `at` 은 이 창이 받은 시각(ms). */
  signal: { route: string; title: string | null; at: number };
  now: number;
  /** 화면 경로 → 이름 — 신호가 제목을 싣지 않았을 때의 길이다. */
  titleOf: (route: string) => string | null;
  lastUserPreviewActionAt: number | null;
  currentRoute: string | null;
  view: FollowView;
  modes: FollowModes;
}): { turn: string; follow: { route: string; name: string } | null } {
  const turn = `${input.sessionId}|${input.turnStartedAt ?? ""}`;
  const none = { turn, follow: null };
  if (input.decidedTurn === turn) return none;
  if (!isFreshSignal(input.signal.at, input.now)) return none;
  const go = shouldFollow({
    turnStartedAt: input.turnStartedAt,
    lastUserPreviewActionAt: input.lastUserPreviewActionAt,
    currentRoute: input.currentRoute,
    target: input.signal.route,
    view: input.view,
    modes: input.modes,
  });
  if (!go) return none;
  const name = input.signal.title ?? input.titleOf(input.signal.route);
  return name === null ? none : { turn, follow: { route: input.signal.route, name } };
}

/** 미리보기 가장자리에 서는 한 줄 — 한 번에 하나만 말한다. */
export type LiveLine =
  | { kind: "moved"; name: string }
  | { kind: "driving" }
  | { kind: "editing"; name: string };

/**
 * 어느 말이 서는가 — 방금 옮겼으면 그 말이 먼저(몇 초), 다음은 AI 가 화면을 직접 누르는 중, 마지막이 고치는 중이다.
 * `editingName` 이 null(제목을 모름)이면 고치는 중 문장은 만들지 않는다.
 */
export function pickLiveLine(input: {
  moved: string | null;
  driving: boolean;
  editingName: string | null;
}): LiveLine | null {
  if (input.moved !== null) return { kind: "moved", name: input.moved };
  if (input.driving) return { kind: "driving" };
  if (input.editingName !== null) return { kind: "editing", name: input.editingName };
  return null;
}
