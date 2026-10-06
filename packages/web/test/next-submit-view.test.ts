import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-journey.test.ts 와 같은 모양).
import { type SubmitViewInput, submitView } from "../src/next/lib/submit-view.ts";

/** 평소의 열린 확인 — 사진을 받았고 보낼 파일이 있고 아무 일도 없다. */
const READY: SubmitViewInput = {
  hasSnapshot: true,
  files: 3,
  loading: false,
  readFailed: false,
  sendFailed: false,
  changed: false,
  busy: false,
  lockReason: null,
};
const view = (patch: Partial<SubmitViewInput>) => submitView({ ...READY, ...patch });

test("평소: 목록이 서고 주 단추가 눌린다 — 알림 줄은 없다", () => {
  assert.deepEqual(view({}), {
    showList: true,
    skeleton: false,
    enabled: true,
    action: "confirm",
    notices: [],
  });
});

test("읽는 중: 뼈대가 서고 목록 · 주 단추는 없다 — 읽는 중에는 이유 줄이 겹치지 않는다", () => {
  const loading = view({ hasSnapshot: false, loading: true, lockReason: "AI가 고치는 중" });
  assert.equal(loading.skeleton, true);
  assert.equal(loading.showList, false);
  assert.equal(loading.enabled, false);
  assert.deepEqual(loading.notices, []);
});

test("읽기 실패: 목록이 없고 알림 한 줄(다시 확인)만 — 단추는 잠긴다", () => {
  const failed = view({ hasSnapshot: false, readFailed: true });
  assert.equal(failed.showList, false);
  assert.equal(failed.enabled, false);
  assert.deepEqual(failed.notices, ["read"]);
});

test("보내기 실패: 목록은 그대로고 다시 제출할 수 있다(2026-10-06 겹판 조사 — 옛 판은 목록을 지웠다)", () => {
  const failed = view({ sendFailed: true });
  assert.equal(failed.showList, true);
  assert.equal(failed.enabled, true);
  assert.equal(failed.action, "retry");
  assert.deepEqual(failed.notices, ["send"]);
});

test("보내는 중: 단추는 잠기고 말이 바뀐다 — 목록은 그대로다", () => {
  const sending = view({ busy: true });
  assert.equal(sending.showList, true);
  assert.equal(sending.enabled, false);
  assert.equal(sending.action, "running");
  // 실패한 뒤 다시 보내는 중에도 `보내는 중` 이 이긴다.
  assert.equal(view({ busy: true, sendFailed: true }).action, "running");
});

test("내용이 바뀜: 옛 목록과 알림 한 줄이 서고 단추는 다시 확인 전까지 잠긴다", () => {
  const changed = view({ changed: true });
  assert.equal(changed.showList, true);
  assert.equal(changed.enabled, false);
  assert.deepEqual(changed.notices, ["changed"]);
  // 읽기 실패가 먼저다 — 목록이 없으면 바뀌었다는 말이 뜻이 없다.
  assert.deepEqual(view({ hasSnapshot: false, readFailed: true, changed: true }).notices, ["read"]);
});

test("보낼 것 없음: 사진은 받았지만 파일이 0 이면 `제출할 변경 없음` 줄이 서고 단추는 잠긴다", () => {
  const empty = view({ files: 0 });
  assert.equal(empty.enabled, false);
  assert.deepEqual(empty.notices, ["empty"]);
});

test("잠긴 이유: 여정이 잠근 동안 이유 줄이 서고 단추는 잠긴다", () => {
  const locked = view({ lockReason: "AI가 고치는 중 — 끝나면 제출할 수 있어요" });
  assert.equal(locked.enabled, false);
  assert.deepEqual(locked.notices, ["lock"]);
});

test("알림 줄의 차례: 보내기 실패 → 읽기 실패 → 바뀜 → 보낼 것 없음 → 잠금", () => {
  const all = view({ sendFailed: true, changed: true, files: 0, lockReason: "이유" });
  assert.deepEqual(all.notices, ["send", "changed", "empty", "lock"]);
});
