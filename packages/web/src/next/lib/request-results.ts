import {
  type GateChecked,
  type PlanSync,
  type RepoStatus,
  readTurn,
} from "@colonova-design/protocol";
import type { Block } from "../../lib/daemon-client";
import { type ToPath, threadScreens, titleOfPath } from "../../lib/turn-screens.ts";

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
  /** 턴 끝의 자동 확인이 문제 없이 지나갔다 — 카드가 무엇을 확인했는지 한 줄로 말한다. 없으면 말하지 않는다. */
  checked: GateChecked | null;
  /** 같이 고치기(2026-10-30) — 이 요청이 기획서 초안도 고쳤는지. 없으면 곁줄이 서지 않는다. */
  planSync: PlanSync | null;
}

/** One recorded user request, including its automatic repair, has one result section. */
export function requestResults(
  blocks: readonly Block[],
  saved: RepoStatus["cycleScreens"],
  toPath?: ToPath,
): Map<string, RequestResult> {
  const groups: RequestResult[] = [];
  let group: RequestResult | undefined;
  const linkTitles = toPath === undefined ? null : threadScreens(blocks, toPath);
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
      const source =
        block.changedScreens ??
        saved?.filter((screen) => screen.requestId === block.requestId) ??
        [];
      group =
        block.requestId && prompt !== null
          ? {
              requestId: block.requestId,
              prompt: prompt.slice(0, 240),
              explanation: "",
              turnId: "",
              repaired: false,
              checked: block.checked ?? null,
              planSync: block.planSync ?? null,
              // 빈 화면 이름은 이 대화 답변 링크가 붙인 제목으로 다시 채운다(2026-11-11 실측 — 저장된
              // changedScreens · 화면 지도 행에는 제목이 빈 채로 남았고 답변 링크에는 제목이 있었다.
              // 데몬이 제목을 저장하지 않은 까닭은 미확정이다). 같은 경로의 링크 제목만 쓰고 저장된
              // 이름은 덮지 않는다.
              screens:
                linkTitles === null
                  ? source
                  : source.map((screen) =>
                      screen.title !== ""
                        ? screen
                        : { ...screen, title: titleOfPath(linkTitles, screen.route) ?? "" },
                    ),
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
