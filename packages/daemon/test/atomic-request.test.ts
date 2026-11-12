import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { undoTargetFor } from "../../web/src/next/lib/undo-last.ts";
import { deriveCycleScreens } from "../dist/cycle-screens.js";
import { ProjectFleet } from "../dist/project-fleet.js";
import { appendScreenMaps, readScreenMap } from "../dist/screen-map.js";

function fixture(root: string, saved: unknown) {
  const session = {
    lastRequestId: "request-1",
    lastSentText: "검색 추가하고 버튼 색 수정",
    lastAssistantText: "[회원 화면](http://localhost:3000/members)",
    provider: "claude",
  };
  const workspace = {
    slug: "fixture",
    paths: { root },
    supervisor: { pendingOp: null },
    repo: {
      refreshPendingChanges: async () => {},
      pendingChanges: 2,
      save: async (options: { atomicRequest?: string }) => {
        assert.equal(options.atomicRequest, session.lastSentText);
        return saved;
      },
      // 저장 뒤 다른 요청이 HEAD를 옮겨도 저장 결과의 SHA를 사용해야 한다.
      headCommitFiles: async () => {
        throw new Error("live HEAD must not be used");
      },
      repoCore: () => ({ previewUrl: "http://localhost:3000" }),
    },
  };
  return {
    workspaceOfSession: () => workspace,
    deps: { manager: { get: () => session } },
    recoveryResync: new Set(),
  };
}

test("분할한 모든 커밋을 같은 요청에 연결하여 전체를 되돌린다", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "atomic-request-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const saved = {
    stage: "published",
    commit: "second",
    turnFiles: ["search.ts", "button.css"],
    turnCommits: [
      { sha: "first", message: "feat: 검색 추가", files: ["search.ts"] },
      { sha: "second", message: "style: 버튼 색 수정", files: ["button.css"] },
    ],
  };
  const result = await ProjectFleet.prototype.autoSaveTurn.call(fixture(root, saved), "s", [
    "/members",
  ]);
  assert.deepEqual(result, { sha: "second", requestId: "request-1" });
  const rows = await readScreenMap(root);
  assert.deepEqual(
    rows.map((row) => [row.sha, row.requestId, row.files]),
    [
      ["first", "request-1", ["search.ts"]],
      ["second", "request-1", ["button.css"]],
    ],
  );
  const commits = ["second", "first", "base"].map((sha) => ({ sha, subject: sha, at: "now" }));
  assert.deepEqual(undoTargetFor(commits, deriveCycleScreens(commits, rows), "request-1"), {
    sha: "base",
    count: 2,
  });
});

test("보관 실패를 이전 커밋의 성공으로 연결하지 않는다", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "atomic-request-failed-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = await ProjectFleet.prototype.autoSaveTurn.call(
    fixture(root, { stage: "failed", gate: "commit" }),
    "s",
    ["/members"],
  );
  assert.equal(result, undefined);
  assert.deepEqual(await readScreenMap(root), []);
});

test("요청별 기록을 동시에 추가해도 누락하지 않고 실패한 배치는 일부만 남기지 않는다", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "atomic-map-batch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const row = (sha: string) => ({ sha, routes: ["/members"], files: ["member.ts"], at: "now" });
  await Promise.all([
    appendScreenMaps(root, [row("a"), row("b")]),
    appendScreenMaps(root, [row("c"), row("d")]),
  ]);
  assert.deepEqual(
    (await readScreenMap(root)).map((value) => value.sha),
    ["a", "b", "c", "d"],
  );
  // 직렬화 실패가 중간 행까지 남기지 않는지 확인한다.
  const broken = {
    ...row("f"),
    toJSON() {
      throw new Error("직렬화 실패");
    },
  };
  await assert.rejects(appendScreenMaps(root, [row("e"), broken]), /직렬화 실패/);
  assert.deepEqual(
    (await readScreenMap(root)).map((value) => value.sha),
    ["a", "b", "c", "d"],
  );
  assert.deepEqual(readdirSync(root), ["screen-map.jsonl"]);
});
