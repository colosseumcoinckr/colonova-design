import { type RepoStatus, readTurn } from "@colonova-design/protocol";
import type { Block } from "../../lib/daemon-client";

export interface RequestResult {
  requestId: string;
  prompt: string;
  explanation: string;
  turnId: string;
  screens: Array<{ route: string; title: string }>;
  /**
   * 화면 확인이 문제를 찾아 AI 가 스스로 고친 요청이다(게이트 턴이 끼었다). 카드가 선 자리는 고침 턴의 끝이라
   * 원래 요청 · 답과 사이에 고침 카드가 있다 — 그때만 카드가 요청과 설명을 다시 적는다. 끼지 않았으면 카드 바로
   * 위가 요청의 답이라 되풀이일 뿐이다(2026-10-06 UX 점검).
   */
  repaired: boolean;
}

/** One recorded user request, including its automatic repair, has one result section. */
export function requestResults(
  blocks: readonly Block[],
  saved: RepoStatus["cycleScreens"],
): Map<string, RequestResult> {
  const groups: RequestResult[] = [];
  let group: RequestResult | undefined;
  let gate = false;
  for (const block of blocks) {
    if (block.type === "user") {
      const marked = readTurn(block.text);
      gate = marked.marker?.kind === "gate";
      if (gate) {
        if (group) group.repaired = true;
        continue;
      }
      const marker = marked.marker;
      const prompt =
        marker?.kind === "comments"
          ? marker.note?.trim() ||
            marker.items
              .map((item) => item.comment.trim() || item.label.trim())
              .filter(Boolean)
              .join(" · ")
          : marker
            ? null
            : (marked.body.trim().split(/\r?\n/, 1)[0] ?? "");
      group =
        block.requestId && prompt !== null
          ? {
              requestId: block.requestId,
              prompt: prompt.slice(0, 240),
              explanation: "",
              turnId: "",
              repaired: false,
              screens:
                block.changedScreens ??
                saved?.filter((screen) => screen.requestId === block.requestId) ??
                [],
            }
          : undefined;
      if (group) groups.push(group);
    } else if (group && block.type === "text" && block.agentId === null && !gate) {
      group.explanation = block.text.trim();
    } else if (
      group &&
      block.type === "turn" &&
      !block.isError &&
      block.subtype !== "interrupted"
    ) {
      group.turnId = block.id;
    }
  }
  return new Map(
    groups
      .filter((group) => group.turnId && group.screens.length > 0)
      .map((group) => [group.turnId, group]),
  );
}

/**
 * 대화의 마지막 결과 — 마지막 턴이 낸 결과(고친 화면이 있는 요청)이고, 그 턴이 끝난 답일 때만. 그 뒤에 다른 요청이
 * 왔거나(화면을 안 건드린 설명이라도) 마지막 턴이 실패 · 중단이면 `방금 한 것` 이 아니므로 null 이다.
 */
export function latestResult(
  blocks: readonly Block[],
  saved: RepoStatus["cycleScreens"],
): RequestResult | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.type === "user") return null;
    if (block?.type === "turn") return requestResults(blocks, saved).get(block.id) ?? null;
  }
  return null;
}
