import type { DocBlock } from "@colonova-design/protocol";
import { useEffect, useRef, useState } from "react";
import type { Daemon } from "../../../lib/daemon-client";

/**
 * 초안 편집기의 보존 블록 그림(2026-10-30 사용자 요청) — 이 앱이 고치지 못하는 블록(정보 상자 · 병합 표 …)을
 * 읽기 전용으로 그릴 재료다. 초안의 개정이 바뀔 때 한 번 묻고, 보존 블록이 없으면 묻지 않는다. 못 읽으면 빈
 * 판이다(편집기는 예전처럼 자리만 보인다).
 */
export function useBlockPreviews(
  daemon: Daemon,
  docKey: string | null,
  revision: number | null,
  hasPreserved: boolean,
): Record<string, DocBlock[]> {
  const apiRef = useRef(daemon.api);
  apiRef.current = daemon.api;
  const [previews, setPreviews] = useState<Record<string, DocBlock[]>>({});
  // 개정이 오르면 블록이 바뀌었을 수 있다 — 다시 묻는다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 개정은 다시 물을 신호다
  useEffect(() => {
    if (docKey === null || !hasPreserved) {
      setPreviews({});
      return;
    }
    let live = true;
    apiRef.current
      .docBlockPreview(docKey)
      .then((reply) => {
        if (live) setPreviews(reply.previews);
      })
      .catch(() => {
        // 그림은 곁가지다 — 못 읽으면 자리 표시가 그대로 선다.
      });
    return () => {
      live = false;
    };
  }, [docKey, revision, hasPreserved]);
  return previews;
}
