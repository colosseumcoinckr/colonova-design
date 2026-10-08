// 승인 · 자동 검사는 휘발 신호다 — 레지스트리에 남기지 않고 틱마다 새로 얹는다(2026-10-08 검토 · F9).
// 제출 단계가 `getPullRequest` 결과(`approved` 를 단 객체)를 그대로 저장하면 승인이 철회돼도 승인으로 남았다.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { HandoffStatus } from "@colonova-design/protocol";
import { RepoCore, withoutHandoffSignals } from "../dist/repo-core.js";

/** `getPullRequest` 가 돌려주는 모양 — 승인과 검사 요약을 단 채다. */
function annotated(): HandoffStatus {
  return {
    number: 7,
    url: "https://example.test/pull/7",
    branch: "colonova-design/20261008-1",
    state: "open",
    title: "회원 목록 화면",
    reviewers: ["dev1"],
    since: "2026-10-08T01:00:00.000Z",
    approved: true,
    ci: { state: "passing" },
  };
}

function makeCore() {
  const stored: Array<HandoffStatus | null> = [];
  const core = new RepoCore({
    root: "/tmp/colonova-handoff-signals-never-cloned",
    url: null,
    onStatus: () => {},
    onCycleChange: (cycle) => stored.push(cycle.handoff),
  });
  return { core, stored };
}

test("withoutHandoffSignals — 승인 · 검사 요약만 떼고 나머지는 그대로, 뗄 것이 없으면 같은 참조", () => {
  const stable = withoutHandoffSignals(annotated());
  assert.ok(stable);
  assert.equal("approved" in stable, false);
  assert.equal("ci" in stable, false);
  assert.deepEqual(stable, {
    number: 7,
    url: "https://example.test/pull/7",
    branch: "colonova-design/20261008-1",
    state: "open",
    title: "회원 목록 화면",
    reviewers: ["dev1"],
    since: "2026-10-08T01:00:00.000Z",
  });
  assert.equal(withoutHandoffSignals(stable), stable, "뗄 것이 없으면 새 객체를 만들지 않는다");
  assert.equal(withoutHandoffSignals(null), null);
});

test("setCycle — 레지스트리로 가는 요청에도 코어가 쥔 요청에도 휘발 신호가 없다", () => {
  const { core, stored } = makeCore();
  core.setCycle("colonova-design/20261008-1", annotated());
  assert.equal(stored.length, 1);
  for (const handoff of [stored[0], core.openHandoff, core.currentHandoff]) {
    assert.ok(handoff);
    assert.equal("approved" in handoff, false, "승인은 저장하지 않는다");
    assert.equal("ci" in handoff, false, "검사 요약도 저장하지 않는다");
    assert.equal(handoff.number, 7);
    assert.equal(handoff.since, "2026-10-08T01:00:00.000Z", "저장되는 필드는 그대로다");
  }
  assert.equal(core.snapshot().handoff?.approved, undefined, "신호가 오기 전에는 승인이 없다");
});

test("승인 → 철회(DISMISSED) — 신호가 사라지면 선로의 approved 도 사라진다", () => {
  const { core } = makeCore();
  // 승인된 채 다시 제출한 순간 — 제출 단계는 승인을 단 객체로 setCycle 을 부른다.
  core.setCycle("colonova-design/20261008-1", annotated());
  core.setHandoffSignals({ pr: 7, approved: true, ci: { state: "passing" } });
  assert.equal(core.snapshot().handoff?.approved, true);
  assert.deepEqual(core.snapshot().handoff?.ci, { state: "passing" });

  // 다음 관찰이 읽은 값 — 승인이 철회돼 신호에서 빠졌다.
  core.setHandoffSignals({ pr: 7 });
  assert.equal(core.snapshot().handoff?.approved, undefined, "철회된 승인이 남지 않는다");
  assert.equal(core.snapshot().handoff?.ci, undefined);

  // 요청이 닫혀 신호 자체가 없어져도 마찬가지다.
  core.setHandoffSignals(null);
  assert.equal(core.snapshot().handoff?.approved, undefined);
});

test("다른 요청의 신호는 얹지 않는다 — 번호가 다르면 요청 그대로", () => {
  const { core } = makeCore();
  core.setCycle("colonova-design/20261008-1", annotated());
  core.setHandoffSignals({ pr: 8, approved: true });
  assert.equal(core.snapshot().handoff?.approved, undefined);
});

test("레지스트리에서 되살린 요청에 승인이 묻어 있어도 코어는 신호로만 승인을 말한다", () => {
  const core = new RepoCore({
    root: "/tmp/colonova-handoff-signals-never-cloned",
    url: null,
    onStatus: () => {},
    cycle: { branch: "colonova-design/20261008-1", handoff: annotated() },
  });
  assert.equal("approved" in (core.openHandoff ?? {}), false);
  assert.equal(core.snapshot().handoff?.approved, undefined);
  core.setHandoffSignals({ pr: 7, approved: true });
  assert.equal(core.snapshot().handoff?.approved, true);
});
