import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(turn-screens.test.ts 와 같은 모양).
import { hasLeadSentence, LEAD_MAX_CHARS } from "../src/next/lib/answer-lead.ts";

test("hasLeadSentence: 짧은 첫 문단 뒤에 더 할 말이 있을 때만 머리 문장이다", () => {
  assert.equal(
    hasLeadSentence("회원 목록에 **검색창**을 넣었어요.\n\n## 바뀐 점\n\n- 머리 오른쪽에 생겼어요"),
    true,
  );
  assert.equal(hasLeadSentence("다른 화면과 같은 말투로 맞췄어요.\n\n바뀐 문장은 셋이에요."), true);
  // 한 줄짜리 답 — 키울 이유가 없다.
  assert.equal(hasLeadSentence("알겠어요. 지금 모습 그대로 둘게요."), false);
  assert.equal(hasLeadSentence(""), false);
  assert.equal(hasLeadSentence("   \n\n  "), false);
});

test("hasLeadSentence: 첫 문단이 길면 본문의 하나다", () => {
  const long = "가".repeat(LEAD_MAX_CHARS + 1);
  assert.equal(hasLeadSentence(`${long}\n\n줄일 수 있는 방법은 두 가지예요.`), false);
  const exact = "가".repeat(LEAD_MAX_CHARS);
  assert.equal(hasLeadSentence(`${exact}\n\n뒤의 말.`), true);
  // 꾸밈과 링크 주소는 길이에 세지 않는다.
  const dressed = `**${"가".repeat(80)}** [열기](http://127.0.0.1:5274/member/list)`;
  assert.equal(hasLeadSentence(`${dressed}\n\n뒤의 말.`), true);
});

test("hasLeadSentence: 머리 · 목록 · 인용 · 표 · 코드 · 표식으로 시작하면 문단이 아니다", () => {
  for (const first of [
    "## 바뀐 점",
    "- 첫 항목",
    "1. 첫 단계",
    "> 참고",
    "| 화면 | 바뀐 곳 |",
    "```",
    "![그림](x.png)",
    "<!-- colonova-design:brief -->",
    "---",
  ]) {
    assert.equal(hasLeadSentence(`${first}\n\n뒤의 말.`), false, first);
  }
  // 아래 줄이 `---` 인 문단은 머리(setext)다.
  assert.equal(hasLeadSentence("검색창을 넣었어요\n---\n\n뒤의 말."), false);
});

test("hasLeadSentence: 흐르는 중에는 빈 줄 뒤 글이 올라온 순간부터다", () => {
  assert.equal(hasLeadSentence("회원 목록에 검색창을 넣었"), false);
  assert.equal(hasLeadSentence("회원 목록에 검색창을 넣었어요.\n"), false);
  assert.equal(hasLeadSentence("회원 목록에 검색창을 넣었어요.\n\n"), false);
  assert.equal(hasLeadSentence("회원 목록에 검색창을 넣었어요.\n\n##"), true);
  // CRLF 로 와도 같다.
  assert.equal(hasLeadSentence("회원 목록에 검색창을 넣었어요.\r\n\r\n## 바뀐 점"), true);
});
