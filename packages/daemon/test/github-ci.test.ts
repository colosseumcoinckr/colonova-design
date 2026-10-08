import assert from "node:assert/strict";
import { test } from "node:test";
import { GitHubClient } from "../dist/github.js";
import type { RestTransport } from "../dist/rest-transport.js";

/**
 * 자동 검사(체크 런) · 줄 단위 안내 · 승인 읽기(2026-10-07 베타 준비 분석 · W6) — 가짜 전송으로 진짜 클라이언트를
 * 돌린다. 던지지 않는 것(권한 없음 · 닿지 못함은 `readable: false`)이 이 읽기의 약속이다. 프로세스를 띄우지 않는
 * 순수 시험이다.
 */

const SHA = "a".repeat(40);
const to = { owner: "team", repo: "app" };

type Reply = { status: number; json?: unknown; link?: string } | Error;

/** 주소별로 답을 돌려주고 부른 주소를 모은다. */
function fake(routes: Record<string, Reply | Reply[]>): { client: GitHubClient; calls: string[] } {
  const calls: string[] = [];
  const queues = new Map(
    Object.entries(routes).map(([url, reply]) => [
      url,
      Array.isArray(reply) ? [...reply] : [reply],
    ]),
  );
  const transport: RestTransport = {
    async request(input) {
      calls.push(input.url);
      const queue = queues.get(input.url);
      const reply = queue && queue.length > 1 ? queue.shift() : queue?.[0];
      if (reply === undefined) return { status: 404, body: new TextEncoder().encode("{}") };
      if (reply instanceof Error) throw reply;
      return {
        status: reply.status,
        body: new TextEncoder().encode(JSON.stringify(reply.json ?? {})),
        headers: reply.link ? { link: reply.link } : {},
      };
    },
  };
  return { client: new GitHubClient("t", transport), calls };
}

const CHECKS_URL = `/repos/team/app/commits/${SHA}/check-runs?per_page=100`;

test("listCheckRuns — 이름 · 상태 · 결론 · 짧은 출력 · 안내 수를 읽고, 긴 글은 읽는 순간 자른다", async () => {
  const { client } = fake({
    [CHECKS_URL]: {
      status: 200,
      json: {
        total_count: 2,
        check_runs: [
          {
            id: 11,
            name: "build",
            status: "completed",
            conclusion: "failure",
            html_url: "https://github.com/team/app/runs/11",
            output: {
              title: "빌드 실패",
              summary: "가".repeat(9000),
              text: "나".repeat(9000),
              annotations_count: 3,
            },
          },
          { id: 12, name: "lint", status: "in_progress", conclusion: null, output: {} },
          { id: "x", name: "깨진 행" },
        ],
      },
    },
  });
  const read = await client.listCheckRuns({ ...to, sha: SHA });
  assert.ok(read.readable);
  assert.equal(read.runs.length, 2, "id 가 정수가 아닌 행은 버린다");
  assert.deepEqual(
    { ...read.runs[0], summary: read.runs[0]?.summary.length, text: read.runs[0]?.text.length },
    {
      id: 11,
      name: "build",
      status: "completed",
      conclusion: "failure",
      title: "빌드 실패",
      summary: 2000,
      text: 4000,
      url: "https://github.com/team/app/runs/11",
      annotations: 3,
    },
  );
  assert.equal(read.runs[1]?.conclusion, null);
  assert.equal(read.runs[1]?.annotations, 0);
});

test("listCheckRuns — 검사가 하나도 없는 레포는 읽힌 빈 목록이다(읽지 못함이 아니다)", async () => {
  const { client } = fake({
    [CHECKS_URL]: { status: 200, json: { total_count: 0, check_runs: [] } },
  });
  const read = await client.listCheckRuns({ ...to, sha: SHA });
  assert.deepEqual(read, { readable: true, runs: [] });
});

test("listCheckRuns — 페이지를 따라가되 세 쪽에서 멈춘다", async () => {
  const page = (id: number, next?: string) => ({
    status: 200,
    json: {
      total_count: 9,
      check_runs: [{ id, name: `n${id}`, status: "completed", conclusion: "success" }],
    },
    ...(next ? { link: `<${next}>; rel="next"` } : {}),
  });
  const p2 = `/repos/team/app/commits/${SHA}/check-runs?per_page=100&page=2`;
  const p3 = `/repos/team/app/commits/${SHA}/check-runs?per_page=100&page=3`;
  const p4 = `/repos/team/app/commits/${SHA}/check-runs?per_page=100&page=4`;
  const { client, calls } = fake({
    [CHECKS_URL]: page(1, p2),
    [p2]: page(2, p3),
    [p3]: page(3, p4),
    [p4]: page(4),
  });
  const read = await client.listCheckRuns({ ...to, sha: SHA });
  assert.ok(read.readable);
  assert.deepEqual(
    read.runs.map((run) => run.id),
    [1, 2, 3],
  );
  assert.equal(calls.length, 3, "네 번째 쪽은 부르지 않는다");
});

test("listCheckRuns — 권한이 없으면 forbidden(403 · 401 · 404), 그 밖의 실패는 unavailable, 던지지 않는다", async () => {
  for (const status of [401, 403, 404]) {
    const { client } = fake({
      [CHECKS_URL]: {
        status,
        json: { message: "Resource not accessible by personal access token" },
      },
    });
    assert.deepEqual(await client.listCheckRuns({ ...to, sha: SHA }), {
      readable: false,
      reason: "forbidden",
    });
  }
  for (const reply of [
    { status: 500, json: {} },
    { status: 502, json: {} },
    new Error("ECONNRESET"),
  ]) {
    const { client } = fake({ [CHECKS_URL]: reply });
    assert.deepEqual(await client.listCheckRuns({ ...to, sha: SHA }), {
      readable: false,
      reason: "unavailable",
    });
  }
  // sha 가 아닌 값은 주소에 싣지 않는다.
  const { client, calls } = fake({});
  assert.deepEqual(await client.listCheckRuns({ ...to, sha: "../../etc" }), {
    readable: false,
    reason: "unavailable",
  });
  assert.equal(calls.length, 0);
});

test("listCheckRuns — 한도의 403 · 429 는 forbidden 이 아니라 unavailable 이다: 시간이 푼다(2026-10-08 F13)", async () => {
  for (const reply of [
    {
      status: 403,
      json: {
        message:
          "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
      },
    },
    { status: 403, json: { message: "API rate limit exceeded for user ID 1." } },
    { status: 429, json: { message: "Too Many Requests" } },
  ]) {
    const { client } = fake({ [CHECKS_URL]: reply });
    assert.deepEqual(await client.listCheckRuns({ ...to, sha: SHA }), {
      readable: false,
      reason: "unavailable",
    });
  }
  // 권한의 403 은 그대로 forbidden — 같은 분류기가 가른다.
  const { client } = fake({ [CHECKS_URL]: { status: 403, json: { message: "Forbidden" } } });
  assert.deepEqual(await client.listCheckRuns({ ...to, sha: SHA }), {
    readable: false,
    reason: "forbidden",
  });
});

test("listCheckAnnotations — 줄 단위 안내를 읽고, 못 읽으면 빈 목록이다", async () => {
  const url = "/repos/team/app/check-runs/11/annotations?per_page=50";
  const { client } = fake({
    [url]: {
      status: 200,
      json: [
        {
          path: "src/a.ts",
          start_line: 7,
          annotation_level: "failure",
          title: "no-any",
          message: "x",
        },
        { path: "src/b.ts", annotation_level: "warning", message: "y" },
      ],
    },
  });
  assert.deepEqual(await client.listCheckAnnotations({ ...to, checkRunId: 11 }), [
    { path: "src/a.ts", line: 7, level: "failure", title: "no-any", message: "x" },
    { path: "src/b.ts", line: null, level: "warning", title: "", message: "y" },
  ]);
  const broken = fake({ [url]: { status: 403, json: { message: "no" } } });
  assert.deepEqual(await broken.client.listCheckAnnotations({ ...to, checkRunId: 11 }), []);
  assert.deepEqual(await broken.client.listCheckAnnotations({ ...to, checkRunId: 0 }), []);
});

/** getPullRequest 가 읽는 두 주소 — PR 본문과 리뷰 목록. */
function pullWithReviews(reviews: Array<{ login: string; state: string }>) {
  return fake({
    "/repos/team/app/pulls/7": {
      status: 200,
      json: {
        number: 7,
        html_url: "https://github.com/team/app/pull/7",
        title: "t",
        state: "open",
        head: { ref: "b", sha: SHA },
        mergeable_state: "blocked",
      },
    },
    "/repos/team/app/pulls/7/reviews?per_page=100": {
      status: 200,
      json: reviews.map((review, index) => ({
        id: index + 1,
        user: { login: review.login },
        state: review.state,
      })),
    },
  }).client;
}

test("승인 — 마지막 판정이 APPROVED 이고 변경을 청한 사람이 없을 때만 approved", async () => {
  const read = async (reviews: Array<{ login: string; state: string }>) =>
    await pullWithReviews(reviews).getPullRequest({ ...to, number: 7 });
  const approved = await read([{ login: "dev1", state: "APPROVED" }]);
  assert.equal(approved.approved, true);
  assert.equal(approved.state, "open");
  assert.equal(approved.mergeableState, "blocked", "mergeable_state 는 그대로 읽는다");
  // 변경을 청했다가 같은 사람이 승인 — 승인이다.
  assert.equal(
    (
      await read([
        { login: "dev1", state: "CHANGES_REQUESTED" },
        { login: "dev1", state: "APPROVED" },
      ])
    ).approved,
    true,
  );
  // 다른 사람이 변경을 청했으면 승인이 아니다.
  const mixed = await read([
    { login: "dev1", state: "APPROVED" },
    { login: "dev2", state: "CHANGES_REQUESTED" },
  ]);
  assert.equal(mixed.approved, undefined);
  assert.equal(mixed.state, "changes_requested");
  // 철회된 승인 · 코멘트만 있는 리뷰는 승인이 아니다.
  assert.equal(
    (
      await read([
        { login: "dev1", state: "APPROVED" },
        { login: "dev1", state: "DISMISSED" },
      ])
    ).approved,
    undefined,
  );
  assert.equal((await read([{ login: "dev1", state: "COMMENTED" }])).approved, undefined);
  assert.equal((await read([])).approved, undefined);
});
