// CI-순수-제외 — 실제 임시 Git의 보관 복구를 본다.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  applyAtomicCommits,
  captureAtomicSnapshot,
  disposeAtomicSnapshot,
  prepareAtomicCommits,
  recoverAtomicSave,
} from "../dist/atomic-git.js";
import { makeClone, makeCore, makeRemote } from "./helpers/cycle-harness.ts";

test("ref 이동 뒤 중단되면 소유한 index 전환만 복구한다", async (t) => {
  const remote = await makeRemote();
  const clone = await makeClone(remote);
  t.after(() => {
    clone.dispose();
    remote.dispose();
  });
  const core = makeCore(clone, remote);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: clone.path, encoding: "utf8" }).trim();
  const base = git("rev-parse", "HEAD");
  const index = join(clone.path, ".git", "index");
  const old = readFileSync(index);
  writeFileSync(join(clone.path, "README.md"), "after\n");
  git("add", ".");
  git("commit", "-m", "새 변경");
  const tip = git("rev-parse", "HEAD");
  const next = readFileSync(index);
  writeFileSync(index, old);
  writeFileSync(`${index}.lock`, next);
  const journal = join(clone.path, ".git", "colonova-atomic-save.json");
  writeFileSync(
    journal,
    JSON.stringify({
      pid: process.pid,
      base,
      tip,
      ref: "refs/heads/main",
      lockHash: createHash("sha256").update(next).digest("hex"),
    }),
  );
  await core.lane.run("save", () => recoverAtomicSave(core));
  assert.equal(git("status", "--porcelain"), "");
  assert.equal(existsSync(journal), false);
  assert.equal(existsSync(`${index}.lock`), false);
  assert.equal(git("rev-parse", "HEAD"), tip);
});

test("복구 기록과 다른 lock은 남겨 두고 거절한다", async (t) => {
  const remote = await makeRemote();
  const clone = await makeClone(remote);
  t.after(() => {
    clone.dispose();
    remote.dispose();
  });
  const core = makeCore(clone, remote);
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: clone.path,
    encoding: "utf8",
  }).trim();
  const lock = join(clone.path, ".git", "index.lock");
  writeFileSync(lock, "다른 작업");
  const journal = join(clone.path, ".git", "colonova-atomic-save.json");
  writeFileSync(
    journal,
    JSON.stringify({
      pid: process.pid,
      base: head,
      tip: head,
      ref: "refs/heads/main",
      lockHash: "0".repeat(64),
    }),
  );
  await assert.rejects(
    core.lane.run("save", () => recoverAtomicSave(core)),
    /다른 작업의 잠금/,
  );
  assert.equal(readFileSync(lock, "utf8"), "다른 작업");
  assert.equal(existsSync(journal), true);
});

test("끝난 프로세스의 임시 인덱스만 다음 보관에서 정리한다", async (t) => {
  const remote = await makeRemote();
  const clone = await makeClone(remote);
  t.after(() => {
    clone.dispose();
    remote.dispose();
  });
  const core = makeCore(clone, remote);
  const deadPid = Number(
    execFileSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
      encoding: "utf8",
    }),
  );
  const dirs = ["dead", "live", "unknown"].map((name) =>
    join(clone.path, ".git", `colonova-atomic-${name}`),
  );
  const [dead, live] = dirs;
  assert.ok(dead);
  assert.ok(live);
  for (const dir of dirs) mkdirSync(dir);
  writeFileSync(
    join(dead, "owner.json"),
    JSON.stringify({ kind: "colonova-atomic", pid: deadPid }),
  );
  writeFileSync(
    join(live, "owner.json"),
    JSON.stringify({ kind: "colonova-atomic", pid: process.pid }),
  );
  await core.lane.run("save", () => recoverAtomicSave(core));
  assert.deepEqual(
    dirs.map((dir) => existsSync(dir)),
    [false, true, true],
  );
});

test("ref 이동 결과를 받기 전에 실패해도 복구 기록을 버리지 않는다", async (t) => {
  const remote = await makeRemote();
  const clone = await makeClone(remote);
  t.after(() => {
    clone.dispose();
    remote.dispose();
  });
  const core = makeCore(clone, remote);
  writeFileSync(join(clone.path, "README.md"), "changed\n");
  await core.lane.run("save", async () => {
    const snapshot = await captureAtomicSnapshot(core, ["README.md"]);
    t.after(() => disposeAtomicSnapshot(snapshot));
    const prepared = await prepareAtomicCommits(
      core,
      snapshot,
      {
        groups: [{ message: "fix: 변경", unitIds: snapshot.units.map((unit) => unit.id) }],
      },
      { identityArgs: await core.identityArgs() },
    );
    const original = core.git.bind(core);
    core.git = async (...args) => {
      const result = await original(...args);
      if (args[0][0] === "update-ref") throw new Error("결과 수신 중 중단");
      return result;
    };
    await assert.rejects(applyAtomicCommits(core, snapshot, prepared), /수신 중 중단/);
    core.git = original;
    assert.equal(existsSync(join(clone.path, ".git", "colonova-atomic-save.json")), true);
    await recoverAtomicSave(core);
    assert.equal((await core.git(["status", "--porcelain"])).trim(), "");
    assert.equal((await core.git(["rev-parse", "HEAD"])).trim(), prepared.commits.at(-1)?.sha);
  });
});
