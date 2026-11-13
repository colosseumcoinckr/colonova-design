import type { DraftSummary } from "@colonova-design/protocol";

/**
 * 사이드바의 `기획서` 줄과 기획서 목록이 세는 「작성 중인 초안」(2026-10-23 기획자 화면 손질 D4 · D5 —
 * 2026-10-31 홈 걷기로 `home-drafts.ts` 에서 이름을 바꿨다). 순수 판정.
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
        // 제목만 바꾼 초안도 발행할 것이 있다 — 목록 줄의 점(draftMarkOf)과 같은 잣대(2026-11-12 기획자 체험).
        (draft.pageId === null ||
          draft.changedBlocks > 0 ||
          draft.titleChanged === true ||
          draft.state !== "editing"),
    )
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
}
