import assert from "node:assert/strict";
import { test } from "node:test";
import { clearSentDraft } from "../src/next/lib/sent-draft.ts";

test("accepted home draft clears persistent text after composer unmount, preserving newer drafts", () => {
  const rows = new Map([["colonova-design.draft.home:project", "A"]]);
  const storage = {
    getItem: (key: string) => rows.get(key) ?? null,
    removeItem: (key: string) => {
      rows.delete(key);
    },
  };
  clearSentDraft("home:project", "A", storage);
  assert.equal(rows.size, 0);
  rows.set("colonova-design.draft.home:project", "next request");
  clearSentDraft("home:project", "A", storage);
  assert.equal(storage.getItem("colonova-design.draft.home:project"), "next request");
});
