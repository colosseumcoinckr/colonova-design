// CI-순수-제외 — 로컬 git 하네스로 확인한다.
// 2026-11-12 채택 — 새 화면 작업은 최신 기준에서 시작한다(감독 판정: 이어갈 작업이 없는
// 프로젝트가 경계다 — 세션의 첫 말이 아니라). 이 시험은 감독자의 시작 직전 확인
// (prepareFreshBase) · 제출 확정 직전 확인(ensureSubmitBaseFresh) · 받아오기 직전
// HEAD 보존(pre-apply ref) · 확인 읽기의 차선 분리(review-fresh)를 잰다.
// dist 를 읽는다(하네스와 같은 사정 — pnpm test 가 빌드를 먼저 돈다).
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readLedger } from "../dist/cycle-ledger.js";
import {
  FRESH_CHECK_FAILED_DETAIL,
  freshGateKindOf,
  PRE_APPLY_REF,
  SUBMIT_BASE_STALE_DETAIL,
} from "../dist/repo-core.js";
import { makeSupervisedScene, type SupervisedScene } from "./helpers/cycle-harness.ts";

const BRANCH = "colonova-design/20261112-1";
const DEAD_REMOTE = "http://127.0.0.1:1/nope.git";

/** 원격 head — origin/main 의 추적 참조. */
async function originBase(scene: SupervisedScene): Promise<string> {
  return (await scene.git(["rev-parse", `origin/${scene.core.baseBranch}`])).trim();
}

async function head(scene: SupervisedScene): Promise<string> {
  return (await scene.git(["rev-parse", "HEAD"])).trim();
}

/** 사이클 브랜치를 만들어 커밋하고 레지스트리에 싣는 시작. */
async function cycleWith(scene: SupervisedScene, files: Record<string, string>, message: string) {
  await scene.git(["checkout", "-b", BRANCH]);
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(scene.clone.path, name), body);
  }
  await scene.git(["add", "-A"]);
  await scene.git(["commit", "-m", message]);
  scene.core.setCycle(BRANCH, null);
}

test("이어갈 작업이 없으면 시작 직전 확인이 베이스를 곧게 당긴다", async () => {
  const scene = await makeSupervisedScene();
  try {
    const before = await head(scene);
    await scene.dev.pushToBase({ "신규-기능.tsx": "export default () => null;\n" }, "개발자 반영");
    await scene.supervisor.prepareFreshBase();
    assert.equal(await head(scene), await originBase(scene), "HEAD 가 원격 베이스 끝에 선다");
    assert.notEqual(await head(scene), before, "과거의 HEAD 가 아니라 최신이다");
    assert.equal(
      (await scene.git(["rev-parse", `${PRE_APPLY_REF}${scene.core.baseBranch}`])).trim(),
      before,
      "당기기 직전 HEAD 를 pre-apply ref 에 남긴다",
    );
  } finally {
    await scene.dispose();
  }
});

test("사이클 브랜치가 있으면 시작 직전 최신 적용을 건너뛴다 — 진행 중 작업의 자동 합치기 금지", async () => {
  const scene = await makeSupervisedScene();
  try {
    await cycleWith(scene, { "screen.tsx": "export default () => 1;\n" }, "회원 목록 화면");
    const before = await head(scene);
    await scene.dev.pushToBase({ "다른-기능.tsx": "export default () => null;\n" }, "개발자 반영");

    await scene.supervisor.prepareFreshBase();

    assert.equal(await head(scene), before, "사이클 브랜치의 HEAD 는 그대로다");
    assert.ok(
      scene.briefs.length === 0,
      "확인은 조용히 지나간다 — 겹친 부분이 없으니 브리프도 없다",
    );
  } finally {
    await scene.dispose();
  }
});

test("미커밋 변경이 있으면 당기지 않는다 — 저장되지 않은 사용자 작업을 덮어쓰지 않는다", async () => {
  const scene = await makeSupervisedScene();
  try {
    const before = await head(scene);
    writeFileSync(join(scene.clone.path, "끄적-거림.tsx"), "export default () => 2;\n");
    await scene.dev.pushToBase({ "신규-기능.tsx": "export default () => null;\n" }, "개발자 반영");

    await scene.supervisor.prepareFreshBase();

    assert.equal(await head(scene), before, "더러운 트리에서는 아무것도 하지 않는다");
  } finally {
    await scene.dispose();
  }
});

test("턴이 돌면 확인을 건너뛴다 — 도는 AI 위에서 트리가 움직이지 않는다", async () => {
  const scene = await makeSupervisedScene();
  try {
    const before = await head(scene);
    await scene.dev.pushToBase({ "신규-기능.tsx": "export default () => null;\n" }, "개발자 반영");
    scene.busyNow = true;

    await scene.supervisor.prepareFreshBase();

    assert.equal(await head(scene), before, "바쁜 세계에서는 당기지 않는다");
  } finally {
    await scene.dispose();
  }
});

test("원격을 읽지 못하면 최신이라고 속이지 않고 거절한다 — 시작과 제출 확정 모두", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.git(["remote", "set-url", "origin", DEAD_REMOTE]);

    const refused = await scene.supervisor.prepareFreshBase().then(
      () => null,
      (error: unknown) => error,
    );
    assert.ok(refused instanceof Error, "시작 직전 확인은 거절로 끝난다");
    assert.equal(refused?.message, FRESH_CHECK_FAILED_DETAIL, "다시 시도할 수 있는 문장이다");
    assert.equal(freshGateKindOf(refused), "network", "거절 종류는 network 이다");

    await cycleWith(scene, { "screen.tsx": "export default () => 1;\n" }, "회원 목록 화면");
    const submitRefused = await scene.supervisor.submit("button").then(
      () => null,
      (error: unknown) => error,
    );
    assert.equal(submitRefused?.message, FRESH_CHECK_FAILED_DETAIL, "제출 확정도 거절한다");
    assert.equal(readLedger(scene.ledgerPath).submit, null, "제출 의도는 서지 않는다");
  } finally {
    await scene.dispose();
  }
});

test("제출 확정 직전에 이번 작업이 베이스보다 뒤처졌으면 받아오기로 안내하고 의도를 세우지 않는다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await cycleWith(scene, { "screen.tsx": "export default () => 1;\n" }, "회원 목록 화면");
    await scene.dev.pushToBase({ "다른-기능.tsx": "export default () => null;\n" }, "개발자 반영");

    const refused = await scene.supervisor.submit("button").then(
      () => null,
      (error: unknown) => error,
    );
    assert.equal(refused?.message, SUBMIT_BASE_STALE_DETAIL, "최신 내용 적용 안내 문장이다");
    assert.equal(readLedger(scene.ledgerPath).submit, null, "오래된 기준의 제출 의도는 없다");
    // 안내가 가리키는 길이 진짜로 낸다 — 최신 내용 적용을 누르면 기존 합치기 흐름이 최신을 사이클에 얹는다.
    scene.supervisor.requestBaseSync();
    await scene.supervisor.settled();
    await scene.git(["merge-base", "--is-ancestor", `origin/${scene.core.baseBranch}`, "HEAD"]);
    const counts = (
      await scene.git([
        "rev-list",
        "--left-right",
        "--count",
        `HEAD...origin/${scene.core.baseBranch}`,
      ])
    )
      .trim()
      .split(/\s+/);
    assert.equal(counts[1], "0", "합침 뒤 베이스에 뒤처진 커밋이 없다");
    assert.ok(
      readFileSync(join(scene.clone.path, "screen.tsx"), "utf8").includes("=> 1;"),
      "이번 작업의 화면 파일이 그대로 있다",
    );
    assert.ok(
      readFileSync(join(scene.clone.path, "다른-기능.tsx"), "utf8").includes("=> null;"),
      "개발자 쪽 새 내용도 얹혀 있다",
    );
  } finally {
    await scene.dispose();
  }
});

test("받아오기 합치기 직전 HEAD 를 사이클 브랜치의 pre-apply ref 에 남긴다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await cycleWith(scene, { "screen.tsx": "export default () => 1;\n" }, "회원 목록 화면");
    const before = await head(scene);
    await scene.dev.pushToBase({ "다른-기능.tsx": "export default () => null;\n" }, "개발자 반영");

    scene.supervisor.requestBaseSync();
    await scene.supervisor.settled();

    assert.equal(
      (await scene.git(["rev-parse", `${PRE_APPLY_REF}${BRANCH}`])).trim(),
      before,
      "합치기 직전 HEAD 로 되돌릴 지점이 남는다",
    );
  } finally {
    await scene.dispose();
  }
});

test("새 확인 읽기는 배경 읽기와 실행 중인 확인에 합류하지 않는다", async () => {
  const scene = await makeSupervisedScene();
  try {
    const lane = scene.core.lane;
    const order: string[] = [];
    const gate = Promise.withResolvers<void>();
    // 배경 읽기가 먼저 줄을 잡고 끝나지 않은 세계.
    const background = lane.run("review", async () => {
      order.push("background-start");
      await gate.promise;
      order.push("background-end");
      return "background";
    });
    // fresh 요청은 같은 모양의 결과를 돌려주는 배경 약속에 묻히지 않는다.
    const fresh = lane.run(
      "review-fresh",
      async () => {
        order.push("fresh-start");
        return "fresh";
      },
      { join: true },
    );
    gate.resolve();
    assert.equal(await fresh, "fresh", "fresh 는 제 몫의 읽기를 돌린다");
    await background;

    // 이미 실행 중인 fresh 뒤에는 다음 읽기가 별도로 선다.
    const first = lane.run(
      "review-fresh",
      async () => {
        order.push("fresh-1");
        return "one";
      },
      { join: true },
    );
    const second = lane.run("review-fresh", async () => "two", { join: true });
    assert.equal(await first, "one");
    assert.equal(await second, "two");
    assert.deepEqual(order.slice(0, 3), ["background-start", "background-end", "fresh-start"]);
  } finally {
    await scene.dispose();
  }
});

test("확인 뒤 원격 기준이 뒤로 이동해도 재확인 없이 제출하지 않는다", async () => {
  const scene = await makeSupervisedScene();
  try {
    const originalBase = await head(scene);
    await scene.dev.pushToBase({ "새-기준.txt": "기준\n" }, "새 기준");
    await scene.supervisor.prepareFreshBase();
    await cycleWith(scene, { "screen.tsx": "export default () => 1;\n" }, "화면 작업");
    const reviewed = await scene.core.submitPreviewToken();
    assert.ok(reviewed);
    await scene.git([
      "--git-dir",
      scene.remote.path,
      "update-ref",
      "refs/heads/main",
      originalBase,
    ]);
    await assert.rejects(
      scene.supervisor.submit("button", undefined, undefined, undefined, reviewed),
      /SUBMIT_CHANGED/,
    );
    assert.equal(readLedger(scene.ledgerPath).submit, null);
    assert.equal(scene.github.pull(1), undefined);
  } finally {
    await scene.dispose();
  }
});

test("최신 확인 중 생긴 사용자 변경은 그대로 남고 자동 적용은 멈춘다", async () => {
  const scene = await makeSupervisedScene();
  try {
    const before = await head(scene);
    await scene.dev.pushToBase({ "새-기준.txt": "기준\n" }, "새 기준");
    const fetch = scene.core.fetchBase.bind(scene.core);
    scene.core.fetchBase = async (...args) => {
      await fetch(...args);
      writeFileSync(join(scene.clone.path, "사용자.txt"), "작성 중\n");
    };
    await scene.supervisor.prepareFreshBase();
    assert.equal(await head(scene), before);
    assert.equal(readFileSync(join(scene.clone.path, "사용자.txt"), "utf8"), "작성 중\n");
  } finally {
    await scene.dispose();
  }
});

test("적용 뒤 준비 실패는 시작을 막고 재시도에서 남은 준비를 마친다", async () => {
  const scene = await makeSupervisedScene();
  try {
    await scene.dev.pushToBase({ "새-기준.txt": "기준\n" }, "새 기준");
    let stale = true;
    let attempts = 0;
    scene.installJudge = () => stale;
    scene.workspace.sync = async () => {
      attempts++;
    };
    await assert.rejects(scene.supervisor.prepareFreshBase(), /준비/);
    assert.equal(await head(scene), await originBase(scene));
    scene.workspace.sync = async () => {
      attempts++;
      stale = false;
    };
    await scene.supervisor.prepareFreshBase();
    assert.equal(attempts, 2);
    assert.equal(stale, false);
  } finally {
    await scene.dispose();
  }
});

test("적용 직전 복구 지점을 남기지 못하면 새 작업의 내용을 바꾸지 않는다", async () => {
  const scene = await makeSupervisedScene();
  try {
    const before = await head(scene);
    await scene.dev.pushToBase({ "새-기준.txt": "기준\n" }, "새 기준");
    const git = scene.core.git.bind(scene.core);
    scene.core.git = async (args, ...rest) => {
      if (args[0] === "update-ref") throw new Error("cannot lock ref");
      return git(args, ...rest);
    };
    await assert.rejects(scene.supervisor.prepareFreshBase(), /적용/);
    assert.equal(await head(scene), before);
  } finally {
    await scene.dispose();
  }
});
