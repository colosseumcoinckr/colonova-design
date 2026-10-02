import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { collectPrompts, replayRollout } from "../dist/agent/drivers/codex/store.js";
import { DriverRegistry } from "../dist/agent/registry.js";
import { SessionManager } from "../dist/session-manager.js";

test("one public conversation owns its vendor transcript across close and process restart", async () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "colonova-identity-")));
  mkdirSync(join(cwd, ".git"));
  const launched: any[] = [];
  const lookedUp: string[] = [];
  const registry = new DriverRegistry();
  registry.register({
    id: "codex",
    describe: () => ({ id: "codex", label: "Codex", capabilities: {} }),
    createSession: (launch: any, hooks: any) => {
      launched.push(launch);
      queueMicrotask(() =>
        hooks.onEvent({
          kind: "init",
          sessionId: "vendor",
          model: launch.model ?? "default",
          cwd,
          tools: [],
          apiKeySource: "none",
        }),
      );
      return {
        vendorId: "vendor",
        alive: true,
        close: async () => {},
        setModel: async () => {},
        setEffort: async () => {},
      };
    },
    store: {
      list: async () => [
        { id: "vendor", provider: "codex", title: "same title", lastModified: 1 },
        { id: "unrelated", provider: "codex", title: "same title", lastModified: 2 },
      ],
      has: async (id: string) => id === "vendor" || id === "unrelated",
      import: async (id: string) => {
        lookedUp.push(id);
        return [];
      },
    },
  } as never);
  const make = () => new SessionManager({ onEvent: () => {}, onState: () => {} }, registry);
  try {
    const first = make();
    const session = first.create({
      cwd,
      provider: "codex",
      sessionId: "public",
      launch: { model: "luna", effort: "low" },
    } as never);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual((await first.list(cwd)).map((row) => row.sessionId).sort(), [
      "public",
      "unrelated",
    ]);
    await first.history("public", cwd);
    assert.equal(lookedUp.at(-1), "vendor");
    await session.setEffort("high");
    await session.setModel("sol");
    await first.close("public");
    const restarted = make();
    assert.deepEqual((await restarted.list(cwd)).map((row) => row.sessionId).sort(), [
      "public",
      "unrelated",
    ]);
    const beforeView = launched.length;
    assert.deepEqual(await restarted.selectors("public", cwd), {
      provider: "codex",
      model: "sol",
      effort: "high",
      selectionKnown: true,
      models: [],
      fastMode: false,
      fastModeBlocked: null,
    });
    const { RequestRouter } = await import("../dist/dispatch.js");
    const router = new RequestRouter({
      manager: restarted,
      fleet: { resolveSessionCwd: async () => cwd },
      plans: {
        rememberModels: () => assert.fail("stored settings have no new live model catalog"),
      },
    } as never);
    const storedSelection = await router.dispatch({
      id: "settings",
      type: "session.selectors",
      sessionId: "public",
    });
    assert.equal((storedSelection as { model: string }).model, "sol");
    assert.equal(launched.length, beforeView, "viewing settings must not start an agent");
    assert.equal((await restarted.selectors("unrelated", cwd)).selectionKnown, false);
    const resumed = restarted.create({
      cwd,
      provider: "codex",
      launch: { resume: "public" },
    } as never);
    assert.equal(resumed.id, "public");
    assert.equal(launched.at(-1).resume, "vendor");
    assert.equal(launched.at(-1).model, "sol");
    assert.equal(launched.at(-1).effort, "high");
    await restarted.history("public", cwd);
    assert.equal(lookedUp.at(-1), "vendor");
    await restarted.closeAll();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("Codex replay preserves marked pin C and its following gate after ordinary A/B", async () => {
  const pin = '<!-- colonova-design:comments {"items":[],"request":"C"} -->\nC pin question';
  const gate = '<!-- colonova-design:gate {"step":"screen"} -->\ncheck';
  const lines = ["A", "B", pin, gate].flatMap((text, n) => [
    {
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    },
    { type: "turn_context", payload: { turn_id: `turn-${n}` } },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: `answer-${n}` }],
      },
    },
  ]);
  lines.unshift({
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: "<permissions instructions>injected</permissions instructions>",
        },
      ],
    },
  } as never);
  assert.deepEqual(
    (await collectPrompts(lines)).map((row) => row.text),
    ["A", "B", pin, gate],
  );
  assert.deepEqual(
    (await replayRollout(lines))
      .filter((event) => event.kind === "user.echo")
      .map((event) => event.text),
    ["A", "B", pin, gate],
  );
});

test("same-ID providers retain accepted model/effort and explicit default resets", async () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "colonova-identity-")));
  mkdirSync(join(cwd, ".git"));
  const launches: any[] = [];
  const registry = new DriverRegistry();
  registry.register({
    id: "claude",
    describe: () => ({ id: "claude", label: "Claude", capabilities: {} }),
    createSession: (launch: any, hooks: any) => {
      launches.push(launch);
      queueMicrotask(() =>
        hooks.onEvent({
          kind: "init",
          sessionId: "same",
          model: launch.model ?? "default",
          cwd,
          tools: [],
          apiKeySource: "none",
        }),
      );
      return {
        alive: true,
        close: async () => {},
        setModel: async () => {},
        setEffort: async () => {},
      };
    },
    store: {
      list: async () => [{ id: "same", provider: "claude", title: "same", lastModified: 1 }],
    },
  } as never);
  const make = () => new SessionManager({ onEvent: () => {}, onState: () => {} }, registry);
  try {
    const first = make();
    const session = first.create({
      cwd,
      sessionId: "same",
      launch: { model: "sonnet", effort: "low" },
    } as never);
    await new Promise((resolve) => setImmediate(resolve));
    await session.setModel("opus");
    await session.setEffort("high");
    await first.close("same");
    const second = make();
    const resumed = second.create({ cwd, launch: { resume: "same" } } as never);
    assert.equal(launches.at(-1).model, "opus");
    assert.equal(launches.at(-1).effort, "high");
    await new Promise((resolve) => setImmediate(resolve));
    await resumed.setModel(null);
    await resumed.setEffort(null);
    await second.close("same");
    const third = make();
    third.create({ cwd, launch: { resume: "same" } } as never);
    assert.equal(launches.at(-1).model, null);
    assert.equal(launches.at(-1).effort, null);
    await third.closeAll();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("public identity lookup stays in its project, and alias deletion propagates real store failure", async () => {
  const a = realpathSync(mkdtempSync(join(tmpdir(), "colonova-identity-a-")));
  const b = realpathSync(mkdtempSync(join(tmpdir(), "colonova-identity-b-")));
  mkdirSync(join(a, ".git"));
  mkdirSync(join(b, ".git"));
  let stored = true;
  let rejectDelete = true;
  const deletes: string[] = [];
  const registry = new DriverRegistry();
  registry.register({
    id: "codex",
    describe: () => ({ id: "codex", label: "Codex", capabilities: {} }),
    createSession: (_: any, hooks: any) => {
      queueMicrotask(() =>
        hooks.onEvent({
          kind: "init",
          sessionId: "vendor",
          model: "luna",
          cwd: a,
          tools: [],
          apiKeySource: "none",
        }),
      );
      return { vendorId: "vendor", alive: true, close: async () => {} };
    },
    store: {
      list: async (cwd: string) =>
        cwd === a && stored
          ? [{ id: "vendor", provider: "codex", title: "same", lastModified: 1 }]
          : [],
      has: async (id: string, cwd: string) => cwd === a && id === "vendor" && stored,
      delete: async (id: string) => {
        deletes.push(id);
        if (rejectDelete) throw new Error("storage refused deletion");
        stored = false;
      },
    },
  } as never);
  const make = () => new SessionManager({ onEvent: () => {}, onState: () => {} }, registry);
  try {
    const manager = make();
    manager.create({ cwd: a, provider: "codex", sessionId: "public" } as never);
    await new Promise((resolve) => setImmediate(resolve));
    await manager.list(a);
    await manager.close("public");
    assert.equal(await manager.findStoredProvider("public", b), undefined);
    assert.equal(await manager.findStoredProvider("public", a), "codex");
    await assert.rejects(manager.remove("public", a), /storage refused deletion/);
    rejectDelete = false;
    const live = manager.create({
      cwd: a,
      provider: "codex",
      launch: { resume: "public" },
    } as never);
    await new Promise((resolve) => setImmediate(resolve));
    await manager.remove("vendor", a);
    assert.equal(manager.get(live.id), undefined);
    assert.deepEqual(deletes, ["vendor", "vendor"]);
    assert.deepEqual(await make().list(a), []);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test("identity journal tolerates unavailable storage and follows a worktree gitdir pointer", async () => {
  const { SessionIdentities } = await import("../dist/session-identity.js");
  const { writeFileSync } = await import("node:fs");
  const cwd = mkdtempSync(join(tmpdir(), "colonova-journal-"));
  const row = {
    publicId: "public",
    vendorId: "vendor",
    provider: "codex",
    model: "luna",
    effort: "low" as const,
  };
  try {
    // .git is a file whose target is unavailable: save is still safe for the live process.
    writeFileSync(join(cwd, ".git"), "gitdir: missing\n");
    const unavailable = new SessionIdentities();
    assert.doesNotThrow(() => unavailable.save(cwd, row));
    assert.equal(unavailable.find(cwd, "vendor")?.publicId, "public");
    mkdirSync(join(cwd, "metadata"));
    writeFileSync(join(cwd, ".git"), "gitdir: metadata\n");
    new SessionIdentities().save(cwd, row);
    assert.deepEqual(new SessionIdentities().find(cwd, "public"), row);
    writeFileSync(
      join(cwd, "metadata/colonova-session-identities.jsonl"),
      JSON.stringify({ ...row, model: 123, effort: "bad" }) + "\n{torn",
    );
    assert.deepEqual(new SessionIdentities().find(cwd, "public"), {
      ...row,
      model: null,
      effort: null,
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
