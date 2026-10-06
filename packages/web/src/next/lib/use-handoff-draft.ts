import type { RepoHandoffDraft } from "@colonova-design/protocol";
import { useEffect, useRef, useState } from "react";

export type HandoffDraftState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "ready"; draft: RepoHandoffDraft }
  | { status: "failed" };

/**
 * 제출 확인이 열려 있는 동안 요청의 초안(제목 · 설명)을 읽는다(2026-10-07 UX 점검 3단계). 데몬의 초안은 짧은 AI 한
 * 번이라 몇 초 걸릴 수 있어 제출 버튼을 붙잡지 않는다 — 읽는 중이면 줄 하나만 서고, 못 읽으면 아무것도 서지 않는다.
 * `key`(보관의 끝 표식)가 바뀌면 작업이 달라진 것이라 다시 읽고, `on` 이 꺼지면 비운다. 지난 읽기의 답은 버린다.
 */
export function useHandoffDraft(
  load: () => Promise<RepoHandoffDraft>,
  on: boolean,
  key: string | null,
): HandoffDraftState {
  const [state, setState] = useState<HandoffDraftState>({ status: "off" });
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!on || key === null) {
      setState({ status: "off" });
      return;
    }
    let alive = true;
    setState({ status: "loading" });
    loadRef.current().then(
      (draft) => {
        if (alive) setState({ status: "ready", draft });
      },
      () => {
        if (alive) setState({ status: "failed" });
      },
    );
    return () => {
      alive = false;
    };
  }, [on, key]);
  return state;
}
