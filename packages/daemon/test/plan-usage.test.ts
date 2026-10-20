/**
 * 사용량 칸의 읽기 (2026-09-28) — 칩이 창을 모두 세우도록 바꾼 자리의 시험.
 * 두 축을 누른다: 드라이버의 답 → 창 분류(Claude 의 모델별 주간), 쉬는 대화가
 * 없을 때 그 AI 의 probe 로 읽는 추적기.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
// 컴파일된 dist 를 읽는다 — `@colonova-design/protocol` 의 import 가 얽혀 있다.
import { toPlanUsage as claudePlan } from "../dist/agent/drivers/claude/session.js";
import { PlanTracker } from "../dist/plan-tracker.js";

test("Claude — 5시간 · 주간 · 모델별 주간(Fable)은 이름과 기간을 함께 싣는다", () => {
  assert.equal(
    claudePlan({ rate_limits_available: false, rate_limits: null, subscription_type: null }),
    null,
  );
  const plan = claudePlan({
    rate_limits_available: true,
    subscription_type: "team",
    rate_limits: {
      five_hour: { utilization: 44, resets_at: "2026-09-28T09:00:00+00:00" },
      seven_day: { utilization: 11, resets_at: "2026-10-02T18:00:00+00:00" },
      model_scoped: [
        { display_name: "Fable", utilization: 11, resets_at: "2026-10-02T18:00:00+00:00" },
      ],
    },
  });
  assert.equal(plan?.provider, "claude");
  assert.equal(plan?.fiveHour?.utilization, 44);
  assert.equal(plan?.sevenDay?.utilization, 11);
  assert.deepEqual(plan?.modelWeekly, [
    {
      label: "Fable 주간",
      name: "Fable",
      period: "week",
      utilization: 11,
      resetsAt: "2026-10-02T18:00:00+00:00",
    },
  ]);
});

test("PlanTracker — 쉬는 대화가 없으면 그 AI 의 probe 로, 있으면 그 대화로 읽는다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "plan-tracker-"));
  const before = process.env.COLONOVA_DESIGN_PLAN_USAGE;
  process.env.COLONOVA_DESIGN_PLAN_USAGE = join(dir, "plan-usage.json");
  try {
    const asked: string[] = [];
    const reading = (provider: string) => ({
      provider,
      subscriptionType: null,
      fiveHour: { utilization: 10, resetsAt: null },
      sevenDay: null,
      modelWeekly: [],
    });
    let changed = 0;
    const idle = new Map<string, { usage: () => Promise<unknown> }>();
    const tracker = new PlanTracker({
      idleSession: (provider: string) => idle.get(provider) ?? null,
      usageProbes: [
        {
          provider: "second",
          read: async () => {
            asked.push("probe:second");
            return reading("second");
          },
        },
      ],
      probeCwd: () => dir,
      signal: new AbortController().signal,
      onChanged: () => {
        changed += 1;
      },
      catalogSources: [],
    });
    // 읽기가 없는 AI 는 하나씩 빚진다 — second 는 probe 가, 그 밖의 AI 는 읽을 길이 없어 묻지 않는다.
    tracker.currentAll(["second", "other"]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(asked, ["probe:second"]);
    assert.equal(changed, 1);
    assert.equal(tracker.currentAll(["second"]).second?.fiveHour?.utilization, 10);
    // 쉬는 대화가 있으면 probe 를 띄우지 않고 그 대화가 답한다(간격의 하한은 새 AI 라 없다).
    idle.set("claude", {
      usage: async () => {
        asked.push("session:claude");
        return reading("claude");
      },
    });
    tracker.refresh("claude");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(asked, ["probe:second", "session:claude"]);
    // 2분 안의 다시 읽기는 모인다 — 칸을 여닫을 때마다 CLI 를 띄우지 않는다.
    tracker.refresh("second");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(asked, ["probe:second", "session:claude"]);
  } finally {
    if (before === undefined) delete process.env.COLONOVA_DESIGN_PLAN_USAGE;
    else process.env.COLONOVA_DESIGN_PLAN_USAGE = before;
    rmSync(dir, { recursive: true, force: true });
  }
});
