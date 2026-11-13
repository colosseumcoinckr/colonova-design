import { useCallback, useEffect, useRef, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { timeAgo } from "../../lib/format";
import { createLatestRequest } from "../lib/latest-request";
import {
  type ConfluenceConnection,
  type ConfluenceFormState,
  canConnect,
  cancelChangeRoot,
  cancelReconnect,
  confluenceStatus,
  confluenceTone,
  connectInput,
  effectiveSite,
  emptyConfluenceForm,
  failConnect,
  settleConnect,
  settleRoots,
  startChangeRoot,
  startPick,
  startReconnect,
} from "./confluence-form";

/**
 * 기획서(Confluence) 연결의 판을 드는 손(기획서 동기화 1단계 · M2) — 걸음은
 * confluence-form.ts 의 순수 함수고, 여기는 데몬의 명령에 잇는다.
 */

export {
  type ConfluenceConnection,
  type ConfluenceFormState,
  confluenceStatus,
  emptyConfluenceForm,
  failConnect,
  settleConnect,
  settleRoots,
} from "./confluence-form";

export interface ConfluenceConnectModel {
  state: ConfluenceFormState;
  status: string;
  tone: "plain" | "warn" | "ok";
  /** 데몬이 아는 활성 프로젝트의 연결 — 아직 방송 전이면 없다. */
  summary: ConfluenceConnection | undefined;
  /** 연결에 쓰일 사이트 — 입력 칸이 비었으면 이미 연결된 사이트. */
  site: string;
  /** 연결 단추가 눌릴 수 있는가(사이트 · 이메일 · 토큰의 짝). */
  ready: boolean;
  setSite: (site: string) => void;
  setEmail: (email: string) => void;
  setToken: (token: string) => void;
  setRootQuery: (query: string) => void;
  connect: () => void;
  findRoots: () => void;
  /** 찾은 목록에서 하나를 뿌리로 정한다 — 저장된 자격으로 다시 검증해 미러를 쓴다. */
  pickRoot: (pageId: string) => void;
  startReconnect: () => void;
  cancelReconnect: () => void;
  startChangeRoot: () => void;
  cancelChangeRoot: () => void;
}

export function useConfluenceConnect(daemon: Daemon): ConfluenceConnectModel {
  const active = daemon.projects.find((project) => project.slug === daemon.activeSlug);
  const summary = active?.confluence;
  // 연결이 끊겨(만료) 입력 칸이 처음부터 열려 있는 경우도 사이트가 미리 들어 있게 — 마운트 때의 씨앗.
  const [state, setState] = useState<ConfluenceFormState>(() => ({
    ...emptyConfluenceForm,
    site: summary?.expired === true ? summary.site : "",
  }));
  const site = effectiveSite(state, summary);
  const requests = useRef(createLatestRequest<string>()).current;
  const scope = JSON.stringify([daemon.activeSlug, state.rootQuery]);
  const finding = useRef<object | null>(null);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 프로젝트 · 연결이 바뀌면 앞선 검색을 버리려고 일부러 단다(2026-11-12 U-119).
  useEffect(() => {
    finding.current = null;
    setState((current) => ({ ...current, finding: false, roots: null }));
    return () => {
      requests.invalidate();
      finding.current = null;
    };
  }, [requests, daemon.api, daemon.activeSlug]);

  const connect = useCallback(() => {
    setState({ ...state, phase: "connecting", failure: null, roots: null });
    daemon.api
      .confluenceConnect(connectInput(state, summary))
      .then((reply) => setState((next) => settleConnect(next, reply)))
      .catch((error: unknown) =>
        setState((next) => failConnect(next, error instanceof Error ? error.message : null)),
      );
  }, [daemon, state, summary]);

  const findRoots = useCallback(() => {
    if (finding.current || state.finding || !state.rootQuery) return;
    const ticket = requests.begin(scope);
    finding.current = ticket;
    setState((current) => ({ ...current, finding: true, failure: null }));
    daemon.api
      .confluenceSuggestRoots(state.rootQuery)
      .then((reply) => {
        if (requests.isCurrent(ticket, currentScope.current))
          setState((next) => settleRoots(next, reply.roots));
      })
      .catch((error: unknown) => {
        if (requests.isCurrent(ticket, currentScope.current))
          setState((next) => failConnect(next, error instanceof Error ? error.message : null));
      })
      .finally(() => {
        if (finding.current === ticket) finding.current = null;
      });
  }, [daemon, state.finding, state.rootQuery, requests, scope]);

  const pickRoot = useCallback(
    (pageId: string) => {
      if (site === "") return;
      requests.invalidate();
      finding.current = null;
      setState((current) => startPick(current, pageId));
      daemon.api
        .confluenceConnect({ site, rootPageId: pageId })
        .then((reply) => setState((next) => settleConnect(next, reply)))
        .catch((error: unknown) =>
          setState((next) => failConnect(next, error instanceof Error ? error.message : null)),
        );
    },
    [daemon, site, requests],
  );

  const set = (key: "site" | "email" | "token" | "rootQuery") => (value: string) => {
    if (key === "rootQuery") {
      requests.invalidate();
      finding.current = null;
      setState((current) => ({ ...current, rootQuery: value, finding: false, roots: null }));
      return;
    }
    setState((current) => ({ ...current, [key]: value }));
  };

  return {
    state,
    summary,
    site,
    status: confluenceStatus(summary, state.linked, timeAgo),
    tone: confluenceTone(summary, state.linked),
    ready: canConnect(state, summary),
    setSite: set("site"),
    setEmail: set("email"),
    setToken: set("token"),
    setRootQuery: set("rootQuery"),
    connect,
    findRoots,
    pickRoot,
    startReconnect: () => setState((current) => startReconnect(current, summary)),
    cancelReconnect: () => setState(cancelReconnect),
    startChangeRoot: () => setState(startChangeRoot),
    cancelChangeRoot: () => {
      requests.invalidate();
      finding.current = null;
      setState(cancelChangeRoot);
    },
  };
}
