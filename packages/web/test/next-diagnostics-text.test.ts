import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { DiagnosticsSummary } from "@colonova-design/protocol";
import { DEV } from "../src/next/labels.ts";
import {
  type DiagnosticsInput,
  diagnosticsLines,
  diagnosticsText,
  digitsOf,
  scrubText,
} from "../src/next/lib/diagnostics-text.ts";

/**
 * 진단 복사의 글(2026-10-07 베타 준비 분석) — 제목 줄 + `키: 값`. 약속은 종류 · 숫자 · 버전만이다: 요약이 걸러 오지 않은
 * 낱말이 섞여 와도, 연결이 끊겨 마지막 상태(이메일 · 실행 파일 경로가 든 칸)에서 읽을 때도 글에는 한 글자도 없다.
 */

const POISON = {
  email: "kim.minsu@secret-corp.example.kr",
  home: "/Users/kimminsu",
  winHome: "C:\\Users\\김민수",
  project: "내-비밀-프로젝트",
  repo: "https://github.com/secret-corp/내-비밀-저장소",
  token: "ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD",
};

const leaks = (text: string): string[] => Object.values(POISON).filter((p) => text.includes(p));

const AT = "2026-10-07T10:12:34.000Z";

function summary(over: Partial<DiagnosticsSummary> = {}): DiagnosticsSummary {
  return {
    at: AT,
    appVersion: "0.4.0",
    os: { platform: "darwin", release: "25.2.0", arch: "arm64" },
    protocolVersion: 19,
    nodeVersion: "24.1.0",
    tools: {
      node: { present: true, version: "24.1.0" },
      git: { present: true, version: "2.45.1" },
      pnpm: { present: false, version: null },
      bash: { present: true, version: null },
    },
    ai: [
      { id: "claude", present: true, version: "2.1.292", loggedIn: true },
      { id: "codex", present: false, version: null, loggedIn: null },
    ],
    account: { method: "claude.ai", plan: "max" },
    turnStats: {
      days: 7,
      turns: 37,
      byKind: { user: 20, comments: 9, brief: 5, gate: 3 },
      failed: 3,
      failures: { account: 2, limit: 1 },
      pinTurns: 9,
      avgToolCalls: 6.4,
      firstEditMs: { n: 25, p50: 4200, p90: 12800 },
      firstDeltaMs: { n: 25, p50: 900, p90: 2100 },
      durationMs: { n: 0, p50: null, p90: null },
    },
    errors: [
      { level: "error", kind: "요청 실패 · repo.sync · Error", count: 3, lastAt: AT },
      { level: "warn", kind: "게이트 실패 · capture", count: 1, lastAt: AT },
    ],
    ...over,
  };
}

const input = (over: Partial<DiagnosticsInput> = {}): DiagnosticsInput => ({
  at: AT,
  summary: summary(),
  status: null,
  web: { connected: true, protocolVersion: 19, repoPhase: null, failureKind: null },
  ...over,
});

test("제목 줄 + `키: 값` — 사람이 읽고 Slack 에 붙이기 좋은 짧은 블록", () => {
  const lines = diagnosticsLines(input(), DEV);
  assert.deepEqual(lines, [
    "ColoNova Design 진단 · 2026-10-07 10:12 UTC",
    "프로토콜: v19 · 연결 정상",
    "앱 버전: 0.4.0",
    "OS: darwin 25.2.0 · arm64",
    "데몬 Node: 24.1.0",
    "도구: node 24.1.0 · git 2.45.1 · pnpm 없음 · bash 있음",
    "AI: claude 2.1.292 로그인됨 · codex 없음",
    "계정: claude.ai · 요금제 max",
    "최근 7일 턴: 37개 (직접 20 · 핀 9 · 도구 8)",
    "실패: 3개 (계정 2 · 한도 1)",
    "핀 사용 턴: 9",
    "평균 도구 호출: 6.4",
    "첫 편집까지: p50 4.2초 · p90 12.8초 (n 25)",
    "첫 글자까지: p50 0.9초 · p90 2.1초 (n 25)",
    "턴 길이: 자료 없음",
    "최근 오류: 오류 요청 실패 · repo.sync · Error ×3 / 경고 게이트 실패 · capture ×1",
  ]);
  assert.equal(diagnosticsText(input(), DEV), lines.join("\n"));
});

test("턴이 없거나 오류가 없어도 말한다 — 빈 칸은 `자료 없음` · `없음`", () => {
  const empty = summary({
    turnStats: {
      days: 7,
      turns: 0,
      byKind: { user: 0, comments: 0, brief: 0, gate: 0 },
      failed: 0,
      failures: {},
      pinTurns: 0,
      avgToolCalls: null,
      firstEditMs: { n: 0, p50: null, p90: null },
      firstDeltaMs: { n: 0, p50: null, p90: null },
      durationMs: { n: 0, p50: null, p90: null },
    },
    errors: [],
  });
  const text = diagnosticsText(input({ summary: empty }), DEV);
  assert.match(text, /최근 7일 턴: 0개/);
  assert.match(text, /실패: 없음/);
  assert.match(text, /평균 도구 호출: -/);
  assert.match(text, /첫 편집까지: 자료 없음/);
  assert.match(text, /최근 오류: 없음/);
  assert.equal(
    diagnosticsText(input({ summary: summary({ turnStats: null }) }), DEV).includes("최근 7일 턴"),
    false,
  );
});

test("연결이 끊겼으면 글이 그렇게 말한다", () => {
  const text = diagnosticsText(
    input({ web: { connected: false, protocolVersion: 19, repoPhase: null, failureKind: null } }),
    DEV,
  );
  assert.match(text, /프로토콜: v19 · 연결 끊김/);
});

test("준비 실패의 종류가 한 덩어리에 든다 — 이름이 아니라 종류와 단계만", () => {
  const text = diagnosticsText(
    input({
      web: { connected: true, protocolVersion: 19, repoPhase: "error", failureKind: "install" },
    }),
    DEV,
  );
  assert.match(text, /프로젝트 준비 단계: error/);
  assert.match(text, /준비 실패 종류: install \(설치\)/);
  // 모르는 종류는 원문(짧은 영문 낱말) 그대로, 낱말이 아닌 것은 other.
  const odd = diagnosticsText(
    input({
      web: { connected: true, protocolVersion: 19, repoPhase: null, failureKind: "brand-new" },
    }),
    DEV,
  );
  assert.match(odd, /준비 실패 종류: brand-new$/m);
  const bad = diagnosticsText(
    input({
      web: {
        connected: true,
        protocolVersion: 19,
        repoPhase: POISON.home,
        failureKind: POISON.winHome,
      },
    }),
    DEV,
  );
  assert.match(bad, /준비 실패 종류: other/);
  assert.deepEqual(leaks(bad), []);
});

test("요약의 낱말이 걸러지지 않은 채 와도 글에는 이메일 · 경로 · 토큰이 없다", () => {
  const poisoned = summary({
    appVersion: `0.4.0 ${POISON.email}`,
    os: {
      platform: `darwin ${POISON.home}`,
      release: `25.2.0 ${POISON.winHome}`,
      arch: POISON.email,
    },
    nodeVersion: POISON.home,
    tools: {
      node: { present: true, version: `v24.1.0 ${POISON.email}` },
      git: { present: true, version: POISON.winHome },
      pnpm: { present: true, version: POISON.repo },
      bash: { present: true, version: null },
    },
    ai: [
      {
        id: `claude ${POISON.email}`,
        present: true,
        version: `2.1.292 ${POISON.home}`,
        loggedIn: true,
      },
    ],
    account: { method: POISON.email, plan: "max" },
    errors: [
      {
        level: "error",
        kind: `요청 실패 ${POISON.home}/repo ${POISON.email} ${POISON.token}`,
        count: 1,
        lastAt: AT,
      },
    ],
  });
  const text = diagnosticsText(input({ summary: poisoned }), DEV);
  assert.deepEqual(leaks(text), []);
  // 쓸 것은 남는다.
  assert.match(text, /앱 버전: 0\.4\.0$/m);
  assert.match(text, /최근 오류: 오류 요청 실패/);
});

test("요약이 없을 때 마지막 상태에서 읽어도 이메일 · 실행 파일 경로 · 프로젝트는 새지 않는다", () => {
  const status = {
    platform: "darwin",
    claudeVersion: "2.1.292 (Claude Code)",
    claudeExecutable: `${POISON.home}/.local/bin/claude`,
    loggedIn: true,
    authMethod: "claude.ai",
    subscriptionType: "max",
    // DaemonStatus 에는 이 칸들도 있다 — 읽지 않는다.
    email: POISON.email,
    projects: [{ name: POISON.project, repoUrl: POISON.repo }],
  };
  const text = diagnosticsText(input({ summary: null, status }), DEV);
  assert.deepEqual(leaks(text), []);
  assert.match(text, /자세한 진단은 받지 못했어요/);
  assert.match(text, /OS: darwin/);
  assert.match(text, /AI: claude 2\.1\.292 로그인됨/);
  assert.match(text, /계정: claude\.ai · 요금제 max/);
  // 상태도 없으면 제목과 연결 줄만 — 그래도 던지지 않는다.
  const bare = diagnosticsLines(input({ summary: null, status: null }), DEV);
  assert.equal(bare[0], "ColoNova Design 진단 · 2026-10-07 10:12 UTC");
  assert.ok(bare.length >= 3);
});

test("digitsOf · scrubText", () => {
  assert.equal(digitsOf("2.1.292 (Claude Code)"), "2.1.292");
  assert.equal(digitsOf("v24.1.0"), "24.1.0");
  assert.equal(digitsOf("홍길동"), null);
  assert.equal(digitsOf(7), null);
  assert.equal(
    scrubText(`a ${POISON.email} b ${POISON.home}/x c ${POISON.winHome}\\y d ${POISON.token}`),
    "a {email} b ~/x c ~\\y d {secret}",
  );
  assert.equal(scrubText("아무 말도 없는 글"), "아무 말도 없는 글");
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("배선: 설정의 개발자용 쪽과 준비 실패 카드가 같은 글 짜기를 쓰고, 비공개 채널 안내는 복사 단추 곁에 선다", () => {
  const page = read("../src/next/settings/DeveloperPage.tsx");
  assert.match(page, /useDiagnosticsText\(daemon\)/);
  assert.match(page, /L\.report\.privateNote/);
  assert.match(page, /L\.problem\.copyHelp/);
  // 공개 저장소 주소를 싣던 옛 진단 줄은 없다.
  assert.equal(page.includes("repoUrl"), false);
  const column = read("../src/next/preview/PreviewColumn.tsx");
  assert.match(column, /help=\{\(\) => diagnosticsText\(repo\?\.errorKind \?\? null\)\}/);
  const notice = read("../src/next/preview/PrepareCard.tsx");
  assert.match(notice, /\{help && \(/);
  assert.match(notice, /L\.problem\.copyHelp/);
  const hook = read("../src/next/lib/use-diagnostics.ts");
  assert.match(hook, /api\.diagnosticsSummary\(\)\.catch\(\(\) => null\)/);
  assert.match(hook, /failureKind/);
});

test("글 짜기는 문장을 DEV 에서만 읽는다 — lib 에 한국어 리터럴이 없다", () => {
  const lib = read("../src/next/lib/diagnostics-text.ts");
  const code = lib.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.equal(/[\u3131-\uD79D]/.test(code), false);
});
