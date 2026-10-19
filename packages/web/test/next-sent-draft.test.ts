import assert from "node:assert/strict";
import { test } from "node:test";
import { clearSentDraft, restoreRejectedDraft } from "../src/next/lib/sent-draft.ts";

test("거절된 보내기의 글과 첨부를 새로 쓴 초안과 함께 되살린다", () => {
  const sent = { text: "sent", attachments: [{ name: "brief.pdf", data: "original" }] };
  assert.deepEqual(restoreRejectedDraft(sent, { text: "", attachments: [] }), sent);
  const current = { text: "next", attachments: [{ name: "next.png", data: "new" }] };
  assert.deepEqual(restoreRejectedDraft(sent, current), {
    text: "sent\n\nnext",
    attachments: [...sent.attachments, ...current.attachments],
  });
  assert.equal(current.text, "next");
  assert.equal(sent.attachments.length, 1);
  assert.deepEqual(restoreRejectedDraft({ text: "", attachments: sent.attachments }, current), {
    text: "next",
    attachments: [...sent.attachments, ...current.attachments],
  });
});

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
