import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pruneComparisons, readComparison, ScreenComparisons } from "../dist/screen-comparisons.js";

function factory(word: string, unavailable = false) {
  return {
    forIsolated: () => ({
      open: async () => ({ ok: !unavailable, settled: true, blank: false }),
      screenshot: async () => ({
        mediaType: "image/png",
        data: Buffer.from(word).toString("base64"),
      }),
      destroy: async () => {},
    }),
  } as never;
}
const decode = (shot: { data: string } | null) =>
  shot && Buffer.from(shot.data, "base64").toString();

test("photos bind to their request and saved version even when the next request starts before save finishes", async () => {
  const root = await mkdtemp(join(tmpdir(), "colonova-compare-"));
  try {
    const shots = new ScreenComparisons();
    const base = {
      root,
      sessionId: "one",
      head: "old",
      routes: ["/", "/list"],
      url: "http://localhost:5000",
    };
    await shots.begin({ ...base, requestId: "request-a", factory: factory("original") });
    await shots.begin({ ...base, requestId: "request-b", factory: factory("next-before") });
    await shots.finish({
      sessionId: "one",
      requestId: "request-a",
      sha: "save-a",
      screens: [{ route: "/list", title: "회원 목록" }],
      url: base.url,
      factory: factory("changed"),
    });
    const record = await readComparison(root, {
      route: "/list",
      requestId: "request-a",
      sha: "save-a",
    });
    assert.equal(decode(record?.before ?? null), "original");
    assert.equal(decode(record?.after ?? null), "changed");
    assert.equal(record?.sessionId, "one");
    assert.equal(await readComparison(root, { route: "/list", requestId: "request-b" }), null);
    assert.equal(
      await readComparison(root, { route: "/list", requestId: "request-a", sha: "save-b" }),
      null,
    );
    assert.equal(await readComparison(root, { route: "/other", sha: "save-a" }), null);
    assert.equal(
      await readComparison(join(root, "another-project"), {
        route: "/list",
        requestId: "request-a",
      }),
      null,
    );
    assert.equal(
      (await readComparison(root, { route: "/list", sha: "save-a" }))?.requestId,
      "request-a",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing/new screen captures remain explicit null; explanation-only requests have no changed-screen record", async () => {
  const root = await mkdtemp(join(tmpdir(), "colonova-compare-"));
  try {
    const shots = new ScreenComparisons();
    const base = {
      root,
      sessionId: "one",
      requestId: "missing",
      head: "old",
      routes: ["/"],
      url: "http://localhost:5000",
    };
    await shots.begin({ ...base, factory: factory("before", true) });
    await shots.finish({
      sessionId: "one",
      requestId: "missing",
      sha: "new",
      screens: [{ route: "/new", title: "새 화면" }],
      url: base.url,
      factory: factory("after", true),
    });
    const record = await readComparison(root, { route: "/new", requestId: "missing" });
    assert.ok(record);
    assert.equal(record.before, null);
    assert.equal(record.after, null);
    await shots.begin({ ...base, requestId: "explanation", factory: factory("before") });
    await shots.finish({
      sessionId: "one",
      requestId: "explanation",
      sha: "old",
      screens: [{ route: "/", title: "홈" }],
      url: base.url,
      factory: factory("after"),
    });
    assert.equal(await readComparison(root, { route: "/", requestId: "explanation" }), null);
    await writeFile(join(root, "screen-comparisons", "corrupt.json"), "{");
    await pruneComparisons(root);
    assert.equal((await readdir(join(root, "screen-comparisons"))).includes("corrupt.json"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
