import assert from "node:assert/strict";
import { test } from "node:test";
import { PLAN_LOOP_KEY, planLoopOn } from "../dist/plan-loop.js";
import { systemHandlers } from "../dist/requests/system.js";

/**
 * 기획서↔화면 자동 판정 토글 시험(2026-11-03 A안 1A-1-c · 작업 D2) — `planLoopOn` 의 기본(켬)과
 * "off" 꺼짐, `machine.set` 의 `planLoop` 가 PLAN_LOOP_KEY 에 끔("off") · 켬(잊기)을 쓰고 상태를
 * 다시 방송하는 것을 본다.
 */

test("planLoopOn — 기본은 켬이고 off 만 끔이다", () => {
  const values = new Map<string, string>();
  const setting = { get: (key: string) => values.get(key) ?? null };
  assert.equal(planLoopOn(setting), true, "키가 없으면 켬(잊기가 곧 켬)");
  values.set(PLAN_LOOP_KEY, "off");
  assert.equal(planLoopOn(setting), false);
  values.set(PLAN_LOOP_KEY, "on");
  assert.equal(planLoopOn(setting), true, "off 외의 값은 끔으로 읽지 않는다");
});

test("machine.set — planLoop 끔은 off 를 쓰고 켬은 잊으며 상태를 다시 방송한다", async () => {
  const values = new Map<string, string>();
  const broadcasts: Array<{ type?: string }> = [];
  const deps = {
    status: async () => ({ planLoop: values.get(PLAN_LOOP_KEY) !== "off" }),
    broadcast: (message: { type?: string }) => broadcasts.push(message),
    machineSetting: {
      get: (key: string) => values.get(key) ?? null,
      set: (key: string, value: string | null) => {
        if (value === null) values.delete(key);
        else values.set(key, value);
      },
    },
  } as unknown as Parameters<typeof systemHandlers>[0];
  const handlers = systemHandlers(deps);
  const set = handlers["machine.set"] as (message: {
    id: string;
    type: "machine.set";
    planLoop?: boolean;
  }) => Promise<{ ok: true }>;

  assert.deepEqual(await set({ id: "1", type: "machine.set", planLoop: false }), { ok: true });
  assert.equal(values.get(PLAN_LOOP_KEY), "off", "끔은 off 로 적힌다");

  assert.deepEqual(await set({ id: "2", type: "machine.set", planLoop: true }), { ok: true });
  assert.equal(values.get(PLAN_LOOP_KEY), undefined, "켬은 잊기(null)로 돌린다");

  // 누를 때마다 상태를 다시 방송했다(agentAutoUpdate 와 같은 꼴).
  for (let i = 0; i < 500 && broadcasts.length < 2; i += 1) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setImmediate(resolve);
    await promise;
  }
  assert.equal(broadcasts.length, 2);
  assert.ok(broadcasts.every((one) => one.type === "status"));

  // planLoop 를 싣지 않은 누름은 값을 건드리지 않는다.
  await set({ id: "3", type: "machine.set" });
  assert.equal(values.get(PLAN_LOOP_KEY), undefined);
});
