import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels.ts";

/**
 * 기획서(Confluence) 연결 판의 순수 걸음(기획서 동기화 1단계 · M2) — 이메일 · 토큰은
 * 일회성 입력이다: 연결이 이기든 지든, 흔적은 판에서 곧 지운다. 시험은 리액트 없이
 * 이 걸음을 잰다.
 */

/** 데몬이 아는 연결의 한 끝(ProjectSummary.confluence 와 같은 모양). */
export type ConfluenceConnection = NonNullable<Daemon["projects"][number]["confluence"]>;

/** Atlassian 계정의 API 토큰 만드는 쪽 — 토큰이 없는 사람을 그 자리로 보낸다(고정 주소). */
export const TOKEN_PAGE_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

export type ConfluencePhase = "idle" | "connecting" | "connected" | "failed";

export interface ConfluenceFormState {
  phase: ConfluencePhase;
  site: string;
  email: string;
  token: string;
  rootQuery: string;
  roots: Array<{ id: string; title: string }> | null;
  /** 기준 페이지 찾기가 도는 중이다 — 찾기 단추가 이 말로 자신을 가린다. */
  finding: boolean;
  failure: string | null;
  /** 마지막으로 이긴 연결이 알린 것 — 사이트와 뿌리 제목뿐, 자격은 없다. */
  linked: { site: string; rootTitle: string | null } | null;
  /** 연결된 뒤 `다시 연결하기` 로 입력 칸을 다시 열었다(연결이 서면 접힌다). */
  reconnecting: boolean;
  /** 기준 페이지가 정해진 뒤 `바꾸기` 로 찾기 칸을 다시 열었다(고르거나 그만두면 접힌다). */
  changingRoot: boolean;
  /** 지금 기준으로 정하는 중인 페이지 — 고르는 줄의 단추가 이 말로 자신을 가린다. */
  picking: string | null;
}

export const emptyConfluenceForm: ConfluenceFormState = {
  phase: "idle",
  site: "",
  email: "",
  token: "",
  rootQuery: "",
  roots: null,
  finding: false,
  failure: null,
  linked: null,
  reconnecting: false,
  changingRoot: false,
  picking: null,
};

/** 연결의 끝 — 이기든 흔적(이메일·토큰)을 지운다. 사이트 · 뿌리만 남는다. */
export function settleConnect(
  state: ConfluenceFormState,
  reply: { site: string; rootTitle: string | null },
): ConfluenceFormState {
  return {
    ...state,
    phase: "connected",
    email: "",
    token: "",
    failure: null,
    linked: reply,
    roots: null,
    reconnecting: false,
    changingRoot: false,
    picking: null,
  };
}

/** 연결의 실패 — 실패해도 흔적은 지운다: 다시 넣는 말이 곧 새 자격이다. */
export function failConnect(
  state: ConfluenceFormState,
  detail: string | null,
): ConfluenceFormState {
  return {
    ...state,
    phase: "failed",
    email: "",
    token: "",
    failure: detail === null ? null : L.plans.failed(detail),
    // 고르는 중에 진 것은 찾은 목록이 그대로 있어야 다른 줄을 다시 고를 수 있다.
    roots: state.picking === null ? null : state.roots,
    finding: false,
    picking: null,
  };
}

/** 찾기의 끝 — 목록을 채운다. 실패 문장은 지운다. */
export function settleRoots(
  state: ConfluenceFormState,
  roots: Array<{ id: string; title: string }>,
): ConfluenceFormState {
  return { ...state, roots, finding: false, failure: null };
}

/** 기준 페이지 하나를 정하러 나선다 — 그 줄의 단추가 `정하는 중…` 이 되고 다른 줄은 잠긴다. */
export function startPick(state: ConfluenceFormState, pageId: string): ConfluenceFormState {
  return { ...state, picking: pageId, failure: null };
}

/**
 * 연결된 뒤 입력 칸을 다시 연다 — 토큰을 바꿔 다시 연결할 때. 사이트 칸에는 연결된 사이트가 미리 들어 있다
 * (이미 아는 주소를 또 치게 하지 않는다 — 고치고 싶으면 지우고 쓰면 된다).
 */
export function startReconnect(
  state: ConfluenceFormState,
  summary: ConfluenceConnection | undefined,
): ConfluenceFormState {
  return {
    ...state,
    reconnecting: true,
    failure: null,
    site: effectiveSite(state, summary),
  };
}

/** 다시 연결을 그만둔다 — 넣다 만 이메일 · 토큰은 지운다(일회성 입력이 판에 남지 않게). */
export function cancelReconnect(state: ConfluenceFormState): ConfluenceFormState {
  return { ...state, reconnecting: false, email: "", token: "", failure: null };
}

/** 기준 페이지를 바꾸러 찾기 칸을 다시 연다. */
export function startChangeRoot(state: ConfluenceFormState): ConfluenceFormState {
  return { ...state, changingRoot: true, failure: null };
}

/** 기준 페이지 바꾸기를 그만둔다 — 찾은 목록과 찾는 말도 함께 접는다. */
export function cancelChangeRoot(state: ConfluenceFormState): ConfluenceFormState {
  return {
    ...state,
    changingRoot: false,
    roots: null,
    rootQuery: "",
    finding: false,
    failure: null,
  };
}

/**
 * 연결에 쓸 사이트 — 입력 칸이 비어 있으면 이미 연결된 사이트다. 연결된 뒤 칸이 다시 비어 보이면 사용자는 이미 아는
 * 주소를 또 쳐야 하고(그동안 `다시 연결하기` 가 잠겨 있다), 칸이 안 보여도 단추는 이 사이트로 돈다.
 */
export function effectiveSite(
  state: ConfluenceFormState,
  summary: ConfluenceConnection | undefined,
): string {
  return state.site !== "" ? state.site : (summary?.site ?? state.linked?.site ?? "");
}

/**
 * 연결 단추가 눌릴 수 있는가 — 사이트가 있어야 하고, 이메일과 토큰은 짝이다(선로가 하나만 온 말을 거절한다).
 * 둘 다 비우는 것은 이미 저장된 자격이 있을 때만 된다(뿌리만 다시 확인). 연결이 끊겼으면(만료) 저장된 자격이 이미
 * 틀렸으므로 새 자격이 있어야 한다.
 */
export function canConnect(
  state: ConfluenceFormState,
  summary: ConfluenceConnection | undefined,
): boolean {
  if (effectiveSite(state, summary) === "") return false;
  if ((state.email !== "") !== (state.token !== "")) return false;
  if (state.email !== "") return true;
  return (summary?.connected === true && !summary.expired) || state.linked !== null;
}

/** 연결 명령의 입력 — 이메일 · 토큰은 둘 다 있을 때만 싣는다. */
export function connectInput(
  state: ConfluenceFormState,
  summary: ConfluenceConnection | undefined,
): { site: string; email?: string; token?: string } {
  const creds = state.email !== "" && state.token !== "";
  return {
    site: effectiveSite(state, summary),
    ...(creds ? { email: state.email, token: state.token } : {}),
  };
}

/** 상태 알약의 색 — 연결이 안 섰으면 담담히, 끊겼으면 노랑, 서 있으면 초록. */
export function confluenceTone(
  summary: ConfluenceConnection | undefined,
  linked: ConfluenceFormState["linked"],
): "plain" | "warn" | "ok" {
  if (summary?.expired) return "warn";
  return summary === undefined && linked === null ? "plain" : "ok";
}

/**
 * 상태 한 줄 — 활성 프로젝트의 데몬 판이 이기고, 아직 방송 전이면 이 화면의 끝이 잠깐
 * 대신한다. 만료가 이기고, 그다음이 가져온 기록 · 뿌리 · 사이트 순이다.
 */
export function confluenceStatus(
  summary: ConfluenceConnection | undefined,
  linked: ConfluenceFormState["linked"],
  /** 가져온 기록의 시각을 말로 — lib/format 의 timeAgo 같은 문장. */
  when: (ts: number) => string,
): string {
  if (summary?.expired) return L.plans.statusExpired;
  if (summary === undefined) {
    if (linked === null) return L.plans.statusNotConnected;
    return linked.rootTitle !== null
      ? L.plans.statusRooted(linked.rootTitle)
      : L.plans.statusConnected(linked.site);
  }
  if (summary.lastImportAt !== null) {
    return L.plans.statusImported(when(Date.parse(summary.lastImportAt)), summary.pages);
  }
  if (summary.rootTitle !== null) return L.plans.statusRooted(summary.rootTitle);
  return L.plans.statusConnected(summary.site);
}
