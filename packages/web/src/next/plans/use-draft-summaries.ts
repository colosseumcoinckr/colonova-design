import type { DraftSummary } from "@colonova-design/protocol";
import { useEffect, useRef, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";

/**
 * 지금 프로젝트의 초안 요약(2026-10-23 기획자 화면 손질 D4 · D5) — 홈의 기획서 묶음과 사이드바의 `기획서` 줄이 읽는다.
 * 셸(`Workspace`)이 한 번만 부른다.
 *
 * 데몬의 `draft.list` 는 이 컴퓨터의 초안 저장소만 읽는다 — Confluence 를 부르지 않는다. 기획서를 연결하지 않은
 * 프로젝트는 읽지 않고 null 이다(화면 제작만 쓰는 프로젝트의 홈 · 사이드바는 예전과 같다). 초안이 바뀌면(어느 창에서든 —
 * `draft.changed` 방송) 다시 읽고, 못 읽으면 지난 목록을 그대로 둔다. 프로젝트가 바뀌면 지난 프로젝트의 목록을 먼저 걷는다.
 */
export function useDraftSummaries(daemon: Daemon): DraftSummary[] | null {
  const slug = daemon.activeSlug;
  const connected =
    daemon.projects.find((project) => project.slug === slug)?.confluence !== undefined;
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const apiRef = useRef(daemon.api);
  apiRef.current = daemon.api;
  const eventsRef = useRef(daemon.onDraftEvent);
  eventsRef.current = daemon.onDraftEvent;

  useEffect(() => {
    setDrafts(null);
    if (!connected || slug === null) return undefined;
    let alive = true;
    // 늦게 온 답을 버리는 번호 — 방송이 잇달아 오면 마지막 읽기만 남는다.
    let seq = 0;
    const load = () => {
      seq += 1;
      const mine = seq;
      apiRef.current
        .draftList()
        .then((rows) => {
          if (alive && mine === seq) setDrafts(rows);
        })
        .catch(() => {
          // 곁가지다 — 지난 목록이 사라지는 것보다 낫다.
        });
    };
    load();
    const off = eventsRef.current((message) => {
      if (message.type === "draft.changed") load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [slug, connected]);

  return drafts;
}
