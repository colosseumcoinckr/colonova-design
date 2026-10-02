import assert from "node:assert/strict";
import { test } from "node:test";
import type { Block } from "../src/lib/daemon-client.ts";
import { withPendingRequest } from "../src/lib/transcript-history.ts";

const prompt = (requestId: string): Block => ({
  type: "user",
  id: requestId,
  requestId,
  text: "같은 말",
  images: 0,
});
const answer: Block = { type: "text", id: "reply", text: "답변", agentId: null, streaming: true };

test("history read before the agent stores a fresh request preserves its prompt and live answer", () => {
  assert.deepEqual(withPendingRequest([], [prompt("new"), answer]), [prompt("new"), answer]);
  assert.deepEqual(withPendingRequest([prompt("old")], [prompt("old"), prompt("new"), answer]), [
    prompt("old"),
    prompt("new"),
    answer,
  ]);
});

test("reconnect history containing a newer request stays authoritative without duplicating known requests", () => {
  const replay = [prompt("old"), prompt("new"), answer];
  assert.deepEqual(withPendingRequest(replay, [prompt("old")]), replay);
  assert.deepEqual(withPendingRequest(replay, replay), replay);
});
