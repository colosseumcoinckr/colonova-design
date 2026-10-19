import assert from "node:assert/strict";
import { test } from "node:test";
import { DaemonServer } from "../dist/server.js";
import { TurnActivity } from "../dist/turn-activity.js";

function harness() {
  const server = Object.create(DaemonServer.prototype);
  Object.assign(server, {
    manager: {
      get: () => ({ state: "running" }),
      promptCount: () => {
        throw new Error("must not read transcript before send");
      },
    },
    workspaceOfSession: () => ({
      slug: "project",
      repo: new Proxy(
        {},
        {
          get: () => {
            throw new Error("must not read files before send");
          },
        },
      ),
    }),
    turnActivity: new Map([["s", new TurnActivity()]]),
    turnEnds: new Map(),
    turnPrompts: new Map(),
    gateRequests: new Map(),
    changedTurnFiles: new Map(),
    autoSaveLands: new Map(),
    drivers: { gatedSessions: new Set() },
  });
  return server;
}

test("일반 전달은 파일·대화록을 읽지 않고 요청 정보만 준비한다", async () => {
  const server = harness();
  await server.prepareTurn("s", { id: "request", text: "hello" });
  assert.deepEqual(server.turnPrompts.get("s"), { id: "request", text: "hello" });
});

test("진행 중인 보관만 기다리고, 대기 중 닫힌 요청의 기록은 되살리지 않는다", async () => {
  const server = harness();
  const save = Promise.withResolvers<void>();
  server.autoSaveLands.set("project", save.promise);
  const preparing = server.prepareTurn("s", { id: "request", text: "hello" });
  assert.equal(server.turnPrompts.size, 0);
  save.resolve();
  await preparing;
  assert.equal(server.turnPrompts.get("s").id, "request");

  const next = Promise.withResolvers<void>();
  server.autoSaveLands.set("project", next.promise);
  const cancelled = server.prepareTurn("s", { id: "cancelled", text: "cancelled" });
  server.turnActivity.delete("s");
  server.turnPrompts.clear();
  next.resolve();
  await cancelled;
  assert.equal(server.turnPrompts.size, 0);
});
