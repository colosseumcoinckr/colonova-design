import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-motion.test.ts 와 같은 모양).
import { type ToolProgressInput, toolProgress } from "../src/next/onboarding/tool-progress.ts";

/**
 * 도구 준비 칸의 진행 판정(2026-10-25 설치 인지 손질) — 고침 단추를 누른 뒤에도
 * 화면이 가만히 있으면 설치가 도는지 알 수 없었다. pnpm 설치는 요청이 corepack 을
 * 끝까지 돌리고 돌아오는 길이라 그 사이 방송이 없고(최대 60 초), macOS git 설치는
 * OS 설치 창에서 진행되므로 앱이 끝을 모른다 — 누름 즉시 돌림이, 기다림이 말로 선다.
 */

const base = (over: Partial<ToolProgressInput> = {}): ToolProgressInput => ({
  pass: false,
  fixing: null,
  installOpened: false,
  failed: false,
  rechecking: false,
  slowFirstCheck: false,
  ...over,
});

test("toolProgress: 통과가 모든 것에 앞선다 — 도는 고침이 있어도 초록 한 줄", () => {
  assert.deepEqual(toolProgress(base({ pass: true, fixing: "install-pnpm" })), {
    tile: "ok",
    word: "ready",
  });
});

test("toolProgress: pnpm 설치가 도는 동안은 방송이 없어도 돌림이 선다", () => {
  assert.deepEqual(toolProgress(base({ fixing: "install-pnpm", failed: true })), {
    tile: "run",
    word: "installing",
  });
  // macOS git 설치의 누름 한순간도 같다 — 답(설치 창을 열었다)이 오기 전의 틈이다.
  assert.deepEqual(toolProgress(base({ fixing: "install-git" })), {
    tile: "run",
    word: "installing",
  });
});

test("toolProgress: OS 설치 창이 열렸으면 기다림을 말한다 — 앱은 끝을 모른다", () => {
  assert.deepEqual(toolProgress(base({ installOpened: true, failed: true })), {
    tile: "act",
    word: "outside",
  });
});

test("toolProgress: 다시 확인이 도는 동안은 낡은 실패보다 지금의 확인이 먼저다", () => {
  assert.deepEqual(toolProgress(base({ rechecking: true, failed: true })), {
    tile: "run",
    word: "checking",
  });
});

test("toolProgress: 실패 · 느린 첫 검사는 손이 갈 칸, 나머지는 확인 중(옛 판정 그대로)", () => {
  assert.deepEqual(toolProgress(base({ failed: true })), { tile: "act", word: "blocked" });
  assert.deepEqual(toolProgress(base({ slowFirstCheck: true })), {
    tile: "act",
    word: "checking",
  });
  assert.deepEqual(toolProgress(base()), { tile: "run", word: "checking" });
});

test("FirstRun: 고침이 도는 동안 단추가 꺼지고, 설치 창의 기다림은 다시 확인이 지운다", () => {
  const source = readFileSync(
    new URL("../src/next/onboarding/FirstRun.tsx", import.meta.url),
    "utf8",
  );
  // 도구 칸 — 누름 즉시 돌림 · 재눌림 막기 · 자동 다시 확인.
  assert.match(source, /setToolFixBusy\(kind\)/);
  assert.match(source, /disabled=\{toolFixBusy !== null\}/);
  assert.match(source, /kind === "install-git" && fixReplyStarted\(reply\)/);
  assert.match(source, /if \(kind === "install-pnpm"\) recheck\(\)/);
  // 다시 확인 — OS 설치 창의 끝은 이 길만이 안다.
  assert.match(source, /setToolInstallOpened\(false\);\s*\n\s*setRechecking\(true\)/);
  // AI 칸 — 진행기 방송이 닿을 때까지 예고가 서고 재눌림이 막힌다.
  assert.match(source, /if \(installing \|\| daemon\.installDone\) setInstallLaunching\(false\)/);
  assert.match(source, /L\.onboarding\.installStarting/);
  assert.match(
    source,
    /const agentBusy = installing \|\| loginLive \|\| checking \|\| installLaunching/,
  );
});
