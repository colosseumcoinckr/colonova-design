/**
 * 셸의 이동 상태 — 홈과 대화, 좁은 창의 탭, 사이드바의 접힘과 서랍. 주소에
 * 싣지 않고 셸이 쥔다(PLAN-UI 단계 1). 어느 대화가 열렸는지는 `useSessions`
 * 의 `activeId` 가 주인이다 — 여기엔 두 번째 사본을 두지 않는다.
 */
export interface NavState {
  /** `home` 큰 입력창과 받은 편지함(U6) · `thread` 대화 + 미리보기. */
  view: "home" | "thread";
  /** 좁은 창(900px 아래)의 두 탭 중 앞에 선 것(U16). 넓은 창은 읽지 않는다. */
  tab: "chat" | "preview";
  /**
   * 작업 화면 오른쪽 칸의 얼굴(2026-10-18 기획서 동기화 1단계 · M4) — 미리보기 아니면
   * 기획서. 기획서는 뷰어일 뿐 고치는 곳이 아니므로 셸의 한 칸으로 산다.
   */
  pane: "preview" | "plans";
  /** 좁은 창의 사이드바 서랍이 열려 있는가(`≡` · 스크림). */
  drawer: boolean;
  /** 넓은 창의 사이드바가 접혀 있는가 — 설정에 남는 값이 씨앗이다. */
  collapsed: boolean;
  /**
   * 가져온 초대 파일의 디스크 위치(PLAN-UI U11) — 데스크톱이 알려 준 것이 있고
   * 아직 지우지 않았을 때만 값이 있다. 대화 칸의 `파일 지우기` 줄이 읽고,
   * 지우면 그 칸이 비운다.
   */
  discardableInvitePath: string | null;
}

/** 토스트에 달리는 한 단추 — 눌러 일을 하고 토스트는 닫힌다(2026-10-07 베타 준비 분석 · 첫 5분). */
export interface ToastAction {
  label: string;
  run: () => void;
}

export type NavAction =
  | { type: "home" }
  | { type: "thread" }
  /**
   * 작업 화면의 미리보기 쪽으로(2026-10-07 베타 준비 분석 · 첫 5분) — 준비 진행 · 서비스가 떴다는 소식이 닿는 자리다.
   * 넓은 창은 두 칸이 함께 서고, 좁은 창은 화면 탭이 앞에 선다.
   */
  | { type: "screen" }
  /** 오른쪽 칸을 기획서 보기로(사이드바의 기획서 항목) — 대화 보기 위에 미리보기와 한 칸을 나눠 선다. */
  | { type: "plans" }
  /** 오른쪽 칸의 얼굴을 바꾼다 — 기획서 칸의 돌아오는 길이 쓴다. */
  | { type: "pane"; pane: NavState["pane"] }
  | { type: "tab"; tab: NavState["tab"] }
  | { type: "drawer"; open: boolean }
  | { type: "collapse"; collapsed: boolean }
  /** 활성 프로젝트가 바뀌었다 — 옛 셸처럼 홈부터. 이어진 점프가 대화를 열면 그것이 이긴다. */
  | { type: "project-changed" }
  /** 가져온 초대 파일의 자리를 세우거나(위치) 거둔다(null) — 셸 위쪽이 부르고 대화 칸이 읽는다. */
  | { type: "invite-path"; path: string | null };

export function initialNav(
  collapsed: boolean,
  discardableInvitePath: string | null = null,
): NavState {
  return {
    view: "home",
    tab: "chat",
    pane: "preview",
    drawer: false,
    collapsed,
    discardableInvitePath,
  };
}

export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case "home":
      // 홈으로 가면 기획서 읽기는 끝난다 — 홈에서 새 요청을 시작해 작업 화면으로 넘어올 때 AI 가 고치는 화면
      // (미리보기)이 앞에 서야 한다. 열어 둔 문서의 기억은 기획서 칸이 쥐고 있어 다시 열면 그 자리다.
      return { ...state, view: "home", pane: "preview", drawer: false };
    case "thread":
      // 대화를 여는 손은 서랍을 닫는다 — 좁은 창에서 고른 행이 스크림 뒤에 숨지 않게.
      return { ...state, view: "thread", drawer: false };
    case "screen":
      return { ...state, view: "thread", tab: "preview", pane: "preview", drawer: false };
    case "plans":
      // 기획서는 대화 보기의 오른쪽 칸이다 — 홈에서 곧장 열리면 대화 틀도 함께 선다.
      return { ...state, view: "thread", tab: "preview", pane: "plans", drawer: false };
    case "pane":
      return state.pane === action.pane ? state : { ...state, pane: action.pane };
    case "tab":
      return state.tab === action.tab ? state : { ...state, tab: action.tab };
    case "drawer":
      return state.drawer === action.open ? state : { ...state, drawer: action.open };
    case "collapse":
      return state.collapsed === action.collapsed
        ? state
        : { ...state, collapsed: action.collapsed };
    case "invite-path":
      return state.discardableInvitePath === action.path
        ? state
        : { ...state, discardableInvitePath: action.path };
    case "project-changed":
      // 기획서 칸도 닫는다 — 마지막으로 본 문서의 기억은 각 프로젝트의 몫이다.
      return { ...state, view: "home", tab: "chat", pane: "preview", drawer: false };
  }
}
