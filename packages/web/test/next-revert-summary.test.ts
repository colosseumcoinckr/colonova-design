import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(turn-screens.test.ts 와 같은 모양).
import { L } from "../src/next/labels.ts";
import {
  affectedScreens,
  dayKey,
  entryScreens,
  entryTitle,
  type HistoryNode,
  historyDays,
  historyRows,
  relativeTime,
  revertSummary,
} from "../src/next/lib/revert-summary.ts";

const PREFIX = L.history.commentPrefix;

/** `repo.history` 모양 — 최신이 앞. */
const ENTRIES = [
  { sha: "e", message: "표를 10줄씩 보여 줘", at: "2026-09-25T05:00:00Z" },
  { sha: "d", message: `${PREFIX}검색창을 오른쪽으로`, at: "2026-09-25T04:00:00Z" },
  { sha: "c", message: "등급 필터를 붙여 줘\n\n자세한 말", at: "2026-09-25T03:00:00Z" },
  { sha: "b", message: "회원 목록에 검색창을 넣어 줘", at: "2026-09-25T02:00:00Z" },
  { sha: "a", message: "회원 목록을 만들어 줘", at: "2026-09-25T01:00:00Z" },
];

test("revertSummary — 그 뒤의 차례 수를 센다", () => {
  assert.deepEqual(revertSummary(ENTRIES, 1, PREFIX), { count: 1, withComments: false });
  assert.equal(revertSummary(ENTRIES, 3, PREFIX).count, 3);
  assert.equal(revertSummary(ENTRIES, 4, PREFIX).count, 4);
});

test("revertSummary — 뒤에 코멘트 반영이 있으면 알린다", () => {
  assert.equal(revertSummary(ENTRIES, 1, PREFIX).withComments, false);
  assert.equal(revertSummary(ENTRIES, 2, PREFIX).withComments, true);
  assert.equal(revertSummary(ENTRIES, 4, PREFIX).withComments, true);
});

test("revertSummary — 맨 위(지금)와 범위 밖", () => {
  assert.deepEqual(revertSummary(ENTRIES, 0, PREFIX), { count: 0, withComments: false });
  assert.equal(revertSummary(ENTRIES, 99, PREFIX).count, ENTRIES.length);
  assert.equal(revertSummary([], 2, PREFIX).count, 0);
});

test("revertSummary — 제목 한가운데의 `코멘트 반영` 은 세지 않는다", () => {
  const entries = [{ message: `버튼 문구에서 ${PREFIX}빼 줘` }, { message: "처음" }];
  assert.equal(revertSummary(entries, 1, PREFIX).withComments, false);
});

test("확인 카드 문장 — 제목으로 묻고, 일의 크기는 칩 · 시각은 확정 단추가 말한다", () => {
  const { count, withComments } = revertSummary(ENTRIES, 3, PREFIX);
  assert.equal(
    L.history.confirmAsk(entryTitle(ENTRIES[3]?.message ?? "")),
    "「회원 목록에 검색창을 넣어 줘」 직후의 화면으로 되돌릴까요?",
  );
  assert.equal(L.history.chipChanges(count), "변경 3가지");
  assert.equal(withComments, true);
  assert.equal(L.history.chipScreens(3), "화면 3곳");
  assert.equal(L.history.revertAt("14:05"), "14:05 시점으로 되돌리기");
  // 낭독 이름은 시각 · 제목 · 일을 모두 싣는다 — 줄마다 같은 말의 단추를 가려내려고.
  assert.equal(
    L.history.revertLabel("14:05", "표를 10줄씩 보여 줘"),
    "14:05 · 표를 10줄씩 보여 줘 · 이때 화면으로 되돌리기",
  );
});

test("줄 끝의 되돌리기는 짧게, 화면이 여럿인 차례의 비교 단추는 화면 이름을 싣는다", () => {
  // 길게 말하는 것은 확인 카드 · 낭독 이름(`revertLabel`)이다 — 줄 끝은 조용한 한마디.
  assert.equal(L.history.toHere, "여기로 되돌리기");
  // 낭독 이름은 눈에 보이는 둘째 줄(만진 화면 · 코멘트 요지)도 싣고, 빈 칸(읽을 수 없는 시각)은 건너뛴다.
  assert.equal(
    L.history.revertLabel("14:05", "의견을 반영했어요", "버튼 문구 · 회원 목록"),
    "14:05 · 의견을 반영했어요 · 버튼 문구 · 회원 목록 · 이때 화면으로 되돌리기",
  );
  assert.equal(L.history.revertLabel("", "제목"), "제목 · 이때 화면으로 되돌리기");
  assert.equal(L.history.compareScreen("결제 내역"), "결제 내역 전·후 보기");
  assert.equal(L.compare.open, "수정 전·후 보기");
});

test("안심 문장 — 기록이 남고 다시 되돌릴 수 있다는 말이 코드의 동작과 같다", () => {
  // 데몬의 restore 는 지우지 않고 새 기록을 쌓는다(되돌리기: …) — 문장이 그 약속을 그대로 한다.
  assert.match(L.history.reassure, /기록은 남아요/);
  assert.match(L.history.reassure, /다시 되돌릴 수 있어요/);
  assert.match(L.history.reassure, /다음 제출 때 전해져요/);
});

test("affectedScreens — 그 뒤 차례들이 만진 화면을 겹치지 않게 모은다", () => {
  const screens = [
    { title: "회원 목록", note: "표를 10줄씩 보여 줘", sha: "e" },
    { title: "회원 상세", note: "x", sha: "d" },
    { title: "회원 목록", note: "x", sha: "d" },
    { title: "결제 내역", note: "x", sha: "c" },
  ];
  // 3번(검색창)으로 돌아가면 0~2번(e · d · c)이 되돌아간다 — 회원 목록은 두 번 나와도 한 번.
  assert.deepEqual(affectedScreens(ENTRIES, 3, screens), ["회원 목록", "회원 상세", "결제 내역"]);
  assert.deepEqual(affectedScreens(ENTRIES, 1, screens), ["회원 목록"]);
  // 맨 위(지금)는 되돌릴 것이 없다.
  assert.deepEqual(affectedScreens(ENTRIES, 0, screens), []);
  // 화면 지도가 없으면 빈 목록 — 문장은 부르는 쪽이 `알 수 없음` 으로 간다.
  assert.deepEqual(affectedScreens(ENTRIES, 3, undefined), []);
  assert.deepEqual(affectedScreens(ENTRIES, 99, screens), ["회원 목록", "회원 상세", "결제 내역"]);
});

test("relativeTime — 1분 안은 방금, 한 시간 안은 N분 전, 그 밖은 시계", () => {
  const now = Date.parse("2026-10-06T10:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  assert.deepEqual(relativeTime(ago(0), now), { kind: "now" });
  assert.deepEqual(relativeTime(ago(59_000), now), { kind: "now" });
  assert.deepEqual(relativeTime(ago(60_000), now), { kind: "minutes", minutes: 1 });
  assert.deepEqual(relativeTime(ago(3 * 60_000 + 20_000), now), { kind: "minutes", minutes: 3 });
  assert.deepEqual(relativeTime(ago(59 * 60_000 + 59_000), now), { kind: "minutes", minutes: 59 });
  assert.deepEqual(relativeTime(ago(60 * 60_000), now), { kind: "clock" });
  assert.deepEqual(relativeTime(ago(26 * 3600_000), now), { kind: "clock" });
});

test("relativeTime — 앞선 시각(시계 어긋남)은 방금, 읽을 수 없는 시각은 시계", () => {
  const now = Date.parse("2026-10-06T10:00:00Z");
  assert.deepEqual(relativeTime("2026-10-06T10:05:00Z", now), { kind: "now" });
  assert.deepEqual(relativeTime("not a date", now), { kind: "clock" });
  assert.deepEqual(relativeTime("2026-10-06T09:59:00Z", Number.NaN), { kind: "clock" });
});

test("entryTitle — 첫 줄만", () => {
  assert.equal(entryTitle("등급 필터를 붙여 줘\n\n자세한 말"), "등급 필터를 붙여 줘");
  assert.equal(entryTitle(""), "");
});

test("historyRows — 제출은 그보다 오래된 첫 차례 위에 선다", () => {
  const rows = historyRows(ENTRIES, ["2026-09-25T02:30:00Z"]);
  assert.deepEqual(rows, [
    { kind: "entry", index: 0 },
    { kind: "entry", index: 1 },
    { kind: "entry", index: 2 },
    { kind: "submit", at: "2026-09-25T02:30:00Z" },
    { kind: "entry", index: 3 },
    { kind: "entry", index: 4 },
  ]);
});

test("historyRows — 사이클 밖의 제출은 긋지 않고, 같은 틈의 제출은 하나로 접는다", () => {
  const rows = historyRows(ENTRIES, [
    "2026-09-24T00:00:00Z",
    "2026-09-25T04:10:00Z",
    "2026-09-25T04:40:00Z",
    "not a date",
  ]);
  assert.deepEqual(rows.slice(0, 3), [
    { kind: "entry", index: 0 },
    { kind: "submit", at: "2026-09-25T04:40:00Z" },
    { kind: "entry", index: 1 },
  ]);
  assert.equal(rows.filter((row) => row.kind === "submit").length, 1);
});

test("historyRows — 모든 차례보다 새 제출은 맨 위에 선다", () => {
  const rows = historyRows(ENTRIES, ["2026-09-25T06:00:00Z"]);
  assert.deepEqual(rows[0], { kind: "submit", at: "2026-09-25T06:00:00Z" });
});

test("entryScreens — 차례의 제목(note)으로 짝짓고, 제목 없는 화면은 뺀다", () => {
  const screens = [
    { route: "/member", title: "회원 목록", note: "회원 목록에 검색창을 넣어 줘", at: "x" },
    { route: "/member/1", title: "회원 상세", note: "회원 목록에 검색창을 넣어 줘", at: "x" },
    { route: "/x", title: "", note: "회원 목록에 검색창을 넣어 줘", at: "x" },
    { route: "/member", title: "회원 목록", note: "회원 목록에 검색창을 넣어 줘", at: "y" },
    { route: "/order", title: "주문 목록", note: "다른 말", at: "x" },
  ];
  assert.deepEqual(entryScreens(ENTRIES[3] ?? { message: "" }, screens), [
    "회원 목록",
    "회원 상세",
  ]);
  assert.deepEqual(entryScreens(ENTRIES[0] ?? { message: "" }, screens), []);
  assert.deepEqual(entryScreens(ENTRIES[0] ?? { message: "" }, undefined), []);
});

test("entryScreens — sha 를 실은 화면은 sha 로도 짝짓는다", () => {
  const screens = [{ title: "주문 목록", note: "딴 제목", sha: "e" }];
  assert.deepEqual(entryScreens(ENTRIES[0] ?? { message: "" }, screens), ["주문 목록"]);
});

// ── 서랍의 타임라인(2026-10-06 작업 기록 손질) — 날마다 묶고, 이어진 반영 차례만 접는다.

/** 이 컴퓨터의 시계로 만든 시각 — 시험이 어느 시간대에서 돌아도 같은 날로 읽힌다. */
const local = (month: number, day: number, hour: number, minute = 0) =>
  new Date(2026, month - 1, day, hour, minute).toISOString();

/** 노드를 문자 한 자로 적는 표 — r 요청 · m 반영 · c 코멘트 · u 되돌리기. */
const NODE: Record<string, HistoryNode> = {
  r: "request",
  m: "merge",
  c: "comment",
  u: "restore",
};
const nodes = (codes: string) => (index: number) => NODE[codes[index] ?? "r"] ?? "request";

test("dayKey — 이 컴퓨터의 시계 기준 날, 읽을 수 없으면 빈 문자열", () => {
  assert.equal(dayKey(local(10, 6, 0, 5)), "2026-10-06");
  assert.equal(dayKey(local(10, 6, 23, 59)), "2026-10-06");
  assert.equal(dayKey("not a date"), "");
});

test("historyDays — 같은 날은 한 묶음, 날이 바뀌면 새 묶음(최신이 앞)", () => {
  const entries = [
    { at: local(10, 6, 13) },
    { at: local(10, 6, 9) },
    { at: local(10, 5, 22) },
    { at: local(10, 2, 10) },
  ];
  const days = historyDays(entries, [], nodes("rrrr"));
  assert.deepEqual(
    days.map((day) => [day.date, day.items.length]),
    [
      ["2026-10-06", 2],
      ["2026-10-05", 1],
      ["2026-10-02", 1],
    ],
  );
  assert.equal(days[0]?.at, entries[0]?.at);
});

test("historyDays — 이어진 반영 차례는 한 줄에 접고 횟수를 센다", () => {
  const entries = [
    { at: local(10, 6, 13) },
    { at: local(10, 6, 12) },
    { at: local(10, 6, 11) },
    { at: local(10, 6, 10) },
  ];
  const [day] = historyDays(entries, [], nodes("mmmr"));
  assert.deepEqual(day?.items, [
    { kind: "entry", index: 0, node: "merge", folded: 2 },
    { kind: "entry", index: 3, node: "request", folded: 0 },
  ]);
});

test("historyDays — 반영 차례는 요청 · 코멘트 · 되돌리기 줄에 접히지 않는다(되돌아갈 곳이 사라지지 않게)", () => {
  // 최신 → 오래된: 요청 · 반영 · 코멘트 · 반영 · 되돌리기 · 반영. 접을 이웃이 없다.
  const entries = [6, 5, 4, 3, 2, 1].map((hour) => ({ at: local(10, 6, hour + 6) }));
  const [day] = historyDays(entries, [], nodes("rmcmum"));
  assert.deepEqual(
    day?.items.map((item) => (item.kind === "entry" ? [item.index, item.folded] : "submit")),
    [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
    ],
  );
});

test("historyDays — 제출 구분선과 날이 바뀌는 곳은 접힘을 끊는다", () => {
  const entries = [{ at: local(10, 6, 13) }, { at: local(10, 6, 11) }, { at: local(10, 5, 23) }];
  // 제출이 두 반영 차례 사이에 있다 — 한 줄로 합치면 제출 전후가 섞인다.
  const split = historyDays(entries, [local(10, 6, 12)], nodes("mmm"));
  assert.deepEqual(
    split.map((day) => day.items.map((item) => item.kind)),
    [["entry", "submit", "entry"], ["entry"]],
  );
  // 자정을 넘는 이웃은 같은 날이 아니다.
  const days = historyDays(entries, [], nodes("mmm"));
  assert.equal(days.length, 2);
  assert.equal(days[0]?.items.length, 1);
  assert.deepEqual(days[0]?.items[0], { kind: "entry", index: 0, node: "merge", folded: 1 });
});

test("historyDays — 제출 구분선은 제 시각의 날에 선다", () => {
  // 오늘 낮의 제출이 어제 밤 차례 위에 걸려도 `어제` 묶음으로 들어가지 않는다.
  const entries = [{ at: local(10, 6, 14) }, { at: local(10, 5, 21) }];
  const days = historyDays(entries, [local(10, 6, 9)], nodes("rr"));
  assert.deepEqual(
    days.map((day) => [day.date, day.items.map((item) => item.kind)]),
    [
      ["2026-10-06", ["entry", "submit"]],
      ["2026-10-05", ["entry"]],
    ],
  );
  // 두 날 사이에 낀 제 날(어제)의 제출은 그 날만의 묶음이다.
  const gap = [{ at: local(10, 6, 14) }, { at: local(10, 3, 9) }];
  const apart = historyDays(gap, [local(10, 5, 8)], nodes("rr"));
  assert.deepEqual(
    apart.map((day) => day.date),
    ["2026-10-06", "2026-10-05", "2026-10-03"],
  );
  assert.deepEqual(apart[1]?.items, [{ kind: "submit", at: local(10, 5, 8) }]);
});

test("historyDays — 묶음의 열쇠는 겹치지 않고, 빈 목록은 빈 묶음 없이 비어 있다", () => {
  // 시계가 어긋나 같은 날이 떨어져 두 번 나와도 열쇠(React key)는 따로다.
  const skewed = [{ at: local(10, 6, 9) }, { at: local(10, 5, 9) }, { at: local(10, 6, 7) }];
  const ids = historyDays(skewed, [], nodes("rrr")).map((day) => day.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(historyDays([], [], nodes("")), []);
});
