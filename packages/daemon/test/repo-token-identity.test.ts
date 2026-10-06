import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { GitHubClient } from "../dist/github.js";
import { RepoCore } from "../dist/repo-core.js";
import type { RestTransport } from "../dist/rest-transport.js";
import { makeClone, makeRemote } from "./helpers/cycle-harness.ts";

function accountTransport() {
  const requests: string[] = [];
  let status = 200;
  let account: unknown = { login: "invite-bot", id: 123 };
  const transport: RestTransport = {
    async request(input) {
      assert.equal(input.url, "/user");
      requests.push(input.headers.Authorization ?? input.headers.authorization ?? "");
      return { status, body: Buffer.from(JSON.stringify(account)) };
    },
  };
  return {
    transport,
    requests,
    respond(next: unknown, code = 200) {
      account = next;
      status = code;
    },
  };
}

test("토큰 계정은 /user를 공유하고 교체 때 다시 읽는다", async () => {
  const api = accountTransport();
  const client = new GitHubClient("first-token", api.transport);
  assert.deepEqual(await client.whoAmI(), { ok: true, login: "invite-bot" });
  assert.deepEqual(await client.commitIdentity(), {
    name: "invite-bot",
    email: "123+invite-bot@users.noreply.github.com",
  });
  assert.equal(api.requests.length, 1);
  api.respond({ login: "second-bot", id: 456 });
  assert.deepEqual(await new GitHubClient("second-token", api.transport).commitIdentity(), {
    name: "second-bot",
    email: "456+second-bot@users.noreply.github.com",
  });
  assert.equal(api.requests.length, 2);
  assert.notEqual(api.requests[0], api.requests[1]);
});

test("계정 확인 실패와 불완전한 응답은 개인 작성자로 대체하지 않고 재시도한다", async () => {
  const api = accountTransport();
  const client = new GitHubClient("bad-token", api.transport);
  api.respond({}, 401);
  await assert.rejects(client.commitIdentity(), /연결 코드/);
  api.respond({ login: "invite-bot" });
  await assert.rejects(client.commitIdentity(), /계정 정보/);
  api.respond({ login: "invite-bot", id: 123 });
  assert.equal((await client.commitIdentity()).name, "invite-bot");
  assert.equal(api.requests.length, 3);
});

test("개인 설정·환경변수·서명이 있어도 실제 커밋과 stash는 토큰 계정으로 기록한다", async () => {
  const remote = await makeRemote();
  const clone = await makeClone(remote);
  const api = accountTransport();
  const core = new RepoCore({
    root: clone.path,
    url: remote.path,
    onStatus: () => {},
    authorName: () => "초대받은 사람",
    gitHubClient: () => new GitHubClient("invite-token", api.transport),
  });
  const keys = [
    "GIT_CONFIG_GLOBAL",
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const globalPath = join(clone.dir, "personal.gitconfig");
  const config =
    "[user]\n name = Personal\n email = personal@example.test\n" +
    "[author]\n name = Personal Author\n email = author@example.test\n" +
    "[committer]\n name = Personal Committer\n email = committer@example.test\n" +
    "[commit]\n gpgSign = true\n[gpg]\n program = /nonexistent-personal-signer\n";
  writeFileSync(globalPath, config);
  process.env.GIT_CONFIG_GLOBAL = globalPath;
  process.env.GIT_AUTHOR_NAME = "Environment Author";
  process.env.GIT_AUTHOR_EMAIL = "env-author@example.test";
  process.env.GIT_COMMITTER_NAME = "Environment Committer";
  process.env.GIT_COMMITTER_EMAIL = "env-committer@example.test";
  const localPath = join(clone.path, ".git", "config");
  const localBefore = readFileSync(localPath, "utf8");
  const expected =
    "invite-bot|123+invite-bot@users.noreply.github.com|" +
    "invite-bot|123+invite-bot@users.noreply.github.com";
  const identity = (ref: string) => core.git(["show", "-s", "--format=%an|%ae|%cn|%ce", ref]);
  try {
    await core.lane.run("save", async () => {
      await core.git(["checkout", "-b", "identity-test"]);
      writeFileSync(join(clone.path, "README.md"), "token identity\n");
      await core.git(["add", "README.md"]);
      await core.git([...(await core.identityArgs()), "commit", "-m", "token commit"]);
      await core.git(["push", "origin", "identity-test"]);
      assert.equal((await identity("HEAD")).trim(), expected);
      assert.equal((await identity("origin/identity-test")).trim(), expected);
      const tree = (await core.git(["rev-parse", "HEAD^{tree}"])).trim();
      const shot = (
        await core.git([...(await core.identityArgs()), "commit-tree", tree, "-m", "capture"])
      ).trim();
      assert.equal((await identity(shot)).trim(), expected);
      writeFileSync(join(clone.path, "README.md"), "parked work\n");
      assert.equal(await core.stashUnsavedWork(), true);
      assert.equal((await identity("refs/stash")).trim(), expected);
      await core.git(["checkout", "-b", "developer-work", "main"]);
      writeFileSync(join(clone.path, "developer.txt"), "original work\n");
      await core.git(["add", "developer.txt"]);
      await core.git([
        ...(await core.identityArgs()),
        "commit",
        "--author=Developer <developer@example.test>",
        "-m",
        "original author",
      ]);
      const original = (await core.git(["rev-parse", "HEAD"])).trim();
      await core.git(["checkout", "identity-test"]);
      await core.git([...(await core.identityArgs()), "cherry-pick", original]);
      assert.equal(
        (await identity("HEAD")).trim(),
        "Developer|developer@example.test|invite-bot|123+invite-bot@users.noreply.github.com",
      );
      await core.git([
        ...(await core.identityArgs()),
        "merge",
        "--no-ff",
        "--no-edit",
        "developer-work",
      ]);
      assert.equal((await identity("HEAD")).trim(), expected);
    });
    assert.equal(readFileSync(globalPath, "utf8"), config);
    assert.equal(readFileSync(localPath, "utf8"), localBefore);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clone.dispose();
    remote.dispose();
  }
});

test("GitHub 연결 코드가 없으면 기존 개인 설정으로 기록하지 않는다", async () => {
  const core = new RepoCore({
    root: "/unused",
    url: "https://github.com/team/repo.git",
    onStatus: () => {},
  });
  await assert.rejects(core.identityArgs(), /연결 코드/);
  await assert.rejects(core.git(["ls-remote", "origin"]), /연결 코드/);
  core.url = "git@github.com:team/repo.git";
  await assert.rejects(core.identityArgs(), /연결 코드/);
  core.setPat("token");
  await assert.rejects(core.git(["ls-remote", "origin"]), /HTTPS/);
});

test("GitHub 통신은 개인 HTTPS→SSH 전역 설정을 읽지 않는다", async () => {
  const remote = await makeRemote();
  const clone = await makeClone(remote);
  const core = new RepoCore({
    root: clone.path,
    url: "https://github.com/team/repo.git",
    pat: "invite-token",
    onStatus: () => {},
  });
  const globalPath = join(clone.dir, "personal.gitconfig");
  const config = '[url "git@github.com:"]\n insteadOf = https://github.com/\n';
  writeFileSync(globalPath, config);
  const previous = process.env.GIT_CONFIG_GLOBAL;
  try {
    await core.lane.run("hygiene", () =>
      core.git(["remote", "set-url", "origin", "https://github.com/team/repo.git"]),
    );
    process.env.GIT_CONFIG_GLOBAL = globalPath;
    assert.equal(
      (await core.git(["remote", "get-url", "--push", "origin"])).trim(),
      "git@github.com:team/repo.git",
    );
    // 외부 요청 직전의 실행 환경으로 실제 Git의 주소 해석만 검사한다.
    const capture = core.capture.bind(core);
    core.capture = (command, options) =>
      capture(command, options, ["remote", "get-url", "--push", "origin"]);
    assert.equal(
      (await core.git(["ls-remote", "origin"])).trim(),
      "https://github.com/team/repo.git",
    );
    assert.equal(readFileSync(globalPath, "utf8"), config);
  } finally {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
    clone.dispose();
    remote.dispose();
  }
});

test("푸시 인증은 토큰 교체를 반영하고 개인 인증 도우미를 끈다", () => {
  const core = new RepoCore({
    root: "/unused",
    url: "https://github.com/team/repo.git",
    pat: "first-token",
    onStatus: () => {},
  });
  const first = core.gitAuthEnv();
  assert.equal(first.GIT_CONFIG_VALUE_0, "");
  assert.equal(first.GIT_CONFIG_KEY_2, "credential.helper");
  assert.equal(first.GIT_CONFIG_VALUE_2, "");
  assert.equal(first.GIT_CONFIG_KEY_4, "core.askPass");
  assert.equal(first.GIT_CONFIG_VALUE_4, "");
  assert.equal(first.GIT_ASKPASS, undefined);
  assert.equal(first.SSH_ASKPASS, undefined);
  core.setPat("second-token");
  const next = core.gitAuthEnv();
  assert.equal(
    next.GIT_CONFIG_VALUE_1,
    `AUTHORIZATION: basic ${Buffer.from("x-access-token:second-token").toString("base64")}`,
  );
  assert.notEqual(next.GIT_CONFIG_VALUE_1, first.GIT_CONFIG_VALUE_1);
  core.url = "https://example.test/team/repo.git";
  assert.deepEqual(core.gitAuthEnv(), {});
});
