import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-journey.test.ts 와 같은 모양).
import { ReviewGeneration } from "../src/next/lib/use-submit-review.ts";

test("a shared or baseline-only status receipt retires the saved submit snapshot despite equal visible counts", () => {
  const reads = new ReviewGeneration();
  const old = { pendingChanges: 0, cycleScreens: [], stage: "idle" };
  const savedGeneration = reads.observe(old);
  assert.equal(reads.observe(old), savedGeneration);
  const received = { ...old };
  assert.notEqual(reads.observe(received), savedGeneration);
});
