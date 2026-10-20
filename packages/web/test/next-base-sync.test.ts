import assert from "node:assert/strict";
import { test } from "node:test";
import type { RepoStatus } from "@colonova-design/protocol";
// 순수 모듈 — src 에서 곧장 읽는다(next-ci-line.test.ts 와 같은 모양).
import { baseSyncNews, baseSyncRow, baseSyncSeenOf } from "../src/next/lib/base-sync.ts";

/**
 * 받아오기(2026-10-20 사용자 요청) — 개발자가 반영한 내용은 누를 때만 받아온다. 상태 줄의 단추와 `이번 작업` 의 칸이
 * 같은 판정을 읽고, 끝난 소식은 같은 프로젝트에서 결과의 시각이 바뀐 순간에 한 번만 말한다.
 */

const at = "2026-10-20T09:00:00.000Z";
const later = "2026-10-20T09:01:00.000Z";
const repoOf = (
  baseSync: RepoStatus["baseSync"],
  attention: RepoStatus["attention"] = null,
  root = "/clone/p",
): RepoStatus => ({ root, baseSync, attention }) as RepoStatus;

test("받을 것도 요청도 없으면 숨는다 — 키가 없는 옛 데몬도 같다", () => {
  assert.deepEqual(baseSyncRow(null, false), { kind: "hidden" });
  assert.deepEqual(baseSyncRow(repoOf(undefined), false), { kind: "hidden" });
  assert.deepEqual(baseSyncRow(repoOf({ behind: 0, requested: false }), false), { kind: "hidden" });
});

test("받아올 것이 있으면 단추가 선다", () => {
  assert.deepEqual(baseSyncRow(repoOf({ behind: 3, requested: false }), false), {
    kind: "ready",
    behind: 3,
  });
});

test("누른 뒤에는 AI 작업 중이면 기다리고, 아니면 받아오는 중이다", () => {
  const requested = repoOf({ behind: 3, requested: true });
  assert.deepEqual(baseSyncRow(requested, true), { kind: "waiting" });
  assert.deepEqual(baseSyncRow(requested, false), { kind: "pulling" });
});

test("겹친 부분을 AI 가 정리하는 동안에는 단추를 다시 세우지 않는다", () => {
  const overlap = { behind: 3, requested: false, last: { at, outcome: "overlap" as const } };
  assert.deepEqual(baseSyncRow(repoOf(overlap, { kind: "ai-fixing", since: at }), false), {
    kind: "overlap",
  });
  // 정리가 멈췄다(개발자에게 알림) — 다시 누를 수 있다.
  assert.deepEqual(
    baseSyncRow(repoOf(overlap, { kind: "developer-notified", since: at, via: "pr" }), false),
    { kind: "ready", behind: 3 },
  );
});

test("끝난 소식은 같은 클론에서 결과의 시각이 바뀐 순간에만", () => {
  const done = repoOf({ behind: 0, requested: false, last: { at: later, outcome: "done" } });
  // 처음 본 값(창을 연 순간 · 연결 뒤 첫 상태)은 소식이 아니다 — 앞선 결과로 성공을 말하지 않는다.
  assert.equal(baseSyncNews(null, done), null);
  assert.equal(baseSyncNews({ root: "/clone/p", at: null }, done), "done");
  assert.equal(baseSyncNews({ root: "/clone/p", at }, done), "done");
  assert.equal(
    baseSyncNews({ root: "/clone/p", at: later }, done),
    null,
    "같은 결과는 두 번 말하지 않는다",
  );
  // 다른 프로젝트로 옮겨 그 프로젝트의 결과가 보인 것은 소식이 아니다.
  assert.equal(baseSyncNews({ root: "/clone/q", at: null }, done), null);
  assert.equal(
    baseSyncNews({ root: "/clone/p", at }, repoOf({ behind: 0, requested: false })),
    null,
  );
});

test("기억할 신원은 baseSync 를 실은 상태에서만 — 연결 중이나 옛 데몬의 상태는 기억하지 않는다", () => {
  assert.equal(baseSyncSeenOf(null), null);
  assert.equal(baseSyncSeenOf(repoOf(undefined)), null);
  assert.deepEqual(baseSyncSeenOf(repoOf({ behind: 2, requested: false })), {
    root: "/clone/p",
    at: null,
  });
  // 연결 뒤 첫 상태가 앞선 결과를 싣고 와도, 그 전에 기억한 것이 없으므로 소식이 아니다.
  const first = repoOf({ behind: 0, requested: false, last: { at, outcome: "done" } });
  assert.equal(baseSyncNews(baseSyncSeenOf(repoOf(undefined)), first), null);
});
