import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  beforeRoutes,
  pruneComparisons,
  readComparison,
  ScreenComparisons,
} from "../dist/screen-comparisons.js";

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

test("beforeRoutes: 핀 → 보던 화면 → 최근 고쳐진 화면 → 루트 순서다", () => {
  const routes = beforeRoutes({
    pins: [{ screen: "settings" }],
    viewing: { path: "/members" },
    known: ["/a", "/b"],
  });
  assert.deepEqual(routes, ["settings", "/members", "/a", "/b", "/"]);
});

test("beforeRoutes: 보던 경로의 쿼리와 해시는 뗀다 — finish 는 쿼리 없는 경로로 짝짓는다", () => {
  assert.deepEqual(beforeRoutes({ pins: [], viewing: { path: "/members?tab=2#top" }, known: [] }), [
    "/members",
    "/",
  ]);
  // 쿼리만 남는 경로(`?x=1`)는 보던 화면이 아니다.
  assert.deepEqual(beforeRoutes({ pins: [], viewing: { path: "?x=1" }, known: [] }), ["/"]);
});

test("beforeRoutes: 보던 화면이 없으면 예전 차례 그대로다 — 핀 · 최근 고쳐진 화면 · 루트", () => {
  assert.deepEqual(beforeRoutes({ pins: [{ screen: "list" }], known: ["/a", "/b"] }), [
    "list",
    "/a",
    "/b",
    "/",
  ]);
  assert.deepEqual(beforeRoutes({ pins: [], known: [] }), ["/"]);
});

test("말로만 부탁한 요청도 보던 화면의 수정 전 사진을 먼저 얻는다 — 사진은 앞 네 길까지다(2026-10-06)", async () => {
  const root = await mkdtemp(join(tmpdir(), "colonova-compare-"));
  try {
    const opened: string[] = [];
    const spy = {
      forIsolated: () => ({
        open: async (route: string) => {
          opened.push(route);
          return { ok: true, settled: true, blank: false };
        },
        screenshot: async () => ({
          mediaType: "image/png",
          data: Buffer.from("x").toString("base64"),
        }),
        destroy: async () => {},
      }),
    } as never;
    // 관찰 지도가 여덟 줄을 건네도 처음 만지는 화면(보던 화면)이 앞 네 길 안에 든다.
    const known = ["/a", "/b", "/c", "/d", "/e", "/f", "/g", "/h"];
    const shots = new ScreenComparisons();
    const input = {
      root,
      sessionId: "s",
      head: null,
      url: "http://127.0.0.1:5174",
      factory: spy,
    };
    await shots.begin({
      ...input,
      requestId: "typed",
      routes: beforeRoutes({ pins: [], viewing: { path: "/members" }, known }),
    });
    assert.deepEqual(opened, ["/members", "/a", "/b", "/c"]);
    // 보던 화면을 모르던 때의 차례 — 그 화면의 사진은 없었다.
    opened.length = 0;
    await shots.begin({
      ...input,
      requestId: "old",
      routes: beforeRoutes({ pins: [], known }),
    });
    assert.deepEqual(opened, ["/a", "/b", "/c", "/d"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("보던 화면의 수정 전 사진이 바뀐 화면의 결과와 짝지어진다 — 말로만 부탁한 요청의 전 · 후(2026-10-06)", async () => {
  const root = await mkdtemp(join(tmpdir(), "colonova-compare-"));
  try {
    // 열린 길마다 그 길의 이름으로 사진을 찍는다 — 짝이 맞으면 전 · 후가 같은 길에서 나온 것이다.
    const byRoute = (phase: string) =>
      ({
        forIsolated: () => {
          let current = "";
          return {
            open: async (route: string) => {
              current = route;
              return { ok: true, settled: true, blank: false };
            },
            screenshot: async () => ({
              mediaType: "image/png",
              data: Buffer.from(`${phase}:${current}`).toString("base64"),
            }),
            destroy: async () => {},
          };
        },
      }) as never;
    const shots = new ScreenComparisons();
    const url = "http://127.0.0.1:5174";
    await shots.begin({
      root,
      sessionId: "s",
      requestId: "typed",
      head: "old",
      // 처음 만지는 화면이라 관찰 지도에는 없다 — 보던 화면(쿼리 달린 경로)만이 이 사진의 단서다.
      routes: beforeRoutes({ pins: [], viewing: { path: "/members?tab=2" }, known: ["/a", "/b"] }),
      url,
      factory: byRoute("before"),
    });
    await shots.finish({
      sessionId: "s",
      requestId: "typed",
      sha: "save-1",
      screens: [{ route: "/members", title: "회원 목록" }],
      url,
      factory: byRoute("after"),
    });
    const record = await readComparison(root, { route: "/members", requestId: "typed" });
    assert.equal(decode(record?.before ?? null), "before:/members", "수정 전 사진이 있다");
    assert.equal(decode(record?.after ?? null), "after:/members");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
