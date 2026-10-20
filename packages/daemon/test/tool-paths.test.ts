import assert from "node:assert/strict";
import { test } from "node:test";
import { editPathsOf } from "../src/tool-paths.ts";

test("편집 입력에서 경로를 뽑는다", () => {
  // Claude SDK — Edit · Write · NotebookEdit
  assert.deepEqual(editPathsOf({ file_path: "src/a.tsx", old_string: "x" }), ["src/a.tsx"]);
  assert.deepEqual(editPathsOf({ notebook_path: "n.ipynb" }), ["n.ipynb"]);
});

test("모르는 모양은 빈 배열 — 없는 사실을 지어내지 않는다", () => {
  assert.deepEqual(editPathsOf(null), []);
  assert.deepEqual(editPathsOf("src/a.tsx"), []);
  assert.deepEqual(editPathsOf({ command: "pnpm check" }), []);
  // 옛 공급자의 묶음 모양(changes[].path)은 더 읽지 않는다(2026-10-20).
  assert.deepEqual(editPathsOf({ changes: [{ path: "src/b.tsx" }] }), []);
});
