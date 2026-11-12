import assert from "node:assert/strict";
import { test } from "node:test";
import { createFrozenRequest } from "../src/next/preview/frozen-request.ts";

test("제출 그림의 늦은 답은 이동, 대상 전환, API 교체와 닫힘 뒤 버린다", () => {
  const gate = createFrozenRequest();
  const api = {};
  gate.update("A", api);
  const first = gate.begin("A", 1);
  assert.equal(gate.accepts(first, 1), true);
  assert.equal(gate.accepts(first, 2), false);
  gate.update("B", api);
  gate.update("A", api);
  assert.equal(gate.accepts(first, 1), false);
  const second = gate.begin("A", 2);
  gate.update("A", {});
  assert.equal(gate.accepts(second, 2), false);
  const third = gate.begin("A", 3);
  gate.invalidate();
  assert.equal(gate.accepts(third, 3), false);
});
