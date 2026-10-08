import assert from "node:assert/strict";
// 순수 모듈 — src 에서 곧장 읽는다(next-motion.test.ts 와 같은 모양).
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { L } from "../src/next/labels.ts";
import {
  firstScreenName,
  looksLikeDevTrace,
  recentScreenName,
  STARTER_KEYS,
  startersOf,
  usableScreen,
} from "../src/next/lib/home-starters.ts";

test("usableScreen: 따옴표는 걷고 흰칸은 다듬는다", () => {
  assert.equal(usableScreen("  회원 목록 "), "회원 목록");
  assert.equal(usableScreen("‘회원’ “목록”"), "회원 목록");
  assert.equal(usableScreen(`"Members" 'list'`), "Members list");
});

test("usableScreen: 비었거나 길거나 여러 줄이면 이름으로 쓰지 않는다", () => {
  assert.equal(usableScreen(null), null);
  assert.equal(usableScreen(undefined), null);
  assert.equal(usableScreen(""), null);
  assert.equal(usableScreen("   "), null);
  assert.equal(usableScreen("‘’"), null);
  assert.equal(usableScreen("회원 목록\n이름 검색"), null);
  // 24자까지는 쓰고 25자부터는 문장을 어지럽히므로 뺀다 — 글자 수는 낱자(코드 포인트)로 센다.
  assert.equal(usableScreen("가".repeat(24)), "가".repeat(24));
  assert.equal(usableScreen("가".repeat(25)), null);
  assert.equal(usableScreen("😀".repeat(24)), "😀".repeat(24));
  assert.equal(usableScreen("😀".repeat(25)), null);
});

test("recentScreenName: 가장 나중에 만진 화면의 이름이다", () => {
  assert.equal(
    recentScreenName([
      { title: "결제 내역", at: "2026-10-06T09:00:00+09:00" },
      { title: "회원 목록", at: "2026-10-06T11:30:00+09:00" },
      { title: "로그인", at: "2026-10-05T18:00:00+09:00" },
    ]),
    "회원 목록",
  );
});

test("recentScreenName: 시각이 같으면 뒤의 것이 이기고, 쓸 수 없는 제목은 건너뛴다", () => {
  assert.equal(
    recentScreenName([
      { title: "앞", at: "2026-10-06T09:00:00Z" },
      { title: "뒤", at: "2026-10-06T09:00:00Z" },
    ]),
    "뒤",
  );
  assert.equal(
    recentScreenName([
      { title: "회원 목록", at: "2026-10-06T09:00:00Z" },
      { title: "   ", at: "2026-10-06T12:00:00Z" },
      { title: "가".repeat(40), at: "2026-10-06T13:00:00Z" },
    ]),
    "회원 목록",
  );
});

test("recentScreenName: 아는 것이 없으면 null 이다", () => {
  assert.equal(recentScreenName(undefined), null);
  assert.equal(recentScreenName(null), null);
  assert.equal(recentScreenName([]), null);
  assert.equal(recentScreenName([{ title: "", at: "2026-10-06T09:00:00Z" }]), null);
});

test("recentScreenName: 읽을 수 없는 시각도 이름은 건진다", () => {
  assert.equal(recentScreenName([{ title: "회원 목록", at: "어제" }]), "회원 목록");
});

test("startersOf: 칩은 늘 네 개이고 정해진 차례다", () => {
  const starters = startersOf(null, L.home.starters);
  assert.deepEqual(
    starters.map((starter) => starter.key),
    [...STARTER_KEYS],
  );
  assert.equal(starters.length, 4);
  for (const starter of starters) {
    assert.ok(starter.label.length > 0, `${starter.key}: 이름이 비었다`);
    assert.ok(starter.text.length > 0, `${starter.key}: 초안이 비었다`);
  }
});

test("startersOf: 화면을 모르면 어느 서비스에나 맞는 말이고 따옴표가 없다", () => {
  for (const starter of startersOf(null, L.home.starters)) {
    assert.ok(!starter.text.includes("‘"), `${starter.key}: ${starter.text}`);
    assert.ok(!starter.text.includes("’"), `${starter.key}: ${starter.text}`);
  }
});

test("startersOf: 화면을 알면 네 초안이 모두 그 이름을 말한다", () => {
  for (const starter of startersOf("회원 목록", L.home.starters)) {
    assert.ok(starter.text.includes("‘회원 목록’"), `${starter.key}: ${starter.text}`);
  }
});

test("startersOf: 초안은 보내기 좋은 한 문장이다 — 끝에 공백이나 줄바꿈이 없다", () => {
  for (const screen of [null, "회원 목록"]) {
    for (const starter of startersOf(screen, L.home.starters)) {
      assert.equal(starter.text, starter.text.trim(), `${starter.key}: 끝이 지저분하다`);
      assert.ok(!starter.text.includes("\n"), `${starter.key}: 여러 줄이다`);
    }
  }
});

test("startersOf: 선택 자리는 화면 이름이다 — 모르면 대신 서는 낱말", () => {
  for (const starter of startersOf("회원 목록", L.home.starters)) {
    assert.ok(starter.pick, `${starter.key}: 선택 자리가 없다`);
    const [from, to] = starter.pick;
    assert.equal(starter.text.slice(from, to), "회원 목록", starter.key);
  }
  const generic = startersOf(null, L.home.starters);
  for (const starter of generic) {
    assert.ok(starter.pick, `${starter.key}: 선택 자리가 없다`);
    const [from, to] = starter.pick;
    assert.equal(starter.text.slice(from, to), L.home.starters[starter.key].blank, starter.key);
  }
});

test("startersOf: 이름이 초안에 없으면 선택하지 않는다", () => {
  const [first] = startersOf(
    null,
    Object.fromEntries(
      STARTER_KEYS.map((key) => [key, { label: key, blank: "없는 낱말", draft: () => "초안" }]),
    ) as Parameters<typeof startersOf>[1],
  );
  assert.equal(first?.pick, null);
});

/**
 * 첫 화면의 이름(2026-10-07 베타 준비 분석 · 첫 5분) — 처음 켠 서비스에는 이번 작업이 만진 화면이 없다. 준비가 끝나면
 * 데몬이 읽어 온 첫 화면의 제목이 칩의 이름이 된다. 모르거나 개발 흔적이면 지금의 일반 문장 그대로(퇴보 없음).
 */
test("firstScreenName: 화면명 · 앱 이름 꼴의 제목은 첫 조각이 이름이다", () => {
  assert.equal(firstScreenName({ path: "/", title: "회원 목록 · 콜로노바 OMS" }), "회원 목록");
  assert.equal(firstScreenName({ path: "/", title: "대시보드 | 우리 서비스" }), "대시보드");
  assert.equal(firstScreenName({ path: "/members", title: "  회원 관리  " }), "회원 관리");
  assert.equal(firstScreenName({ path: "/", title: "Orders" }), "Orders");
  assert.equal(
    firstScreenName({ path: "/", title: "‘주문’ 현황" }),
    "주문 현황",
    "따옴표는 걷는다",
  );
});

test("firstScreenName: 모르거나 쓸 수 없으면 null — 칩은 일반 문장 그대로", () => {
  assert.equal(firstScreenName(null), null);
  assert.equal(firstScreenName(undefined), null);
  assert.equal(firstScreenName({ path: "/", title: "" }), null);
  assert.equal(firstScreenName({ path: "/", title: "   " }), null);
  // 사용 규칙(`usableScreen`)을 그대로 지킨다 — 24자를 넘으면 쓰지 않는다.
  assert.equal(firstScreenName({ path: "/", title: "가".repeat(25) }), null);
  assert.equal(firstScreenName({ path: "/", title: "가".repeat(24) }), "가".repeat(24));
});

test("looksLikeDevTrace: 스캐폴드의 기본 제목 · 파일 이름 · 주소 · 패키지 이름은 개발 흔적이다", () => {
  for (const trace of [
    "Vite + React + TS",
    "Vite App",
    "React App",
    "Create Next App",
    "Vue App",
    "Next.js",
    "SvelteKit",
    "index",
    "Index",
    "page",
    "app",
    "index.html",
    "App.tsx",
    "/login",
    "src\\pages",
    "localhost:3000",
    "localhost",
    "127.0.0.1:5173",
    "Document",
    "Untitled",
    "Untitled Document",
    "Loading...",
    "Loading…",
    "404",
    "Not Found",
    "my-vite-app",
    "colonova_cdp",
    "myApp",
    "제목 없음",
    "제목없음",
    "회원 &unknown; 목록",
    "Orders &#xZZ; list",
  ]) {
    assert.equal(looksLikeDevTrace(trace), true, trace);
    assert.equal(
      firstScreenName({ path: "/", title: trace }),
      null,
      `${trace}: 이름으로 쓰지 않는다`,
    );
  }
});

test("looksLikeDevTrace: 사람이 부르는 화면 이름은 흔적이 아니다 — 한글은 늘 사람의 말이다", () => {
  for (const name of [
    "회원 목록",
    "대시보드",
    "홈",
    "주문 관리",
    "React 학습 노트",
    "Orders",
    "Dashboard",
    "Acme Admin",
    "Billing",
    "ColoNova OMS",
  ]) {
    assert.equal(looksLikeDevTrace(name), false, name);
  }
});

test("firstScreenName: 흔적 제목의 첫 조각만 보고 판정한다 — `Vite + React` 뒤에 앱 이름이 붙어도 이름이 아니다", () => {
  assert.equal(firstScreenName({ path: "/", title: "Vite + React + TS · 회원 관리" }), null);
  // 첫 조각이 이름이면 뒤가 사이트 이름이어도 이름이다.
  assert.equal(firstScreenName({ path: "/", title: "회원 목록 · Vite App" }), "회원 목록");
});

test("홈 입력창: 이번 작업이 만진 화면이 먼저이고, 없으면 서비스의 첫 화면 이름이다(2026-10-07)", () => {
  const composer = readFileSync(
    new URL("../src/next/home/HomeComposer.tsx", import.meta.url),
    "utf8",
  );
  assert.match(composer, /firstScreenName\(daemon\.repo\?\.firstScreen\)/);
  assert.match(composer, /recentScreenName\(cycleScreens\) \?\? firstName/);
  // 첫 준비가 도는 동안의 안내 — 데몬이 첫 준비라고 알릴 때만(앱을 다시 켤 때의 준비에는 말하지 않는다).
  assert.match(composer, /active\?\.firstPrep \? L\.home\.hintPreparing : L\.home\.hint/);
});
