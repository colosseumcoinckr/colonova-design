import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MachineSetting } from "../dist/machine-setting.js";
import { machineSupportValue } from "../dist/machine-support.js";
import { systemHandlers } from "../dist/requests/system.js";

/**
 * 초대 파일의 창구 칸(2026-11-12 설계 결정 ㉱ · 작업 WE) — `machine.support.set`
 * 선로가 초대장과 같은 판정(parseSupport)으로 machine.json 에 저장하고, `null` 이
 * 지우는 것, 그리고 형식이 틀린 값은 버리는 것을 본다. 적용(applyInvite)이
 * 초대장에 칸이 없을 때 이 선로를 부르지 않는 것은 웹 시험
 * (packages/web/test/next-invite-support.test.ts)이 본다 — 그래야 옛 초대 파일을
 * 다시 열어도 이미 저장된 창구가 사라지지 않는다.
 */

const FILE_NAME = "machine.json";

function scene() {
  const dir = mkdtempSync(join(tmpdir(), "colonova-support-"));
  const setting = new MachineSetting(join(dir, FILE_NAME));
  const broadcasts: Array<{ type?: string }> = [];
  const deps = {
    status: async () => ({
      support: machineSupportValue(setting.get("support")),
    }),
    broadcast: (message: { type?: string }) => broadcasts.push(message),
    machineSetting: setting,
  } as unknown as Parameters<typeof systemHandlers>[0];
  const handlers = systemHandlers(deps);
  const set = handlers["machine.support.set"] as (message: {
    id: string;
    type: "machine.support.set";
    support: unknown;
  }) => Promise<{ ok: true }>;
  return { dir, setting, broadcasts, set };
}

test("machine.support.set — 창구를 machine.json 에 두고 상태를 다시 방송한다", async () => {
  const { dir, setting, broadcasts, set } = scene();
  try {
    assert.deepEqual(
      await set({
        id: "1",
        type: "machine.support.set",
        support: { name: "김개발", room: "#design-tool-help", url: "https://chat.example/r/1" },
      }),
      { ok: true },
    );
    assert.deepEqual(JSON.parse(setting.get("support") ?? "null"), {
      name: "김개발",
      room: "#design-tool-help",
      url: "https://chat.example/r/1",
    });
    // 다시 켠 직후에도 읽힌다 — 재시작을 넘는 값이다.
    const reopened = new MachineSetting(join(dir, FILE_NAME));
    reopened.load();
    assert.equal(reopened.get("support"), setting.get("support"));
    for (let i = 0; i < 100 && broadcasts.length < 1; i += 1) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setImmediate(resolve);
      await promise;
    }
    assert.equal(broadcasts.length, 1);
    assert.equal(broadcasts[0]?.type, "status");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("machine.support.set — 칸마다 거른다: http 주소 · 길이 넘침은 그 칸만 버린다", async () => {
  const { dir, setting, set } = scene();
  try {
    await set({
      id: "1",
      type: "machine.support.set",
      // 선로 스키마를 넘어선 값도 데몬이 한 번 더 거른다 — normalizeInvite 와 같은 규칙.
      support: { name: "김개발", room: "r".repeat(61), url: "http://chat.example/x" },
    });
    assert.deepEqual(JSON.parse(setting.get("support") ?? "null"), { name: "김개발" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("machine.support.set — null 은 지우고, 빈 칸은 저장하지 않는다", async () => {
  const { dir, setting, set } = scene();
  try {
    await set({
      id: "1",
      type: "machine.support.set",
      support: { name: "김개발" },
    });
    assert.ok(setting.get("support") !== null);
    await set({ id: "2", type: "machine.support.set", support: null });
    assert.equal(setting.get("support"), null);
    // 전부 비거나 버려진 칸만 남은 값은 없는 것으로 둔다 — 깨진 JSON 문자열이 남지 않는다.
    await set({ id: "3", type: "machine.support.set", support: {} });
    assert.equal(setting.get("support"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("실제 읽기(machineSupportValue) — 깨진 저장값은 null 또는 안전한 칸만 남긴다", () => {
  // DaemonServer.machineSupport 가 쓰는 바로 그 판정 — 저장소의 날 문자열을 넣는다.
  for (const broken of ["{oops", '"text"', "[1,2]", "42", "null", "{}"]) {
    assert.equal(machineSupportValue(broken), null, `broken: ${JSON.stringify(broken)}`);
  }
  assert.equal(machineSupportValue(null), null, "칸 자체가 없는 저장소");
  // https 가 아니거나 한도를 넘는 칸은 없는 것으로 — javascript: · file: 주소가
  // 상태로 나가지 않는다.
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "http://chat.example/r/1"]) {
    assert.equal(machineSupportValue(JSON.stringify({ url })), null, url);
    // 이름이 살아 있으면 주소만 버려진다.
    assert.deepEqual(machineSupportValue(JSON.stringify({ name: "김개발", url })), {
      name: "김개발",
    });
  }
  // 300자를 넘는 주소도 버려진다.
  assert.equal(machineSupportValue(JSON.stringify({ url: `https://${"u".repeat(293)}` })), null);
  // 정상 저장값은 그대로 돌아온다.
  assert.deepEqual(
    machineSupportValue(JSON.stringify({ name: "김개발", url: "https://chat.example/r/1" })),
    { name: "김개발", url: "https://chat.example/r/1" },
  );
});

test("실제 읽기(machineSupportValue) — 저장 선로가 쓴 값을 상태가 그대로 읽는다", async () => {
  const { dir, setting, set } = scene();
  try {
    // 한도를 넘는 칸은 저장되지 않는다 — 읽기도 같은 판정이다.
    await set({
      id: "1",
      type: "machine.support.set",
      support: { name: "n".repeat(41), room: "#dev" },
    });
    assert.deepEqual(machineSupportValue(setting.get("support")), { room: "#dev" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
