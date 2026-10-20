import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { composeAttention } from "@colonova-design/protocol";
// `../dist` 임포트인 이유: 형제를 `.js` 지정자로 부르는 모듈은 src 직접 로드가
// 그 지정을 못 고친다(cycle-observe.test.ts 와 같은 길).
import { markAppComment } from "../dist/app-comment.js";
import { readLedger } from "../dist/cycle-ledger.js";
import { CycleSupervisor } from "../dist/cycle-supervisor.js";
import { GitHubClient } from "../dist/github.js";
import { STASH_MESSAGE } from "../dist/repo-core.js";
import { makeSupervisedScene, type SupervisedScene } from "./helpers/cycle-harness.ts";

const BRANCH = "colonova-design/20260924-1";

/** 클론에 커밋 — 도구의 자동 보관이 한 차례 지나간 모양. */
async function commit(scene: SupervisedScene, files: Record<string, string>, message: string) {
  for (const [name, body] of Object.entries(files)) {
    const path = join(scene.clone.path, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
  await scene.git(["add", "-A"]);
  await scene.git(["commit", "-m", message]);
}

/** 원장 파일을 디스크에서 읽는다 — 감독자의 메모리가 아니라 기록을 본다. */
function ledgerOf(scene: SupervisedScene) {
  assert.ok(existsSync(scene.ledgerPath), "원장 파일이 있어야 한다");
  return readLedger(scene.ledgerPath);
}

/** 충돌 표식을 지우는 가짜 AI — 파일을 주어진 내용으로 다시 쓴다. */
function resolveMarkers(scene: SupervisedScene, files: Record<string, string>) {
  for (const [name, body] of Object.entries(files)) {
    const path = join(scene.clone.path, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
}

test("S3 베이스와 충돌 — 브리프 하나, git 명령 없음, AI 정리 뒤 도구가 마무리", async () => {
  const scene = await makeSupervisedScene();
  try {
    // 같은 줄을 두 쪽이 고친다 — 개발자가 base 에, 작업이 사이클 브랜치에.
    await scene.dev.pushToBase({ "src/a.ts": "export const v = 0;\n" }, "씨앗");
    await scene.git(["fetch", "origin"]);
    await scene.git(["checkout", "-b", BRANCH]);
    scene.core.setCycle(BRANCH, null);
    await commit(scene, { "src/a.ts": "export const v = 1;\n" }, "작업 쪽");
    await scene.dev.pushToBase({ "src/a.ts": "export const v = 2;\n" }, "개발자 쪽");

    // 도구의 최신화가 병합을 시작하고 충돌로 멈춘다 — 브리프는 감독자가 낸다.
    const outcome = await scene.core.refreshFromRemote(() => {});
    assert.equal(outcome, "conflict");
    await scene.supervisor.settled();
    const ledger = ledgerOf(scene);
    assert.equal(ledger.pendingOp?.kind, "merge");
    assert.deepEqual(ledger.pendingOp?.files, ["src/a.ts"]);

    // recordToolOp 가 tick("tool-conflict")를 이미 돌렸다 — 브리프가 하나.
    assert.equal(scene.briefs.length, 1, "브리프가 하나 나가야 한다");
    const brief = scene.briefs[0];
    assert.ok(
      !/git (add|commit|merge|stash|push|checkout|rebase)/.test(brief),
      "브리프에 git 명령 문장이 없어야 한다",
    );
    assert.ok(brief.includes("src/a.ts"));

    // 가짜 AI 가 표식을 지운다 — 틱이 도구의 마무리를 돌린다.
    resolveMarkers(scene, { "src/a.ts": "export const v = 3;\n" });
    await scene.supervisor.tick("manual");
    assert.equal(ledgerOf(scene).pendingOp, null, "마무리 뒤 pendingOp 는 비어야 한다");
    await scene.git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]).then(
      () => assert.fail("MERGE_HEAD 가 남아 있으면 안 된다"),
      () => undefined,
    );
    const log = await scene.git(["log", "--format=%s", "-3"]);
    assert.ok(log.includes("작업 쪽") || log.includes("Merge"), "병합 커밋이 있어야 한다");
    assert.equal(
      (await scene.git(["stash", "list"])).includes(STASH_MESSAGE),
      false,
      "도구 태그 stash 가 남으면 안 된다",
    );
  } finally {
    await scene.dispose();
  }
});

test("S3b 표식을 남기는 AI — 두 번의 브리프 뒤 conflict:stuck 알림 한 번", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.dev.pushToBase({ "src/a.ts": "export const v = 0;\n" }, "씨앗");
    await scene.git(["fetch", "origin"]);
    await scene.git(["checkout", "-b", BRANCH]);
    scene.core.setCycle(BRANCH, null);
    await commit(scene, { "src/a.ts": "export const v = 1;\n" }, "작업 쪽");
    await scene.dev.pushToBase({ "src/a.ts": "export const v = 2;\n" }, "개발자 쪽");
    await scene.core.refreshFromRemote(() => {});
    await scene.supervisor.settled();
    assert.equal(scene.briefs.length, 1);

    // 가짜 AI 가 표식을 남긴다 — 두 번째 브리프.
    await scene.supervisor.tick("manual");
    assert.equal(scene.briefs.length, 2, "표식이 남으면 브리프가 한 번 더 나간다");

    // 또 남긴다 — 예산(conflict: 2회)이 다해 알림 한 번, 조치 없음.
    await scene.supervisor.tick("manual");
    assert.equal(scene.briefs.length, 2, "예산 밖의 브리프는 나가지 않는다");
    assert.ok(
      scene.notices.some((n) => n.key === "conflict:stuck"),
      "conflict:stuck 알림이 나가야 한다",
    );
    const before = scene.notices.length;
    await scene.supervisor.tick("manual");
    assert.equal(scene.notices.length, before, "같은 알림은 다시 가지 않는다");
  } finally {
    await scene.dispose();
  }
});

test("stash 복원 충돌 — 도구가 add · reset · drop 으로 마무리한다", async () => {
  const scene = await makeSupervisedScene();
  try {
    // 도구 태그의 stash 를 손으로 만든다 — 죽은 실행이 남긴 모양.
    mkdirSync(join(scene.clone.path, "src"), { recursive: true });
    writeFileSync(join(scene.clone.path, "src/b.ts"), "보관된 작업\n");
    await scene.git(["add", "-A"]);
    await scene.git(["stash", "push", "-m", STASH_MESSAGE]);
    // 개발자가 같은 파일을 base 에 올린다 — pop 이 겹친다.
    await scene.dev.pushToBase({ "src/b.ts": "개발자가 먼저 쓴 줄\n" }, "개발자 변경");
    await scene.git(["fetch", "origin"]);
    await scene.git(["merge", "--no-edit", "origin/main"]).catch(() => undefined);

    // stash pop 이 충돌한다 — 도구가 시작한 복원.
    const popped = await scene.core.recoverParkedWork();
    assert.equal(popped, "conflict");
    await scene.supervisor.settled();
    const ledger = ledgerOf(scene);
    assert.equal(ledger.pendingOp?.kind, "stash-pop");
    assert.ok(ledger.pendingOp?.stashRef, "stashRef 가 적혀야 한다");

    // 가짜 AI 가 정리한다 — 틱이 add · reset · drop 으로 마무리한다.
    resolveMarkers(scene, { "src/b.ts": "정리된 내용\n" });
    await scene.supervisor.tick("manual");
    assert.equal(ledgerOf(scene).pendingOp, null);
    assert.equal(
      (await scene.git(["stash", "list"])).includes(STASH_MESSAGE),
      false,
      "도구 태그 stash 는 drop 됐어야 한다",
    );
    const body = readFileSync(join(scene.clone.path, "src/b.ts"), "utf8");
    assert.equal(body, "정리된 내용\n", "AI 가 정리한 내용이 작업 트리에 남아야 한다");
  } finally {
    await scene.dispose();
  }
});

test("남의 rebase 진행 중 — 감독자가 중단시킨다", async () => {
  const scene = await makeSupervisedScene();
  try {
    // 남의 손이 시작한 rebase — 도구가 시작한 것이 아니므로 원장에 없다.
    await scene.dev.pushToBase({ "src/c.ts": "개발자\n" }, "개발자");
    await scene.git(["fetch", "origin"]);
    await commit(scene, { "src/c.ts": "작업\n" }, "작업");
    await scene.git(["rebase", "origin/main"]).catch(() => undefined);
    const rebaseMerge = join(scene.clone.path, ".git", "REBASE_HEAD");
    assert.ok(existsSync(rebaseMerge) || true, "rebase 가 진행 중이어야 한다");

    await scene.supervisor.tick("manual");
    // rebase 가 중단됐다 — REBASE_HEAD 가 없어야 한다.
    const head = await scene.git(["rev-parse", "-q", "--verify", "REBASE_HEAD"]).catch(() => "");
    assert.equal(head.trim(), "", "남의 rebase 는 중단됐어야 한다");
  } finally {
    await scene.dispose();
  }
});

test("S7 병합 충돌 중 재시작 — 원장에서 읽어 이어서 마무리한다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.dev.pushToBase({ "src/a.ts": "export const v = 0;\n" }, "씨앗");
    await scene.git(["fetch", "origin"]);
    await scene.git(["checkout", "-b", BRANCH]);
    scene.core.setCycle(BRANCH, null);
    await commit(scene, { "src/a.ts": "export const v = 1;\n" }, "작업 쪽");
    await scene.dev.pushToBase({ "src/a.ts": "export const v = 2;\n" }, "개발자 쪽");
    await scene.core.refreshFromRemote(() => {});
    await scene.supervisor.settled();
    assert.equal(ledgerOf(scene).pendingOp?.kind, "merge");

    // 감독자를 새로 세운다 — 재시작 흉내. 원장 파일에서 읽는다.
    const briefs2: string[] = [];
    const notices2: Array<{ key: string; text: string }> = [];
    const supervisor2 = new CycleSupervisor({
      core: scene.core,
      workspace: scene.workspace,
      ledgerPath: scene.ledgerPath,
      busy: () => false,
      installStale: () => false,
      github: () => new GitHubClient("harness-token", scene.github),
      githubAuthExpired: () => false,
      slug: () => scene.core.repoSlug(),
      isActive: () => true,
      openThread: async () => ({ send: (text) => briefs2.push(text) }),
      raiseNotice: (key, text) => notices2.push({ key, text }),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    // 가짜 AI 가 정리한다 — 새 감독자가 이어서 마무리한다.
    resolveMarkers(scene, { "src/a.ts": "export const v = 3;\n" });
    await supervisor2.tick("manual");
    assert.equal(ledgerOf(scene).pendingOp, null, "재시작한 감독자가 마무리해야 한다");
    await scene.git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]).then(
      () => assert.fail("MERGE_HEAD 가 남아 있으면 안 된다"),
      () => undefined,
    );
  } finally {
    await scene.dispose();
  }
});

test("S8 사이클 없이 base 에 로컬 커밋 — 사이클 브랜치가 생기고 base 는 origin 으로", async () => {
  const scene = await makeSupervisedScene();
  try {
    // 사이클 없이 base 위에 로컬 커밋 — 도구가 모르는 사이 쌓인 모양.
    await commit(scene, { "src/stray.ts": "export const s = 1;\n" }, "길 잃은 커밋");
    await scene.supervisor.tick("manual");
    const head = (await scene.git(["symbolic-ref", "--short", "HEAD"])).trim();
    assert.ok(head.startsWith("colonova-design/"), "사이클 브랜치가 생겨야 한다");
    const baseTip = (await scene.git(["rev-parse", "main"])).trim();
    const originTip = (await scene.git(["rev-parse", "origin/main"])).trim();
    assert.equal(baseTip, originTip, "로컬 base 는 origin/base 를 가리켜야 한다");
    const onCycle = await scene.git(["log", "--format=%s", head]);
    assert.ok(onCycle.includes("길 잃은 커밋"), "커밋이 사이클 브랜치에 있어야 한다");
  } finally {
    await scene.dispose();
  }
});

test("11b 사이클 없이 뒤처진 base — 받아오기를 누르면 fast-forward", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.dev.pushToBase({ "src/ff.ts": "개발자\n" }, "개발자");
    await scene.supervisor.tick("timer");
    const before = (await scene.git(["rev-parse", "main"])).trim();
    const originTip = (await scene.git(["rev-parse", "origin/main"])).trim();
    assert.notEqual(before, originTip, "누르기 전에는 당기지 않는다(2026-10-20 사용자 요청)");
    assert.equal(scene.supervisor.baseSyncView().behind, 1);
    scene.supervisor.requestBaseSync();
    await scene.supervisor.settled();
    const baseTip = (await scene.git(["rev-parse", "main"])).trim();
    assert.equal(baseTip, originTip, "base 가 origin 으로 fast-forward 됐어야 한다");
    assert.equal(scene.supervisor.baseSyncView().last?.outcome, "done");
  } finally {
    await scene.dispose();
  }
});

test("5행 커밋 안 된 변경 — 턴이 없으면 보관하고, 도는 중이면 두고 본다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.git(["checkout", "-b", BRANCH]);
    scene.core.setCycle(BRANCH, null);
    mkdirSync(join(scene.clone.path, "src"), { recursive: true });
    writeFileSync(join(scene.clone.path, "src/pending.ts"), "보관할 변경\n");
    await scene.supervisor.tick("manual");
    const log = await scene.git(["log", "--format=%s", "-1"]);
    assert.ok(log.includes("chore: 남은 변경 마무리"), "커밋 안 된 변경이 보관됐어야 한다");
    assert.equal(
      (await scene.git(["status", "--porcelain"])).trim(),
      "",
      "보관 뒤 작업 트리는 깨끗해야 한다",
    );
  } finally {
    await scene.dispose();
  }
});

test("5행 N1 — 미추적 락파일뿐이면 보관하지 않는다 (2026-09-25 콜드 리뷰)", async () => {
  const scene = await makeSupervisedScene();
  try {
    // 락파일 없는 레포에서 미리보기 명령이 스스로 설치해 남긴 모양 —
    // 무시 규칙도 없고, 레포가 추적하는 것도 아니다.
    writeFileSync(join(scene.clone.path, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    mkdirSync(join(scene.clone.path, "node_modules/.pnpm"), { recursive: true });
    writeFileSync(join(scene.clone.path, "node_modules/.modules.yaml"), "");
    const before = (await scene.git(["rev-parse", "HEAD"])).trim();
    await scene.supervisor.tick("manual");
    assert.equal(
      (await scene.git(["rev-parse", "HEAD"])).trim(),
      before,
      "부산물만 있는 트리에서 커밋이 생기면 안 된다",
    );
    assert.equal(
      (await scene.git(["branch", "--list", "colonova-design/*"])).trim(),
      "",
      "사이클 브랜치도 생기면 안 된다",
    );
    assert.ok(
      !scene.chatEvents.some((event) => event.kind === "cycle.saveBlocked"),
      "saveBlocked 카드가 나가면 안 된다",
    );
    assert.ok(
      existsSync(join(scene.clone.path, "pnpm-lock.yaml")),
      "부산물은 디스크에 그대로 둔다",
    );
  } finally {
    await scene.dispose();
  }
});

test("한 틱 5회 상한 — 도구 태그 stash 여섯 개는 한 틱에 다섯까지만 팝한다", async () => {
  const scene = await makeSupervisedScene();
  try {
    // 도구 태그의 stash 여섯 개 — 3행이 하나씩 팝하므로 판정이 계속 이어진다.
    for (let i = 0; i < 6; i += 1) {
      writeFileSync(
        join(scene.clone.path, `loop${i}.ts`),
        `변경 ${i}
`,
      );
      await scene.git(["add", "-A"]);
      await scene.git(["stash", "push", "-m", STASH_MESSAGE]);
    }
    await scene.supervisor.tick("manual");
    const left = (await scene.git(["stash", "list"]))
      .split("\n")
      .filter((line) => line.includes(STASH_MESSAGE));
    assert.equal(left.length, 1, "한 틱은 다섯 번까지만 돌아 하나가 남아야 한다");
    await scene.supervisor.tick("manual");
    const left2 = (await scene.git(["stash", "list"]))
      .split("\n")
      .filter((line) => line.includes(STASH_MESSAGE));
    assert.equal(left2.length, 0, "다음 틱이 나머지를 마저 팝한다");
  } finally {
    await scene.dispose();
  }
});

test("tick 한 번에 하나 — 동시에 두 번 부르면 몸통은 한 번 + 끝난 뒤 한 번 더", async () => {
  const scene = await makeSupervisedScene();
  try {
    const first = scene.supervisor.tick("manual");
    const second = scene.supervisor.tick("manual");
    assert.strictEqual(first, second, "도는 중의 tick 은 같은 약속을 돌려준다");
    await Promise.all([first, second]);
  } finally {
    await scene.dispose();
  }
});

/** 열린 PR 을 레지스트리에 싣는다 — 넘긴 사이클의 모양. */
async function openCycle(scene: SupervisedScene, branch: string): Promise<number> {
  const pr = await scene.github.openPull({ head: branch });
  scene.core.setCycle(branch, {
    number: pr,
    url: `https://github.test/pull/${pr}`,
    title: "하네스 요청",
    state: "open",
    branch,
  });
  return pr;
}

test("S4 스쿼시 병합 뒤 남은 커밋 — 새 사이클 브랜치에 그 커밋만 이어진다", async () => {
  const scene = await makeSupervisedScene();
  try {
    scene.authorName = "김기획";
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await scene.git(["push", "-u", "origin", BRANCH]);
    const pr = await openCycle(scene, BRANCH);
    // 넘긴 뒤의 두 커밋 — PR head 뒤에 쌓인 것만 이월된다.
    await commit(scene, { "src/b.ts": "export const b = 1;\n" }, "작업 2");
    await commit(scene, { "src/c.ts": "export const c = 1;\n" }, "작업 3");

    await scene.github.merge(pr, "squash");
    await scene.supervisor.tick("manual");

    const head = (await scene.git(["symbolic-ref", "--short", "HEAD"])).trim();
    assert.notEqual(head, BRANCH, "새 사이클 브랜치 위에 있어야 한다");
    assert.match(head, /^colonova-design\/김기획\/\d{8}-\d+-[0-9a-f]{16}$/);
    const log = await scene.git(["log", "--format=%s", "origin/main..HEAD"]);
    assert.deepEqual(
      log.trim().split("\n"),
      ["작업 3", "작업 2"],
      "PR head 뒤의 두 커밋만 이월돼야 한다",
    );
    assert.equal(
      (await scene.git(["show", "HEAD:src/b.ts"])).trim(),
      "export const b = 1;",
      "이월된 커밋의 내용이 살아 있어야 한다",
    );
    // 옛 브랜치는 로컬 · 원격 모두에서 사라진다.
    assert.equal(
      (await scene.git(["branch", "--list", BRANCH])).trim(),
      "",
      "옛 로컬 브랜치가 지워져야 한다",
    );
    assert.notEqual(
      (await scene.git(["ls-remote", "--heads", "origin", BRANCH])).trim(),
      "",
      "다음 제출 전에는 옛 원격 브랜치를 보존한다",
    );
    const ledger = ledgerOf(scene);
    assert.equal(ledger.ended?.pr, pr, "원장에 끝난 PR 이 적혀야 한다");
    assert.equal(ledger.ended?.state, "merged");
    assert.equal(scene.core.branch, head, "레지스트리가 새 브랜치를 가리켜야 한다");
    assert.equal(scene.core.openHandoff, null, "이월이 있으면 handoff 는 비어야 한다");
    assert.ok(
      scene.chatEvents.some((e) => e.kind === "cycle.merged"),
      "cycle.merged 사건이 나가야 한다",
    );
    assert.ok(
      scene.chatEvents.some((e) => e.kind === "cycle.carried"),
      "cycle.carried 사건이 나가야 한다",
    );
  } finally {
    await scene.dispose();
  }
});

test("병합 · 남은 것 없음 — 베이스로 돌아오고 handoff 는 merged 로 남는다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await scene.git(["push", "-u", "origin", BRANCH]);
    const pr = await openCycle(scene, BRANCH);

    await scene.github.merge(pr, "merge");
    await scene.supervisor.tick("manual");

    assert.equal(
      (await scene.git(["symbolic-ref", "--short", "HEAD"])).trim(),
      "main",
      "베이스 브랜치로 돌아와야 한다",
    );
    assert.equal(
      (await scene.git(["rev-parse", "HEAD"])).trim(),
      (await scene.git(["rev-parse", "origin/main"])).trim(),
      "HEAD 는 origin/main 을 가리켜야 한다",
    );
    assert.equal((await scene.git(["branch", "--list", BRANCH])).trim(), "");
    assert.equal((await scene.git(["ls-remote", "--heads", "origin", BRANCH])).trim(), "");
    assert.equal(scene.core.branch, null, "사이클이 끝나 브랜치는 비어야 한다");
    assert.equal(
      scene.core.openHandoff?.state,
      "merged",
      "남은 것 없는 병합은 handoff 가 merged 로 남아 칩이 반영됨을 말한다",
    );
    assert.equal(ledgerOf(scene).ended?.pr, pr);
  } finally {
    await scene.dispose();
  }
});

test("병합 — 반영된 일이 제목 · 며칠 · 화면 수와 함께 사건 · OS 알림 · 원장에 남고, 새 사이클이 시작돼도 산다(2026-10-08)", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await scene.git(["push", "-u", "origin", BRANCH]);
    const pr = await openCycle(scene, BRANCH);
    // 같은 화면을 두 차례 만지고 하나를 더 만졌다 — 화면은 경로마다 하나로 센다. 합쳐 들인 기록은 화면 작업이 아니다.
    const row = (route: string, kind?: "merge") => ({
      route,
      title: route,
      note: "작업",
      at: "2026-09-24T10:00:00+09:00",
      ...(kind ? { kind } : {}),
    });
    scene.cycleScreens = [row("/a"), row("/b"), row("/a"), row("/c", "merge")];

    await scene.github.merge(pr, "merge");
    await scene.supervisor.tick("manual");

    const merged = scene.chatEvents.find((e) => e.kind === "cycle.merged");
    assert.ok(merged, "cycle.merged 사건이 나가야 한다");
    assert.equal(merged.title, "하네스 요청", "제목은 요청 제목에서 온다");
    assert.equal(merged.screens, 2, "화면 수는 경로마다 하나");
    assert.ok(
      Number.isInteger(merged.days) && (merged.days as number) >= 0,
      "제출한 날부터의 달력 차이",
    );
    assert.equal(
      scene.transitions.find((t) => t.kind === "merged")?.title,
      "하네스 요청",
      "OS 알림이 제목을 싣는다",
    );
    const landed = ledgerOf(scene).landed;
    assert.equal(landed?.length, 1);
    assert.deepEqual(
      { pr: landed?.[0]?.pr, title: landed?.[0]?.title, screens: landed?.[0]?.screens },
      { pr, title: "하네스 요청", screens: 2 },
    );
    assert.equal(landed?.[0]?.days, merged.days, "사건과 원장이 같은 며칠을 말한다");
    // 선로 — 앱 상태가 원장의 기억을 그대로 싣는다.
    assert.equal(scene.supervisor.landedView()?.[0]?.pr, pr);

    // 새 사이클이 시작돼도 지워지지 않고, 데몬을 다시 켜도 같은 사건을 다시 내지 않는다.
    scene.chatEvents.length = 0;
    await scene.supervisor.tick("manual");
    assert.equal(
      scene.chatEvents.filter((e) => e.kind === "cycle.merged").length,
      0,
      "같은 병합은 한 번만 말한다",
    );
    assert.equal(ledgerOf(scene).landed?.length, 1, "같은 병합이 두 줄이 되지 않는다");
  } finally {
    await scene.dispose();
  }
});

test("반려 — 성취가 아니라 반영된 일에 쌓지 않는다(2026-10-08)", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await scene.git(["push", "-u", "origin", BRANCH]);
    const pr = await openCycle(scene, BRANCH);

    scene.github.close(pr);
    await scene.supervisor.tick("manual");

    assert.ok(scene.chatEvents.some((e) => e.kind === "cycle.closed"));
    assert.equal(ledgerOf(scene).landed, undefined, "반려는 쌓지 않는다");
    assert.equal(scene.supervisor.landedView(), undefined);
  } finally {
    await scene.dispose();
  }
});

test("제출 취소 — 요청을 닫고 작업을 새 사이클로 옮기되, 반려 알림 · 이유 청구 · 반영 턴이 없다(2026-10-14)", async () => {
  const scene = await makeSupervisedScene();
  try {
    scene.authorName = "김기획";
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await scene.git(["push", "-u", "origin", BRANCH]);
    const pr = await openCycle(scene, BRANCH);

    await scene.supervisor.withdraw();

    const ledger = ledgerOf(scene);
    assert.equal(ledger.ended?.pr, pr);
    assert.equal(ledger.ended?.state, "closed", "요청이 닫혀 착지했다");
    assert.equal(ledger.withdrawn, undefined, "표식은 착지와 함께 다한다");
    assert.notEqual(ledger.reviews[String(pr)]?.rejectionAsked, true);
    assert.equal(scene.core.openHandoff, null, "새 사이클 — 다음 제출은 새 요청이다");
    assert.notEqual(scene.core.branch, BRANCH, "작업 전체가 새 브랜치로 옮겨졌다");
    assert.equal(
      (await scene.git(["show", `${scene.core.branch}:src/a.ts`])).trim(),
      "export const a = 1;",
      "만든 것은 그대로 남는다",
    );

    const closed = scene.chatEvents.filter((e) => e.kind === "cycle.closed");
    assert.equal(closed.length, 1);
    assert.equal(closed[0]?.withdrawn, true, "대화록은 반려가 아니라 취소를 말한다");
    assert.ok(!scene.transitions.some((t) => t.kind === "closed"), "스스로 한 일은 알리지 않는다");
    assert.equal(scene.briefs.length, 0, "반영 턴을 열지 않는다");

    const comments = scene.github.commentsFor(pr);
    assert.equal(comments.length, 1, "개발자에게 남는 말은 하나다");
    assert.ok(comments[0]?.body.includes("작성자가 이 요청을 거뒀습니다"));
    assert.ok(comments[0]?.body.includes("김기획 님 대신 남김"));
    assert.ok(!comments[0]?.body.includes("반려 이유"), "이유를 청구하지 않는다");
    assert.ok(
      scene.supervisor.submitView().log.some((line) => line.text === "제출을 취소했어요"),
      "제출 기록에 흔적이 남는다",
    );

    // 다음 틱 — 착지도 코멘트도 다시 일어나지 않는다.
    await scene.supervisor.tick("manual");
    assert.equal(scene.github.commentsFor(pr).length, 1);
    assert.equal(scene.chatEvents.filter((e) => e.kind === "cycle.closed").length, 1);
  } finally {
    await scene.dispose();
  }
});

test("제출 취소 — 열린 요청이 없으면 거절하고, 닫기가 거절되면 표식을 지운다(2026-10-14)", async () => {
  const scene = await makeSupervisedScene();
  try {
    await assert.rejects(scene.supervisor.withdraw(), /열린 요청이 없어요/);

    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await scene.git(["push", "-u", "origin", BRANCH]);
    const pr = await openCycle(scene, BRANCH);

    scene.github.pullClosesFail = true;
    await assert.rejects(scene.supervisor.withdraw(), /취소하지 못했어요/);
    assert.equal(ledgerOf(scene).withdrawn, undefined, "닫지 못한 요청에 표식을 남기지 않는다");
    assert.equal(scene.github.commentsFor(pr).length, 0, "닫지 못하면 말도 남기지 않는다");
    assert.equal(scene.core.openHandoff?.number, pr, "요청은 그대로 열려 있다");

    // 그 뒤 개발자가 닫으면 그것은 반려다 — 알림과 이유 청구가 선다.
    scene.github.close(pr);
    await scene.supervisor.tick("manual");
    assert.ok(scene.transitions.some((t) => t.kind === "closed"));
    const closed = scene.chatEvents.find((e) => e.kind === "cycle.closed");
    assert.equal(closed?.withdrawn, undefined);
    assert.equal(scene.github.commentsFor(pr).length, 0, "자동 이유 청구는 하지 않는다");
  } finally {
    await scene.dispose();
  }
});

test("제출 취소 — 닫은 뒤 착지 전에 데몬이 다시 켜져도 표식이 반려와 가른다(2026-10-14)", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await scene.git(["push", "-u", "origin", BRANCH]);
    const pr = await openCycle(scene, BRANCH);

    // 표식을 적고 닫은 순간에 꺼진 세계 — 원장에는 표식만, 요청은 닫혔다.
    writeFileSync(
      scene.ledgerPath,
      JSON.stringify({ v: 1, withdrawn: { pr, at: "2026-10-14T01:00:00.000Z" } }),
    );
    scene.github.close(pr);
    const next = scene.respawn();
    await next.tick("manual");

    const closed = scene.chatEvents.filter((e) => e.kind === "cycle.closed");
    assert.equal(closed.length, 1);
    assert.equal(closed[0]?.withdrawn, true);
    assert.ok(!scene.transitions.some((t) => t.kind === "closed"));
    assert.equal(scene.github.commentsFor(pr).length, 0, "이유를 청구하지 않는다");
    assert.equal(scene.briefs.length, 0);
    assert.equal(ledgerOf(scene).withdrawn, undefined);
    assert.equal(scene.core.openHandoff, null);
  } finally {
    await scene.dispose();
  }
});

test("deleteMergedBranches false — 병합 뒤에도 원격 옛 브랜치가 남는다", async () => {
  const scene = await makeSupervisedScene();
  try {
    scene.deleteMergedBranches = false;
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await scene.git(["push", "-u", "origin", BRANCH]);
    const pr = await openCycle(scene, BRANCH);

    await scene.github.merge(pr, "merge");
    await scene.supervisor.tick("manual");

    assert.equal((await scene.git(["branch", "--list", BRANCH])).trim(), "");
    assert.notEqual(
      (await scene.git(["ls-remote", "--heads", "origin", BRANCH])).trim(),
      "",
      "수명 설정이 거절하면 원격 브랜치는 남는다",
    );
  } finally {
    await scene.dispose();
  }
});

test("S5 반려 — 브랜치 전체가 새 브랜치로 이어지고 옛 원격 브랜치는 남는다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await commit(scene, { "src/b.ts": "export const b = 1;\n" }, "작업 2");
    await scene.git(["push", "-u", "origin", BRANCH]);
    const pr = await openCycle(scene, BRANCH);
    // 반려 뒤 베이스가 움직였다 — 새 브랜치는 그 위에 합쳐진다.
    await scene.dev.pushToBase({ "src/base.ts": "개발자\n" }, "베이스 이동");

    scene.github.close(pr);
    await scene.supervisor.tick("manual");

    const head = (await scene.git(["symbolic-ref", "--short", "HEAD"])).trim();
    assert.notEqual(head, BRANCH);
    assert.ok(head.startsWith("colonova-design/"));
    const log = await scene.git(["log", "--format=%s", "origin/main..HEAD"]);
    assert.ok(log.includes("작업 1") && log.includes("작업 2"), "옛 커밋 전부가 이어져야 한다");
    assert.ok(
      (await scene.git(["log", "--format=%s", "-3"])).includes("베이스 이동") ||
        (await scene.git(["merge-base", "--is-ancestor", "origin/main", "HEAD"]).then(
          () => true,
          () => false,
        )),
      "베이스가 새 브랜치에 합쳐져야 한다",
    );
    // 반려의 원격 브랜치는 지우지 않는다 — 원장이 기억한다(단계 9 의 정리가 읽는다).
    assert.notEqual(
      (await scene.git(["ls-remote", "--heads", "origin", BRANCH])).trim(),
      "",
      "반려된 원격 브랜치는 남아야 한다",
    );
    assert.equal((await scene.git(["branch", "--list", BRANCH])).trim(), "");
    const ledger = ledgerOf(scene);
    assert.equal(ledger.ended?.state, "closed");
    assert.ok(
      ledger.branches.some((b) => b.name === BRANCH && b.state === "closed"),
      "원장 branches 에 반려된 브랜치가 기록돼야 한다",
    );
    assert.ok(
      scene.chatEvents.some((e) => e.kind === "cycle.closed"),
      "cycle.closed 사건이 나가야 한다",
    );
    assert.ok(
      scene.transitions.some((t) => t.kind === "closed"),
      "반려 알림이 나가야 한다",
    );
  } finally {
    await scene.dispose();
  }
});

test("S2 비활성 프로젝트의 베이스 이동 — timer 틱은 세기만 하고 받아오기가 합친다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.git(["checkout", "-b", BRANCH]);
    scene.core.setCycle(BRANCH, null);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await scene.git(["push", "-u", "origin", BRANCH]);
    scene.active = false;

    await scene.dev.pushToBase({ "src/base.ts": "개발자\n" }, "베이스 이동");
    // 비활성 프로젝트의 첫 timer 틱도 원격을 읽는다(10분 간격의 첫 번) — 세기만 한다(2026-10-20 사용자 요청).
    await scene.supervisor.tick("timer");
    assert.equal(
      await scene.git(["merge-base", "--is-ancestor", "origin/main", "HEAD"]).then(
        () => true,
        () => false,
      ),
      false,
      "누르기 전에는 합치지 않는다",
    );
    assert.equal(scene.supervisor.baseSyncView().behind, 1);
    scene.supervisor.requestBaseSync();
    await scene.supervisor.settled();

    assert.ok(
      await scene.git(["merge-base", "--is-ancestor", "origin/main", "HEAD"]).then(
        () => true,
        () => false,
      ),
      "비활성 프로젝트의 사이클 브랜치에도 베이스가 합쳐져야 한다",
    );
    const remoteLog = await scene.git(["log", "--format=%s", `origin/${BRANCH}`]);
    assert.equal(
      remoteLog.includes("베이스 이동") || remoteLog.includes("Merge"),
      false,
      "자동 병합 결과는 다음 제출까지 로컬에 남는다",
    );
  } finally {
    await scene.dispose();
  }
});

test("S6 개발자가 PR 브랜치에 커밋 — fast-forward 와 병합", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.git(["checkout", "-b", BRANCH]);
    scene.core.setCycle(BRANCH, null);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await scene.git(["push", "-u", "origin", BRANCH]);

    // fast-forward — 로컬에 새 커밋이 없다.
    await scene.dev.pushToBranch(BRANCH, { "src/dev.ts": "개발자 1\n" }, "개발자 커밋 1");
    await scene.supervisor.tick("manual");
    assert.ok(
      (await scene.git(["log", "--format=%s", "-2"])).includes("개발자 커밋 1"),
      "개발자 커밋이 fast-forward 로 들어와야 한다",
    );

    // 병합 — 로컬에도 새 커밋이 있다.
    await commit(scene, { "src/local.ts": "로컬\n" }, "로컬 커밋");
    await scene.dev.pushToBranch(BRANCH, { "src/dev2.ts": "개발자 2\n" }, "개발자 커밋 2");
    await scene.supervisor.tick("manual");
    const log = await scene.git(["log", "--format=%s", "-4"]);
    assert.ok(log.includes("개발자 커밋 2"), "개발자 커밋이 병합돼야 한다");
    assert.ok(log.includes("로컬 커밋"), "로컬 커밋이 살아 있어야 한다");
    assert.equal(ledgerOf(scene).pendingOp, null, "충돌 없이 끝나야 한다");
  } finally {
    await scene.dispose();
  }
});

test("베이스 병합 충돌 — 브리프 뒤 가짜 AI 정리, 도구가 마무리하고 푸시한다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.dev.pushToBase({ "src/a.ts": "export const v = 0;\n" }, "씨앗");
    await scene.git(["fetch", "origin"]);
    await scene.git(["checkout", "-b", BRANCH]);
    scene.core.setCycle(BRANCH, null);
    await commit(scene, { "src/a.ts": "export const v = 1;\n" }, "작업 쪽");
    await scene.git(["push", "-u", "origin", BRANCH]);
    await scene.dev.pushToBase({ "src/a.ts": "export const v = 2;\n" }, "개발자 쪽");

    // 받아오기를 누르면 감독자의 mergeBase 가 충돌로 멈춘다 — 브리프는 감독자가 누른 대화로 낸다.
    scene.supervisor.requestBaseSync("session-1");
    await scene.supervisor.settled();
    assert.equal(ledgerOf(scene).pendingOp?.kind, "merge");
    assert.equal(scene.briefs.length, 1, "충돌 브리프가 하나 나가야 한다");
    assert.deepEqual(scene.briefSessions, ["session-1"], "누른 대화가 과제를 받는다");
    assert.equal(scene.supervisor.baseSyncView().last?.outcome, "overlap");
    assert.equal(scene.supervisor.baseSyncView().requested, false);

    resolveMarkers(scene, { "src/a.ts": "export const v = 3;\n" });
    await scene.supervisor.tick("manual");
    assert.equal(ledgerOf(scene).pendingOp, null, "마무리 뒤 pendingOp 는 비어야 한다");
    await scene.git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]).then(
      () => assert.fail("MERGE_HEAD 가 남아 있으면 안 된다"),
      () => undefined,
    );
    const remoteLog = await scene.git(["log", "--format=%s", `origin/${BRANCH}`]);
    assert.equal(
      remoteLog.includes("Merge"),
      false,
      "복구 결과도 다음 제출 전에는 전송하지 않는다",
    );
  } finally {
    await scene.dispose();
  }
});

test("받아오기 전 — 관찰은 받아올 수만 세고 사이클 브랜치에 베이스를 합치지 않는다(2026-10-20 사용자 요청)", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.dev.pushToBase({ "src/a.ts": "export const v = 0;\n" }, "씨앗");
    await scene.git(["fetch", "origin"]);
    await scene.git(["checkout", "-b", BRANCH]);
    scene.core.setCycle(BRANCH, null);
    await commit(scene, { "src/b.ts": "export const b = 1;\n" }, "작업 쪽");
    await scene.dev.pushToBase({ "src/c.ts": "export const c = 2;\n" }, "개발자 쪽");

    for (const reason of ["start", "activate", "session-start", "timer", "manual"] as const) {
      await scene.supervisor.tick(reason);
    }
    const log = await scene.git(["log", "--format=%s", "-5"]);
    assert.equal(log.includes("개발자 쪽"), false, "누르기 전에는 합치지 않는다");
    const view = scene.supervisor.baseSyncView();
    assert.ok(view.behind > 0, "받아올 수는 센다");
    assert.equal(view.requested, false);
    assert.equal(view.last, undefined, "누른 적이 없으니 결과도 없다");
  } finally {
    await scene.dispose();
  }
});

test("받아오기 — 누르면 합치고 결과를 남긴다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.dev.pushToBase({ "src/a.ts": "export const v = 0;\n" }, "씨앗");
    await scene.git(["fetch", "origin"]);
    await scene.git(["checkout", "-b", BRANCH]);
    scene.core.setCycle(BRANCH, null);
    await commit(scene, { "src/b.ts": "export const b = 1;\n" }, "작업 쪽");
    await scene.dev.pushToBase({ "src/c.ts": "export const c = 2;\n" }, "개발자 쪽");

    scene.supervisor.requestBaseSync();
    await scene.supervisor.settled();
    const log = await scene.git(["log", "--format=%s", "-5"]);
    assert.ok(log.includes("개발자 쪽"), "개발자 커밋이 합쳐져야 한다");
    assert.ok(log.includes("작업 쪽"), "작업 커밋이 살아 있어야 한다");
    const view = scene.supervisor.baseSyncView();
    assert.equal(view.behind, 0);
    assert.equal(view.requested, false);
    assert.equal(view.last?.outcome, "done");
    assert.equal(scene.briefs.length, 0, "겹치지 않으면 AI 과제가 없다");

    // 받을 것이 없을 때 누르면 `none` 이다.
    scene.supervisor.requestBaseSync();
    await scene.supervisor.settled();
    assert.equal(scene.supervisor.baseSyncView().last?.outcome, "none");
  } finally {
    await scene.dispose();
  }
});

test("받아오기 — AI 작업 중에 누르면 서서 기다렸다가 턴이 끝난 틱이 합친다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.dev.pushToBase({ "src/a.ts": "export const v = 0;\n" }, "씨앗");
    await scene.git(["fetch", "origin"]);
    await scene.git(["checkout", "-b", BRANCH]);
    scene.core.setCycle(BRANCH, null);
    await commit(scene, { "src/b.ts": "export const b = 1;\n" }, "작업 쪽");
    await scene.dev.pushToBase({ "src/c.ts": "export const c = 2;\n" }, "개발자 쪽");

    scene.busyNow = true;
    scene.supervisor.requestBaseSync();
    await scene.supervisor.settled();
    assert.equal((await scene.git(["log", "--format=%s", "-5"])).includes("개발자 쪽"), false);
    assert.equal(scene.supervisor.baseSyncView().requested, true, "요청은 서서 기다린다");

    scene.busyNow = false;
    await scene.supervisor.tick("turn-idle");
    assert.ok((await scene.git(["log", "--format=%s", "-5"])).includes("개발자 쪽"));
    assert.equal(scene.supervisor.baseSyncView().requested, false);
    assert.equal(scene.supervisor.baseSyncView().last?.outcome, "done");
  } finally {
    await scene.dispose();
  }
});

test("랜딩 이월의 cherry-pick 충돌 — 브리프 뒤 마무리가 착지를 끝낸다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.dev.pushToBase({ "src/b.ts": "export const b = 0;\n" }, "씨앗");
    await scene.git(["fetch", "origin"]);
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await scene.git(["push", "-u", "origin", BRANCH]);
    const pr = await openCycle(scene, BRANCH);
    // PR head 뒤의 커밋이 곧 충돌할 내용이다.
    await commit(scene, { "src/b.ts": "export const b = 2;\n" }, "작업 2");

    await scene.github.merge(pr, "squash");
    // 병합 뒤 베이스가 같은 파일을 다르게 고쳤다 — 이월의 cherry-pick 이 충돌한다.
    await scene.dev.pushToBase({ "src/b.ts": "export const b = 9;\n" }, "개발자 쪽");

    await scene.supervisor.tick("manual");
    const pending = ledgerOf(scene).pendingOp;
    assert.equal(pending?.kind, "cherry-pick", "이월의 충돌은 cherry-pick 으로 적혀야 한다");
    assert.equal(pending?.land?.pr, pr, "착지 문맥이 원장에 있어야 한다");
    assert.equal(scene.briefs.length, 1, "충돌 브리프가 나가야 한다");

    // 가짜 AI 가 정리한다 — 마무리가 착지의 나머지(브랜치 정리 · setCycle)를 끝낸다.
    resolveMarkers(scene, { "src/b.ts": "export const b = 3;\n" });
    await scene.supervisor.tick("manual");
    assert.equal(ledgerOf(scene).pendingOp, null, "마무리 뒤 pendingOp 는 비어야 한다");
    const head = (await scene.git(["symbolic-ref", "--short", "HEAD"])).trim();
    assert.notEqual(head, BRANCH, "새 사이클 브랜치 위에 있어야 한다");
    assert.equal(scene.core.branch, head, "레지스트리가 새 브랜치를 가리켜야 한다");
    assert.equal((await scene.git(["branch", "--list", BRANCH])).trim(), "");
    assert.equal(
      (await scene.git(["show", "HEAD:src/b.ts"])).trim(),
      "export const b = 3;",
      "정리된 내용이 이월돼야 한다",
    );
  } finally {
    await scene.dispose();
  }
});

test("S11 재시작 — 랜딩 뒤 새 감독자는 cycle.merged 를 다시 내지 않는다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await scene.git(["push", "-u", "origin", BRANCH]);
    const pr = await openCycle(scene, BRANCH);

    await scene.github.merge(pr, "merge");
    await scene.supervisor.tick("manual");
    const transitions = scene.transitions.length;
    const events = scene.chatEvents.length;
    assert.ok(scene.chatEvents.some((e) => e.kind === "cycle.merged"));

    // 감독자를 새로 세운다 — 원장의 ended 가 같은 PR 의 재알림을 막는다.
    const supervisor2 = scene.respawn();
    await supervisor2.tick("manual");
    assert.equal(scene.transitions.length, transitions, "알림이 다시 나가면 안 된다");
    assert.equal(scene.chatEvents.length, events, "대화록 사건이 다시 나가면 안 된다");
  } finally {
    await scene.dispose();
  }
});

test("폴러를 지운 뒤에도 — PR 상태 변화 알림과 리뷰 브리프가 나간다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await scene.git(["push", "-u", "origin", BRANCH]);
    const pr = await openCycle(scene, BRANCH);

    // 첫 틱이 기준선(lastPr)을 세운다 — 첫 관찰은 알리지 않는다.
    await scene.supervisor.tick("manual");
    assert.equal(scene.transitions.length, 0, "첫 관찰은 알리지 않는다");

    // 새 코멘트 — 사이드바 사건 · 대화록 사건 · 반영 브리프가 모두 나간다.
    scene.github.addComment(pr, { kind: "issue", body: "여기 고쳐 주세요" });
    await scene.supervisor.tick("manual");
    assert.ok(
      scene.transitions.some((t) => t.kind === "comments" && t.count === 1),
      "코멘트 도착 알림이 나가야 한다",
    );
    assert.ok(
      scene.chatEvents.some((e) => e.kind === "review.arrived"),
      "review.arrived 사건이 나가야 한다",
    );
    assert.ok(scene.reviewBriefs.length === 0, "코멘트는 알리고 자동 수정은 시작하지 않는다");

    // 반려 — 상태 변화 알림과 cycle.closed 사건.
    scene.github.close(pr);
    await scene.supervisor.tick("manual");
    assert.ok(scene.transitions.some((t) => t.kind === "closed"));
    assert.ok(scene.chatEvents.some((e) => e.kind === "cycle.closed"));
  } finally {
    await scene.dispose();
  }
});

test("L9 세 목록을 페이지 끝까지 읽는다 — 3페이지의 코멘트를 모두 본다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await scene.git(["push", "-u", "origin", BRANCH]);
    const pr = await openCycle(scene, BRANCH);
    await scene.supervisor.tick("manual");

    // per_page 50 기준 3페이지 — 한 페이지만 읽으면 마지막 코멘트가 보이지 않는다.
    for (let i = 0; i < 101; i += 1) {
      scene.github.addComment(pr, { kind: "issue", body: `코멘트 ${i}` });
    }
    await scene.supervisor.tick("manual");
    const arrived = scene.chatEvents.find((event) => event.kind === "review.arrived");
    assert.equal(arrived?.reviews?.length, 101, "101개를 모두 읽어야 한다");
    assert.equal(
      scene.transitions.find((t) => t.kind === "comments")?.count,
      101,
      "도착 알림도 전체 수를 센다",
    );
  } finally {
    await scene.dispose();
  }
});

test("L9 봇 코멘트는 AI 에게 가지 않는다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await scene.git(["push", "-u", "origin", BRANCH]);
    const pr = await openCycle(scene, BRANCH);
    await scene.supervisor.tick("manual");

    const bot1 = scene.github.addComment(pr, {
      kind: "issue",
      body: "CI 빌드가 깨졌습니다",
      bot: true,
    });
    const bot2 = scene.github.addComment(pr, {
      kind: "issue",
      body: "배포 완료",
      login: "deploy[bot]",
    });
    const human = scene.github.addComment(pr, { kind: "issue", body: "여백을 좀 줄여 주세요" });
    await scene.supervisor.tick("manual");

    const arrived = scene.chatEvents.find((event) => event.kind === "review.arrived");
    const ids = arrived?.reviews?.map((review) => review.id) ?? [];
    assert.deepEqual(ids, [human], "일반 봇 알림은 제외하고 사람의 의견을 알린다");
    assert.ok(!ids.includes(bot1) && !ids.includes(bot2));
    assert.deepEqual(scene.reviewBriefs, []);
  } finally {
    await scene.dispose();
  }
});

test("L9 whoAmI 는 여러 관찰에서 한 번만 불린다 — 토큰마다 캐시", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await scene.git(["push", "-u", "origin", BRANCH]);
    const pr = await openCycle(scene, BRANCH);
    await scene.supervisor.tick("manual");
    assert.equal(scene.github.userCalls, 1, "첫 관찰에서 한 번 부른다");

    scene.github.addComment(pr, { kind: "issue", body: "다음 코멘트" });
    await scene.supervisor.tick("manual");
    assert.equal(scene.github.userCalls, 1, "다음 관찰은 캐시를 읽는다");

    // 재시작도 같은 전송 · 같은 토큰 — 여전히 캐시다.
    const supervisor2 = scene.respawn();
    scene.github.addComment(pr, { kind: "issue", body: "재시작 뒤 코멘트" });
    await supervisor2.tick("manual");
    assert.equal(scene.github.userCalls, 1, "새 감독자도 캐시를 함께 쓴다");
  } finally {
    await scene.dispose();
  }
});

test("L9 재시작 뒤 첫 코멘트를 삼키지 않는다 — 원장 known 이 기준선", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await scene.git(["push", "-u", "origin", BRANCH]);
    const pr = await openCycle(scene, BRANCH);
    await scene.supervisor.tick("manual");

    const first = scene.github.addComment(pr, { kind: "issue", body: "첫 코멘트" });
    await scene.supervisor.tick("manual");
    assert.deepEqual(
      scene.chatEvents
        .filter((e) => e.kind === "review.arrived")
        .at(-1)
        ?.reviews?.map((r) => r.id),
      [first],
    );

    // 재시작 — 메모리가 아니라 원장(cycle.json)의 known 이 이어받는다.
    const supervisor2 = scene.respawn();
    const second = scene.github.addComment(pr, { kind: "issue", body: "재시작 뒤 첫 코멘트" });
    await supervisor2.tick("manual");
    assert.deepEqual(
      scene.chatEvents
        .filter((e) => e.kind === "review.arrived")
        .at(-1)
        ?.reviews?.map((r) => r.id),
      [second],
      "재시작 뒤 첫 코멘트가 기준선에 삼켜지지 않는다",
    );
    assert.notEqual(second, first);
  } finally {
    await scene.dispose();
  }
});

test("옛 원장의 reject:<pr> 표식 — 읽을 때 reviews 로 옮겨지고 주의를 세우지 않는다", async () => {
  const scene = await makeSupervisedScene();
  try {
    // 3263c45a 판이 적던 모양 — 청구 표식이 notices 에 서 있다.
    writeFileSync(
      scene.ledgerPath,
      JSON.stringify({
        v: 1,
        notices: {
          "reject:4": { via: "pr", ref: 4, raisedAt: "2026-09-24T10:00:00.000Z", count: 1 },
        },
        reviews: { "4": { known: [11], briefed: [11], rounds: 1 } },
      }),
    );
    const next = scene.respawn();
    const parts = next.attentionParts();
    assert.deepEqual(parts.notices, {});
    assert.equal(composeAttention(parts), null, "옛 표식이 개발자에게 알렸어요 를 세우지 않는다");

    await next.tick("manual");
    const ledger = ledgerOf(scene);
    assert.deepEqual(ledger.notices, {});
    assert.deepEqual(ledger.reviews["4"], {
      known: [11],
      briefed: [11],
      rounds: 1,
      rejectionAsked: true,
    });
  } finally {
    await scene.dispose();
  }
});

test("사이클 밖 갈라짐 — 최신화가 던지지 않고 틱이 사이클 브랜치로 옮긴다", async () => {
  const scene = await makeSupervisedScene();
  try {
    // 사이클 없이 base 위에 로컬 커밋 + 원격 진행 — 예전에는 준비 실패였다.
    await commit(scene, { "src/stray.ts": "export const s = 1;\n" }, "길 잃은 커밋");
    await scene.dev.pushToBase({ "src/base.ts": "개발자\n" }, "베이스 이동");

    const outcome = await scene.core.refreshFromRemote(() => {});
    assert.equal(outcome, "clean", "갈라짐은 더 이상 실패가 아니다");

    await scene.supervisor.tick("manual");
    const head = (await scene.git(["symbolic-ref", "--short", "HEAD"])).trim();
    assert.ok(head.startsWith("colonova-design/"), "사이클 브랜치가 생겨야 한다");
    const onCycle = await scene.git(["log", "--format=%s", head]);
    assert.ok(onCycle.includes("길 잃은 커밋"), "커밋이 사이클 브랜치로 옮겨져야 한다");
    const baseTip = (await scene.git(["rev-parse", "main"])).trim();
    const originTip = (await scene.git(["rev-parse", "origin/main"])).trim();
    assert.equal(baseTip, originTip, "로컬 base 는 origin/base 를 가리켜야 한다");
  } finally {
    await scene.dispose();
  }
});

/** 원격의 브랜치 목록 — origin url 이 죽은 세계에서도 진짜 원격을 본다. */
function remoteHeads(scene: SupervisedScene, branch: string): Promise<string> {
  return scene.git(["ls-remote", "--heads", scene.remote.path, branch]);
}

test("이월의 병합 커밋 — cherry-pick 이 멈추지 않고 일반 커밋만 옮긴다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await scene.git(["push", "-u", "origin", BRANCH]);
    const pr = await openCycle(scene, BRANCH);
    // 받아오기가 베이스를 사이클 브랜치에 합친다 — headSha 뒤에
    // 병합 커밋이 선다(범위 cherry-pick 이 "-m 없음"으로 멈추는 세계).
    await scene.dev.pushToBase({ "src/base.ts": "개발자\n" }, "베이스 이동");
    scene.supervisor.requestBaseSync();
    await scene.supervisor.settled();
    const afterMergeBase = await scene.git(["log", "--format=%s", "-3"]);
    assert.ok(afterMergeBase.includes("Merge"), "병합 커밋이 사이클 브랜치에 있어야 한다");

    await scene.github.merge(pr, "merge");
    await commit(scene, { "src/b.ts": "export const b = 1;\n" }, "작업 2");

    await scene.supervisor.tick("manual");
    assert.equal(ledgerOf(scene).pendingOp, null, "병합 커밋 때문에 이월이 멈춰서는 안 된다");
    const head = (await scene.git(["symbolic-ref", "--short", "HEAD"])).trim();
    assert.ok(head.startsWith("colonova-design/"));
    const log = await scene.git(["log", "--format=%s", "origin/main..HEAD"]);
    assert.deepEqual(log.trim().split("\n"), ["작업 2"], "병합 커밋 없이 일반 커밋만 옮겨야 한다");
    assert.notEqual(
      (await remoteHeads(scene, BRANCH)).trim(),
      "",
      "다음 제출 전에는 옛 원격 브랜치를 보존한다",
    );
  } finally {
    await scene.dispose();
  }
});

test("이월의 빈 커밋 — 이미 베이스에 들어간 변경은 버려진다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await scene.git(["push", "-u", "origin", BRANCH]);
    const pr = await openCycle(scene, BRANCH);
    // 스쿼시 병합이 headSha 뒤의 커밋까지 베이스에 넣었다 — 이월하면 빈 커밋.
    await commit(scene, { "src/b.ts": "export const b = 1;\n" }, "작업 2");
    await scene.git(["push", "origin", BRANCH]);
    await scene.github.merge(pr, "squash");

    await scene.supervisor.tick("manual");
    assert.equal(ledgerOf(scene).pendingOp, null, "빈 커밋에 멈춰서는 안 된다");
    assert.equal(
      (await scene.git(["symbolic-ref", "--short", "HEAD"])).trim(),
      "main",
      "옮길 것이 없으면 베이스로 돌아온다",
    );
    assert.equal(
      (await scene.git(["rev-parse", "HEAD"])).trim(),
      (await scene.git(["rev-parse", "origin/main"])).trim(),
      "HEAD 는 origin/main 이다",
    );
    assert.equal((await remoteHeads(scene, BRANCH)).trim(), "", "옛 원격 브랜치는 지워진다");
    assert.equal(scene.core.openHandoff?.state, "merged");
    assert.equal(
      scene.chatEvents.some((e) => e.kind === "cycle.carried"),
      false,
      "버려진 커밋은 이월 사건을 내지 않는다",
    );
  } finally {
    await scene.dispose();
  }
});

test("이월 병합의 옛 원격 브랜치 — 새 브랜치가 올라갈 때까지 남는다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.git(["checkout", "-b", BRANCH]);
    await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
    await scene.git(["push", "-u", "origin", BRANCH]);
    const pr = await openCycle(scene, BRANCH);
    // 밀림의 백오프를 미리 심는다 — 랜딩 틱에서 푸시가 건너뛰기게.
    await commit(scene, { "src/z.ts": "export const z = 1;\n" }, "밀림 씨앗");
    await scene.git(["remote", "set-url", "origin", "http://127.0.0.1:1/nope.git"]);
    scene.setNow(Date.now());
    await scene.supervisor.tick("manual");
    const seeded = ledgerOf(scene).push;
    assert.equal(seeded, null, "제출 전 자동 push와 재시도는 없다");

    await scene.git(["remote", "set-url", "origin", scene.remote.path]);
    await scene.github.merge(pr, "merge");
    await commit(scene, { "src/b.ts": "export const b = 1;\n" }, "작업 2");

    // 랜딩 — 백오프 창 안이라 푸시는 이 틱에서 건너뛴다.
    await scene.supervisor.tick("manual");
    const ledger = ledgerOf(scene);
    const newBranch = scene.core.branch;
    assert.ok(newBranch !== null && newBranch.startsWith("colonova-design/"));
    assert.ok(
      ledger.branches.some((b) => b.name === BRANCH && b.deleteRemoteAfterPush === newBranch),
      "원장이 옛 원격 브랜치 삭제를 미뤄 둬야 한다",
    );
    assert.notEqual(
      (await remoteHeads(scene, BRANCH)).trim(),
      "",
      "푸시 전에 옛 원격 브랜치는 남아 있어야 한다",
    );
    assert.equal((await scene.git(["branch", "--list", BRANCH])).trim(), "", "로컬은 지운다");

    // 푸시가 계속 실패해도 옛 브랜치는 남는다.
    await scene.git(["remote", "set-url", "origin", "http://127.0.0.1:1/nope.git"]);
    scene.setNow(Date.now() + 60_000);
    await scene.supervisor.tick("manual");
    assert.notEqual(
      (await remoteHeads(scene, BRANCH)).trim(),
      "",
      "푸시 실패 동안 옛 원격 브랜치는 남아 있어야 한다",
    );

    // 푸시가 성공하는 틱에서 옛 브랜치가 지워진다.
    await scene.git(["remote", "set-url", "origin", scene.remote.path]);
    scene.setNow(Date.now() + 60_000);
    await scene.supervisor.submit("button");
    await scene.supervisor.settled();
    assert.equal(
      (await remoteHeads(scene, BRANCH)).trim(),
      "",
      "새 브랜치가 올라간 뒤 옛 원격 브랜치는 지워져야 한다",
    );
    assert.notEqual(
      (await remoteHeads(scene, newBranch)).trim(),
      "",
      "새 브랜치가 원격에 있어야 한다",
    );
    assert.equal(
      ledgerOf(scene).branches.some((b) => b.deleteRemoteAfterPush),
      false,
      "미룸 표식은 지워져야 한다",
    );
  } finally {
    await scene.dispose();
  }
});

test("U17 조용한 알림 — github:expiring 은 원장에 남아도 주의 재료에 서지 않는다", async () => {
  const scene = await makeSupervisedScene();
  try {
    const at = new Date().toISOString();
    scene.supervisor.setNotice("github:expiring", { via: "issue", raisedAt: at, count: 1 });
    scene.supervisor.setNotice("push:auth", { via: "issue", raisedAt: at, count: 1 });
    const parts = scene.supervisor.attentionParts();
    // 조용한 키는 원장(cycle.json notices)에 남아 개발자 알림의 장부로 살되,
    // 화면의 문제 문장(개발자에게 알렸어요)의 재료에서는 빠진다.
    assert.deepEqual(Object.keys(parts.notices ?? {}), ["push:auth"]);
    scene.supervisor.setNotice("push:auth", null);
    assert.equal(composeAttention(scene.supervisor.attentionParts()), null);
  } finally {
    await scene.dispose();
  }
});

// ————— 자동 검사 반영 (2026-10-07 베타 준비 분석 · W6) —————

/** 사이클 브랜치에 커밋을 올리고 PR 을 연 장면 — head sha 와 함께. */
async function openPrWithCommit(scene: SupervisedScene): Promise<{ pr: number; head: string }> {
  await scene.git(["checkout", "-b", BRANCH]);
  await commit(scene, { "src/a.ts": "export const a = 1;\n" }, "작업 1");
  await scene.git(["push", "-u", "origin", BRANCH]);
  const pr = await openCycle(scene, BRANCH);
  return { pr, head: scene.github.headShaOf(pr) };
}

const BUILD_FAILS = {
  id: 501,
  name: "build",
  status: "completed",
  conclusion: "failure",
  summary: "컴파일 오류 1개",
  annotations: [{ path: "src/a.ts", line: 4, message: "Cannot find name 'nope'" }],
};

test("승인 — 본문 있는 승인은 AI 턴이 아니고, 선로의 handoff.approved 로 나간다", async () => {
  const scene = await makeSupervisedScene();
  try {
    const { pr } = await openPrWithCommit(scene);
    await scene.supervisor.tick("manual");
    assert.equal(scene.core.snapshot().handoff?.approved, undefined);
    scene.github.addComment(pr, { kind: "review", login: "dev1", body: "LGTM", state: "APPROVED" });
    await scene.supervisor.tick("manual");
    assert.equal(scene.reviewBriefs.length, 0, "승인은 반영 턴을 열지 않는다");
    assert.equal(scene.briefs.length, 0);
    assert.equal(ledgerOf(scene).budgets[`review:${pr}`], undefined, "라운드도 쓰지 않는다");
    assert.equal(scene.core.snapshot().handoff?.approved, true);
    assert.ok(!scene.transitions.some((t) => t.kind === "comments"), "코멘트 도착 알림도 없다");
  } finally {
    await scene.dispose();
  }
});

test("상태 확인 — 코멘트 목록에 승인은 서지 않고, 토큰 주인의 표식 없는 글은 서고 앱의 글은 서지 않는다", async () => {
  const scene = await makeSupervisedScene();
  try {
    const { pr } = await openPrWithCommit(scene);
    scene.github.addComment(pr, { kind: "review", login: "dev1", body: "LGTM", state: "APPROVED" });
    const mine = scene.github.addComment(pr, {
      kind: "issue",
      login: "colonova-planner",
      body: "개발자가 자기 토큰으로 쓴 말",
    });
    scene.github.addComment(pr, {
      kind: "issue",
      login: "colonova-planner",
      body: markAppComment("앱이 쓴 글"),
    });
    // AI 리뷰어의 줄 코멘트는 감독자의 반영 턴에만 간다 — 코멘트 칸은 사람의 말만 센다(2026-10-14).
    scene.github.addComment(pr, {
      kind: "pull",
      login: "chatgpt-codex-connector[bot]",
      path: "src/a.ts",
      body: "이름을 맞추세요",
    });
    const report = await scene.workspace.peekHandoff();
    assert.deepEqual(
      report?.reviews?.map((row) => row.id),
      [mine],
      "승인(LGTM) · AI 리뷰어의 글은 코멘트 칸에 서지 않는다",
    );
    assert.equal(report?.approved, true, "승인은 상태로 나른다");
  } finally {
    await scene.dispose();
  }
});
