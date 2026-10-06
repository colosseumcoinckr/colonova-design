import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-journey.test.ts 와 같은 모양).
import { appendScreenDraft, DraftScreenHints } from "../src/next/lib/draft-screens.ts";

test("additional screen edit appends context without replacing existing editable words", () => {
  assert.equal(
    appendScreenDraft("already typing", "screen context"),
    "already typing\n\nscreen context",
  );
  assert.equal(appendScreenDraft("", "screen context"), "screen context");
});

test("additional-edit screen hints stay with their originating draft across switches and delayed failure", () => {
  const hints = new DraftScreenHints();
  hints.add("project-a:thread-a", [{ screen: "/members" }]);
  assert.deepEqual(hints.take("project-b:thread-b"), []);
  const sent = hints.take("project-a:thread-a");
  hints.add("project-b:thread-b", [{ screen: "/orders" }]);
  hints.add("project-a:thread-a", sent); // the old send rejects after switching projects
  assert.deepEqual(hints.take("project-b:thread-b"), [{ screen: "/orders" }]);
  assert.deepEqual(hints.take("project-a:thread-a"), [{ screen: "/members" }]);
  assert.deepEqual(hints.take("project-a:thread-a"), []);
});
