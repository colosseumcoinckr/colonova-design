import assert from "node:assert/strict";
import { test } from "node:test";
import { readFirstScreen, titleOfHtml } from "../src/first-screen.ts";

/**
 * 서비스의 첫 화면 읽기(2026-10-07 베타 준비 분석 · 첫 5분) — 서버가 내는 문서의 `<title>` 을 읽어 홈의 시작 칩이
 * 서비스의 이름으로 말하게 한다. 이름이 될 만한가의 판정은 웹의 몫이고(`next-home-starters.test.ts`), 여기는
 * 날것을 깨끗이 읽는 일과 못 읽을 때 조용한 일만 본다.
 */

test("titleOfHtml: 머리의 제목을 읽고 태그 · 개체 · 공백을 걷는다", () => {
  assert.equal(titleOfHtml("<html><head><title>회원 관리</title></head>"), "회원 관리");
  assert.equal(
    titleOfHtml("<head><TITLE data-rh='true'>\n  대시보드 ·  OMS\n</TITLE></head>"),
    "대시보드 · OMS",
  );
  assert.equal(
    titleOfHtml("<head><title>Tom &amp; Jerry &#39;s &quot;쇼&quot; &#xAC00;</title></head>"),
    'Tom & Jerry \'s "쇼" 가',
  );
  assert.equal(titleOfHtml("<head><title>a<b>b</b>c</title></head>"), "abc");
});

test("titleOfHtml: 제목에 흔한 개체(구분점 · 줄표)는 글자로 푼다", () => {
  assert.equal(
    titleOfHtml(
      "<head><title>회원 목록 &middot; 콜로노바 &mdash; OMS &raquo; &copy;</title></head>",
    ),
    "회원 목록 · 콜로노바 — OMS » ©",
  );
  assert.equal(titleOfHtml("<head><title>A&nbsp;B&ensp;C</title></head>"), "A B C");
});

test("titleOfHtml: 모르는 개체는 그대로 두고, 글자가 못 되는 번호는 풀지 않는다", () => {
  assert.equal(titleOfHtml("<head><title>a &unknown; b</title></head>"), "a &unknown; b");
  assert.equal(
    titleOfHtml("<head><title>a &#xD800; b &#0; c</title></head>"),
    "a &#xD800; b &#0; c",
  );
});

test("titleOfHtml: 없거나 비었거나 머리 밖이면 null — 본문의 SVG 제목은 화면의 이름이 아니다", () => {
  assert.equal(titleOfHtml("<html><head></head><body>hi</body></html>"), null);
  assert.equal(titleOfHtml("<head><title>   </title></head>"), null);
  assert.equal(titleOfHtml("<head><title></title></head>"), null);
  assert.equal(
    titleOfHtml("<head><meta charset=utf-8></head><body><svg><title>로고</title></svg></body>"),
    null,
  );
  assert.equal(titleOfHtml(""), null);
});

test("titleOfHtml: 긴 제목은 120자에서 자른다", () => {
  const title = titleOfHtml(`<head><title>${"가".repeat(300)}</title></head>`);
  assert.equal(Array.from(title ?? "").length, 120);
});

/** 시험용 응답. */
function page(html: string, options: { status?: number; type?: string; location?: string } = {}) {
  return new Response(html, {
    status: options.status ?? 200,
    headers: {
      "content-type": options.type ?? "text/html; charset=utf-8",
      ...(options.location ? { location: options.location } : {}),
    },
  });
}

/** 주소마다 답이 정해진 가짜 서버 — 물은 주소를 차례로 적는다. */
function server(routes: Record<string, () => Response>) {
  const asked: string[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    asked.push(url);
    assert.equal(init?.redirect, "manual", "이동은 손으로 따라간다 — 바깥 주소로 끌려 나가지 않게");
    const answer = routes[url];
    if (!answer) throw new TypeError(`예상 밖의 요청 ${url}`);
    return answer();
  }) as unknown as typeof fetch;
  return { asked, fetch: fake };
}

const origin = "http://127.0.0.1:5173";

test("readFirstScreen: 루트를 받아 제목을 읽는다 — 미리보기 주소의 경로는 따르지 않는다", async () => {
  const fake = server({ [`${origin}/`]: () => page("<head><title>홈</title></head>") });
  const found = await readFirstScreen(`${origin}/some/where?x=1`, { fetch: fake.fetch });
  assert.deepEqual(fake.asked, [`${origin}/`]);
  assert.deepEqual(found, { path: "/", title: "홈" });
});

test("readFirstScreen: 같은 서버 안의 이동은 따라가고, 끝 경로를 싣는다", async () => {
  const fake = server({
    [`${origin}/`]: () => page("", { status: 302, location: "/dashboard/?tab=1" }),
    [`${origin}/dashboard/?tab=1`]: () => page("<head><title>대시보드 · OMS</title></head>"),
  });
  const found = await readFirstScreen(origin, { fetch: fake.fetch });
  assert.deepEqual(found, { path: "/dashboard", title: "대시보드 · OMS" });
  assert.deepEqual(fake.asked, [`${origin}/`, `${origin}/dashboard/?tab=1`]);
});

test("readFirstScreen: 다른 주인으로 넘어가면 그쪽으로 요청하지 않고 null — 이 서비스의 화면이 아니다", async () => {
  const fake = server({
    [`${origin}/`]: () => page("", { status: 302, location: "https://accounts.example.com/login" }),
  });
  assert.equal(await readFirstScreen(origin, { fetch: fake.fetch }), null);
  assert.deepEqual(fake.asked, [`${origin}/`], "바깥 주소는 묻지 않는다");
});

test("readFirstScreen: 이동이 끝없이 이어지거나 가리키는 곳이 없으면 null", async () => {
  const loop = server({
    [`${origin}/`]: () => page("", { status: 301, location: "/a" }),
    [`${origin}/a`]: () => page("", { status: 301, location: "/" }),
  });
  assert.equal(await readFirstScreen(origin, { fetch: loop.fetch }), null);
  assert.ok(loop.asked.length <= 5, `이동은 몇 번까지만 따라간다(${loop.asked.length})`);
  const lost = server({ [`${origin}/`]: () => page("", { status: 302 }) });
  assert.equal(await readFirstScreen(origin, { fetch: lost.fetch }), null);
});

test("readFirstScreen: HTML 이 아닌 답 · 실패한 답 · 제목 없는 문서는 null", async () => {
  const run = (response: Response) =>
    readFirstScreen(origin, { fetch: (async () => response) as unknown as typeof fetch });
  assert.equal(await run(page("{}", { type: "application/json" })), null);
  assert.equal(await run(page("<head><title>x</title></head>", { status: 500 })), null);
  assert.equal(await run(page("<head></head>")), null, "제목이 없으면 이름이 없다");
});

test("readFirstScreen: 서버가 없거나 느려도 조용히 null — 던지지 않는다", async () => {
  assert.equal(
    await readFirstScreen(origin, {
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    }),
    null,
  );
  assert.equal(await readFirstScreen("not a url"), null);
  // 응답이 끝내 안 오면 시간 제한이 끊는다.
  assert.equal(
    await readFirstScreen(origin, {
      timeoutMs: 20,
      fetch: ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as unknown as typeof fetch,
    }),
    null,
  );
});

test("readFirstScreen: 머리만 읽는다 — 큰 문서도 앞 64KB 안에서 끝난다", async () => {
  const filler = "x".repeat(200 * 1024);
  const found = await readFirstScreen(origin, {
    fetch: (async () =>
      page(`<head><title>큰 문서</title></head><body>${filler}</body>`)) as unknown as typeof fetch,
  });
  assert.deepEqual(found, { path: "/", title: "큰 문서" });
});
