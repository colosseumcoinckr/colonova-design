import assert from "node:assert/strict";
import { test } from "node:test";
import {
  anchorCount,
  commentIsPlain,
  commentStorage,
  commentText,
  decodeEntities,
  mentionIds,
} from "../dist/comment-text.js";

/**
 * 코멘트의 글 변환 시험(2026-10-23 · 작업 E2) — 엔티티 · 저장 포맷 · 맨 글 · 멘션 · 닻 세기의
 * 순수 시험이다. 원격은 두드리지 않고 합성 문장만 쓴다(comment-text.ts 의 계약 그대로).
 */

test("엔티티 풀기 — 이름 · 십진 · 십육진을 풀고 모르는 이름은 그대로 둔다", () => {
  assert.equal(decodeEntities("a &amp; b"), "a & b");
  assert.equal(decodeEntities("&lt;태그&gt; &quot;따옴표&quot;"), '<태그> "따옴표"');
  assert.equal(decodeEntities("&#39;"), "'");
  assert.equal(decodeEntities("&#x2192;"), "→");
  assert.equal(decodeEntities("줄바꿈&nbsp;없이"), "줄바꿈\u00a0없이");
  assert.equal(decodeEntities("&notanentity; & 유령;"), "&notanentity; & 유령;");
});

test("엔티티 풀기 — Latin-1 이름 전부와 흔한 기호를 풀고 숫자로 끝나는 이름도 만난다", () => {
  // Confluence 가 저장하며 돌려주는 꼴 — 저장 포맷의 글 대조가 같은 글로 보여야 한다.
  assert.equal(decodeEntities("&frac12;개 &plusmn;2 &deg;C"), "½개 ±2 °C");
  assert.equal(decodeEntities("&Auml;&ouml;&szlig; &copy; &reg;"), "Äöß © ®");
  assert.equal(decodeEntities("&agrave;&eacute;&iacute;&ograve;&uacute;&yuml;"), "àéíòúÿ");
  assert.equal(decodeEntities("&sup1;&sup2;&sup3; &frac14;&frac34;"), "¹²³ ¼¾");
  assert.equal(decodeEntities("&trade; &hellip; &bull; &prime; &Prime;"), "™ … • ′ ″");
  assert.equal(decodeEntities("&lsaquo;&rsaquo; &sbquo; &bdquo; &dagger; &Dagger;"), "‹› ‚ „ † ‡");
  assert.equal(
    decodeEntities("&permil; &euro; &minus; &le; &ge; &ne; &asymp; &infin;"),
    "‰ € − ≤ ≥ ≠ ≈ ∞",
  );
  assert.equal(decodeEntities("&larr;&uarr;&darr;&harr; &lArr;&rArr;&hArr;"), "←↑↓↔ ⇐⇒⇔");
  // 큰걸음 표지는 이름을 가린다 — 소리는 같아도 다른 이름이다.
  assert.equal(decodeEntities("&thorn;"), "þ");
  assert.equal(decodeEntities("&ETH;"), "Ð");
});

test("맨 글 → 저장 포맷 — 줄마다 문단이고 꺾쇠는 이스케이프다", () => {
  assert.equal(commentStorage("한 줄"), "<p>한 줄</p>");
  assert.equal(commentStorage("첫 줄\n둘째 줄"), "<p>첫 줄</p><p>둘째 줄</p>");
  assert.equal(commentStorage("위\n\n아래"), "<p>위</p><p></p><p>아래</p>");
  assert.equal(commentStorage("a&b<c>d"), "<p>a&amp;b&lt;c&gt;d</p>");
});

test("멘션의 계정 id — 같은 id 는 하나로 센다", () => {
  const twice =
    '<p><ac:link><ri:user ri:account-id="a1"/></ac:link> 와 <ac:link><ri:user ri:account-id="a1"/></ac:link></p>';
  assert.deepEqual(mentionIds(twice), ["a1"]);
  assert.deepEqual(mentionIds("<p>멘션 없는 문단</p>"), []);
});

test("저장 포맷 → 맨 글 — 문단 · 줄바꿈 · 목록 항목은 줄이다", () => {
  assert.equal(commentText("<p>첫 문단</p><p>둘 문단</p>"), "첫 문단\n둘 문단");
  assert.equal(commentText("<p>앞<br/>뒤</p>"), "앞\n뒤");
  assert.equal(commentText("<ul><li>하나</li><li>둘</li></ul>"), "- 하나\n- 둘");
});

test("멘션 — 아는 id 는 @이름 으로, 모르면 @ 만 남긴다", () => {
  const storage = '<p><ac:link><ri:user ri:account-id="a1"/></ac:link> 확인 바란다</p>';
  assert.equal(commentText(storage, new Map([["a1", "합성이"]])), "@합성이 확인 바란다");
  assert.equal(commentText(storage), "@ 확인 바란다");
});

test("CDATA 속의 꺾쇠는 태그가 아니고, 엔티티는 풀린다", () => {
  assert.equal(commentText("<p><![CDATA[<srv:표식> 속 글]]></p>"), "<srv:표식> 속 글");
  assert.equal(commentText("<p>조건 &amp; 결과</p>"), "조건 & 결과");
});

test("끝의 공백 · 줄바꿈은 깎고, 셋 줄 넘는 빈 줄은 둘로 줄인다", () => {
  assert.equal(commentText("<p>끝에 공백 </p>"), "끝에 공백");
  assert.equal(commentText("<p>위</p><p></p><p></p><p></p><p>아래</p>"), "위\n\n아래");
});

test("빈 줄 없는 여러 줄 글은 저장 포맷을 왕복해도 그대로다", () => {
  const text = "첫 줄\n둘째 줄\n셋째 줄";
  assert.equal(commentText(commentStorage(text)), text);
});

test("맨 글인가 — 문단 · 빈 문단 · 줄바꿈 · 글은 그렇고 서식 · 링크 · 멘션 · CDATA 는 아니다", () => {
  assert.equal(commentIsPlain("<p>a</p><p>b</p>"), true);
  assert.equal(commentIsPlain('<p local-id="x">a</p>'), true);
  assert.equal(commentIsPlain("<p />"), true);
  assert.equal(commentIsPlain("<br/>"), true);
  assert.equal(commentIsPlain("<p><strong>굵게</strong></p>"), false);
  assert.equal(commentIsPlain('<p><a href="https://example.invalid">링크</a></p>'), false);
  assert.equal(commentIsPlain('<p><ac:link><ri:user ri:account-id="a1"/></ac:link></p>'), false);
  assert.equal(commentIsPlain('<p><ac:emoticon ac:name="smile"/></p>'), false);
  assert.equal(commentIsPlain("<p><![CDATA[글]]></p>"), false);
});

test("닻의 수 — 한 번 · 두 번은 세고, 두 문단에 걸친 일치는 세지 않는다", () => {
  assert.equal(anchorCount("<p>유일한 합성 문장</p>", "유일한 합성 문장"), 1);
  assert.equal(anchorCount("<p>a b a b</p>", "a b"), 2);
  assert.equal(anchorCount("<p>가나</p><p>다라</p>", "나다"), 0);
});

test("닻의 수 — 공백의 꼴과 엔티티가 달라도 같은 문장이다", () => {
  assert.equal(anchorCount("<p>줄이\n  바뀐&nbsp;문장이다</p>", "줄이 바뀐 문장이다"), 1);
  assert.equal(anchorCount("<p>조건 &amp; 결과</p>", "조건 & 결과"), 1);
});

test("닻의 수 — 표 칸을 건너는 선택은 없는 것이고, 빈 선택은 영이다", () => {
  const table = "<table><tr><td>첫칸</td><td>둘칸</td></tr></table>";
  assert.equal(anchorCount(table, "첫칸둘칸"), 0);
  assert.equal(anchorCount(table, "첫칸"), 1);
  assert.equal(anchorCount("<p>글</p>", ""), 0);
  assert.equal(anchorCount("<p>글</p>", "   "), 0);
});
