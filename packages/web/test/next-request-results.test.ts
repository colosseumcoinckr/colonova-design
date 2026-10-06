import assert from "node:assert/strict";
import { test } from "node:test";
import { latestResult, requestResults } from "../src/next/lib/request-results.ts";

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

test("latestResult: 마지막 턴이 낸 결과만 `방금 한 것` 이다", () => {
  const first = [
    {
      type: "user",
      id: "u1",
      requestId: "a",
      text: "First",
      changedScreens: [{ route: "/", title: "Home" }],
    },
    { type: "text", text: "Done one", agentId: null },
    { type: "turn", id: "t1", isError: false },
  ];
  assert.equal(latestResult(first as never, [])?.requestId, "a");
  // 그 뒤에 새 요청이 왔다 — 아직 답이 없어도 `방금 한 것` 은 이제 그 요청이다.
  const asked = [...first, { type: "user", id: "u2", requestId: "b", text: "Second" }];
  assert.equal(latestResult(asked as never, []), null);
  // 화면을 안 건드린 설명이 마지막이면 마지막 결과가 아니다.
  const explained = [
    ...asked,
    { type: "text", text: "Just words", agentId: null },
    { type: "turn", id: "t2", isError: false },
  ];
  assert.equal(latestResult(explained as never, []), null);
  // 마지막 턴이 실패했거나 중단됐으면 되돌릴 방금의 결과가 없다.
  const failed = [...first, { type: "turn", id: "t3", isError: true }];
  assert.equal(latestResult(failed as never, []), null);
  assert.equal(latestResult([] as never, []), null);
});

test("latestResult: 자동 고침 턴이 끝난 요청도 마지막 결과다 — 고침 중에는 아니다", () => {
  const repairing = [
    {
      type: "user",
      id: "u1",
      requestId: "a",
      text: "First",
      changedScreens: [{ route: "/", title: "Home" }],
    },
    { type: "text", text: "Done", agentId: null },
    { type: "turn", id: "t1", isError: false },
    {
      type: "user",
      text: '<!-- colonova-design:gate {"step":"screen"} -->\nrepair',
      requestId: "g",
    },
  ];
  assert.equal(
    latestResult(repairing as never, []),
    null,
    "고치는 중에는 마지막이 사람의 말이 아니어도 아직 턴이 없다",
  );
  const repaired = [
    ...repairing,
    { type: "text", text: "Fixed", agentId: null },
    { type: "turn", id: "t2", isError: false },
  ];
  assert.equal(latestResult(repaired as never, [])?.requestId, "a");
});
