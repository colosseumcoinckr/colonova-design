import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-making.test.ts 와 같은 모양).
import { daysSince } from "../src/next/lib/waiting.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * 기다림이 보이게(2026-10-07 UX 점검 3단계) — 개발자 확인을 기다리는 요청이 며칠째인지. 달력으로 센다.
 * 홈 자리의 줄 묶음(`waitingRows` · `waitingForDeveloper`)은 2026-10-31 홈 걷기로 걷혔다 — 사이드바 `화면` 줄의
 * 배지가 데몬의 `pendingCount` 로 그 말을 맡는다.
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

test("여정은 코멘트가 없을 때 며칠째를 말한다 — 날짜 계산은 자정마다 갈아 끼우는 오늘로", () => {
  const workspace = read("../src/next/Workspace.tsx");
  assert.match(workspace, /const today = useToday\(\);/);
  assert.match(workspace, /waitingDays: daysSince\(daemon\.repo\?\.handoff\?\.since, today\)/);
});

test("사이드바: `화면` 줄의 배지는 지금 프로젝트의 기다림만 센다(2026-10-31 홈 걷기)", () => {
  const sidebar = read("../src/next/sidebar/Sidebar.tsx");
  assert.match(sidebar, /const waiting = active\?\.pendingCount \?\? 0;/);
  // 옛 `홈` 줄(모든 프로젝트의 합)이 돌아오지 않게 — 합산이 남지 않는다.
  assert.doesNotMatch(sidebar, /projects\.reduce/);
  // 다른 프로젝트의 기다림은 `다른 프로젝트` 줄의 노트가 말한다(`projectNote` — 답을 기다려요 N).
  const note = read("../src/next/lib/project-note.ts");
  assert.match(note, /summary\.pendingCount > 0/);
});
