import assert from "node:assert/strict";
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
  tool("patch", "fileChange", { changes: [{ path: "deleted.txt" }] });
  assert.deepEqual(
    activity.changedFiles(root, ["old.txt", "failed.txt", "edited.txt", "deleted.txt"]),
    ["edited.txt", "deleted.txt"],
  );
});

test("명령으로 쓴 파일은 완료 뒤의 미보관 목록으로 확인한다", () => {
  const activity = new TurnActivity();
  activity.observe({
    kind: "tool.start",
    toolUseId: "cmd",
    name: "commandExecution",
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
