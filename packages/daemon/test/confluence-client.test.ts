import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BUDGETS } from "../dist/budgets.js";
import {
  ConfluenceClient,
  createConfluenceTransport,
  normalizeSite,
} from "../dist/confluence-client.js";
import type { RestTransport } from "../dist/rest-transport.js";

/**
 * Confluence 클라이언트의 순수 시험(기획서 동기화 1단계 · M1) — 가짜 전송으로 진짜 클라이언트를 돌린다
 * (github-ci.test.ts 양식). 던지지 않는 것(401 연결 끊김 · 429 한도는 사다리)이 이 읽기의 약속이다.
 * 프로세스를 띄우지 않는 순수 시험이다 — 기다림도 주입해 자지 않는다.
 */

const CREDS = { site: "colosseum.atlassian.net", email: "me@example.com", token: "tok" };
/** 인증 헤더의 바른 모양 — 이메일:토큰 짝의 기본 인증. */
const AUTH = `Basic ${Buffer.from(`${CREDS.email}:${CREDS.token}`, "utf8").toString("base64")}`;

type Reply = { status: number; json?: unknown; link?: string } | Error;
test("site 정규화 — 프로토콜과 끝의 /wiki 를 떼어 한 벌로 만든다(env 관례도 같은 길)", () => {
  assert.equal(normalizeSite("colosseum.atlassian.net"), "colosseum.atlassian.net");
  assert.equal(normalizeSite("https://colosseum.atlassian.net"), "colosseum.atlassian.net");
  assert.equal(normalizeSite("https://colosseum.atlassian.net/wiki/"), "colosseum.atlassian.net");
});

/** 주소별로 답을 돌려주고 부른 주소와 실린 인증 헤더를 모은다. */
function fake(
  routes: Record<string, Reply | Reply[]>,
  sleep: (ms: number) => Promise<void> = async () => {},
): { client: ConfluenceClient; calls: string[]; auths: string[] } {
  const calls: string[] = [];
  const auths: string[] = [];
  const queues = new Map(
    Object.entries(routes).map(([url, reply]) => [
      url,
      Array.isArray(reply) ? [...reply] : [reply],
    ]),
  );
  const transport: RestTransport = {
    async request(input) {
      calls.push(input.url);
      auths.push(input.headers.authorization ?? "");
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
  return { client: new ConfluenceClient(CREDS, transport, sleep), calls, auths };
}

test("인증 헤더 — 이메일:토큰 짝이 한 몸으로 조립되고 어느 읽기에도 같은 형태로 탄다", async () => {
  const { client, auths } = fake({
    "/wiki/rest/api/user/current": {
      status: 200,
      json: { type: "known", accountId: "5f0", publicName: "정인권", email: "me@example.com" },
    },
  });
  const who = await client.whoAmI();
  assert.deepEqual(who, { ok: true, accountId: "5f0", displayName: "정인권" });
  assert.equal(auths[0], AUTH);
});

test("whoAmI — 401 은 재연결의 길로, 닿지 못하면 unreachable 로; 어느 쪽도 던지지 않는다", async () => {
  const refused = fake({
    "/wiki/rest/api/user/current": { status: 401, json: { message: "Unauthorized" } },
  });
  const refusedWho = await refused.client.whoAmI();
  if (refusedWho.ok) assert.fail("401 은 실패여야 한다");
  assert.equal(refusedWho.reason, "unauthorized");
  assert.match(refusedWho.detail, /다시 연결/);
  // 토큰은 헤더로만 탄다 — 실패 문장 어디에도 실리지 않는다.
  assert.ok(!refusedWho.detail.includes(CREDS.token));
  assert.ok(!refusedWho.detail.includes(CREDS.email));

  const dead = fake({ "/wiki/rest/api/user/current": new Error("getaddrinfo ENOTFOUND") });
  const deadWho = await dead.client.whoAmI();
  if (deadWho.ok) assert.fail("닿지 못한 읽기는 실패여야 한다");
  assert.equal(deadWho.reason, "unreachable");
});

test("readPage — 저장 포맷 원문과 판을 읽는다(정본은 저장 포맷)", async () => {
  const { client } = fake({
    "/wiki/api/v2/pages/123?body-format=storage": {
      status: 200,
      json: {
        id: "123",
        title: "8.8 ColoNova",
        spaceId: "COLO",
        version: { number: 12, createdAt: "2026-06-16T01:32:32Z" },
        parentId: "99",
        body: {
          storage: { value: '<ac:structured-macro ac:name="info"/>', representation: "storage" },
        },
      },
    },
  });
  const read = await client.readPage("123");
  if (!read.readable) assert.fail("가짜 응답은 읽혀야 한다");
  assert.deepEqual(read.value, {
    id: "123",
    title: "8.8 ColoNova",
    spaceId: "COLO",
    version: 12,
    updatedAt: "2026-06-16T01:32:32Z",
    storage: '<ac:structured-macro ac:name="info"/>',
    parentId: "99",
  });
});

test("readPage — 실패는 한 단어로 분류되고 던지지 않는다(401 · 403 · 409 · 못 읽는 본문)", async () => {
  const routes = (status: number, json: unknown = {}) => ({
    "/wiki/api/v2/pages/1?body-format=storage": { status, json },
  });
  const unauthorized = await fake(routes(401)).client.readPage("1");
  if (unauthorized.readable) assert.fail("401 은 실패여야 한다");
  assert.equal(unauthorized.reason, "unauthorized");

  const forbidden = await fake(routes(403)).client.readPage("1");
  if (forbidden.readable) assert.fail("403 은 실패여야 한다");
  assert.equal(forbidden.reason, "forbidden");

  const conflict = await fake(routes(409)).client.readPage("1");
  if (conflict.readable) assert.fail("409 는 실패여야 한다");
  assert.equal(conflict.reason, "conflict");

  const empty = await fake(routes(200, { noBody: true })).client.readPage("1");
  if (empty.readable) assert.fail("본문 없는 2xx 는 실패여야 한다");
  assert.equal(empty.reason, "unavailable");
});

test("한도의 429 — BUDGETS.limitRetry 사다리를 타고(한 분에서 두 배), 다 팔면 limit 으로 돌아온다", async () => {
  const url = "/wiki/api/v2/pages/1?body-format=storage";
  const waits: number[] = [];
  const exhausted = fake(
    {
      [url]: [
        { status: 429, json: {} },
        { status: 429, json: {} },
        { status: 429, json: {} },
        { status: 429, json: {} },
      ],
    },
    async (ms) => {
      waits.push(ms);
    },
  );
  const read = await exhausted.client.readPage("1");
  if (read.readable) assert.fail("사다리가 다 판 한도는 실패여야 한다");
  assert.equal(read.reason, "limit");
  // 사다리는 두 번 기다리고 세 번 두드린다 — 첫 계단은 baseMs, 다음은 두 배(LIMIT_ATTEMPTS = 3).
  assert.equal(waits.length, 2);
  assert.equal(waits[0], BUDGETS.limitRetry.baseMs);
  assert.equal(waits[1], Math.min(BUDGETS.limitRetry.baseMs * 2, BUDGETS.limitRetry.capMs));

  // 사다리 안에서 풀리면 limit 이 아니다 — 이어서 읽힌다.
  const retried = fake(
    {
      [url]: [
        { status: 429, json: {} },
        { status: 200, json: { id: "1", title: "t", body: { storage: { value: "가" } } } },
      ],
    },
    async () => {},
  );
  const retriedRead = await retried.client.readPage("1");
  assert.ok(retriedRead.readable);
});

test("listChildren — `_links.next` 를 따라가고, 트리가 비면 빈 목록이다(읽지 못함이 아니다)", async () => {
  const second = "/wiki/api/v2/pages/1/children?limit=100&cursor=abc";
  const { client, calls } = fake({
    "/wiki/api/v2/pages/1/children?limit=100": {
      status: 200,
      json: {
        results: [
          { id: "11", title: "01.시스템분석" },
          { id: "12", title: "02.기능설계" },
          { broken: true },
        ],
        _links: { next: second },
      },
    },
    [second]: {
      status: 200,
      json: { results: [{ id: "13", title: "03.솔루션" }], _links: {} },
    },
  });
  const read = await client.listChildren("1");
  if (!read.readable) assert.fail("두 쪽 트리는 읽혀야 한다");
  assert.deepEqual(read.value, [
    { id: "11", title: "01.시스템분석" },
    { id: "12", title: "02.기능설계" },
    { id: "13", title: "03.솔루션" },
  ]);
  assert.ok(calls.includes(second));

  const empty = fake({
    "/wiki/api/v2/pages/1/children?limit=100": { status: 200, json: { results: [] } },
  });
  const emptyRead = await empty.client.listChildren("1");
  if (!emptyRead.readable) assert.fail("빈 트리는 읽힌 빈 목록이다");
  assert.deepEqual(emptyRead.value, []);
});

test("searchPages — CQL 이 인코딩되고 Link 헤더의 next 를 따라간다(v1 검색)", async () => {
  const cql = `type=page AND lastModified > "2026/10/17 00:00"`;
  const first = `/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=100`;
  const next = "/wiki/rest/api/search?cql=x&next=true";
  const { client, calls, auths } = fake({
    [first]: {
      status: 200,
      link: `<https://colosseum.atlassian.net${next}>; rel="next"`,
      json: {
        results: [
          { content: { id: "21" }, title: "정책서" },
          { type: "comment", content: { id: "22" }, title: "코멘트" },
        ],
      },
    },
    [next]: { status: 200, json: { results: [{ content: { id: "23" }, title: "기능설계서" }] } },
  });
  const read = await client.searchPages(cql);
  if (!read.readable) assert.fail("두 쪽 검색은 읽혀야 한다");
  assert.deepEqual(read.value, [
    { id: "21", title: "정책서" },
    { id: "22", title: "코멘트" },
    { id: "23", title: "기능설계서" },
  ]);
  assert.equal(calls[0], first);
  assert.equal(auths[0], AUTH);
});

test("searchPages — withVersion 은 판을 함께 싣고, 제목은 content.title 이 먼저다(2026-10-19)", async () => {
  const cql = `type=page AND lastModified > "2026/10/17 00:00"`;
  const first = `/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=100&expand=content.version`;
  const { client, calls } = fake({
    [first]: {
      status: 200,
      json: {
        results: [
          // 결과 줄의 title 에는 찾는 말의 강조 표지가 섞일 수 있다 — content.title 이 이긴다.
          {
            content: { id: "31", title: "정책서", version: { number: 4 } },
            title: "@@@hl@@@정책서@@@endhl@@@",
          },
          // 판이 안 오면 판 칸이 없다 — 부르는 쪽이 readPage 의 판으로 돌아간다.
          { content: { id: "32" }, title: "기능설계서" },
        ],
      },
    },
  });
  const read = await client.searchPages(cql, { withVersion: true });
  if (!read.readable) assert.fail("판을 싣는 검색은 읽혀야 한다");
  assert.deepEqual(read.value, [
    { id: "31", title: "정책서", version: 4 },
    { id: "32", title: "기능설계서" },
  ]);
  assert.equal(calls[0], first);
});

test("listInlineComments — 해결 상태와 닻을 읽고, 모르는 모양은 열린 것으로 흘린다", async () => {
  const { client } = fake({
    "/wiki/api/v2/pages/1/inline-comments?limit=100": {
      status: 200,
      json: {
        results: [
          {
            id: "31",
            authorId: "5f0",
            createdAt: "2026-10-18T01:49:00.000Z",
            resolutionStatus: "resolved",
            body: { storage: { value: "풀린 코멘트" } },
          },
          {
            id: "32",
            authorId: "5f1",
            body: { storage: { value: "안 풀린 코멘트" } },
            inlineProperties: { selection: "데이터 모델 SSoT" },
          },
          { id: "33", body: {} },
        ],
      },
    },
  });
  const read = await client.listInlineComments("1");
  if (!read.readable) assert.fail("코멘트 목록은 읽혀야 한다");
  assert.deepEqual(read.value, [
    {
      id: "31",
      authorId: "5f0",
      body: "풀린 코멘트",
      createdAt: "2026-10-18T01:49:00.000Z",
      parentId: null,
      resolved: true,
      anchorText: null,
    },
    {
      id: "32",
      authorId: "5f1",
      body: "안 풀린 코멘트",
      createdAt: null,
      parentId: null,
      resolved: false,
      anchorText: "데이터 모델 SSoT",
    },
    {
      id: "33",
      authorId: null,
      body: "",
      createdAt: null,
      parentId: null,
      resolved: false,
      anchorText: null,
    },
  ]);
});

test("listFooterComments — 본문 · 작성자 · 답글 부모를 읽고, 실패는 읽지 못함이다", async () => {
  const ok = fake({
    "/wiki/api/v2/pages/1/footer-comments?limit=100": {
      status: 200,
      json: {
        results: [
          {
            id: "41",
            authorId: "5f0",
            body: { storage: { value: "첫 바닥글" } },
            createdAt: "2026-10-18T02:00:00.000Z",
          },
          { id: "42", authorId: "5f1", parentId: "41", body: { storage: { value: "답글" } } },
        ],
      },
    },
  });
  const read = await ok.client.listFooterComments("1");
  if (!read.readable) assert.fail("바닥글은 읽혀야 한다");
  assert.equal(read.value.length, 2);
  assert.equal(read.value[1]?.parentId, "41");

  const denied = fake({
    "/wiki/api/v2/pages/1/footer-comments?limit=100": { status: 403, json: {} },
  });
  const deniedRead = await denied.client.listFooterComments("1");
  if (deniedRead.readable) assert.fail("403 은 실패여야 한다");
  assert.equal(deniedRead.reason, "forbidden");
});

test("userName — 한 번 읽은 사람은 캐시로 끊고, 못 읽으면 이름 없음이다(던지지 않는다)", async () => {
  const { client, calls } = fake({
    "/wiki/api/v2/users/5f0": { status: 200, json: { displayName: "정인권" } },
    "/wiki/api/v2/users/5f1": { status: 404, json: {} },
  });
  assert.equal(await client.userName("5f0"), "정인권");
  assert.equal(await client.userName("5f0"), "정인권");
  assert.equal(calls.filter((url) => url === "/wiki/api/v2/users/5f0").length, 1);
  assert.equal(await client.userName("5f1"), null);
});

test("fixture 디렉터리가 깨졌으면 조용히 실사이트로 가지 않는다 — 생성이 멈춘다(2026-10-18 코호트 지적)", (t) => {
  const broken = mkdtempSync(join(tmpdir(), "confluence-broken-"));
  t.after(() => rmSync(broken, { recursive: true, force: true }));
  // fixtures.json 이 없는 폴더 — env 는 fixture 를 선언했다.
  const previous = process.env.COLONOVA_DESIGN_CONFLUENCE_FIXTURE;
  process.env.COLONOVA_DESIGN_CONFLUENCE_FIXTURE = broken;
  try {
    assert.throws(() => createConfluenceTransport(process.env, "colosseum.atlassian.net"));
  } finally {
    if (previous === undefined) delete process.env.COLONOVA_DESIGN_CONFLUENCE_FIXTURE;
    else process.env.COLONOVA_DESIGN_CONFLUENCE_FIXTURE = previous;
  }
});
