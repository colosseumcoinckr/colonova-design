import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
// `../dist` 임포트인 이유: cycle-observe · repo-core 는 형제를 `.js` 지정자로
// 부른다 — src 직접 로드는 그 지정을 못 고친다(shelf-recover 와 같은 길).
import { markAppComment } from "../dist/app-comment.js";
import { emptyLedger } from "../dist/cycle-ledger.js";
import { nextCycleAction } from "../dist/cycle-reconcile.js";
import { GitHubClient } from "../dist/github.js";
import { STASH_MESSAGE } from "../dist/repo-core.js";
import { type HandoffLike, makeScene, type Scene } from "./helpers/cycle-harness.ts";

const BRANCH = "colonova-design/20260924-1";

/** 레지스트리가 기억하는 넘긴 요청의 시험용 모양. */
function handoff(number: number): HandoffLike {
  return {
    number,
    url: `https://github.test/colonova-design/harness/pull/${number}`,
    title: "화면 작업",
    state: "open",
    branch: BRANCH,
  };
}

/** 클론에 커밋 — 도구의 자동 보관이 한 차례 지나간 모양. */
async function commit(scene: Scene, files: Record<string, string>, message: string) {
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(scene.clone.path, name), body);
  }
  await scene.git(["add", "-A"]);
  await scene.git(["commit", "-m", message]);
}

/** 사이클 브랜치에 커밋을 올리고 PR 을 여는 자리 — 넘긴 세계의 시작점. */
async function openCycle(
  scene: Scene,
  commits: Array<[Record<string, string>, string]>,
): Promise<number> {
  await scene.git(["checkout", "-b", BRANCH]);
  for (const [files, message] of commits) await commit(scene, files, message);
  await scene.git(["push", "-u", "origin", BRANCH]);
  const number = await scene.github.openPull({ head: BRANCH });
  scene.core.setCycle(BRANCH, handoff(number));
  return number;
}

test("깨끗한 클론, 사이클 없음 — 모든 수가 0이고 gitOp 가 없다", async () => {
  const scene = await makeScene();
  try {
    const snap = await scene.observe({ fetch: true });
    assert.equal(snap.gitOp, null);
    assert.equal(snap.taggedStash, null);
    assert.equal(snap.headBranch, "main");
    assert.equal(snap.registryBranch, null);
    assert.equal(snap.baseBranch, "main");
    assert.equal(snap.originBaseExists, true);
    assert.equal(snap.dirtyFiles, 0);
    assert.equal(snap.aheadOfBase, 0);
    assert.equal(snap.behindBase, 0);
    assert.equal(snap.remoteBranchExists, false);
    assert.equal(snap.localAheadOfRemote, 0);
    assert.equal(snap.remoteAheadOfLocal, 0);
    assert.equal(snap.pr, null);
    assert.equal(snap.commitsAfterPrHead, null);
    assert.deepEqual(snap.conflictFiles, []);
    assert.deepEqual(snap.markersLeft, []);
    assert.deepEqual(snap.newReviews, []);
    assert.deepEqual(snap.pendingReviews, []);
    assert.equal(snap.reviewCount, null);
    assert.equal(snap.handoffState, null);
    assert.equal(snap.githubReachable, true);
    assert.equal(snap.githubAuthExpired, false);
    // 한 번도 돌지 않은 위생은 기한이 지났다 (PLAN 단계 9) — 항목별 기한 셈은
    // cycle-hygiene.test.ts 가 본다. 시각이 모두 찍힌 원장이면 아직이다.
    assert.equal(snap.hygieneDue, true);
    const now = Date.now();
    const at = new Date(now).toISOString();
    const stamped = await scene.observe({
      now,
      ledger: {
        ...emptyLedger(),
        hygiene: { gcAt: at, fsckAt: at, pruneAt: at, assetsAt: at, moveAt: at, diskAt: at },
      },
    });
    assert.equal(stamped.hygieneDue, false);
  } finally {
    scene.dispose();
  }
});

test("커밋 안 된 변경 — dirtyFiles", async () => {
  const scene = await makeScene();
  try {
    writeFileSync(join(scene.clone.path, "screen.txt"), "수정\n");
    const snap = await scene.observe({});
    assert.equal(snap.dirtyFiles, 1);
  } finally {
    scene.dispose();
  }
});

test("사이클 없이 base 에 로컬 커밋 — aheadOfBase, 조정은 adoptStrayCommits", async () => {
  const scene = await makeScene();
  try {
    await commit(scene, { "screen.txt": "로컬\n" }, "로컬 커밋");
    const snap = await scene.observe({});
    assert.equal(snap.aheadOfBase, 1);
    assert.equal(snap.registryBranch, null);
    const decision = nextCycleAction(snap, emptyLedger());
    assert.equal(decision.action.kind, "adoptStrayCommits");
  } finally {
    scene.dispose();
  }
});

test("개발자가 base 에 올림 — behindBase, 조정은 fastForwardBase", async () => {
  const scene = await makeScene();
  try {
    await scene.dev.pushToBase({ "dev.txt": "개발자\n" }, "베이스 커밋");
    const snap = await scene.observe({ fetch: true });
    assert.equal(snap.behindBase, 1);
    assert.equal(snap.aheadOfBase, 0);
    const decision = nextCycleAction(snap, emptyLedger());
    assert.equal(decision.action.kind, "fastForwardBase");
  } finally {
    scene.dispose();
  }
});

test("사이클 브랜치의 올리지 않은 커밋 — localAheadOfRemote, 원격 브랜치 없음, 조정은 push", async () => {
  const scene = await makeScene();
  try {
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "screen.txt": "사이클\n" }, "사이클 첫 커밋");
    scene.core.setCycle(BRANCH, null);
    const snap = await scene.observe({});
    assert.equal(snap.registryBranch, BRANCH);
    assert.equal(snap.remoteBranchExists, false);
    assert.equal(snap.localAheadOfRemote, 1);
    assert.equal(snap.remoteAheadOfLocal, 0);
    const decision = nextCycleAction(snap, emptyLedger());
    assert.equal(decision.action.kind, "push");
  } finally {
    scene.dispose();
  }
});

test("개발자가 PR 브랜치에 올림 — remoteAheadOfLocal, 조정은 pullRemoteBranch", async () => {
  const scene = await makeScene();
  try {
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "screen.txt": "사이클\n" }, "사이클 첫 커밋");
    await scene.git(["push", "-u", "origin", BRANCH]);
    scene.core.setCycle(BRANCH, null);
    await scene.dev.pushToBranch(BRANCH, { "review.txt": "리뷰 중 수정\n" }, "개발자 커밋");
    const snap = await scene.observe({ fetch: true });
    assert.equal(snap.remoteBranchExists, true);
    assert.equal(snap.remoteAheadOfLocal, 1);
    assert.equal(snap.localAheadOfRemote, 0);
    const decision = nextCycleAction(snap, emptyLedger());
    assert.equal(decision.action.kind, "pullRemoteBranch");
  } finally {
    scene.dispose();
  }
});

test("PR 병합(merge) 뒤 로컬 커밋 2개 — pr merged, commitsAfterPrHead 2, 조정은 land carry", async () => {
  const scene = await makeScene();
  try {
    const number = await openCycle(scene, [[{ "screen.txt": "사이클\n" }, "사이클 첫 커밋"]]);
    await scene.github.merge(number, "merge");
    await commit(scene, { "b.txt": "둘\n" }, "두 번째");
    await commit(scene, { "c.txt": "셋\n" }, "세 번째");
    const snap = await scene.observe({ fetch: true });
    assert.equal(snap.pr?.state, "merged");
    assert.equal(snap.commitsAfterPrHead, 2);
    const decision = nextCycleAction(snap, emptyLedger());
    assert.equal(decision.action.kind, "land");
    if (decision.action.kind === "land") assert.equal(decision.action.carry, true);
  } finally {
    scene.dispose();
  }
});

test("PR 스쿼시 병합 뒤 로컬 커밋 1개 — commitsAfterPrHead 1 (스쿼시에서도 맞다)", async () => {
  const scene = await makeScene();
  try {
    const number = await openCycle(scene, [[{ "screen.txt": "사이클\n" }, "사이클 첫 커밋"]]);
    await scene.github.merge(number, "squash");
    await commit(scene, { "b.txt": "둘\n" }, "두 번째");
    const snap = await scene.observe({ fetch: true });
    assert.equal(snap.pr?.state, "merged");
    assert.equal(snap.commitsAfterPrHead, 1);
  } finally {
    scene.dispose();
  }
});

test("PR 병합, headSha 가 로컬에 없는 경우 — commitsAfterPrHead 가 0 이 아니다", async () => {
  const scene = await makeScene();
  try {
    const number = await openCycle(scene, [[{ "screen.txt": "사이클\n" }, "사이클 첫 커밋"]]);
    // 개발자가 PR 브랜치에 올린 뒤 스쿼시 병합 — 그 커밋은 베이스의 조상이 아니다.
    await scene.dev.pushToBranch(BRANCH, { "dev.txt": "개발자\n" }, "개발자 커밋");
    await scene.github.merge(number, "squash");
    // 브랜치가 다시 쓰여 병합 순간의 head 는 어느 ref 에도 닿지 않는다 — 도구의
    // 클론은 fetch 해도 그 객체를 얻지 못한다.
    await scene.dev.rewriteBranch(BRANCH, { "new.txt": "새 판\n" }, "브랜치 다시 쓰기");
    const snap = await scene.observe({ fetch: true });
    assert.equal(snap.pr?.state, "merged");
    // 넉넉한 규칙: headSha 를 못 믿으면 origin/base 기준으로 센다 — 0 이 아니다.
    assert.equal(snap.commitsAfterPrHead, 1);
  } finally {
    scene.dispose();
  }
});

test("PR 반려(close) — pr closed, commitsAfterPrHead = 브랜치 전체 커밋 수", async () => {
  const scene = await makeScene();
  try {
    const number = await openCycle(scene, [
      [{ "screen.txt": "사이클\n" }, "사이클 첫 커밋"],
      [{ "b.txt": "둘\n" }, "두 번째"],
    ]);
    scene.github.close(number);
    const snap = await scene.observe({ fetch: true });
    assert.equal(snap.pr?.state, "closed");
    assert.equal(snap.commitsAfterPrHead, 2);
  } finally {
    scene.dispose();
  }
});

test("도구 태그 stash 가 남음 — taggedStash, 손으로 만든 stash 는 건드리지 않는다", async () => {
  const scene = await makeScene();
  try {
    writeFileSync(join(scene.clone.path, "README.md"), "사용자 변경\n");
    await scene.git(["stash", "push", "-m", "사용자가 직접"]);
    const before = await scene.observe({});
    assert.equal(before.taggedStash, null);
    writeFileSync(join(scene.clone.path, "README.md"), "도구 변경\n");
    await scene.git(["stash", "push", "-m", STASH_MESSAGE]);
    const snap = await scene.observe({});
    assert.equal(snap.taggedStash, "stash@{0}");
  } finally {
    scene.dispose();
  }
});

test("병합 충돌로 멈춘 상태 — gitOp merge, conflictFiles, markersLeft; 정리 뒤 markersLeft 빔", async () => {
  const scene = await makeScene();
  try {
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "README.md": "도구 판\n" }, "도구 변경");
    await scene.dev.pushToBase({ "README.md": "개발자 판\n" }, "개발자 변경");
    await scene.git(["fetch", "origin", "main"]);
    await scene.git(["merge", "origin/main"]).catch(() => "");
    const snap = await scene.observe({});
    assert.equal(snap.gitOp, "merge");
    assert.deepEqual(snap.conflictFiles, ["README.md"]);
    assert.deepEqual(snap.markersLeft, ["README.md"]);
    // AI 가 표식을 정리하고 add 한 모양 — MERGE_HEAD 는 아직 남아 있다.
    writeFileSync(join(scene.clone.path, "README.md"), "합쳐진 판\n");
    await scene.git(["add", "README.md"]);
    const after = await scene.observe({});
    assert.equal(after.gitOp, "merge");
    assert.deepEqual(after.conflictFiles, []);
    assert.deepEqual(after.markersLeft, []);
  } finally {
    scene.dispose();
  }
});

test("pendingOp.files 의 파일도 표식 검사 범위다 — unmerged 가 아니어도", async () => {
  const scene = await makeScene();
  try {
    // stash 복원이 남긴 표식은 git 의 진행 표식이 없다 — 원장의 파일 목록이
    // 유일한 실마리다(L3 2행).
    writeFileSync(
      join(scene.clone.path, "left.txt"),
      "<<<<<<< HEAD\na\n=======\nb\n>>>>>>> stash\n",
    );
    const ledger = emptyLedger();
    ledger.pendingOp = {
      kind: "stash-pop",
      files: ["left.txt"],
      startedAt: new Date().toISOString(),
      briefs: 0,
    };
    const snap = await scene.observe({ ledger });
    assert.equal(snap.gitOp, null);
    assert.deepEqual(snap.conflictFiles, []);
    assert.deepEqual(snap.markersLeft, ["left.txt"]);
  } finally {
    scene.dispose();
  }
});

test("detached HEAD — headBranch null, 조정은 branchFromHead", async () => {
  const scene = await makeScene();
  try {
    await scene.git(["checkout", "--detach", "HEAD"]);
    const snap = await scene.observe({});
    assert.equal(snap.headBranch, null);
    const decision = nextCycleAction(snap, emptyLedger());
    assert.equal(decision.action.kind, "branchFromHead");
  } finally {
    scene.dispose();
  }
});

test("인증 만료 — pr null, githubAuthExpired; 만료된 토큰의 읽기도 pr null", async () => {
  const scene = await makeScene();
  try {
    await openCycle(scene, [[{ "screen.txt": "사이클\n" }, "사이클 첫 커밋"]]);
    const snap = await scene.observe({ deps: { githubAuthExpired: () => true } });
    assert.equal(snap.pr, null);
    assert.equal(snap.githubAuthExpired, true);
    // 전송이 401 을 내는 세계 — 관찰은 죽지 않고 pr 이 비며 githubReachable 이 꺼진다.
    scene.github.expireAuth();
    const after = await scene.observe({});
    assert.equal(after.pr, null);
    assert.equal(after.githubReachable, false);
  } finally {
    scene.dispose();
  }
});

test("새 코멘트 — newReviews · pendingReviews, 원장의 known 에 있는 id 는 빠진다", async () => {
  const scene = await makeScene();
  try {
    const number = await openCycle(scene, [[{ "screen.txt": "사이클\n" }, "사이클 첫 커밋"]]);
    const a = scene.github.addComment(number, { kind: "issue", login: "dev1", body: "버튼 위치" });
    const b = scene.github.addComment(number, { kind: "pull", login: "dev1", body: "여백" });
    // 도구 자신의 코멘트(앱의 표식이 달린 토큰 주인의 글)와 본문 없는 리뷰는 새 코멘트가 아니다.
    scene.github.addComment(number, {
      kind: "issue",
      login: "colonova-planner",
      body: markAppComment("제 코멘트"),
    });
    scene.github.addComment(number, { kind: "review", login: "dev1", body: "" });
    const snap = await scene.observe({});
    assert.deepEqual(
      snap.newReviews.map((r) => r.id),
      [a, b],
    );
    assert.deepEqual(
      snap.pendingReviews.map((r) => r.id),
      [a, b],
    );
    const decision = nextCycleAction(snap, emptyLedger());
    assert.equal(decision.action.kind, "briefReviews");
    // 원장이 아는 id 는 새 것이 아니다 — known 은 arrived 에서도 빠지고,
    // briefed 는 pending 에서 빠진다.
    const ledger = emptyLedger();
    ledger.reviews[String(number)] = { known: [a], briefed: [a], rounds: 1 };
    const again = await scene.observe({ ledger });
    assert.deepEqual(
      again.newReviews.map((r) => r.id),
      [b],
    );
    assert.deepEqual(
      again.pendingReviews.map((r) => r.id),
      [b],
    );
  } finally {
    scene.dispose();
  }
});

// ————— 승인 · 토큰 주인의 코멘트 · 자동 검사 (2026-10-07 베타 준비 분석 · W6) —————

test("승인 — 본문 있는 APPROVED 는 피드백이 아니다: 반영 턴도 라운드도 없고 pr.approved 로만 나른다", async () => {
  const scene = await makeScene();
  try {
    const number = await openCycle(scene, [[{ "screen.txt": "사이클\n" }, "사이클 첫 커밋"]]);
    scene.github.addComment(number, {
      kind: "review",
      login: "dev1",
      body: "LGTM — 좋아요",
      state: "APPROVED",
    });
    const snap = await scene.observe({});
    assert.equal(snap.pr?.approved, true);
    assert.deepEqual(snap.newReviews, []);
    assert.deepEqual(snap.pendingReviews, []);
    assert.equal(snap.reviewCount, 0, "승인은 코멘트 수에도 들지 않는다");
    assert.notEqual(nextCycleAction(snap, emptyLedger()).action.kind, "briefReviews");
    // 변경을 청한 리뷰는 승인을 지우고, 그 본문은 피드백이다. 철회된 판정과 초안은 말이 아니다.
    const asked = scene.github.addComment(number, {
      kind: "review",
      login: "dev2",
      body: "이 부분은 고쳐 주세요",
      state: "CHANGES_REQUESTED",
    });
    scene.github.addComment(number, {
      kind: "review",
      login: "dev3",
      body: "철회됨",
      state: "DISMISSED",
    });
    scene.github.addComment(number, {
      kind: "review",
      login: "dev3",
      body: "초안",
      state: "PENDING",
    });
    const after = await scene.observe({});
    assert.equal(after.pr?.approved, undefined, "변경을 청한 사람이 있으면 승인이 아니다");
    assert.deepEqual(
      after.pendingReviews.map((r) => r.id),
      [asked],
    );
  } finally {
    scene.dispose();
  }
});

test("토큰 주인의 코멘트 — 표식 없는 것은 개발자의 말이고, 앱의 표식 · 옛 앱의 글만 건너뛴다", async () => {
  const scene = await makeScene();
  try {
    const number = await openCycle(scene, [[{ "screen.txt": "사이클\n" }, "사이클 첫 커밋"]]);
    // 개발자가 자기 토큰(= 도구의 토큰 주인)으로 단 코멘트 — 옛 규칙은 모두 건너뛰었다.
    const issue = scene.github.addComment(number, {
      kind: "issue",
      login: "colonova-planner",
      body: "버튼 색을 파랑으로 바꿔 주세요",
    });
    const inline = scene.github.addComment(number, {
      kind: "pull",
      login: "colonova-planner",
      body: "여백이 좁아요",
    });
    const review = scene.github.addComment(number, {
      kind: "review",
      login: "colonova-planner",
      body: "전체적으로 한 번 더",
      state: "COMMENTED",
    });
    // 앱이 쓴 글 — 표식이 있거나(새 앱), 옛 앱이 표식 없이 남긴 모양이다.
    scene.github.addComment(number, {
      kind: "issue",
      login: "colonova-planner",
      body: markAppComment("반영했습니다 · abc1234\n\n— ColoNova Design 이 김기획 님 대신 남김"),
    });
    scene.github.addComment(number, {
      kind: "issue",
      login: "colonova-planner",
      body: "[ColoNova Design] 결제 · 김기획 님의 작업이 막혔습니다\n\n**무엇이** 푸시 밀림",
    });
    scene.github.addComment(number, {
      kind: "issue",
      login: "colonova-planner",
      body: "한마디입니다\n\n— ColoNova Design 이 김기획 님 대신 남김",
    });
    // 표식이 있어도 토큰 주인이 아닌 사람의 글은 개발자의 말이다(인용 · 복사).
    const quoted = scene.github.addComment(number, {
      kind: "issue",
      login: "dev1",
      body: markAppComment("> 인용한 말"),
    });
    const snap = await scene.observe({});
    assert.deepEqual(
      snap.pendingReviews.map((r) => r.id).sort((a, b) => a - b),
      [issue, inline, review, quoted],
    );
  } finally {
    scene.dispose();
  }
});

test("피드백 루프 없음 — 앱이 GitHub 클라이언트로 쓴 어떤 코멘트도 다음 관찰의 AI 턴이 되지 않는다", async () => {
  const scene = await makeScene();
  try {
    const number = await openCycle(scene, [[{ "screen.txt": "사이클\n" }, "사이클 첫 커밋"]]);
    const client = new GitHubClient("harness-token", scene.github);
    const to = { owner: "colonova-design", repo: "harness" };
    // 개발자의 코멘트 하나 — 이것만 AI 에게 간다.
    const dev = scene.github.addComment(number, {
      kind: "pull",
      login: "dev1",
      body: "문구를 고쳐 주세요",
    });
    // 앱이 하는 모든 쓰기: 알림 · 자동 답장(스레드와 본문) · 답하기 · 한마디 · 반려 이유 청구 · 알림 고쳐 쓰기.
    const noticeRef = await client.commentOnIssue({
      ...to,
      number,
      body: "[ColoNova Design] 결제 · 작업이 막혔습니다",
    });
    await client.updateIssueComment({ ...to, commentId: noticeRef, body: "[OK] 해결됨 — 알림" });
    await client.replyToPullComment({ ...to, number, commentId: dev, body: "고쳤습니다" });
    await client.commentOnIssue({ ...to, number, body: "답하기로 쓴 사용자의 말" });
    await client.commentOnIssue({
      ...to,
      number,
      body: "반려 이유를 남겨 주시면 AI 가 반영해 새 요청으로 다시 보냅니다. — ColoNova Design",
    });
    const snap = await scene.observe({});
    assert.deepEqual(
      snap.pendingReviews.map((r) => r.id),
      [dev],
      "앱이 쓴 코멘트는 하나도 도착하지 않는다",
    );
  } finally {
    scene.dispose();
  }
});

test("자동 검사 — 실패한 검사의 이름 · 요약 · 안내를 읽고, 브리프한 head 는 안내를 다시 읽지 않는다", async () => {
  const scene = await makeScene();
  try {
    const number = await openCycle(scene, [[{ "screen.txt": "사이클\n" }, "사이클 첫 커밋"]]);
    const head = scene.github.headShaOf(number);
    scene.github.setCheckRuns(head, [
      {
        id: 71,
        name: "build",
        status: "completed",
        conclusion: "failure",
        summary: "컴파일 오류",
        annotations: [{ path: "src/a.ts", line: 3, message: "Cannot find name 'x'" }],
      },
      { id: 72, name: "lint", status: "completed", conclusion: "success" },
    ]);
    const snap = await scene.observe({});
    assert.equal(snap.pr?.headSha, head);
    assert.equal(snap.remoteBranchSha, head, "원격 브랜치의 끝도 같이 읽는다");
    assert.equal(snap.pr?.checks?.state, "failing");
    assert.equal(snap.pr?.checks?.failingCount, 1);
    assert.equal(snap.pr?.checks?.failing[0]?.name, "build");
    assert.deepEqual(snap.pr?.checks?.failing[0]?.annotations, [
      { path: "src/a.ts", line: 3, message: "Cannot find name 'x'" },
    ]);
    assert.equal(scene.github.annotationReads, 1);
    // 판정은 이 스냅샷으로 브리프를 고른다.
    assert.equal(nextCycleAction(snap, emptyLedger()).action.kind, "briefCiFailure");
    // 이미 브리프한 head — 같은 head 의 안내를 틱마다 다시 읽지 않는다.
    const ledger = emptyLedger();
    ledger.ci = { [String(number)]: { briefed: [head] } };
    const again = await scene.observe({ ledger });
    assert.equal(again.pr?.checks?.state, "failing");
    assert.deepEqual(again.pr?.checks?.failing[0]?.annotations, []);
    assert.equal(scene.github.annotationReads, 1, "안내는 다시 읽지 않았다");
    assert.equal(scene.github.checkRunReads, 2, "검사 목록은 틱마다 읽는다(통과를 알려면)");
  } finally {
    scene.dispose();
  }
});

test("자동 검사 — 권한 없음 · 닿지 못함 · 검사 없음 · 도는 중 · 통과에서는 AI 를 깨우지 않는다", async () => {
  const scene = await makeScene();
  try {
    const number = await openCycle(scene, [[{ "screen.txt": "사이클\n" }, "사이클 첫 커밋"]]);
    const head = scene.github.headShaOf(number);
    const failingRun = { id: 81, name: "build", status: "completed", conclusion: "failure" };
    // mergeable_state 가 unstable 이어도 — 검사를 읽지 못하면 실패로 읽지 않는다.
    scene.github.setMergeableState(number, "unstable");
    scene.github.setCheckRuns(head, [failingRun]);
    const notes: string[] = [];
    const deps = { note: (what: string) => notes.push(what) };

    scene.github.setChecksAccess("forbidden");
    const denied = await scene.observe({ deps });
    assert.equal(denied.pr?.checks, undefined, "권한 없음 — 상태를 모른다");
    assert.equal(denied.pr?.mergeableState, "unstable", "mergeable_state 는 그대로 싣는다");
    assert.notEqual(nextCycleAction(denied, emptyLedger()).action.kind, "briefCiFailure");

    scene.github.setChecksAccess("error");
    const down = await scene.observe({ deps });
    assert.equal(down.pr?.checks, undefined);
    assert.deepEqual(notes, ["checks:forbidden", "checks:unavailable"], "읽지 못한 종류만 알린다");

    scene.github.setChecksAccess("ok");
    scene.github.setCheckRuns(head, []);
    const none = await scene.observe({});
    assert.equal(none.pr?.checks?.state, "none", "검사가 없는 레포");
    scene.github.setCheckRuns(head, [{ ...failingRun, status: "in_progress", conclusion: null }]);
    assert.equal((await scene.observe({})).pr?.checks?.state, "pending");
    scene.github.setCheckRuns(head, [{ ...failingRun, conclusion: "success" }]);
    const passing = await scene.observe({});
    assert.equal(passing.pr?.checks?.state, "passing");
    for (const snap of [none, passing]) {
      assert.notEqual(nextCycleAction(snap, emptyLedger()).action.kind, "briefCiFailure");
    }
  } finally {
    scene.dispose();
  }
});
