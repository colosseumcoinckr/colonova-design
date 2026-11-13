// CI-순수-제외 — 진짜 git 으로 보관 성공 리셋을 본다(scripts/pure-tests.mjs 가 CI 에서 뺀다).
// 보관 게이트 판정의 진짜 git 장면(2026-11-12 기획자 체험): runSave 의 끝에서 끝까지 —
// 작성자 확인 실패(/user 끊김)는 AI 턴도 개발자 알림도 없이 멈추고 복구 뒤 발행은 남은 알림을 거두며,
// 분류되지 않는 커밋 실패(index.lock)는 AI 에게 두 번, 세 번째는 사람 안내, 성공 뒤엔 다시 센다.
// 판정 표 자체는 save-gate-limit.test.ts(순수)가 본다.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
// `../dist` 임포트인 이유: repo-publish 는 형제를 `.js` 지정자로 부른다 — src 직접 로드는 그 지정을 못 고친다.
import { PublishCycle } from "../dist/repo-publish.js";
import { MemoryGitHub, makeClone, makeCore, makeRemote } from "./helpers/cycle-harness.ts";

/** dirty 한 클론과 그 위의 PublishCycle — gitHubClient 를 갈아끼울 수 있다. */
async function saveScene() {
  const remote = await makeRemote();
  const clone = await makeClone(remote);
  const github = new MemoryGitHub(remote);
  const core = makeCore(clone, remote, { github });
  // 사이클 브랜치를 미리 세운다 — index.lock 이 `git checkout -b` 대신
  // 커밋 구간만 막게 한다(브랜치 준비 실패와 커밋 실패는 같은 commit 게이트라
  // 어느 쪽이 막혀도 판정은 같지만, 뜻한 자리를 잠그는 편이 분명하다).
  execFileSync("git", ["checkout", "-b", "colonova-design/test/1"], { cwd: clone.path });
  core.setCycle("colonova-design/test/1", null);
  const notices: Array<[string, string]> = [];
  const resolved: string[] = [];
  const briefs: string[] = [];
  const publish = new PublishCycle(core, {
    machineMemo: async () => "화면을 고친다",
    notice: (key, detail) => notices.push([key, detail]),
    resolveNotice: (key) => resolved.push(key),
  });
  const save = () => publish.runSave({ onSessionTurn: (brief) => briefs.push(brief) });
  return { remote, clone, core, github, notices, resolved, briefs, save };
}

test("runSave — 작성자 확인이 끊기면 AI 턴도 개발자 알림도 없다, 성공하면 남은 알림을 거둔다", async (t) => {
  const scene = await saveScene();
  t.after(() => {
    scene.clone.dispose();
    scene.remote.dispose();
  });
  // /user 를 끊는다 — 보고된 되풀이의 첫 원인(identityArgs → commitIdentity).
  const real = scene.github.request.bind(scene.github);
  scene.github.request = async (input) => {
    if (input.method === "GET" && input.url === "/user") {
      throw new Error("connect ECONNREFUSED 127.0.0.1:1");
    }
    return real(input);
  };
  writeFileSync(join(scene.clone.path, "a.txt"), "가\n");
  const failed = await scene.save();
  assert.equal(failed.stage, "failed");
  assert.equal(scene.briefs.length, 0, "AI 에게 가지 않는다");
  // 연결이 끊긴 것은 일시적인 기계 원인이다 — 개발자에게 알리지 않는다(대화의 한 줄만).
  assert.deepEqual(
    scene.notices.map(([key]) => key),
    [],
  );
  assert.match(failed.detail ?? "", /GitHub에 연결하지 못했습니다/);
  // 연결이 살아나면 다음 보관은 그대로 성공하고 알림을 거둔다.
  scene.github.request = real;
  writeFileSync(join(scene.clone.path, "b.txt"), "나\n");
  const saved = await scene.save();
  assert.equal(saved.stage, "published");
  assert.deepEqual(scene.resolved, ["save:commit"]);
});

test("runSave — 분류되지 않는 커밋 실패(index.lock)는 AI 에게 두 번, 성공 뒤엔 다시 센다", async (t) => {
  const scene = await saveScene();
  t.after(() => {
    scene.clone.dispose();
    scene.remote.dispose();
  });
  // git add 가 읽는 잠금 — git 의 일반 실패라 분류되지 않고 AI 의 과제가 된다.
  writeFileSync(join(scene.clone.path, ".git", "index.lock"), "");
  writeFileSync(join(scene.clone.path, "a.txt"), "가\n");
  const first = await scene.save();
  assert.equal(first.stage, "failed");
  const second = await scene.save();
  assert.equal(second.stage, "failed");
  assert.equal(scene.briefs.length, 2, "같은 실패는 AI 에게 두 번");
  const third = await scene.save();
  assert.equal(third.stage, "failed");
  assert.equal(scene.briefs.length, 2, "세 번째부터는 사람 안내다");
  assert.deepEqual(
    scene.notices.map(([key]) => key),
    ["save:commit"],
  );
  // 잠금을 풀고 보관이 성공하면 세던 것을 지운다 — 같은 실패가 와도 다시 AI 에게 간다.
  rmSync(join(scene.clone.path, ".git", "index.lock"));
  writeFileSync(join(scene.clone.path, "b.txt"), "나\n");
  const saved = await scene.save();
  assert.equal(saved.stage, "published");
  assert.deepEqual(scene.resolved, ["save:commit"]);
  // 성공 뒤 같은 실패 — 카운터가 지워졌으므로 첫 번째로 다시 센다.
  writeFileSync(join(scene.clone.path, ".git", "index.lock"), "");
  writeFileSync(join(scene.clone.path, "c.txt"), "다\n");
  await scene.save();
  assert.equal(scene.briefs.length, 3, "성공 뒤엔 다시 처음부터 센다");
});
