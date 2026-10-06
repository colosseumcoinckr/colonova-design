import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-*.test.ts 와 같은 모양).
import {
  caretEdge,
  excerptAround,
  matchRange,
  rank,
  stepWalk,
} from "../src/components/shell/palette-match.ts";

test("rank: 글자 그대로 맞은 접두가 중간보다 앞서고, 흩어진 글자는 맨 뒤다", () => {
  assert.equal(rank("결제", "결제 화면"), 1);
  assert.equal(rank("결제", "주문 결제 내역"), 2);
  assert.equal(rank("결제", "결ㅌㅔ가 흩어진 줄"), -1);
  assert.equal(rank("abc", "a-b-c"), 5);
  assert.equal(rank("", "아무 줄"), 0);
  assert.equal(rank("  ", "아무 줄"), 0);
  assert.equal(rank("결제", "결제"), 1);
});

test("rank: 대소문자와 앞뒤 공백은 묻지 않는다", () => {
  assert.equal(rank("Set", "settings"), 1);
  assert.equal(rank(" 설정 ", "설정"), 1);
});

test("rank: 한글을 치는 동안 — 조합 중인 글자가 맞는 줄을 지우지 않는다", () => {
  // `결제` 를 치는 순서: ㄱ → 겨 → 결 → 결ㅈ → 결제. 어느 단계에서도 목록이 비면 안 된다.
  for (const typed of ["ㄱ", "겨", "결", "결ㅈ", "결제"]) {
    assert.ok(rank(typed, "결제 내역 표를 월별로 묶어 줘") > 0, `「${typed}」`);
    assert.ok(rank(typed, "주문 결제 내역") > 0, `「${typed}」 중간`);
  }
  assert.equal(rank("결ㅈ", "결제 화면"), 3, "글자 그대로는 아니지만 처음부터 맞는다");
  assert.equal(rank("결ㅈ", "주문 결제 내역"), 4);
  // 앞서 끝난 글자는 글자 그대로만 맞는다 — 조합 중인 것은 마지막 글자뿐이다.
  assert.equal(rank("결제", "겨제"), -1);
  assert.equal(rank("겨ㅈ", "결제"), -1);
});

test("rank: 모음이 자라고 받침이 붙고 넘어가는 순간까지 센다", () => {
  // 겹모음 — ㅇ → 오 → 와
  for (const typed of ["ㅇ", "오", "와"]) assert.ok(rank(typed, "와이어프레임") > 0, typed);
  assert.equal(rank("우", "위젯 목록"), 3, "ㅜ → ㅟ");
  assert.equal(rank("으", "의견 목록"), 3, "ㅡ → ㅢ");
  // 겹받침 — 갑 → 값
  assert.equal(rank("갑", "값 입력"), 3);
  assert.equal(rank("달", "닭 요리"), 3, "ㄹ → ㄺ");
  // 받침이 다음 글자의 초성으로 넘어간다 — 한 → 하나
  assert.equal(rank("한", "하나씩 보기"), 3);
  assert.equal(rank("한", "하루 보기"), -1, "넘어간 초성이 다르면 맞지 않는다");
  assert.equal(rank("닭", "달가운 소식"), 3, "겹받침의 둘째가 넘어간다");
  assert.equal(rank("전", "저녁 모임"), 3);
  // 끝난 글자에 받침을 더해 억지로 맞추지는 않는다 — 앞 글자는 그대로다.
  assert.equal(rank("전녁", "저녁"), -1);
});

test("rank: 홀로 선 자음은 초성이고 띄어쓰기는 묻지 않는다", () => {
  assert.equal(rank("ㄱㅈ", "결제 화면"), 3);
  assert.equal(rank("ㄱㅈ", "주문 결제"), 4);
  assert.equal(rank("ㄱㅈㄴㅇ", "결제 내역"), 3);
  assert.equal(rank("ㅅㅈ", "설정"), 3);
  assert.equal(rank("ㄱㅈ", "회원 목록"), -1);
  assert.equal(rank("결제내역", "결제 내역"), 3, "붙여 써도 맞는다");
  assert.equal(rank("ㄱ", "abc 결제"), 4);
  // 흩어져 맞는 초성도 맨 뒤 차례로 맞는다.
  assert.equal(rank("ㄱㅈ", "결과물 확인 제출"), 5);
});

test("rank: 영문과 섞어도 맞는다", () => {
  assert.equal(rank("ab결ㅈ", "ab결제"), 3);
  assert.equal(rank("api", "API 연결"), 1);
  assert.equal(rank("ㄱㅈ", "API 결제"), 4);
  assert.equal(rank("ㅏ", "아이"), -1, "홀로 선 모음은 글자 그대로만 맞는다");
});

test("matchRange: 이어진 덩이의 자리를 준다", () => {
  assert.deepEqual(matchRange("결제", "결제 화면"), [0, 2]);
  assert.deepEqual(matchRange("결제", "주문 결제 내역"), [3, 5]);
  assert.deepEqual(matchRange("SET", "Settings"), [0, 3]);
});

test("matchRange: 한글 규칙으로 맞아도 글자 경계로 끊는다", () => {
  assert.deepEqual(matchRange("결ㅈ", "주문 결제 내역"), [3, 5], "조합 중");
  assert.deepEqual(matchRange("ㄱㅈ", "결제 화면"), [0, 2], "초성");
  assert.deepEqual(matchRange("ㄱㅈㄴㅇ", "결제 내역"), [0, 5], "띄어쓰기를 넘어 한 덩이");
  assert.deepEqual(matchRange("한", "새 하나씩"), [2, 4], "받침이 넘어간 두 글자를 함께");
});

test("matchRange: 흩어져 맞거나 비었으면 하이라이트가 없다", () => {
  assert.equal(matchRange("ac", "a-b-c"), null);
  assert.equal(matchRange("", "결제"), null);
  assert.equal(matchRange("없는말", "결제"), null);
  assert.equal(matchRange("ㄱㅈ", "결과물 확인 제출"), null);
});

test("matchRange: 긴 글(대화 내용)에서는 가운데의 홀로 선 자음을 초성으로 읽지 않는다", () => {
  const line = "오늘 회의에서 결제 흐름을 다시 보기로 했어요";
  assert.deepEqual(matchRange("ㄱㅈ", line), [8, 10], "제목 규칙은 초성으로 읽는다");
  assert.equal(matchRange("ㄱㅈ", line, { initials: false }), null, "긴 글에는 소음이다");
  // 조합 중인 마지막 글자는 그대로 센다 — 한글을 치는 동안 내용 줄이 깜빡이지 않는다.
  assert.deepEqual(matchRange("결ㅈ", line, { initials: false }), [8, 10]);
  assert.deepEqual(matchRange("결제", line, { initials: false }), [8, 10]);
});

test("excerptAround: 맞은 자리가 보이는 조각으로 자르고 자리를 옮긴다", () => {
  const text = `${"가".repeat(40)}결제${"나".repeat(40)}`;
  const out = excerptAround(text, [40, 42], 10, 8);
  assert.equal(out.text, `…${"가".repeat(10)}결제${"나".repeat(8)}…`);
  assert.deepEqual(out.range, [11, 13]);
  assert.equal(out.text.slice(out.range?.[0], out.range?.[1]), "결제");
  // 앞이 짧으면 앞의 말줄임이 없고 자리도 그대로다.
  const head = excerptAround("결제 내역", [0, 2], 10, 8);
  assert.equal(head.text, "결제 내역");
  assert.deepEqual(head.range, [0, 2]);
  // 맞은 자리를 모르면 앞에서부터 자른다.
  assert.equal(excerptAround("가".repeat(100), null, 10, 10).text, `${"가".repeat(20)}…`);
  assert.equal(excerptAround("짧은 글", null).text, "짧은 글");
});

test("caretEdge: 커서가 처음 · 끝에 있는지, 고른 글이 있으면 어느 쪽도 아니다", () => {
  assert.deepEqual(caretEdge("", 0, 0), { start: true, end: true });
  assert.deepEqual(caretEdge("결제", 2, 2), { start: false, end: true });
  assert.deepEqual(caretEdge("결제", 0, 0), { start: true, end: false });
  assert.deepEqual(caretEdge("결제", 1, 1), { start: false, end: false });
  assert.deepEqual(caretEdge("결제", 0, 2), { start: false, end: false });
  assert.deepEqual(caretEdge("결제", null, null), { start: true, end: false });
});

// 줄 3개 · 칩 2개 — 걸음은 0..4 한 줄이고, 3 부터가 칩이다.
test("stepWalk: ↑↓ 는 줄에서 칩까지 한 줄로 걷고, 끝에서는 머문다", () => {
  assert.equal(stepWalk("ArrowDown", 0, 3, 2), 1);
  assert.equal(stepWalk("ArrowDown", 2, 3, 2), 3, "마지막 줄 다음은 첫 칩");
  assert.equal(stepWalk("ArrowDown", 4, 3, 2), 4, "끝에서는 머문다");
  assert.equal(stepWalk("ArrowUp", 3, 3, 2), 2, "첫 칩에서 위는 마지막 줄");
  assert.equal(stepWalk("ArrowUp", 0, 3, 2), 0, "처음에서는 머문다");
});

test("stepWalk: ←/→ 는 칩 위에서만 걷고, 옮길 곳이 없으면 커서에 돌려준다", () => {
  assert.equal(stepWalk("ArrowRight", 3, 3, 2), 4);
  assert.equal(stepWalk("ArrowLeft", 4, 3, 2), 3);
  assert.equal(stepWalk("ArrowRight", 4, 3, 2), null, "마지막 칩 — 입력칸의 커서가 쓴다");
  assert.equal(stepWalk("ArrowLeft", 3, 3, 2), null, "첫 칩에서 줄로 넘어가지 않는다");
  assert.equal(stepWalk("ArrowRight", 1, 3, 2), null, "줄 위 — 입력칸의 커서가 쓴다");
  assert.equal(stepWalk("ArrowLeft", 1, 3, 2), null);
});

test("stepWalk: 줄이 없고 칩만 있어도 걷는다 — 「홈」만 맞는 검색", () => {
  assert.equal(stepWalk("ArrowDown", 0, 0, 3), 1);
  assert.equal(stepWalk("ArrowRight", 0, 0, 3), 1);
  assert.equal(stepWalk("ArrowLeft", 0, 0, 3), null);
  assert.equal(stepWalk("ArrowUp", 0, 0, 3), 0);
});

test("stepWalk: 걸을 것이 하나도 없어도 ↑↓ 는 죽지 않고, 다른 키는 가져가지 않는다", () => {
  assert.equal(stepWalk("ArrowDown", 0, 0, 0), 0);
  assert.equal(stepWalk("ArrowUp", 0, 0, 0), 0);
  assert.equal(stepWalk("ArrowRight", 0, 0, 0), null);
  assert.equal(stepWalk("Enter", 1, 3, 2), null);
  assert.equal(stepWalk("a", 1, 3, 2), null);
});

test("stepWalk: 아직 고른 곳이 없을 때(-1) 첫 화살표가 맨 앞을 짚는다", () => {
  assert.equal(stepWalk("ArrowDown", -1, 0, 3), 0);
  assert.equal(stepWalk("ArrowUp", -1, 0, 3), 0);
  assert.equal(stepWalk("End", -1, 0, 3), 2);
  assert.equal(stepWalk("Home", -1, 0, 3), 0);
});

test("stepWalk: Home/End 는 커서가 그 가장자리에 설 때만 걷고, 아니면 입력칸의 커서가 쓴다", () => {
  const start = { start: true, end: false };
  const end = { start: false, end: true };
  const middle = { start: false, end: false };
  assert.equal(stepWalk("End", 0, 3, 2, end), 4, "글 끝의 End 는 마지막으로");
  assert.equal(stepWalk("Home", 3, 3, 2, start), 0, "글 처음의 Home 은 맨 앞으로");
  assert.equal(stepWalk("End", 0, 3, 2, middle), null, "글 가운데의 End 는 커서가 쓴다");
  assert.equal(stepWalk("Home", 3, 3, 2, middle), null, "글 가운데의 Home 도 커서가 쓴다");
  assert.equal(stepWalk("End", 0, 3, 2, start), null, "글 처음에서 End 는 커서를 끝으로 보낸다");
  assert.equal(stepWalk("Home", 3, 3, 2, end), null, "글 끝에서 Home 은 커서를 처음으로 보낸다");
});

test("stepWalk: Home/End 가 이미 그 자리면 커서에 돌려주고, 아무것도 없으면 가져가지 않는다", () => {
  assert.equal(stepWalk("Home", 0, 3, 2), null);
  assert.equal(stepWalk("End", 4, 3, 2), null);
  assert.equal(stepWalk("Home", 2, 3, 2), 0, "가장자리 정보가 없으면 걷는다");
  assert.equal(stepWalk("End", 0, 0, 0), null);
  assert.equal(stepWalk("Home", 0, 0, 0), null);
});
