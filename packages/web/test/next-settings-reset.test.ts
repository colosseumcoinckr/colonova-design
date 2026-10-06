import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-settings-close.test.ts 와 같은 모양).
import { L } from "../src/next/labels.ts";
import { type ResetProject, resetScope } from "../src/next/lib/reset-scope.ts";

const calm: ResetProject = { branch: null, pendingChanges: 0, working: false, handoff: null };

test("resetScope: 지워지는 프로젝트는 등록된 전부다", () => {
  assert.deepEqual(resetScope([]), { projects: 0, unsubmitted: 0 });
  assert.deepEqual(resetScope([calm, calm]), { projects: 2, unsubmitted: 0 });
});

test("resetScope: 바뀐 파일이 있거나 AI 가 만드는 중이면 제출하지 않은 작업이다", () => {
  assert.equal(resetScope([{ ...calm, pendingChanges: 2 }]).unsubmitted, 1);
  assert.equal(resetScope([{ ...calm, working: true }]).unsubmitted, 1);
});

test("resetScope: 보관해 둔 가지가 있는데 제출이 없으면 제출하지 않은 작업이다", () => {
  assert.equal(resetScope([{ ...calm, branch: "colonova-design/me/20261006-1" }]).unsubmitted, 1);
});

test("resetScope: 열린 제출이 있으면 개발자에게 닿은 작업이라 센다지 않는다", () => {
  const open = { ...calm, branch: "colonova-design/me/20261006-1", handoff: { state: "open" } };
  assert.equal(resetScope([open]).unsubmitted, 0);
  assert.equal(resetScope([{ ...open, handoff: { state: "changes_requested" } }]).unsubmitted, 0);
  assert.equal(resetScope([{ ...open, handoff: { state: "closed" } }]).unsubmitted, 0);
});

test("resetScope: 반영된 뒤 새 사이클이 시작됐으면 그 사이클의 보관은 제출 전이다", () => {
  const merged = { ...calm, branch: "colonova-design/me/20261007-1", handoff: { state: "merged" } };
  assert.equal(resetScope([merged]).unsubmitted, 1);
  // 반영만 되고 새 가지가 없으면 남는 작업이 없다.
  assert.equal(resetScope([{ ...merged, branch: null }]).unsubmitted, 0);
});

test("resetScope: 제출 키가 없는 값도 읽는다 — 없으면 아직 제출하지 않은 것", () => {
  const bare = { branch: "b", pendingChanges: 0, working: false };
  assert.equal(resetScope([bare]).unsubmitted, 1);
  assert.equal(resetScope([{ pendingChanges: 0, working: false }]).unsubmitted, 0);
});

test("resetScope: 프로젝트마다 한 번씩만 센다", () => {
  const busy = { ...calm, branch: "b", pendingChanges: 3, working: true };
  assert.deepEqual(resetScope([busy, calm, { ...calm, pendingChanges: 1 }]), {
    projects: 3,
    unsubmitted: 2,
  });
});

test("resetCount: 부제는 실제 수와 남는 것을 말한다", () => {
  assert.equal(
    L.settings.resetCount(2, 1),
    "프로젝트 2개가 지워지고 제출하지 않은 작업 1개는 사라져요 · 이미 제출한 작업과 AI 로그인은 그대로예요",
  );
  assert.equal(
    L.settings.resetCount(2, 0),
    "프로젝트 2개가 지워져요 · 이미 제출한 작업과 AI 로그인은 그대로예요",
  );
  assert.equal(
    L.settings.resetCount(0, 0),
    "지울 프로젝트는 없어요 · 이미 제출한 작업과 AI 로그인은 그대로예요",
  );
});
