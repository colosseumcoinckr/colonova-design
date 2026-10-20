import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TurnActivity } from "../dist/turn-activity.js";

test("성공한 편집의 파일만 보관 후보로 삼고 실패와 읽기는 제외한다", () => {
  const activity = new TurnActivity();
  const root = tmpdir();
  const tool = (id: string, name: string, input: unknown, isError = false) => {
    activity.observe({ kind: "tool.start", toolUseId: id, name, input, agentId: null });
    activity.observe({ kind: "tool.end", toolUseId: id, content: null, isError, agentId: null });
  };
  tool("read", "Read", { file_path: join(root, "old.txt") });
  tool("failed", "Write", { file_path: join(root, "failed.txt") }, true);
  assert.equal(activity.mayHaveChanged, false);
  tool("edit", "Edit", { file_path: join(root, "edited.txt") });
  tool("write", "Write", { file_path: join(root, "written.txt") });
  assert.deepEqual(
    activity.changedFiles(root, ["old.txt", "failed.txt", "edited.txt", "written.txt"]),
    ["edited.txt", "written.txt"],
  );
});

test("명령으로 쓴 파일은 완료 뒤의 미보관 목록으로 확인한다", () => {
  const activity = new TurnActivity();
  activity.observe({
    kind: "tool.start",
    toolUseId: "cmd",
    name: "Bash",
    input: {},
    agentId: null,
  });
  activity.observe({
    kind: "tool.end",
    toolUseId: "cmd",
    content: null,
    isError: false,
    agentId: null,
  });
  assert.equal(activity.mayHaveChanged, true);
  assert.deepEqual(activity.changedFiles(tmpdir(), ["generated.txt"]), ["generated.txt"]);
  assert.deepEqual(activity.changedFiles(tmpdir(), []), []);
});

test("연결 폴더와 실제 경로로 편집한 파일과 삭제한 파일을 같은 보관 대상으로 읽는다", (t) => {
  const temp = mkdtempSync(join(tmpdir(), "colonova-turn-alias-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const real = join(temp, "real");
  const alias = join(temp, "alias");
  mkdirSync(real);
  symlinkSync(real, alias, process.platform === "win32" ? "junction" : "dir");
  writeFileSync(join(real, "edited.txt"), "changed");
  for (const [root, editedRoot] of [
    [alias, real],
    [real, alias],
  ]) {
    const activity = new TurnActivity();
    for (const file of ["edited.txt", "deleted.txt"]) {
      activity.observe({
        kind: "tool.start",
        toolUseId: file,
        name: "Edit",
        input: { file_path: join(editedRoot, file) },
        agentId: null,
      });
      activity.observe({
        kind: "tool.end",
        toolUseId: file,
        content: null,
        isError: false,
        agentId: null,
      });
    }
    assert.deepEqual(activity.changedFiles(root, ["edited.txt", "deleted.txt", "old.txt"]), [
      "edited.txt",
      "deleted.txt",
    ]);
  }
});
