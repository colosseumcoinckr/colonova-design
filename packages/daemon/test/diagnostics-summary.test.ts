import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
// `../dist` 임포트인 이유: 이 모듈들은 형제를 `.js` 지정자로 부른다 — src 직접 로드는 그것을 못 고친다.
import {
  buildDiagnosticsSummary,
  recentLogFiles,
  startupLogFields,
  statusFactsOf,
  summarizeLogErrors,
  versionDigits,
} from "../dist/diagnostics.js";
import {
  readTurnStatsSummary,
  summarizeTurnStats,
  turnStatsFilesWithin,
} from "../dist/turn-stats.js";

/**
 * 진단 한 덩어리의 순수 부분(2026-10-07 베타 준비 분석) — 프로세스를 띄우지 않는다(임시 폴더의 파일만 읽는다).
 * 약속은 둘이다: 최근 7일 요약이 손상된 줄 · 게이트 행 · 창 밖의 파일에 흔들리지 않고, 요약 어디에도
 * 이메일 · 경로 · 프로젝트 이름이 한 글자도 오지 않는다.
 */

const NOW = new Date("2026-10-07T12:00:00.000Z");

/** 독 — 진단 어디에도 나오면 안 되는 것들. 입력의 여러 자리에 일부러 심는다. */
const POISON = {
  email: "kim.minsu@secret-corp.example.kr",
  home: "/Users/kimminsu",
  winHome: "C:\\Users\\김민수",
  project: "내-비밀-프로젝트",
  repo: "https://github.com/secret-corp/내-비밀-저장소",
  session: "sess-비밀-0001",
  token: "ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD",
  org: "시크릿 주식회사",
};

function leaks(value: unknown): string[] {
  const text = JSON.stringify(value);
  return Object.values(POISON).filter((poison) => text.includes(poison));
}

/** 턴 통계의 한 줄 — 실제 행의 모양(`turn-stats.ts` 의 TurnStatsRow)에 독을 심은 채. */
function row(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    at: "2026-10-06T10:00:00.000Z",
    sessionId: POISON.session,
    project: POISON.project,
    provider: "claude",
    model: "stub",
    effort: null,
    kind: "user",
    pins: 0,
    images: 0,
    files: 0,
    durationMs: 1000,
    isError: false,
    subtype: "success",
    numTurns: 1,
    tools: { read: 1, edit: 1, exec: 0, browser: 0, other: 0 },
    gate: false,
    contextTokens: 100,
    firstEditMs: 500,
    firstDeltaMs: 100,
    pinBytes: null,
    failure: null,
    waitMs: 0,
    scanMs: null,
    sincePrevTurnMs: null,
    pinHit: null,
    browserMs: null,
    tokens: null,
    costUsd: null,
    cacheHitRate: null,
    ...over,
  });
}

const gateRow = (at = "2026-10-06T10:00:01.000Z") =>
  JSON.stringify({
    at,
    sessionId: POISON.session,
    project: POISON.project,
    kind: "gateset",
    gateMs: 1200,
    screens: 2,
    reopened: true,
  });

// ── summarizeTurnStats ────────────────────────────────────────────────────────

test("빈 로그는 턴 0 의 요약이다 — 분위수는 null, 평균 도구 호출도 null", () => {
  for (const lines of [[], [""], ["", "   ", "\n"]]) {
    const summary = summarizeTurnStats(lines, NOW);
    assert.equal(summary.turns, 0);
    assert.equal(summary.days, 7);
    assert.equal(summary.failed, 0);
    assert.deepEqual(summary.failures, {});
    assert.equal(summary.avgToolCalls, null);
    assert.deepEqual(summary.firstEditMs, { n: 0, p50: null, p90: null });
    assert.deepEqual(summary.durationMs, { n: 0, p50: null, p90: null });
  }
});

test("손상된 줄은 건너뛴다 — 읽을 수 있는 줄만 센다", () => {
  const lines = [
    "{not json",
    "null",
    "[1,2,3]",
    '"just a string"',
    "42",
    '{"kind":"user"}',
    '{"kind":"user","at":"nonsense"}',
    '{"kind":"mystery","at":"2026-10-06T10:00:00.000Z"}',
    // 잘린 꼬리 줄(쓰는 도중 끊긴 파일).
    row().slice(0, 80),
    row(),
  ];
  const summary = summarizeTurnStats(lines, NOW);
  assert.equal(summary.turns, 1);
  assert.equal(summary.byKind.user, 1);
});

test("게이트 행(gateset)은 턴이 아니다 — 섞여 있어도 턴 수 · 분위수를 흔들지 않는다", () => {
  const summary = summarizeTurnStats(
    [row(), gateRow(), row({ kind: "comments", pins: 2 }), gateRow()],
    NOW,
  );
  assert.equal(summary.turns, 2);
  assert.equal(summary.byKind.user, 1);
  assert.equal(summary.byKind.comments, 1);
  assert.equal(summary.pinTurns, 1);
});

test("7일 밖의 행은 세지 않는다 — 경계의 정각은 안이다", () => {
  const summary = summarizeTurnStats(
    [
      row({ at: "2026-09-30T11:59:59.999Z" }),
      row({ at: "2026-09-30T12:00:00.000Z" }),
      row({ at: "2026-09-01T00:00:00.000Z" }),
      row({ at: "2026-10-07T11:00:00.000Z" }),
    ],
    NOW,
  );
  assert.equal(summary.turns, 2);
});

test("분위수는 가까운 순위다 — 열 개면 p50 은 다섯째, p90 은 아홉째", () => {
  const lines = Array.from({ length: 10 }, (_, index) => row({ durationMs: (index + 1) * 100 }));
  const summary = summarizeTurnStats(lines, NOW);
  assert.deepEqual(summary.durationMs, { n: 10, p50: 500, p90: 900 });
  const four = summarizeTurnStats(
    [10, 20, 30, 40].map((ms) => row({ durationMs: ms })),
    NOW,
  );
  assert.deepEqual(four.durationMs, { n: 4, p50: 20, p90: 40 });
  const one = summarizeTurnStats([row({ durationMs: 777 })], NOW);
  assert.deepEqual(one.durationMs, { n: 1, p50: 777, p90: 777 });
});

test("분위수는 사람이 보낸 턴 가운데 끝까지 답한 것만 센다 — 실패 · 중지 · 도구가 연 턴은 뺀다", () => {
  const lines = [
    row({ durationMs: 1000, firstEditMs: 400, firstDeltaMs: 50 }),
    row({ kind: "comments", pins: 1, durationMs: 3000, firstEditMs: 600, firstDeltaMs: 70 }),
    // 센 것이 아닌 것들
    row({ kind: "brief", durationMs: 90_000, firstEditMs: 9_000, firstDeltaMs: 9_000 }),
    row({ kind: "gate", durationMs: 90_000 }),
    row({ isError: true, failure: "limit", durationMs: 90_000 }),
    row({ subtype: "interrupted", durationMs: 90_000 }),
    // 값이 없는 칸(null · 문자열 · 음수)은 그 칸만 건너뛴다.
    row({ durationMs: null, firstEditMs: "빠름", firstDeltaMs: -5 }),
  ];
  const summary = summarizeTurnStats(lines, NOW);
  assert.equal(summary.turns, 7, "모든 턴은 센다");
  assert.deepEqual(summary.durationMs, { n: 2, p50: 1000, p90: 3000 });
  assert.deepEqual(summary.firstEditMs, { n: 2, p50: 400, p90: 600 });
  assert.deepEqual(summary.firstDeltaMs, { n: 2, p50: 50, p90: 70 });
  assert.deepEqual(summary.byKind, { user: 4, comments: 1, brief: 1, gate: 1 });
});

test("실패는 단계별로 센다 — 계정류 · 모르는 단계 · 단계가 없는 옛 행은 other", () => {
  const lines = [
    row({ isError: true, failure: "account" }),
    row({ isError: true, failure: "account" }),
    row({ isError: true, failure: "limit" }),
    row({ isError: true, failure: null }),
    row({ isError: true, failure: "brand-new-stage" }),
    row({ isError: true }),
    row({ isError: false, failure: "account" }),
  ];
  const summary = summarizeTurnStats(lines, NOW);
  assert.equal(summary.failed, 6);
  assert.deepEqual(summary.failures, { account: 2, limit: 1, other: 3 });
});

test("평균 도구 호출 수와 핀 사용 턴 수", () => {
  const tools = (n: number) => ({ read: n, edit: 0, exec: 0, browser: 0, other: 0 });
  const summary = summarizeTurnStats(
    [
      row({ tools: tools(2), pins: 0 }),
      row({ tools: tools(5), pins: 3 }),
      row({ tools: { read: 1, edit: 1, exec: 1, browser: 1, other: 1 }, pins: 1 }),
      // tools 가 없는 줄은 평균에서 빠진다(턴으로는 센다).
      row({ tools: undefined, pins: 0 }),
      row({ tools: "손상", pins: 0 }),
    ],
    NOW,
  );
  assert.equal(summary.turns, 5);
  assert.equal(summary.avgToolCalls, 4, "(2 + 5 + 5) / 3");
  assert.equal(summary.pinTurns, 2);
});

test("요약에는 프로젝트 이름도 세션 id 도 오지 않는다", () => {
  const summary = summarizeTurnStats([row(), row({ kind: "comments", pins: 1 }), gateRow()], NOW);
  assert.deepEqual(leaks(summary), []);
});

// ── 파일 읽기 ─────────────────────────────────────────────────────────────────

test("turnStatsFilesWithin: 창 안의 날짜 파일만 — 경계의 하루는 읽고, 7일 밖 · 다른 이름은 건너뛴다", () => {
  const names = [
    "turn-stats-2026-10-07.jsonl",
    "turn-stats-2026-10-01.jsonl",
    "turn-stats-2026-09-30.jsonl",
    "turn-stats-2026-09-29.jsonl",
    "turn-stats-2026-01-01.jsonl",
    "turn-stats-garbage.jsonl",
    "turn-stats-2026-10-07.jsonl.bak",
    "daemon-2026-10-07.log",
    "notes.txt",
  ];
  assert.deepEqual(turnStatsFilesWithin(names, NOW), [
    "turn-stats-2026-09-30.jsonl",
    "turn-stats-2026-10-01.jsonl",
    "turn-stats-2026-10-07.jsonl",
  ]);
});

test("readTurnStatsSummary: 7일 밖 파일 · 못 읽는 파일 · 게이트 행이 섞인 폴더에서 읽을 수 있는 것만 센다", () => {
  const dir = mkdtempSync(join(tmpdir(), "colonova-diag-stats-"));
  try {
    writeFileSync(
      join(dir, "turn-stats-2026-10-07.jsonl"),
      `${[row({ at: "2026-10-07T09:00:00.000Z" }), gateRow("2026-10-07T09:00:01.000Z"), "{깨진 줄"].join("\n")}\n`,
    );
    writeFileSync(
      join(dir, "turn-stats-2026-10-04.jsonl"),
      `${row({ at: "2026-10-04T09:00:00.000Z", isError: true, failure: "account" })}\n`,
    );
    // 보존 정리가 아직 못 지운 옛 파일 — 안의 행이 아무리 많아도 읽지 않는다.
    writeFileSync(
      join(dir, "turn-stats-2026-09-20.jsonl"),
      `${Array.from({ length: 5 }, () => row({ at: "2026-09-20T09:00:00.000Z" })).join("\n")}\n`,
    );
    // 이름은 맞지만 파일이 아니다 — 읽다 던져도 나머지로 요약한다.
    mkdirSync(join(dir, "turn-stats-2026-10-05.jsonl"));
    const summary = readTurnStatsSummary({ dir, now: NOW });
    assert.equal(summary.turns, 2);
    assert.equal(summary.failed, 1);
    assert.deepEqual(summary.failures, { account: 1 });
    assert.deepEqual(leaks(summary), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readTurnStatsSummary: 폴더가 없으면 던지지 않고 턴 0 이다", () => {
  const summary = readTurnStatsSummary({
    dir: join(tmpdir(), "colonova-diag-없는-폴더-0"),
    now: NOW,
  });
  assert.equal(summary.turns, 0);
});

// ── 로그의 오류 종류 ──────────────────────────────────────────────────────────

const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
const logLine = (hoursAgo: number, level: string, message: string, fields?: unknown) =>
  `${at(hoursAgo)}\t${level}\t${message}${fields === undefined ? "" : `\t${JSON.stringify(fields)}`}`;

test("summarizeLogErrors: 같은 종류는 모아 횟수 · 마지막 시각을 싣고, 오류가 경고보다 먼저다", () => {
  const lines = [
    logLine(30, "warn", "게이트 실패", { sessionId: POISON.session, stage: "capture" }),
    logLine(5, "error", "요청 실패", {
      type: "repo.sync",
      err: { name: "Error", message: `boom ${POISON.home}/x` },
    }),
    logLine(3, "error", "요청 실패", {
      type: "repo.sync",
      err: { name: "Error", message: "again" },
    }),
    logLine(2, "error", "요청 실패", {
      type: "diff.get",
      err: { name: "TypeError", message: "x" },
    }),
    logLine(1, "warn", "크래시 자동 재개", { sessionId: POISON.session }),
    logLine(1, "info", "세션 상태", { state: "idle" }),
  ];
  const kinds = summarizeLogErrors(lines, NOW);
  assert.deepEqual(
    kinds.map(({ level, kind, count }) => [level, kind, count]),
    [
      ["error", "요청 실패 · diff.get · TypeError", 1],
      ["error", "요청 실패 · repo.sync · Error", 2],
      ["warn", "크래시 자동 재개", 1],
      ["warn", "게이트 실패 · capture", 1],
    ],
  );
  assert.equal(kinds[1]?.lastAt, at(3), "마지막으로 본 시각");
  assert.deepEqual(leaks(kinds), []);
  assert.equal(
    JSON.stringify(kinds).includes("boom"),
    false,
    "오류 원문(err.message)은 싣지 않는다",
  );
});

test("summarizeLogErrors: 메시지의 경로 · 이메일 · 토큰 · 긴 id 낱말은 걷어낸다", () => {
  const lines = [
    logLine(1, "error", `복제 실패 ${POISON.home}/repo/a.txt`),
    logLine(1, "error", `확인 실패 ${POISON.winHome}\\app\\b.txt`),
    logLine(1, "error", `전송 실패 ${POISON.email} 에게`),
    logLine(1, "error", `토큰 ${POISON.token} 거절`),
    logLine(1, "error", "세션 0123456789abcdef0123 닫힘"),
    // 낱말이 전부 걷히면 종류가 없다.
    logLine(1, "error", `${POISON.home}/only/a/path`),
  ];
  const kinds = summarizeLogErrors(lines, NOW).map((entry) => entry.kind);
  assert.deepEqual(
    kinds.sort(),
    ["복제 실패", "세션 닫힘", "전송 실패 에게", "토큰 거절", "확인 실패"].sort(),
  );
  assert.deepEqual(leaks(kinds), []);
});

test("summarizeLogErrors: 7일 밖 · 잘린 줄 · 모르는 단계는 건너뛰고, 개수는 limit 까지", () => {
  const lines = [
    logLine(24 * 8, "error", "옛 오류"),
    `${at(1).slice(5)}\terror\t머리가 잘린 줄`,
    "",
    "그냥 글",
    logLine(1, "fatal", "모르는 단계"),
    ...Array.from({ length: 8 }, (_, index) => logLine(index + 1, "error", `종류${index}`)),
  ];
  const kinds = summarizeLogErrors(lines, NOW);
  assert.equal(kinds.length, 5);
  assert.deepEqual(
    kinds.map((entry) => entry.kind),
    ["종류0", "종류1", "종류2", "종류3", "종류4"],
    "최근 순",
  );
  assert.deepEqual(summarizeLogErrors(lines, NOW, 2).length, 2);
  assert.deepEqual(summarizeLogErrors([], NOW), []);
});

test("recentLogFiles: 창 안의 로그 파일을 새것부터 셋까지", () => {
  const names = [
    "daemon-2026-10-07.log",
    "daemon-2026-10-06.log",
    "daemon-2026-10-03.log",
    "daemon-2026-10-01.log",
    "daemon-2026-09-30.log",
    "daemon-2026-09-29.log",
    "turn-stats-2026-10-07.jsonl",
    "daemon-notes.log",
  ];
  assert.deepEqual(recentLogFiles(names, NOW), [
    "daemon-2026-10-07.log",
    "daemon-2026-10-06.log",
    "daemon-2026-10-03.log",
  ]);
  assert.deepEqual(recentLogFiles(["daemon-2026-09-01.log"], NOW), []);
});

// ── 걸러 읽기 · 조립 ──────────────────────────────────────────────────────────

test("versionDigits: 숫자와 점만 — 깨진 글자 · 경로 · 이름은 나오지 않는다", () => {
  assert.equal(versionDigits("git version 2.45.1.windows.1"), "2.45.1");
  assert.equal(versionDigits("git version 2.39.5 (Apple Git-154)"), "2.39.5");
  assert.equal(versionDigits("v24.1.0\n"), "24.1.0");
  assert.equal(versionDigits("2.1.292 (Claude Code)"), "2.1.292");
  assert.equal(versionDigits("10.4.1"), "10.4.1");
  // 한국어 Windows 의 CP949 출력을 UTF-8 로 읽으면 이렇게 깨진다 — 깨진 글자 사이의 숫자만 남는다.
  assert.equal(versionDigits("git \uFFFD\uFFFD\uFFFD 2.45.1 \uFFFD\uFFFD"), "2.45.1");
  assert.equal(versionDigits("홍길동 C:\\Users\\홍길동\\pnpm"), null);
  assert.equal(versionDigits("10"), null, "숫자 묶음 하나는 버전이 아니다");
  for (const value of [null, undefined, 3, {}, ""]) assert.equal(versionDigits(value), null);
});

test("startupLogFields: 앱 버전 · OS · 아키텍처 · Node 메이저 — 경로 · 사용자 이름 없이", () => {
  assert.deepEqual(
    startupLogFields({
      appVersion: "0.4.0",
      platform: "darwin",
      osRelease: "25.2.0",
      arch: "arm64",
      nodeVersion: "24.1.0",
    }),
    { appVersion: "0.4.0", platform: "darwin", osRelease: "25.2.0", arch: "arm64", nodeMajor: 24 },
  );
  const odd = startupLogFields({
    appVersion: undefined,
    platform: `${POISON.home}/My Box`,
    osRelease: `${POISON.home}`,
    arch: POISON.email,
    nodeVersion: "나쁜 입력",
  });
  assert.deepEqual(odd, {
    appVersion: null,
    platform: "other",
    osRelease: null,
    arch: "other",
    nodeMajor: null,
  });
  assert.deepEqual(leaks(odd), []);
});

test("statusFactsOf: 모양이 달라도 던지지 않는다 — 이메일 · 경로 칸은 읽지도 않는다", () => {
  for (const value of [undefined, null, "문자열", 7, [], {}]) {
    const facts = statusFactsOf(value);
    assert.equal(facts.loggedIn, false);
    assert.deepEqual(facts.providers, []);
  }
  const facts = statusFactsOf({
    email: POISON.email,
    claudeExecutable: `${POISON.home}/.local/bin/claude`,
    claudeVersion: "2.1.292 (Claude Code)",
    loggedIn: true,
    authMethod: "claude.ai",
    subscriptionType: "max",
    projects: [{ name: POISON.project, repoUrl: POISON.repo }],
    providers: [
      { id: "claude", available: true, version: "2.1.292", loggedIn: true, reason: POISON.home },
      { id: 7 },
      { id: "Bad Id With Spaces" },
      null,
    ],
  });
  assert.deepEqual(
    facts.providers.map((entry) => entry.id),
    ["claude"],
  );
  assert.equal("email" in facts, false);
});

/** 모든 칸에 독이 든 입력 — 조립한 요약에 독이 한 글자도 없어야 한다. */
function poisonedInput() {
  return {
    now: NOW,
    appVersion: "0.4.0",
    platform: "darwin",
    osRelease: "25.2.0",
    arch: "arm64",
    nodeVersion: "24.1.0",
    protocolVersion: 19,
    tools: {
      node: { present: true, version: "v24.1.0" },
      git: { present: true, version: `git version 2.45.1 ${POISON.home}/git ${POISON.email}` },
      pnpm: { present: true, version: POISON.winHome },
      bash: true,
    },
    status: statusFactsOf({
      email: POISON.email,
      orgName: POISON.org,
      claudeExecutable: `${POISON.home}/.local/bin/claude`,
      claudeVersion: "2.1.292 (Claude Code)",
      loggedIn: true,
      authMethod: "claude.ai",
      subscriptionType: "max",
      projects: [{ name: POISON.project, repoUrl: POISON.repo }],
      providers: [
        { id: "claude", available: true, version: "2.1.292", loggedIn: true },
        { id: "codex", available: false, reason: `${POISON.home}/codex 없음` },
      ],
    }),
    turnStats: summarizeTurnStats(
      [row(), row({ isError: true, failure: "account" }), gateRow()],
      NOW,
    ),
    logLines: [
      logLine(1, "error", `요청 실패 ${POISON.home}/a ${POISON.email} ${POISON.token}`, {
        type: "repo.sync",
        sessionId: POISON.session,
        err: { name: "Error", message: `${POISON.repo} ${POISON.org}` },
      }),
    ],
  };
}

test("buildDiagnosticsSummary: 독이 든 입력에서도 이메일 · 경로 · 프로젝트 이름 · 토큰이 한 글자도 안 나온다", () => {
  const summary = buildDiagnosticsSummary(poisonedInput());
  assert.deepEqual(leaks(summary), []);
  // 그리고 쓸 것은 다 있다.
  assert.equal(summary.at, NOW.toISOString());
  assert.equal(summary.appVersion, "0.4.0");
  assert.deepEqual(summary.os, { platform: "darwin", release: "25.2.0", arch: "arm64" });
  assert.equal(summary.protocolVersion, 19);
  assert.equal(summary.nodeVersion, "24.1.0");
  assert.deepEqual(summary.tools.node, { present: true, version: "24.1.0" });
  assert.deepEqual(summary.tools.git, { present: true, version: "2.45.1" });
  assert.deepEqual(
    summary.tools.pnpm,
    { present: true, version: null },
    "버전을 못 읽은 도구는 있음만",
  );
  assert.deepEqual(summary.tools.bash, { present: true, version: null });
  assert.deepEqual(summary.ai, [
    { id: "claude", present: true, version: "2.1.292", loggedIn: true },
    { id: "codex", present: false, version: null, loggedIn: null },
  ]);
  assert.deepEqual(summary.account, { method: "claude.ai", plan: "max" });
  assert.equal(summary.turnStats?.failures.account, 1);
  assert.equal(summary.errors[0]?.kind, "요청 실패 · repo.sync · Error");
});

test("buildDiagnosticsSummary: 계정 칸은 종류만 — 모르는 방식 · 낯선 요금제 이름은 other 로 눌러 담는다", () => {
  const base = poisonedInput();
  const odd = buildDiagnosticsSummary({
    ...base,
    status: statusFactsOf({
      authMethod: `${POISON.email} 로그인`,
      subscriptionType: POISON.org,
      claudeExecutable: "/x/claude",
      claudeVersion: "2.1.292",
      loggedIn: true,
    }),
  });
  assert.deepEqual(odd.account, { method: "other", plan: "other" });
  assert.deepEqual(leaks(odd), []);
  // API 키 방식은 요금제가 없다 — 칸이 null 이다.
  const apiKey = buildDiagnosticsSummary({
    ...base,
    status: statusFactsOf({ authMethod: "api_key", loggedIn: true, claudeExecutable: "/x/claude" }),
  });
  assert.deepEqual(apiKey.account, { method: "api_key", plan: null });
  // 상태를 못 읽은 진단(상태 요청이 실패)은 AI 칸이 비어 돌아간다 — 던지지 않는다.
  const none = buildDiagnosticsSummary({ ...base, status: statusFactsOf(null) });
  assert.deepEqual(none.account, { method: null, plan: null });
  assert.deepEqual(none.ai, [{ id: "claude", present: false, version: null, loggedIn: null }]);
});

test("buildDiagnosticsSummary: providers 가 비면 Claude 한 줄을 상태의 칸에서 만든다", () => {
  const summary = buildDiagnosticsSummary({
    ...poisonedInput(),
    status: statusFactsOf({
      claudeExecutable: "/x/claude",
      claudeVersion: "2.1.292 (Claude Code)",
      loggedIn: true,
    }),
  });
  assert.deepEqual(summary.ai, [
    { id: "claude", present: true, version: "2.1.292", loggedIn: true },
  ]);
});
