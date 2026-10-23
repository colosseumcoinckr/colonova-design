import type { DraftSummary } from "@colonova-design/protocol";
import { L } from "../labels.ts";

/**
 * 홈의 기획서 묶음과 사이드바의 `기획서` 줄이 세는 「작성 중인 초안」(2026-10-23 기획자 화면 손질 D4 · D5) — 순수 판정.
 *
 * 손이 더 갈 초안만 센다: 새 문서 초안, 바뀐 곳이 있는 초안, 그리고 처지가 손을 부르는 초안(충돌 · 보내는 중 · 결과 확인
 * 필요 · 결과를 두고 종료). 발행을 마친 초안(`published` — 기준이 새 판으로 옮겨 바뀐 곳이 0 이다)과 열기만 하고 고치지 않은
 * 초안은 뺀다. 새것(고친 때)이 위다.
 */
export function draftsInProgress(drafts: readonly DraftSummary[]): DraftSummary[] {
  return drafts
    .filter(
      (draft) =>
        draft.state !== "published" &&
        (draft.pageId === null || draft.changedBlocks > 0 || draft.state !== "editing"),
    )
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
}

/** 홈 줄의 한 줄 상태 — 손이 필요한 처지(결과 확인 필요 · 충돌)는 `warn` 이다. 색만이 아니라 글로도 말한다. */
export function draftRowStatus(draft: DraftSummary): { text: string; warn: boolean } {
  if (draft.state === "result-unknown") return { text: L.drafts.resultUnknownTitle, warn: true };
  if (draft.state === "conflict") return { text: L.home.draftConflict, warn: true };
  if (draft.state === "publishing") return { text: L.drafts.publishing, warn: false };
  const what =
    draft.pageId === null
      ? L.home.draftNewDoc
      : draft.changedBlocks > 0
        ? L.home.draftChanged(draft.changedBlocks)
        : null;
  return {
    text: what === null ? L.drafts.unpublished : `${what} · ${L.drafts.unpublished}`,
    warn: false,
  };
}
