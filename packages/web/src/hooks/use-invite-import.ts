import type { InviteRow, NormalizedInvite } from "@colonova-design/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Daemon } from "../lib/daemon-client";
import { isInviteFile, onInvite } from "../lib/invite-bus";
import {
  type ApplyResult,
  applyInvite,
  planInviteRowsNamed,
  readInviteFile,
} from "../lib/invite-import";
import { L } from "../next/labels";
import { inviteReadError } from "../next/lib/invite-rows";

/**
 * 초대 파일 가져오기의 컨트롤러 — Shell 이 앱에 하나만 둔다(use-invite-import).
 * 상태는 idle → reading → confirm → applying → done(또는 error) 한 줄이고,
 * 파일이 드는 곳(드롭 · 고르기 창 · 설정의 열기 버튼)은 전부 여기로 모인다.
 */
export type InviteImportState =
  | { phase: "idle" }
  | { phase: "reading" }
  | {
      phase: "confirm";
      invite: NormalizedInvite;
      rows: InviteRow[];
      /** confirm 을 만든 순간의 첫 실행 여부 — 프로젝트가 하나도 없었는가. */
      firstRun: boolean;
      /** 초대 파일의 디스크 위치(데스크톱만, PLAN-UI U11) — `파일 지우기` 가 쓴다. */
      path?: string;
    }
  | {
      phase: "applying";
      invite: NormalizedInvite;
      rows: InviteRow[];
      firstRun: boolean;
      /** 끝난 행 수 — 진행 문구 "N개 중 M개 연결됨" 의 M. */
      done: number;
      path?: string;
    }
  | {
      phase: "done";
      invite: NormalizedInvite;
      firstRun: boolean;
      result: ApplyResult;
      /** 가져온 초대 파일의 디스크 위치 — 있으면 `invite.discard(path)` 로 지울 수 있다. */
      path?: string;
    }
  | {
      phase: "error";
      /** 사람이 읽는 해요체 한 줄(`L.invite.err…`). */
      error: string;
      /** 파서가 남긴 날것 — 있으면 판이 「자세히」 안에 접어 둔다. */
      detail?: string;
      /** 읽기를 시작한 순간의 첫 실행 여부 — 체크리스트가 이미 같은 오류를 말할 때 판이 이중으로 세지 않게. */
      firstRun: boolean;
    };

export interface InviteImportController {
  state: InviteImportState;
  /** 고르기 창 — 즉석에서 파일 입력을 만들어 바로 연다(DOM 에 심지 않는다). */
  openPicker: () => void;
  /** 확인 카드의 "초대 받기" — 이름 칸 초안을 함께 건넨다. */
  apply: (authorDraft: string) => void;
  /**
   * 다시 시도 — 일부 행이 실패했으면 그 행만, 연결 코드가 거절됐으면(프로젝트는 하나도 안 건드렸다)
   * 같은 초대장으로 처음부터. firstRun 은 이미 아니다(활성 프로젝트가 있다). 이름 칸 초안을 함께
   * 건넬 수 있다 — 코드가 거절된 시도는 이름을 저장하기 전에 끝났다.
   */
  retry: (authorDraft?: string) => void;
  /** 카드를 닫고 idle 로. */
  close: () => void;
  /** 드롭 영역이 초대 파일이 아닌 파일까지 같은 오류로 말하게 하는 길. */
  takeFile: (file: File) => void;
}

export function useInviteImport(daemon: Daemon): InviteImportController {
  const [state, setState] = useState<InviteImportState>({ phase: "idle" });
  // 드롭 · 통로 리스너는 오래 산 클로저를 쓴다 — 가드는 최신 상태를 이 ref 로 본다.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const takeFile = useCallback(
    (file: File) => {
      // 적용이 도는 동안에는 새 파일을 무시한다 — reading 이 applying 위를
      // 덮고, 끝난 적용의 done 이 그 위를 다시 덮는 일이 없게.
      if (stateRef.current.phase === "applying") return;
      setState({ phase: "reading" });
      // 데스크톱이 아는 파일의 디스크 위치(PLAN-UI U11) — 브라우저 File 에는 없다.
      const path = window.colonovaDesignDesktop?.invite?.pathOf?.(file) ?? null;
      readInviteFile(file)
        .then((read) => {
          if (!read.ok) {
            setState({
              phase: "error",
              error: read.error,
              ...(read.detail ? { detail: read.detail } : {}),
              firstRun: daemon.projects.length === 0,
            });
            return;
          }
          // firstRun 은 이 순간에 기억한다 — 적용 도중 첫 프로젝트가 생겨도 판정은
          // 시작했을 때의 것이다.
          const firstRun = daemon.projects.length === 0;
          setState({
            phase: "confirm",
            invite: read.invite,
            rows: planInviteRowsNamed(read.invite, daemon.projects),
            firstRun,
            ...(path ? { path } : {}),
          });
        })
        .catch((cause: unknown) => {
          // 읽기 자체가 던졌다(정규화 · 행 계획의 예기치 못한 오류) — `reading` 에 머물면 판이 영영 안 닫힌다.
          setState({
            phase: "error",
            error: inviteReadError("file", L),
            detail: cause instanceof Error ? cause.message : String(cause),
            firstRun: daemon.projects.length === 0,
          });
        });
    },
    [daemon.projects],
  );

  const openPicker = useCallback(() => {
    // 적용 중에는 고르기 창도 무시한다 — 파일을 골라도 받을 수 없는 순간이다.
    if (stateRef.current.phase === "applying") return;
    const input = document.createElement("input");
    input.type = "file";
    // 초대 파일 한 확장자만 — 이름 문(isInviteFile)과 같은 잣대다(2026-10-04 ux-review).
    input.accept = ".colonova-invite";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) takeFile(file);
    };
    input.click();
  }, [takeFile]);

  const runApply = useCallback(
    (
      rows: InviteRow[],
      invite: NormalizedInvite,
      firstRun: boolean,
      authorDraft: string,
      path?: string,
    ) => {
      const where = path ? { path } : {};
      setState({ phase: "applying", invite, rows, firstRun, done: 0, ...where });
      void applyInvite(daemon, invite, rows, {
        firstRun,
        authorDraft,
        onRow: (done) => setState((prev) => (prev.phase === "applying" ? { ...prev, done } : prev)),
      }).then((result) => setState({ phase: "done", invite, firstRun, result, ...where }));
    },
    [daemon],
  );

  // 매 렌더의 최신 상태를 보는 평범한 함수들 — 컨트롤러가 매 렌더 다시 만들어져도
  const apply = (authorDraft: string) => {
    if (state.phase !== "confirm") return;
    runApply(state.rows, state.invite, state.firstRun, authorDraft, state.path);
  };

  const retry = (authorDraft = "") => {
    if (state.phase !== "done") return;
    if (state.result.tokenError !== undefined) {
      // 연결 코드가 거절됐다 — 프로젝트는 하나도 건드리지 않았으니 같은 초대장의 행을 지금의
      // 프로젝트 목록으로 다시 세워 처음부터 간다.
      const rows = planInviteRowsNamed(state.invite, daemon.projects);
      runApply(rows, state.invite, state.firstRun, authorDraft, state.path);
      return;
    }
    const failedProjects = state.result.results
      .filter((entry) => !entry.ok)
      .map((entry) => entry.row.project);
    if (failedProjects.length === 0) return;
    // 확인 때 세운 행을 그대로 다시 쓰지 않는다 — 생성이 레지스트리까지 등록하고
    // 활성화에서 던진 행이라면 같은 레포가 한 번 더 생긴다. 실패한 프로젝트로
    // 지금의 프로젝트 목록에서 행을 다시 세운다(firstRun 은 아니다).
    const rows = planInviteRowsNamed(
      { ...state.invite, projects: failedProjects },
      daemon.projects,
    );
    if (rows.length === 0) return;
    runApply(rows, state.invite, false, authorDraft, state.path);
  };

  const close = useCallback(() => setState({ phase: "idle" }), []);

  // 통로 구독 — 설정 · 토큰 만료 카드가 넘기는 파일과 고르기 요청.
  useEffect(
    () =>
      onInvite((message) => {
        if (message.kind === "file") takeFile(message.file);
        else openPicker();
      }),
    [takeFile, openPicker],
  );

  // 창 어디에 떨어뜨려도 초대 파일이면 가져오기가 먼저 잡는다(capture) — 컴포저의
  // 첨부 손보다 앞선다. 초대 파일이 없으면 아무것도 하지 않는다(입력창 첨부의 길).
  useEffect(() => {
    const onDrop = (event: DragEvent) => {
      const files = event.dataTransfer?.files;
      const file = files ? [...files].find(isInviteFile) : undefined;
      if (!file) return;
      event.preventDefault();
      event.stopPropagation();
      takeFile(file);
    };
    window.addEventListener("drop", onDrop, true);
    return () => window.removeEventListener("drop", onDrop, true);
  }, [takeFile]);

  return { state, openPicker, apply, retry, close, takeFile };
}
