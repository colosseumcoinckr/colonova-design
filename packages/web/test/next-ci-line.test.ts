import assert from "node:assert/strict";
import { test } from "node:test";
import type { Attention, HandoffStatus } from "@colonova-design/protocol";
// 순수 모듈 — src 에서 곧장 읽는다(turn-screens.test.ts 와 같은 모양).
import { L } from "../src/next/labels.ts";
import { ciLine } from "../src/next/lib/ci-line.ts";

/**
 * 이번 작업 팝오버의 자동 검사 줄(2026-10-07 베타 준비 분석 · A2a). 읽힌 만큼만 말한다: 검사를 못 읽는 연결(권한 없음)이나
 * 검사가 없는 레포는 `handoff.ci` 가 없고 줄도 없다 — 없다는 말이 통과도 실패도 아니다.
 */

const since = "2026-10-07T00:00:00.000Z";
const handoff = (state: HandoffStatus["state"], ci?: HandoffStatus["ci"]): HandoffStatus => ({
  number: 7,
  url: "https://github.com/o/r/pull/7",
  title: "t",
  state,
  branch: "b",
  ...(ci ? { ci } : {}),
});
const fixing: Attention = { kind: "ai-fixing", since, key: "ci" };
const notified: Attention = { kind: "developer-notified", since, via: "pr", key: "ci:7:rounds" };

test("검사를 읽지 못했거나 없으면 줄이 없다", () => {
  assert.equal(ciLine(null, null, L), null);
  assert.equal(ciLine(undefined, null, L), null);
  assert.equal(
    ciLine(handoff("open"), null, L),
    null,
    "읽지 못한 연결 — 통과도 실패도 말하지 않는다",
  );
});

test("통과 · 도는 중은 데몬이 읽은 그대로 말한다", () => {
  assert.deepEqual(ciLine(handoff("open", { state: "passing" }), null, L), {
    tone: "passing",
    text: "자동 검사를 통과했어요",
  });
  assert.deepEqual(ciLine(handoff("open", { state: "pending" }), null, L), {
    tone: "pending",
    text: "자동 검사가 돌고 있어요",
  });
});

test("통과하지 못했다 — 누가 맡았는지는 문제 문장의 주의가 정한다", () => {
  const failing = handoff("open", { state: "failing", failing: 2 });
  assert.deepEqual(ciLine(failing, fixing, L), {
    tone: "fixing",
    text: "자동 검사가 통과하지 못해 AI가 고치고 있어요",
  });
  assert.deepEqual(ciLine(failing, notified, L), {
    tone: "notified",
    text: "자동 검사가 계속 통과하지 못해 개발자에게 알렸어요",
  });
  // 아무도 맡지 않았거나 다른 문제의 주의는 일반 문장이다.
  assert.deepEqual(ciLine(failing, null, L), {
    tone: "failing",
    text: "자동 검사가 통과하지 못했어요",
  });
  const preview: Attention = { kind: "ai-fixing", since };
  assert.equal(ciLine(failing, preview, L)?.tone, "failing");
  const other: Attention = { kind: "developer-notified", since, via: "pr", key: "push:behind" };
  assert.equal(ciLine(failing, other, L)?.tone, "failing");
});

test("열린 요청에서만 말한다 — 합쳐지거나 닫히면 줄이 없다", () => {
  const ci = { state: "failing", failing: 1 } as const;
  assert.equal(ciLine(handoff("changes_requested", ci), null, L)?.tone, "failing");
  assert.equal(ciLine(handoff("merged", ci), null, L), null);
  assert.equal(ciLine(handoff("closed", ci), null, L), null);
});
