import assert from "node:assert/strict";
import { test } from "node:test";
import { captureTargets } from "../dist/comments.js";

test("submission photos include observed changed screens even when the user never selected a pin", () => {
  assert.deepEqual(
    captureTargets([], "2026-10-02T00:00:00Z", [{ route: "/" }, { route: "/members" }]),
    [{ route: "/" }, { route: "/members" }],
  );
});

test("photo targets keep current-cycle pins, deduplicate routes, and refuse external addresses", () => {
  assert.deepEqual(
    captureTargets(
      [
        { screen: "old", at: "2026-10-01T00:00:00Z" },
        { screen: "members", at: "2026-10-02T01:00:00Z" },
      ],
      "2026-10-02T00:00:00Z",
      [
        { route: "/members?tab=all" },
        { route: "/" },
        { route: "//external.example" },
        { route: "https://external.example" },
      ],
    ),
    [{ route: "/members" }, { route: "/" }],
  );
});
