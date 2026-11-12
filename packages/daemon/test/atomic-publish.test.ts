// CI-순수-제외 — 실제 임시 Git과 레포 검사 명령을 실행한다.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PublishCycle } from "../dist/repo-publish.js";
import { makeClone, makeCore, makeRemote } from "./helpers/cycle-harness.ts";

async function scene(t: { after(fn: () => void): void }, coupled = false) {
  const remote = await makeRemote();
  const clone = await makeClone(remote);
  t.after(() => {
    clone.dispose();
    remote.dispose();
  });
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: clone.path, encoding: "utf8" }).trim();
  writeFileSync(
    join(clone.path, "package.json"),
    JSON.stringify({ scripts: { check: "node check.cjs" } }),
  );
  writeFileSync(join(clone.path, "package-lock.json"), "{}");
  writeFileSync(
    join(clone.path, "check.cjs"),
    coupled
      ? 'const f=require("node:fs");if(f.readFileSync("a.txt","utf8")!==f.readFileSync("b.txt","utf8"))process.exit(1);'
      : 'const f=require("node:fs");if(!f.readFileSync("a.txt","utf8")||!f.readFileSync("b.txt","utf8"))process.exit(1);',
  );
  for (const file of ["a.txt", "b.txt"]) writeFileSync(join(clone.path, file), "before\n");
  git("add", ".");
  git("commit", "-m", "검사 기준");
  git("checkout", "-b", "atomic-test");
  const base = git("rev-parse", "HEAD");
  const core = makeCore(clone, remote, { branch: "atomic-test" });
  for (const file of ["a.txt", "b.txt"]) writeFileSync(join(clone.path, file), "after\n");
  return { core, git, base, clone };
}

const usage = {
  turns: 1,
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  durationMs: 1,
  apiRetries: 0,
};

test("화면 보관은 검사된 의미 묶음을 여러 로컬 커밋으로 반환한다", async (t) => {
  const s = await scene(t);
  const cycle = new PublishCycle(s.core, {
    machineMemo: async () => {
      throw new Error("추가 제목 호출 금지");
    },
    atomicPlan: async (input) => ({
      ok: true,
      cached: false,
      usage,
      plan: {
        groups: input.units.map((unit, i) => ({
          message: `feat: 변경 ${i + 1}`,
          unitIds: [unit.id],
        })),
      },
    }),
  });
  const saved = await s.core.lane.run("save", () =>
    cycle.runSave({ message: "두 변경", atomicRequest: "두 변경" }),
  );
  assert.equal(saved.stage, "published");
  assert.deepEqual(saved.atomic, { status: "split", checked: true });
  assert.equal(saved.turnCommits?.length, 2);
  assert.equal(s.git("rev-list", "--count", `${s.base}..HEAD`), "2");
  assert.equal(s.git("status", "--porcelain"), "");
  assert.equal(s.git("show", "HEAD:a.txt"), "after");
  assert.equal(s.git("show", "HEAD:b.txt"), "after");
  assert.equal(s.git("branch", "-r", "--list", "origin/atomic-test"), "");
});

test("중간 상태가 깨지는 분리는 적용하지 않고 변경 전체를 보관한다", async (t) => {
  const s = await scene(t, true);
  const cycle = new PublishCycle(s.core, {
    machineMemo: async () => null,
    atomicPlan: async (input) => ({
      ok: true,
      cached: false,
      usage,
      plan: {
        groups: input.units.map((unit, i) => ({
          message: `feat: 변경 ${i + 1}`,
          unitIds: [unit.id],
        })),
      },
    }),
  });
  const saved = await s.core.lane.run("save", () =>
    cycle.runSave({ message: "연결된 변경", atomicRequest: "연결된 변경" }),
  );
  assert.equal(saved.stage, "published");
  assert.deepEqual(saved.atomic, { status: "fallback", checked: false, reason: "check-failed" });
  assert.equal(s.git("rev-list", "--count", `${s.base}..HEAD`), "1");
  assert.equal(s.git("status", "--porcelain"), "");
});

test("모델 실패도 추가 모델 호출 없이 원래 변경을 한 번 보관한다", async (t) => {
  const s = await scene(t);
  let memoCalls = 0;
  const cycle = new PublishCycle(s.core, {
    machineMemo: async () => {
      memoCalls++;
      throw new Error("추가 제목 호출 금지");
    },
    atomicPlan: async () => ({ ok: false, reason: "turn-failed", usage }),
  });
  const saved = await s.core.lane.run("save", () => cycle.runSave({ atomicRequest: "변경 요청" }));
  assert.equal(saved.stage, "published");
  assert.equal(memoCalls, 0);
  assert.equal(saved.atomic?.reason, "turn-failed");
  assert.equal(s.git("rev-list", "--count", `${s.base}..HEAD`), "1");
  assert.equal(s.git("status", "--porcelain"), "");
});

test("검사 명령이 없는 레포는 모델 호출 없이 단일 보관한다", async (t) => {
  const s = await scene(t);
  writeFileSync(join(s.clone.path, "package.json"), "{}");
  let calls = 0;
  const cycle = new PublishCycle(s.core, {
    machineMemo: async () => null,
    atomicPlan: async () => {
      calls++;
      throw new Error("분류 불필요");
    },
  });
  const saved = await s.core.lane.run("save", () =>
    cycle.runSave({ message: "변경 요청", atomicRequest: "변경 요청" }),
  );
  assert.equal(saved.stage, "published");
  assert.equal(saved.atomic?.reason, "no-check-script");
  assert.equal(calls, 0);
  assert.equal(s.git("status", "--porcelain"), "");
});

test("레포 커밋 훅을 건너뛰지 않고 기존 경로에서 보관한다", async (t) => {
  const s = await scene(t);
  const hook = join(s.clone.path, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\nprintf ran > .git/atomic-hook-proof\n");
  chmodSync(hook, 0o755);
  let calls = 0;
  const cycle = new PublishCycle(s.core, {
    machineMemo: async () => null,
    atomicPlan: async () => {
      calls++;
      throw new Error("훅 경로에서는 분류 불필요");
    },
  });
  const saved = await s.core.lane.run("save", () =>
    cycle.runSave({ message: "변경 요청", atomicRequest: "변경 요청" }),
  );
  assert.equal(saved.stage, "published");
  assert.equal(saved.atomic?.reason, "commit-hooks");
  assert.equal(calls, 0);
  assert.equal(readFileSync(join(s.clone.path, ".git", "atomic-hook-proof"), "utf8"), "ran");
});
