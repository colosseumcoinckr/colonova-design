import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeveloperReview } from "@colonova-design/protocol";
// `../dist` 임포트인 이유: cycle-reconcile 는 형제(budgets)를 `.js` 지정자로
// 부른다 — src 직접 로드는 그 지정을 못 고친다(revive-budget 와 같은 길).
import { BUDGETS } from "../dist/budgets.js";
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

test("11행 — 사이클 브랜치가 베이스 뒤처졌거나 PR 이 충돌 중이면 베이스를 합친다", () => {
  assert.deepEqual(nextCycleAction(snap({ behindBase: 3 }), led()).action, {
    kind: "mergeBase",
    reason: "behind",
  });
  const pr = { number: 12, state: "open" as const, headSha: "abc", mergeableState: "dirty" };
  assert.deepEqual(nextCycleAction(snap({ pr }), led()).action, {
    kind: "mergeBase",
    reason: "dirty-pr",
  });
});

test("11b 행 — 사이클 없이 곧은 클론이 뒤처졌으면 앞으로 당겨 온다", () => {
  const out = nextCycleAction(
    snap({ registryBranch: null, headBranch: "main", behindBase: 2 }),
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

test("12행 — 올라갈 커밋이 있으면 밀고, 사이클 브랜치가 원격에 없어도 민다", () => {
  assert.deepEqual(nextCycleAction(snap({ localAheadOfRemote: 1 }), led()).action, {
    kind: "push",
  });
  assert.deepEqual(nextCycleAction(snap({ remoteBranchExists: false }), led()).action, {
    kind: "push",
  });
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
  assert.equal(kindOf(nextCycleAction(snap({ ...pending, now: NOW + 60_000 }), ledger)), "push");
  // 밀림 커밋이 없으면 푸시 백오프와 무관하게 단계는 간다(PR 만 남은 세계).
  assert.deepEqual(nextCycleAction(snap(), ledger).action, { kind: "submitStep" });
});

test("14행 — 새 코멘트를 반영 브리프로 보내고 장부에 적는다", () => {
  const pr = { number: 12, state: "open" as const, headSha: "abc", mergeableState: null };
  const pending = [rev(5), rev(6)];
  const out = nextCycleAction(snap({ pr, pendingReviews: pending, newReviews: pending }), led());
  assert.deepEqual(out.action, { kind: "briefReviews", pr: 12, reviews: pending });
  assert.equal(out.attention, "ai-fixing");
  assert.deepEqual(out.ledger.reviews["12"], { known: [5, 6], briefed: [5, 6], rounds: 1 });
  // 도착 사건은 새 코멘트의 전체 객체를 싣는다.
  assert.deepEqual(out.tapeEvents, [{ kind: "review.arrived", reviews: pending }]);
});

test("14행 — 브리프가 장부 항목의 다른 필드(replied)를 지우지 않는다", () => {
  const pr = { number: 12, state: "open" as const, headSha: "abc", mergeableState: null };
  const ledger = led({ reviews: { "12": { known: [5], briefed: [5], rounds: 1, replied: [5] } } });
  const out = nextCycleAction(snap({ pr, pendingReviews: [rev(6)], newReviews: [rev(6)] }), ledger);
  assert.equal(kindOf(out), "briefReviews");
  assert.deepEqual(out.ledger.reviews["12"], {
    known: [5, 6],
    briefed: [5, 6],
    rounds: 1,
    replied: [5],
  });
});

test("14행 — PR 당 5 라운드를 다 쓰면 알림 한 번", () => {
  const pr = { number: 12, state: "open" as const, headSha: "abc", mergeableState: null };
  const shot = snap({ pr });
  let ledger = led();
  for (let i = 0; i < 5; i += 1) {
    const out = nextCycleAction({ ...shot, pendingReviews: [rev(100 + i)] }, ledger);
    assert.equal(kindOf(out), "briefReviews");
    ledger = out.ledger;
  }
  const sixth = nextCycleAction({ ...shot, pendingReviews: [rev(200)] }, ledger);
  assert.equal(kindOf(sixth), "none");
  assert.deepEqual(sixth.notices, [
    {
      op: "raise",
      key: "review:12:rounds",
      reason: "코멘트 반영이 PR 당 라운드 상한에 닿았습니다",
    },
  ]);
  assert.equal(sixth.attention, "developer-notified");
  assert.deepEqual(
    nextCycleAction({ ...shot, pendingReviews: [rev(201)] }, sixth.ledger).notices,
    [],
  );
});

/** 14b행의 재료 — 랜딩이 적어 둔, 아직 보내지 못한 반려 이유 반영 턴. */
const pendingRejection = { reasons: [{ ...rev(31), pr: 7 }], since: iso(NOW) };

test("14b행 — 보내지 못한 반려 반영 턴을 보내고 예산 review:<pr> 를 쓴다, 턴 중에는 기다린다", () => {
  const ledger = led({ reviews: { "7": { known: [], briefed: [], rounds: 0, pendingRejection } } });
  const out = nextCycleAction(snap(), ledger);
  assert.deepEqual(out.action, {
    kind: "briefRejection",
    pr: 7,
    reasons: pendingRejection.reasons,
  });
  assert.equal(out.attention, "ai-fixing");
  assert.equal(out.ledger.budgets["review:7"]?.spent, 1);
  // 기록은 판정이 지우지 않는다 — 실제로 보낸 뒤 감독자가 지운다.
  assert.deepEqual(out.ledger.reviews["7"]?.pendingRejection, pendingRejection);
  // 도는 대화 사이에 반려 턴을 끼우지 않는다 — 기다리는 판정은 예산도 쓰지 않는다.
  const busy = nextCycleAction(snap({ turnRunning: true }), ledger);
  assert.equal(kindOf(busy), "none");
  assert.equal(busy.ledger.budgets["review:7"], undefined);
});

test("14b행 — 예산 review:<pr> 가 다하면 알림 한 번을 올리고 기록을 지운다", () => {
  let ledger = led({ reviews: { "7": { known: [], briefed: [], rounds: 0, pendingRejection } } });
  for (let i = 0; i < 5; i += 1) {
    const out = nextCycleAction(snap(), ledger);
    assert.equal(kindOf(out), "briefRejection");
    ledger = out.ledger; // 대화를 못 열어 기록이 남은 세계
  }
  const sixth = nextCycleAction(snap(), ledger);
  assert.equal(kindOf(sixth), "none");
  assert.deepEqual(sixth.notices, [
    {
      op: "raise",
      key: "review:7:rejection",
      reason: "반려 이유 반영 턴을 PR 당 라운드 상한 안에 보내지 못했습니다",
    },
  ]);
  assert.equal(sixth.attention, "developer-notified");
  assert.deepEqual(sixth.ledger.reviews["7"], { known: [], briefed: [], rounds: 0 });
  assert.deepEqual(
    nextCycleAction(snap(), sixth.ledger).notices,
    [],
    "기록이 없으니 다시 올리지 않는다",
  );

  // 14행이 라운드 초과 알림으로 escalated 를 이미 세운 PR 이어도 반려 알림은 따로 선다.
  const rounded = nextCycleAction(
    snap(),
    led({
      reviews: { "7": { known: [5], briefed: [5], rounds: 5, pendingRejection } },
      budgets: { "review:7": { spent: 5, firstAt: iso(NOW), lastAt: iso(NOW), escalated: true } },
    }),
  );
  assert.deepEqual(
    rounded.notices.map((notice) => notice.key),
    ["review:7:rejection"],
  );
});

test("review:<pr>:rejection — 다음 요청이 서면 알림을 거둔다", () => {
  const notice = { via: "issue" as const, ref: 30, raisedAt: iso(NOW), count: 1 };
  const notices = { "review:7:rejection": notice };
  const resolves = (out: ReturnType<typeof nextCycleAction>) =>
    out.notices.filter((n) => n.op === "resolve").map((n) => n.key);
  // 반려 직후 — 요청이 없다. 닫힌 PR 이 곧바로 알림을 거두지 않는다.
  assert.deepEqual(resolves(nextCycleAction(snap(), led({ notices }))), []);
  // 다음 요청이 열렸다 — 반려된 작업이 개발자에게 다시 갔다.
  const next = { number: 9, state: "open" as const, headSha: "abc", mergeableState: null };
  assert.deepEqual(
    resolves(nextCycleAction(snap({ pr: next, handoffState: "open" }), led({ notices }))),
    ["review:7:rejection"],
  );
  // 인증이 만료돼 요청을 못 읽는 세계에서는 거두지 않는다.
  assert.deepEqual(
    resolves(
      nextCycleAction(
        snap({ pr: next, handoffState: "open", githubAuthExpired: true }),
        led({ notices }),
      ),
    ),
    [],
  );
});

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

// ————— 턴 중 규칙 —————

test("턴 중 — 더러운 트리는 기다리고 푸시는 간다", () => {
  assert.equal(
    kindOf(
      nextCycleAction(snap({ turnRunning: true, dirtyFiles: 2, localAheadOfRemote: 1 }), led()),
    ),
    "push",
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

test("턴 중 — 도구의 병합 충돌 동안에도 푸시는 된다(이미 커밋된 것을 올린다)", () => {
  const ledger = led({
    pendingOp: { kind: "merge", files: ["src/a.ts"], startedAt: iso(NOW), briefs: 1 },
  });
  const out = nextCycleAction(
    snap({ turnRunning: true, gitOp: "merge", markersLeft: ["src/a.ts"], localAheadOfRemote: 2 }),
    ledger,
  );
  assert.deepEqual(out.action, { kind: "push" });
  assert.equal(out.attention, "ai-fixing");
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

// ————— 푸시 백오프와 밀림 알림 —————

test("백오프 창 안에서는 푸시하지 않는다", () => {
  const ledger = led({
    push: {
      behindSince: iso(NOW - 60_000),
      attempts: 1,
      nextAttemptAt: iso(NOW + 30_000),
      lastError: "network",
    },
  });
  const out = nextCycleAction(snap({ localAheadOfRemote: 1 }), ledger);
  assert.equal(kindOf(out), "none");
  assert.deepEqual(out.notices, []); // 1시간 전 — 알림도 없다
  // 창이 지나면 다시 민다.
  const due = nextCycleAction(snap({ now: NOW + 60_000, localAheadOfRemote: 1 }), ledger);
  assert.equal(kindOf(due), "push");
});

test("1시간 밀림 — push:behind 알림을 한 번만 올린다", () => {
  const ledger = led({
    push: {
      behindSince: iso(NOW - 61 * 60_000),
      attempts: 1,
      nextAttemptAt: iso(NOW - 1_000),
      lastError: "network",
    },
  });
  const shot = snap({ localAheadOfRemote: 1 });
  const first = nextCycleAction(shot, ledger);
  assert.equal(kindOf(first), "push");
  assert.deepEqual(first.notices, [
    { op: "raise", key: "push:behind", reason: "푸시가 1시간 넘게 올라가지 못하고 있습니다" },
  ]);
  assert.equal(first.attention, "developer-notified");
  // 조정자가 올렸다면(notices 에 기록) 다시 올리지 않는다.
  const standing = {
    ...first.ledger,
    notices: { "push:behind": { via: "pr" as const, ref: 12, raisedAt: iso(NOW), count: 1 } },
  };
  const second = nextCycleAction(shot, standing);
  assert.deepEqual(second.notices, []);
});

test("인증 거절 푸시 — 다시 연결을 말하고 알림을 한 번 올린다", () => {
  const ledger = led({
    push: {
      behindSince: iso(NOW - 60_000),
      attempts: 1,
      nextAttemptAt: iso(NOW - 1_000),
      lastError: "auth",
    },
  });
  const out = nextCycleAction(snap({ localAheadOfRemote: 1 }), ledger);
  assert.equal(kindOf(out), "push");
  assert.equal(out.attention, "reconnect");
  assert.deepEqual(
    out.notices.map((n) => n.key),
    ["push:auth"],
  );
});

test("권한 거절 푸시 — 다시 연결이 아니라 개발자 알림 한 번(새 초대 파일은 해결이 아니다)", () => {
  const ledger = led({
    push: {
      behindSince: iso(NOW - 60_000),
      attempts: 1,
      nextAttemptAt: iso(NOW - 1_000),
      lastError: "permission",
    },
  });
  const shot = snap({ localAheadOfRemote: 1 });
  const out = nextCycleAction(shot, ledger);
  assert.equal(kindOf(out), "push");
  assert.notEqual(out.attention, "reconnect", "코드는 맞다 — 다시 연결을 말하지 않는다");
  assert.equal(out.attention, "developer-notified");
  assert.deepEqual(
    out.notices.map((n) => n.key),
    ["push:permission"],
  );
  // 이미 서 있으면 다시 올리지 않는다.
  const standing = {
    ...out.ledger,
    notices: { "push:permission": { via: "pr" as const, ref: 3, raisedAt: iso(NOW), count: 1 } },
  };
  assert.deepEqual(nextCycleAction(shot, standing).notices, []);
});

test("한도로 거절된 푸시 — 다시 연결도 알림도 없다(시간이 푼다)", () => {
  const ledger = led({
    push: {
      behindSince: iso(NOW - 60_000),
      attempts: 1,
      nextAttemptAt: iso(NOW - 1_000),
      lastError: "limit",
    },
  });
  const out = nextCycleAction(snap({ localAheadOfRemote: 1 }), ledger);
  assert.equal(kindOf(out), "push");
  assert.equal(out.attention, null);
  assert.deepEqual(out.notices, []);
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
  assert.deepEqual(out.notices, [
    { op: "resolve", key: "push:behind" },
    { op: "resolve", key: "push:auth" },
  ]);
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

test("review:<pr>:rounds — 그 PR 이 더 이상 열려 있지 않으면 알림을 거둔다", () => {
  const notice = { via: "pr" as const, ref: 7, raisedAt: iso(NOW), count: 2 };
  const notices = { "review:7:rounds": notice };
  // 병합된 PR — land 와 함께 알림도 거둔다.
  const merged = nextCycleAction(
    snap({ pr: { number: 7, state: "merged", headSha: "abc", mergeableState: null } }),
    led({ notices }),
  );
  assert.equal(kindOf(merged), "land");
  assert.deepEqual(merged.notices, [{ op: "resolve", key: "review:7:rounds" }]);
  // 열려 있는 동안은 그대로다 — changes_requested 도 열린 상태다.
  const open = nextCycleAction(
    snap({
      pr: { number: 7, state: "changes_requested", headSha: "abc", mergeableState: "clean" },
    }),
    led({ notices }),
  );
  assert.equal(
    open.notices.some((n) => n.op === "resolve"),
    false,
  );
  // 인증이 만료돼 pr 을 못 읽는 세계에서는 거두지 않는다.
  const blind = nextCycleAction(snap({ githubAuthExpired: true }), led({ notices }));
  assert.equal(
    blind.notices.some((n) => n.op === "resolve"),
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
const NEXT_HEAD = "b".repeat(40);

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

test("14c행 — 자동 검사가 실패했으면 AI 에게 고침 브리프를 보내고 head · 라운드를 적는다", () => {
  const checks = failingChecks(2);
  const out = nextCycleAction(ciSnap({}, { checks }), led());
  assert.deepEqual(out.action, { kind: "briefCiFailure", pr: 12, headSha: HEAD, checks });
  assert.equal(out.aiFixing, true);
  assert.equal(out.aiFixingKey, "ci");
  assert.equal(out.attention, "ai-fixing");
  assert.deepEqual(out.ledger.ci?.["12"]?.briefed, [HEAD]);
  assert.equal(out.ledger.ci?.["12"]?.at, iso(NOW));
  assert.equal(out.ledger.budgets["ci:12"]?.spent, 1);
  assert.deepEqual(out.notices, []);
});

test("14c행 — 같은 head 는 두 번 브리프하지 않는다(AI 가 하나도 고치지 못한 채 끝나도)", () => {
  const first = nextCycleAction(ciSnap({}, { checks: failingChecks() }), led());
  // AI 의 턴이 끝났다 — 보관된 것도 올라간 것도 없고 PR 의 head 도 그대로다.
  const idle = nextCycleAction(ciSnap({}, { checks: failingChecks() }), first.ledger);
  assert.equal(kindOf(idle), "none", "같은 head 에는 브리프가 다시 나가지 않는다");
  assert.equal(idle.ledger.budgets["ci:12"]?.spent, 1, "라운드도 더 쓰지 않는다");
  // 말미(ciStuckMs) 안에서는 조용하다 — 턴이 아직 시작하지 못한 순간을 「하나도 못 고침」 으로 읽지 않는다.
  assert.equal(idle.aiFixing, false);
  assert.deepEqual(idle.notices, []);
  assert.equal(idle.attention, null);
});

test("14c행 — 브리프한 head 에서 AI 가 고치는 중이면 ai-fixing 만 말한다(턴 중 · 올라가는 중)", () => {
  const first = nextCycleAction(ciSnap({}, { checks: failingChecks() }), led());
  const working = nextCycleAction(
    ciSnap({ turnRunning: true }, { checks: failingChecks() }),
    first.ledger,
  );
  assert.equal(kindOf(working), "none");
  assert.equal(working.aiFixing, true);
  assert.equal(working.aiFixingKey, "ci");
  assert.equal(working.attention, "ai-fixing");
  // 보관은 됐고 원격까지 올랐지만 PR 의 head 가 아직 따라오지 않았다 — 고친 것이 길에 있다.
  const pushed = nextCycleAction(
    ciSnap({ remoteBranchSha: NEXT_HEAD }, { checks: failingChecks() }),
    first.ledger,
  );
  assert.equal(kindOf(pushed), "none");
  assert.equal(pushed.aiFixing, true);
  assert.equal(pushed.attention, "ai-fixing");
  // 새 head 가 서면 검사가 다시 돈다 — 도는 중이면 아무 말도 하지 않는다.
  const rerun = nextCycleAction(
    ciSnap({ remoteBranchSha: NEXT_HEAD }, { headSha: NEXT_HEAD, checks: checksOf("pending") }),
    first.ledger,
  );
  assert.equal(kindOf(rerun), "none");
  assert.equal(rerun.aiFixing, false);
});

test("14c행 — AI 가 끝났는데 head 가 그대로면 말미 뒤 개발자에게 한 번 알린다", () => {
  const first = nextCycleAction(ciSnap({}, { checks: failingChecks(3) }), led());
  const later = NOW + BUDGETS.ciStuckMs + 1;
  const stuck = nextCycleAction(ciSnap({ now: later }, { checks: failingChecks(3) }), first.ledger);
  assert.equal(kindOf(stuck), "none");
  assert.equal(stuck.attention, "developer-notified");
  assert.equal(stuck.notices.length, 1);
  assert.equal(stuck.notices[0]?.op, "raise");
  assert.equal(stuck.notices[0]?.key, "ci:12:rounds");
  assert.match(stuck.notices[0]?.reason ?? "", /통과하지 못한 검사: check-0, check-1, check-2/);
  assert.ok(stuck.ledger.budgets["ci:12"]?.escalated);
  // 다음 틱 — 알림은 한 번뿐이다.
  const again = nextCycleAction(
    ciSnap({ now: later + 120_000 }, { checks: failingChecks(3) }),
    stuck.ledger,
  );
  assert.deepEqual(again.notices, []);
  assert.equal(again.attention, "developer-notified");
});

test("14c행 — 턴이 도는 중에는 새 head 도 기다린다(턴 중 아니요)", () => {
  const out = nextCycleAction(ciSnap({ turnRunning: true }, { checks: failingChecks() }), led());
  assert.equal(kindOf(out), "none");
  assert.equal(out.aiFixing, false);
  assert.equal(out.ledger.ci, undefined, "기다리는 동안 장부를 건드리지 않는다");
  assert.deepEqual(out.ledger.budgets, {});
});

test("14c행 — 사람의 코멘트가 먼저다(14행이 앞서고, 14행의 라운드가 다해도 이 행은 서지 않는다)", () => {
  const withReview = ciSnap({ pendingReviews: [rev(1)] }, { checks: failingChecks() });
  assert.equal(kindOf(nextCycleAction(withReview, led())), "briefReviews");
  // 14행 라운드를 다 썼다 — 개발자가 확인할 차례라서 AI 가 검사까지 건드리지 않는다.
  const spent = led({
    budgets: {
      "review:12": { spent: 5, firstAt: iso(NOW), lastAt: iso(NOW), escalated: true },
    },
  });
  const out = nextCycleAction(withReview, spent);
  assert.equal(kindOf(out), "none");
  assert.equal(out.ledger.ci, undefined);
  assert.equal(out.aiFixingKey, null);
});

test("14c행 — PR 당 3 라운드: 넷째 실패 head 는 브리프 없이 개발자에게 한 번만 알린다", () => {
  const heads = ["1", "2", "3", "4"].map((c) => c.repeat(40));
  let ledger = led();
  for (const head of heads.slice(0, 3)) {
    const out = nextCycleAction(
      ciSnap({ remoteBranchSha: head }, { headSha: head, checks: failingChecks() }),
      ledger,
    );
    assert.equal(kindOf(out), "briefCiFailure", head);
    ledger = out.ledger;
  }
  assert.equal(ledger.budgets["ci:12"]?.spent, 3);
  const over = nextCycleAction(
    ciSnap({ remoteBranchSha: heads[3] }, { headSha: heads[3], checks: failingChecks(2) }),
    ledger,
  );
  assert.equal(kindOf(over), "none");
  assert.equal(over.attention, "developer-notified");
  assert.equal(over.notices.filter((n) => n.op === "raise").length, 1);
  assert.equal(over.notices[0]?.key, "ci:12:rounds");
  assert.match(over.notices[0]?.reason ?? "", /3번/);
  const quiet = nextCycleAction(
    ciSnap({ remoteBranchSha: heads[3] }, { headSha: heads[3], checks: failingChecks(2) }),
    over.ledger,
  );
  assert.deepEqual(quiet.notices, [], "알림은 한 번뿐이다");
});

test("14c행 — 검사를 읽지 못했거나 없거나 도는 중이거나 통과했으면 아무것도 하지 않는다", () => {
  // 권한 없음 · 닿지 못함 — pr.checks 가 없다. mergeable_state 가 unstable · blocked 여도 AI 를 깨우지 않는다.
  for (const mergeableState of [
    "unstable",
    "blocked",
    "clean",
    "behind",
    "draft",
    "unknown",
    null,
  ]) {
    const out = nextCycleAction(ciSnap({}, { mergeableState }), led());
    assert.equal(kindOf(out), "none", String(mergeableState));
    assert.equal(out.attention, null);
    assert.equal(out.ledger.ci, undefined);
  }
  for (const state of ["none", "pending", "passing", "unknown"] as const) {
    const out = nextCycleAction(ciSnap({}, { checks: checksOf(state) }), led());
    assert.equal(kindOf(out), "none", state);
    assert.equal(out.attention, null, state);
    assert.deepEqual(out.ledger.budgets, {}, state);
  }
  // 열린 PR 이 아니거나, 연결 코드가 만료돼 GitHub 의 말을 믿지 못하는 세계.
  const merged = nextCycleAction(
    ciSnap({ handoffState: "merged" }, { state: "merged", checks: failingChecks() }),
    led(),
  );
  assert.notEqual(kindOf(merged), "briefCiFailure");
  const expired = nextCycleAction(
    ciSnap({ githubAuthExpired: true }, { checks: failingChecks() }),
    led(),
  );
  assert.equal(kindOf(expired), "none");
  assert.equal(expired.ledger.ci, undefined);
  // 변경을 청한 요청도 열린 요청이다 — 고친다.
  const asked = nextCycleAction(
    ciSnap({}, { state: "changes_requested", checks: failingChecks() }),
    led(),
  );
  assert.equal(kindOf(asked), "briefCiFailure");
});

test("14c행 — 통과하면 라운드를 지우고 서 있는 알림을 거둔다, 읽지 못한 동안은 거두지 않는다", () => {
  const standing = led({
    budgets: { "ci:12": { spent: 3, firstAt: iso(NOW), lastAt: iso(NOW), escalated: true } },
    notices: { "ci:12:rounds": { via: "pr", ref: 7, raisedAt: iso(NOW), count: 1 } },
    ci: { "12": { briefed: [HEAD], at: iso(NOW) } },
  });
  const passing = nextCycleAction(ciSnap({}, { checks: checksOf("passing") }), standing);
  assert.deepEqual(passing.notices, [{ op: "resolve", key: "ci:12:rounds" }]);
  assert.equal(passing.ledger.budgets["ci:12"], undefined, "같은 PR 의 다음 실패는 새 사건이다");
  assert.deepEqual(
    passing.ledger.ci?.["12"]?.briefed,
    [HEAD],
    "브리프한 head 의 기억은 지키지 않는다고 지우지도 않는다",
  );
  // 검사를 읽지 못한 틱 — 풀린 것이 아니라 못 보는 것이다.
  const unreadable = nextCycleAction(ciSnap({}, {}), standing);
  assert.deepEqual(unreadable.notices, []);
  // PR 이 합쳐지거나 닫히면 거둔다.
  const merged = nextCycleAction(ciSnap({ handoffState: "open" }, { state: "merged" }), standing);
  assert.ok(merged.notices.some((n) => n.op === "resolve" && n.key === "ci:12:rounds"));
  // GitHub 를 못 읽는 틱(pr 없음 · 레지스트리는 열린 요청을 안다) — 거두지 않는다.
  const blind = nextCycleAction(snap({ handoffState: "open", githubReachable: false }), standing);
  assert.deepEqual(blind.notices, []);
});

test("14c행 — 순수하다: 입력 원장은 바뀌지 않고, 장부는 PR 스무 개 · head 열 개만 남긴다", () => {
  const input = led();
  const frozen = JSON.stringify(input);
  nextCycleAction(ciSnap({}, { checks: failingChecks() }), input);
  assert.equal(JSON.stringify(input), frozen);
  let ledger = led();
  for (let i = 1; i <= 25; i += 1) {
    const head = i.toString(16).padStart(40, "0");
    const out = nextCycleAction(
      ciSnap(
        { remoteBranchSha: head },
        { number: 100 + i, headSha: head, checks: failingChecks() },
      ),
      ledger,
    );
    ledger = out.ledger;
  }
  const keys = Object.keys(ledger.ci ?? {}).map(Number);
  assert.equal(keys.length, 20);
  assert.equal(Math.min(...keys), 106, "가장 오래된 PR 의 기억부터 잊는다");
});
