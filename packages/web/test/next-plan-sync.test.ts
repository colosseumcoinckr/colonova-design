import assert from "node:assert/strict";
import { test } from "node:test";
import { requestResults } from "../src/next/lib/request-results.ts";
import { pageDraftKey, stashAsk, takeAsk } from "../src/next/plans/draft/pending-ask.ts";

/**
 * 같이 고치기(2026-10-30 사용자 결정) — 결과 카드가 같이 고친 기록을 싣고, 읽는 문서의 대화 칸이 맡긴 첫 말은 초안의
 * 기획 대화가 한 번만 꺼낸다.
 */

test("결과 — 요청 줄의 같이 고친 기록이 그 요청의 결과에 실린다 · 없으면 null", () => {
  const sync = {
    phase: "done",
    docs: [
      {
        docKey: "p-1",
        pageId: "1",
        title: "가입 정책",
        outcome: "adopted",
        changes: 1,
        entryId: "e",
      },
    ],
    linked: [],
  };
  const blocks = [
    {
      type: "user",
      id: "u1",
      requestId: "a",
      text: "비밀번호를 10자 이상으로",
      changedScreens: [{ route: "/signup", title: "회원가입" }],
      planSync: sync,
    },
    { type: "text", text: "바꿨어요.", agentId: null },
    { type: "turn", id: "t1", isError: false },
    {
      type: "user",
      id: "u2",
      requestId: "b",
      text: "색을 바꿔 줘",
      changedScreens: [{ route: "/", title: "홈" }],
    },
    { type: "turn", id: "t2", isError: false },
  ] as never;
  const results = requestResults(blocks, []);
  assert.deepEqual(results.get("t1")?.planSync, sync);
  assert.equal(results.get("t2")?.planSync, null);
});

test("맡긴 첫 말 — 문서의 초안 열쇠로 한 번만 꺼내고, 나중 말이 앞의 것을 덮는다", () => {
  const key = pageDraftKey("123");
  assert.equal(key, "p-123");
  assert.equal(takeAsk(key), null);
  stashAsk(key, { text: "예외를 더해 줘", refs: [], selection: null });
  stashAsk(key, { text: "표를 다듬어 줘", refs: [], selection: null });
  assert.deepEqual(takeAsk(key), { text: "표를 다듬어 줘", refs: [], selection: null });
  assert.equal(takeAsk(key), null);
});
