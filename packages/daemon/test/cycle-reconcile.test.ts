import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeveloperReview } from "@colonova-design/protocol";
// `../dist` 임포트인 이유: cycle-reconcile 는 형제(budgets)를 `.js` 지정자로
// 부른다 — src 직접 로드는 그 지정을 못 고친다(revive-budget 와 같은 길).
import type { CiChecks } from "../dist/ci-checks.js";
import { type CycleLedger, emptyLedger } from "../dist/cycle-ledger.js";
import { type CycleSnapshot, nextCycleAction } from "../dist/cycle-reconcile.js";

const NOW = Date.parse("2026-09-24T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const BRANCH = "colonova-design/20260924-1";

/** 모든 행이 조용한 중립 스냅샷 — 시험마다 필요한 필드만 바꾼다. */
function snap(over: Partial<CycleSnapshot> = {}): CycleSnapshot {
  return {
    now: NOW,
    turnRunning: false,
    gitOp: null,
    conflictFiles: [],
    markersLeft: [],
    taggedStash: null,
    headBranch: BRANCH,
    registryBranch: BRANCH,
    baseBranch: "main",
    originBaseExists: true,
    defaultBranch: "main",
    dirtyFiles: 0,
    aheadOfBase: 0,
    behindBase: 0,
    remoteBranchExists: true,
    localAheadOfRemote: 0,
    remoteAheadOfLocal: 0,
    pr: null,
    commitsAfterPrHead: null,
    handoffState: null,
    newReviews: [],
    pendingReviews: [],
    pendingAiReviews: [],
    reviewCount: null,
    installStale: false,
    hygieneDue: false,
    githubReachable: true,
    githubAuthExpired: false,
    corruption: null,
    ...over,
  };
}

function led(over: Partial<CycleLedger> = {}): CycleLedger {
  return { ...emptyLedger(), ...over };
}

/** 시험용 개발자 코멘트 — 14행의 pendingReviews 가 싣는 모양. */
const rev = (id: number): DeveloperReview => ({
  id,
  kind: "review",
  author: "dev1",
  body: `코멘트 ${id}`,
  pr: 12,
  at: iso(NOW),
});

const kindOf = (out: { action: { kind: string } }) => out.action.kind;

// ————— 행마다 하나 —————

test("1행 — 도구가 시작하지 않은 rebase 는 중단한다", () => {
  assert.deepEqual(nextCycleAction(snap({ gitOp: "rebase" }), led()).action, {
    kind: "abortForeignOp",
    op: "rebase",
  });
  // 도구의 cherry-pick 과 종류가 같은 진행 표식은 남의 것이 아니다 — 2행으로 간다.
  const own = nextCycleAction(
    snap({ gitOp: "cherry-pick", markersLeft: ["src/a.ts"] }),
    led({
      pendingOp: { kind: "cherry-pick", files: ["src/a.ts"], startedAt: iso(NOW), briefs: 0 },
    }),
  );
  assert.equal(kindOf(own), "briefConflict");
});

test("2행 — 표식이 비었으면 도구가 마무리한다", () => {
  const out = nextCycleAction(
    snap({ gitOp: "merge", conflictFiles: ["src/a.ts"], markersLeft: [] }),
    led({ pendingOp: { kind: "merge", files: ["src/a.ts"], startedAt: iso(NOW), briefs: 1 } }),
  );
  assert.deepEqual(out.action, { kind: "finishToolOp", op: "merge" });
  assert.equal(out.attention, null);
});

test("2행 — 표식이 남았으면 AI 에게 정리 브리프를 보내고 셈을 올린다", () => {
  const ledger = led({
    pendingOp: { kind: "merge", files: ["src/a.ts"], startedAt: iso(NOW), briefs: 0 },
  });
  const out = nextCycleAction(snap({ gitOp: "merge", markersLeft: ["src/a.ts"] }), ledger);
  assert.deepEqual(out.action, { kind: "briefConflict", op: "merge", files: ["src/a.ts"] });
  assert.equal(out.attention, "ai-fixing");
  assert.equal(out.ledger.pendingOp?.briefs, 1);
  // 입력 원장의 briefs 는 그대로다.
  assert.equal(ledger.pendingOp?.briefs, 0);
});

test("2행 — stash 복원은 git 진행 표식 없이 unmerged 파일로 판다", () => {
  const ledger = led({
    pendingOp: { kind: "stash-pop", files: ["src/b.ts"], startedAt: iso(NOW), briefs: 0 },
  });
  const out = nextCycleAction(
    snap({ conflictFiles: ["src/b.ts"], markersLeft: ["src/b.ts"] }),
    ledger,
  );
  assert.deepEqual(out.action, { kind: "briefConflict", op: "stash-pop", files: ["src/b.ts"] });
});
test("2행 — stash-pop 은 표식만 남아도(add 로 unmerged 가 풀려도) 진행 중이다", () => {
  // AI 가 표식을 지우지 않은 채 git add 한 자리 — conflictFiles 는 비었지만
  // 표식이 남았으면 커밋에 구워지기 전에 다시 브리프해야 한다.
  const ledger = led({
    pendingOp: {
      kind: "stash-pop",
      files: ["src/b.ts"],
      startedAt: iso(NOW),
      briefs: 0,
      stashRef: "stash@{0}",
    },
  });
  const out = nextCycleAction(
    snap({ conflictFiles: [], markersLeft: ["src/b.ts"], taggedStash: "stash@{0}" }),
    ledger,
  );
  assert.equal(kindOf(out), "briefConflict");
});

test("0행 — 병합 흔적만 남고 git 은 끝난 상태면 원장을 치운다", () => {
  const ledger = led({
    pendingOp: { kind: "merge", files: ["src/a.ts"], startedAt: iso(NOW), briefs: 1 },
  });
  const out = nextCycleAction(snap({ gitOp: null }), ledger);
  assert.deepEqual(out.action, { kind: "clearPendingOp" });
  assert.equal(out.ledger.pendingOp, null);
});

test("0행 — stash-pop 은 그 stash 가 없어야 끝난 것이다", () => {
  // stash 가 남았는데 흔적을 지우면 3행이 다시 pop 해 같은 충돌을 다시 만든다.
  const ledger = led({
    pendingOp: {
      kind: "stash-pop",
      files: ["src/b.ts"],
      startedAt: iso(NOW),
      briefs: 0,
      stashRef: "stash@{0}",
    },
  });
  const stillThere = nextCycleAction(snap({ taggedStash: "stash@{0}" }), ledger);
  assert.equal(kindOf(stillThere), "finishToolOp"); // 표식 없음 + stash 남음 → 마무리(drop)
  const gone = nextCycleAction(snap({ taggedStash: null }), ledger);
  assert.equal(kindOf(gone), "clearPendingOp");
});

test("2행 — 충돌 브리프 두 번 뒤 세 번째는 알림 한 번, 네 번째 틱에는 알림 없음", () => {
  const ledger = led({
    pendingOp: { kind: "merge", files: ["src/a.ts"], startedAt: iso(NOW), briefs: 0 },
  });
  const shot = snap({ gitOp: "merge", markersLeft: ["src/a.ts"] });
  const first = nextCycleAction(shot, ledger);
  assert.equal(kindOf(first), "briefConflict");
  const second = nextCycleAction(shot, first.ledger);
  assert.equal(kindOf(second), "briefConflict"); // 마지막 몫
  const third = nextCycleAction(shot, second.ledger);
  assert.equal(kindOf(third), "none");
  assert.deepEqual(third.notices, [
    { op: "raise", key: "conflict:stuck", reason: "충돌 표식이 두 번의 정리 뒤에도 남아 있습니다" },
  ]);
  assert.equal(third.attention, "developer-notified");
  const fourth = nextCycleAction(shot, third.ledger);
  assert.deepEqual(fourth.notices, []);
  assert.equal(fourth.attention, "developer-notified"); // 주의는 계속 말한다
});

test("2행 — 턴이 도는 중(AI 고침)이면 none + ai-fixing", () => {
  const ledger = led({
    pendingOp: { kind: "merge", files: ["src/a.ts"], startedAt: iso(NOW), briefs: 1 },
  });
  const out = nextCycleAction(
    snap({ turnRunning: true, gitOp: "merge", markersLeft: ["src/a.ts"] }),
    ledger,
  );
  assert.deepEqual(out.action, { kind: "none" });
  assert.equal(out.attention, "ai-fixing");
});

test("3행 — 도구 태그의 stash 를 복원한다", () => {
  const out = nextCycleAction(snap({ taggedStash: "refs/stash@{0}" }), led());
  assert.deepEqual(out.action, { kind: "popParkedStash", ref: "refs/stash@{0}" });
});

test("4행 — HEAD 가 레지스트리 브랜치가 아니면 맞추고, detached 면 새로 짓는다", () => {
  assert.deepEqual(nextCycleAction(snap({ headBranch: "main" }), led()).action, {
    kind: "alignBranch",
    name: BRANCH,
  });
  const detached = nextCycleAction(snap({ headBranch: null, registryBranch: null }), led());
  assert.deepEqual(detached.action, { kind: "branchFromHead" });
});

test("5행 — 커밋 안 된 변경을 보관한다", () => {
  assert.deepEqual(nextCycleAction(snap({ dirtyFiles: 3 }), led()).action, {
    kind: "commitPending",
  });
});

test("6행 — 사이클 없이 앞선 커밋을 새 사이클로 입양한다", () => {
  const out = nextCycleAction(
    snap({ registryBranch: null, headBranch: "main", aheadOfBase: 2 }),
    led(),
  );
  assert.deepEqual(out.action, { kind: "adoptStrayCommits" });
});

test("7행 — 베이스가 사라졌으면 GitHub 기본 가지로 겨냥을 바꾼다", () => {
  const out = nextCycleAction(snap({ originBaseExists: false, defaultBranch: "develop" }), led());
  assert.deepEqual(out.action, { kind: "retargetBase", to: "develop" });
});

test("7행 — 기본 가지도 모르면 base-missing 알림을 한 번만 올린다", () => {
  const shot = snap({ originBaseExists: false, defaultBranch: null });
  const first = nextCycleAction(shot, led());
  assert.equal(kindOf(first), "none");
  assert.deepEqual(first.notices, [
    {
      op: "raise",
      key: "base-missing",
      reason: "원격에 베이스 브랜치가 없고 GitHub 의 기본 가지도 알 수 없습니다",
    },
  ]);
  assert.equal(first.attention, "developer-notified");
  assert.deepEqual(nextCycleAction(shot, first.ledger).notices, []);
});

test("8행 — 병합된 PR 을 랜딩한다", () => {
  const pr = { number: 12, state: "merged" as const, headSha: "abc1234", mergeableState: null };
  const out = nextCycleAction(snap({ pr, commitsAfterPrHead: 0 }), led());
  assert.deepEqual(out.action, {
    kind: "land",
    outcome: "merged",
    pr: 12,
    headSha: "abc1234",
    carry: false,
  });
});

test("9행 — 닫힌 PR 을 랜딩하고 남은 커밋을 이월 표시한다", () => {
  const pr = { number: 12, state: "closed" as const, headSha: "abc1234", mergeableState: null };
  const out = nextCycleAction(snap({ pr, commitsAfterPrHead: 3 }), led());
  assert.deepEqual(out.action, {
    kind: "land",
    outcome: "closed",
    pr: 12,
    headSha: "abc1234",
    carry: true,
  });
});

test("제출 취소 — 표식이 있는 닫힘은 알림 없이 withdrawn 사건 하나, 착지는 반려와 같다(2026-10-14)", () => {
  const pr = { number: 12, state: "closed" as const, headSha: "abc1234", mergeableState: null };
  const at = iso(NOW - 1000);
  const out = nextCycleAction(
    snap({ pr, handoffState: "open" }),
    led({ withdrawn: { pr: 12, at } }),
  );
  assert.deepEqual(out.tapeEvents, [{ kind: "cycle.closed", pr: 12, withdrawn: true }]);
  assert.deepEqual(out.handoffEvents, [], "스스로 한 일은 알림 · 사이드바 소식이 아니다");
  assert.equal(out.action.kind, "land");
  assert.deepEqual(out.ledger.withdrawn, { pr: 12, at }, "표식은 착지가 지운다 — 판정은 두고 간다");

  // 다른 요청의 표식은 듣지 않는다 — 그 닫힘은 반려다.
  const other = nextCycleAction(
    snap({ pr, handoffState: "open" }),
    led({ withdrawn: { pr: 9, at } }),
  );
  assert.deepEqual(other.tapeEvents, [{ kind: "cycle.closed", pr: 12 }]);
  assert.deepEqual(other.handoffEvents, [{ state: "closed", pr: 12 }]);
});

test("8행 — 인증이 만료된 GitHub 의 PR 은 믿지 않고 다시 연결을 말한다", () => {
  const pr = { number: 12, state: "merged" as const, headSha: "abc1234", mergeableState: null };
  const out = nextCycleAction(snap({ pr, githubAuthExpired: true }), led());
  assert.equal(kindOf(out), "none");
  assert.equal(out.attention, "reconnect");
});

test("10행 — 원격 브랜치가 앞서면 당겨 온다", () => {
  assert.deepEqual(nextCycleAction(snap({ remoteAheadOfLocal: 2 }), led()).action, {
    kind: "pullRemoteBranch",
  });
});

test("11행 — 받아오기를 누르면 뒤처진 사이클 브랜치나 충돌 중인 PR 에 베이스를 합친다", () => {
  assert.deepEqual(
    nextCycleAction(snap({ behindBase: 3, baseSyncRequested: true }), led()).action,
    { kind: "mergeBase", reason: "behind" },
  );
  const pr = { number: 12, state: "open" as const, headSha: "abc", mergeableState: "dirty" };
  assert.deepEqual(nextCycleAction(snap({ pr, baseSyncRequested: true }), led()).action, {
    kind: "mergeBase",
    reason: "dirty-pr",
  });
  // 턴 중이면 요청이 서 있어도 기다린다.
  assert.notEqual(
    kindOf(
      nextCycleAction(snap({ behindBase: 3, baseSyncRequested: true, turnRunning: true }), led()),
    ),
    "mergeBase",
  );
});

test("11행 — 누르기 전에는 뒤처져도 · PR 이 충돌 중이어도 합치지 않는다(2026-10-20 사용자 요청)", () => {
  assert.equal(kindOf(nextCycleAction(snap({ behindBase: 3 }), led())), "none");
  const pr = { number: 12, state: "open" as const, headSha: "abc", mergeableState: "dirty" };
  assert.equal(kindOf(nextCycleAction(snap({ pr }), led())), "none");
});

test("11b 행 — 받아오기를 누르면 사이클 없이 곧은 클론을 앞으로 당겨 온다", () => {
  assert.equal(
    kindOf(
      nextCycleAction(snap({ registryBranch: null, headBranch: "main", behindBase: 2 }), led()),
    ),
    "none",
    "누르기 전에는 당기지 않는다",
  );
  const out = nextCycleAction(
    snap({ registryBranch: null, headBranch: "main", behindBase: 2, baseSyncRequested: true }),
    led(),
  );
  assert.deepEqual(out.action, { kind: "fastForwardBase" });
  // 앞선 커밋이 있으면(6행) · 트리가 더러우면(5행) 갈라진다 — 이 행이 아니다.
  assert.equal(
    kindOf(
      nextCycleAction(
        snap({ registryBranch: null, headBranch: "main", behindBase: 2, aheadOfBase: 1 }),
        led(),
      ),
    ),
    "adoptStrayCommits",
  );
  assert.equal(
    kindOf(
      nextCycleAction(
        snap({ registryBranch: null, headBranch: "main", behindBase: 2, dirtyFiles: 1 }),
        led(),
      ),
    ),
    "commitPending",
  );
});

test("13행 — 제출 의도가 남아 있으면 다음 단계를 밟는다(턴 중에도)", () => {
  const ledger = led({ submit: { requestedAt: iso(NOW), via: "button" } });
  assert.deepEqual(nextCycleAction(snap(), ledger).action, { kind: "submitStep" });
  assert.deepEqual(nextCycleAction(snap({ turnRunning: true }), ledger).action, {
    kind: "submitStep",
  });
});

test("13행 — 단계 백오프 창 안에서는 발동하지 않고 아래 행이 돈다", () => {
  const ledger = led({
    submit: {
      requestedAt: iso(NOW),
      via: "button",
      step: "pr",
      attempts: 1,
      nextAttemptAt: iso(NOW + 30_000),
    },
  });
  // 창 안 — submitStep 이 아니라 다음 행(코멘트 반영)이 보인다.
  assert.equal(kindOf(nextCycleAction(snap(), ledger)), "none");
  // 창 밖(시간이 지났다) — 다시 다음 단계를 밟는다.
  assert.deepEqual(nextCycleAction(snap({ now: NOW + 60_000 }), ledger).action, {
    kind: "submitStep",
  });
});

test("13행 — 올라갈 커밋이 남아 있는 동안의 12행 푸시 백오프도 기다린다", () => {
  const ledger = led({
    submit: { requestedAt: iso(NOW), via: "chat" },
    push: { behindSince: iso(NOW - 1000), attempts: 1, nextAttemptAt: iso(NOW + 30_000) },
  });
  const pending = snap({ localAheadOfRemote: 2 });
  // 창 안 — 13행도 넘어가고 아래 행만 보인다.
  assert.equal(kindOf(nextCycleAction(pending, ledger)), "none");
  // 창이 지났다 — 12행 푸시가 먼저(우선순위). 제출 단계는 푸시 뒤에 이어진다.
  assert.equal(
    kindOf(nextCycleAction(snap({ ...pending, now: NOW + 60_000 }), ledger)),
    "submitStep",
  );
  // 확정 제출의 전송 백오프는 로컬의 새 보관 유무와 무관하게 지킨다.
  assert.equal(kindOf(nextCycleAction(snap(), ledger)), "none");
});

/** 14b행의 재료 — 랜딩이 적어 둔, 아직 보내지 못한 반려 이유 반영 턴. */
const pendingRejection = { reasons: [{ ...rev(31), pr: 7 }], since: iso(NOW) };

test("15행 · 16행 — 재설치와 위생", () => {
  assert.deepEqual(nextCycleAction(snap({ installStale: true }), led()).action, {
    kind: "reinstall",
  });
  assert.deepEqual(nextCycleAction(snap({ hygieneDue: true }), led()).action, { kind: "hygiene" });
});

// ————— 우선순위가 겹치는 조합 —————

test("더러운 트리 + 병합된 PR — 보관이 먼저(5행이 8행보다 앞선다)", () => {
  const pr = { number: 12, state: "merged" as const, headSha: "abc", mergeableState: null };
  assert.equal(kindOf(nextCycleAction(snap({ dirtyFiles: 2, pr }), led())), "commitPending");
});

test("병합됨 + 베이스 뒤처짐 — 랜딩이 먼저(끝난 PR 에 베이스를 합치는 건 헛수고)", () => {
  const pr = { number: 12, state: "merged" as const, headSha: "abc", mergeableState: null };
  assert.equal(kindOf(nextCycleAction(snap({ pr, behindBase: 3 }), led())), "land");
});

test("남의 rebase + 더러운 트리 — 중단이 먼저(클론의 무결성)", () => {
  assert.equal(
    kindOf(nextCycleAction(snap({ gitOp: "rebase", dirtyFiles: 5 }), led())),
    "abortForeignOp",
  );
});

test("턴 중 — 무결성 문제는 예 행도 보지 않는다", () => {
  const out = nextCycleAction(
    snap({ turnRunning: true, gitOp: "revert", localAheadOfRemote: 3 }),
    led(),
  );
  assert.deepEqual(out.action, { kind: "none" });
  assert.equal(out.attention, null);
});

test("턴 중 — 병합된 PR 의 랜딩은 턴이 끝날 때까지 기다린다", () => {
  const pr = { number: 12, state: "merged" as const, headSha: "abc", mergeableState: null };
  const out = nextCycleAction(snap({ turnRunning: true, pr }), led());
  assert.equal(kindOf(out), "none");
});

test("턴 중 — 베이스 재겨냥(7행)은 턴 중에도 된다", () => {
  const out = nextCycleAction(
    snap({ turnRunning: true, originBaseExists: false, defaultBranch: "develop" }),
    led(),
  );
  assert.equal(kindOf(out), "retargetBase");
});

test("밀림이 풀리면 서 있는 권한 거절 알림도 거둔다", () => {
  const ledger = led({
    push: {
      behindSince: iso(NOW - 90 * 60_000),
      attempts: 2,
      nextAttemptAt: iso(NOW),
      lastError: "permission",
    },
    notices: {
      "push:permission": { via: "issue" as const, ref: 4, raisedAt: iso(NOW - 1), count: 1 },
    },
  });
  const out = nextCycleAction(snap(), ledger);
  assert.ok(out.notices.some((n) => n.op === "resolve" && n.key === "push:permission"));
  assert.equal(out.ledger.push, null);
});

test("밀림이 풀리면 서 있는 푸시 알림을 지우고 원장 흔적을 치운다", () => {
  const ledger = led({
    push: {
      behindSince: iso(NOW - 90 * 60_000),
      attempts: 2,
      nextAttemptAt: iso(NOW),
      lastError: "auth",
    },
  });
  const out = nextCycleAction(snap(), ledger);
  assert.equal(kindOf(out), "none");
  assert.deepEqual(out.notices, []);
  assert.equal(out.ledger.push, null);
  assert.equal(out.attention, null);
});

// ————— 순수함 —————

test("순수함 — 같은 입력에 같은 출력, 입력 원장은 바뀌지 않는다", () => {
  const snapshot = snap({ gitOp: "merge", markersLeft: ["src/a.ts"], localAheadOfRemote: 1 });
  const ledger = led({
    pendingOp: { kind: "merge", files: ["src/a.ts"], startedAt: iso(NOW), briefs: 0 },
  });
  const keep = structuredClone(ledger);
  const first = nextCycleAction(snapshot, ledger);
  const second = nextCycleAction(snapshot, ledger);
  assert.deepEqual(first, second);
  // 돌려받은 원장을 마음껏 바꿔도 입력은 그대로다.
  first.ledger.pendingOp = null;
  first.ledger.budgets["x"] = { spent: 9, firstAt: iso(NOW), lastAt: iso(NOW), escalated: true };
  assert.deepEqual(ledger, keep);
});

// ————— 알림의 풀림 (PLAN L11) —————

test("conflict:stuck — pendingOp 가 비면 알림을 거둔다", () => {
  const notice = { via: "issue" as const, raisedAt: iso(NOW), count: 1 };
  // pendingOp 가 없는 평온한 판정 — 서 있던 알림을 거둔다.
  const out = nextCycleAction(snap(), led({ notices: { "conflict:stuck": notice } }));
  assert.deepEqual(out.notices, [{ op: "resolve", key: "conflict:stuck" }]);
  // pendingOp 가 서 있는 동안은 거두지 않는다 — 충돌이 아직 진행 중이다.
  const busy = nextCycleAction(
    snap({ gitOp: "merge", markersLeft: ["src/a.ts"] }),
    led({
      pendingOp: { kind: "merge", files: ["src/a.ts"], startedAt: iso(NOW), briefs: 0 },
      notices: { "conflict:stuck": notice },
    }),
  );
  assert.equal(
    busy.notices.some((n) => n.op === "resolve" && n.key === "conflict:stuck"),
    false,
  );
});

test("base-missing — 베이스가 원격에 돌아오면 알림을 거둔다", () => {
  const notice = { via: "issue" as const, raisedAt: iso(NOW), count: 1 };
  const out = nextCycleAction(snap(), led({ notices: { "base-missing": notice } }));
  assert.deepEqual(out.notices, [{ op: "resolve", key: "base-missing" }]);
  // 아직 없는 동안은 그대로다 — raise 는 7행의 몫.
  const missing = nextCycleAction(
    snap({ originBaseExists: false, defaultBranch: null }),
    led({ notices: { "base-missing": notice } }),
  );
  assert.equal(
    missing.notices.some((n) => n.op === "resolve" && n.key === "base-missing"),
    false,
  );
});

// ————— 손상 행 (PLAN 단계 9) —————

test("손상 행 — 무결성 행보다 앞서 재클론을 고르고, 절차와 손상을 원장에 적는다", () => {
  // 남의 rebase(1행) · 더러운 트리(5행) · 밀린 푸시(12행)가 함께 있어도 손상이 먼저다.
  const out = nextCycleAction(
    snap({
      corruption: "fatal: index file corrupt",
      gitOp: "rebase",
      dirtyFiles: 3,
      localAheadOfRemote: 2,
    }),
    led(),
  );
  assert.equal(kindOf(out), "reclone");
  assert.deepEqual(out.ledger.corrupt, { since: iso(NOW), detail: "fatal: index file corrupt" });
  assert.deepEqual(out.ledger.reclone, { at: iso(NOW), salvage: null, movedTo: null });
  assert.equal(out.ledger.budgets.reclone?.spent, 1);
});

test("손상 행 — 원장의 corrupt(fsck 가 본 것)만으로도 재클론한다", () => {
  const corrupt = { since: iso(NOW - 60_000), detail: "missing blob 7898" };
  const out = nextCycleAction(snap(), led({ corrupt }));
  assert.equal(kindOf(out), "reclone");
  assert.deepEqual(out.ledger.corrupt, corrupt, "처음 선 시각과 말을 지킨다");
});

test("손상 행 — 턴이 돌면 예 행(푸시)도 보지 않고 기다린다", () => {
  const out = nextCycleAction(
    snap({ corruption: "fatal: bad object HEAD", turnRunning: true, localAheadOfRemote: 2 }),
    led(),
  );
  assert.equal(kindOf(out), "none");
  assert.equal(out.ledger.reclone, null, "턴이 끝나기 전에는 절차를 시작하지 않는다");
});

test("손상 행 — 진행 중인 절차는 예산 없이 이어 간다(옮기기 전 → reclone, 옮긴 뒤 → restoreSalvage)", () => {
  const salvage = {
    dir: "/p/salvage/x",
    branch: BRANCH,
    bundleRef: `refs/heads/${BRANCH}`,
    patch: true,
  };
  const budgets = {
    reclone: { spent: 1, firstAt: iso(NOW), lastAt: iso(NOW), escalated: false },
  };
  const before = nextCycleAction(
    snap({ corruption: "fatal: index file corrupt" }),
    led({ budgets, reclone: { at: iso(NOW), salvage, movedTo: null } }),
  );
  assert.equal(kindOf(before), "reclone");
  assert.equal(before.ledger.budgets.reclone?.spent, 1, "예산을 두 번 쓰지 않는다");
  const after = nextCycleAction(
    snap(),
    led({ budgets, reclone: { at: iso(NOW), salvage, movedTo: "/p/repo.corrupt-x" } }),
  );
  assert.equal(kindOf(after), "restoreSalvage");
});

test("손상 행 — 하루 한 번을 다 쓰면 clone:corrupt 알림 한 번, 그 뒤로는 조용히", () => {
  const corrupt = { since: iso(NOW), detail: "fatal: index file corrupt" };
  const spent = {
    reclone: {
      spent: 1,
      firstAt: iso(NOW - 3_600_000),
      lastAt: iso(NOW - 3_600_000),
      escalated: false,
    },
  };
  const first = nextCycleAction(snap(), led({ corrupt, budgets: spent }));
  assert.equal(kindOf(first), "none");
  assert.deepEqual(first.notices, [
    { op: "raise", key: "clone:corrupt", reason: "fatal: index file corrupt" },
  ]);
  assert.equal(first.attention, "developer-notified");
  const second = nextCycleAction(snap(), first.ledger);
  assert.deepEqual(second.notices, []);
  // 하루가 지나면 새 사건 — 다시 재클론한다.
  const nextDay = nextCycleAction(snap({ now: NOW + 25 * 3_600_000 }), first.ledger);
  assert.equal(kindOf(nextDay), "reclone");
});

// ————— 14c행 — 자동 검사가 통과하지 못했다 (2026-10-07 베타 준비 분석 · W6) —————

const HEAD = "a".repeat(40);

/** 통과하지 못한 검사 n 개의 요약 — 스냅샷 pr.checks 의 모양. */
function failingChecks(count = 1): CiChecks {
  return {
    state: "failing",
    failingCount: count,
    failing: Array.from({ length: count }, (_, i) => ({
      name: `check-${i}`,
      summary: "컴파일 오류",
      annotations: [],
    })),
    total: count + 1,
  };
}
const checksOf = (state: CiChecks["state"]): CiChecks => ({
  state,
  failingCount: 0,
  failing: [],
  total: 2,
});

/** 열린 PR 의 스냅샷 — 14c행 밖의 행은 모두 조용하다. */
function ciSnap(
  over: Partial<CycleSnapshot> = {},
  pr: Partial<NonNullable<CycleSnapshot["pr"]>> = {},
) {
  return snap({
    handoffState: "open",
    remoteBranchSha: HEAD,
    pr: { number: 12, state: "open", headSha: HEAD, mergeableState: "unstable", ...pr },
    ...over,
  });
}

// ————— 14d행 — AI 리뷰어의 줄 코멘트 (2026-10-14) —————

/** 시험용 AI 리뷰어 의견 — 관찰이 pendingAiReviews 에 싣는 모양. */
const aiRev = (id: number): DeveloperReview => ({
  id,
  kind: "inline",
  author: "Codex",
  body: `[P2] 의견 ${id}`,
  pr: 12,
  path: "src/a.tsx",
  at: iso(NOW),
  source: "ai",
});

test("MVP: 피드백과 옛 대기·알림은 작업을 시작하지 않고 실제 도착 사건만 유지한다", () => {
  for (const state of ["failing", "pending", "passing", "none"] as const) {
    const ledger = led({
      reviews: { "7": { known: [], briefed: [], rounds: 0, pendingRejection } },
      notices: { "ci:12:rounds": { via: "pr", raisedAt: iso(NOW), count: 1 } },
    });
    const before = structuredClone(ledger);
    const out = nextCycleAction(
      ciSnap(
        { pendingReviews: [rev(1)], newReviews: [rev(1)], pendingAiReviews: [aiRev(2)] },
        { checks: state === "failing" ? failingChecks() : checksOf(state) },
      ),
      ledger,
    );
    assert.equal(out.action.kind, "none");
    assert.equal(out.aiFixing, false);
    assert.ok(out.tapeEvents.some((event) => event.kind === "review.arrived"));
    assert.deepEqual(out.notices, [{ op: "resolve", key: "ci:12:rounds" }]);
    assert.deepEqual(ledger, before);
  }
});
