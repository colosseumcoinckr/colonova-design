import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Attention, HandoffStatus, LandedWork } from "@colonova-design/protocol";
// 순수 모듈 — src 에서 곧장 읽는다(next-ci-line.test.ts 와 같은 모양).
import { L } from "../src/next/labels.ts";
import {
  activeNewsOf,
  hasLandedFacts,
  LANDED_FRESH_MS,
  LANDED_HOME_LIMIT,
  landedFacts,
  landedIsFresh,
  landedLines,
  NEWS_MAX_AGE_MS,
} from "../src/next/lib/landed.ts";
import { waitingNote, waitingRows } from "../src/next/lib/waiting.ts";

/**
 * 반영된 일(2026-10-08 베타 준비 분석 · A2b) — 병합된 순간의 성취 카드 · 홈의 `반영된 일` 묶음 · 활성 프로젝트의 개발자 소식 ·
 * 개발자 확인을 기다리는 줄의 승인 · 자동 검사 부제. 읽힌 만큼만 말한다.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const NOW = new Date(2026, 9, 8, 14, 0, 0).getTime();
const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const work = (pr: number, hoursAgo: number, over: Partial<LandedWork> = {}): LandedWork => ({
  at: iso(-hoursAgo * HOUR),
  pr,
  ...over,
});

// ————— 홈의 `반영된 일` —————

test("landedLines: 0건이면 비고(묶음이 서지 않는다), 모르는 키도 비다", () => {
  assert.deepEqual(landedLines([]), []);
  assert.deepEqual(landedLines(undefined), []);
  assert.deepEqual(landedLines(null), []);
});

test("landedLines: 최신순이고 상한은 여덟이다 — 데몬이 아무 순서로 줘도", () => {
  assert.equal(LANDED_HOME_LIMIT, 8);
  const landed = Array.from({ length: 12 }, (_, index) => work(index + 1, (index * 7) % 12));
  const lines = landedLines(landed);
  assert.equal(lines.length, 8);
  for (let i = 1; i < lines.length; i += 1) {
    assert.ok((lines[i - 1]?.at ?? 0) >= (lines[i]?.at ?? 0), "최신이 위");
  }
  assert.equal(landedLines(landed, 3).length, 3);
});

test("landedLines: 시각은 실제 시각(ms)이고 읽을 수 없는 줄 · 같은 번호는 뺀다", () => {
  const [first] = landedLines([work(4, 2)]);
  assert.equal(first?.at, NOW - 2 * HOUR);
  const lines = landedLines([
    work(1, 1),
    { at: "어제", pr: 2 },
    work(1, 5, { title: "같은 번호의 옛 줄" }),
    work(3, 3),
  ]);
  assert.deepEqual(
    lines.map((line) => line.pr),
    [1, 3],
  );
});

test("landedLines: 아는 것만 싣는다 — 빈 제목 · 0곳은 모르는 것이고 0일은 말이다", () => {
  const [line] = landedLines([work(9, 1, { title: "  ", days: 0, screens: 0 })]);
  assert.deepEqual(line, { pr: 9, title: null, days: 0, screens: null, at: NOW - HOUR });
  const [full] = landedLines([work(9, 1, { title: " 회원 목록 검색 ", days: 3, screens: 2 })]);
  assert.deepEqual(full, { pr: 9, title: "회원 목록 검색", days: 3, screens: 2, at: NOW - HOUR });
});

test("landedFacts: `3일 만에 · 화면 2곳` — 아는 것만 이어 붙이고 같은 날은 0 도 말이다", () => {
  assert.equal(landedFacts(3, 2, L.landed), "3일 만에 · 화면 2곳");
  assert.equal(landedFacts(0, 2, L.landed), "제출한 날 안에 · 화면 2곳");
  assert.equal(landedFacts(1, null, L.landed), "1일 만에");
  assert.equal(landedFacts(null, 5, L.landed), "화면 5곳");
  assert.equal(landedFacts(undefined, undefined, L.landed), null);
  assert.equal(landedFacts(null, 0, L.landed), null, "화면 0곳은 말하지 않는다");
});

test("hasLandedFacts: 하나라도 알면 카드이고, 필드 없는 옛 사건은 얇은 한 줄이다", () => {
  assert.equal(hasLandedFacts({}), false, "옛 사건");
  assert.equal(hasLandedFacts({ title: "  " }), false);
  assert.equal(hasLandedFacts({ screens: 0 }), false);
  assert.equal(hasLandedFacts({ title: "회원 목록" }), true);
  assert.equal(hasLandedFacts({ days: 0 }), true, "같은 날도 말이다");
  assert.equal(hasLandedFacts({ screens: 2 }), true);
});

test("landedIsFresh: 막 도착한 사건만 체크를 그린다 — 오래된 것 · 읽을 수 없는 것은 조용히", () => {
  assert.equal(LANDED_FRESH_MS, 10 * 60 * 1000);
  assert.equal(landedIsFresh(iso(-60_000), NOW), true);
  assert.equal(landedIsFresh(iso(-LANDED_FRESH_MS), NOW), false);
  assert.equal(landedIsFresh(iso(-3 * HOUR), NOW), false);
  assert.equal(landedIsFresh("모름", NOW), false);
});

// ————— 활성 프로젝트의 개발자 소식 —————

const news = (over: Partial<Parameters<typeof activeNewsOf>[0]> = {}) =>
  activeNewsOf({
    kind: "closed",
    at: iso(-HOUR),
    landed: 0,
    reviewCard: false,
    now: NOW,
    ...over,
  });

test("activeNewsOf: 반려 · 다시 제출됨은 다른 자리가 말하지 않아 선다", () => {
  assert.deepEqual(news({ kind: "closed" }), { kind: "closed", at: iso(-HOUR) });
  assert.deepEqual(news({ kind: "replied" }), { kind: "replied", at: iso(-HOUR) });
});

test("activeNewsOf: 병합 소식은 `반영된 일` 이 대신 말한다 — 그 묶음이 비었을 때만 선다", () => {
  assert.equal(news({ kind: "merged", landed: 1 }), null);
  assert.deepEqual(news({ kind: "merged", landed: 0 }), { kind: "merged", at: iso(-HOUR) });
});

test("activeNewsOf: 코멘트 소식은 `답을 기다려요` 의 코멘트 카드가 서 있으면 서지 않는다", () => {
  assert.equal(news({ kind: "comments", reviewCard: true }), null);
  assert.equal(news({ kind: "changes_requested", reviewCard: true }), null);
  assert.deepEqual(news({ kind: "comments", reviewCard: false }), {
    kind: "comments",
    at: iso(-HOUR),
  });
  // 코멘트 카드는 코멘트 소식만 가린다.
  assert.deepEqual(news({ kind: "closed", reviewCard: true }), { kind: "closed", at: iso(-HOUR) });
});

test("activeNewsOf: 이틀이 지났거나 시각을 읽을 수 없으면 거둔다, 소식이 없으면 없다", () => {
  assert.equal(NEWS_MAX_AGE_MS, 2 * 24 * HOUR);
  assert.equal(news({ at: iso(-NEWS_MAX_AGE_MS) }), null);
  assert.notEqual(news({ at: iso(-NEWS_MAX_AGE_MS + 1000) }), null);
  assert.equal(news({ at: "어제" }), null);
  assert.equal(news({ at: undefined }), null);
  assert.equal(news({ kind: undefined }), null);
});

// ————— 개발자 확인을 기다리는 줄의 부제 —————

const since = "2026-10-07T00:00:00.000Z";
const handoff = (over: Partial<HandoffStatus> = {}): HandoffStatus => ({
  number: 7,
  url: "https://github.com/o/r/pull/7",
  title: "t",
  state: "open",
  branch: "b",
  ...over,
});
const fixing: Attention = { kind: "ai-fixing", since, key: "ci" };
const notified: Attention = { kind: "developer-notified", since, via: "pr", key: "ci:7:rounds" };

test("waitingNote: 승인이면 `개발자가 확인했어요 — 반영을 기다려요`", () => {
  assert.equal(
    waitingNote(handoff({ approved: true }), null, L),
    "개발자가 확인했어요 — 반영을 기다려요",
  );
});

test("waitingNote: 자동 검사가 통과하지 못하면 누가 맡았는지를 말한다", () => {
  const failing = handoff({ ci: { state: "failing", failing: 2 } });
  assert.equal(waitingNote(failing, fixing, L), "자동 검사가 통과하지 못해 AI가 고치고 있어요");
  assert.equal(
    waitingNote(failing, notified, L),
    "자동 검사가 계속 통과하지 못해 개발자에게 알렸어요",
  );
  assert.equal(waitingNote(failing, null, L), "자동 검사가 통과하지 못했어요");
});

test("waitingNote: 통과 · 도는 중 · 모르는 검사 · 열린 요청이 아닌 것은 기본 문장을 바꾸지 않는다", () => {
  assert.equal(waitingNote(handoff({ ci: { state: "passing" } }), null, L), null);
  assert.equal(waitingNote(handoff({ ci: { state: "pending" } }), null, L), null);
  assert.equal(waitingNote(handoff(), null, L), null, "읽지 못한 연결 — 통과도 실패도 아니다");
  assert.equal(waitingNote(null, null, L), null);
  assert.equal(waitingNote(handoff({ state: "changes_requested", approved: true }), null, L), null);
});

test("waitingNote: 승인이 검사 실패보다 먼저 말한다 — 개발자가 이미 확인했다", () => {
  assert.equal(
    waitingNote(handoff({ approved: true, ci: { state: "failing" } }), fixing, L),
    "개발자가 확인했어요 — 반영을 기다려요",
  );
});

test("waitingRows: 부제는 활성 프로젝트의 같은 요청에만 붙는다 — 비활성 프로젝트는 신호가 없다", () => {
  const projects = [
    { slug: "a", name: "가", handoff: { state: "open", since, number: 7 } },
    { slug: "b", name: "나", handoff: { state: "open", since, number: 9 } },
  ];
  const rows = waitingRows(projects, NOW, {
    active: { slug: "a", handoff: handoff({ approved: true }), attention: null },
    words: L,
  });
  assert.equal(rows.find((row) => row.slug === "a")?.note, "개발자가 확인했어요 — 반영을 기다려요");
  assert.ok(!("note" in (rows.find((row) => row.slug === "b") ?? {})), "비활성은 값이 없다");
  // 다른 요청의 신호는 붙지 않는다 — 번호를 둘 다 알면 맞춘다.
  const other = waitingRows(projects, NOW, {
    active: { slug: "a", handoff: handoff({ number: 8, approved: true }), attention: null },
    words: L,
  });
  assert.ok(!("note" in (other.find((row) => row.slug === "a") ?? {})));
  // 신호를 건네지 않으면 지금까지의 모양 그대로다.
  assert.deepEqual(
    waitingRows(projects, NOW).map((row) => Object.keys(row).sort()),
    [
      ["days", "name", "slug"],
      ["days", "name", "slug"],
    ],
  );
});

// ————— 소스 계약 — 카드 · 홈 묶음 · css · 문장 —————

test("대화: 반영이 사실을 알 때만 성취 카드, 옛 사건은 얇은 줄 — 체크는 막 도착한 카드에만", () => {
  const thread = read("../src/next/chat/Thread.tsx");
  assert.match(thread, /block\.subtype === "merged" && hasLandedFacts\(block\)/);
  assert.match(thread, /fresh=\{!historyMiles\.current\?\.has\(block\.id\) && landedIsFresh\(/);
  assert.match(thread, /L\.cards\.milestoneMerged/, "얇은 한 줄은 그대로 남아 있다");
  const client = read("../src/lib/daemon-client.ts");
  assert.match(client, /\.\.\.\(event\.title \? \{ title: event\.title \} : \{\}\)/);
  assert.match(client, /\.\.\.\(event\.days !== undefined \? \{ days: event\.days \} : \{\}\)/);
  assert.match(
    client,
    /\.\.\.\(event\.screens !== undefined \? \{ screens: event\.screens \} : \{\}\)/,
  );
});

test("카드: 문장은 L.landed 한 곳이고 체크는 장식이다", () => {
  const card = read("../src/next/chat/LandedCard.tsx");
  assert.match(card, /L\.landed\.head\(block\.title\)/);
  assert.match(card, /L\.landed\.headPlain/);
  assert.match(card, /L\.landed\.next/);
  assert.match(
    card,
    /landedFacts\(block\.days, block\.screens, \{\s*took: L\.landed\.took,\s*screens: L\.landed\.screens,/,
  );
  assert.match(card, /nx-landed-mark" aria-hidden="true"/);
  assert.match(card, /fresh \? " nx-landed--new" : ""/);
});

test("css: 고유한 꼬리(nx-landed-*) · 체크는 backwards 로만 그리고 동작 줄이기에서 멈춘다", () => {
  const css = read("../src/next/chat/chat.css");
  const start = css.indexOf(".nx-landed {");
  assert.ok(start > 0, "카드 규칙이 있다");
  const block = css.slice(
    start,
    css.indexOf("@media (prefers-reduced-motion: reduce)", start) + 400,
  );
  assert.match(block, /nx-landed-draw 360ms 180ms ease-out backwards/);
  assert.match(block, /nx-landed-pop 320ms 60ms ease-out backwards/);
  assert.doesNotMatch(
    block,
    /(forwards|\bboth\b)/,
    "끝난 뒤에도 남는 transform 애니메이션은 쓰지 않는다",
  );
  assert.match(
    block,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.nx-landed--new,[\s\S]*?animation: none;/,
  );
  // 다른 카드의 클래스를 빌리지 않는다 — 전역 css 의 충돌 함정.
  assert.doesNotMatch(block, /\.nx-card\b|\.nx-ch\b|\.nx-cs\b/);
});

test("홈: 반영된 일 묶음은 0건이면 없고, 소식은 한 목록에서 최근순 · 부제는 신호를 건넨다", () => {
  const inbox = read("../src/next/home/HomeInbox.tsx");
  assert.match(inbox, /feed\.landed\.length > 0 &&/);
  assert.match(inbox, /open=\{foldMemo\.landed\}/);
  assert.match(inbox, /landedFacts\(item\.days, item\.screens, \{\s*took: L\.landed\.took,/);
  assert.match(inbox, /item\.title \?\? L\.landed\.untitled/);
  assert.match(inbox, /const landed = daemon\.repo\?\.landed;/);
  assert.match(inbox, /\.\.\.\(feed\.news\s*\?/);
  assert.match(inbox, /sub=\{row\.note \?\? L\.cycle\.review\}/);
  assert.match(inbox, /words: L,/);
  const feed = read("../src/next/lib/home-feed.ts");
  assert.match(feed, /landedLines\(options\.landed\)/);
  assert.match(feed, /reviewCard: askingFromReviews\.length > 0/);
});

test("문장: 성취의 말은 한 곳(L.landed)이고 사용자의 어휘만 쓴다", () => {
  const text = [
    L.landed.head("회원 목록"),
    L.landed.headPlain,
    L.landed.took(0),
    L.landed.took(3),
    L.landed.screens(2),
    L.landed.next,
    L.landed.fold,
    L.landed.untitled,
  ].join("\n");
  assert.equal(L.landed.head("회원 목록"), "‘회원 목록’ 일이 반영됐어요");
  assert.equal(L.landed.took(2), "2일 만에");
  assert.equal(L.landed.took(0), "제출한 날 안에");
  assert.equal(L.landed.screens(4), "화면 4곳");
  for (const banned of ["PR", "병합", "머지", "커밋", "브랜치"]) {
    assert.ok(!text.includes(banned), `${banned} 는 사용자의 말이 아니다`);
  }
});
