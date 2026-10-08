// 초대장 사전 점검(site/invite-check.mjs) — 가짜 GitHub 전송으로 한다. 순수 시험이다:
// 프로세스도 네트워크도 없다. 이 모듈은 브라우저(site/invite.js)와 터미널
// (scripts/make-invite.mjs)이 같이 읽으므로, 두 곳의 문장 · 판정이 여기 한 군데에서 선다.
// 점검의 약속 — 부작용 0 — 도 여기서 센다: 보내는 것은 GET 과 일부러 실패하게 만든 예행 POST 셋뿐이다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 패키지 바깥의 파일 경로라 정적 import 로는 쓸 수 없다(invite-format.test.ts 와 같은 길).
const check = await import(new URL("../../../site/invite-check.mjs", import.meta.url).href);
const {
  BUNDLED_NODE_MAJOR,
  ENV_SAMPLES,
  LOCKFILES,
  MARK,
  PREVIEW_SCRIPTS,
  checkRepo,
  checkReviewers,
  checkToken,
  formatReport,
  githubRepoOf,
  nodeRangeAllows,
  npmrcFindings,
  runInviteCheck,
  scopesOf,
} = check;

type Reply = { status: number; headers?: Record<string, string>; json?: unknown };
type Route = Reply | ((body: unknown) => Reply) | "throw";

/** 경로표로 답하는 가짜 전송 — 없는 경로는 GitHub 처럼 404 로 답하고, 부른 것을 모두 적어 둔다. */
function fakeGitHub(routes: Record<string, Route>) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const request = async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    const hit = routes[`${method} ${path}`];
    if (hit === "throw") throw new Error("fetch failed");
    if (hit === undefined) return { status: 404, headers: {}, json: { message: "Not Found" } };
    const reply = typeof hit === "function" ? hit(body) : hit;
    return { status: reply.status, headers: reply.headers ?? {}, json: reply.json ?? null };
  };
  return { request, calls };
}

const REPO = "/repos/org/app";
const URL_APP = "https://github.com/org/app.git";

/** 파일 본문 — contents API 의 base64 봉투. */
const file = (value: unknown) => ({
  encoding: "base64",
  content: Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString(
    "base64",
  ),
});
const listing = (...names: string[]) => names.map((name) => ({ name, type: "file" }));

const NOT_ACCESSIBLE = {
  status: 403,
  json: { message: "Resource not accessible by personal access token" },
};

/** 아무 문제 없는 세밀한 토큰의 세계 — 시험마다 한두 줄만 갈아 끼운다. */
function healthy(extra: Record<string, Route> = {}): Record<string, Route> {
  return {
    "GET /user": { status: 200, json: { login: "colonova-bot" } },
    [`GET ${REPO}`]: {
      status: 200,
      json: {
        full_name: "org/app",
        private: true,
        default_branch: "main",
        archived: false,
        has_issues: true,
        permissions: { push: true },
      },
    },
    [`POST ${REPO}/pulls`]: {
      status: 422,
      json: {
        message: "Validation Failed",
        errors: [{ resource: "PullRequest", field: "head", code: "invalid" }],
      },
    },
    [`POST ${REPO}/git/refs`]: { status: 422, json: { message: "Object does not exist" } },
    [`POST ${REPO}/issues`]: { status: 422, json: { message: "Invalid request." } },
    [`GET ${REPO}/contents`]: {
      status: 200,
      json: listing("package.json", "pnpm-lock.yaml", "src"),
    },
    [`GET ${REPO}/contents/package.json`]: {
      status: 200,
      json: file({ name: "app", scripts: { dev: "vite" } }),
    },
    ...extra,
  };
}

const find = (items: Array<{ id: string; status: string; text: string }>, id: string) =>
  items.filter((entry) => entry.id === id);
const only = (items: Array<{ id: string; status: string; text: string }>, id: string) => {
  const found = find(items, id);
  assert.equal(
    found.length,
    1,
    `${id} 한 줄이어야 한다 — ${JSON.stringify(items.map((e) => e.id))}`,
  );
  return found[0];
};

async function repoCheck(routes: Record<string, Route>, over: Record<string, unknown> = {}) {
  const world = fakeGitHub(routes);
  const result = await checkRepo(world.request, {
    owner: "org",
    repo: "app",
    scopes: null,
    login: "colonova-bot",
    ...over,
  });
  return { ...result, calls: world.calls };
}

// ————— 건강한 세계 · 부작용 0 —————

test("건강한 세밀한 토큰 — 전부 통과하고 막지 않는다", async () => {
  const world = fakeGitHub(healthy());
  const result = await runInviteCheck({
    request: world.request,
    projects: [{ repoUrl: URL_APP }],
    reviewers: ["dev1"],
  });
  assert.equal(result.blocking, false);
  assert.equal(result.counts.fail, 0);
  assert.equal(result.counts.warn, 0);
  assert.equal(result.counts.unknown, 0);
  const items = result.projects[0].items;
  for (const id of ["repo", "pr", "contents", "notify", "lockfile", "preview", "reviewers"]) {
    assert.equal(only(items, id).status, "pass", id);
  }
  assert.match(result.token.items[0].text, /@colonova-bot 계정의 것이에요/);
  assert.equal(result.projects[0].info.defaultBranch, "main");
});

test("부작용 0 — GET 과 일부러 실패하게 만든 예행 POST 셋만 보낸다", async () => {
  const world = fakeGitHub(healthy());
  await runInviteCheck({ request: world.request, projects: [{ repoUrl: URL_APP }] });
  // PUT · PATCH · DELETE 는 한 번도 없다.
  assert.deepEqual([...new Set(world.calls.map((call) => call.method))].sort(), ["GET", "POST"]);
  const posts = world.calls.filter((call) => call.method === "POST");
  assert.deepEqual(posts.map((call) => call.path).sort(), [
    `${REPO}/git/refs`,
    `${REPO}/issues`,
    `${REPO}/pulls`,
  ]);
  // 풀 리퀘스트 — head 가 이 세상에 없는 브랜치라 만들어질 수 없다.
  const pull = posts.find((call) => call.path.endsWith("/pulls"))?.body as Record<string, string>;
  assert.match(pull.head, /^colonova-design-invite-check-[0-9a-f]{12}$/);
  assert.equal(pull.base, "main");
  // ref — 이 세상에 없는 객체를 가리킨다(40자리 0).
  const ref = posts.find((call) => call.path.endsWith("/git/refs"))?.body as Record<string, string>;
  assert.equal(ref.sha, "0".repeat(40));
  assert.match(ref.ref, /^refs\/heads\/colonova-design-invite-check-[0-9a-f]{12}$/);
  // 이슈 — 제목이 없다.
  const issue = posts.find((call) => call.path.endsWith("/issues"))?.body;
  assert.deepEqual(issue, {});
  // 같은 예행 두 번은 다른 이름을 쓴다(꼬리가 난수다).
  const again = fakeGitHub(healthy());
  await runInviteCheck({ request: again.request, projects: [{ repoUrl: URL_APP }] });
  const pull2 = again.calls.find((call) => call.path.endsWith("/pulls"))?.body as Record<
    string,
    string
  >;
  assert.notEqual(pull2.head, pull.head);
});

// ————— 1. 연결 코드 —————

test("연결 코드 401 — 확정 실패, 레포는 묻지 않는다", async () => {
  const world = fakeGitHub({ "GET /user": { status: 401, json: { message: "Bad credentials" } } });
  const result = await runInviteCheck({ request: world.request, projects: [{ repoUrl: URL_APP }] });
  assert.equal(result.blocking, true);
  assert.equal(result.token.items[0].status, "fail");
  assert.match(result.token.items[0].text, /401/);
  assert.deepEqual(
    world.calls.map((call) => `${call.method} ${call.path}`),
    ["GET /user"],
  );
  assert.deepEqual(result.projects[0].items, [], "코드가 거절됐으면 레포 줄은 말이 없다");
});

test("연결 코드 — 전송 실패 · 한도는 확인할 수 없어요이고 막지 않는다", async () => {
  const dead = await runInviteCheck({
    request: fakeGitHub({ "GET /user": "throw" }).request,
    projects: [{ repoUrl: URL_APP }],
  });
  assert.equal(dead.blocking, false);
  assert.equal(dead.token.items[0].status, "unknown");
  assert.match(dead.token.items[0].text, /GitHub 에 닿지 못해/);
  assert.equal(dead.projects[0].items[0].status, "unknown", "레포는 코드를 못 읽어 건너뛴다");
  const limited = await checkToken(
    fakeGitHub({
      "GET /user": {
        status: 403,
        headers: { "x-ratelimit-remaining": "0" },
        json: { message: "API rate limit exceeded" },
      },
    }).request,
  );
  assert.equal(limited.items[0].status, "unknown");
  assert.match(limited.items[0].text, /사용 한도/);
});

test("연결 코드 — 클래식은 범위를, 세밀한 코드는 그렇다고 말하고 만료일을 센다", async () => {
  const NOW = Date.parse("2026-10-07T00:00:00Z");
  const classic = await checkToken(
    fakeGitHub({
      "GET /user": {
        status: 200,
        headers: { "x-oauth-scopes": "repo, read:packages" },
        json: { login: "Bot" },
      },
    }).request,
    { now: NOW },
  );
  assert.equal(classic.login, "Bot");
  assert.deepEqual(classic.scopes, ["repo", "read:packages"]);
  assert.match(classic.items[0].text, /클래식 코드 · 범위 repo, read:packages/);
  const fine = await checkToken(
    fakeGitHub({ "GET /user": { status: 200, json: { login: "Bot" } } }).request,
  );
  assert.equal(fine.scopes, null);
  assert.match(fine.items[0].text, /세밀한 코드/);
  // 만료 — 지남 · 30일 안 · 그보다 멀다. 머리글이 없으면 말이 없다.
  const expiry = async (header: string | undefined) =>
    (
      await checkToken(
        fakeGitHub({
          "GET /user": {
            status: 200,
            headers:
              header === undefined ? {} : { "github-authentication-token-expiration": header },
            json: { login: "Bot" },
          },
        }).request,
        { now: NOW },
      )
    ).items.filter((entry: { id: string }) => entry.id === "expiry");
  assert.equal((await expiry(undefined)).length, 0);
  assert.equal((await expiry("2026-10-01 00:00:00 UTC"))[0].status, "fail");
  const soon = (await expiry("2026-10-20 00:00:00 UTC"))[0];
  assert.equal(soon.status, "warn");
  assert.match(soon.text, /13일 남음/);
  const far = (await expiry("2027-01-05 00:00:00 UTC"))[0];
  assert.equal(far.status, "pass");
  assert.match(far.text, /달력에 적어 두세요/);
  assert.equal((await expiry("엉뚱한 값")).length, 0, "읽을 수 없는 머리글은 조용히 지나간다");
});

// ————— 2. 레포 —————

test("레포 404 — 없음과 권한 없음을 구분할 수 없다고 말한다 · 예행은 보내지 않는다", async () => {
  const { items, calls } = await repoCheck({});
  assert.equal(items.length, 1);
  assert.equal(items[0].status, "fail");
  assert.match(items[0].text, /404/);
  assert.match(items[0].text, /'없음'과 '권한 없음'을 같은 404 로 답해서 둘을 구분할 수 없어요/);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET"],
  );
});

test("레포 403 — SSO 승인이 필요하면 그렇게 말하고, 한도는 확인할 수 없어요다", async () => {
  const saml = await repoCheck({
    [`GET ${REPO}`]: {
      status: 403,
      json: { message: "Resource protected by organization SAML enforcement." },
    },
  });
  assert.equal(saml.items[0].status, "fail");
  assert.match(saml.items[0].text, /SSO 승인이 필요해요/);
  const limited = await repoCheck({
    [`GET ${REPO}`]: {
      status: 403,
      headers: { "x-ratelimit-remaining": "0" },
      json: { message: "API rate limit exceeded" },
    },
  });
  assert.equal(limited.items[0].status, "unknown");
  const dead = await repoCheck({ [`GET ${REPO}`]: "throw" });
  assert.equal(dead.items[0].status, "unknown");
  assert.equal(dead.calls.length, 1, "닿지 못하면 더 묻지 않는다");
});

test("보관된 레포 · 쓰기 권한 없음 · 클래식 범위 부족 — 확정 실패이고 예행은 보내지 않는다", async () => {
  const archived = await repoCheck(
    healthy({
      [`GET ${REPO}`]: {
        status: 200,
        json: { full_name: "org/app", private: true, default_branch: "main", archived: true },
      },
    }),
  );
  assert.equal(only(archived.items, "archived").status, "fail");
  const readOnly = await repoCheck(
    healthy({
      [`GET ${REPO}`]: {
        status: 200,
        json: {
          full_name: "org/app",
          private: true,
          default_branch: "main",
          permissions: { push: false },
        },
      },
    }),
  );
  assert.equal(only(readOnly.items, "push").status, "fail");
  assert.match(only(readOnly.items, "push").text, /@colonova-bot 계정에 쓰기 권한이 없거나/);
  const noScope = await repoCheck(healthy(), { scopes: ["read:user"] });
  assert.equal(only(noScope.items, "push").status, "fail");
  assert.match(only(noScope.items, "push").text, /repo 범위가 없어요/);
  for (const result of [archived, readOnly, noScope]) {
    assert.equal(
      result.calls.some((call: { method: string }) => call.method === "POST"),
      false,
      "쓸 수 없는 레포에는 예행도 보내지 않는다",
    );
  }
});

test("공개 레포는 public_repo 범위만으로도 쓴다 · 옮겨진 레포는 알린다", async () => {
  const publicRepo = {
    status: 200,
    json: {
      full_name: "Org/App",
      private: false,
      default_branch: "main",
      permissions: { push: true },
    },
  };
  const result = await repoCheck(healthy({ [`GET ${REPO}`]: publicRepo }), {
    scopes: ["public_repo"],
  });
  assert.equal(find(result.items, "push").length, 0);
  assert.equal(only(result.items, "public").status, "warn");
  assert.match(only(result.items, "public").text, /누구나 볼 수 있어요/);
  assert.equal(find(result.items, "moved").length, 0, "대소문자만 다른 것은 옮겨진 것이 아니다");
  const moved = await repoCheck(
    healthy({
      [`GET ${REPO}`]: {
        status: 200,
        json: { full_name: "org/renamed", private: true, default_branch: "main" },
      },
    }),
  );
  assert.equal(only(moved.items, "moved").status, "warn");
});

test("기본 브랜치가 아닌 base — 있는지 보고, 없으면 확정 실패", async () => {
  const world = healthy({
    [`GET ${REPO}/branches/develop`]: { status: 200, json: { name: "develop" } },
  });
  const ok = await repoCheck(world, { baseBranch: "develop" });
  assert.equal(only(ok.items, "base").status, "pass");
  const pull = ok.calls.find((call: { path: string }) => call.path.endsWith("/pulls"))
    ?.body as Record<string, string>;
  assert.equal(pull.base, "develop", "예행도 그 base 로 보낸다");
  const missing = await repoCheck(healthy(), { baseBranch: "release/x y" });
  assert.equal(only(missing.items, "base").status, "fail");
  assert.ok(
    missing.calls.some(
      (call: { path: string }) => call.path === `${REPO}/branches/release%2Fx%20y`,
    ),
    "브랜치 이름은 인코딩한다",
  );
  // 기본 브랜치와 같으면 묻지 않는다.
  const same = await repoCheck(healthy(), { baseBranch: "main" });
  assert.equal(find(same.items, "base").length, 0);
});

// ————— 3. 제출(풀 리퀘스트) 예행 —————

test("PR 예행 — 세밀한 토큰에 Pull requests 권한이 없으면 403 이 확정 실패다", async () => {
  const { items } = await repoCheck(healthy({ [`POST ${REPO}/pulls`]: NOT_ACCESSIBLE }));
  const pr = only(items, "pr");
  assert.equal(pr.status, "fail");
  assert.match(pr.text, /Pull requests: Read and write/);
  assert.match(pr.text, /같은 코드가 바로 풀려요/);
  assert.match(pr.text, /Resource not accessible by personal access token/);
});

test("PR 예행 — 한도 · 404 · 5xx · 전송 실패는 확인할 수 없어요이지 실패가 아니다", async () => {
  const cases: Array<[string, Route]> = [
    [
      "한도",
      {
        status: 403,
        json: { message: "You have exceeded a secondary rate limit. Please wait a few minutes." },
      },
    ],
    ["429", { status: 429, json: { message: "slow down" } }],
    ["404", { status: 404, json: { message: "Not Found" } }],
    ["502", { status: 502, json: null }],
    ["전송 실패", "throw"],
    ["다른 403", { status: 403, json: { message: "Must have admin rights to Repository." } }],
  ];
  for (const [name, route] of cases) {
    const { items } = await repoCheck(healthy({ [`POST ${REPO}/pulls`]: route }));
    assert.equal(only(items, "pr").status, "unknown", name);
  }
});

test("PR 예행 — base 가 틀렸다는 422 는 확정 실패, 201 은 숨기지 않고 알린다", async () => {
  const baseBad = await repoCheck(
    healthy({
      [`POST ${REPO}/pulls`]: {
        status: 422,
        json: { errors: [{ resource: "PullRequest", field: "base", code: "invalid" }] },
      },
    }),
  );
  assert.equal(only(baseBad.items, "pr").status, "fail");
  const created = await repoCheck(
    healthy({
      [`POST ${REPO}/pulls`]: {
        status: 201,
        json: { html_url: "https://github.com/org/app/pull/9" },
      },
    }),
  );
  assert.equal(only(created.items, "pr").status, "unknown");
  assert.match(only(created.items, "pr").text, /pull\/9/);
  assert.match(only(created.items, "pr").text, /만들어졌을 수 있으니/);
});

// ————— Contents(올리기) 예행 —————

test("올리기 예행 — Contents 권한이 없으면 확정 실패, 빈 레포는 경고", async () => {
  const noWrite = await repoCheck(healthy({ [`POST ${REPO}/git/refs`]: NOT_ACCESSIBLE }));
  assert.equal(only(noWrite.items, "contents").status, "fail");
  assert.match(only(noWrite.items, "contents").text, /Contents: Read and write/);
  const empty = await repoCheck(
    healthy({
      [`POST ${REPO}/git/refs`]: { status: 409, json: { message: "Git Repository is empty." } },
    }),
  );
  assert.equal(only(empty.items, "contents").status, "warn");
  const odd = await repoCheck(healthy({ [`POST ${REPO}/git/refs`]: { status: 500, json: null } }));
  assert.equal(only(odd.items, "contents").status, "unknown");
});

// ————— 4. 알림(이슈) —————

test("알림 — 세밀한 토큰은 예행으로 본다: 422 통과 · 403 경고(막지 않는다) · 410 경고", async () => {
  const ok = await repoCheck(healthy());
  assert.equal(only(ok.items, "notify").status, "pass");
  const denied = await repoCheck(healthy({ [`POST ${REPO}/issues`]: NOT_ACCESSIBLE }));
  assert.equal(only(denied.items, "notify").status, "warn");
  assert.match(only(denied.items, "notify").text, /Issues: Read and write/);
  assert.match(only(denied.items, "notify").text, /Slack/);
  const gone = await repoCheck(healthy({ [`POST ${REPO}/issues`]: { status: 410, json: null } }));
  assert.equal(only(gone.items, "notify").status, "warn");
  const unreadable = await repoCheck(healthy({ [`POST ${REPO}/issues`]: "throw" }));
  assert.equal(only(unreadable.items, "notify").status, "unknown");
  // 경고 · 확인할 수 없음은 만들기를 막지 않는다.
  const world = fakeGitHub(healthy({ [`POST ${REPO}/issues`]: NOT_ACCESSIBLE }));
  const run = await runInviteCheck({ request: world.request, projects: [{ repoUrl: URL_APP }] });
  assert.equal(run.blocking, false);
});

test("알림 — 클래식 코드는 범위가 답이라 이슈 예행을 보내지 않는다 · 이슈가 꺼진 레포는 경고", async () => {
  const withRepo = await repoCheck(healthy(), { scopes: ["repo"] });
  assert.equal(only(withRepo.items, "notify").status, "pass");
  assert.equal(
    withRepo.calls.some((call: { path: string }) => call.path.endsWith("/issues")),
    false,
  );
  // 공개 레포는 public_repo 범위로도 알림을 남긴다.
  const publicOnly = await repoCheck(
    healthy({
      [`GET ${REPO}`]: {
        status: 200,
        json: {
          full_name: "org/app",
          private: false,
          default_branch: "main",
          permissions: { push: true },
        },
      },
    }),
    { scopes: ["public_repo"] },
  );
  assert.equal(only(publicOnly.items, "notify").status, "pass");
  assert.match(only(publicOnly.items, "notify").text, /public_repo 범위/);
  const noIssues = await repoCheck(
    healthy({
      [`GET ${REPO}`]: {
        status: 200,
        json: { full_name: "org/app", private: true, default_branch: "main", has_issues: false },
      },
    }),
  );
  assert.equal(only(noIssues.items, "notify").status, "warn");
  assert.equal(
    noIssues.calls.some((call: { path: string }) => call.path.endsWith("/issues")),
    false,
    "꺼진 이슈에는 예행도 보내지 않는다",
  );
});

// ————— 5. 토큰 주인 ≠ 리뷰어 —————

test("리뷰어가 연결 코드의 주인이면 경고다 — 막지 않고, 대소문자 · @ 를 가리지 않는다", async () => {
  // 2026-10-08 검토 FIX1: 확정 실패(⛔)에서 경고(⚠️)로 낮췄다 — 앱은 표식 있는 앱 코멘트만 건너뛰고
  // requestReviewers 가 PR 작성자를 빼므로, 남는 것은 그 사람에게 리뷰 요청 알림이 안 간다는 사실뿐이다.
  const warn = checkReviewers({ login: "Colonova-Bot", reviewers: ["dev1", "@colonova-bot"] });
  assert.equal(warn.length, 1);
  assert.equal(warn[0].status, "warn");
  assert.equal(
    warn[0].text,
    "리뷰어에 연결 코드 주인(@colonova-bot)이 들어 있어요 — GitHub 은 PR 작성자에게 리뷰 요청을 보내지 않아서 이 사람에게는 알림이 가지 않아요(코멘트는 앱이 읽어요)",
  );
  assert.doesNotMatch(
    warn[0].text,
    /별도 계정|건너뛰어/,
    "옛 이유(코멘트를 건너뛴다)는 사실이 아니다",
  );
  assert.equal(checkReviewers({ login: "bot", reviewers: ["dev1"] })[0].status, "pass");
  assert.deepEqual(checkReviewers({ login: "bot", reviewers: [] }), []);
  assert.deepEqual(checkReviewers({ login: null, reviewers: ["bot"] }), []);
  // 한 번에 점검할 때는 프로젝트 줄에 얹히지만 만들기를 막지 않는다(터미널 생성기의 종료 코드는
  // blocking 이 정한다 → 0). 프로젝트의 리뷰어가 공통보다 먼저다.
  const world = fakeGitHub(healthy({ "GET /user": { status: 200, json: { login: "dev1" } } }));
  const run = await runInviteCheck({
    request: world.request,
    projects: [{ repoUrl: URL_APP }],
    reviewers: ["dev1"],
  });
  assert.equal(run.blocking, false);
  assert.equal(run.counts.fail, 0);
  assert.equal(run.counts.warn, 1);
  assert.equal(only(run.projects[0].items, "reviewers").status, "warn");
  const lines: string[] = formatReport(run);
  assert.ok(lines.some((line) => line.startsWith(`  ${MARK.warn} 리뷰어에 연결 코드 주인(@dev1)`)));
  assert.match(lines.at(-1) ?? "", /막히는 것 0 · 경고 1 · 확인하지 못한 것 0/);
  const own = await runInviteCheck({
    request: fakeGitHub(healthy({ "GET /user": { status: 200, json: { login: "dev1" } } })).request,
    projects: [{ repoUrl: URL_APP, reviewers: ["dev2"] }],
    reviewers: ["dev1"],
  });
  assert.equal(own.blocking, false, "프로젝트의 리뷰어가 있으면 공통 리뷰어는 쓰이지 않는다");
});

// ————— 6. 레포 루트 —————

test("락파일 · 미리보기 스크립트가 없으면 경고 — 막지 않는다", async () => {
  const bare = await repoCheck(
    healthy({
      [`GET ${REPO}/contents`]: { status: 200, json: listing("package.json", "README.md") },
      [`GET ${REPO}/contents/package.json`]: {
        status: 200,
        json: file({ scripts: { build: "tsc" } }),
      },
    }),
  );
  assert.equal(only(bare.items, "lockfile").status, "warn");
  assert.match(only(bare.items, "lockfile").text, /락파일이 없으면 설치를 돌리지 않아/);
  const preview = only(bare.items, "preview");
  assert.equal(preview.status, "warn");
  assert.match(preview.text, /dev · start · serve · preview/);
  assert.doesNotMatch(preview.text, /모노레포/);
  const mono = await repoCheck(
    healthy({
      [`GET ${REPO}/contents`]: {
        status: 200,
        json: listing("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"),
      },
      [`GET ${REPO}/contents/package.json`]: { status: 200, json: file({ scripts: {} }) },
    }),
  );
  assert.match(only(mono.items, "preview").text, /모노레포로 보여요.*지켜 줄 것/);
  for (const name of LOCKFILES) {
    const locked = await repoCheck(
      healthy({
        [`GET ${REPO}/contents`]: { status: 200, json: listing("package.json", name) },
      }),
    );
    assert.equal(only(locked.items, "lockfile").status, "pass", name);
  }
  // 첫 후보가 이긴다 — daemon 이 스크립트를 고르는 순서와 같다.
  const start = await repoCheck(
    healthy({
      [`GET ${REPO}/contents/package.json`]: {
        status: 200,
        json: file({ scripts: { preview: "x", start: "y" } }),
      },
    }),
  );
  assert.match(only(start.items, "preview").text, /\(start\)/);
});

test("루트 package.json 이 없거나 깨졌거나 읽을 수 없을 때", async () => {
  const none = await repoCheck(
    healthy({ [`GET ${REPO}/contents`]: { status: 200, json: listing("README.md") } }),
  );
  assert.equal(only(none.items, "preview").status, "warn");
  assert.match(only(none.items, "preview").text, /루트에 package.json 이 없어요/);
  const broken = await repoCheck(
    healthy({ [`GET ${REPO}/contents/package.json`]: { status: 200, json: file("{ 깨진 json") } }),
  );
  assert.match(only(broken.items, "preview").text, /읽지 못했어요/);
  const denied = await repoCheck(
    healthy({ [`GET ${REPO}/contents/package.json`]: NOT_ACCESSIBLE }),
  );
  assert.equal(only(denied.items, "preview").status, "unknown");
  const noRoot = await repoCheck(healthy({ [`GET ${REPO}/contents`]: NOT_ACCESSIBLE }));
  assert.equal(only(noRoot.items, "root").status, "unknown");
  const empty = await repoCheck(healthy({ [`GET ${REPO}/contents`]: { status: 404, json: null } }));
  assert.equal(only(empty.items, "root").status, "warn");
});

test("engines.node 가 번들 Node 를 받지 않으면 경고", async () => {
  const old = await repoCheck(
    healthy({
      [`GET ${REPO}/contents/package.json`]: {
        status: 200,
        json: file({ scripts: { dev: "vite" }, engines: { node: "^18.0.0" } }),
      },
    }),
  );
  assert.equal(only(old.items, "engines").status, "warn");
  assert.match(only(old.items, "engines").text, new RegExp(`Node ${BUNDLED_NODE_MAJOR}`));
  const fine = await repoCheck(
    healthy({
      [`GET ${REPO}/contents/package.json`]: {
        status: 200,
        json: file({ scripts: { dev: "vite" }, engines: { node: ">=20" } }),
      },
    }),
  );
  assert.equal(find(fine.items, "engines").length, 0);
});

test("nodeRangeAllows — 흔한 범위의 표", () => {
  const table: Array<[string, boolean | null]> = [
    [">=18", true],
    [">=22.12.0", true],
    ["^18.0.0", false],
    ["^20 || ^22 || ^24", true],
    ["^20 || ^22", false],
    [">=18 <21", false],
    [">=20.9 <25", true],
    ["24.x", true],
    ["24", true],
    ["22.x", false],
    ["~20.9", false],
    ["18 - 22", false],
    ["18 - 26", true],
    [">=18.0.0 <19.0.0 || >=20.0.0", true],
    ["<=20", false],
    ["<=24", true],
    ["<24", false],
    ["<24.1", true],
    [">24", false],
    [">23", true],
    ["*", true],
    ["x", true],
    ["", true],
    ["v24.0.0", true],
    ["latest", null],
    ["lts/*", null],
  ];
  for (const [range, expected] of table) {
    assert.equal(nodeRangeAllows(range), expected, range);
  }
  assert.equal(nodeRangeAllows(undefined), null);
  assert.equal(nodeRangeAllows(">=26", 24), false);
});

test(".npmrc — 인증 정보 · 환경 변수 · 사설 레지스트리 · GitHub 패키지를 가르고, 값은 싣지 않는다", async () => {
  const secret = "ghp_thisIsNotARealTokenButLooksLikeOne1234567890";
  const found = npmrcFindings(
    [
      "# 주석",
      "registry=https://registry.npmjs.org/",
      "@acme:registry=https://npm.pkg.github.com",
      `//npm.pkg.github.com/:_authToken=${secret}`,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: .npmrc 의 환경 변수 자리표시자 그대로다
      "//registry.example.com/:_authToken=${NPM_TOKEN}",
      "@corp:registry=https://artifactory.corp.example/api/npm/",
    ].join("\n"),
  );
  assert.equal(found.literalAuth, true);
  assert.equal(found.envAuth, true);
  assert.deepEqual(found.hosts.sort(), ["artifactory.corp.example", "npm.pkg.github.com"]);
  assert.deepEqual(npmrcFindings("registry=https://registry.npmjs.org/\nsave-exact=true\n"), {
    literalAuth: false,
    envAuth: false,
    hosts: [],
  });
  const world = healthy({
    [`GET ${REPO}/contents`]: {
      status: 200,
      json: listing("package.json", "pnpm-lock.yaml", ".npmrc"),
    },
    [`GET ${REPO}/contents/.npmrc`]: {
      status: 200,
      json: file(
        `@acme:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${secret}\n`,
      ),
    },
  });
  const result = await repoCheck(world);
  const warns = find(result.items, "npmrc");
  assert.equal(warns.length, 2, "인증 정보 한 줄 + GitHub 패키지 한 줄");
  assert.ok(warns.every((entry) => entry.status === "warn"));
  assert.ok(warns.some((entry) => /클래식 토큰\(read:packages 범위\)만 받아요/.test(entry.text)));
  assert.equal(
    JSON.stringify(result.items).includes(secret),
    false,
    "토큰 값은 문장 어디에도 없다",
  );
  // 클래식 코드에 read:packages 가 있으면 GitHub 패키지 줄은 통과다.
  const classic = await repoCheck(world, { scopes: ["repo", "read:packages"] });
  assert.ok(find(classic.items, "npmrc").some((entry) => entry.status === "pass"));
});

test("환경 변수 견본 — .env.example · .env.sample 이 있으면 경고", async () => {
  for (const name of ENV_SAMPLES) {
    const result = await repoCheck(
      healthy({
        [`GET ${REPO}/contents`]: {
          status: 200,
          json: listing("package.json", "pnpm-lock.yaml", name),
        },
      }),
    );
    assert.equal(only(result.items, "env").status, "warn", name);
    assert.match(
      only(result.items, "env").text,
      /앱은 비밀을 몰라서 화면이 예시 데이터로 뜰 수 있어요/,
    );
  }
  const none = await repoCheck(healthy());
  assert.equal(find(none.items, "env").length, 0);
});

// ————— 주소 · 범위 · 한 번에 —————

test("githubRepoOf — GitHub 의 여러 주소 꼴만 읽는다", () => {
  assert.deepEqual(githubRepoOf("https://github.com/org/app.git"), { owner: "org", repo: "app" });
  assert.deepEqual(githubRepoOf("https://github.com/org/app/"), { owner: "org", repo: "app" });
  assert.deepEqual(githubRepoOf("git@github.com:org/app.git"), { owner: "org", repo: "app" });
  assert.deepEqual(githubRepoOf("ssh://git@github.com/org/app.git"), { owner: "org", repo: "app" });
  assert.deepEqual(githubRepoOf("https://user:x@github.com/org/my.app"), {
    owner: "org",
    repo: "my.app",
  });
  assert.deepEqual(githubRepoOf("org/app"), { owner: "org", repo: "app" });
  assert.equal(githubRepoOf("https://gitlab.com/org/app.git"), null);
  assert.equal(githubRepoOf("file:///tmp/remote.git"), null);
  assert.equal(githubRepoOf("/Users/me/work/app"), null);
  assert.equal(githubRepoOf(""), null);
});

test("scopesOf — 머리글이 없으면 세밀한 토큰이다", () => {
  assert.equal(scopesOf({}), null);
  assert.deepEqual(scopesOf({ "X-OAuth-Scopes": "" }), []);
  assert.deepEqual(scopesOf({ "x-oauth-scopes": "repo, workflow" }), ["repo", "workflow"]);
});

test("GitHub 가 아닌 주소는 점검하지 않고 막지도 않는다 · 코드가 없는 상태는 숨기지 않는다", async () => {
  const world = fakeGitHub(healthy());
  const run = await runInviteCheck({
    request: world.request,
    projects: [{ repoUrl: "file:///tmp/local.git" }, { repoUrl: URL_APP }],
  });
  assert.equal(run.projects[0].slug, null);
  assert.equal(run.projects[0].items[0].status, "unknown");
  assert.equal(run.blocking, false);
  assert.ok(run.projects[1].items.length > 3);
});

test("GitHub 레포가 하나도 없으면 코드도 묻지 않는다 — 로컬 경로로 여는 개발 실행의 초대장", async () => {
  const world = fakeGitHub({ "GET /user": { status: 401, json: { message: "Bad credentials" } } });
  const run = await runInviteCheck({
    request: world.request,
    projects: [{ repoUrl: "/tmp/work/remote.git" }, { repoUrl: "file:///tmp/other.git" }],
  });
  assert.equal(world.calls.length, 0);
  assert.equal(run.blocking, false);
  assert.deepEqual(run.token.items, []);
  assert.ok(run.projects.every((project: { items: unknown[] }) => project.items.length === 1));
});

test("여러 프로젝트 — 레포마다 따로 점검하고 확정 실패 하나가 전체를 막는다", async () => {
  const other = "/repos/org/other";
  const world = fakeGitHub({
    ...healthy(),
    [`GET ${other}`]: {
      status: 200,
      json: {
        full_name: "org/other",
        private: true,
        default_branch: "trunk",
        permissions: { push: true },
      },
    },
    [`POST ${other}/pulls`]: NOT_ACCESSIBLE,
    [`POST ${other}/git/refs`]: { status: 422, json: {} },
    [`POST ${other}/issues`]: { status: 422, json: {} },
    [`GET ${other}/contents`]: { status: 200, json: listing("package.json", "yarn.lock") },
    [`GET ${other}/contents/package.json`]: {
      status: 200,
      json: file({ scripts: { start: "x" } }),
    },
  });
  const run = await runInviteCheck({
    request: world.request,
    projects: [{ repoUrl: URL_APP }, { repoUrl: "https://github.com/org/other.git" }],
  });
  assert.equal(run.blocking, true);
  assert.equal(only(run.projects[0].items, "pr").status, "pass");
  assert.equal(only(run.projects[1].items, "pr").status, "fail");
  assert.equal(run.projects[1].info.defaultBranch, "trunk");
  assert.equal(run.counts.fail, 1);
  // /user 는 한 번만 부른다 — 레포마다 다시 묻지 않는다.
  assert.equal(world.calls.filter((call) => call.path === "/user").length, 1);
});

test("터미널 보고 — 기호와 요약이 있고 코드 값은 없다", async () => {
  const world = fakeGitHub(healthy({ [`POST ${REPO}/pulls`]: NOT_ACCESSIBLE }));
  const run = await runInviteCheck({ request: world.request, projects: [{ repoUrl: URL_APP }] });
  const lines: string[] = formatReport(run);
  assert.match(lines[0], /부작용|만들어지지 않아요/);
  assert.ok(lines.includes("연결 코드"));
  assert.ok(lines.includes("org/app"));
  assert.ok(lines.some((line) => line.startsWith(`  ${MARK.fail} `)));
  assert.ok(lines.some((line) => line.startsWith(`  ${MARK.pass} `)));
  assert.match(lines.at(-1) ?? "", /막히는 것 1 · 경고 0 · 확인하지 못한 것 0/);
});

// ————— 앱의 실제 값과 맞는가 —————

test("미리보기 스크립트 · 락파일 후보는 daemon 의 repo-config 와 같다", () => {
  const source = readFileSync(new URL("../src/repo-config.ts", import.meta.url), "utf8");
  const previews = /PREVIEW_SCRIPTS = \[([^\]]+)\]/.exec(source)?.[1] ?? "";
  assert.deepEqual(
    [...previews.matchAll(/"([^"]+)"/g)].map((match) => match[1]),
    PREVIEW_SCRIPTS,
  );
  const lockBlock = /const LOCKFILES[^=]*=\s*\[([\s\S]*?)\n\];/.exec(source)?.[1] ?? "";
  assert.deepEqual(
    [...lockBlock.matchAll(/\["([^"]+)",/g)].map((match) => match[1]).sort(),
    [...LOCKFILES].sort(),
  );
});

test("번들 Node 메이저는 릴리스 워크플로우의 setup-node 와 같다", () => {
  const workflow = readFileSync(
    new URL("../../../.github/workflows/desktop-release.yml", import.meta.url),
    "utf8",
  );
  const versions = [...workflow.matchAll(/node-version:\s*["']?(\d+)/g)].map((match) =>
    Number(match[1]),
  );
  assert.ok(versions.length > 0, "릴리스 워크플로우에 node-version 이 있어야 한다");
  assert.deepEqual([...new Set(versions)], [BUNDLED_NODE_MAJOR]);
});
