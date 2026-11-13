import assert from "node:assert/strict";
import { test } from "node:test";
import { previewPathOf } from "../src/lib/screen-link.ts";
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

test("requestResults: 턴 끝 확인이 문제 없이 지나간 요청만 checked 를 든다(2026-10-06)", () => {
  const blocks = [
    {
      type: "user",
      id: "u1",
      requestId: "a",
      text: "Make the title smaller",
      changedScreens: [{ route: "/", title: "Home" }],
      checked: { screens: 2, phone: true },
    },
    { type: "text", text: "Done", agentId: null },
    { type: "turn", id: "t1", isError: false },
    {
      type: "user",
      id: "u2",
      requestId: "b",
      text: "Next",
      changedScreens: [{ route: "/x", title: "X" }],
    },
    { type: "text", text: "Done too", agentId: null },
    { type: "turn", id: "t2", isError: false },
  ] as never;
  const results = requestResults(blocks, []);
  assert.deepEqual(results.get("t1")?.checked, { screens: 2, phone: true });
  assert.equal(results.get("t2")?.checked, null, "확인 기록이 없는 요청은 말하지 않는다");
});

test("requestResults: 빈 화면 이름은 같은 대화 답변 링크의 제목으로만 채운다(2026-11-11 실측)", () => {
  // 미리보기는 127.0.0.1:5274 인데 답변 링크는 localhost:3000 — 데몬의 엄격한 origin 대조가
  // 제목을 버린 실제 모양을 재현한다.
  const toPath = (href: string) => previewPathOf(href, "http://127.0.0.1:5274/");
  const answer = {
    type: "text",
    text: "확인: [로그인 화면](http://localhost:3000/signin) · [문서](https://github.com/o/r)",
    agentId: null,
  };
  const turnEnd = { type: "turn", id: "done", isError: false };
  const userBlock = (changedScreens: Array<{ route: string; title: string }>) =>
    ({
      type: "user",
      id: "u",
      requestId: "a",
      text: "로그인 도움말 추가",
      changedScreens,
    }) as never;

  // ① 빈 이름을 같은 경로의 링크 제목으로 채운다 — query 가 달라도 같은 경로다.
  const blocks = [
    userBlock([{ route: "/signin?next=/home", title: "" }]),
    answer,
    turnEnd,
  ] as never;
  assert.deepEqual(requestResults(blocks, [], toPath).get("done")?.screens, [
    { route: "/signin?next=/home", title: "로그인 화면" },
  ]);
  // 링크의 hash 는 화면을 가르지 않는다.
  const hashed = [
    userBlock([{ route: "/signin", title: "" }]),
    { type: "text", text: "[로그인 화면](http://localhost:3000/signin#top)", agentId: null },
    turnEnd,
  ] as never;
  assert.equal(requestResults(hashed, [], toPath).get("done")?.screens[0]?.title, "로그인 화면");

  // ② 다른 라우트 · 외부 사이트의 제목은 빌리지 않는다.
  const other = [userBlock([{ route: "/signup", title: "" }]), answer, turnEnd] as never;
  assert.equal(requestResults(other, [], toPath).get("done")?.screens[0]?.title, "");

  // ③ 데몬이 저장한 이름은 링크가 덮지 않는다.
  const named = [userBlock([{ route: "/signin", title: "로그인" }]), answer, turnEnd] as never;
  assert.equal(requestResults(named, [], toPath).get("done")?.screens[0]?.title, "로그인");

  // toPath 를 모르는 읽기는 지금처럼 빈 이름을 유지한다.
  assert.equal(requestResults(blocks, []).get("done")?.screens[0]?.title, "");
});
