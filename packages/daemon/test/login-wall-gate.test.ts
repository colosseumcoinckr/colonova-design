import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ChatEvent } from "@colonova-design/protocol";
import { BROWSER_TOOLS, callBrowserTool, type ToolDef } from "../dist/browser-tools.js";
import { LOGIN_WALL_NOTICE } from "../dist/login-wall.js";
import type { PreviewDriver, PreviewOpenResult } from "../dist/preview-driver.js";
import { gateOutcomeStats, PreviewDrivers } from "../dist/preview-drivers.js";
import { inspectScreens, judgeScreen } from "../dist/screen-gate.js";
import { DaemonServer } from "../dist/server.js";
import { TurnStats } from "../dist/turn-stats.js";

/**
 * 로그인 벽(2026-10-07 베타 준비 분석): 검증 창은 사용자의 로그인 세션을 쓰지 않아 로그인이 필요한 화면은 로그인 화면으로
 * 튕긴다 — 문서는 멀쩡히 로드되고 콘솔도 조용해서 예전에는 「확인했어요」 로 셌다. 열기가 닿은 자리(`arrival`)가 로그인
 * 화면이면 그 화면은 확인한 화면으로도 문제로도 세지 않고, AI 에게는 한 문장으로 알린다. 드라이버가 닿은 자리를 재는 부분은
 * 데스크톱 프로세스라 로컬 전용이다 — 여기는 가짜 창이 같은 재료를 내준다.
 */

const ORIGIN = "http://127.0.0.1:8888";

/** 이 경로들은 로그인 화면으로 튕긴다. */
function fakeWindow(walled: string[]): PreviewDriver & { consoleReads: number } {
  const driver = {
    consoleReads: 0,
    open: async (route: string): Promise<PreviewOpenResult> => ({
      ok: true,
      settled: true,
      blank: false,
      arrival: walled.includes(route)
        ? {
            url: `${ORIGIN}/login?next=${encodeURIComponent(route)}`,
            passwordFields: 1,
            interactive: 5,
          }
        : { url: `${ORIGIN}${route}`, passwordFields: 0, interactive: 24 },
    }),
    // 로그인 화면에는 오류가 있다고 해 두고, 그 오류가 이 화면의 고침 턴으로 새지 않는지 본다.
    consoleLines: async () => {
      driver.consoleReads += 1;
      return [{ level: "error", text: "login page error" }];
    },
    screenshot: async () => ({ data: "", mediaType: "image/png" }),
    destroy: async () => {},
  };
  return driver;
}

/** 열린 화면의 콘솔은 조용하다 — 벽만 오류를 낸다. */
function quietWindow(walled: string[], noisy: string[] = []): PreviewDriver {
  const base = fakeWindow(walled);
  let current = "";
  return {
    ...base,
    open: async (route: string, options?: unknown) => {
      current = route;
      return await base.open(route, options as never);
    },
    consoleLines: async () => {
      if (walled.includes(current)) return await base.consoleLines();
      return noisy.includes(current) ? [{ level: "error", text: "boom" }] : [];
    },
  };
}

test("judgeScreen: 로그인 화면으로 튕긴 화면은 loginWall 이고 콘솔 · 폭 · 접근성을 읽지 않는다", async () => {
  const driver = fakeWindow(["/members"]);
  const verdict = await judgeScreen(driver, "/members", { a11y: true });
  assert.equal(verdict.opened, true);
  if (!verdict.opened) return;
  assert.equal(verdict.loginWall, true);
  assert.deepEqual(verdict.lines, [], "로그인 화면의 오류는 이 화면의 것이 아니다");
  assert.equal(verdict.blank, false);
  assert.equal(driver.consoleReads, 0, "벽 앞에서는 콘솔을 읽지 않는다");
  const normal = await judgeScreen(fakeWindow([]), "/members");
  assert.equal(normal.opened && normal.loginWall, undefined, "정상 화면에는 칸이 없다");
});

test("judgeScreen: 닿은 자리를 못 알려 준 드라이버는 예전 그대로다 — 벽이라고 말하지 않는다", async () => {
  const driver = {
    open: async () => ({ ok: true as const, settled: true }),
    consoleLines: async () => [],
    screenshot: async () => ({ data: "", mediaType: "image/png" }),
    destroy: async () => {},
  };
  const verdict = await judgeScreen(driver, "/members");
  assert.equal(verdict.opened && verdict.loginWall, undefined);
});

test("inspectScreens: 벽은 열어 본 화면에도 문제에도 들지 않는다 — 오류가 고침 턴으로 새지 않는다", async () => {
  const opened = new Set<string>();
  const walled = new Set<string>();
  const phone = new Set<string>();
  const troubles = await inspectScreens(quietWindow(["/b"]), [{ route: "/a" }, { route: "/b" }], {
    opened,
    phone,
    loginWall: walled,
  });
  assert.deepEqual(troubles, [], "로그인 화면의 오류는 문제로 세지 않는다");
  assert.deepEqual([...opened], ["/a"]);
  assert.deepEqual([...walled], ["/b"]);
  assert.deepEqual([...phone], ["/a"], "휴대폰 폭도 열어 본 화면만");
});

/** 조건이 설 때까지 기다린다 — 정해 둔 시간을 믿는 대신 매크로태스크를 건너는 유한 반복이다. */
async function until(done: () => boolean): Promise<void> {
  for (let turn = 0; turn < 1000 && !done(); turn += 1) await new Promise(setImmediate);
}

/** 화면마다 벽을 정하는 가짜 창을 쓰는 진짜 게이트. */
function gateDrivers(walled: string[], noisy: string[] = []) {
  return new PreviewDrivers({
    factory: () => ({ forIsolated: () => quietWindow(walled, noisy) }),
    activeRepo: () =>
      ({
        root: "/tmp/repo",
        isCloned: () => true,
        status: async () => ({ previewUrl: ORIGIN }),
      }) as never,
    session: () => ({ state: "idle", title: "request", send: () => {} }) as never,
    sessions: () => [],
    notice: () => {},
  } as never);
}

test("runGate: 벽 화면은 열어 본 수에 들지 않고 횟수로만 남는다", async () => {
  const preview = gateDrivers(["/b"]);
  preview.notePinned("s", "/a");
  preview.notePinned("s", "/b");
  const outcome = await preview.runGate("s");
  assert.equal(outcome.status, "ok", "벽의 오류 때문에 고침 턴이 열리지 않는다");
  if (outcome.status !== "ok") return;
  assert.equal(outcome.kept, 2);
  assert.equal(outcome.opened, 1, "확인한 화면은 벽이 아닌 하나");
  assert.equal(outcome.loginWall, 1);
  assert.equal(outcome.phone, true, "휴대폰 폭은 열어 본 화면 기준");
  assert.deepEqual(gateOutcomeStats(outcome), { screens: 2, loginWall: 1 });
});

test("runGate: 벽이 없으면 loginWall 칸이 없다 — 통계 행도 그대로", async () => {
  const preview = gateDrivers([]);
  preview.notePinned("s", "/a");
  const outcome = await preview.runGate("s");
  assert.equal(outcome.status, "ok");
  if (outcome.status !== "ok") return;
  assert.equal("loginWall" in outcome, false);
  assert.deepEqual(gateOutcomeStats(outcome), { screens: 1 });
});

/** 서버 몸통에서 게이트가 판정한 순간(startGate)만 꺼내 돌린다 — gate-checked.test.ts 와 같은 길. */
function serverWith(preview: PreviewDrivers) {
  const checks: unknown[] = [];
  const server = Object.create(DaemonServer.prototype) as any;
  Object.assign(server, {
    gateChecked: new Map(),
    gateFallbackCount: new Map(),
    screenMapDue: new Map(),
    autoSaveDue: new Set(["s"]),
    stats: { noteGateCheck: (_id: string, row: unknown) => checks.push(row) },
    drivers: preview,
    runAutoSave: () => {},
  });
  return { server, checks };
}

test("startGate: 벽 화면은 확인한 화면 기록(GateChecked)에 세지 않는다", async () => {
  const preview = gateDrivers(["/b"]);
  preview.notePinned("s", "/a");
  preview.notePinned("s", "/b");
  const { server, checks } = serverWith(preview);
  server.startGate("s", 1000);
  await until(() => checks.length > 0);
  assert.deepEqual(server.gateChecked.get("s"), { screens: 1, phone: true }, "벽을 뺀 한 곳만");
  assert.equal((checks[0] as { loginWall?: number }).loginWall, 1, "통계에는 횟수만");
});

test("startGate: 열어 본 화면이 전부 벽이면 기록이 없다 — 「확인했어요」 가 서지 않는다", async () => {
  const preview = gateDrivers(["/a", "/b"]);
  preview.notePinned("s", "/a");
  preview.notePinned("s", "/b");
  const { server, checks } = serverWith(preview);
  server.startGate("s", 1000);
  await until(() => checks.length > 0);
  assert.equal(server.gateChecked.has("s"), false);
  assert.equal((checks[0] as { loginWall?: number }).loginWall, 2);
  assert.equal(JSON.stringify(checks).includes("/a"), false, "통계에 경로를 남기지 않는다");
});

test("runGate: 한 화면에 문제가 있고 다른 화면이 벽이면 문제만 고침 턴으로 가고 재검증은 벽을 뺀다", async () => {
  const preview = gateDrivers(["/b"], ["/a"]);
  preview.notePinned("s", "/a");
  preview.notePinned("s", "/b");
  const outcome = await preview.runGate("s");
  assert.equal(outcome.status, "trouble");
  if (outcome.status !== "trouble") return;
  assert.deepEqual(
    outcome.troubles.map((trouble) => trouble.route),
    ["/a"],
    "벽의 오류는 문제가 아니다",
  );
  assert.equal(outcome.loginWall, 1);
  const pending = (preview as any).pendingGates.get("s");
  assert.deepEqual(pending.screens, [{ route: "/a" }], "벽 화면은 다시 열어도 확인되지 않는다");
  assert.deepEqual(gateOutcomeStats(outcome).loginWall, 1);
});

test("verifyRepair: 벽 화면은 해결을 확인한 것이 아니다 — 확인 못 함으로 끝난다", async () => {
  const preview = gateDrivers(["/b"]);
  (preview as any).pendingGates.set("s", {
    screens: [{ route: "/b" }],
    typeCheck: false,
    baseline: new Map(),
  });
  assert.equal(await preview.verifyRepair("s", true, "success"), "unverified");
});

test("checkScreen: 벽 앞의 조용한 콘솔로 깨끗하다고 하지 않는다 — 확인 불능이다", async () => {
  const walledSide = gateDrivers(["/members"]);
  assert.equal(await walledSide.checkScreen("/members"), null);
  const open = gateDrivers([]);
  assert.deepEqual(await open.checkScreen("/members"), { settled: true, errors: [] });
});

test("screen_check: 벽 화면은 AI 가 읽는 한 문장과 함께 돌아오고 횟수만 통계로 간다", async () => {
  const noted: string[] = [];
  const walls: Array<[string, number]> = [];
  const server = Object.create(DaemonServer.prototype) as any;
  Object.assign(server, {
    config: { previewDriverFactory: { forIsolated: () => quietWindow(["/b"]) } },
    workspaceOfSession: () => ({ repo: { status: async () => ({ previewUrl: ORIGIN }) } }),
    drivers: { notePinned: (_id: string, url: string) => noted.push(url) },
    stats: { noteLoginWall: (id: string, count: number) => walls.push([id, count]) },
  });
  const reply = await server.runScreenCheck("s", { routes: ["/a", "/b"], capture: true });
  assert.equal(reply.body.ok, true);
  const [first, second] = reply.body.result.screens;
  assert.equal(first.url, `${ORIGIN}/a`);
  assert.equal(first.loginWall, undefined, "정상 화면에는 칸이 없다");
  assert.equal(second.url, `${ORIGIN}/b`, "AI 가 링크로 쓸 주소는 요청한 화면의 것");
  assert.equal(second.loginWall, LOGIN_WALL_NOTICE);
  assert.deepEqual(second.errors, [], "로그인 화면의 오류를 이 화면의 오류로 돌려주지 않는다");
  assert.equal(second.capture, undefined, "로그인 화면의 사진은 이 화면의 것이 아니다");
  assert.deepEqual(noted, [`${ORIGIN}/a`, `${ORIGIN}/b`], "이번 작업의 장부에는 둘 다 적힌다");
  assert.deepEqual(walls, [["s", 1]]);

  // AI 가 읽는 도구 결과 텍스트까지 — 중계가 그 문장을 그대로 내린다.
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true, result: reply.body.result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    const tool = BROWSER_TOOLS.find((entry) => entry.name === "screen_check") as ToolDef;
    const outcome = await callBrowserTool(
      tool,
      {},
      { daemonUrl: "http://127.0.0.1:1", secret: "s" },
    );
    const block = outcome.content[0] as { type: string; text: string };
    assert.equal(block.type, "text");
    assert.ok(block.text.includes(LOGIN_WALL_NOTICE), "AI 가 읽는 결과에 한 문장이 있다");
    assert.ok(tool.description.includes("loginWall"), "도구 설명이 이 칸을 말한다");
  } finally {
    globalThis.fetch = original;
  }
});

// --- 통계: 횟수만 -----------------------------------------------------------

function readRows(dir: string): Array<Record<string, unknown>> {
  const name = readdirSync(dir).find((file) => file.startsWith("turn-stats-"));
  if (name === undefined) return [];
  return readFileSync(join(dir, name), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function stats(dir: string): TurnStats {
  return new TurnStats(
    {
      projectOf: () => "proj",
      chipsOf: () => ({ provider: "claude", model: "stub", effort: null }),
      contextTokens: async () => 1,
    },
    { dir },
  );
}

test("턴 통계: 게이트 행과 턴 행에 loginWall 횟수만 남는다 — 없으면 칸이 없다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "colonova-wall-stats-"));
  try {
    const recorder = stats(dir);
    recorder.noteGateCheck("s", { ms: 5, screens: 2, reopened: false, loginWall: 2 });
    recorder.noteGateCheck("s", { ms: 5, screens: 1, reopened: false });
    recorder.noteLoginWall("none", 3); // 도는 턴이 없으면 조용히 흘린다
    recorder.observe("s", { kind: "user.echo", text: "화면 고쳐 줘", images: 0 } as ChatEvent);
    recorder.noteLoginWall("s", 1);
    recorder.noteLoginWall("s", 2);
    recorder.observe("s", {
      kind: "turn.end",
      subtype: "success",
      isError: false,
      costUsd: null,
      numTurns: 1,
      durationMs: 10,
      resultText: null,
    } as ChatEvent);
    for (let turn = 0; turn < 1000 && readRows(dir).length < 3; turn += 1) {
      await new Promise(setImmediate);
    }
    const rows = readRows(dir);
    const gates = rows.filter((row) => row.kind === "gateset");
    assert.equal(gates[0]?.loginWall, 2);
    assert.equal("loginWall" in (gates[1] ?? {}), false);
    const turn = rows.find((row) => row.kind !== "gateset");
    assert.equal(turn?.loginWall, 3, "한 턴의 screen_check 가 만난 벽의 합");
    assert.equal(JSON.stringify(rows).includes("/"), false, "주소 · 경로는 한 줄도 없다");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
