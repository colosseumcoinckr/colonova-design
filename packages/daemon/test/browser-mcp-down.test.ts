// 브라우저 MCP 자식이 뜨지 못한 세션(2026-10-14 MCP 점검) — 드라이버가 알리면 세션이 대화에
// 경고 한 줄을 한 번만 내려놓고 받는 쪽에 한 번만 알린다. init 은 턴마다 오므로 되풀이된다.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DriverRegistry } from "../dist/agent/registry.js";
import { SessionManager } from "../dist/session-manager.js";

test("브라우저 도구가 빠지면 경고 한 줄이 세션마다 한 번 선다", async () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "colonova-mcp-down-")));
  mkdirSync(join(cwd, ".git"));
  const registry = new DriverRegistry();
  registry.register({
    id: "claude",
    describe: () => ({ id: "claude", label: "Claude", capabilities: {} }),
    createSession: (_launch: unknown, hooks: { onBrowserToolsDown?: () => void }) => {
      queueMicrotask(() => {
        hooks.onBrowserToolsDown?.();
        hooks.onBrowserToolsDown?.();
      });
      return {
        vendorId: "vendor",
        alive: true,
        close: async () => {},
        setModel: async () => {},
        setEffort: async () => {},
      };
    },
    store: { list: async () => [], has: async () => false, import: async () => [] },
  } as never);
  const notices: Array<{ level: string; text: string }> = [];
  const down: string[] = [];
  const manager = new SessionManager(
    {
      onEvent: (_id: string, event: { kind: string; level?: string; text?: string }) => {
        if (event.kind === "notice")
          notices.push({ level: event.level ?? "", text: event.text ?? "" });
      },
      onState: () => {},
      onBrowserToolsDown: (id: string) => down.push(id),
    } as never,
    registry,
  );
  try {
    manager.create({ cwd, provider: "claude", sessionId: "s1" } as never);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(notices.length, 1, "init 이 되풀이해 알려도 경고는 한 번이다");
    assert.equal(notices[0]?.level, "warn");
    assert.match(notices[0]?.text ?? "", /화면을 직접 열어 보지 못해요/);
    assert.deepEqual(down, ["s1"]);
    await manager.close("s1");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
