import assert from "node:assert/strict";
// 순수 모듈 — src 에서 곧장 읽는다(next-motion.test.ts 와 같은 모양).
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { L } from "../src/next/labels.ts";
import {
  looksLikeDevTrace,
  STARTER_KEYS,
  shownScreenName,
  startersOf,
  usableScreen,
} from "../src/next/lib/starters.ts";

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

test("startersOf: 칩은 늘 네 개이고 정해진 차례다", () => {
  const starters = startersOf(null, L.composer.starters);
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
  for (const starter of startersOf(null, L.composer.starters)) {
    assert.ok(!starter.text.includes("‘"), `${starter.key}: ${starter.text}`);
    assert.ok(!starter.text.includes("’"), `${starter.key}: ${starter.text}`);
  }
});

test("startersOf: 화면을 알면 네 초안이 모두 그 이름을 말한다", () => {
  for (const starter of startersOf("회원 목록", L.composer.starters)) {
    assert.ok(starter.text.includes("‘회원 목록’"), `${starter.key}: ${starter.text}`);
  }
});

test("startersOf: 초안은 보내기 좋은 한 문장이다 — 끝에 공백이나 줄바꿈이 없다", () => {
  for (const screen of [null, "회원 목록"]) {
    for (const starter of startersOf(screen, L.composer.starters)) {
      assert.equal(starter.text, starter.text.trim(), `${starter.key}: 끝이 지저분하다`);
      assert.ok(!starter.text.includes("\n"), `${starter.key}: 여러 줄이다`);
    }
  }
});

test("startersOf: 선택 자리는 화면 이름이다 — 모르면 대신 서는 낱말", () => {
  for (const starter of startersOf("회원 목록", L.composer.starters)) {
    assert.ok(starter.pick, `${starter.key}: 선택 자리가 없다`);
    const [from, to] = starter.pick;
    assert.equal(starter.text.slice(from, to), "회원 목록", starter.key);
  }
  const generic = startersOf(null, L.composer.starters);
  for (const starter of generic) {
    assert.ok(starter.pick, `${starter.key}: 선택 자리가 없다`);
    const [from, to] = starter.pick;
    assert.equal(starter.text.slice(from, to), L.composer.starters[starter.key].blank, starter.key);
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

test("shownScreenName: 현재 미리보기 제목에서 이름을 고른다", () => {
  assert.equal(shownScreenName("로그인"), "로그인");
  assert.equal(shownScreenName("회원 목록 · 콜로노바 OMS"), "회원 목록");
  assert.equal(shownScreenName("대시보드 | 우리 서비스"), "대시보드");
  assert.equal(shownScreenName("‘주문’ 현황"), "주문 현황");
  assert.equal(shownScreenName(null), null);
  assert.equal(shownScreenName("이름 없는 화면"), null);
  assert.equal(shownScreenName("가".repeat(25)), null);
  assert.equal(shownScreenName("가".repeat(24)), "가".repeat(24));
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
    assert.equal(shownScreenName(trace), null, `${trace}: 이름으로 쓰지 않는다`);
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

test("shownScreenName: 개발 흔적은 앱 이름이 붙어도 중립이다", () => {
  assert.equal(shownScreenName("Vite + React + TS · 회원 관리"), null);
  assert.equal(shownScreenName("회원 목록 · Vite App"), "회원 목록");
  for (const title of [null, "Vite App", "이름 없는 화면"]) {
    assert.deepEqual(
      startersOf(shownScreenName(title), L.composer.starters),
      startersOf(null, L.composer.starters),
    );
  }
  for (const starter of startersOf(shownScreenName("로그인"), L.composer.starters)) {
    assert.ok(starter.text.includes("‘로그인’"));
  }
});

test("새 대화는 현재 미리보기의 이름을 쓴다", () => {
  const column = readFileSync(new URL("../src/next/chat/ChatColumn.tsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../src/next/Workspace.tsx", import.meta.url), "utf8");
  assert.match(column, /shownScreenName\(screenName\)/);
  assert.doesNotMatch(column, /recentScreenName|firstScreenName/);
  assert.match(
    workspace,
    /project !== null && chatScreen\.slug === project\.slug \? chatScreen\.name : null/,
  );
  // 칩은 빈 대화에서만 서고, 입력창에 말이 있거나 잠겨 있으면 물러난다(2026-10-31 홈 걷기).
  assert.match(column, /\{empty && \(\s*<Starters/);
  assert.match(column, /away=\{filled \|\| lockReason !== null\}/);
  // 누르면 보내지 않고 초안이 담긴다 — 화면 이름 자리가 선택된다.
  assert.match(column, /\.\.\.\(starter\.pick \? \{ select: starter\.pick \} : \{\}\)/);
  const starters = readFileSync(new URL("../src/next/chat/Starters.tsx", import.meta.url), "utf8");
  assert.match(starters, /L\.composer\.startersLabel/);
});
