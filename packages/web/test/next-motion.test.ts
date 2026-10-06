import assert from "node:assert/strict";
import { test } from "node:test";
import { takeFreshKeys } from "../src/next/lib/fresh-keys.ts";
// 순수 모듈 — src 에서 곧장 읽는다(next-install-step.test.ts 와 같은 모양).
import {
  currentGate,
  GATE_ORDER,
  type GateKey,
  type GatePasses,
  gatePasses,
  gatesDone,
  inviteProgress,
  modalCloseMs,
  ringGeometry,
  ringSegments,
  takeFreshPasses,
  themePeekHalves,
} from "../src/next/onboarding/motion.ts";

test("takeFreshPasses: 처음 볼 때는 통과를 전부 '본 것'으로 새긴다", () => {
  // 앱을 켰을 때 이미 통과한 항목이 튀면 안 된다 — 첫 그림은 새 것이 아니다.
  const taken = takeFreshPasses(null, ["tools", "agent"]);
  assert.deepEqual(taken.fresh, []);
  assert.deepEqual([...taken.seen].sort(), ["agent", "tools"]);
});

test("takeFreshPasses: 이번에 통과한 항목만 새 것이고, 다시는 새 것이 아니다", () => {
  const seen = new Set<GateKey>(["tools"]);
  const first = takeFreshPasses(seen, ["tools", "agent"]);
  assert.deepEqual(first.fresh, ["agent"]);
  const second = takeFreshPasses(first.seen, ["tools", "agent", "invite"]);
  assert.deepEqual(second.fresh, ["invite"]);
  const third = takeFreshPasses(second.seen, ["tools", "agent", "invite"]);
  assert.deepEqual(third.fresh, []);
});

test("inviteProgress: 진행기가 아는 만큼만, 넘치지 않게", () => {
  assert.equal(inviteProgress(0, 4), 0);
  assert.equal(inviteProgress(1, 4), 25);
  assert.equal(inviteProgress(4, 4), 100);
  assert.equal(inviteProgress(7, 4), 100);
  // 행이 없는 확인판 — 채울 것이 없으면 다 찬 것으로 말한다.
  assert.equal(inviteProgress(0, 0), 100);
});

test("themePeekHalves: 시스템 따르기는 밝음과 어두움의 반반이다", () => {
  assert.deepEqual(themePeekHalves("system"), ["light", "dark"]);
  assert.deepEqual(themePeekHalves("claude"), ["claude"]);
  assert.deepEqual(themePeekHalves("github"), ["github"]);
});

test("modalCloseMs: 역방향 pop 의 길이 — 움직임을 끈 창은 기다리지 않는다", () => {
  assert.equal(modalCloseMs(false), 120);
  assert.equal(modalCloseMs(true), 0);
});

test("takeFreshKeys: 앞 렌더를 모를 때는 지금 있는 줄을 전부 이미 본 것으로 새긴다", () => {
  // 앱을 켜거나 프로젝트를 옮길 때 이미 있는 줄이 한꺼번에 등장하면 안 된다.
  const taken = takeFreshKeys(null, ["a", "b"]);
  assert.deepEqual(taken.fresh, []);
  assert.deepEqual([...taken.keys].sort(), ["a", "b"]);
});

test("takeFreshKeys: 앞 렌더에 없던 열쇠만 새 것이다", () => {
  const first = takeFreshKeys(null, ["a", "b"]);
  const second = takeFreshKeys(first.keys, ["c", "a", "b"]);
  assert.deepEqual(second.fresh, ["c"]);
  // 다음 렌더에는 c 도 이미 본 것이다 — 새 것은 한 번만 새 것이다.
  assert.deepEqual(takeFreshKeys(second.keys, ["c", "a", "b"]).fresh, []);
});

test("takeFreshKeys: 순서만 바뀐 재정렬은 새 것이 아니다", () => {
  // React 가 재정렬에서 옆 줄을 옮겨도 그 줄들이 다시 등장하면 안 된다.
  const first = takeFreshKeys(null, ["a", "b", "c"]);
  assert.deepEqual(takeFreshKeys(first.keys, ["c", "a", "b"]).fresh, []);
});

test("takeFreshKeys: 사라졌다 돌아온 열쇠는 다시 새 것이다", () => {
  // 지우기에 실패해 되살아난 줄은 다시 들어온 줄로 맞는다.
  const first = takeFreshKeys(null, ["a", "b"]);
  const gone = takeFreshKeys(first.keys, ["a"]);
  assert.deepEqual(gone.fresh, []);
  assert.deepEqual(takeFreshKeys(gone.keys, ["a", "b"]).fresh, ["b"]);
});

test("takeFreshKeys: 빈 목록에서 채워지는 것은 새 것이다(범위가 같을 때)", () => {
  // 기록 없이 시작한 목록(null)과 비어 있던 목록(빈 집합)은 다르다 — 앞의 것은 바탕이고
  // 뒤의 것은 첫 대화가 태어난 순간이다.
  assert.deepEqual(takeFreshKeys(new Set(), ["a"]).fresh, ["a"]);
  assert.deepEqual(takeFreshKeys(null, ["a"]).fresh, []);
});

const none: GatePasses = { tools: false, agent: false, invite: false };

test("gatePasses: 도구는 git 과 런타임이 둘 다 지나가야 하고, github 줄은 보지 않는다", () => {
  const step = (id: "git" | "runtime" | "claude" | "github", status: "pass" | "fail") =>
    ({ id, status, detail: "" }) as const;
  assert.deepEqual(gatePasses(null, 0), none);
  assert.deepEqual(
    gatePasses([step("git", "pass"), step("runtime", "fail"), step("github", "pass")], 0),
    none,
  );
  assert.deepEqual(
    gatePasses(
      [
        step("git", "pass"),
        step("runtime", "pass"),
        step("claude", "pass"),
        step("github", "fail"),
      ],
      2,
    ),
    { tools: true, agent: true, invite: true },
  );
  // 프로젝트가 하나라도 있으면 초대 파일은 끝난 것이다.
  assert.equal(gatePasses([], 1).invite, true);
});

test("currentGate: 차례상 첫 미통과가 지금이고, 기다리는 칸은 건너뛴다", () => {
  assert.deepEqual(GATE_ORDER, ["tools", "agent", "invite"]);
  assert.equal(currentGate(none), "tools");
  assert.equal(currentGate({ tools: true, agent: false, invite: false }), "agent");
  // 도구가 늦어도 앞 칸이 이긴다 — 뒤 칸이 지나가 있어도 손은 앞 칸으로 간다.
  assert.equal(currentGate({ tools: false, agent: true, invite: true }), "tools");
  // 눌러 볼 것이 없는 칸(검사 답을 기다리는 AI)에는 강조를 두지 않는다.
  assert.equal(
    currentGate({ tools: true, agent: false, invite: false }, { agent: true }),
    "invite",
  );
  assert.equal(currentGate({ tools: true, agent: true, invite: true }), null);
  // 기다리는 칸만 남았으면 강조할 곳이 없다.
  assert.equal(currentGate({ tools: true, agent: true, invite: false }, { invite: true }), null);
});

test("ringSegments: 통과 · 지금 · 아직 — 조각의 차례는 항목의 차례와 같다", () => {
  assert.deepEqual(ringSegments(none), ["now", "todo", "todo"]);
  assert.deepEqual(ringSegments({ tools: true, agent: false, invite: false }), [
    "ok",
    "now",
    "todo",
  ]);
  assert.deepEqual(ringSegments({ tools: true, agent: false, invite: false }, { agent: true }), [
    "ok",
    "todo",
    "now",
  ]);
  assert.deepEqual(ringSegments({ tools: true, agent: true, invite: true }), ["ok", "ok", "ok"]);
});

test("gatesDone: 지나간 항목만 센다", () => {
  assert.equal(gatesDone(none), 0);
  assert.equal(gatesDone({ tools: true, agent: false, invite: true }), 2);
  assert.equal(gatesDone({ tools: true, agent: true, invite: true }), 3);
});

test("ringGeometry: 조각과 틈이 한 바퀴를 빈틈없이 나눈다", () => {
  const spec = { radius: 42, stroke: 4, gap: 12, count: 3 };
  const { dash, lead, step } = ringGeometry(spec);
  const circumference = 2 * Math.PI * spec.radius;
  assert.equal(step, 120);
  // 눈에 보이는 조각 = 선의 길이 + 둥근 끝 둘(굵기). 거기에 틈을 더하면 한 칸이다.
  const visible = (dash / 100) * circumference + spec.stroke;
  assert.ok(Math.abs(visible + spec.gap - circumference / spec.count) < 1e-9);
  // 선은 칸의 시작에서 `틈의 절반 + 둥근 끝 하나` 만큼 들어와 시작한다 — 조각이 칸의 가운데에 앉는다.
  const leadPx = (lead / 360) * circumference;
  assert.ok(Math.abs(leadPx - (spec.gap / 2 + spec.stroke / 2)) < 1e-9);
  // 조각 수가 달라져도 같은 식이다.
  assert.equal(ringGeometry({ ...spec, count: 4 }).step, 90);
});
