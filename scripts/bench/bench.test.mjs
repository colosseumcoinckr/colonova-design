/**
 * bench.mjs 의 순수 조각 시험(2026-11-03 · 검토 REVIEW-B) — 흔적 걷기가 무엇을
 * 지우고 되돌릴지 정하는 `suggestCleanup` 을 잰다. bench.mjs 는 직접 실행될 때만
 * main 이 도니(import 하면 돌지 않는다) 부르기만 하면 된다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { suggestCleanup } from "./bench.mjs";

test("흔적 걷기 — 새 대화는 지우고 새로 연 초안은 버린다", () => {
  const steps = suggestCleanup({
    threadId: "t1",
    docKey: "d1",
    existed: false,
    previousRevision: null,
  });
  assert.deepEqual(steps, [
    { kind: "대화 지우기", request: { type: "draft.threadDelete", threadId: "t1" } },
    { kind: "초안 버리기", request: { type: "draft.discard", docKey: "d1" } },
  ]);
});

test("흔적 걷기 — 원래 있던 초안은 말을 보내기 전 개정으로 되돌린다", () => {
  const steps = suggestCleanup({
    threadId: "t1",
    docKey: "d1",
    existed: true,
    previousRevision: 3,
  });
  assert.deepEqual(steps, [
    { kind: "대화 지우기", request: { type: "draft.threadDelete", threadId: "t1" } },
    {
      kind: "개정 되돌리기",
      request: { type: "draft.revisionRestore", docKey: "d1", revision: 3 },
    },
  ]);
});

test("흔적 걷기 — 열 수 없었으면 걸을 것이 없다", () => {
  // 초안을 열지 못해 docKey 가 없는 실패 — 버리거나 되돌릴 것이 없다.
  assert.deepEqual(
    suggestCleanup({ threadId: null, docKey: null, existed: false, previousRevision: null }),
    [],
  );
  // 초안은 있었는데 읽은 개정이 없다 — 어느 개정으로 되돌릴지 모르니 건드리지 않는다.
  assert.deepEqual(
    suggestCleanup({ threadId: "t1", docKey: "d1", existed: true, previousRevision: null }),
    [{ kind: "대화 지우기", request: { type: "draft.threadDelete", threadId: "t1" } }],
  );
  // 대화가 열리기 전에 멈췄다 — 지울 대화가 없다.
  assert.deepEqual(
    suggestCleanup({ threadId: null, docKey: "d1", existed: false, previousRevision: null }),
    [{ kind: "초안 버리기", request: { type: "draft.discard", docKey: "d1" } }],
  );
});

test("흔적 걷기 — 걸음의 종류 말은 결과 이유 · 콘솔에 그대로 실린다", () => {
  for (const step of suggestCleanup({
    threadId: "t",
    docKey: "d",
    existed: true,
    previousRevision: 1,
  })) {
    // 사용자 말 · 경로가 아니라 일의 종류다 — 실패 줄은 이 이름만 남긴다.
    assert.match(step.kind, /^(대화 지우기|초안 버리기|개정 되돌리기)$/);
  }
});
