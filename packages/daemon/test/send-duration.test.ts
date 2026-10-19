import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { type ChatEvent, parseClientMessage } from "@colonova-design/protocol";
import { Session } from "../dist/session.js";

test("완료 시간은 공급자의 5초 대신 보내기부터 준비와 응답을 포함한다", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 100_000 });
  const events: ChatEvent[] = [];
  const session = new Session(
    { cwd: tmpdir(), provider: "codex" },
    {
      onEvent: (_id, event) => events.push(event),
      onState: () => {},
      onPermissionRequest: () => {},
      onQuestionRequest: () => {},
    },
  );
  session.attach({ alive: true, send: async () => {}, close: async () => {} } as never);
  session.send("hello", undefined, undefined, "queue", undefined, 95_000);
  t.mock.timers.tick(5000);
  session.driverHooks.onEvent({
    kind: "turn.end",
    subtype: "success",
    isError: false,
    costUsd: null,
    numTurns: null,
    durationMs: 5000,
    resultText: null,
  });
  assert.equal(events.find((event) => event.kind === "turn.end")?.durationMs, 10000);
  await session.close();
});

test("보내기 시각은 선택 필드이며 잘못된 값은 선로에서 막는다", () => {
  const send = (sentAt: unknown) =>
    parseClientMessage(
      JSON.stringify({ id: "s", type: "session.send", sessionId: "s", text: "hello", sentAt }),
    );
  assert.equal(send(undefined).ok, true);
  assert.equal(send(123).ok, true);
  assert.equal(send(-1).ok, false);
  assert.equal(send("123").ok, false);
});
