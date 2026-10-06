import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-making.test.ts 와 같은 모양).
import { daysSince, waitingForDeveloper, waitingRows } from "../src/next/lib/waiting.ts";

/**
 * 기다림이 보이게(2026-10-07 UX 점검 3단계) — 개발자 확인을 기다리는 요청이 며칠째인지. 달력으로 센다.
 */
const at = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).getTime();
/** 이 컴퓨터의 달력 기준 ISO — 시간대와 무관하게 같은 날짜 칸에 떨어지도록 로컬 시각에서 만든다. */
const iso = (year: number, month: number, day: number, hour = 12) =>
  new Date(year, month - 1, day, hour).toISOString();

test("daysSince: 오늘 연 요청은 0, 어제는 1 — 시계가 아니라 달력으로 센다", () => {
  const today = at(2026, 10, 7);
  assert.equal(daysSince(iso(2026, 10, 7, 0), today), 0);
  assert.equal(daysSince(iso(2026, 10, 7, 23), today), 0);
  assert.equal(
    daysSince(iso(2026, 10, 6, 23), today),
    1,
    "어제 밤 11시에 낸 것도 하루 지난 것이다",
  );
  assert.equal(daysSince(iso(2026, 10, 1, 1), today), 6);
});

test("daysSince: 자정이 지나면 같은 요청의 숫자가 는다", () => {
  const since = iso(2026, 10, 6, 17);
  assert.equal(daysSince(since, at(2026, 10, 6)), 0);
  assert.equal(daysSince(since, at(2026, 10, 7)), 1);
  assert.equal(daysSince(since, at(2026, 10, 8)), 2);
});

test("daysSince: 달 · 해의 경계를 넘어도 달력으로 센다", () => {
  assert.equal(daysSince(iso(2026, 9, 30, 10), at(2026, 10, 2)), 2);
  assert.equal(daysSince(iso(2025, 12, 31, 10), at(2026, 1, 2)), 2);
});

test("daysSince: 모르거나 읽을 수 없으면 null — 며칠째를 지어내지 않는다", () => {
  const today = at(2026, 10, 7);
  assert.equal(daysSince(undefined, today), null);
  assert.equal(daysSince(null, today), null);
  assert.equal(daysSince("", today), null);
  assert.equal(daysSince("어제", today), null);
});

test("daysSince: 시계가 어긋나 미래인 때는 0 — 음수로 말하지 않는다", () => {
  assert.equal(daysSince(iso(2026, 10, 9), at(2026, 10, 7)), 0);
});

test("waitingForDeveloper: 개발자의 확인을 기다리는 요청은 open 뿐이다", () => {
  assert.equal(waitingForDeveloper({ state: "open" }), true);
  // 변경을 청한 요청은 공이 우리 쪽에 있다 — AI 가 반영한다.
  assert.equal(waitingForDeveloper({ state: "changes_requested" }), false);
  assert.equal(waitingForDeveloper({ state: "merged" }), false);
  assert.equal(waitingForDeveloper({ state: "closed" }), false);
  assert.equal(waitingForDeveloper(null), false);
  assert.equal(waitingForDeveloper(undefined), false);
});

test("waitingRows: 기다리는 요청이 있는 프로젝트만, 오래 기다린 것이 먼저", () => {
  const today = at(2026, 10, 7);
  const projects = [
    { slug: "a", name: "회원", handoff: { state: "open", since: iso(2026, 10, 6) } },
    { slug: "b", name: "결제", handoff: null },
    { slug: "c", name: "정산", handoff: { state: "open", since: iso(2026, 10, 1) } },
    { slug: "d", name: "공지", handoff: { state: "merged", since: iso(2026, 9, 1) } },
    { slug: "e", name: "설정", handoff: { state: "changes_requested", since: iso(2026, 9, 1) } },
  ];
  assert.deepEqual(waitingRows(projects, today), [
    { slug: "c", name: "정산", days: 6 },
    { slug: "a", name: "회원", days: 1 },
  ]);
});

test("waitingRows: 때를 모르는 것은 맨 뒤고, 같은 날은 등록 순서를 지킨다", () => {
  const today = at(2026, 10, 7);
  const projects = [
    { slug: "x", name: "때 모름", handoff: { state: "open" } },
    { slug: "y", name: "오늘 1", handoff: { state: "open", since: iso(2026, 10, 7) } },
    { slug: "z", name: "오늘 2", handoff: { state: "open", since: iso(2026, 10, 7, 20) } },
  ];
  assert.deepEqual(
    waitingRows(projects, today).map((row) => row.slug),
    ["y", "z", "x"],
  );
  assert.equal(waitingRows(projects, today)[2]?.days, null);
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("여정은 코멘트가 없을 때 며칠째를 말한다 — 날짜 계산은 자정마다 갈아 끼우는 오늘로", () => {
  const workspace = read("../src/next/Workspace.tsx");
  assert.match(workspace, /const today = useToday\(\);/);
  assert.match(workspace, /waitingDays: daysSince\(daemon\.repo\?\.handoff\?\.since, today\)/);
});

test("홈의 한 줄은 지금 진행 중 묶음에 서고, 기다리는 줄은 사용자의 손이 필요한 수에 세지 않는다", () => {
  const inbox = read("../src/next/home/HomeInbox.tsx");
  assert.match(inbox, /waitingRows\(daemon\.projects, today\)/);
  assert.match(inbox, /const waitCount = feed\.asking\.length \+ otherWaiting\.length;/);
});
