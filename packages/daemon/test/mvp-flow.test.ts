// CI-순수-제외 — 감독자 하네스(cycle-harness)가 진짜 git 을 만든다. scripts/pure-tests.mjs 가 CI 에서 뺀다(2026-10-24).
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readLedger, writeLedger } from "../dist/cycle-ledger.js";
import { RequestRouter } from "../dist/dispatch.js";
import { makeSupervisedScene, type SupervisedScene } from "./helpers/cycle-harness.ts";

test("MVP: 전송 단계에서 재확인이 필요해지면 제출 요청을 실패로 응답한다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await save(scene, "screen.txt", "확인한 화면\n");
    const token = await scene.core.submitPreviewToken();
    const head = (await scene.git(["rev-parse", "HEAD"])).trim();
    await scene.dev.pushToBase({ "developer.txt": "새 기준\n" }, "기준 이동");
    let lastDiff: ReturnType<typeof scene.core.setDiff> | undefined;
    const setDiff = scene.core.setDiff.bind(scene.core);
    scene.core.setDiff = (value) => {
      lastDiff = value;
      return setDiff(value);
    };
    const active = {
      repo: scene.workspace,
      supervisor: scene.supervisor,
      get lastDiff() {
        return lastDiff;
      },
    };
    const router = new RequestRouter({
      fleet: { requireActive: () => active, workspaceCwd: () => scene.clone.path },
      manager: { anyRunning: () => false },
    } as never);
    await assert.rejects(
      router.dispatch({
        id: "send",
        type: "repo.submit",
        expectedHead: head,
        expectedPreview: token,
      }),
      /SUBMIT_CHANGED/,
    );
    assert.equal(scene.github.pull(1), undefined);
  } finally {
    await scene.dispose();
  }
});

async function save(scene: SupervisedScene, name: string, text: string) {
  writeFileSync(join(scene.clone.path, name), text);
  assert.equal((await scene.workspace.save({ message: name })).stage, "published");
  return (await scene.git(["rev-parse", "HEAD"])).trim();
}

async function remoteHead(scene: SupervisedScene) {
  return (
    (await scene.git(["ls-remote", "--heads", "origin", scene.core.branch!]))
      .trim()
      .split(/\s+/)[0] ?? ""
  );
}

test("MVP: 보관·되돌리기·관찰은 열린 PR을 갱신하지 않고 재제출만 전송한다", async () => {
  const scene = await makeSupervisedScene();
  try {
    const first = await save(scene, "screen.txt", "첫 화면\n");
    assert.equal(await remoteHead(scene), "", "첫 보관은 원격 브랜치도 만들지 않는다");
    scene.shots = [{ route: "/", extension: ".png", image: new Uint8Array([137, 80, 78, 71]) }];
    await scene.supervisor.submit("button");
    await scene.supervisor.settled();
    const pr = scene.core.openHandoff!.number;
    assert.ok(!scene.github.pull(pr)!.body.includes("화면 미리보기"));
    assert.equal(
      (await scene.git(["ls-remote", "--heads", "origin", "colonova-design-assets"])).trim(),
      "",
    );
    assert.equal(await remoteHead(scene), first);
    const second = await save(scene, "screen.txt", "두 번째 화면\n");
    await scene.supervisor.tick("timer");
    assert.equal(await remoteHead(scene), first);
    assert.equal((await scene.workspace.restore(first)).stage, "published");
    assert.equal(readFileSync(join(scene.clone.path, "screen.txt"), "utf8"), "첫 화면\n");
    assert.equal((await scene.workspace.restore(second)).stage, "published");
    assert.equal(readFileSync(join(scene.clone.path, "screen.txt"), "utf8"), "두 번째 화면\n");
    assert.equal(await remoteHead(scene), first, "복원도 로컬에만 보관한다");
    const reviewed = (await scene.git(["rev-parse", "HEAD"])).trim();
    await scene.supervisor.submit("button");
    await scene.supervisor.settled();
    assert.equal(scene.core.openHandoff!.number, pr);
    assert.equal(await remoteHead(scene), reviewed);
    assert.equal(scene.github.pull(pr + 1), undefined);
  } finally {
    await scene.dispose();
  }
});

test("MVP: 등록된 작업 브랜치와 실제 checkout이 다르면 다른 HEAD를 확정하지 않는다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await save(scene, "screen.txt", "작업 보존\n");
    await scene.git(["checkout", "main"]);
    await assert.rejects(scene.supervisor.submit("button"), /SUBMIT_CHANGED/);
    assert.equal(readLedger(scene.ledgerPath).submit, null);
    assert.equal(await remoteHead(scene), "");
  } finally {
    await scene.dispose();
  }
});

test("MVP: PR 생성 도중 다른 사람이 원격을 바꾸면 성공 영수증을 내지 않는다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await save(scene, "screen.txt", "확인한 화면\n");
    const request = scene.github.request.bind(scene.github);
    let changed = false;
    scene.github.request = async (input) => {
      const response = await request(input);
      if (!changed && input.method === "POST" && input.url.endsWith("/pulls")) {
        changed = true;
        await scene.dev.pushToBranch(
          scene.core.branch!,
          { "developer.txt": "개발자 변경\n" },
          "외부 변경",
        );
      }
      return response;
    };
    await scene.supervisor.submit("button");
    await scene.supervisor.settled();
    assert.equal(changed, true);
    assert.ok(scene.core.openHandoff, "이미 만들어진 요청은 기억해 중복 생성을 피한다");
    assert.equal(readLedger(scene.ledgerPath).submit, null);
    assert.equal(
      scene.chatEvents.some((event) => event.kind === "cycle.handed"),
      false,
    );
  } finally {
    await scene.dispose();
  }
});

test("MVP: 제출 push의 인증·권한 오류는 원장과 사용자 복구 상태로 전달된다", async () => {
  for (const [detail, kind] of [
    ["fatal: Authentication failed, HTTP 401", "auth"],
    ["remote: Permission denied, returned error: 403", "permission"],
  ] as const) {
    const scene = await makeSupervisedScene();
    try {
      await save(scene, "screen.txt", "보존할 화면\n");
      const git = scene.core.git.bind(scene.core);
      scene.core.git = async (args, ...rest) => {
        if (args[0] === "push") throw new Error(detail);
        return await git(args, ...rest);
      };
      await scene.supervisor.submit("button");
      await scene.supervisor.settled();
      assert.equal(scene.supervisor.submitView().phase, "blocked");
      assert.equal(scene.supervisor.submitView().lastError, kind);
      assert.deepEqual(scene.submitBlocked, [kind]);
      assert.ok(readLedger(scene.ledgerPath).submit?.version);
      assert.equal(await remoteHead(scene), "");
    } finally {
      await scene.dispose();
    }
  }
});

test("MVP: PR 생성 실패 후 새 보관·재시작이 생겨도 확인한 버전과 본문만 제출한다", async () => {
  const scene = await makeSupervisedScene();
  try {
    const reviewed = await save(scene, "screen.txt", "확인한 화면\n");
    scene.github.failPullCreates();
    await scene.supervisor.submit("button", undefined, "확인한 메모", {
      screens: 1,
      titles: ["확인한 화면"],
    });
    await scene.supervisor.settled();
    const intent = readLedger(scene.ledgerPath).submit!;
    assert.equal(intent.version!.head, reviewed);
    const newer = await save(scene, "late.txt", "아직 확인하지 않은 변경\n");
    await scene.supervisor.submit("button", undefined, "나중 메모", {
      screens: 2,
      titles: ["나중 화면"],
    });
    assert.deepEqual(
      readLedger(scene.ledgerPath).submit,
      intent,
      "중복 요청은 확정 내용을 바꾸지 않는다",
    );
    scene.github.healPullCreates();
    scene.setNow(Date.parse(intent.nextAttemptAt!) + 1000);
    await scene.respawn().tick("manual");
    assert.equal(await remoteHead(scene), reviewed);
    assert.equal(
      (await scene.git(["rev-parse", "HEAD"])).trim(),
      newer,
      "새 보관은 로컬에 유지한다",
    );
    const body = scene.github.pull(scene.core.openHandoff!.number)!.body;
    assert.ok(body.includes("screen.txt"));
    assert.ok(body.includes("확인한 메모"));
    assert.ok(!body.includes("late.txt") && !body.includes("나중 메모"));
    assert.equal(readLedger(scene.ledgerPath).submit, null);
  } finally {
    await scene.dispose();
  }
});

test("MVP: push 응답 유실 후 새 보관이 생겨도 원격을 대조해 확정 버전으로 복구한다", async () => {
  const scene = await makeSupervisedScene();
  try {
    const reviewed = await save(scene, "screen.txt", "확인한 화면\n");
    const git = scene.core.git.bind(scene.core);
    let lost = false;
    scene.core.git = async (args, ...rest) => {
      const result = await git(args, ...rest);
      if (!lost && args[0] === "push" && args.some((arg) => arg.startsWith(`${reviewed}:`))) {
        lost = true;
        throw new Error("fetch failed: 응답 유실");
      }
      return result;
    };
    await scene.supervisor.submit("button");
    await scene.supervisor.settled();
    assert.equal(lost, true);
    assert.equal(await remoteHead(scene), reviewed);
    await save(scene, "late.txt", "미확인\n");
    const ledger = readLedger(scene.ledgerPath);
    scene.setNow(Date.parse(ledger.push!.nextAttemptAt) + 1000);
    await scene.respawn().tick("manual");
    assert.equal(await remoteHead(scene), reviewed);
    assert.ok(scene.core.openHandoff);
    assert.equal(scene.github.pull(scene.core.openHandoff.number + 1), undefined);
  } finally {
    await scene.dispose();
  }
});

test("MVP: 확정 버전이 없는 옛 제출 의도는 작업을 보존하고 재확인을 요구한다", async () => {
  const scene = await makeSupervisedScene();
  try {
    const head = await save(scene, "screen.txt", "보존할 작업\n");
    writeLedger(scene.ledgerPath, {
      ...readLedger(scene.ledgerPath),
      submit: { via: "button", requestedAt: new Date().toISOString() },
    });
    await scene.respawn().tick("manual");
    assert.equal(await remoteHead(scene), "");
    assert.equal(scene.core.openHandoff, null);
    assert.equal((await scene.git(["rev-parse", "HEAD"])).trim(), head);
    assert.equal(readLedger(scene.ledgerPath).submit, null);
    assert.equal(
      scene.chatEvents.some((event) => event.kind === "cycle.handed"),
      false,
    );
  } finally {
    await scene.dispose();
  }
});

test("MVP: 재시도 전에 원격 기준이 바뀌면 자동 제출을 멈추고 기존 변경을 보존한다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await save(scene, "screen.txt", "보존할 작업\n");
    scene.github.failPullCreates();
    await scene.supervisor.submit("button");
    await scene.supervisor.settled();
    const confirmed = await remoteHead(scene);
    await scene.dev.pushToBase({ "developer.txt": "개발자 변경\n" }, "기준 갱신");
    const pending = readLedger(scene.ledgerPath).submit!;
    scene.github.healPullCreates();
    scene.setNow(Date.parse(pending.nextAttemptAt!) + 1000);
    await scene.respawn().tick("manual");
    assert.equal(await remoteHead(scene), confirmed);
    assert.equal(scene.github.pull(1), undefined);
    assert.equal(readFileSync(join(scene.clone.path, "screen.txt"), "utf8"), "보존할 작업\n");
    assert.equal(readLedger(scene.ledgerPath).submit, null);
  } finally {
    await scene.dispose();
  }
});

test("MVP: 사람 의견·AI 리뷰·실패한 CI와 옛 대기 기록은 자동 수정·답장을 시작하지 않는다", async () => {
  const scene = await makeSupervisedScene();
  try {
    const reviewed = await save(scene, "screen.txt", "확인한 화면\n");
    await scene.supervisor.submit("button");
    await scene.supervisor.settled();
    const pr = scene.core.openHandoff!.number;
    const comment = scene.github.addComment(pr, { body: "수정 요청" });
    scene.github.addComment(pr, {
      kind: "pull",
      login: "chatgpt-codex-connector[bot]",
      bot: true,
      body: "검토 의견",
    });
    scene.github.setCheckRuns(reviewed, [
      { id: 1, name: "build", status: "completed", conclusion: "failure" },
    ]);
    const ledger = readLedger(scene.ledgerPath);
    writeLedger(scene.ledgerPath, {
      ...ledger,
      reviews: {
        [pr]: {
          known: [],
          briefed: [],
          rounds: 1,
          pendingRejection: {
            reasons: [
              {
                id: comment,
                kind: "review",
                author: "dev1",
                body: "옛 의견",
                pr,
                at: new Date().toISOString(),
              },
            ],
            since: new Date().toISOString(),
          },
        },
      },
    });
    const reborn = scene.respawn();
    for (let i = 0; i < 3; i++) await reborn.tick("manual");
    assert.deepEqual(scene.reviewBriefs, []);
    assert.deepEqual(scene.ciBriefs, []);
    assert.deepEqual(scene.briefs, []);
    assert.equal(await remoteHead(scene), reviewed);
    assert.ok(scene.chatEvents.some((event) => event.kind === "review.arrived"));
    assert.equal(scene.core.snapshot().handoff?.ci?.state, "failing");
  } finally {
    await scene.dispose();
  }
});
