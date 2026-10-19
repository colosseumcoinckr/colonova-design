import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
// tree-warm 은 environment.js 를 부르는 형제라 dist 를 본다.
import { openEach, trackedFilePaths, warmTrackedFiles } from "../dist/tree-warm.js";

/**
 * 작업 폴더 데우기(2026-10-20, Windows 실측) — Windows Defender 의 첫 열기 검사를 준비 명령보다
 * 먼저, 함께 치른다. 순수한 부분은 어느 기계에서도, git 이 있는 부분은 임시 레포로 시험한다.
 */

function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "tree-warm-"));
  execFileSync("git", ["init", "-q"], { cwd: root, windowsHide: true });
  mkdirSync(join(root, "src", "깊은 폴더"), { recursive: true });
  writeFileSync(join(root, "package.json"), "{}");
  writeFileSync(join(root, "src", "a.ts"), "export {};");
  writeFileSync(join(root, "src", "깊은 폴더", "b c.tsx"), "export {};");
  writeFileSync(join(root, "untracked.txt"), "not listed");
  execFileSync("git", ["add", "package.json", "src"], { cwd: root, windowsHide: true });
  return root;
}

test("추적 목록: NUL 로 가르고 빈 조각을 버리며 클론 경로에 붙이고 상한에서 자른다", () => {
  const root = join("r", "clone");
  const listing = "a.ts\0src/깊은 폴더/b c.tsx\0\0c.ts\0";
  assert.deepEqual(trackedFilePaths(root, listing), [
    join(root, "a.ts"),
    join(root, "src/깊은 폴더/b c.tsx"),
    join(root, "c.ts"),
  ]);
  assert.deepEqual(trackedFilePaths(root, listing, 2), [
    join(root, "a.ts"),
    join(root, "src/깊은 폴더/b c.tsx"),
  ]);
  assert.deepEqual(trackedFilePaths(root, ""), []);
});

test("열기: 있는 파일만 세고 없는 파일 · 폴더는 건너뛴다(던지지 않는다)", async () => {
  const root = mkdtempSync(join(tmpdir(), "tree-warm-open-"));
  try {
    const files = Array.from({ length: 40 }, (_, i) => join(root, `f${i}.txt`));
    for (const file of files) writeFileSync(file, "x");
    const opened = await openEach([...files, join(root, "없음.txt")], 8);
    assert.equal(opened, 40);
    assert.equal(await openEach([], 8), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Windows 가 아니면 아무것도 하지 않는다(macOS 동작 그대로)", async () => {
  assert.equal(await warmTrackedFiles(join(tmpdir(), "없는-클론"), "darwin"), null);
  assert.equal(await warmTrackedFiles(join(tmpdir(), "없는-클론"), "linux"), null);
});

test("Windows 길: 추적 파일만 열고(추적 밖 파일은 빼고) 한글 · 공백 경로도 연다", async () => {
  const root = tempRepo();
  try {
    const result = await warmTrackedFiles(root, "win32");
    assert.ok(result);
    assert.equal(result.files, 3);
    assert.equal(result.opened, 3);
    assert.ok(result.ms >= 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Windows 길: git 이 목록을 못 주면(없는 클론) 던진다 — 호출자가 버린다", async () => {
  // 임시 폴더의 조상이 레포일 수도 있어 빈 폴더 대신 없는 경로로 잰다.
  const root = join(mkdtempSync(join(tmpdir(), "tree-warm-nogit-")), "없음");
  try {
    await assert.rejects(warmTrackedFiles(root, "win32"));
  } finally {
    rmSync(join(root, ".."), { recursive: true, force: true });
  }
});
