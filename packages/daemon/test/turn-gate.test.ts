import assert from "node:assert/strict";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PreviewDrivers } from "../dist/preview-drivers.js";
import { DaemonServer } from "../dist/server.js";
import { turnSnapshot } from "../dist/turn-changes.js";
import { makeScene } from "./helpers/cycle-harness.ts";

test("server skips pinned read-only repair over dirty work, while actual edits and deletions still gate before save", async () => {
  const scene = await makeScene();
  try {
    mkdirSync(join(scene.clone.path, "src/app"), { recursive: true });
    const page = join(scene.clone.path, "src/app/page.tsx");
    writeFileSync(page, "export const title = 'before';\n");
    await scene.git(["add", "-A"]);
    await scene.git(["commit", "-m", "seed page"]);
    writeFileSync(join(scene.clone.path, "README.md"), "preexisting unsaved work\n");
    let repairs = 0;
    let saves = 0;
    const drivers = new PreviewDrivers({
      factory: () => ({
        forIsolated: () => ({
          open: async () => ({ ok: true, settled: true }),
          consoleLines: async () => [{ level: "error", text: "broken" }],
          screenshot: async () => ({ data: "", mediaType: "image/png" }),
          destroy: async () => {},
        }),
      }),
      activeRepo: () =>
        ({
          root: scene.clone.path,
          status: async () => ({ previewUrl: "http://127.0.0.1:8888" }),
        }) as never,
      session: () =>
        ({
          state: "idle",
          title: "request",
          send: () => {
            repairs++;
          },
        }) as never,
      sessions: () => [],
      notice: () => {},
    });
    const server = Object.create(DaemonServer.prototype) as any;
    Object.assign(server, {
      drivers,
      manager: { get: () => ({ state: "idle" }) },
      turnBaselines: new Map(),
      changedTurnFiles: new Map(),
      gateRequests: new Map(),
      turnEnds: new Map(),
      autoSaveDue: new Set(),
      screenMapDue: new Map(),
      gateFallbackCount: new Map(),
      comparisons: { cancel: () => {} },
      workspaceOfSession: () => ({
        repo: { repoCore: () => scene.core },
        paths: { root: scene.clone.dir },
      }),
      finishWithoutGate: () => {
        if (server.autoSaveDue.delete("s")) saves++;
      },
    });
    let gate: Promise<unknown> | undefined;
    server.startGate = () => {
      gate = drivers.runGate("s");
    };
    const finish = async (mutate?: () => void, pinned = true) => {
      drivers.gatedSessions.delete("s");
      if (pinned) drivers.notePinned("s", "index");
      server.turnBaselines.set("s", await turnSnapshot(scene.core));
      server.autoSaveDue.add("s");
      mutate?.();
      await server.finishChangedTurn("s", 1);
      await gate;
    };
    await finish();
    assert.equal(repairs, 0, "no repair for observational request, even with dirty README");
    assert.equal(saves, 0, "do not attribute old unsaved work to read-only request");
    assert.equal(drivers.pinnedThisTurn.has("s"), false);
    await finish(() => writeFileSync(page, "export const title = 'after';\n"), false);
    assert.equal(repairs, 1, "real unpinned TS delta still checks");
    await finish(() => unlinkSync(page), false);
    assert.equal(repairs, 2, "deleting a screen is also a genuine edit");
  } finally {
    scene.dispose();
  }
});

test("final outgoing diff excludes upstream-only advances, sync-only history, and reverted changes", async () => {
  const scene = await makeScene();
  try {
    writeFileSync(join(scene.clone.path, "own.txt"), "own change\n");
    await scene.git(["add", "own.txt"]);
    await scene.git(["commit", "-m", "own"]);
    assert.deepEqual(await scene.core.finalChangedFiles(), ["own.txt"]);
    // The separate developer clone advances upstream; no incoming file is an outgoing deletion.
    const beforeToken = await scene.core.submitPreviewToken();
    await scene.dev.pushToBase({ "incoming.txt": "developer change\n" }, "incoming change");
    await scene.git(["fetch", "origin"]);
    assert.notEqual(
      await scene.core.submitPreviewToken(),
      beforeToken,
      "baseline movement invalidates review even before HEAD moves",
    );
    assert.deepEqual(await scene.core.finalChangedFiles(), ["own.txt"]);
    await scene.git(["merge", "--no-edit", "origin/main"]);
    assert.deepEqual(await scene.core.finalChangedFiles(), ["own.txt"]);
    await scene.git(["rm", "own.txt"]);
    await scene.git(["commit", "-m", "undo own"]);
    assert.deepEqual(await scene.core.finalChangedFiles(), []);
  } finally {
    scene.dispose();
  }
});

test("repair with no additional edits keeps original screen association, and late verification never saves a new running request", async () => {
  const scene = await makeScene();
  try {
    const server = Object.create(DaemonServer.prototype) as any;
    let state = "idle";
    let finishes = 0;
    let verification: Promise<string> = Promise.resolve("unchanged");
    const associations = ["/"];
    Object.assign(server, {
      manager: { get: () => ({ state }) },
      turnBaselines: new Map(),
      changedTurnFiles: new Map([["s", ["src/app/page.tsx"]]]),
      gateRequests: new Map(),
      turnEnds: new Map([["s", "success"]]),
      screenMapDue: new Map([["s", associations]]),
      drivers: { verifyRepair: () => verification },
      workspaceOfSession: () => ({
        repo: { repoCore: () => scene.core },
        paths: { root: scene.clone.dir },
      }),
      broadcast: () => {},
      finishWithoutGate: () => {
        finishes++;
        assert.deepEqual(server.screenMapDue.get("s"), associations);
        assert.deepEqual(server.changedTurnFiles.get("s"), ["src/app/page.tsx"]);
      },
    });
    server.turnBaselines.set("s", await turnSnapshot(scene.core));
    server.gateRequests.set("s", { requestId: "repair", afterTurn: 2, text: "check" });
    await server.finishChangedTurn("s", 1);
    assert.equal(finishes, 1, "original edit can save with its original screen association");
    const deferred = Promise.withResolvers<string>();
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    verification = deferred.promise;
    server.drivers.verifyRepair = () => {
      entered();
      return verification;
    };
    server.gateRequests.set("s", { requestId: "repair-next", afterTurn: 3, text: "check" });
    const finishing = server.finishChangedTurn("s", 1);
    await waiting;
    state = "running"; // Session.send sets this before beforeDeliver finishes its new snapshot.
    deferred.resolve("unchanged");
    await finishing;
    assert.equal(finishes, 1, "old verification cannot trigger save in a newer running turn");
  } finally {
    scene.dispose();
  }
});
