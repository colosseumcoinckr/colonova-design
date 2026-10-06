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
  // 자동 고침이 끼었으므로 카드가 요청과 설명을 다시 적는다(2026-10-06).
  assert.equal(result.get("repair")?.repaired, true);
});

test("a request nobody repaired is not marked repaired — the card sits right under its own answer", () => {
  const blocks = [
    {
      type: "user",
      id: "u",
      requestId: "a",
      text: "Make the title smaller",
      changedScreens: [{ route: "/", title: "Home" }],
    },
    { type: "text", text: "The title is now smaller.", agentId: null },
    { type: "turn", id: "done", isError: false },
    // 다음 요청의 고침은 앞 요청의 표식이 아니다.
    {
      type: "user",
      id: "u2",
      requestId: "b",
      text: "Next",
      changedScreens: [{ route: "/", title: "Home" }],
    },
    { type: "text", text: "Done", agentId: null },
    { type: "turn", id: "done2", isError: false },
    {
      type: "user",
      text: '<!-- colonova-design:gate {"step":"screen"} -->\nrepair',
      requestId: "gate",
    },
    { type: "text", text: "Repaired", agentId: null },
    { type: "turn", id: "repair2", isError: false },
  ] as never;
  const result = requestResults(blocks, []);
  assert.equal(result.get("done")?.repaired, false);
  assert.equal(result.get("repair2")?.requestId, "b");
  assert.equal(result.get("repair2")?.repaired, true, "고침은 그 앞의 요청에 붙는다");
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
