/**
 * 재생 벤치 순수 함수의 시험 — `pnpm test` 가 scripts/bench/*.test.mjs 를
 * 함께 돌린다. 데몬이나 미리보기는 부르지 않는다.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  collectRows,
  compareResults,
  countFlaky,
  judge,
  loadScenarios,
  median,
  pinHints,
  pinsOf,
  pinTurnText,
  renderCompareTable,
  renderSummaryTable,
  scoreTargets,
  statsFiles,
  summaryOf,
  turnProgress,
  validateScenarios,
} from "./lib.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const turn = (over = {}) => ({
  at: "2026-09-28T01:00:00.000Z",
  sessionId: "s1",
  kind: "user",
  isError: false,
  durationMs: 10_000,
  tools: { read: 2, edit: 1, exec: 3, browser: 1, other: 0 },
  contextTokens: 12_000,
  firstEditMs: 9_000,
  browserMs: 400,
  ...over,
});
const gate = (over = {}) => ({
  at: "2026-09-28T01:01:00.000Z",
  sessionId: "s1",
  kind: "gateset",
  gateMs: 3_000,
  screens: 1,
  reopened: false,
  ...over,
});

// ---------------------------------------------------------------------------
// 시나리오 검증
// ---------------------------------------------------------------------------

test("시나리오 검증 — 저장소의 시나리오 파일은 통과한다", () => {
  assert.doesNotThrow(() => loadScenarios(join(HERE, "scenarios/fixture.json")));
  assert.doesNotThrow(() => loadScenarios(join(HERE, "scenarios/cds.json")));
  assert.doesNotThrow(() => loadScenarios(join(HERE, "scenarios/compare.json")));
  assert.doesNotThrow(() => loadScenarios(join(HERE, "scenarios/suggest.json")));
});

test("시나리오 검증 — 필수 칸 · 종류 · 중복 id", () => {
  assert.throws(() => validateScenarios([]), /비어 있지 않은 배열/);
  assert.throws(
    () => validateScenarios([{ id: "a", kind: "reply", text: "x", expect: { files: ["a"] } }]),
    /kind 는/,
  );
  assert.throws(
    () => validateScenarios([{ id: "a", kind: "user", expect: { files: ["a"] } }]),
    /text 가 없습니다/,
  );
  assert.throws(
    () =>
      validateScenarios([
        { id: "a", kind: "pin", note: "메모", pins: [], expect: { files: ["a"] } },
      ]),
    /pins 목록이 없습니다/,
  );
  assert.throws(
    () =>
      validateScenarios([
        {
          id: "a",
          kind: "pin",
          note: "메모",
          pins: [{ screen: "list" }],
          expect: { files: ["a"] },
        },
      ]),
    /pins\[0\] 의 text/,
  );
  assert.throws(
    () => validateScenarios([{ id: "a", kind: "user", text: "x", expect: {} }]),
    /expect\.files/,
  );
  const ok = { id: "a", kind: "user", text: "x", expect: { files: ["a"] } };
  assert.throws(() => validateScenarios([ok, { ...ok }]), /겹칩니다/);
  assert.doesNotThrow(() => validateScenarios([ok]));
});

// ---------------------------------------------------------------------------
// 핀 턴
// ---------------------------------------------------------------------------

const PIN = {
  id: "pin-title",
  kind: "pin",
  note: "제목을 더 크게 해 줘",
  pins: [{ screen: "list", text: "회원 목록" }],
  expect: { files: ["server.js"] },
};

test("핀 턴 — 마커로 시작하고 items 의 id 가 pinHints 의 id 와 같다", () => {
  const text = pinTurnText(PIN);
  assert.ok(text.startsWith("<!-- colonova-design:comments "));
  const firstLine = text.split("\n")[0];
  const marker = JSON.parse(
    firstLine.replace(/^<!-- colonova-design:comments /, "").replace(/ -->$/, ""),
  );
  const hints = pinHints(PIN);
  assert.deepEqual(
    marker.items.map((item) => item.id),
    hints.map((hint) => hint.id),
  );
  assert.equal(marker.screen, "list");
  assert.equal(marker.note, "제목을 더 크게 해 줘");
  assert.equal(hints[0].screen, "list");
  assert.deepEqual(pinsOf(PIN), [{ screen: "list" }]);
});

test("핀 턴 — 문장 · 안내 한 줄 · 핀 줄 · 메모 한 줄", () => {
  // 마커 한 줄 다음이 본문이다: 문장, 빈 줄, 안내, 빈 줄, 핀 줄, 메모 줄.
  const [, sentence, blank, guide, blank2, pinLine, memoLine] = pinTurnText(PIN).split("\n");
  assert.equal(sentence, "제목을 더 크게 해 줘");
  assert.equal(blank, "");
  assert.equal(guide, "아래는 사용자가 가리킨 자리입니다 — 사용자의 말대로 해 주세요.");
  assert.equal(blank2, "");
  assert.equal(pinLine, '1. 회원 목록 — "회원 목록"');
  assert.equal(memoLine, "   제목을 더 크게 해 줘");
});

// ---------------------------------------------------------------------------
// 행 모으기 — 다른 세션 · 깨진 줄 무시 · 이틀 치
// ---------------------------------------------------------------------------

test("행 모으기 — 이틀 치를 시간 순으로, 남의 것과 깨진 줄은 무시한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "colonova-bench-"));
  const yesterday = join(dir, "turn-stats-2026-09-27.jsonl");
  const today = join(dir, "turn-stats-2026-09-28.jsonl");
  writeFileSync(
    yesterday,
    [
      JSON.stringify(turn({ at: "2026-09-27T23:59:00.000Z", sessionId: "other" })),
      "깨진 줄 {",
      "",
      JSON.stringify(turn({ at: "2026-09-27T23:58:00.000Z" })),
    ].join("\n"),
  );
  writeFileSync(
    today,
    [
      JSON.stringify(gate({ at: "2026-09-28T00:00:30.000Z" })),
      JSON.stringify(turn({ at: "2026-09-28T00:00:00.000Z" })),
    ].join("\n"),
  );
  const rows = collectRows([yesterday, today], "s1");
  assert.deepEqual(
    rows.map((row) => row.at),
    ["2026-09-27T23:58:00.000Z", "2026-09-28T00:00:00.000Z", "2026-09-28T00:00:30.000Z"],
  );

  const files = statsFiles("/logs", new Date("2026-09-28T12:00:00.000Z"));
  assert.deepEqual(
    files.map((file) => basename(file)),
    ["turn-stats-2026-09-28.jsonl", "turn-stats-2026-09-27.jsonl"],
  );
});

// ---------------------------------------------------------------------------
// 끝 판정
// ---------------------------------------------------------------------------

test("끝 판정 — 턴 행이 내려오면 끝, gateset 을 기다리지 않는다", () => {
  assert.deepEqual(turnProgress([]), { done: false, waiting: "turn" });
  // 2026-10-20 내장 게이트 제거 뒤 새 실행에는 gateset 행이 오지 않는다.
  assert.deepEqual(turnProgress([turn()]), { done: true });
  assert.deepEqual(turnProgress([turn(), gate()]), { done: true });
  // gateset 이 먼저 나오고 턴이 없으면 끝이 아니다.
  assert.deepEqual(turnProgress([gate()]), { done: false, waiting: "turn" });
});

test("끝 판정 — reopened 뒤에는 턴 하나를 더 기다린다", () => {
  const rows = [turn(), gate({ reopened: true })];
  assert.deepEqual(turnProgress(rows), { done: false, waiting: "reopen-turn" });
  const fixed = [...rows, turn({ at: "2026-09-28T01:05:00.000Z" })];
  assert.deepEqual(turnProgress(fixed), { done: true });
  // 게이트는 두 번 서지 않는다 — reopened 뒤의 gateset(skipped) 은 기다림이 아니다.
  const settled = [...fixed, gate({ at: "2026-09-28T01:06:00.000Z", skipped: "once" })];
  assert.deepEqual(turnProgress(settled), { done: true });
});

test("끝 판정 — 오류 · 중지로 끝난 턴도 그대로 끝난다", () => {
  assert.deepEqual(turnProgress([turn({ isError: true, failure: "stream" })]), { done: true });
  assert.deepEqual(turnProgress([turn({ subtype: "interrupted" })]), { done: true });
  // 오류 턴 뒤에 정상 턴이 이어져도 마지막 턴이면 끝이다.
  assert.deepEqual(
    turnProgress([turn({ isError: true }), turn({ at: "2026-09-28T01:02:00.000Z" })]),
    { done: true },
  );
});

// ---------------------------------------------------------------------------
// 판정
// ---------------------------------------------------------------------------

test("판정 — 파일 부분 일치 · 내용 · isError", () => {
  const scenario = {
    id: "s",
    kind: "user",
    text: "x",
    expect: { files: ["screens/member/"], contains: ["검색"] },
  };
  const contents = new Map([["src/screens/member/MemberList.screen.tsx", "여기 검색창이 있다"]]);
  assert.deepEqual(
    judge(scenario, ["src/screens/member/MemberList.screen.tsx"], contents, turn()),
    {
      pass: true,
      reasons: [],
    },
  );
  const noFile = judge(scenario, ["src/screens/order/OrderList.screen.tsx"], new Map(), turn());
  assert.equal(noFile.pass, false);
  assert.ok(noFile.reasons.some((reason) => reason.includes("screens/member/")));

  const noNeedle = judge(
    scenario,
    ["src/screens/member/MemberList.screen.tsx"],
    new Map([["src/screens/member/MemberList.screen.tsx", "없다"]]),
    turn(),
  );
  assert.ok(noNeedle.reasons.some((reason) => reason.includes("검색")));

  const errored = judge(
    { ...scenario, expect: { files: ["a"] } },
    ["a.ts"],
    new Map(),
    turn({ isError: true, failure: "stream" }),
  );
  assert.ok(errored.reasons.some((reason) => reason.includes("오류")));

  const noTurn = judge({ ...scenario, expect: { files: ["a"] } }, ["a.ts"], new Map(), null);
  assert.ok(noTurn.reasons.some((reason) => reason.includes("끝난 턴이 없습니다")));
});

// ---------------------------------------------------------------------------
// 요약과 비교
// ---------------------------------------------------------------------------

test("요약 칸 — 합 · 첫 턴의 첫 편집 · 컨텍스트 최대 · 게이트 재개", () => {
  const entry = {
    id: "search",
    pass: true,
    turns: [
      turn({ firstEditMs: 5_000, contextTokens: 10_000 }),
      turn({ contextTokens: 20_000, browserMs: null }),
    ],
    gate: gate({ reopened: true }),
  };
  const row = summaryOf(entry);
  assert.equal(row.pass, true);
  assert.equal(row.ms, 20_000);
  assert.equal(row.firstEditMs, 5_000);
  assert.equal(row.contextTokens, 20_000);
  assert.equal(row.browser, 2);
  assert.equal(row.browserMs, 400);
  assert.equal(row.exec, 6);
  assert.equal(row.reopened, true);
  // 비용 · 토큰을 모르는 턴뿐이면 0 이 아니라 null 이다.
  assert.equal(row.costUsd, null);
  assert.equal(row.outputTokens, null);
  assert.equal(row.cacheHitRate, null);

  const unmeasured = summaryOf({
    id: "x",
    pass: false,
    turns: [turn({ browserMs: null, contextTokens: null })],
  });
  assert.equal(unmeasured.browserMs, null);
  assert.equal(unmeasured.contextTokens, null);
  assert.equal(summaryOf({ id: "x", pass: false, turns: [] }).ms, 0);
});

test("요약 칸 — 비용은 합, 출력 토큰은 합, 캐시 적중률은 입력 전체의 가중 평균(2026-10-02)", () => {
  const priced = summaryOf({
    id: "search",
    pass: true,
    turns: [
      // 0.125 + 0.25 — 이진 소수로 정확히 떨어지는 값이라 합이 흔들리지 않는다.
      turn({
        costUsd: 0.125,
        tokens: { input: 1_000, output: 500, cacheRead: 9_000, cacheWrite: 0 },
      }),
      // 캐시 쓰기를 모르는 프로바이더의 턴(cacheWrite: null)은 분모에 0 으로 든다.
      turn({
        costUsd: null,
        tokens: { input: 2_000, output: 700, cacheRead: 8_000, cacheWrite: null },
      }),
      turn({ costUsd: 0.25 }),
    ],
  });
  assert.equal(priced.costUsd, 0.375);
  assert.equal(priced.outputTokens, 1_200);
  // (9000 + 8000) / (1000 + 9000 + 2000 + 8000)
  assert.equal(priced.cacheHitRate, 17_000 / 20_000);
  // 토큰은 있는데 입력이 0 이면 비율은 성립하지 않는다.
  const noInput = summaryOf({
    id: "x",
    pass: true,
    turns: [turn({ tokens: { input: 0, output: 10, cacheRead: 0, cacheWrite: 0 } })],
  });
  assert.equal(noInput.cacheHitRate, null);
  assert.equal(noInput.outputTokens, 10);
});

test("비교 — 중앙값 · 변화율 · 한쪽에만 있는 id", () => {
  const a = {
    scenarios: [
      { id: "search", pass: true, turns: [turn({ durationMs: 10_000 })] },
      { id: "form", pass: true, turns: [turn({ durationMs: 4_000 })] },
    ],
  };
  const b = {
    scenarios: [
      {
        id: "search",
        pass: true,
        turns: [turn({ durationMs: 8_000 }), turn({ durationMs: 12_000 })],
      },
      { id: "new", pass: false, turns: [turn({ durationMs: 1_000 })] },
    ],
  };
  const rows = compareResults(a, b);
  assert.equal(rows.length, 3);
  const search = rows.find((row) => row.id === "search");
  assert.equal(search.ms.a, 10_000);
  // 한 번의 실행(= 시나리오 항목 하나)의 ms 는 그 턴들의 합이다 — 중앙값은 실행끼리 잰다.
  assert.equal(search.ms.b, 20_000);
  assert.equal(search.msChange, 1);
  const form = rows.find((row) => row.id === "form");
  assert.equal(form.ms.b, null);
  assert.equal(form.msChange, null);
  assert.equal(form.passB, 0);
  const fresh = rows.find((row) => row.id === "new");
  assert.equal(fresh.ms.a, null);
  assert.equal(fresh.passA, 0);
  assert.equal(fresh.msChange, null);
  // 비용 칸 — 없는 쪽은 null, 변화율은 양쪽이 있을 때만.
  assert.deepEqual(search.costUsd, { a: null, b: null });
  assert.equal(search.costChange, null);
  const priced = compareResults(
    { scenarios: [{ id: "s", pass: true, turns: [turn({ costUsd: 0.2 })] }] },
    { scenarios: [{ id: "s", pass: true, turns: [turn({ costUsd: 0.1 })] }] },
  )[0];
  assert.equal(priced.costUsd.a, 0.2);
  assert.equal(priced.costUsd.b, 0.1);
  assert.equal(priced.costChange, -0.5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test("표 — 헤더와 시나리오마다 한 줄씩", () => {
  const table = renderSummaryTable([{ id: "search", pass: true, turns: [turn()], gate: gate() }]);
  const lines = table.split("\n");
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes("시나리오"));
  assert.ok(lines[2].includes("search"));
  const compare = renderCompareTable(compareResults({ scenarios: [] }, { scenarios: [] }));
  assert.ok(compare.includes("시나리오"));
});

// ---------------------------------------------------------------------------
// 시나리오 검증 — suggest(2026-11-03 · A안 0-2 C8)
// ---------------------------------------------------------------------------

test("시나리오 검증 — suggest 는 brief · pageId 가 필요하고 expect.sections 는 비어도 된다", () => {
  assert.doesNotThrow(() =>
    validateScenarios([
      {
        id: "s1",
        kind: "suggest",
        pageId: "123",
        brief: "규칙을 바꿔 줘",
        expect: { sections: ["절"] },
      },
    ]),
  );
  // 빈 expect.sections 는 「잘못 짚음 없음」을 재는 편 — 허용한다.
  assert.doesNotThrow(() =>
    validateScenarios([
      {
        id: "s2",
        kind: "suggest",
        pageId: "123",
        brief: "규칙을 바꿔 줘",
        expect: { sections: [] },
      },
    ]),
  );
  assert.throws(
    () =>
      validateScenarios([
        { id: "s3", kind: "suggest", pageId: "123", expect: { sections: ["절"] } },
      ]),
    /brief/,
  );
  assert.throws(
    () =>
      validateScenarios([
        { id: "s4", kind: "suggest", brief: "규칙을 바꿔 줘", expect: { sections: ["절"] } },
      ]),
    /pageId/,
  );
});

// ---------------------------------------------------------------------------
// 1층 채점 — scoreTargets(2026-11-03 · A안 0-2)
// ---------------------------------------------------------------------------

const SHEET = {
  docs: [
    { title: "가 정책서", pageId: null, sections: ["절1"] },
    { title: "나 정책서", pageId: null, sections: ["절2"] },
  ],
  links: [
    { doc: "가 정책서", route: "/a", section: "절1" },
    // /b 는 일부러 비워 둔다 — 1층이 놓치는 요청이 생긴다.
    { doc: "나 정책서", route: "/n", section: null },
  ],
  requests: [
    { id: "hit-a", request: "가를 고쳐 줘", route: "/a", doc: "가 정책서", sections: ["절1"] },
    { id: "miss-b", request: "나를 고쳐 줘", route: "/b", doc: "나 정책서", sections: ["절2"] },
    // 기대 문서가 다른 데(가)로 잇긴 화면 — 놓침과 잘못 닿음이 한 요청에 겹친다.
    { id: "both", request: "가를 건드려 줘", route: "/a", doc: "나 정책서", sections: ["절2"] },
    { id: "null-hit", request: "모양을 고쳐 줘", route: "/c", doc: null, sections: [] },
    { id: "null-miss", request: "목록을 고쳐 줘", route: "/n", doc: null, sections: [] },
  ],
};

test("1층 채점 — 놓침(기대 문서 없음)과 잘못 닿음(기대 밖 문서)을 가른다", () => {
  const result = scoreTargets(SHEET);
  assert.equal(result.total, 5);
  assert.equal(result.hit, 2);
  assert.deepEqual([...result.missed].sort(), ["both", "miss-b"]);
  assert.deepEqual([...result.extra].sort(), ["both", "null-miss"]);
});

test("1층 채점 — links 파일 모드는 pageId 가 빠지면 사람 말로 멈춘다", () => {
  const filled = {
    ...SHEET,
    docs: SHEET.docs.map((doc, i) => ({ ...doc, pageId: String(100 + i) })),
  };
  const links = [{ pageId: "100", route: "/a", section: "절1" }];
  const result = scoreTargets(filled, { links });
  assert.equal(result.total, 5);
  assert.equal(result.hit, 3);
  assert.deepEqual([...result.missed].sort(), ["both", "miss-b"]);
  assert.deepEqual(result.extra, ["both"]);
  assert.throws(() => scoreTargets(SHEET, { links }), /pageId 가 비어/);
});

// ---------------------------------------------------------------------------
// 흔들림 — countFlaky(2026-11-03 · A안 0-2)
// ---------------------------------------------------------------------------

test("흔들림 — 같은 시나리오의 짚은 절 묶음이 첫 회와 달라진 회 수를 센다", () => {
  const entries = [
    { id: "a", sections: ["x", "y"] },
    { id: "a", sections: ["y", "x"] }, // 순서만 다르면 같은 묶음이다.
    { id: "a", sections: ["x"] }, // 달라짐.
    { id: "b", sections: ["z"] },
    { id: "b", sections: ["z", "w"] }, // 달라짐.
    { id: "c" }, // 절을 읽지 못한 회 — 세지도 기준도 안 된다.
    { id: "c", sections: ["x"] }, // c 의 첫 읽힌 회가 기준.
    { id: "c", sections: ["x", "q"] }, // 달라짐.
  ];
  const flaky = countFlaky(entries);
  assert.equal(flaky.total, 3);
  assert.deepEqual(flaky.byId, { a: 1, b: 1, c: 1 });
  assert.equal(countFlaky([]).total, 0);
});
