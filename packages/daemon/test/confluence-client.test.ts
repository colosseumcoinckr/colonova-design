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
import { type FixturePair, FixtureTransport, type RestTransport } from "../dist/rest-transport.js";

/**
 * Confluence 클라이언트의 순수 시험(기획서 동기화 1단계 · M1) — 가짜 전송으로 진짜 클라이언트를 돌린다
 * (github-ci.test.ts 양식). 던지지 않는 것(401 연결 끊김 · 429 한도는 사다리)이 이 읽기의 약속이다.
 * 쓰기 손잡이의 시험(2026-10-23 최종 구현 계획 F2) — 본문은 fixture 쌍의 bodyJson 깊은 같음으로
 * 단언하고, `unknown`(적용됐는지 모른다)도 던지지 않는다.
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
        version: { number: 12, createdAt: "2026-06-16T01:32:32Z", authorId: "acct-1" },
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
    authorId: "acct-1",
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

test("listDirectChildren — `_links.next` 를 따라가고, 트리가 비면 빈 목록이다(읽지 못함이 아니다)", async () => {
  const second = "/wiki/api/v2/pages/1/direct-children?limit=250&cursor=abc";
  const { client, calls } = fake({
    "/wiki/api/v2/pages/1/direct-children?limit=250": {
      status: 200,
      json: {
        results: [
          { id: "11", title: "01.시스템분석", type: "page", status: "current" },
          { id: "12", title: "02.기능설계", type: "page", status: "current" },
          { broken: true },
        ],
        _links: { next: second },
      },
    },
    [second]: {
      status: 200,
      json: {
        results: [{ id: "13", title: "03.솔루션", type: "page", status: "current" }],
        _links: {},
      },
    },
  });
  const read = await client.listDirectChildren("1", "page");
  if (!read.readable) assert.fail("두 쪽 트리는 읽혀야 한다");
  assert.deepEqual(read.value, [
    { id: "11", title: "01.시스템분석", type: "page", status: "current" },
    { id: "12", title: "02.기능설계", type: "page", status: "current" },
    { id: "13", title: "03.솔루션", type: "page", status: "current" },
  ]);
  assert.ok(calls.includes(second));

  const empty = fake({
    "/wiki/api/v2/pages/1/direct-children?limit=250": { status: 200, json: { results: [] } },
  });
  const emptyRead = await empty.client.listDirectChildren("1", "page");
  if (!emptyRead.readable) assert.fail("빈 트리는 읽힌 빈 목록이다");
  assert.deepEqual(emptyRead.value, []);
});

test("listDirectChildren — folder 부모는 folders 주소로 읽고, 모르는 모양은 관용으로 채운다", async () => {
  const { client, calls } = fake({
    "/wiki/api/v2/folders/77/direct-children?limit=250": {
      status: 200,
      json: {
        results: [
          { id: "81", title: "화면 목록", type: "folder", status: "current" },
          // 종류가 안 오면 unknown, 제목이 안 오면 빈 글, 상태가 안 오면 없음이다.
          { id: "82" },
        ],
      },
    },
  });
  const read = await client.listDirectChildren("77", "folder");
  if (!read.readable) assert.fail("폴더 트리는 읽혀야 한다");
  assert.deepEqual(read.value, [
    { id: "81", title: "화면 목록", type: "folder", status: "current" },
    { id: "82", title: "", type: "unknown", status: null },
  ]);
  assert.equal(calls[0], "/wiki/api/v2/folders/77/direct-children?limit=250");
});

test("listDirectChildren — 상한에서 끊긴 목록은 읽지 못함이다(다음 쪽이 남았으니)", async () => {
  // PAGE_CAP 쪽을 다 돌고도 next 가 남는 테이프 — 매 쪽이 다음 쪽을 가리킨다(2026-10-23 최종 구현 계획 F0).
  const routes: Record<string, Reply> = {};
  for (let page = 0; page < 10; page += 1) {
    const url =
      page === 0
        ? "/wiki/api/v2/pages/1/direct-children?limit=250"
        : `/wiki/api/v2/pages/1/direct-children?limit=250&cursor=${page}`;
    const next = `/wiki/api/v2/pages/1/direct-children?limit=250&cursor=${page + 1}`;
    routes[url] = {
      status: 200,
      json: {
        results: [{ id: `${page}`, title: `문서 ${page}`, type: "page", status: "current" }],
        _links: { next },
      },
    };
  }
  const read = await fake(routes).client.listDirectChildren("1", "page");
  if (read.readable) assert.fail("상한 너머가 남은 목록은 실패여야 한다");
  assert.equal(read.reason, "unavailable");
  assert.match(read.detail, /너무 길어/);
});

test("listDirectChildren — 읽을 수 없는 부모 종류는 요청 없이 읽지 못함이다", async () => {
  const { client, calls } = fake({});
  const read = await client.listDirectChildren("5", "smartlink");
  if (read.readable) assert.fail("모르는 부모 종류는 실패여야 한다");
  assert.equal(read.reason, "unavailable");
  assert.match(read.detail, /이 종류의 아래는/);
  assert.deepEqual(calls, []);
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
    "/wiki/api/v2/pages/1/inline-comments?body-format=storage&limit=100": {
      status: 200,
      json: {
        results: [
          {
            id: "31",
            authorId: "5f0",
            createdAt: "2026-10-18T01:49:00.000Z",
            resolutionStatus: "resolved",
            version: { number: 3 },
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
      version: 3,
    },
    {
      id: "32",
      authorId: "5f1",
      body: "안 풀린 코멘트",
      createdAt: null,
      parentId: null,
      resolved: false,
      anchorText: "데이터 모델 SSoT",
      version: null,
    },
    {
      id: "33",
      authorId: null,
      body: "",
      createdAt: null,
      parentId: null,
      resolved: false,
      anchorText: null,
      version: null,
    },
  ]);
});

test("listFooterComments — 본문 · 작성자 · 답글 부모를 읽고, 실패는 읽지 못함이다", async () => {
  const ok = fake({
    "/wiki/api/v2/pages/1/footer-comments?body-format=storage&limit=100": {
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
    "/wiki/api/v2/pages/1/footer-comments?body-format=storage&limit=100": { status: 403, json: {} },
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

/** 기록 쌍으로 도는 클라이언트 — 쓰기 본문은 fixture 쌍의 bodyJson 깊은 같음으로 단언된다. */
function fixtureClient(
  pairs: FixturePair[],
  sleep: (ms: number) => Promise<void> = async () => {},
): { client: ConfluenceClient; transport: FixtureTransport } {
  const transport = new FixtureTransport(pairs);
  return { client: new ConfluenceClient(CREDS, transport, sleep), transport };
}

test("createPage — 본문은 v2 의 모양 그대로고 부모가 없으면 뺀다(2026-10-23 최종 구현 계획 F2)", async () => {
  const withParent = fixtureClient([
    {
      name: "부모 아래 새 기획문",
      cite: "POST /wiki/api/v2/pages",
      request: {
        method: "POST",
        url: "/wiki/api/v2/pages",
        bodyJson: {
          spaceId: "COLO",
          status: "current",
          title: "9.1 초안 화면",
          parentId: "99",
          body: { representation: "storage", value: "<p>첫 블록</p>" },
        },
      },
      response: {
        status: 200,
        json: { id: "501", title: "9.1 초안 화면", version: { number: 1 } },
      },
    },
  ]);
  const made = await withParent.client.createPage({
    spaceId: "COLO",
    parentId: "99",
    title: "9.1 초안 화면",
    storage: "<p>첫 블록</p>",
  });
  if (!made.written) assert.fail("기록된 응답은 쓰여야 한다");
  assert.deepEqual(made.value, { id: "501", version: 1, title: "9.1 초안 화면" });
  assert.equal(withParent.transport.pending, 0);

  const withoutParent = fixtureClient([
    {
      name: "공간 뿌리에 새 기획문",
      cite: "POST /wiki/api/v2/pages",
      request: {
        method: "POST",
        url: "/wiki/api/v2/pages",
        // 부모가 없으면 parentId 칸 자체가 없어야 한다 — 깊은 같음이 지킨다.
        bodyJson: {
          spaceId: "COLO",
          status: "current",
          title: "9.1 초안 화면",
          body: { representation: "storage", value: "<p>첫 블록</p>" },
        },
      },
      response: { status: 200, json: { id: "502", version: { number: 1 } } },
    },
  ]);
  const rooted = await withoutParent.client.createPage({
    spaceId: "COLO",
    parentId: null,
    title: "9.1 초안 화면",
    storage: "<p>첫 블록</p>",
  });
  if (!rooted.written) assert.fail("뿌리 만들기도 쓰여야 한다");
  assert.deepEqual(rooted.value, { id: "502", version: 1, title: "9.1 초안 화면" });
  assert.equal(withoutParent.transport.pending, 0);
});

test("updatePage — 본문은 새 판 번호를 싣고, 말이 없으면 version 에서 뺀다", async () => {
  const pair = (bodyJson: unknown, json: unknown): FixturePair => ({
    name: "판 올리기",
    cite: "PUT /wiki/api/v2/pages/123",
    request: { method: "PUT", url: "/wiki/api/v2/pages/123", bodyJson },
    response: { status: 200, json },
  });
  const withMessage = fixtureClient([
    pair(
      {
        id: "123",
        status: "current",
        title: "9.1 초안 화면",
        body: { representation: "storage", value: "<p>고친 블록</p>" },
        version: { number: 13, message: "기획 반영" },
      },
      { id: "123", version: { number: 13 } },
    ),
  ]);
  const saved = await withMessage.client.updatePage({
    pageId: "123",
    title: "9.1 초안 화면",
    storage: "<p>고친 블록</p>",
    version: 13,
    message: "기획 반영",
  });
  if (!saved.written) assert.fail("기록된 응답은 쓰여야 한다");
  assert.deepEqual(saved.value, { id: "123", version: 13 });
  assert.equal(withMessage.transport.pending, 0);

  const silent = fixtureClient([
    pair(
      {
        id: "123",
        status: "current",
        title: "9.1 초안 화면",
        body: { representation: "storage", value: "<p>고친 블록</p>" },
        version: { number: 13 },
      },
      { id: "123", version: { number: 13 } },
    ),
  ]);
  const unsaid = await silent.client.updatePage({
    pageId: "123",
    title: "9.1 초안 화면",
    storage: "<p>고친 블록</p>",
    version: 13,
  });
  if (!unsaid.written) assert.fail("말 없는 저장도 쓰여야 한다");
  assert.deepEqual(unsaid.value, { id: "123", version: 13 });
  assert.equal(silent.transport.pending, 0);
});

test("updatePage — 어긋난 판은 409 conflict, 잘못된 본문은 400 invalid 로 분류된다", async () => {
  const url = "/wiki/api/v2/pages/1";
  const input = { pageId: "1", title: "제목", storage: "<p/>", version: 13 };
  const conflicted = fake({
    [url]: { status: 409, json: { message: "The version number doesn't match" } },
  });
  const conflict = await conflicted.client.updatePage(input);
  if (conflict.written) assert.fail("409 는 실패여야 한다");
  assert.equal(conflict.reason, "conflict");
  assert.match(conflict.detail, /version number/);
  // 토큰은 헤더로만 탄다 — 쓰기에도 같은 형태로 탄다.
  assert.equal(conflicted.auths[0], AUTH);

  const invalid = await fake({ [url]: { status: 400, json: {} } }).client.updatePage(input);
  if (invalid.written) assert.fail("400 은 실패여야 한다");
  assert.equal(invalid.reason, "invalid");
});

test("updatePage — 500 · 닿지 못한 전송 · JSON 이 아닌 2xx 는 모두 unknown 이다(적용됐는지 모른다)", async () => {
  const url = "/wiki/api/v2/pages/1";
  const input = { pageId: "1", title: "제목", storage: "<p/>", version: 13 };
  const serverError = await fake({
    [url]: { status: 500, json: { message: "Internal Server Error" } },
  }).client.updatePage(input);
  if (serverError.written) assert.fail("500 은 모르는 결과여야 한다");
  assert.equal(serverError.reason, "unknown");
  assert.match(serverError.detail, /500/);

  const dead = await fake({ [url]: new Error("getaddrinfo ENOTFOUND") }).client.updatePage(input);
  if (dead.written) assert.fail("닿지 못한 쓰기는 모르는 결과여야 한다");
  assert.equal(dead.reason, "unknown");
  assert.match(dead.detail, /ENOTFOUND/);

  const html: RestTransport = {
    async request() {
      return {
        status: 200,
        body: new TextEncoder().encode("<html>로그인이 필요합니다</html>"),
        headers: {},
      };
    },
  };
  const unreadable = await new ConfluenceClient(CREDS, html).updatePage(input);
  if (unreadable.written) assert.fail("JSON 이 아닌 2xx 는 모르는 결과여야 한다");
  assert.equal(unreadable.reason, "unknown");
});

test("쓰기의 429 — 두 번 기다리고 세 번째에 이어서 보내지고, 사다리가 다 판 한도는 limit 이다", async () => {
  const waits: number[] = [];
  const sleep = async (ms: number) => {
    waits.push(ms);
  };
  const bodyJson = {
    id: "1",
    status: "current",
    title: "제목",
    body: { representation: "storage", value: "<p/>" },
    version: { number: 13 },
  };
  const throttled = (): FixturePair => ({
    name: "한도",
    cite: "PUT /wiki/api/v2/pages/1",
    request: { method: "PUT", url: "/wiki/api/v2/pages/1", bodyJson },
    response: { status: 429, json: {} },
  });
  const input = { pageId: "1", title: "제목", storage: "<p/>", version: 13 };

  const retried = fixtureClient(
    [
      throttled(),
      throttled(),
      {
        name: "이어서 보내짐",
        cite: "PUT /wiki/api/v2/pages/1",
        request: { method: "PUT", url: "/wiki/api/v2/pages/1", bodyJson },
        response: { status: 200, json: { id: "1", version: { number: 13 } } },
      },
    ],
    sleep,
  );
  const ok = await retried.client.updatePage(input);
  if (!ok.written) assert.fail("사다리 안에서 풀리면 쓰여야 한다");
  assert.deepEqual(ok.value, { id: "1", version: 13 });
  assert.equal(retried.transport.pending, 0);
  // 사다리는 두 번 기다리고 세 번 두드린다 — 읽기와 같은 계단이다(LIMIT_ATTEMPTS = 3).
  assert.deepEqual(waits, [
    BUDGETS.limitRetry.baseMs,
    Math.min(BUDGETS.limitRetry.baseMs * 2, BUDGETS.limitRetry.capMs),
  ]);

  const exhausted = fixtureClient([throttled(), throttled(), throttled()], sleep);
  const limited = await exhausted.client.updatePage(input);
  if (limited.written) assert.fail("사다리가 다 판 한도는 실패여야 한다");
  assert.equal(limited.reason, "limit");
  assert.equal(exhausted.transport.pending, 0);
});

test("trashPage — 빈 몸 204 는 쓰인 것이고, 없는 문서는 404 not-found 다", async () => {
  const trashed = await fake({ "/wiki/api/v2/pages/9": { status: 204 } }).client.trashPage("9");
  if (!trashed.written) assert.fail("204 는 쓰인 것이다");
  assert.deepEqual(trashed.value, { id: "9" });

  const missing = await fake({
    "/wiki/api/v2/pages/404": { status: 404, json: {} },
  }).client.trashPage("404");
  if (missing.written) assert.fail("404 는 실패여야 한다");
  assert.equal(missing.reason, "not-found");
});

test("쓰기 요청의 헤더 — JSON 본문에는 content-type 이 함께 탄다(토큰은 기본 인증으로)", async () => {
  const seen: Array<Record<string, string>> = [];
  const transport: RestTransport = {
    async request(input) {
      seen.push(input.headers);
      return { status: 204, body: new Uint8Array() };
    },
  };
  const write = await new ConfluenceClient(CREDS, transport).trashPage("7");
  if (!write.written) assert.fail("빈 몸 204 는 쓰인 것이다");
  assert.equal(seen[0]?.["content-type"], "application/json");
  assert.equal(seen[0]?.authorization, AUTH);
});

test("readDraft · pageOperations · pageAncestors · findPagesByTitle — 응답을 정해진 모양으로 읽는다", async () => {
  const byTitle = `/wiki/api/v2/pages?space-id=COLO&title=${encodeURIComponent("8.8 ColoNova")}&status=current&limit=25`;
  const { client, calls } = fake({
    "/wiki/api/v2/pages/1?get-draft=true&body-format=storage": {
      status: 200,
      json: {
        id: "1",
        status: "draft",
        version: { number: 13 },
        body: { storage: { value: "<p>임시 판</p>" } },
      },
    },
    // 초안이 없는 문서 — 값들이 없는 것이지 읽지 못함이 아니다.
    "/wiki/api/v2/pages/2?get-draft=true&body-format=storage": { status: 200, json: { id: "2" } },
    "/wiki/api/v2/pages/1/operations": {
      status: 200,
      json: { operations: [{ operation: "copy", targetType: "page" }, { broken: true }] },
    },
    "/wiki/api/v2/pages/1/ancestors?limit=250": {
      status: 200,
      json: { results: [{ id: "9" }, { id: "5" }, {}] },
    },
    [byTitle]: {
      status: 200,
      json: {
        results: [
          {
            id: "21",
            title: "8.8 ColoNova",
            parentId: "9",
            version: { number: 3, createdAt: "2026-06-16T01:32:32Z" },
          },
          // 시각은 version 의 것이 없으면 문서의 createdAt 으로 흘린다.
          { id: "22", title: "8.8 ColoNova (사본)", createdAt: "2026-06-17T00:00:00Z" },
        ],
      },
    },
  });
  const draft = await client.readDraft("1");
  if (!draft.readable) assert.fail("초안은 읽혀야 한다");
  assert.deepEqual(draft.value, { status: "draft", version: 13, storage: "<p>임시 판</p>" });

  const bare = await client.readDraft("2");
  if (!bare.readable) assert.fail("초안이 없는 문서도 읽힌다");
  assert.deepEqual(bare.value, { status: null, version: null, storage: null });

  const operations = await client.pageOperations("1");
  if (!operations.readable) assert.fail("동작 목록은 읽혀야 한다");
  assert.deepEqual(operations.value, [{ operation: "copy", targetType: "page" }]);

  const ancestors = await client.pageAncestors("1");
  if (!ancestors.readable) assert.fail("윗문서 줄은 읽혀야 한다");
  assert.deepEqual(ancestors.value, ["9", "5"]);

  const found = await client.findPagesByTitle("COLO", "8.8 ColoNova");
  if (!found.readable) assert.fail("제목 찾기는 읽혀야 한다");
  assert.deepEqual(found.value, [
    {
      id: "21",
      title: "8.8 ColoNova",
      parentId: "9",
      version: 3,
      createdAt: "2026-06-16T01:32:32Z",
    },
    {
      id: "22",
      title: "8.8 ColoNova (사본)",
      parentId: null,
      version: null,
      createdAt: "2026-06-17T00:00:00Z",
    },
  ]);
  assert.equal(calls[0], "/wiki/api/v2/pages/1?get-draft=true&body-format=storage");
  assert.ok(calls.includes(byTitle));
});

test("초안 · 동작 · 윗줄 · 제목 찾기의 401 — 만료는 unauthorized 로, 어느 쪽도 던지지 않는다", async () => {
  const refused = (url: string) => ({ [url]: { status: 401, json: {} } });
  const draft = await fake(
    refused("/wiki/api/v2/pages/1?get-draft=true&body-format=storage"),
  ).client.readDraft("1");
  if (draft.readable) assert.fail("401 은 실패여야 한다");
  assert.equal(draft.reason, "unauthorized");

  const operations = await fake(refused("/wiki/api/v2/pages/1/operations")).client.pageOperations(
    "1",
  );
  if (operations.readable) assert.fail("401 은 실패여야 한다");
  assert.equal(operations.reason, "unauthorized");

  const ancestors = await fake(
    refused("/wiki/api/v2/pages/1/ancestors?limit=250"),
  ).client.pageAncestors("1");
  if (ancestors.readable) assert.fail("401 은 실패여야 한다");
  assert.equal(ancestors.reason, "unauthorized");

  const found = await fake(
    refused(
      `/wiki/api/v2/pages?space-id=COLO&title=${encodeURIComponent("제목")}&status=current&limit=25`,
    ),
  ).client.findPagesByTitle("COLO", "제목");
  if (found.readable) assert.fail("401 은 실패여야 한다");
  assert.equal(found.reason, "unauthorized");
});

test("쓰기 실패 문장 — 어느 문장에도 토큰과 이메일이 실리지 않는다", async () => {
  const details: string[] = [];
  const update = (routes: Record<string, Reply>) =>
    fake(routes).client.updatePage({ pageId: "1", title: "제목", storage: "<p/>", version: 13 });

  const created = await fake({
    "/wiki/api/v2/pages": { status: 401, json: {} },
  }).client.createPage({ spaceId: "COLO", parentId: null, title: "제목", storage: "<p/>" });
  if (created.written) assert.fail("401 은 실패여야 한다");
  details.push(created.detail);

  const conflict = await update({
    "/wiki/api/v2/pages/1": { status: 409, json: { message: "버전이 어긋났다" } },
  });
  if (conflict.written) assert.fail("409 는 실패여야 한다");
  details.push(conflict.detail);

  const invalid = await update({ "/wiki/api/v2/pages/1": { status: 400, json: {} } });
  if (invalid.written) assert.fail("400 은 실패여야 한다");
  details.push(invalid.detail);

  const serverError = await update({
    "/wiki/api/v2/pages/1": { status: 500, json: { message: "죽었다" } },
  });
  if (serverError.written) assert.fail("500 은 모르는 결과여야 한다");
  details.push(serverError.detail);

  const dead = await update({ "/wiki/api/v2/pages/1": new Error("getaddrinfo ENOTFOUND") });
  if (dead.written) assert.fail("닿지 못한 쓰기는 모르는 결과여야 한다");
  details.push(dead.detail);

  const limited = await update({
    "/wiki/api/v2/pages/1": [
      { status: 429, json: {} },
      { status: 429, json: {} },
      { status: 429, json: {} },
      { status: 429, json: {} },
    ],
  });
  if (limited.written) assert.fail("사다리가 다 판 한도는 실패여야 한다");
  details.push(limited.detail);

  const trashed = await fake({
    "/wiki/api/v2/pages/1": { status: 404, json: {} },
  }).client.trashPage("1");
  if (trashed.written) assert.fail("404 는 실패여야 한다");
  details.push(trashed.detail);

  // 토큰은 헤더로만 탄다 — 실패 문장 어디에도 실리지 않는다(읽기의 시험과 같은 약속).
  for (const detail of details) {
    assert.ok(detail.length > 0);
    assert.ok(!detail.includes(CREDS.token), detail);
    assert.ok(!detail.includes(CREDS.email), detail);
  }
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

// ————— 문서 관리의 손잡이(2026-10-23 최종 구현 계획 F4 · 작업 D1a) —————

test("copyPage — v1 copy 의 본문은 첨부 · 라벨 · 속성을 싣고 권한은 싣지 않는다", async () => {
  const { client, transport } = fixtureClient([
    {
      name: "부모 아래 합성 사본",
      cite: "POST /wiki/rest/api/content/123/copy",
      request: {
        method: "POST",
        url: "/wiki/rest/api/content/123/copy",
        bodyJson: {
          destination: { type: "parent_page", value: "77" },
          pageTitle: "합성 사본",
          copyAttachments: true,
          copyLabels: true,
          copyProperties: true,
          copyPermissions: false,
          copyCustomContents: true,
        },
      },
      response: { status: 200, json: { id: "808", title: "합성 사본" } },
    },
  ]);
  const made = await client.copyPage({ pageId: "123", parentId: "77", title: "합성 사본" });
  if (!made.written) assert.fail("기록된 응답은 쓰여야 한다");
  assert.deepEqual(made.value, { id: "808" });
  assert.equal(transport.pending, 0);

  // 응답에 id 가 없으면 적용됐는지 모른다 — 새 문서가 생겼을 수 있으므로 unknown 이다.
  const unreadable = fixtureClient([
    {
      name: "몸 없는 응답",
      cite: "POST /wiki/rest/api/content/123/copy",
      request: {
        method: "POST",
        url: "/wiki/rest/api/content/123/copy",
        bodyJson: {
          destination: { type: "parent_page", value: "77" },
          pageTitle: "합성 사본",
          copyAttachments: true,
          copyLabels: true,
          copyProperties: true,
          copyPermissions: false,
          copyCustomContents: true,
        },
      },
      response: { status: 200, json: {} },
    },
  ]);
  const unknown = await unreadable.client.copyPage({
    pageId: "123",
    parentId: "77",
    title: "합성 사본",
  });
  if (unknown.written) assert.fail("id 없는 응답은 모르는 결과여야 한다");
  assert.equal(unknown.reason, "unknown");
});

test("movePage — append 길로 옮기고 본래의 id 로 답한다", async () => {
  const { client, transport } = fixtureClient([
    {
      name: "새 부모 아래로",
      cite: "PUT /wiki/rest/api/content/123/move/append/77",
      request: { method: "PUT", url: "/wiki/rest/api/content/123/move/append/77" },
      response: { status: 200, json: {} },
    },
  ]);
  const moved = await client.movePage({ pageId: "123", parentId: "77" });
  if (!moved.written) assert.fail("기록된 응답은 쓰여야 한다");
  assert.deepEqual(moved.value, { id: "123" });
  assert.equal(transport.pending, 0);

  const refused = await fake({
    "/wiki/rest/api/content/123/move/append/77": { status: 403, json: {} },
  }).client.movePage({ pageId: "123", parentId: "77" });
  if (refused.written) assert.fail("403 은 실패여야 한다");
  assert.equal(refused.reason, "forbidden");
});

test("readTrashedPage — status=trashed 로 읽고 readPage 와 같은 해석이다", async () => {
  const { client, calls } = fake({
    "/wiki/api/v2/pages/9?status=trashed&body-format=storage": {
      status: 200,
      json: {
        id: "9",
        title: "버려진 합성 문서",
        spaceId: "SP1",
        version: { number: 4, createdAt: "2026-10-23T00:00:00Z" },
        parentId: "7",
        body: { storage: { value: "<p>휴지통의 문단이다.</p>" } },
      },
    },
  });
  const read = await client.readTrashedPage("9");
  if (!read.readable) assert.fail("가짜 응답은 읽혀야 한다");
  assert.deepEqual(read.value, {
    id: "9",
    title: "버려진 합성 문서",
    spaceId: "SP1",
    version: 4,
    storage: "<p>휴지통의 문단이다.</p>",
    parentId: "7",
    updatedAt: "2026-10-23T00:00:00Z",
    authorId: null,
  });
  assert.equal(calls[0], "/wiki/api/v2/pages/9?status=trashed&body-format=storage");

  const missing = await fake({
    "/wiki/api/v2/pages/404?status=trashed&body-format=storage": { status: 404, json: {} },
  }).client.readTrashedPage("404");
  if (missing.readable) assert.fail("404 는 실패여야 한다");
  assert.equal(missing.reason, "unavailable");
});

test("restorePage — status current 의 갱신 본문으로 되살리고 version 은 휴지통 판 + 1 이다", async () => {
  const { client, transport } = fixtureClient([
    {
      name: "휴지통에서 되살림",
      cite: "PUT /wiki/api/v2/pages/9",
      request: {
        method: "PUT",
        url: "/wiki/api/v2/pages/9",
        bodyJson: {
          id: "9",
          status: "current",
          title: "버려진 합성 문서",
          body: { representation: "storage", value: "<p>휴지통의 문단이다.</p>" },
          version: { number: 5 },
        },
      },
      response: { status: 200, json: { id: "9", version: { number: 5 } } },
    },
  ]);
  const restored = await client.restorePage({
    pageId: "9",
    title: "버려진 합성 문서",
    storage: "<p>휴지통의 문단이다.</p>",
    version: 5,
  });
  if (!restored.written) assert.fail("기록된 응답은 쓰여야 한다");
  assert.deepEqual(restored.value, { id: "9", version: 5 });
  assert.equal(transport.pending, 0);

  const serverError = await fake({
    "/wiki/api/v2/pages/9": { status: 500, json: { message: "Internal Server Error" } },
  }).client.restorePage({ pageId: "9", title: "제목", storage: "<p/>", version: 5 });
  if (serverError.written) assert.fail("500 은 모르는 결과여야 한다");
  assert.equal(serverError.reason, "unknown");
});

test("문서 관리의 길 — 어느 손잡이도 영구 삭제(purge)를 싣지 않는다", async () => {
  const { client, calls } = fake({
    // DELETE(trash) 와 PUT(restore) 이 같은 주소를 쓴다 — 204 한 벌이 둘의 답이다.
    "/wiki/api/v2/pages/9": { status: 204 },
    "/wiki/rest/api/content/9/copy": { status: 200, json: { id: "808" } },
    "/wiki/rest/api/content/9/move/append/77": { status: 200, json: {} },
    "/wiki/api/v2/pages/9?status=trashed&body-format=storage": {
      status: 200,
      json: {
        id: "9",
        title: "버려진 합성 문서",
        version: { number: 4 },
        body: { storage: { value: "<p/>" } },
      },
    },
  });
  await client.trashPage("9");
  await client.copyPage({ pageId: "9", parentId: "77", title: "합성 사본" });
  await client.movePage({ pageId: "9", parentId: "77" });
  const read = await client.readTrashedPage("9");
  if (!read.readable) assert.fail("휴지통 문서는 읽혀야 한다");
  await client.restorePage({
    pageId: "9",
    title: read.value.title,
    storage: read.value.storage,
    version: read.value.version + 1,
  });
  assert.ok(calls.length >= 5);
  for (const url of calls) {
    assert.ok(!url.includes("purge"), url);
  }
});

test("createFooterComment — 본문은 저장 포맷 한 벌이고, 답글은 부모만 싣는다(2026-10-23 작업 D2a)", async () => {
  const onPage = fixtureClient([
    {
      name: "문서에 바닥글",
      cite: "POST /wiki/api/v2/footer-comments",
      request: {
        method: "POST",
        url: "/wiki/api/v2/footer-comments",
        bodyJson: {
          pageId: "1",
          body: { representation: "storage", value: "<p>합성 코멘트</p>" },
        },
      },
      response: { status: 200, json: { id: "61" } },
    },
  ]);
  const made = await onPage.client.createFooterComment({
    pageId: "1",
    storage: "<p>합성 코멘트</p>",
  });
  if (!made.written) assert.fail("기록된 응답은 쓰여야 한다");
  assert.deepEqual(made.value, { id: "61" });
  assert.equal(onPage.transport.pending, 0);

  const onParent = fixtureClient([
    {
      name: "바닥글에 답글",
      cite: "POST /wiki/api/v2/footer-comments",
      request: {
        method: "POST",
        url: "/wiki/api/v2/footer-comments",
        // 답글의 자리는 부모가 안다 — pageId 칸 자체가 없어야 한다(깊은 같음).
        bodyJson: {
          parentCommentId: "41",
          body: { representation: "storage", value: "<p>합성 답글</p>" },
        },
      },
      response: { status: 200, json: { id: "62" } },
    },
  ]);
  const answered = await onParent.client.createFooterComment({
    parentCommentId: "41",
    storage: "<p>합성 답글</p>",
  });
  if (!answered.written) assert.fail("답글도 쓰여야 한다");
  assert.deepEqual(answered.value, { id: "62" });
  assert.equal(onParent.transport.pending, 0);

  const unreadable = fixtureClient([
    {
      name: "id 없는 응답",
      cite: "POST /wiki/api/v2/footer-comments",
      request: {
        method: "POST",
        url: "/wiki/api/v2/footer-comments",
        bodyJson: { pageId: "1", body: { representation: "storage", value: "<p/>" } },
      },
      response: { status: 200, json: {} },
    },
  ]);
  const unknown = await unreadable.client.createFooterComment({ pageId: "1", storage: "<p/>" });
  if (unknown.written) assert.fail("id 없는 응답은 모르는 결과여야 한다");
  assert.equal(unknown.reason, "unknown");
});

test("createInlineComment — 문장 닻을 싣고, 답글은 닻을 뺀다(2026-10-23 작업 D2a)", async () => {
  const anchored = fixtureClient([
    {
      name: "문장에 인라인",
      cite: "POST /wiki/api/v2/inline-comments",
      request: {
        method: "POST",
        url: "/wiki/api/v2/inline-comments",
        bodyJson: {
          pageId: "1",
          body: { representation: "storage", value: "<p>합성 코멘트</p>" },
          inlineCommentProperties: {
            textSelection: "데이터 모델 SSoT",
            textSelectionMatchCount: 2,
            textSelectionMatchIndex: 1,
          },
        },
      },
      response: { status: 200, json: { id: "63" } },
    },
  ]);
  const placed = await anchored.client.createInlineComment({
    pageId: "1",
    storage: "<p>합성 코멘트</p>",
    selection: "데이터 모델 SSoT",
    matchCount: 2,
    matchIndex: 1,
  });
  if (!placed.written) assert.fail("기록된 응답은 쓰여야 한다");
  assert.deepEqual(placed.value, { id: "63" });
  assert.equal(anchored.transport.pending, 0);

  const onParent = fixtureClient([
    {
      name: "인라인에 답글",
      cite: "POST /wiki/api/v2/inline-comments",
      request: {
        method: "POST",
        url: "/wiki/api/v2/inline-comments",
        // 답글은 닻이 없다 — inlineCommentProperties 칸 자체가 없어야 한다(깊은 같음).
        bodyJson: {
          parentCommentId: "32",
          body: { representation: "storage", value: "<p>합성 답글</p>" },
        },
      },
      response: { status: 200, json: { id: "64" } },
    },
  ]);
  const answered = await onParent.client.createInlineComment({
    parentCommentId: "32",
    storage: "<p>합성 답글</p>",
  });
  if (!answered.written) assert.fail("답글도 쓰여야 한다");
  assert.deepEqual(answered.value, { id: "64" });
  assert.equal(onParent.transport.pending, 0);
});

test("updateComment — 바닥글 · 인라인이 주소를 가르고, 판은 +1, 해결은 인라인만 싣는다(작업 D2a)", async () => {
  const footer = fixtureClient([
    {
      name: "바닥글 고침",
      cite: "PUT /wiki/api/v2/footer-comments/41",
      request: {
        method: "PUT",
        url: "/wiki/api/v2/footer-comments/41",
        // resolved 는 인라인의 몫이다 — 바닥글의 본문에 칸 자체가 없어야 한다(깊은 같음).
        bodyJson: {
          version: { number: 5 },
          body: { representation: "storage", value: "<p>고친 코멘트</p>" },
        },
      },
      response: { status: 200, json: { id: "41" } },
    },
  ]);
  const edited = await footer.client.updateComment({
    kind: "footer",
    commentId: "41",
    storage: "<p>고친 코멘트</p>",
    version: 4,
  });
  if (!edited.written) assert.fail("기록된 응답은 쓰여야 한다");
  assert.deepEqual(edited.value, { id: "41" });
  assert.equal(footer.transport.pending, 0);

  const inline = fixtureClient([
    {
      name: "인라인 해결",
      cite: "PUT /wiki/api/v2/inline-comments/32",
      request: {
        method: "PUT",
        url: "/wiki/api/v2/inline-comments/32",
        bodyJson: {
          version: { number: 4 },
          body: { representation: "storage", value: "지금 판 그대로" },
          resolved: true,
        },
      },
      response: { status: 200, json: { id: "32" } },
    },
  ]);
  const resolved = await inline.client.updateComment({
    kind: "inline",
    commentId: "32",
    storage: "지금 판 그대로",
    version: 3,
    resolved: true,
  });
  if (!resolved.written) assert.fail("해결도 쓰여야 한다");
  assert.deepEqual(resolved.value, { id: "32" });
  assert.equal(inline.transport.pending, 0);

  const serverError = await fake({
    "/wiki/api/v2/footer-comments/41": { status: 503, json: {} },
  }).client.updateComment({ kind: "footer", commentId: "41", storage: "<p/>", version: 4 });
  if (serverError.written) assert.fail("5xx 는 모르는 결과여야 한다");
  assert.equal(serverError.reason, "unknown");
});
