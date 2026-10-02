import { type RepoStatus, readTurn } from "@colonova-design/protocol";
import type { Block } from "../../lib/daemon-client";

export interface RequestResult {
  requestId: string;
  prompt: string;
  explanation: string;
  turnId: string;
  screens: Array<{ route: string; title: string }>;
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
      if (gate) continue;
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
