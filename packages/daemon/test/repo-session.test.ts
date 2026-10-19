import assert from "node:assert/strict";
import { test } from "node:test";
import { CodexAgentSession, codexAppServerArgs } from "../dist/agent/drivers/codex/session.js";

test("연결 레포의 신뢰는 실행 인자에만 두고 Windows 경로를 TOML 문자열로 인용한다", () => {
  const cwd = 'C:\\Users\\한 글\\repo "demo"';
  const args = codexAppServerArgs(cwd);
  assert.equal(args.length, 3);
  assert.equal(args[0], "-c");
  assert.equal(args[2], "app-server");
  const key = /^projects=\{(".*")=\{trust_level="trusted"\}\}$/.exec(args[1] ?? "");
  assert.ok(key);
  assert.equal(JSON.parse(key[1] ?? ""), process.platform === "win32" ? cwd.toLowerCase() : cwd);
});

test("새 대화·재개·분기는 레포 설정을 덮는 MCP 설정 없이 시작한다", async () => {
  for (const [method, resume] of [
    ["thread/start", {}],
    ["thread/resume", { resume: "original" }],
    ["thread/fork", { resume: "original", forkSession: true, resumeSessionAt: "cut" }],
  ] as const) {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const events: Array<{ cwd: string }> = [];
    const session = Object.create(CodexAgentSession.prototype) as any;
    session.launch = {
      cwd: "connected-repo",
      sessionId: "public",
      model: null,
      appendSystemPrompt: "app context",
      ...resume,
    };
    session.hooks = { onEvent: (event: { cwd: string }) => events.push(event) };
    session.transport = {
      notify: () => {},
      request: async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        return { thread: { id: "vendor" }, data: [{ skills: [{ name: "repo-skill" }] }] };
      },
    };
    await session.handshake();
    const request = calls.find((call) => call.method === method);
    assert.ok(request);
    assert.equal(request.params.config, undefined, "설정 파일의 MCP 목록을 덮지 않는다");
    assert.equal(request.params.baseInstructions, undefined, "기본 개발 지침을 대체하지 않는다");
    assert.equal(request.params.developerInstructions, "app context");
    assert.equal(events[0]?.cwd, "connected-repo");
    if (method === "thread/start") assert.equal(request.params.cwd, "connected-repo");
    await session.commands();
    assert.deepEqual(calls.find((call) => call.method === "skills/list")?.params.cwds, [
      "connected-repo",
    ]);
  }
});
