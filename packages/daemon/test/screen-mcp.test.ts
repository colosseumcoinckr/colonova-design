import assert from "node:assert/strict";
import { test } from "node:test";
// 컴파일된 dist 를 읽는다 — `pnpm test` 가 빌드를 먼저 돌린다(레포 규칙).
import { screenSessionMcpServers } from "../dist/agent/drivers/claude/session.js";

/**
 * 화면 세션의 내장 MCP(2026-10-24 사용자 결정) — context-mode 하나만 싣는다.
 * 자격은 필요 없고, Windows 는 stdio 자식을 `cmd /c` 로 열어야 `npx` 를 찾는다.
 * 사용자 설정의 커넥터 · MCP 와의 병합은 `strictMcpConfig` 를 켜지 않는 옵션 쪽
 * 계약이라 여기서는 서버 정의만 본다.
 */
test("화면 세션의 내장 MCP 는 context-mode 하나 — macOS · Linux 는 npx 로 연다", () => {
  for (const platform of ["darwin", "linux"] as const) {
    const servers = screenSessionMcpServers(platform);
    assert.deepEqual(servers, {
      "context-mode": { type: "stdio", command: "npx", args: ["-y", "context-mode"] },
    });
  }
});

test("Windows 는 cmd /c 로 npx 를 연다", () => {
  assert.deepEqual(screenSessionMcpServers("win32"), {
    "context-mode": {
      type: "stdio",
      command: "cmd",
      args: ["/c", "npx", "-y", "context-mode"],
    },
  });
});
