import assert from "node:assert/strict";
import { test } from "node:test";
import { armGitNetworkWatchdog } from "../dist/repo-core.js";

/**
 * 네트워크 동사에만 침묵 예산이 걸린다(2026-10-02) — 소켓이 끊긴 fetch · push
 * 가 프로젝트의 차선을 영원히 붙잡지 않게. 시계는 출력 청크마다 다시 차므로,
 * 파이프에서 진행 출력을 끄는 git 에게는 --progress 를 얹는다.
 */
test("git 와치독: 네트워크 동사에 예산과 --progress 가 붙는다", () => {
  const fetch = armGitNetworkWatchdog(["fetch", "origin"]);
  assert.equal(fetch.stallMs, 300_000);
  assert.deepEqual(fetch.args, ["fetch", "--progress", "origin"]);

  const clone = armGitNetworkWatchdog([
    "clone",
    "--depth",
    "1",
    "https://example.com/r.git",
    "dst",
  ]);
  assert.equal(clone.stallMs, 300_000);
  assert.equal(clone.args[1], "--progress");
  assert.equal(clone.args[2], "--depth");
  assert.equal(clone.args[4], "https://example.com/r.git");
});

test("git 와치독: 로컬 동사는 손대지 않는다", () => {
  const status = armGitNetworkWatchdog(["status", "--porcelain"]);
  assert.equal(status.stallMs, undefined);
  assert.deepEqual(status.args, ["status", "--porcelain"]);

  const revParse = armGitNetworkWatchdog(["rev-parse", "HEAD"]);
  assert.equal(revParse.stallMs, undefined);
  assert.deepEqual(revParse.args, ["rev-parse", "HEAD"]);
});

test("git 와치독: 조용함을 청한 호출자의 인자는 그대로 둔다", () => {
  const quiet = armGitNetworkWatchdog(["fetch", "-q", "origin"]);
  assert.equal(quiet.stallMs, 300_000);
  assert.deepEqual(quiet.args, ["fetch", "-q", "origin"]);

  const progressed = armGitNetworkWatchdog(["push", "--progress", "origin", "main"]);
  assert.equal(progressed.stallMs, 300_000);
  assert.deepEqual(progressed.args, ["push", "--progress", "origin", "main"]);
});

test("git 와치독: ls-remote 는 예산만 — 진행 출력을 강제하지 않는다", () => {
  const lsRemote = armGitNetworkWatchdog(["ls-remote", "origin", "refs/heads/main"]);
  assert.equal(lsRemote.stallMs, 300_000);
  assert.deepEqual(lsRemote.args, ["ls-remote", "origin", "refs/heads/main"]);
});
