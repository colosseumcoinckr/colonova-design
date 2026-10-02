import type { Block } from "./daemon-client";

/** A just-delivered prompt may not have reached the agent's disk transcript yet. */
export function withPendingRequest(history: Block[], live: Block[]): Block[] {
  const known = new Set(
    live.flatMap((block) => (block.type === "user" && block.requestId ? [block.requestId] : [])),
  );
  const recorded = new Set(
    history.flatMap((block) => (block.type === "user" && block.requestId ? [block.requestId] : [])),
  );
  // A replay with a newer request is authoritative (for example, after reconnecting).
  if ([...recorded].some((id) => !known.has(id))) return history;
  const pending = live.findIndex(
    (block) => block.type === "user" && block.requestId && !recorded.has(block.requestId),
  );
  return pending < 0 ? history : [...history, ...live.slice(pending)];
}
