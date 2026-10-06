import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(turn-screens.test.ts 와 같은 모양).
import { L } from "../src/next/labels.ts";
import { ledgerLine, submitCopy } from "../src/next/lib/submit-copy.ts";

const log = [
  { at: "2026-09-25T01:00:00Z", text: "a" },
  { at: "2026-09-25T03:00:00Z", text: "c" },
  { at: "2026-09-25T02:00:00Z", text: "b" },
];

test("submitCopy: 선로가 없거나 쉬면 제출 그대로 — 판정은 여정의 몫", () => {
  for (const submit of [undefined, null, { phase: "idle" as const, attempts: 0, log: [] }]) {
    const copy = submitCopy(submit, L);
    assert.equal(copy.phase, "idle");
    assert.equal(copy.label, L.submit.idle);
    assert.equal(copy.busy, null);
    assert.equal(copy.firstPoint, null);
    assert.equal(copy.reason, null);
    assert.equal(copy.lastAt, null);
  }
});

test("submitCopy: 도는 제출 · 다시 제출하는 중", () => {
  const running = submitCopy({ phase: "running", attempts: 1, log: [] }, L);
  assert.equal(running.label, "제출하는 중…");
  assert.equal(running.busy, "running");
  const retrying = submitCopy({ phase: "retrying", attempts: 2, lastError: "network", log }, L);
  assert.equal(retrying.label, "다시 제출하는 중…");
  assert.equal(retrying.busy, "retrying");
  assert.equal(retrying.firstPoint, null);
});

test("submitCopy: 막힘 — 버튼은 제출하지 못했어요, 첫 점과 잠긴 이유", () => {
  const auth = submitCopy({ phase: "blocked", attempts: 3, lastError: "auth", log }, L);
  assert.equal(auth.label, "제출하지 못했어요");
  assert.equal(auth.busy, null);
  assert.equal(auth.firstPoint, "제출 전 · 제출하지 못했어요");
  assert.equal(auth.reason, "연결 코드가 만료돼 제출이 막혔어요 — 새 초대 파일이 필요해요");
  for (const lastError of ["rejected", "other", undefined] as const) {
    const notified = submitCopy({ phase: "blocked", attempts: 5, lastError, log }, L);
    assert.equal(
      notified.reason,
      "제출이 막혔어요 — 풀리면 다시 제출해요. 위의 안내를 확인해 주세요",
      String(lastError),
    );
  }
});

test("submitCopy: 인터넷 문제로 막힌 제출은 담당자 · 개발자를 말하지 않는다(2026-10-06)", () => {
  const network = submitCopy({ phase: "blocked", attempts: 5, lastError: "network", log }, L);
  assert.equal(network.reason, "인터넷 연결이 끊겨 제출이 막혔어요 — 연결되면 다시 제출해요");
  // 막힌 제출의 버튼 · 첫 점은 그대로다 — 이유 한 줄만 다르다.
  assert.equal(network.label, "제출하지 못했어요");
  assert.equal(network.firstPoint, "제출 전 · 제출하지 못했어요");
  assert.doesNotMatch(network.reason ?? "", /안내를 확인|담당자|개발자/);
});

test("submitCopy: 마지막 제출 시각은 기록 중 가장 늦은 것 — 순서와 표기에 기대지 않는다", () => {
  assert.equal(submitCopy({ phase: "idle", attempts: 1, log }, L).lastAt, "2026-09-25T03:00:00Z");
  const mixed = [
    { at: "2026-09-25T11:30:00+09:00", text: "x" },
    { at: "2026-09-25T02:00:00Z", text: "y" },
  ];
  assert.equal(
    submitCopy({ phase: "idle", attempts: 1, log: mixed }, L).lastAt,
    "2026-09-25T11:30:00+09:00",
  );
});

test("ledgerLine: 이번 작업의 제출 칸 — 도는 중 · 다시 도는 중 · 막힘의 이유", () => {
  assert.equal(ledgerLine({ phase: "running", attempts: 1, log: [] }, L), "제출하는 중…");
  assert.equal(ledgerLine({ phase: "retrying", attempts: 2, log: [] }, L), "다시 제출하는 중…");
  assert.equal(
    ledgerLine({ phase: "blocked", attempts: 3, log: [] }, L),
    "제출이 멈췄어요. 작업은 보관돼 있고, 문제가 풀리면 다시 제출해요.",
  );
  // 쉬는 제출은 칸이 여정의 문장으로 말한다 — null.
  assert.equal(ledgerLine({ phase: "idle", attempts: 0, log: [] }, L), null);
  assert.equal(ledgerLine(undefined, L), null);
});
