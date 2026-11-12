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

test("ghostText: 개발 어휘가 든 AI 제안은 띄우지 않는다 — 사용자 면의 어휘 규칙(2026-11-11 실재현)", () => {
  // 데몬이 전한 제안 본문은 AI 가 지은 말 — labels 의 금칙어가 그대로 통과해 뜨던 구멍.
  assert.equal(ghostText({ ...FREE, suggestion: "커밋해 줘" }), null);
  assert.equal(ghostText({ ...FREE, suggestion: "변경을 브랜치로 나눠 볼까요" }), null);
  assert.equal(ghostText({ ...FREE, suggestion: "git 상태를 확인해 줘" }), null);
  assert.equal(ghostText({ ...FREE, suggestion: "PR 설명을 붙여 줘" }), null);
  // 개발자의 턴이 아닌 말과 github 은 걸리지 않는다 — vocab-sweep 패턴과 같은 경계.
  assert.equal(
    ghostText({ ...FREE, suggestion: "패턴을 한 번 더 확인해 줘" }),
    "패턴을 한 번 더 확인해 줘",
  );
  assert.equal(
    ghostText({ ...FREE, suggestion: "github 페이지를 열어 줘" }),
    "github 페이지를 열어 줘",
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
