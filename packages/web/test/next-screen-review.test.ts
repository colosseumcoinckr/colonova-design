import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendScreenDraft,
  DraftScreenHints,
  humanReviewState,
  markHumanReview,
  parseHumanReviews,
  ReviewGeneration,
  verifyHumanReview,
} from "../src/next/lib/screen-review.ts";

test("explicit review survives serialization and cannot cross route, size, or changed/unknown version", () => {
  const rows = parseHumanReviews(
    JSON.stringify(
      markHumanReview([], { route: "/list", device: "desktop", version: "saved-a", at: "now" }),
    ),
  );
  assert.equal(humanReviewState(rows, "/list", "desktop", "saved-a"), "checked");
  assert.equal(
    humanReviewState([], "/list", "desktop", "saved-a"),
    "pending",
    "another project has its own rows",
  );
  assert.equal(humanReviewState(rows, "/other", "desktop", "saved-a"), "pending");
  assert.equal(humanReviewState(rows, "/list", "mobile", "saved-a"), "pending");
  assert.equal(humanReviewState(rows, "/list", "desktop", "saved-b"), "pending");
  assert.equal(humanReviewState(rows, "/list", "desktop", null), "unknown");
  assert.equal(humanReviewState(rows, "/list", "desktop", "saved-a", false), "historical");
  assert.deepEqual(parseHumanReviews("broken"), []);
});
test("additional screen edit appends context without replacing existing editable words", () => {
  assert.equal(
    appendScreenDraft("already typing", "screen context"),
    "already typing\n\nscreen context",
  );
  assert.equal(appendScreenDraft("", "screen context"), "screen context");
});

test("a shared or baseline-only status receipt retires a checked snapshot despite equal visible counts", () => {
  const reads = new ReviewGeneration();
  const old = { pendingChanges: 0, cycleScreens: [], stage: "idle" };
  const savedGeneration = reads.observe(old);
  assert.equal(reads.observe(old), savedGeneration);
  const received = { ...old };
  assert.notEqual(reads.observe(received), savedGeneration);
  const rows = [{ route: "/", device: "desktop" as const, version: "before", at: "now" }];
  assert.equal(humanReviewState(rows, "/", "desktop", null), "unknown");
  assert.equal(humanReviewState(rows, "/", "desktop", "after-baseline"), "pending");
});
test("delayed mark cannot acknowledge a different live route/device or changed work version", async () => {
  for (const moved of ["route", "device", "frozen", "running", "project"]) {
    let eligible = true;
    let release!: (value: { expectedPreview: string; repo: { pendingChanges: number } }) => void;
    const pending = verifyHumanReview(
      "old",
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      () => eligible,
    );
    eligible = false;
    release({ expectedPreview: "old", repo: { pendingChanges: 0 } });
    assert.equal(await pending, null, moved);
  }
  assert.equal(
    await verifyHumanReview(
      "old",
      async () => ({ expectedPreview: "new", repo: { pendingChanges: 0 } }),
      () => true,
    ),
    null,
  );
  assert.equal(
    await verifyHumanReview(
      "old",
      async () => ({ expectedPreview: "old", repo: { pendingChanges: 1 } }),
      () => true,
    ),
    null,
  );
  assert.equal(
    (
      await verifyHumanReview(
        "old",
        async () => ({ expectedPreview: "old", repo: { pendingChanges: 0 } }),
        () => true,
      )
    )?.expectedPreview,
    "old",
  );
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

test("query-selected views never inherit the bare screen's explicit check", () => {
  const rows = [{ route: "/inbound", device: "desktop" as const, version: "saved", at: "now" }];
  assert.equal(humanReviewState(rows, "/inbound?center=C1", "desktop", null), "unknown");
  assert.equal(humanReviewState(rows, "/inbound?center=C1", "desktop", "saved"), "pending");
  assert.equal(humanReviewState(rows, "/inbound", "desktop", "saved"), "checked");
});
