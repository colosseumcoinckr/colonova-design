// CI-순수-제외 — 감독자 하네스(cycle-harness)가 진짜 git 을 만든다. scripts/pure-tests.mjs 가 CI 에서 뺀다(2026-10-24).
// PLAN-MCP §3.E 의 E-3 — notify_developer 도구. 인자 정규화 · 결과 문장 ·
// 알림 키는 순수로, 예산은 감독자 장면(가짜 시계)의 원장으로, 배달은
// developer-notice.test.ts 의 가짜 GitHub(MemoryGitHub) 관례로 본다.
// `../dist` 임포트인 이유: node --test 는 src 의 `.js` 지정자를 못 읽는다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BUDGETS } from "../dist/budgets.js";
import { MemoryCredentialStore } from "../dist/credentials.js";
import { readLedger } from "../dist/cycle-ledger.js";
import {
  AGENT_NOTICE_KEY_PREFIX,
  type DeveloperNoticeDeps,
  isScreenQuietKey,
} from "../dist/developer-notice.js";
import { Escalation } from "../dist/escalation.js";

import type { DaemonLogger } from "../dist/log.js";
import { makeSupervisedScene } from "./helpers/cycle-harness.ts";

const quiet: DaemonLogger = { info() {}, warn() {}, error() {} };

test("BUDGETS.agentNotice — 하루 3통이다", () => {
  assert.deepEqual(BUDGETS.agentNotice, { max: 3, windowMs: 24 * 60 * 60_000 });
});

// ————— 화면 주의 — agent: 키는 문제 문장에 서지 않는다 —————

test("isScreenQuietKey — agent: 접두는 화면 주의에서 조용하다", () => {
  assert.equal(isScreenQuietKey(`${AGENT_NOTICE_KEY_PREFIX}0badc0de`), true);
  assert.equal(isScreenQuietKey("agentish"), false);
  assert.equal(isScreenQuietKey("disk:low"), true);
  assert.equal(isScreenQuietKey("push:behind"), false);
});

test("attentionParts — agent: 알림은 원장에 남지만 주의의 재료에서는 빠진다", async () => {
  const scene = await makeSupervisedScene();
  try {
    const at = "2026-09-28T00:00:00.000Z";
    scene.supervisor.setNotice(`${AGENT_NOTICE_KEY_PREFIX}0badc0de`, {
      via: "issue",
      raisedAt: at,
      count: 1,
    });
    scene.supervisor.setNotice("push:behind", { via: "issue", raisedAt: at, count: 1 });
    const parts = scene.supervisor.attentionParts();
    assert.equal(parts.notices[`${AGENT_NOTICE_KEY_PREFIX}0badc0de`], undefined);
    assert.ok(parts.notices["push:behind"]);
  } finally {
    await scene.dispose();
  }
});

// ————— 예산 — 감독자가 원장(cycle.json budgets)으로 센다 —————

test("spendAgentNotice — 셋째까지 허용, 넷째 거절, 창이 돌면 다시 허용", async () => {
  const scene = await makeSupervisedScene();
  try {
    const t0 = Date.parse("2026-09-28T09:00:00.000Z");
    scene.setNow(t0);
    assert.deepEqual(
      [1, 2, 3].map(() => scene.supervisor.spendAgentNotice()),
      [true, true, true],
    );
    // 넷째는 거절 — 도구가 문장으로 답할 몫이다.
    assert.equal(scene.supervisor.spendAgentNotice(), false);
    // 거절은 창을 늘리지 않는다 — 원장의 마지막 셈은 셋째다.
    const entry = readLedger(scene.ledgerPath).budgets.agentNotice;
    assert.equal(entry?.spent, 3);
    // 창 밖(다음 날)의 첫 셈은 새 사건이다.
    scene.setNow(t0 + BUDGETS.agentNotice.windowMs + 1);
    assert.equal(scene.supervisor.spendAgentNotice(), true);
  } finally {
    await scene.dispose();
  }
});

test("spendAgentNotice — 없던 원장에도 budgets.agentNotice 로 적힌다", async () => {
  const scene = await makeSupervisedScene();
  try {
    scene.setNow(Date.parse("2026-09-28T09:00:00.000Z"));
    assert.equal(scene.supervisor.spendAgentNotice(), true);
    const ledger = readLedger(scene.ledgerPath);
    assert.equal(ledger.budgets.agentNotice?.spent, 1);
    assert.equal(ledger.budgets.agentNotice?.firstAt, "2026-09-28T09:00:00.000Z");
  } finally {
    await scene.dispose();
  }
});

// ————— 배달 — 가짜 GitHub 으로 raise 한 번 —————

/** 슬러그 "app" 하나를 아는 deps — developer-notice.test.ts 의 관례와 같은 모양. */
function deps(over: Partial<DeveloperNoticeDeps> = {}): DeveloperNoticeDeps {
  return {
    github: () => null,
    githubAuthExpired: () => false,
    repoSlug: () => ({ owner: "colonova-design", repo: "harness" }),
    project: () => ({ name: "앱", reviewers: ["dev1"], openPr: null }),
    authorName: () => "기획자",
    slack: new Escalation(new MemoryCredentialStore(), quiet, async () => {
      throw new Error("slack 없음");
    }),
    store: () => null,
    logger: quiet,
    ...over,
  };
}
