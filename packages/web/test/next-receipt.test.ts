import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-making.test.ts 와 같은 모양).
import { receiptFacts, SENT_TITLES_MAX, sentOf } from "../src/next/lib/receipt.ts";

/**
 * 제출 영수증이 말하는 것(2026-10-07 UX 점검 3단계) — 보낸 화면 · 받을 개발자. 영수증은 모르는 것을 말하지 않는다.
 */

test("sentOf: 확인한 화면의 수와 앞선 제목 셋을 싣는다", () => {
  const screens = ["회원 목록", "회원 상세", "결제 내역", "설정", "로그인"].map((title) => ({
    title,
  }));
  assert.deepEqual(sentOf(screens), {
    screens: 5,
    titles: ["회원 목록", "회원 상세", "결제 내역"],
  });
  assert.equal(SENT_TITLES_MAX, 3);
});

test("sentOf: 화면이 없으면 undefined — 화면 밖 변경만 가는 제출은 화면을 말하지 않는다", () => {
  assert.equal(sentOf([]), undefined);
});

test("sentOf: 제목은 다듬어 싣는다 — 빈 제목은 건너뛰고 60자에서 자른다", () => {
  const out = sentOf([{ title: "  회원 목록  " }, { title: " " }, { title: "가".repeat(80) }]);
  assert.deepEqual(out, { screens: 3, titles: ["회원 목록", "가".repeat(60)] });
  // 이모지처럼 두 칸을 차지하는 글자가 잘려 깨지지 않는다.
  const emoji = sentOf([{ title: "😀".repeat(70) }]);
  assert.equal(Array.from(emoji?.titles[0] ?? "").length, 60);
});

test("sentOf: 수는 선로의 한도(999)를 넘지 않는다", () => {
  const many = Array.from({ length: 1200 }, () => ({ title: "화면" }));
  assert.equal(sentOf(many)?.screens, 999);
});

test("receiptFacts: 보낸 화면은 사건이 가진 만큼 — 제목이 닿지 않은 화면은 나머지 수로", () => {
  const facts = receiptFacts(
    { sent: { screens: 5, titles: ["회원 목록", "회원 상세", "결제 내역"] } },
    null,
    false,
  );
  assert.deepEqual(facts.sent, { screens: 5, names: "회원 목록 · 회원 상세 · 결제 내역", rest: 2 });
  assert.equal(
    receiptFacts({ sent: { screens: 2, titles: ["회원 목록", "설정"] } }, null, true).sent?.rest,
    0,
  );
});

test("receiptFacts: 보낸 화면을 모르면 null — 대화로 낸 제출 · 옛 영수증", () => {
  assert.equal(receiptFacts({}, null, false).sent, null);
});

test("receiptFacts: 받을 개발자는 지금 요청이 아는 사람이 먼저다", () => {
  assert.deepEqual(
    receiptFacts({ reviewer: "kim" }, { reviewers: ["kim", "lee"] }, false).reviewers,
    ["kim", "lee"],
  );
  assert.deepEqual(receiptFacts({ reviewer: "kim" }, null, false).reviewers, ["kim"]);
  assert.deepEqual(receiptFacts({}, { reviewers: [] }, false).reviewers, []);
});

test("receiptFacts: 첫 제출의 지금 요청에 적힌 개발자가 비었다고 알려진 때만 nobody", () => {
  assert.equal(receiptFacts({}, { reviewers: [] }, false).nobody, true);
  // 더해 제출하는 영수증은 이미 정해진 요청이다 — 되풀이하지 않는다.
  assert.equal(receiptFacts({}, { reviewers: [] }, true).nobody, false);
  // 지금의 요청이 아니면(옛 영수증) 가려 말할 수 없다.
  assert.equal(receiptFacts({}, null, false).nobody, false);
  // 받을 개발자를 모르면(undefined) 말하지 않는다 — 없다고 단정하지 않는다.
  assert.equal(receiptFacts({}, {}, false).nobody, false);
  // 사건이 한 명을 적었으면 있는 것이다.
  assert.equal(receiptFacts({ reviewer: "kim" }, { reviewers: [] }, false).nobody, false);
  assert.equal(receiptFacts({}, { reviewers: ["kim"] }, false).nobody, false);
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("제출 확인은 이번에 제출하는 화면을 영수증 재료로 건넨다 — 확인 창의 목록이 곧 영수증이다", () => {
  const popover = read("../src/next/status/SubmitPopover.tsx");
  assert.match(
    popover,
    /onConfirm\(note\.trim\(\), snapshot\.head, snapshot\.expectedPreview, sentOf\(lead\)\)/,
  );
  const status = read("../src/next/status/StatusLine.tsx");
  assert.match(status, /\.submit\(sessions\.activeId, note \|\| undefined, head, token, sent\)/);
});

test("영수증 카드는 지금 요청의 받을 개발자와 보낸 화면을 receiptFacts 로 읽는다", () => {
  const cards = read("../src/next/chat/cards.tsx");
  assert.match(cards, /receiptFacts\(block, same, more\)/);
  assert.match(cards, /\{!more && \(\s*<ul className="nx-cnext"/);
});
