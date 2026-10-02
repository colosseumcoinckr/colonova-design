import assert from "node:assert/strict";
import { test } from "node:test";
import { requestResults } from "../src/next/lib/request-results.ts";

test("recorded changed request and automatic repair produce one result with original literal explanation", () => {
  const blocks = [
    {
      type: "user",
      id: "u",
      requestId: "a",
      text: "Make the title smaller",
      changedScreens: [{ route: "/", title: "Home" }],
    },
    { type: "text", text: "The title is now smaller.", agentId: null },
    { type: "turn", id: "original", isError: false },
    {
      type: "user",
      text: '<!-- colonova-design:gate {"step":"screen"} -->\nrepair',
      requestId: "gate",
    },
    { type: "text", text: "Repair finished", agentId: null },
    { type: "turn", id: "repair", isError: false },
  ] as never;
  const result = requestResults(blocks, []);
  assert.equal(result.size, 1);
  assert.equal(result.get("repair")?.requestId, "a");
  assert.equal(result.get("repair")?.explanation, "The title is now smaller.");
  assert.equal(result.get("repair")?.prompt, "Make the title smaller");
});
test("read-only answer links and legacy unknown requests never invent recorded changes", () => {
  const blocks = [
    { type: "user", requestId: "read", text: "Explain the page" },
    { type: "text", text: "[Home](http://localhost:5000/)", agentId: null },
    { type: "turn", id: "read-end", isError: false },
  ] as never;
  assert.equal(requestResults(blocks, []).size, 0);
  assert.equal(
    requestResults(blocks, [{ requestId: "other", route: "/", title: "Home" }] as never).size,
    0,
  );
});

test("pinned changed requests display literal planner words, never injected instructions", () => {
  for (const [note, expected] of [
    ["Please soften this button", "Please soften this button"],
    [undefined, "Make it smaller"],
  ]) {
    const text =
      "<!-- colonova-design:comments " +
      JSON.stringify({
        screen: "Home",
        items: [{ label: "Button", comment: "Make it smaller" }],
        note,
      }) +
      " -->\nTechnical AI instructions";
    const result = requestResults(
      [
        { type: "user", requestId: "pins", text, changedScreens: [{ route: "/", title: "Home" }] },
        { type: "turn", id: "done", isError: false },
      ] as never,
      [],
    );
    assert.equal(result.get("done")?.prompt, expected);
  }
  assert.equal(
    requestResults(
      [
        {
          type: "user",
          requestId: "internal",
          text: '<!-- colonova-design:brief {"title":"Prepare"} -->\ninternal',
          changedScreens: [{ route: "/", title: "Home" }],
        },
        { type: "turn", id: "done", isError: false },
      ] as never,
      [],
    ).size,
    0,
  );
});
