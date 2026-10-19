import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ChatEvent } from "@colonova-design/protocol";

import type { PreviewDriver, PreviewOpenResult } from "../dist/preview-driver.js";
import { gateOutcomeStats, PreviewDrivers } from "../dist/preview-drivers.js";
import { inspectScreens, judgeScreen } from "../dist/screen-gate.js";

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
