import assert from "node:assert/strict";
import { test } from "node:test";
import { RequestRouter } from "../dist/dispatch.js";

function setup({
  head = "a".repeat(40),
  pending = 0,
  unreadable = false,
  running = false,
  files = ["screen.tsx"],
  token = "c".repeat(64),
} = {}) {
  let submitted = 0;
  const strictReads: boolean[] = [];
  const core = {
    lane: { run: async (_kind: string, job: () => Promise<unknown>) => job() },
    pendingChanges: pending,
    headCommitFiles: async () => ({ sha: head, files: ["screen.tsx"] }),
    refreshPendingChanges: async (strict: boolean) => {
      strictReads.push(strict);
      if (unreadable) throw new Error("unreadable");
    },
    history: async (strict: boolean) => {
      strictReads.push(strict);
      return { base: "main", entries: [{ sha: head }] };
    },
    finalChangedFiles: async () => files,
    submitPreviewToken: async () => token,
    snapshot: () => ({ cycleScreens: [{ route: "/list", title: "회원 목록" }] }),
  };
  const active = {
    repo: { ...core, repoCore: () => core },
    supervisor: {
      submit: () => {
        submitted++;
      },
      settled: async () => {},
    },
    lastDiff: { stage: "clean" },
  };
  const router = new RequestRouter({
    fleet: {
      requireActive: () => active,
      workspaceCwd: () => "/fixture",
    },
    manager: { anyRunning: () => running },
  } as never);
  return { router, strictReads, submitted: () => submitted };
}

test("submission review is fresh and includes the saved version alongside project screens and history", async () => {
  const scene = setup();
  const snapshot = (await scene.router.dispatch({ id: "read", type: "repo.submitPreview" })) as {
    head: string;
    history: { entries: unknown[] };
    repo: { cycleScreens: unknown[] };
  };
  assert.equal(snapshot.head, "a".repeat(40));
  assert.equal(snapshot.history.entries.length, 1);
  assert.equal(snapshot.repo.cycleScreens.length, 1);
  assert.deepEqual(scene.strictReads, [true, true]);
  const unreadable = setup({ unreadable: true });
  await assert.rejects(
    unreadable.router.dispatch({ id: "read", type: "repo.submitPreview" }),
    /unreadable/,
  );
});

test("a changed version, new unsaved work, or running conversation must not start submission", async () => {
  for (const options of [
    { head: "b".repeat(40) },
    { pending: 1 },
    { running: true },
    { files: [] },
  ]) {
    const scene = setup(options);
    await assert.rejects(
      scene.router.dispatch({ id: "submit", type: "repo.submit", expectedHead: "a".repeat(40) }),
    );
    assert.equal(scene.submitted(), 0);
  }
  const matching = setup();
  await matching.router.dispatch({
    id: "submit",
    type: "repo.submit",
    expectedHead: "a".repeat(40),
  });
  assert.equal(matching.submitted(), 1);
});

test("comparison reads wait for the saved photos instead of returning a premature empty state", async () => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  let replied = false;
  const router = new RequestRouter({
    fleet: {
      requireActive: () => ({ slug: "test", paths: { root: "/missing-comparison-fixture" } }),
    },
    comparisonReady: (slug: string) => {
      assert.equal(slug, "test");
      return ready;
    },
  } as never);
  const response = router
    .dispatch({ id: "compare", type: "repo.comparison", route: "/", requestId: "new" })
    .then((value) => {
      replied = true;
      return value;
    });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(replied, false);
  release();
  assert.equal(await response, null);
});

test("same saved head with a changed baseline/content token refuses the old review", async () => {
  const scene = setup({ token: "d".repeat(64) });
  await assert.rejects(
    scene.router.dispatch({
      id: "send",
      type: "repo.submit",
      expectedHead: "a".repeat(40),
      expectedPreview: "c".repeat(64),
    }),
    /SUBMIT_CHANGED/,
  );
  assert.equal(scene.submitted(), 0);
  await scene.router.dispatch({ id: "send", type: "repo.submit", expectedPreview: "d".repeat(64) });
  assert.equal(scene.submitted(), 1);
});
