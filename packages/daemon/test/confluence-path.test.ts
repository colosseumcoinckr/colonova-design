import assert from "node:assert/strict";
import { test } from "node:test";
import { type PlanNode, planPaths } from "../dist/confluence-path.js";

/**
 * 트리 → 폴더 경로 (2026-10-18 기획서 동기화 · 계획 항목 10) — 한글 제목 · 위험 문자
 * 걷기 · 이름 충돌(id 접미) · 깊은 계층 · 이동(같은 id 새 경로)을 못 박는 순수 시험이다.
 */

const node = (id: string, title: string, children: PlanNode[] = []): PlanNode => ({
  id,
  title,
  children,
});

test("한글 제목 — 그대로 살고 뿌리 자신의 경로는 <공간>/<뿌리 제목> 이다", () => {
  const root = node("933068815", "8.8 콜로노바", [
    node("1", "도메인 지도", [node("2", "결제 도메인")]),
  ]);
  const paths = planPaths(root, "COLO");
  assert.equal(paths.get("933068815"), "COLO/8.8 콜로노바");
  assert.equal(paths.get("1"), "COLO/8.8 콜로노바/도메인 지도");
  assert.equal(paths.get("2"), "COLO/8.8 콜로노바/도메인 지도/결제 도메인");
});

test("위험 문자 — 구분자와 예약 문자는 `-` 로 바꾸고 끝의 점 · 공백은 잘라낸다", () => {
  const root = node("r", "뿌리", [
    node("a", "결제/환불"),
    node("b", 'a\\b c:d e*f?g"h<i>j|k'),
    node("c", "보고서..."),
    node("d", "메모  "),
    node("e", "제\u0001목"),
  ]);
  const paths = planPaths(root, "COLO");
  assert.equal(paths.get("a"), "COLO/뿌리/결제-환불");
  assert.equal(paths.get("b"), "COLO/뿌리/a-b c-d e-f-g-h-i-j-k");
  assert.equal(paths.get("c"), "COLO/뿌리/보고서");
  assert.equal(paths.get("d"), "COLO/뿌리/메모");
  assert.equal(paths.get("e"), "COLO/뿌리/제-목");
});

test("이름 충돌 — 둘째부터 페이지 id 를 붙이고 잘려도 같은 규칙이다", () => {
  const root = node("r", "뿌리", [
    node("11", "정책"),
    node("12", "정책"),
    node("13", "정책"),
    node("14", "정책."), // 끝의 점을 걷고 나면 같은 이름이다(Windows 예방의 결과)
  ]);
  const paths = planPaths(root, "COLO");
  assert.equal(paths.get("11"), "COLO/뿌리/정책");
  assert.equal(paths.get("12"), "COLO/뿌리/정책-12");
  assert.equal(paths.get("13"), "COLO/뿌리/정책-13");
  assert.equal(paths.get("14"), "COLO/뿌리/정책-14");
});

test("깊은 계층 — 다섯 층도 폴더 사슬로 내려간다", () => {
  const root = node("1", "첫째", [
    node("2", "둘째", [
      node("3", "셋째", [node("4", "넷째", [node("5", "다섯째", [node("6", "여섯째")])])]),
    ]),
  ]);
  const paths = planPaths(root, "COLO");
  assert.equal(paths.size, 6);
  assert.equal(paths.get("6"), "COLO/첫째/둘째/셋째/넷째/다섯째/여섯째");
});

test("이동 — 같은 id 가 새 트리에서 새 경로로 다시 계산된다", () => {
  // 순수 함수다 — 다른 트리를 넣어 잰다(페이지 id 는 이동해도 변하지 않는다 · 실측).
  const before = planPaths(node("r", "옛 뿌리", [node("x", "옛 자리")]), "COLO");
  const after = planPaths(
    node("r2", "새 뿌리", [node("m", "옮긴 곳", [node("x", "새 자리")])]),
    "COLO",
  );
  assert.equal(before.get("x"), "COLO/옛 뿌리/옛 자리");
  assert.equal(after.get("x"), "COLO/새 뿌리/옮긴 곳/새 자리");
});

test("빈 이름 — 걷고 나서 비면 페이지 id 로 대신한다", () => {
  const root = node("r", "뿌리", [node("77", "."), node("78", "")]);
  const paths = planPaths(root, "COLO");
  assert.equal(paths.get("77"), "COLO/뿌리/77");
  assert.equal(paths.get("78"), "COLO/뿌리/78");
});

test("255바이트 넘는 제목도 폴더가 된다 — 잘리고 id 로 구별된다(세대4 지적 · livelock 막음)", () => {
  const long = "가".repeat(200);
  const paths = planPaths(
    { id: "root", title: long, children: [{ id: "child", title: "가".repeat(150), children: [] }] },
    "COLO",
  );
  const rootPath = paths.get("root") ?? "";
  for (const segment of rootPath.split("/")) {
    assert.ok([...segment].length <= 60, `이름이 상한을 넘는다: ${[...segment].length}`);
  }
  assert.ok(paths.has("child"));
});
