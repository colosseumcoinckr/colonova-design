import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatEvent } from "@colonova-design/protocol";
import { spliceTape } from "../dist/session-tape.js";

test("reopening a conversation preserves request/photo identity, including repeated identical prompts", () => {
  const user = (text: string): ChatEvent => ({ kind: "user.echo", text, images: 0 });
  const rows = [
    {
      sessionId: "one",
      afterTurn: 1,
      event: { ...user("same words"), requestId: "first" } as ChatEvent,
    },
    {
      sessionId: "one",
      afterTurn: 2,
      event: { ...user("same words"), requestId: "second" } as ChatEvent,
    },
    {
      sessionId: "one",
      afterTurn: 1,
      event: {
        ...user("same words"),
        requestId: "first",
        changedScreens: [{ route: "/", title: "홈" }],
      } as ChatEvent,
    },
  ];
  const replay = spliceTape([user("same words"), user("same words"), user("other words")], rows);
  assert.equal(replay.length, 3, "metadata must not duplicate user messages");
  assert.deepEqual(
    replay.filter((event) => event.kind === "user.echo").map((event) => event.requestId),
    ["first", "second", undefined],
  );
  assert.deepEqual((replay[0] as Extract<ChatEvent, { kind: "user.echo" }>).changedScreens, [
    { route: "/", title: "홈" },
  ]);
  assert.equal(
    (spliceTape([user("different words")], rows)[0] as Extract<ChatEvent, { kind: "user.echo" }>)
      .requestId,
    undefined,
  );
});
