import assert from "node:assert/strict";
import { test } from "node:test";
import { type GhostInput, ghostText, isAcceptKey } from "../src/next/lib/next-say.ts";

const FREE: GhostInput = {
  suggestion: "버튼 색을 더 진하게 바꿔 줘",
  text: "",
  attachments: 0,
  pins: 0,
  running: false,
  locked: false,
  dismissed: null,
};

test("ghostText: 비어 있고 한가한 입력창에는 제안이 뜬다 — 앞뒤 빈칸은 걷는다", () => {
  assert.equal(ghostText(FREE), "버튼 색을 더 진하게 바꿔 줘");
  assert.equal(ghostText({ ...FREE, suggestion: "  좋아요, 계속해 줘\n" }), "좋아요, 계속해 줘");
});

test("ghostText: 제안이 없거나 빈 말이면 아무것도 띄우지 않는다", () => {
  assert.equal(ghostText({ ...FREE, suggestion: null }), null);
  assert.equal(ghostText({ ...FREE, suggestion: undefined }), null);
  assert.equal(ghostText({ ...FREE, suggestion: "  \n " }), null);
});

test("ghostText: 글이 한 글자라도 있으면 물러난다 — 빈칸 하나도 마찬가지(옅은 글자는 빈 칸에서만 보인다)", () => {
  assert.equal(ghostText({ ...FREE, text: "a" }), null);
  assert.equal(ghostText({ ...FREE, text: " " }), null);
});

test("ghostText: 첨부 · 핀이 담겼거나, 일하는 중이거나, 잠겼으면 띄우지 않는다", () => {
  assert.equal(ghostText({ ...FREE, attachments: 1 }), null);
  assert.equal(ghostText({ ...FREE, pins: 2 }), null);
  assert.equal(ghostText({ ...FREE, running: true }), null);
  assert.equal(ghostText({ ...FREE, locked: true }), null);
});

test("ghostText: 숨기거나 보낸 제안은 다시 뜨지 않고, 새 제안은 다시 뜬다", () => {
  assert.equal(ghostText({ ...FREE, dismissed: "버튼 색을 더 진하게 바꿔 줘" }), null);
  // 비교는 다듬은 말로 — 데몬이 빈칸을 얹어 보내도 같은 말이다.
  assert.equal(
    ghostText({
      ...FREE,
      suggestion: " 버튼 색을 더 진하게 바꿔 줘 ",
      dismissed: "버튼 색을 더 진하게 바꿔 줘",
    }),
    null,
  );
  assert.equal(
    ghostText({ ...FREE, suggestion: "이제 제출해 줘", dismissed: "버튼 색을 더 진하게 바꿔 줘" }),
    "이제 제출해 줘",
  );
});

test("isAcceptKey: 수정키 없는 Tab 만 받는다 — ⇧Tab · ⌥Tab · ⌃Tab · ⌘Tab · 다른 키는 지나간다", () => {
  const none = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
  assert.equal(isAcceptKey({ key: "Tab", ...none }), true);
  assert.equal(isAcceptKey({ key: "Tab", ...none, shiftKey: true }), false);
  assert.equal(isAcceptKey({ key: "Tab", ...none, altKey: true }), false);
  assert.equal(isAcceptKey({ key: "Tab", ...none, ctrlKey: true }), false);
  assert.equal(isAcceptKey({ key: "Tab", ...none, metaKey: true }), false);
  assert.equal(isAcceptKey({ key: "Enter", ...none }), false);
  assert.equal(isAcceptKey({ key: "ArrowRight", ...none }), false);
});
