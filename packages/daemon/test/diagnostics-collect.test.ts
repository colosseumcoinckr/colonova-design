import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  type DiagnosticsSummary,
  PROTOCOL_VERSION,
  parseClientMessage,
} from "@colonova-design/protocol";
import { collectDiagnostics, versionDigits } from "../dist/diagnostics.js";
import { RequestRouter } from "../dist/dispatch.js";

/**
 * `diagnostics.summary` 가 이 기계에서 실제로 모으는 길(2026-10-07 베타 준비 분석) — node · git · pnpm 에
 * `--version` 을 묻는 자식 프로세스를 띄우므로 순수 시험이 아니다(CI 의 순수 목록 밖, 로컬 `pnpm test`
 * 의 몫). 도구가 이 기계에 있는지는 기계마다 다르니 있음 · 없음은 모양만 보고, 약속 둘을 지킨다 —
 * 독이 든 상태 · 로그 · 통계를 먹여도 이메일 · 경로 · 프로젝트 이름이 새지 않고, 상태 요청이 실패해도
 * 던지지 않는다.
 */

const POISON = {
  email: "kim.minsu@secret-corp.example.kr",
  home: "/Users/kimminsu",
  project: "내-비밀-프로젝트",
  repo: "https://github.com/secret-corp/내-비밀-저장소",
  session: "sess-비밀-0001",
};

function seededLogDir(now: Date): string {
  const dir = mkdtempSync(join(tmpdir(), "colonova-diag-collect-"));
  const day = now.toISOString().slice(0, 10);
  writeFileSync(
    join(dir, `turn-stats-${day}.jsonl`),
    `${JSON.stringify({
      at: now.toISOString(),
      sessionId: POISON.session,
      project: POISON.project,
      kind: "user",
      pins: 0,
      durationMs: 1200,
      isError: false,
      subtype: "success",
      tools: { read: 2, edit: 1, exec: 0, browser: 0, other: 0 },
      firstEditMs: 800,
      firstDeltaMs: 90,
      failure: null,
    })}\n`,
  );
  writeFileSync(
    join(dir, `daemon-${day}.log`),
    `${now.toISOString()}\terror\t요청 실패 ${POISON.home}/repo ${POISON.email}\t${JSON.stringify({
      type: "repo.sync",
      err: { name: "Error", message: `${POISON.repo}` },
    })}\n`,
  );
  return dir;
}

test("collectDiagnostics: 이 기계의 사실을 모으되 독은 새지 않는다", async () => {
  const now = new Date();
  const dir = seededLogDir(now);
  try {
    const summary = await collectDiagnostics({
      logDir: dir,
      now: () => now,
      appVersion: () => "0.4.0",
      status: async () => ({
        email: POISON.email,
        claudeExecutable: `${POISON.home}/.local/bin/claude`,
        claudeVersion: "2.1.292 (Claude Code)",
        loggedIn: true,
        authMethod: "claude.ai",
        subscriptionType: "max",
        projects: [{ name: POISON.project, repoUrl: POISON.repo }],
        providers: [{ id: "claude", available: true, version: "2.1.292", loggedIn: true }],
      }),
    });
    const text = JSON.stringify(summary);
    for (const poison of Object.values(POISON)) assert.equal(text.includes(poison), false, poison);
    assert.equal(summary.at, now.toISOString());
    assert.equal(summary.appVersion, "0.4.0");
    assert.equal(summary.os.platform, process.platform);
    assert.equal(summary.os.arch, process.arch);
    assert.equal(summary.protocolVersion, PROTOCOL_VERSION);
    assert.equal(summary.nodeVersion, versionDigits(process.versions.node));
    assert.equal(typeof summary.tools.node.present, "boolean");
    assert.equal(typeof summary.tools.git.present, "boolean");
    assert.equal(typeof summary.tools.pnpm.present, "boolean");
    assert.equal(typeof summary.tools.bash.present, "boolean");
    // 도구의 버전은 있으면 숫자와 점뿐이다.
    for (const entry of Object.values(summary.tools)) {
      assert.ok(
        entry.version === null || /^\d+(?:\.\d+){1,3}$/.test(entry.version),
        String(entry.version),
      );
    }
    assert.deepEqual(summary.account, { method: "claude.ai", plan: "max" });
    assert.deepEqual(summary.ai, [
      { id: "claude", present: true, version: "2.1.292", loggedIn: true },
    ]);
    assert.equal(summary.turnStats?.turns, 1);
    assert.deepEqual(summary.turnStats?.durationMs, { n: 1, p50: 1200, p90: 1200 });
    assert.deepEqual(
      summary.errors.map((entry) => entry.kind),
      ["요청 실패 · repo.sync · Error"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("collectDiagnostics: 상태 요청이 실패해도 던지지 않는다 — AI 칸만 비어 돌아간다", async () => {
  const now = new Date();
  const dir = mkdtempSync(join(tmpdir(), "colonova-diag-collect-"));
  try {
    const summary = await collectDiagnostics({
      logDir: dir,
      now: () => now,
      status: async () => {
        throw new Error("status 가 죽었다");
      },
    });
    assert.deepEqual(summary.account, { method: null, plan: null });
    assert.deepEqual(summary.ai, [{ id: "claude", present: false, version: null, loggedIn: null }]);
    assert.equal(summary.appVersion, null);
    assert.equal(summary.turnStats?.turns, 0, "턴이 없는 폴더는 턴 0 이다");
    assert.deepEqual(summary.errors, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("선로: diagnostics.summary 는 id 만 든 읽기 요청이고, 라우터가 collectDiagnostics 로 잇는다", async () => {
  const parsed = parseClientMessage(JSON.stringify({ type: "diagnostics.summary", id: "d1" }));
  assert.equal(parsed.ok, true);
  assert.equal(
    parseClientMessage(JSON.stringify({ type: "diagnostics.summary" })).ok,
    false,
    "id 가 없으면 거절",
  );
  // 라우터는 협력자를 참조로 쥐기만 한다 — 이 요청이 쓰는 status · appVersion 만 채운 가짜로 충분하다.
  const dir = mkdtempSync(join(tmpdir(), "colonova-diag-router-"));
  const saved = process.env.COLONOVA_DESIGN_LOG_DIR;
  process.env.COLONOVA_DESIGN_LOG_DIR = dir;
  try {
    const router = new RequestRouter({
      status: async () => ({
        email: POISON.email,
        claudeExecutable: `${POISON.home}/.local/bin/claude`,
        claudeVersion: "2.1.292",
        loggedIn: true,
        authMethod: "claude.ai",
        subscriptionType: "team",
      }),
      appVersion: () => "0.4.0",
    } as never);
    const reply = (await router.dispatch({
      type: "diagnostics.summary",
      id: "d1",
    })) as DiagnosticsSummary;
    assert.equal(reply.appVersion, "0.4.0");
    assert.equal(reply.protocolVersion, PROTOCOL_VERSION);
    assert.deepEqual(reply.account, { method: "claude.ai", plan: "team" });
    const text = JSON.stringify(reply);
    for (const poison of Object.values(POISON)) assert.equal(text.includes(poison), false, poison);
  } finally {
    if (saved === undefined) delete process.env.COLONOVA_DESIGN_LOG_DIR;
    else process.env.COLONOVA_DESIGN_LOG_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
