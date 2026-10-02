import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSessionTarget } from "../src/next/lib/session-target.ts";

test("home create then send retains the accepted ID before React publishes its view", async () => {
  const newborn = new Set<string>();
  const renderedViews: Record<string, { live: boolean; state: string }> = {};
  const launches: Array<string | undefined> = [];
  const start = async (resume?: string) => {
    launches.push(resume);
    const id = resume ?? `created-${launches.length}`;
    newborn.add(id);
    return id;
  };
  const id = await start();
  const target = await resolveSessionTarget(id, renderedViews[id], newborn, start);
  assert.equal(target, id);
  assert.equal(launches.length, 1, "one accepted creation must produce one conversation");
});

test("stored/error targets resume, while discarded newborn targets create anew", async () => {
  const newborn = new Set(["crashed"]);
  const resumes: Array<string | undefined> = [];
  const start = async (resume?: string) => {
    resumes.push(resume);
    return `replacement-${resumes.length}`;
  };
  assert.equal(
    await resolveSessionTarget("stored", { live: false, state: "closed" }, newborn, start),
    "replacement-1",
  );
  assert.equal(
    await resolveSessionTarget("crashed", { live: true, state: "error" }, newborn, start),
    "replacement-2",
  );
  assert.equal(newborn.has("replacement-2"), true);
  newborn.delete("discarded");
  await resolveSessionTarget("discarded", undefined, newborn, start);
  assert.deepEqual(resumes, ["stored", "crashed", undefined]);
});
