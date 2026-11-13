import assert from "node:assert/strict";
import { test } from "node:test";
import { GitHubClient } from "../dist/github.js";
import { FixtureTransport } from "../dist/rest-transport.js";

/**
 * 제출이 여는 PR 은 GitHub 초안(draft)이다(2026-11-13 사용자 결정) — 검토 준비
 * 표시는 개발자의 손에 남는다. 몸통은 `bodyJson` 과 전체가 같아야 하므로 `draft`
 * 를 빼면 fixture 가 맞지 않아 시험이 진다.
 */
const create = {
  name: "Create a draft pull request",
  cite: "https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request",
  request: {
    method: "POST",
    url: "/repos/team/app/pulls",
    bodyJson: {
      title: "feat: 회원 목록에 이름 검색 추가 (작성자: 김기획)",
      body: "<!-- colonova-design:start -->",
      head: "colonova-design/kim/20261113-1-a1b2",
      base: "main",
      draft: true,
    },
  },
  response: {
    status: 201,
    json: {
      number: 9,
      html_url: "https://github.com/team/app/pull/9",
      title: "feat: 회원 목록에 이름 검색 추가 (작성자: 김기획)",
      state: "open",
      draft: true,
      head: { ref: "colonova-design/kim/20261113-1-a1b2", sha: "a".repeat(40) },
    },
  },
};

test("createPullRequest: GitHub 초안(draft)으로 연다", async () => {
  const transport = new FixtureTransport([create]);
  const client = new GitHubClient("fixture-token", transport);
  const pull = await client.createPullRequest({
    owner: "team",
    repo: "app",
    head: "colonova-design/kim/20261113-1-a1b2",
    base: "main",
    title: "feat: 회원 목록에 이름 검색 추가 (작성자: 김기획)",
    body: "<!-- colonova-design:start -->",
  });
  assert.equal(pull.number, 9);
  assert.equal(pull.state, "open");
  assert.equal(transport.pending, 0, "몸통(초안 포함)이 fixture 와 같아야 한다");
});
