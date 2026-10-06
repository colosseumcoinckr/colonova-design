import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-journey.test.ts 와 같은 모양).
import { L } from "../src/next/labels.ts";
import {
  type AppRowInput,
  agentUpdateEvents,
  appRowCopy,
  appSummaryRow,
  selfUpdateOutcome,
  updateRowCopy,
  updateSummary,
} from "../src/next/lib/update-row.ts";
import { hasNewerVersion, plainDotted } from "../src/next/lib/version.ts";

const t = L.update;

test("hasNewerVersion: 점찍은 숫자끼리 비교한다", () => {
  assert.equal(hasNewerVersion("2.1.4", "2.2.0"), true);
  assert.equal(hasNewerVersion("2.1.4", "2.1.4"), false);
  assert.equal(hasNewerVersion("2.2.0", "2.1.4"), false);
  // 자릿수가 다른 버전 — 1.0.10 이 1.0.9 를 앞선다(글자 비교의 함정).
  assert.equal(hasNewerVersion("1.0.10", "1.0.9"), false);
  assert.equal(hasNewerVersion("0.46", "0.46.1"), true);
});

test("hasNewerVersion: 문장 속의 버전을 읽고, 못 읽으면 거짓", () => {
  assert.equal(hasNewerVersion("2.1.4 (Claude Code)", "2.2.0"), true);
  assert.equal(hasNewerVersion("codex-cli 0.46.0", "codex-cli 0.46.0"), false);
  assert.equal(hasNewerVersion(null, "2.2.0"), false);
  assert.equal(hasNewerVersion("2.1.4", null), false);
  assert.equal(hasNewerVersion("버전 없음", "2.2.0"), false);
});

test("plainDotted: 문장 속의 첫 버전만 뽑는다", () => {
  assert.equal(plainDotted("2.1.4 (Claude Code)"), "2.1.4");
  assert.equal(plainDotted("codex-cli 0.46.0"), "0.46.0");
  assert.equal(plainDotted("rust-v0.46.0"), "0.46.0");
  assert.equal(plainDotted(null), null);
  assert.equal(plainDotted("숫자가 없는 글"), null);
});

test("updateRowCopy: 새 버전이 있으면 화살표 문장과 업데이트 단추", () => {
  assert.deepEqual(updateRowCopy({ id: "claude", version: "2.1.4", latestVersion: "2.2.0" }, t), {
    state: "available",
    version: "2.1.4 → 2.2.0 있어요",
    note: null,
    action: "update",
  });
  // 문장 속 버전도 같은 잣대로 읽는다.
  assert.equal(
    updateRowCopy({ id: "claude", version: "2.1.4 (Claude Code)", latestVersion: "2.2.0" }, t)
      .state,
    "available",
  );
});

test("updateRowCopy: 같은 버전이면 최신, 확인 전에는 현재만", () => {
  assert.deepEqual(updateRowCopy({ id: "claude", version: "2.2.0", latestVersion: "2.2.0" }, t), {
    state: "latest",
    version: "2.2.0",
    note: null,
    action: "none",
  });
  assert.deepEqual(updateRowCopy({ id: "claude", version: "2.1.4", latestVersion: null }, t), {
    state: "unknown",
    version: "현재 2.1.4",
    note: null,
    action: "none",
  });
});

test("updateRowCopy: 도는 중 · 미루기는 현재 버전만 보인다", () => {
  assert.deepEqual(
    updateRowCopy({ id: "codex", version: "0.46.0", latestVersion: "0.47.0", phase: "running" }, t),
    { state: "running", version: "0.46.0", note: null, action: "none" },
  );
  assert.deepEqual(
    updateRowCopy({ id: "codex", version: "0.46.0", latestVersion: "0.47.0", phase: "pending" }, t),
    { state: "pending", version: "0.46.0", note: t.deferred, action: "none" },
  );
});

test("updateRowCopy: 끝나면 깐 버전과 시각, 실패하면 이유와 다시 시도", () => {
  assert.deepEqual(
    updateRowCopy(
      {
        id: "claude",
        version: "2.1.4",
        latestVersion: "2.2.0",
        phase: "done",
        at: "2026-09-25T11:27:00",
        versionAfter: "2.2.0",
      },
      t,
    ),
    { state: "latest", version: "2.2.0", note: "11:27에 업데이트했어요", action: "none" },
  );
  assert.deepEqual(
    updateRowCopy(
      {
        id: "claude",
        version: "2.1.4",
        latestVersion: "2.2.0",
        phase: "failed",
        detail: "내려받은 파일을 확인하지 못했어요",
      },
      t,
    ),
    {
      state: "failed",
      version: "2.1.4",
      note: "내려받은 파일을 확인하지 못했어요",
      action: "retry",
    },
  );
});

test("agentUpdateEvents: 끝난 업데이트만 한 줄씩, 이름은 프로바이더의 것, 최신이 위", () => {
  const providers = [
    { id: "claude", label: "Claude Code" },
    { id: "codex", label: "Codex" },
  ];
  const rows = agentUpdateEvents(
    {
      claude: { phase: "done", at: "2026-09-25T02:27:00Z", version: "2.2.0 (Claude Code)" },
      codex: { phase: "running", at: "2026-09-25T02:30:00Z" },
    },
    providers,
    L.update.doneEvent,
  );
  assert.deepEqual(
    rows.map((row) => row.text),
    ["Claude Code 를 2.2.0 으로 업데이트했어요"],
  );
  // 버전을 모르는 끝 · 없는 표는 줄이 없다.
  assert.deepEqual(
    agentUpdateEvents({ codex: { phase: "done", at: "x" } }, providers, L.update.doneEvent),
    [],
  );
  assert.deepEqual(agentUpdateEvents(undefined, providers, L.update.doneEvent), []);
  const two = agentUpdateEvents(
    {
      claude: { phase: "done", at: "2026-09-25T01:00:00Z", version: "2.2.0" },
      codex: { phase: "done", at: "2026-09-25T03:00:00Z", version: "0.47.0" },
    },
    providers,
    L.update.doneEvent,
  );
  assert.deepEqual(
    two.map((row) => row.id),
    ["codex", "claude"],
  );
});

/** 앱 줄의 문장 — 온보딩의 단계 말을 빌리는 `downloading` 까지 부르는 쪽이 만드는 그대로. */
const words = { ...L.update, downloading: L.onboarding.installSteps.download };
const base: AppRowInput = {
  phase: "idle",
  probe: "done",
  check: { updateAvailable: true, version: "0.5.0" },
  canSelfUpdate: true,
  snoozed: false,
  failed: false,
};

test("selfUpdateOutcome: 첫 누름은 내려받고 준비됨으로, 세션이 돌면 미룬다", () => {
  assert.deepEqual(selfUpdateOutcome({ prepared: true, version: "0.5.0" }, "start"), {
    phase: "ready",
    error: null,
  });
  assert.deepEqual(selfUpdateOutcome({ deferred: true, version: "0.5.0" }, "start"), {
    phase: "deferred",
    error: null,
  });
  // 준비가 이미 끝나 있던 앱 — 첫 누름이 곧 재시작 동의였다.
  assert.equal(selfUpdateOutcome({ started: true, steps: [] }, "start").phase, "restarting");
});

test("selfUpdateOutcome: 준비된 뒤의 누름은 재시작, 세션이 돌면 끝나는 순간으로", () => {
  assert.equal(
    selfUpdateOutcome({ started: true, downloadPath: "x" }, "restart").phase,
    "restarting",
  );
  assert.equal(
    selfUpdateOutcome({ deferred: true, version: "0.5.0" }, "restart").phase,
    "restartDeferred",
  );
});

test("selfUpdateOutcome: 실패는 걸음을 되돌린다 — 재시작이 실패해도 준비해 둔 것은 그대로", () => {
  assert.deepEqual(selfUpdateOutcome({ error: "내려받지 못했습니다" }, "start"), {
    phase: "idle",
    error: "내려받지 못했습니다",
  });
  assert.deepEqual(selfUpdateOutcome({ error: "교체하지 못했습니다" }, "restart"), {
    phase: "ready",
    error: "교체하지 못했습니다",
  });
});

test("selfUpdateOutcome: 개발 실행의 계획 · 모르는 모양은 아무 일도 없었던 것", () => {
  assert.deepEqual(selfUpdateOutcome({ planned: {}, guarded: "개발 실행" }, "start"), {
    phase: "idle",
    error: null,
  });
  assert.deepEqual(selfUpdateOutcome(undefined, "restart"), { phase: "ready", error: null });
  assert.deepEqual(selfUpdateOutcome("뭔가", "start"), { phase: "idle", error: null });
});

test("appRowCopy: 새 버전이 있으면 업데이트 단추와 흐름 한 줄 — 누르면 다시 시작이 따른다고 미리 말한다", () => {
  const copy = appRowCopy(base, words);
  assert.equal(copy.state, "available");
  assert.equal(copy.line, "새 버전 0.5.0 있어요");
  assert.equal(copy.action, "update");
  assert.equal(copy.note, L.update.appFlow);
  assert.equal(copy.bar, false);
});

test("appRowCopy: 내려받는 동안은 내려받는 중이다 — 다시 시작하는 중이라 말하지 않는다", () => {
  const copy = appRowCopy({ ...base, phase: "downloading" }, words);
  assert.equal(copy.state, "downloading");
  assert.equal(copy.line, L.onboarding.installSteps.download);
  assert.notEqual(copy.line, L.update.appBusy);
  assert.equal(copy.bar, true);
  assert.equal(copy.action, "none");
});

test("appRowCopy: 준비됨은 이름 있는 재시작 단추와 작은 나중에 — 나중에를 누르면 재촉만 걷힌다", () => {
  const ready = appRowCopy({ ...base, phase: "ready" }, words);
  assert.equal(ready.state, "ready");
  assert.equal(ready.line, L.update.appReady);
  assert.equal(ready.action, "restart");
  assert.equal(ready.later, true);
  const snoozed = appRowCopy({ ...base, phase: "ready", snoozed: true }, words);
  assert.equal(snoozed.action, "restart");
  assert.equal(snoozed.later, false);
});

test("appRowCopy: 재시작은 그때 비로소 다시 시작하는 중이고, 세션이 돌면 끝나는 순간을 기다린다", () => {
  const restarting = appRowCopy({ ...base, phase: "restarting" }, words);
  assert.equal(restarting.line, L.update.appBusy);
  assert.equal(restarting.bar, true);
  const waiting = appRowCopy({ ...base, phase: "restartDeferred" }, words);
  assert.equal(waiting.state, "restartDeferred");
  assert.equal(waiting.note, L.update.appRestartDeferred);
  assert.equal(waiting.action, "none");
  const deferred = appRowCopy({ ...base, phase: "deferred" }, words);
  assert.equal(deferred.state, "deferred");
  assert.equal(deferred.note, L.update.appDeferred);
});

test("appRowCopy: 걸음이 쉬는 동안은 조용한 확인의 답이 말한다", () => {
  assert.equal(appRowCopy({ ...base, probe: "pending", check: null }, words).state, "checking");
  const failed = appRowCopy({ ...base, probe: "failed", check: null }, words);
  assert.equal(failed.state, "failed");
  assert.equal(failed.line, L.update.rowCheckFailed);
  const latest = appRowCopy(
    { ...base, check: { updateAvailable: false, version: "0.4.1" } },
    words,
  );
  assert.deepEqual([latest.state, latest.line, latest.action], ["latest", "0.4.1", "none"]);
});

test("appRowCopy: 실패한 뒤에는 다시 시도, 스스로 바꿀 수 없는 컴퓨터는 릴리스 링크", () => {
  const retry = appRowCopy({ ...base, failed: true }, words);
  assert.equal(retry.state, "updateFailed");
  assert.equal(retry.action, "retry");
  // 실패의 말은 줄 아래 칸(실패 원문과 함께)이 맡는다 — 이름 아래 덧말은 비운다.
  assert.equal(retry.note, null);
  const link = appRowCopy({ ...base, canSelfUpdate: false }, words);
  assert.equal(link.action, "link");
  assert.equal(link.note, null);
});

test("updateSummary: 확인할 줄이 없으면 모두 최신이라 말하지 않는다", () => {
  assert.equal(updateSummary({ checking: false, rows: [], checkFailed: 0 }).kind, "none");
  // 최신인지 모르는 줄뿐이어도 마찬가지다 — 현재 버전만 아는 것과 최신인 것은 다르다.
  assert.equal(
    updateSummary({ checking: false, rows: ["unknown"], checkFailed: 0 }).kind,
    "unknown",
  );
  assert.equal(
    updateSummary({ checking: false, rows: ["latest", "unknown"], checkFailed: 0 }).kind,
    "unknown",
  );
  assert.equal(
    updateSummary({ checking: false, rows: ["latest", "latest"], checkFailed: 0 }).kind,
    "latest",
  );
});

test("updateSummary: 새 버전은 세어서 말하고, 내려받는 중 · 준비됨 · 미룬 것도 센다", () => {
  const summary = updateSummary({
    checking: false,
    rows: ["available", "ready", "pending", "latest"],
    checkFailed: 0,
  });
  assert.deepEqual([summary.kind, summary.count], ["available", 3]);
  // 업데이트 단추가 실패한 줄도 새 버전은 그대로 서 있다.
  assert.equal(updateSummary({ checking: false, rows: ["failed"], checkFailed: 0 }).count, 1);
});

test("updateSummary: 확인 중 · 업데이트 중이 먼저, 확인 실패는 새 버전이 없을 때 말한다", () => {
  assert.equal(
    updateSummary({ checking: true, rows: ["available"], checkFailed: 0 }).kind,
    "checking",
  );
  assert.equal(
    updateSummary({ checking: false, rows: ["running", "available"], checkFailed: 0 }).kind,
    "updating",
  );
  const failed = updateSummary({ checking: false, rows: ["latest"], checkFailed: 2 });
  assert.deepEqual([failed.kind, failed.failed], ["failed", 2]);
  // 새 버전이 있으면 그것이 먼저고, 실패 수는 곁에 실려 간다(「새 버전 1개 · 확인 못 한 항목도 있어요」).
  const mixed = updateSummary({ checking: false, rows: ["available"], checkFailed: 1 });
  assert.deepEqual([mixed.kind, mixed.count, mixed.failed], ["available", 1, 1]);
});

test("appSummaryRow: 앱 줄의 걸음을 요약 띠의 말로 옮긴다", () => {
  assert.equal(appSummaryRow("latest"), "latest");
  assert.equal(appSummaryRow("available"), "available");
  assert.equal(appSummaryRow("updateFailed"), "available");
  assert.equal(appSummaryRow("downloading"), "running");
  assert.equal(appSummaryRow("restarting"), "running");
  assert.equal(appSummaryRow("deferred"), "pending");
  assert.equal(appSummaryRow("restartDeferred"), "pending");
  assert.equal(appSummaryRow("ready"), "ready");
  // 확인이 닿지 않은 줄은 새 버전을 모르는 줄이다.
  assert.equal(appSummaryRow("failed"), "unknown");
  assert.equal(appSummaryRow("checking"), "unknown");
});
