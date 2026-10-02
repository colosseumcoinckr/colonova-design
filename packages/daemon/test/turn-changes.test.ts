import assert from "node:assert/strict";
import { test } from "node:test";
import { changedInTurn } from "../dist/turn-changes.js";

test("a read-only pinned request cannot inherit prior pending edits", () => {
  const before = new Map([
    ["old.tsx", "old-content"],
    ["image.png", "old-binary"],
  ]);
  assert.deepEqual(changedInTurn(before, new Map(before)), []);
  assert.deepEqual(changedInTurn(null, before), []);
  assert.deepEqual(changedInTurn(before, new Map([...before, ["new.ts", "new-content"]])), [
    "new.ts",
  ]);
  assert.deepEqual(
    changedInTurn(
      before,
      new Map([
        ["old.tsx", "changed-content"],
        ["image.png", "changed-binary"],
      ]),
    ),
    ["old.tsx", "image.png"],
  );
  assert.deepEqual(changedInTurn(before, new Map([["image.png", "old-binary"]])), ["old.tsx"]);
});
