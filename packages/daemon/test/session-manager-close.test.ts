import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DriverRegistry } from "../dist/agent/registry.js";
import { SessionManager } from "../dist/session-manager.js";

/**
 * close 가 던져도 명단에서 지운다(2026-10-02). Session.close 는 driver 의
 * 오류를 이미 삼키므로, 여기서 노리는 길은 관찰자(onState)가 던지는 길이다 —
 * 세션은 죽었는데 live 맵에 남아 같은 id 를 계속 돌려주면 좀비다.
 */
function makeManager(onState: (state: string) => void): SessionManager {
  const registry = new DriverRegistry();
  registry.register({
    id: "codex",
    describe: () => ({ id: "codex", label: "Codex", capabilities: {} }),
    createSession: () => ({
      vendorId: "vendor",
      alive: true,
      close: async () => {},
      setModel: async () => {},
      setEffort: async () => {},
    }),
  } as never);
  return new SessionManager(
    { onEvent: () => {}, onState: (_id, state) => onState(state) },
    registry,
  );
}

test("세션 닫기: close 도중 던져도 live 명단에서 지운다", async () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "colonova-close-")));
  mkdirSync(join(cwd, ".git"));
  try {
    const manager = makeManager((state) => {
      if (state === "closed") throw new Error("observer boom");
    });
    manager.create({
      cwd,
      provider: "codex",
      sessionId: "public",
      launch: { model: "luna", effort: "low" },
    } as never);
    assert.ok(manager.get("public"), "만든 세션이 보여야 한다");
    await assert.rejects(manager.close("public"), /observer boom/);
    assert.equal(manager.get("public"), undefined, "던진 뒤에도 좀비가 남으면 안 된다");
    // 이미 없는 세션의 닫기는 조용히 지나간다.
    await manager.close("public");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("세션 닫기: closeAll 은 하나의 실패로 전체를 거절하지 않는다", async () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "colonova-closeall-")));
  mkdirSync(join(cwd, ".git"));
  try {
    const manager = makeManager((state) => {
      if (state === "closed") throw new Error("observer boom");
    });
    for (const id of ["one", "two"]) {
      manager.create({
        cwd,
        provider: "codex",
        sessionId: id,
        launch: { model: "luna", effort: "low" },
      } as never);
    }
    await manager.closeAll();
    assert.equal(manager.liveCount, 0, "하나가 실패해도 나머지는 닫혀야 한다");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
