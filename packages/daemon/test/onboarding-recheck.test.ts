import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
// `../dist` 임포트인 이유: environment 는 형제를 `.js` 지정자로 부른다 — src 직접 로드는 그것을 못 고친다.
import { forgetMissingGit, resolveGitExecutable } from "../dist/environment.js";

/**
 * 첫 화면의 `다시 확인`(2026-10-20 온보딩 손질) — git 해석은 한 데몬 안에서 기억된다. 못 찾았다는 기억이
 * 남으면 사용자가 앱 밖에서 git 을 설치한 뒤 눌러도 앱을 다시 켤 때까지 `git 이 없어요` 가 그대로였다.
 * 가짜 git 은 셸 스크립트라 Windows 에서는 돌지 않는다.
 */
test("다시 확인: 못 찾은 git 은 기억을 지우면 새로 찾고, 찾은 경로의 기억은 남는다", {
  skip: process.platform === "win32" ? "셸 스크립트 가짜 git" : false,
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), "colonova-git-recheck-"));
  try {
    const git = join(dir, "git");
    const env = { ...process.env, COLONOVA_DESIGN_GIT_BIN: git };
    assert.equal(await resolveGitExecutable(env), null);

    writeFileSync(git, "#!/bin/sh\necho 'git version 2.99.0'\n");
    chmodSync(git, 0o755);
    assert.equal(await resolveGitExecutable(env), null, "기억이 있는 동안은 다시 찾지 않는다");

    forgetMissingGit();
    assert.equal(await resolveGitExecutable(env), git);

    rmSync(git);
    forgetMissingGit();
    assert.equal(await resolveGitExecutable(env), git, "찾은 경로는 git 호출마다 다시 찾지 않는다");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
