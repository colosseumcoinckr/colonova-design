import {
  type DiagnosticsSummary,
  type DiagnosticsTurnStats,
  maskSecretShapes,
} from "@colonova-design/protocol";
import type { DEV } from "../labels";

/**
 * 진단 복사의 글(2026-10-07 베타 준비 분석) — 데몬이 모은 `DiagnosticsSummary` 와 웹이 아는 몇 가지(연결 · 준비 단계 ·
 * 준비 실패의 종류)를 사람이 읽고 Slack 에 붙이기 좋은 짧은 블록(제목 줄 + `키: 값`)으로 짠다. 순수 함수만 산다.
 *
 * 약속은 하나다 — **종류 · 숫자 · 버전만**. 사용자의 말 · 파일 경로 · 이메일 · 프로젝트 이름 · 토큰은 어느 줄에도 없다:
 * (1) 요약은 데몬이 이미 걸러 보내고, (2) 연결이 끊겨 요약이 없을 때 읽는 마지막 상태(`StatusFacts`)에는 이메일 ·
 * 실행 파일 경로가 들어 있지만 이 모듈은 그 칸을 읽지 않으며 버전은 숫자와 점만 · 낱말은 짧은 영문 식별자만 꺼내고,
 * (3) 완성한 글을 한 번 더 훑어 이메일 · 홈 경로 · 토큰 모양을 눌러 닫는다. 한국어 Windows 에서 자식 프로세스의 출력이
 * 깨져 와도 숫자만 고르는 한 복사 글에 섞일 길이 없다.
 *
 * 문장은 부르는 쪽이 `DEV.diagnostics` 를 넘긴다(시험이 src 에서 곧장 읽으므로 형제 모듈을 부르지 않는다).
 */

/** 연결이 끊겨 요약을 못 받았을 때 마지막 상태에서 읽는 칸들 — 이 밖의 칸(이메일 · 실행 파일 · 프로젝트)은 읽지 않는다. */
export interface StatusFacts {
  platform?: string | null;
  claudeVersion?: string | null;
  claudeExecutable?: string | null;
  loggedIn?: boolean;
  authMethod?: string | null;
  subscriptionType?: string | null;
}

export interface DiagnosticsInput {
  /** 글을 만든 시각(ISO). */
  at: string;
  /** 데몬이 모은 요약 — 연결이 끊겼거나 요청이 실패했으면 null. */
  summary: DiagnosticsSummary | null;
  /** 마지막으로 받은 상태 — 요약이 없을 때만 읽는다. */
  status: StatusFacts | null;
  /** 웹이 아는 것 — 이름이 아니라 종류만. */
  web: {
    connected: boolean;
    protocolVersion: number | null;
    /** 지금 프로젝트의 준비 단계(`RepoPhase`) — 이름이 아니다. */
    repoPhase: string | null;
    /** 준비 실패의 종류(`RepoErrorKind`) — 준비 실패 카드에서 누를 때만. */
    failureKind: string | null;
  };
}

type Words = Pick<typeof DEV, "diagnostics">;

/** 숫자와 점만 — `2.1.292 (Claude Code)` → `2.1.292`. 숫자 묶음이 둘 이상인 첫 조각만 읽는다. */
export function digitsOf(text: unknown): string | null {
  return typeof text === "string" ? (/\d+(?:\.\d+){1,3}/.exec(text)?.[0] ?? null) : null;
}

/** 소문자 · 숫자 · `_` `-` 만의 짧은 낱말 — 그 밖은 `other`(이름이나 경로가 새지 않게). */
function wordOf(text: unknown, max = 24): string | null {
  if (typeof text !== "string" || text === "") return null;
  const lower = text.toLowerCase();
  return lower.length <= max && /^[a-z0-9_.-]+$/.test(lower) ? lower : "other";
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 따옴표 · 백틱은 정규식 안에 쓰지 않는다(문장 시험의 토크나이저가 정규식을 모른다) — 유니코드 이스케이프로 쓴다.
const HOME_PATHS = [
  /\/Users\/[^/\\\s"':]+/g,
  /\/home\/[^/\\\s"':]+/g,
  /[A-Za-z]:\\Users\\[^/\\\s"':]+/g,
];

/**
 * 완성한 글의 마지막 방어 — 이메일 · 홈 경로 · 토큰 모양을 눌러 닫는다. 쓰인 것이 없으면 글은 그대로다.
 * 토큰 모양의 규칙은 데몬 로그와 같은 한 곳(protocol 의 `maskSecretShapes`)이다(2026-10-08 검토 FIX1).
 */
export function scrubText(text: string): string {
  let out = maskSecretShapes(text).replace(EMAIL, "{email}");
  for (const pattern of HOME_PATHS) out = out.replace(pattern, "~");
  return out;
}

/** 밀리초 → `4.2초`. */
function seconds(ms: number | null, words: Words): string {
  return ms === null ? "-" : `${(ms / 1000).toFixed(1)}${words.diagnostics.secondsUnit}`;
}

function toolWord(
  name: string,
  tool: { present: boolean; version: string | null },
  words: Words,
): string {
  const d = words.diagnostics;
  return `${name} ${tool.present ? (digitsOf(tool.version) ?? d.present) : d.absent}`;
}

function turnLines(stats: DiagnosticsTurnStats, words: Words): string[] {
  const d = words.diagnostics;
  const stages = d.stages as Record<string, string>;
  const failureParts = Object.entries(stats.failures)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([stage, count]) => d.stageItem(stages[stage] ?? stages.other ?? stage, count ?? 0));
  const percent = (label: string, p: DiagnosticsTurnStats["firstEditMs"]) =>
    `${label}: ${
      p.n === 0 ? d.noData : d.percentLine(seconds(p.p50, words), seconds(p.p90, words), p.n)
    }`;
  return [
    `${d.turns}: ${d.turnsLine(
      stats.turns,
      stats.byKind.user,
      stats.byKind.comments,
      stats.byKind.brief + stats.byKind.gate,
    )}`,
    `${d.failures}: ${stats.failed === 0 ? d.failureNone : d.failureLine(stats.failed, failureParts.join(" · "))}`,
    `${d.pinTurns}: ${stats.pinTurns}`,
    `${d.avgTools}: ${stats.avgToolCalls ?? "-"}`,
    percent(d.firstEdit, stats.firstEditMs),
    percent(d.firstDelta, stats.firstDeltaMs),
    percent(d.duration, stats.durationMs),
  ];
}

/** `키: 값` 줄들 — 제목 줄이 맨 앞이다. */
export function diagnosticsLines(input: DiagnosticsInput, words: Words): string[] {
  const d = words.diagnostics;
  const { summary, status, web } = input;
  const stamp = `${input.at.slice(0, 16).replace("T", " ")} UTC`;
  const lines = [`${d.title} · ${stamp}`];
  const connection = web.connected ? d.connected : d.disconnected;
  const protocol = summary?.protocolVersion ?? web.protocolVersion;
  lines.push(`${d.protocol}: ${protocol === null ? "-" : `v${protocol}`} · ${connection}`);

  if (summary !== null) {
    lines.push(`${d.appVersion}: ${digitsOf(summary.appVersion) ?? "-"}`);
    lines.push(
      `${d.os}: ${wordOf(summary.os.platform, 12) ?? "-"} ${digitsOf(summary.os.release) ?? "-"} · ${wordOf(summary.os.arch, 12) ?? "-"}`,
    );
    lines.push(`${d.daemonNode}: ${digitsOf(summary.nodeVersion) ?? "-"}`);
    lines.push(
      `${d.tools}: ${[
        toolWord("node", summary.tools.node, words),
        toolWord("git", summary.tools.git, words),
        toolWord("pnpm", summary.tools.pnpm, words),
        toolWord("bash", summary.tools.bash, words),
      ].join(" · ")}`,
    );
    const ai = summary.ai.map((entry) => {
      const id = wordOf(entry.id) ?? "-";
      if (!entry.present) return `${id} ${d.absent}`;
      const login = entry.loggedIn === null ? "" : ` ${entry.loggedIn ? d.loggedIn : d.loggedOut}`;
      return `${id} ${digitsOf(entry.version) ?? d.present}${login}`;
    });
    lines.push(`${d.ai}: ${ai.length > 0 ? ai.join(" · ") : d.unknown}`);
    lines.push(
      `${d.account}: ${d.accountLine(wordOf(summary.account.method) ?? d.unknown, wordOf(summary.account.plan) ?? d.unknown)}`,
    );
    if (summary.turnStats !== null) lines.push(...turnLines(summary.turnStats, words));
    const errors = summary.errors.map((entry) =>
      d.errorItem(entry.level === "warn" ? d.levels.warn : d.levels.error, entry.kind, entry.count),
    );
    lines.push(`${d.errors}: ${errors.length > 0 ? errors.join(" / ") : d.errorsNone}`);
  } else {
    // 연결이 끊겨 요약을 못 받았다 — 마지막 상태에서 안전한 칸만 읽는다(이메일 · 실행 파일 경로는 읽지 않는다).
    lines.push(d.summaryMissing);
    if (status !== null) {
      lines.push(`${d.os}: ${wordOf(status.platform, 12) ?? "-"}`);
      const login =
        status.loggedIn === undefined ? "" : ` ${status.loggedIn ? d.loggedIn : d.loggedOut}`;
      lines.push(`${d.ai}: claude ${digitsOf(status.claudeVersion) ?? d.unknown}${login}`);
      lines.push(
        `${d.account}: ${d.accountLine(wordOf(status.authMethod) ?? d.unknown, wordOf(status.subscriptionType) ?? d.unknown)}`,
      );
    }
  }

  if (web.repoPhase !== null) lines.push(`${d.repoPhase}: ${wordOf(web.repoPhase) ?? "-"}`);
  if (web.failureKind !== null) {
    const kind = wordOf(web.failureKind) ?? "-";
    const gloss = (d.repoKinds as Record<string, string>)[kind];
    lines.push(`${d.failureKind}: ${gloss === undefined ? kind : d.kindItem(kind, gloss)}`);
  }
  return lines.map(scrubText);
}

/** 복사할 글 한 덩어리. */
export function diagnosticsText(input: DiagnosticsInput, words: Words): string {
  return diagnosticsLines(input, words).join("\n");
}
