import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-motion.test.ts 와 같은 모양).
import { L } from "../src/next/labels.ts";
import {
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
