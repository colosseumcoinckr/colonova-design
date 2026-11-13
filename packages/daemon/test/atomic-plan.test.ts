// 의미 단위 분류(atomic-plan)의 순수 시험 — haiku 를 띄우지 않고 프롬프트
// 렌더 · 답 검증 · 캐시 · 재시도 · 폴백을 본다. machine turn 은 가짜다.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AtomicUnit,
  buildAtomicPlanPrompt,
  createAtomicPlanner,
  parseAtomicPlanAnswer,
} from "../dist/atomic-plan.js";
import type { MachineTurn } from "../dist/machine-provider.js";

const UNITS: AtomicUnit[] = [
  {
    id: "u1",
    path: "src/search.ts",
    kind: "hunk",
    patch: "@@ +검색 상자\n+export function 검색() {}",
  },
  { id: "u2", path: "src/search.test.ts", kind: "hunk", patch: "@@ +검색 시험" },
  { id: "u3", path: "src/colors.css", kind: "hunk", patch: "@@ +버튼 색" },
];

const VALID = JSON.stringify({
  groups: [
    { message: "feat: 회원 검색 상자 추가", unitIds: ["u1", "u2"] },
    { message: "style: 버튼 색 다듬기", unitIds: ["u3"] },
  ],
});

/** 부른 횟수 · 마지막 프롬프트를 기억하는 가짜 단발. */
function fakeTurn(answers: Array<string | null>) {
  const calls: string[] = [];
  const turn: MachineTurn = async (prompt) => {
    calls.push(prompt);
    const answer = answers[calls.length - 1];
    if (answer === undefined) throw new Error("예상 밖의 호출");
    return answer;
  };
  return { calls, turn };
}

const DEPS = (turn: MachineTurn) => ({ turn, cwd: "/tmp", timeoutMs: 1_000 });
const INPUT = {
  units: UNITS,
  request: "검색 추가하고 버튼 색 수정",
  baseTree: "b",
  targetTree: "t",
};

// ---------------------------------------------------------------------------
// 프롬프트 렌더
// ---------------------------------------------------------------------------

test("프롬프트는 규칙 · 요청 · 전체 단위를 싣고 패치는 통째로 들어간다", () => {
  const prompt = buildAtomicPlanPrompt({ units: UNITS, request: INPUT.request });
  assert.ok(prompt);
  for (const unit of UNITS) {
    assert.ok(prompt.includes(`### ${unit.id} — ${unit.path}`));
    assert.ok(prompt.includes(unit.patch.trim()));
  }
  assert.ok(prompt.includes("<request>"));
  assert.ok(prompt.includes(INPUT.request));
  // 전체 대화가 아니라 요청만 싣는다 — 대화 지시문은 없다.
  assert.ok(!prompt.includes("대화록"));
});

test("일반 소스 패치가 단위 예산을 넘으면 렌더하지 않는다 — 요약 대체 없음", () => {
  const huge = { id: "big", path: "src/big.ts", kind: "hunk" as const, patch: "x".repeat(16_001) };
  assert.equal(buildAtomicPlanPrompt({ units: [huge], request: "r" }), null);
});

test("lock 경로 · binary kind 패치가 넘치면 요약 note 로 대체하고 단위를 남긴다", () => {
  const lock = {
    id: "l1",
    path: "pnpm-lock.yaml",
    kind: "file" as const,
    patch: "y".repeat(20_000),
    summary: "의존성 세 개 추가",
  };
  const bin = {
    id: "b1",
    path: "img/icon.png",
    kind: "binary" as const,
    patch: "z".repeat(20_000),
  };
  const prompt = buildAtomicPlanPrompt({ units: [lock, bin, UNITS[0]], request: "r" });
  assert.ok(prompt);
  assert.ok(prompt.includes("### l1 — pnpm-lock.yaml (file)"));
  assert.ok(prompt.includes("### b1 — img/icon.png (binary)"));
  assert.ok(prompt.includes("(패치가 커서 요약만 실음"));
  assert.ok(!prompt.includes("y".repeat(100)));
});

test("요청이 길면 잘린 표식을 싣고 빈 단위 목록은 렌더하지 않는다", () => {
  assert.equal(buildAtomicPlanPrompt({ units: [], request: "r" }), null);
  const prompt = buildAtomicPlanPrompt({ units: UNITS, request: "가".repeat(3_000) });
  assert.ok(prompt?.includes("(요청이 길어 앞부분만 실음)"));
});

// ---------------------------------------------------------------------------
// 답 읽기 — 결정적 검증
// ---------------------------------------------------------------------------

test("올바른 JSON 은 그룹 순서 그대로 계획이 된다", () => {
  const plan = parseAtomicPlanAnswer(VALID, ["u1", "u2", "u3"]);
  assert.deepEqual(plan, {
    groups: [
      { message: "feat: 회원 검색 상자 추가", unitIds: ["u1", "u2"] },
      { message: "style: 버튼 색 다듬기", unitIds: ["u3"] },
    ],
  });
});

test("코드 울타리 안의 JSON 도 읽는다", () => {
  const fenced = `다음과 같이 나눕니다.\n\`\`\`json\n${VALID}\n\`\`\``;
  assert.deepEqual(parseAtomicPlanAnswer(fenced, ["u1", "u2", "u3"])?.groups.length, 2);
});

test("빠진 id · 모르는 id · 중복 id 는 거절한다", () => {
  const missing = JSON.stringify({ groups: [{ message: "feat: a", unitIds: ["u1", "u2"] }] });
  assert.equal(parseAtomicPlanAnswer(missing, ["u1", "u2", "u3"]), null);
  const unknown = JSON.stringify({
    groups: [{ message: "feat: a", unitIds: ["u1", "u2", "u3", "u9"] }],
  });
  assert.equal(parseAtomicPlanAnswer(unknown, ["u1", "u2", "u3"]), null);
  const dup = JSON.stringify({
    groups: [
      { message: "feat: a", unitIds: ["u1", "u2", "u3"] },
      { message: "fix: b", unitIds: ["u1"] },
    ],
  });
  assert.equal(parseAtomicPlanAnswer(dup, ["u1", "u2", "u3"]), null);
});

test("빈 그룹 · 빈 unitIds · 나쁜 제목은 거절한다", () => {
  const emptyGroups = JSON.stringify({ groups: [] });
  assert.equal(parseAtomicPlanAnswer(emptyGroups, ["u1"]), null);
  const emptyIds = JSON.stringify({ groups: [{ message: "feat: a", unitIds: [] }] });
  assert.equal(parseAtomicPlanAnswer(emptyIds, []), null);
  const badTitles = [
    "회원 검색 상자 추가", // type 없음
    "wip: 회원 검색", // 허용 목록 밖 type
    "feat: ", // 빈 변경
    "feat:  앞 공백", // 앞뒤 공백은 기계가 고치지 않는다
    "feat: 줄바꿈\n포함",
    `feat: ${"가".repeat(200)}`, // 길이 상한
  ];
  for (const message of badTitles) {
    const answer = JSON.stringify({ groups: [{ message, unitIds: ["u1"] }] });
    assert.equal(parseAtomicPlanAnswer(answer, ["u1"]), null, message);
  }
});

test("JSON 이 아니거나 깨진 답은 거절한다", () => {
  assert.equal(parseAtomicPlanAnswer("죄송합니다", ["u1"]), null);
  assert.equal(parseAtomicPlanAnswer('{"groups": [', ["u1"]), null);
  assert.equal(parseAtomicPlanAnswer('{"groups": "yes"}', ["u1"]), null);
});

// ---------------------------------------------------------------------------
// 판돌이 — 성공 · 재시도 · 폴백
// ---------------------------------------------------------------------------

test("올바른 답은 한 턴에 ok 계획으로 돌고 턴 수를 센다", async () => {
  const { calls, turn } = fakeTurn([VALID]);
  const result = await createAtomicPlanner().plan(INPUT, DEPS(turn));
  assert.equal(result.ok, true);
  assert.equal(result.cached, false);
  assert.equal(result.usage.turns, 1);
  assert.equal(calls.length, 1);
});

test("turn 실패(null · 예외)는 turn-failed — 저장은 살아남는다", async () => {
  const { turn: nullTurn } = fakeTurn([null]);
  const first = await createAtomicPlanner().plan(INPUT, DEPS(nullTurn));
  assert.deepEqual(first.ok ? null : first.reason, "turn-failed");
  assert.equal(first.usage?.turns, 1); // 실패한 호출도 한 턴으로 센다
  const { turn: throwTurn } = fakeTurn([]);
  const second = await createAtomicPlanner().plan(INPUT, DEPS(throwTurn));
  assert.deepEqual(second.ok ? null : second.reason, "turn-failed");
});

test("나쁜 답은 한 번만 다시 묻고 계속 나쁘면 invalid-answer 로 끝난다", async () => {
  const { calls, turn } = fakeTurn(["잘못된 답", "여전히 잘못된 답", "절대 안 불러야 할 답"]);
  const result = await createAtomicPlanner().plan(INPUT, DEPS(turn));
  assert.equal(result.ok, false);
  assert.deepEqual(result.ok ? null : result.reason, "invalid-answer");
  assert.equal(calls.length, 2); // 무한 루프 없음 — 딱 한 번의 재시도
  assert.ok(calls[1].includes("직전의 답은 규칙을 어겼습니다"));
});

test("한 번의 나쁜 답 뒤 올바른 답은 성공한다", async () => {
  const { calls, turn } = fakeTurn(["not json", VALID]);
  const result = await createAtomicPlanner().plan(INPUT, DEPS(turn));
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(result.usage.turns, 2);
});

test("빈 단위 · 예산 초과는 턴 없이 이유 코드로 끝난다", async () => {
  const { calls, turn } = fakeTurn([VALID]);
  const planner = createAtomicPlanner();
  const empty = await planner.plan({ ...INPUT, units: [] }, DEPS(turn));
  assert.deepEqual(empty.ok ? null : empty.reason, "empty-input");
  const huge = [
    { id: "big", path: "src/big.ts", kind: "hunk" as const, patch: "x".repeat(20_000) },
  ];
  const tooBig = await planner.plan({ ...INPUT, units: huge }, DEPS(turn));
  assert.deepEqual(tooBig.ok ? null : tooBig.reason, "input-too-large");
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// 캐시 · in-flight — 성공만 저장, 합류/적중은 계측 없음
// ---------------------------------------------------------------------------

test("같은 입력의 두 번째 호출은 턴 없이 cached 로 답하고 계측은 비어 있다", async () => {
  const { calls, turn } = fakeTurn([VALID]);
  const planner = createAtomicPlanner();
  await planner.plan(INPUT, DEPS(turn));
  const second = await planner.plan(INPUT, DEPS(turn));
  assert.equal(calls.length, 1);
  assert.equal(second.ok, true);
  assert.equal(second.cached, true);
  assert.equal(second.usage.turns, 0); // 다른 호출의 턴을 이중으로 세지 않는다
});

test("base/target/model/요청이 다르면 캐시를 타지 않는다", async () => {
  const { calls, turn } = fakeTurn([VALID, VALID, VALID]);
  const planner = createAtomicPlanner();
  await planner.plan(INPUT, DEPS(turn));
  await planner.plan({ ...INPUT, baseTree: "b2" }, DEPS(turn));
  await planner.plan({ ...INPUT, model: "other" }, DEPS(turn));
  assert.equal(calls.length, 3);
});

test("도는 중인 같은 키의 호출은 턴 하나로 합치고 합류 쪽은 cached 다", async () => {
  const gate = Promise.withResolvers<string | null>();
  let calls = 0;
  const turn: MachineTurn = async () => {
    calls += 1;
    return gate.promise;
  };
  const planner = createAtomicPlanner();
  const owner = planner.plan(INPUT, DEPS(turn));
  const joiner = planner.plan(INPUT, DEPS(turn));
  gate.resolve(VALID);
  const [a, b] = await Promise.all([owner, joiner]);
  assert.equal(calls, 1);
  assert.equal(a.ok && !a.cached, true);
  assert.equal(b.ok && b.cached, true);
  assert.equal(b.usage.turns, 0);
});

test("캐시된 계획을 호출자가 고쳐도 다음 적중은 원본이다", async () => {
  const { turn } = fakeTurn([VALID]);
  const planner = createAtomicPlanner();
  const first = await planner.plan(INPUT, DEPS(turn));
  assert.ok(first.ok);
  first.plan.groups.push({ message: "feat: 오염", unitIds: ["x"] });
  const second = await planner.plan(INPUT, DEPS(turn));
  assert.ok(second.ok);
  assert.equal(second.plan.groups.length, 2);
});

test("실패 결과는 캐시하지 않는다 — 같은 입력을 다시 묻는다", async () => {
  const { calls, turn } = fakeTurn([null, VALID]);
  const planner = createAtomicPlanner();
  await planner.plan(INPUT, DEPS(turn));
  const second = await planner.plan(INPUT, DEPS(turn));
  assert.equal(calls.length, 2);
  assert.equal(second.ok, true);
});

test("캐시는 상한을 지킨다 — 가장 오래된 성공을 먼저 버린다", async () => {
  const { calls, turn } = fakeTurn([VALID, VALID, VALID]);
  const planner = createAtomicPlanner(1);
  await planner.plan(INPUT, DEPS(turn));
  await planner.plan({ ...INPUT, request: "다른 요청" }, DEPS(turn)); // 첫 키를 밀어낸다
  await planner.plan(INPUT, DEPS(turn));
  assert.equal(calls.length, 3);
});

// ---------------------------------------------------------------------------
// 계측 — 숫자만 · 콜백 없는 턴도 센다
// ---------------------------------------------------------------------------

test("onUsage 는 턴마다 한 번 불리고 누계로 더해진다", async () => {
  const turnCalls: number[] = [];
  const usages: unknown[] = [];
  const turn: MachineTurn = async (_prompt, opts) => {
    turnCalls.push(1);
    opts.onUsage?.({ inputTokens: 11, outputTokens: 3, durationMs: 50 });
    return "not json";
  };
  const deps = { ...DEPS(turn), onUsage: (u: { inputTokens?: number }) => usages.push(u) };
  const result = await createAtomicPlanner().plan(INPUT, deps);
  assert.equal(result.ok, false);
  assert.equal(turnCalls.length, 2); // 첫 시도 + 한 번의 재시도
  assert.equal(usages.length, 2); // 호출자의 onUsage 도 같은 두 번
  assert.equal(result.usage?.inputTokens, 22);
  assert.equal(result.usage?.outputTokens, 6);
  assert.equal(result.usage?.durationMs, 100);
  assert.equal(result.usage?.turns, 2);
});

test("onUsage 를 안 부르는 드라이버라도 턴 수는 센다", async () => {
  const { turn } = fakeTurn([VALID]);
  const result = await createAtomicPlanner().plan(INPUT, DEPS(turn));
  assert.ok(result.ok);
  assert.equal(result.usage.turns, 1);
  assert.equal(result.usage.inputTokens, 0);
});
