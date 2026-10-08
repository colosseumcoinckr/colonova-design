import assert from "node:assert/strict";
import { test } from "node:test";
import { readTurn } from "@colonova-design/protocol";
// `../dist` 임포트인 이유: 형제를 `.js` 지정자로 부르는 모듈은 src 직접 로드가 그 지정을 못 고친다.
import {
  CI_FINISH_LINE,
  CI_LIMITS,
  CI_NO_DETAIL_LINE,
  type CiChecks,
  ciToTurn,
  classifyCheckRuns,
  failingNames,
  handoffCiOf,
  summarizeCheckRuns,
} from "../dist/ci-checks.js";
import { turnSubjectOf } from "../dist/common-instructions.js";
import type { CheckAnnotationRow, CheckRunRow } from "../dist/github.js";

/**
 * 자동 검사 읽기의 순수 부분(2026-10-07 베타 준비 분석 · W6) — 목록을 상태로 접는 판정, 읽는 양의 상한, AI 에게 가는
 * 브리프의 글. 프로세스를 띄우지 않는 순수 시험이다.
 */

let nextId = 1;
function run(over: Partial<CheckRunRow> = {}): CheckRunRow {
  const id = nextId++;
  return {
    id,
    name: `check-${id}`,
    status: "completed",
    conclusion: "success",
    title: "",
    summary: "",
    text: "",
    url: `https://github.test/runs/${id}`,
    annotations: 0,
    ...over,
  };
}
const failed = (over: Partial<CheckRunRow> = {}) => run({ conclusion: "failure", ...over });
const note = (over: Partial<CheckAnnotationRow> = {}): CheckAnnotationRow => ({
  path: "src/a.ts",
  line: 12,
  level: "failure",
  title: "",
  message: "Unexpected any",
  ...over,
});

test("상태 — 검사가 없으면 none, 도는 중이면 pending, 실패는 끝난 뒤에만 failing", () => {
  assert.equal(classifyCheckRuns([]).state, "none");
  assert.equal(
    classifyCheckRuns([run({ status: "in_progress", conclusion: null })]).state,
    "pending",
  );
  assert.equal(classifyCheckRuns([run({ status: "queued", conclusion: null })]).state, "pending");
  // 하나가 이미 실패했어도 나머지가 끝나길 기다린다 — 한 번의 브리프에 실패를 모두 싣는다.
  const mixed = classifyCheckRuns([failed(), run({ status: "in_progress", conclusion: null })]);
  assert.equal(mixed.state, "pending");
  assert.equal(mixed.failing.length, 1);
  assert.equal(classifyCheckRuns([failed(), run()]).state, "failing");
  for (const conclusion of ["failure", "timed_out", "startup_failure"]) {
    assert.equal(classifyCheckRuns([run({ conclusion })]).state, "failing", conclusion);
  }
});

test("상태 — 통과는 success · neutral · skipped, 취소 · 사람의 승인 대기는 실패가 아니다", () => {
  assert.equal(
    classifyCheckRuns([
      run({ conclusion: "success" }),
      run({ conclusion: "neutral" }),
      run({ conclusion: "skipped" }),
    ]).state,
    "passing",
  );
  // 취소(대개 새 실행에 밀림) · action_required · 결론 없는 완료 — AI 가 고칠 수 있는 실패가 아니다.
  for (const conclusion of ["cancelled", "action_required", "stale", null]) {
    const read = classifyCheckRuns([run({ conclusion }), run()]);
    assert.equal(read.state, "unknown", String(conclusion));
    assert.equal(read.failing.length, 0);
  }
});

test("요약 — 실패한 검사만 싣고, 이름 · 제목과 요약 · 줄 단위 안내를 상한 안에서 접는다", () => {
  const bad = failed({ name: "lint\n(node 20)", title: "린트 실패", summary: "오류 2개", id: 900 });
  const checks = summarizeCheckRuns(
    [run(), bad],
    new Map([[900, [note(), note({ level: "warning", message: "경고" })]]]),
  );
  assert.equal(checks.state, "failing");
  assert.equal(checks.failingCount, 1);
  assert.equal(checks.total, 2);
  assert.equal(checks.failing[0]?.name, "lint (node 20)", "이름의 줄바꿈은 한 칸으로 접힌다");
  assert.equal(checks.failing[0]?.summary, "린트 실패\n오류 2개");
  assert.deepEqual(checks.failing[0]?.annotations[0], {
    path: "src/a.ts",
    line: 12,
    message: "Unexpected any",
  });
  // 통과 · 도는 중에는 실패 목록이 비어 있다 — 상태만 말한다.
  assert.deepEqual(summarizeCheckRuns([run()]), {
    state: "passing",
    failingCount: 0,
    failing: [],
    total: 1,
  });
  assert.equal(
    summarizeCheckRuns([failed(), run({ status: "queued", conclusion: null })]).failing.length,
    0,
  );
});

test("요약 — 검사 20개 · 안내 합계 50줄에서 자르고 실패 수준의 안내를 먼저 센다", () => {
  const runs = Array.from({ length: 30 }, (_, i) => failed({ id: 1000 + i, name: `job-${i}` }));
  const annotations = new Map<number, CheckAnnotationRow[]>();
  // 첫 검사: 경고 10줄 + 실패 10줄 — 실패 수준이 앞에 선다.
  annotations.set(1000, [
    ...Array.from({ length: 10 }, (_, i) => note({ level: "warning", message: `경고 ${i}` })),
    ...Array.from({ length: 10 }, (_, i) => note({ level: "failure", message: `실패 ${i}` })),
  ]);
  // 둘째 검사: 40줄 — 합계 50 에서 남은 30줄만 싣는다.
  annotations.set(
    1001,
    Array.from({ length: 40 }, (_, i) => note({ message: `둘째 ${i}` })),
  );
  annotations.set(1002, [note({ message: "셋째" })]);
  const checks = summarizeCheckRuns(runs, annotations);
  assert.equal(checks.failingCount, 30, "실제 수는 그대로 센다");
  assert.equal(checks.failing.length, CI_LIMITS.failing);
  assert.ok(
    checks.failing[0]?.annotations.slice(0, 10).every((row) => row.message.startsWith("실패")),
  );
  assert.equal(checks.failing[1]?.annotations.length, 30, "남은 자리만큼만 싣는다");
  assert.equal(checks.failing[2]?.annotations.length, 0, "합계가 찬 뒤에는 싣지 않는다");
  const total = checks.failing.reduce((sum, row) => sum + row.annotations.length, 0);
  assert.equal(total, CI_LIMITS.annotations, "안내는 합계 50줄");
});

test("요약 — 긴 글은 상한에서 자르고 줄바꿈 낀 안내는 한 줄로 접는다", () => {
  const checks = summarizeCheckRuns(
    [failed({ id: 7, summary: "가".repeat(5000), name: "n".repeat(500) })],
    new Map([[7, [note({ message: `${"나\n".repeat(400)}끝` })]]]),
  );
  const only = checks.failing[0];
  assert.ok(only !== undefined);
  assert.ok(only.summary.length <= CI_LIMITS.summaryChars + 1);
  assert.ok(only.name.length <= CI_LIMITS.nameChars + 1);
  assert.ok((only.annotations[0]?.message.length ?? 0) <= CI_LIMITS.messageChars + 1);
  assert.ok(!(only.annotations[0]?.message ?? "").includes("\n"));
});

test("브리프 — 첫 줄 표식이 카드가 되고, 본문은 검사 이름 · 요약 · 안내를 싣고 끝의 기준 한 줄로 닫는다", () => {
  const checks = summarizeCheckRuns(
    [
      failed({ id: 21, name: "build", summary: "컴파일 오류" }),
      failed({ id: 22, name: "test (unit)" }),
      run(),
    ],
    new Map([[21, [note({ path: "src/list.tsx", line: 3, message: "Cannot find name 'x'" })]]]),
  );
  const text = ciToTurn({ pr: 42, checks });
  const { marker, body } = readTurn(text);
  assert.deepEqual(marker, { kind: "ci", pr: 42, failing: 2 });
  assert.ok(text.startsWith('<!-- colonova-design:ci {"pr":42,"failing":2} -->\n'));
  assert.ok(body.includes("검사 2개가 실패했습니다"));
  assert.ok(body.includes("1. build"));
  assert.ok(body.includes("   컴파일 오류"));
  assert.ok(body.includes("   - src/list.tsx:3 — Cannot find name 'x'"));
  assert.ok(body.includes("2. test (unit)"));
  assert.ok(!body.includes(CI_NO_DETAIL_LINE), "상세가 하나라도 있으면 없다는 말을 하지 않는다");
  assert.equal(body.split("\n").at(-1), CI_FINISH_LINE, "끝의 기준 한 줄이 맨 끝이다");
  assert.ok(CI_FINISH_LINE.includes("레포가 선언한 검사 명령"));
  assert.ok(CI_FINISH_LINE.includes("검사와 무관한 변경은 하지 마세요"));
});

test("브리프 — 상세가 하나도 없으면 그 사실을 밝히고 선언된 검사 명령으로 찾게 한다", () => {
  const checks = summarizeCheckRuns([failed({ id: 31, name: "ci" })]);
  const { body } = readTurn(ciToTurn({ pr: 5, checks }));
  assert.ok(body.includes(CI_NO_DETAIL_LINE));
  assert.ok(CI_NO_DETAIL_LINE.includes("직접 돌려"));
  assert.equal(body.split("\n").at(-1), CI_FINISH_LINE);
});

test("브리프 — 글자 상한을 넘으면 이름만 적고 줄였다고 밝히며, 상한에 잘린 검사는 수로 말한다", () => {
  const runs = Array.from({ length: 30 }, (_, i) =>
    failed({ id: 2000 + i, name: `job-${i}`, summary: "가".repeat(500) }),
  );
  const annotations = new Map<number, CheckAnnotationRow[]>();
  for (const row of runs) {
    annotations.set(
      row.id,
      Array.from({ length: 4 }, (_, i) => note({ message: "나".repeat(280), line: i + 1 })),
    );
  }
  const text = ciToTurn({ pr: 9, checks: summarizeCheckRuns(runs, annotations) });
  const { body } = readTurn(text);
  assert.ok(
    body.length <= CI_LIMITS.briefChars + 600,
    `브리프가 상한을 크게 넘지 않는다 (${body.length})`,
  );
  assert.ok(body.includes("1. job-0"), "첫 검사는 늘 싣는다");
  assert.ok(body.includes("   가가가가"), "앞의 검사는 요약을 싣는다");
  assert.ok(body.includes("20. job-19"), "상한 안의 검사는 이름이 모두 선다");
  assert.ok(body.includes("(글이 길어 일부 출력과 줄 안내는 줄였습니다)"));
  assert.ok(
    body.includes("(통과하지 못한 검사가 10개 더 있습니다)"),
    "20개 상한에 잘린 검사는 수로",
  );
  assert.ok(!body.includes("21. "));
  assert.equal(body.split("\n").at(-1), CI_FINISH_LINE);
});

test("브리프 — 기계 턴이라 커밋 제목이 되지 않는다(turnSubjectOf 는 말이 없는 턴으로 센다)", () => {
  const text = ciToTurn({ pr: 1, checks: summarizeCheckRuns([failed({ id: 41, name: "x" })]) });
  assert.deepEqual(turnSubjectOf(text), {});
});

test("표식 — 옛 · 깨진 값은 카드가 되되 수를 모른다, 표식이 아닌 모양은 그대로 둔다", () => {
  assert.deepEqual(readTurn('<!-- colonova-design:ci {"pr":3} -->\n본문').marker, {
    kind: "ci",
    pr: 3,
    failing: 0,
  });
  assert.deepEqual(readTurn('<!-- colonova-design:ci {"pr":"x","failing":-2} -->\n본문').marker, {
    kind: "ci",
    pr: 0,
    failing: 0,
  });
  assert.equal(readTurn("<!-- colonova-design:ci [] -->\n본문").marker, null);
});

test("선로 요약 — 종류와 숫자만 싣고, 없음 · 판단 불가 · 읽지 못함은 말하지 않는다", () => {
  const of = (state: CiChecks["state"], failingCount = 0): CiChecks => ({
    state,
    failingCount,
    failing: [],
    total: 3,
  });
  assert.deepEqual(handoffCiOf(of("passing")), { state: "passing" });
  assert.deepEqual(handoffCiOf(of("pending")), { state: "pending" });
  assert.deepEqual(handoffCiOf(of("failing", 2)), { state: "failing", failing: 2 });
  assert.deepEqual(handoffCiOf(of("failing", 0)), { state: "failing" });
  assert.equal(handoffCiOf(of("none")), undefined, "검사가 없다는 말이 통과가 아니다");
  assert.equal(handoffCiOf(of("unknown")), undefined);
  assert.equal(handoffCiOf(undefined), undefined, "읽지 못했으면 선로에도 없다");
});

test("개발자 알림의 이름 줄 — 셋까지 쓰고 나머지는 수로", () => {
  const runs = ["a", "b", "c", "d", "e"].map((name, i) => failed({ id: 3000 + i, name }));
  assert.equal(failingNames(summarizeCheckRuns(runs)), "a, b, c 외 2개");
  assert.equal(failingNames(summarizeCheckRuns(runs.slice(0, 2))), "a, b");
});
