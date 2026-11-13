import type { EffortLevel } from "@colonova-design/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChipTarget } from "../../../hooks/useSessions";
import type { Daemon } from "../../../lib/daemon-client";
import { type DraftPick, readDraftPick, seedDraftPick, writeDraftPick } from "./draft-pick";

/**
 * 기획 대화의 모델 칩이 읽고 쓰는 주인(2026-10-26 사용자 요청) — 화면 대화의 ModelChip 을 같은
 * 모양으로 쓰되, 주인은 데몬의 산 세션이 아니라 이 고름이다. AI 는 Claude 하나로 태어나므로
 * 공급자 줄은 서지 않고(`pickProvider` 없음 — 칩이 알아서 감춘다) 모델 · 생각 시간만 고른다.
 * 고른 값은 매 묻기에 실려 데몬으로 간다. `daemon` 은 렌더마다 새 겉모습이라 ref 로 쥔다.
 */
export function useDraftPick(daemon: Daemon): { target: ChipTarget; pick: DraftPick } {
  const [pick, setPick] = useState<DraftPick>(() => readDraftPick(localStorage));

  const daemonRef = useRef(daemon);
  daemonRef.current = daemon;

  const models = daemon.status?.modelsByProvider?.claude ?? [];

  // 씨앗은 목록이 처음 닿았을 때 한 번 — 채울 것이 있을 때만 시도했다고 적는다(빈 목록으로는
  // 시도가 아니다). 고른 값이 이미 있으면 씨앗이 null 이라 자연히 다시 돌지 않는다.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    const next = seedDraftPick(pick, models);
    if (next === null) return;
    seeded.current = true;
    writeDraftPick(localStorage, next);
    setPick(next);
  }, [pick, models]);

  const change = useCallback((patch: Partial<DraftPick>) => {
    setPick((before) => {
      const next = { ...before, ...patch };
      writeDraftPick(localStorage, next);
      return next;
    });
  }, []);

  const setModel = useCallback(
    (model: string | null) => {
      change({ model });
      return Promise.resolve();
    },
    [change],
  );
  const setEffort = useCallback(
    (effort: EffortLevel | null) => {
      change({ effort });
      return Promise.resolve();
    },
    [change],
  );

  const target: ChipTarget = {
    // 열린 대화의 몸 — 칩이 「중간에 바꾸면 다음 답부터」 말을 곁들인다. 기획 대화도 이어지는
    // 세션이라 다음 묻기부터 적용되는 것이 같다.
    subject: "session",
    key: "draft:claude",
    provider: "claude",
    model: pick.model,
    effort: pick.effort,
    fastMode: false,
    fastModeBlocked: null,
    models,
    setModel,
    setEffort,
    // 기획 AI 는 빠르게 토글이 없다 — 칩의 읽기 전용 자리라 도달하지 않는다.
    setFast: async () => null,
    pickProvider: null,
  };
  return { target, pick };
}

/** ModelChip 이 여는 순간 부르는 사용량 다시 읽기 — 화면 대화의 refreshUsage 와 같은 길(요금제 다시 읽기). */
export function draftRefreshUsage(daemon: Daemon): () => void {
  return () => {
    void daemon.api.planRefresh("claude").catch(() => undefined);
  };
}
