import assert from "node:assert/strict";
import { test } from "node:test";
import { GitHubClient, HttpError } from "../dist/github.js";
import { FixtureTransport } from "../dist/rest-transport.js";

const path = "/repos/team/app/pulls/42";
const author = "inkwonjung-colosseum";
const other = "yongilhong-colosseum";
const cite =
  "https://docs.github.com/en/rest/pulls/review-requests#request-reviewers-for-a-pull-request";

function setup(reviewers: string[], response?: { status: number; json: unknown }) {
  const transport = new FixtureTransport([
    {
      name: "Read the actual PR author, independently of the token owner",
      cite: "https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request",
      request: { method: "GET", url: path },
      response: {
        status: 200,
        json: {
          user: { login: author },
          requested_reviewers: reviewers.map((login) => ({ login })),
        },
      },
    },
    ...(response
      ? [
          {
            name: "Only the eligible reviewer is requested",
            cite,
            request: {
              method: "POST",
              url: `${path}/requested_reviewers`,
              bodyJson: { reviewers: [other] },
            },
            response,
          },
        ]
      : []),
  ]);
  return { client: new GitHubClient("fixture-token", transport), transport };
}

test("PR 작성자·중복을 제외하고 다른 리뷰어를 요청하며 서버의 목록을 반환한다", async () => {
  const { client, transport } = setup([], {
    status: 201,
    json: { requested_reviewers: [{ login: other }] },
  });
  assert.deepEqual(
    await client.requestReviewers({
      owner: "team",
      repo: "app",
      number: 42,
      reviewers: [author.toUpperCase(), ` ${other} `, other.toUpperCase()],
    }),
    [other],
  );
  assert.equal(transport.pending, 0);
});

test("작성자와 이미 요청된 리뷰어뿐이면 다시 POST 하지 않는다", async () => {
  const { client, transport } = setup([other]);
  assert.deepEqual(
    await client.requestReviewers({
      owner: "team",
      repo: "app",
      number: 42,
      reviewers: [author, other],
    }),
    [other],
  );
  assert.equal(transport.pending, 0);
});

test("작성자만 지정된 경우 빈 리뷰 요청을 보내지 않는다", async () => {
  const { client, transport } = setup([]);
  assert.deepEqual(
    await client.requestReviewers({
      owner: "team",
      repo: "app",
      number: 42,
      reviewers: [author],
    }),
    [],
  );
  assert.equal(transport.pending, 0);
});

for (const status of [403, 422, 500]) {
  test(`리뷰 요청 ${status} 오류가 호출자에게 전달된다`, async () => {
    const { client, transport } = setup([], { status, json: { message: "Review request failed" } });
    await assert.rejects(
      client.requestReviewers({
        owner: "team",
        repo: "app",
        number: 42,
        reviewers: [author, other],
      }),
      (error) => error instanceof HttpError && error.status === status,
    );
    assert.equal(transport.pending, 0);
  });
}
