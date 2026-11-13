import assert from "node:assert/strict";
import { test } from "node:test";
// 컴파일된 dist 를 읽는다 — 데몬 시험의 계약.
import { confluenceMirrorRoot } from "../dist/confluence-mirror.js";
import { screenSessionDirs } from "../dist/session-dirs.js";

test("프로젝트를 모르면 함께 여는 폴더가 없다", () => {
  assert.deepEqual(
    screenSessionDirs(null, () => true),
    [],
  );
});

test("사본 폴더가 없으면 함께 여는 폴더가 없다", () => {
  assert.deepEqual(
    screenSessionDirs("/tmp/없는-프로젝트", () => false),
    [],
  );
});

test("사본 폴더가 있으면 사본 뿌리 하나만 실는다", () => {
  const projectRoot = "/tmp/있는-프로젝트";
  const mirrorRoot = confluenceMirrorRoot(projectRoot);
  const asked: string[] = [];
  const exists = (path: string): boolean => {
    asked.push(path);
    return path === mirrorRoot;
  };
  assert.deepEqual(screenSessionDirs(projectRoot, exists), [mirrorRoot]);
  assert.deepEqual(asked, [mirrorRoot], "사본 뿌리만 물어본다");
});
