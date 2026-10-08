// 반영된 일의 순수 시험 (2026-10-08 베타 준비 분석 · A2b) — 병합이 사건과 원장에 제목 · 며칠 · 화면 수를 싣고,
// 반려는 쌓지 않으며, 원장의 기억은 스무 건 · 옛 원장도 읽힌다. 프로세스를 띄우지 않는다.
// `../dist` 임포트인 이유: cycle-reconcile 은 형제를 `.js` 지정자로 부른다(cycle-reconcile.test.ts 와 같은 길).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { LandedWork } from "@colonova-design/protocol";
import {
  type CycleLedger,
  emptyLedger,
  LANDED_KEEP,
  parseLedger,
  recordLanded,
} from "../dist/cycle-ledger.js";
import {
  type CycleSnapshot,
  landedDays,
  landedWorkOf,
  nextCycleAction,
} from "../dist/cycle-reconcile.js";

const BRANCH = "colonova-design/20261008-1";
const NOW = new Date(2026, 9, 8, 14, 0, 0).getTime();
/** 이 기계의 달력으로 `day` 일 `hour` 시 — 시험이 어느 시간대에서 돌아도 달력의 차이가 같다. */
const local = (day: number, hour = 12) => new Date(2026, 9, day, hour, 0, 0);

function snap(over: Partial<CycleSnapshot> = {}): CycleSnapshot {
  return {
    now: NOW,
    turnRunning: false,
    gitOp: null,
    conflictFiles: [],
    markersLeft: [],
    taggedStash: null,
    headBranch: BRANCH,
    registryBranch: BRANCH,
    baseBranch: "main",
    originBaseExists: true,
    defaultBranch: "main",
    dirtyFiles: 0,
    aheadOfBase: 0,
    behindBase: 0,
    remoteBranchExists: true,
    localAheadOfRemote: 0,
    remoteAheadOfLocal: 0,
    pr: null,
    commitsAfterPrHead: null,
    handoffState: null,
    newReviews: [],
    pendingReviews: [],
    reviewCount: null,
    installStale: false,
    hygieneDue: false,
    githubReachable: true,
    githubAuthExpired: false,
    corruption: null,
    ...over,
  };
}

const led = (over: Partial<CycleLedger> = {}): CycleLedger => ({ ...emptyLedger(), ...over });

type Pr = NonNullable<CycleSnapshot["pr"]>;
const mergedPr = (over: Partial<Pr> = {}): Pr => ({
  number: 12,
  state: "merged",
  headSha: "abc1234",
  mergeableState: null,
  ...over,
});

// ————— 판정 — 병합이 사건과 원장에 싣는 것 —————

test("병합 — 사건이 제목 · 며칠 · 화면 수를 싣고 원장이 같은 값을 기억한다", () => {
  const since = local(5, 10).toISOString();
  const closedAt = local(8, 9).toISOString();
  const out = nextCycleAction(
    snap({
      pr: mergedPr({ since, closedAt }),
      commitsAfterPrHead: 0,
      handoffState: "open",
      work: { title: "회원 목록에 이름 검색", screens: 2 },
    }),
    led(),
  );
  assert.deepEqual(out.tapeEvents, [
    { kind: "cycle.merged", pr: 12, title: "회원 목록에 이름 검색", days: 3, screens: 2 },
  ]);
  assert.deepEqual(out.ledger.landed, [
    { at: closedAt, pr: 12, title: "회원 목록에 이름 검색", days: 3, screens: 2 },
  ]);
  // OS 알림은 제목만 더 싣는다 — 며칠 · 화면 수는 사건의 몫이다.
  assert.deepEqual(out.handoffEvents, [
    { state: "merged", pr: 12, title: "회원 목록에 이름 검색" },
  ]);
  assert.equal(out.ledger.ended?.state, "merged");
});

test("병합 — 재료를 모르면 그 말을 싣지 않는다(옛 사건과 같은 모양)", () => {
  const out = nextCycleAction(
    snap({ pr: mergedPr(), commitsAfterPrHead: 0, handoffState: "open" }),
    led(),
  );
  assert.deepEqual(out.tapeEvents, [{ kind: "cycle.merged", pr: 12 }]);
  assert.deepEqual(out.handoffEvents, [{ state: "merged", pr: 12 }]);
  // 병합은 성취라 재료가 없어도 한 줄은 남는다 — 때는 지금이다.
  assert.deepEqual(out.ledger.landed, [{ at: new Date(NOW).toISOString(), pr: 12 }]);
});

test("병합 — 같은 날 반영은 0일, 화면 0곳은 말하지 않는다", () => {
  const out = nextCycleAction(
    snap({
      pr: mergedPr({ since: local(8, 9).toISOString(), closedAt: local(8, 13).toISOString() }),
      commitsAfterPrHead: 0,
      handoffState: "open",
      work: { screens: 0 },
    }),
    led(),
  );
  assert.deepEqual(out.tapeEvents, [{ kind: "cycle.merged", pr: 12, days: 0 }]);
});

test("반려 — 성취가 아니라 쌓지 않는다", () => {
  const out = nextCycleAction(
    snap({
      pr: mergedPr({ state: "closed", since: local(5).toISOString() }),
      commitsAfterPrHead: 2,
      handoffState: "open",
      work: { title: "닫힌 일", screens: 3 },
    }),
    led(),
  );
  assert.deepEqual(out.tapeEvents, [{ kind: "cycle.closed", pr: 12 }]);
  assert.equal(out.ledger.landed, undefined);
  assert.deepEqual(out.handoffEvents, [{ state: "closed", pr: 12 }]);
});

test("병합 — 이미 끝난 PR 은 다시 쌓지 않는다(재시작 · 되풀이 관찰)", () => {
  const first = nextCycleAction(
    snap({ pr: mergedPr(), commitsAfterPrHead: 0, handoffState: "open", work: { title: "한 번" } }),
    led(),
  );
  const again = nextCycleAction(
    snap({ pr: mergedPr(), commitsAfterPrHead: 0, handoffState: "open", work: { title: "두 번" } }),
    first.ledger,
  );
  assert.deepEqual(again.tapeEvents, []);
  assert.equal(again.ledger.landed?.length, 1);
  assert.equal(again.ledger.landed?.[0]?.title, "한 번");
});

test("병합 — 새 사이클이 시작돼도(원장의 다른 필드가 바뀌어도) 기억은 남는다", () => {
  const before = nextCycleAction(
    snap({ pr: mergedPr(), commitsAfterPrHead: 0, handoffState: "open", work: { title: "첫 일" } }),
    led(),
  );
  // 다음 사이클의 다른 PR 이 병합돼도 앞선 기록 위에 쌓인다 — 최근 것이 맨 앞.
  const next = nextCycleAction(
    snap({
      pr: mergedPr({ number: 13 }),
      commitsAfterPrHead: 0,
      handoffState: "open",
      work: { title: "둘째 일" },
    }),
    before.ledger,
  );
  assert.deepEqual(
    next.ledger.landed?.map((entry) => [entry.pr, entry.title]),
    [
      [13, "둘째 일"],
      [12, "첫 일"],
    ],
  );
});

test("병합 — 순수하다: 입력 원장은 바뀌지 않는다", () => {
  const input = led({ landed: [{ at: local(1).toISOString(), pr: 3, title: "옛 일" }] });
  const frozen = JSON.stringify(input);
  nextCycleAction(
    snap({ pr: mergedPr(), commitsAfterPrHead: 0, handoffState: "open", work: { title: "새 일" } }),
    input,
  );
  assert.equal(JSON.stringify(input), frozen);
});

test("병합 — 인증이 만료됐으면 PR 을 믿지 않아 아무것도 쌓지 않는다", () => {
  const out = nextCycleAction(
    snap({
      pr: mergedPr(),
      commitsAfterPrHead: 0,
      handoffState: "open",
      githubAuthExpired: true,
      work: { title: "믿지 않는 일" },
    }),
    led(),
  );
  assert.deepEqual(out.tapeEvents, []);
  assert.equal(out.ledger.landed, undefined);
});

// ————— 재료 — 며칠 · 때 —————

test("landedDays — 달력의 차이이고, 모르거나 어긋나면 말하지 않거나 0 이다", () => {
  const at = local(8, 9).getTime();
  assert.equal(landedDays(local(8, 1).toISOString(), at), 0, "같은 날");
  assert.equal(landedDays(local(7, 23).toISOString(), at), 1, "자정을 넘기면 하루");
  assert.equal(landedDays(local(5, 10).toISOString(), at), 3);
  assert.equal(landedDays(undefined, at), null, "제출한 때를 모르면 말하지 않는다");
  assert.equal(landedDays("not a date", at), null, "읽을 수 없는 시각도 마찬가지");
  assert.equal(landedDays(local(9, 10).toISOString(), at), 0, "시계가 어긋나 병합이 앞서도 0");
});

test("landedWorkOf — 병합 시각은 GitHub 의 closed_at, 미래이거나 모르면 지금이다", () => {
  const pr = mergedPr({ since: local(5).toISOString() });
  const past = landedWorkOf(snap(), { ...pr, closedAt: local(7, 8).toISOString() }, NOW);
  assert.equal(past.at, local(7, 8).toISOString());
  assert.equal(past.days, 2, "앱이 꺼져 있던 동안의 병합을 오늘 병합된 것으로 세지 않는다");
  const future = landedWorkOf(snap(), { ...pr, closedAt: local(20).toISOString() }, NOW);
  assert.equal(future.at, new Date(NOW).toISOString());
  const unknown = landedWorkOf(snap(), pr, NOW);
  assert.equal(unknown.at, new Date(NOW).toISOString());
  const broken = landedWorkOf(snap(), { ...pr, closedAt: "???" }, NOW);
  assert.equal(broken.at, new Date(NOW).toISOString());
});

test("landedWorkOf — 제목은 앞뒤 공백을 걷고 비면 싣지 않으며 화면 수는 양의 정수만", () => {
  const pr = mergedPr();
  assert.equal(landedWorkOf(snap({ work: { title: "  이름  " } }), pr, NOW).title, "이름");
  assert.ok(!("title" in landedWorkOf(snap({ work: { title: "   " } }), pr, NOW)));
  assert.ok(!("screens" in landedWorkOf(snap({ work: { screens: 1.5 } }), pr, NOW)));
  assert.ok(!("screens" in landedWorkOf(snap({ work: { screens: -1 } }), pr, NOW)));
  assert.equal(landedWorkOf(snap({ work: { screens: 4 } }), pr, NOW).screens, 4);
});

// ————— 원장 — 스무 건 · 같은 번호 · 옛 원장 —————

const work = (pr: number, over: Partial<LandedWork> = {}): LandedWork => ({
  at: new Date(2026, 8, 1 + (pr % 28), 12).toISOString(),
  pr,
  ...over,
});

test("recordLanded — 최근 것이 맨 앞이고 스무 건을 넘으면 오래된 것부터 버린다", () => {
  assert.equal(LANDED_KEEP, 20);
  let landed: LandedWork[] | undefined;
  for (let pr = 1; pr <= 25; pr += 1) landed = recordLanded(landed, work(pr));
  assert.equal(landed?.length, 20);
  assert.equal(landed?.[0]?.pr, 25);
  assert.equal(landed?.at(-1)?.pr, 6, "1~5 번은 밀려났다");
});

test("recordLanded — 같은 번호는 새 값으로 갈아 끼우고 맨 앞에 선다, 입력은 바뀌지 않는다", () => {
  const input = [work(3, { title: "옛" }), work(2), work(1)];
  const frozen = JSON.stringify(input);
  const out = recordLanded(input, work(2, { title: "새" }));
  assert.deepEqual(
    out.map((entry) => [entry.pr, entry.title]),
    [
      [2, "새"],
      [3, "옛"],
      [1, undefined],
    ],
  );
  assert.equal(JSON.stringify(input), frozen);
});

test("parseLedger — 옛 원장에는 landed 가 없고 그대로 읽힌다", () => {
  const old = parseLedger({ v: 1, ended: null, lastPr: null, notices: {} });
  assert.equal(old.landed, undefined);
  assert.ok(!("landed" in old), "없던 필드를 undefined 로 만들지 않는다");
  assert.equal(parseLedger(JSON.parse(JSON.stringify(emptyLedger()))).landed, undefined);
});

test("parseLedger — landed 는 왕복하고, 깨진 줄은 버리며, 스무 건을 넘기지 않는다", () => {
  const good: LandedWork[] = [
    { at: "2026-10-08T05:00:00.000Z", pr: 9, title: "회원 목록 검색", days: 0, screens: 2 },
    { at: "2026-10-01T05:00:00.000Z", pr: 7 },
  ];
  assert.deepEqual(
    parseLedger(JSON.parse(JSON.stringify({ ...emptyLedger(), landed: good }))).landed,
    good,
  );

  const messy = parseLedger({
    v: 1,
    landed: [
      null,
      "문자열",
      { at: "2026-10-08T05:00:00.000Z", pr: 9, title: "  이름  ", days: -1, screens: 0 },
      { at: "2026-10-08T05:00:00.000Z", pr: 9, title: "같은 번호" },
      { at: "시각 아님", pr: 5 },
      { at: "2026-10-02T05:00:00.000Z", pr: 0 },
      { at: "2026-10-02T05:00:00.000Z", pr: 3.5 },
      { at: "2026-10-03T05:00:00.000Z", pr: 4, days: 2.5, screens: 3 },
    ],
  });
  assert.deepEqual(messy.landed, [
    { at: "2026-10-08T05:00:00.000Z", pr: 9, title: "이름" },
    { at: "2026-10-03T05:00:00.000Z", pr: 4, screens: 3 },
  ]);

  const many = parseLedger({
    v: 1,
    landed: Array.from({ length: 30 }, (_, index) => ({
      at: "2026-10-08T05:00:00.000Z",
      pr: index + 1,
    })),
  });
  assert.equal(many.landed?.length, 20);
  assert.equal(parseLedger({ v: 1, landed: [] }).landed, undefined, "비면 필드가 없다");
  assert.equal(parseLedger({ v: 1, landed: "깨짐" }).landed, undefined);
});

// ————— 소스 계약 — fleet 이 감독자와 선로를 잇는다 —————

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("fleet — 반영된 일은 상태에, 화면 수는 지금 읽기로, 제목은 OS 알림에 닿는다", () => {
  const fleet = read("../src/project-fleet.ts");
  assert.match(fleet, /workspaces\.supervisor\?\.landedView\(\)/);
  assert.match(fleet, /\.\.\.\(landed \? \{ landed \} : \{\}\)/);
  assert.match(
    fleet,
    /cycleScreens: async \(\) => \(await this\.cycleScreens\.get\(slug\)\?\.read\(\)\) \?\? \[\]/,
  );
  assert.match(fleet, /onPrTransition: \(kind, at, count, title\) =>/);
  assert.match(fleet, /\.\.\.\(title === undefined \? \{\} : \{ title \}\)/);
});

test("사용자의 말(제목)은 로그에 남지 않는다 — 감독자의 반영 구간은 PR 번호만 적는다", () => {
  const supervisor = read("../src/cycle-supervisor.ts");
  const start = supervisor.indexOf("private async noteMergedWork");
  const end = supervisor.indexOf("private emitEvents");
  assert.ok(start > 0 && end > start, "구간을 찾았다");
  assert.doesNotMatch(supervisor.slice(start, end), /this\.log\(|logger\./);
  // 랜딩의 한 줄은 번호만 — 제목 · 경로를 싣지 않는다.
  assert.match(supervisor, /랜딩 완료: PR #\$\{action\.pr\} 병합 — 베이스로 돌아왔습니다/);
});
