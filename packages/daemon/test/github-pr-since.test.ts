import assert from "node:assert/strict";
import { test } from "node:test";
import { GitHubClient } from "../dist/github.js";
import { FixtureTransport } from "../dist/rest-transport.js";

/**
 * 요청이 열린 때(2026-10-07 UX 점검 3단계) — PR 응답의 `created_at` 이 `since` 로 읽힌다. 읽을 수 없는 날짜는 없는
 * 것이다: 깨진 값으로 며칠째를 말하지 않는다.
 */
const path = "/repos/team/app/pulls/42";

function clientWith(createdAt: unknown) {
  const transport = new FixtureTransport([
    {
      name: "Read the pull request",
      cite: "https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request",
      request: { method: "GET", url: path },
      response: {
        status: 200,
        json: {
          number: 42,
          html_url: "https://github.com/team/app/pull/42",
          title: "feat(members): 회원 목록 검색",
          state: "open",
          head: { ref: "colonova-design/20261001-1", sha: "a".repeat(40) },
          requested_reviewers: [{ login: "kim" }],
          created_at: createdAt,
        },
      },
    },
  ]);
  return new GitHubClient("fixture-token", transport);
}

test("getPullRequest: created_at 이 since 로 선다", async () => {
  const pull = await clientWith("2026-10-01T01:35:00Z").getPullRequest({
    owner: "team",
    repo: "app",
    number: 42,
  });
  assert.equal(pull.since, "2026-10-01T01:35:00Z");
  assert.deepEqual(pull.reviewers, ["kim"]);
});

test("getPullRequest: 읽히지 않는 created_at 은 since 가 없다", async () => {
  for (const bad of ["어제", null, 20261001, undefined]) {
    const pull = await clientWith(bad).getPullRequest({ owner: "team", repo: "app", number: 42 });
    assert.equal(pull.since, undefined, `${String(bad)}`);
    assert.equal(pull.number, 42);
  }
});
