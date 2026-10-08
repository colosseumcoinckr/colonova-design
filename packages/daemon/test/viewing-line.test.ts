// 보던 화면 꼬리(2026-10-07 베타 준비 분석) — 순수 함수의 시험. src 임포트인 이유는 common-instructions.test.ts 와 같다
// (형제 모듈을 부르지 않아 node 의 타입 지우기로 그대로 읽힌다).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatEvent } from "@colonova-design/protocol";
import { markTurn } from "@colonova-design/protocol";
import { meaningfulFirstLine, turnSubjectOf } from "../src/common-instructions.ts";
import {
  stripReplayedViewing,
  stripViewingLine,
  viewingPathOf,
  withViewingLine,
} from "../src/viewing-line.ts";

const WORDS = "이 화면에서 버튼 크게 해 줘";
const here = { path: "/members" };

test("보던 화면이 있으면 사용자의 말 뒤에 한 줄이 붙는다", () => {
  assert.equal(
    withViewingLine(WORDS, here, false),
    `${WORDS}\n\n[지금 사용자가 보는 화면: /members]`,
  );
});

test("루트 화면도 싣는다 — 사용자의 앱 첫 화면을 보고 있다는 말이다", () => {
  assert.match(withViewingLine(WORDS, { path: "/" }, false), /\[지금 사용자가 보는 화면: \/\]$/);
});

test("쿼리와 해시는 떼고 경로만 싣는다 — 값에 사용자의 것이 섞일 수 있다", () => {
  const line = withViewingLine(WORDS, { path: "/members?token=abc&q=김철수#top" }, false);
  assert.ok(line.endsWith("[지금 사용자가 보는 화면: /members]"));
  assert.ok(!line.includes("token") && !line.includes("김철수") && !line.includes("#top"));
});

test("안 붙는 때 — 보던 화면이 없다 · 경로가 아니다 · 외부 주소 · 공백이 든 값", () => {
  assert.equal(withViewingLine(WORDS, undefined, false), WORDS, "홈에서 보냄");
  for (const path of [
    "",
    "members",
    "//evil.example/x",
    "https://evil.example/x",
    "/a b",
    "/a\nb",
    "/".padEnd(201, "a"),
  ]) {
    assert.equal(withViewingLine(WORDS, { path }, false), WORDS, `경로가 아닌 값: ${path}`);
  }
});

test("핀이 있는 턴에는 붙지 않는다 — 핀이 더 정확하다", () => {
  assert.equal(withViewingLine(WORDS, here, true), WORDS);
});

test("기계가 쓴 턴(표식)에는 붙지 않는다 — 게이트 · 브리프 · 핀 묶음은 제 화면을 말한다", () => {
  const marked = markTurn({ kind: "gate", step: "화면 확인" }, "화면을 고쳐 주세요");
  assert.equal(withViewingLine(marked, here, false), marked);
  const comments = markTurn(
    { kind: "comments", screen: "회원 목록", items: [{ label: "버튼", comment: "크게" }] },
    "버튼을 크게",
  );
  assert.equal(withViewingLine(comments, here, false), comments);
});

test("말이 비었거나 슬래시 명령이면 붙지 않는다 — 꼬리가 제목이 되거나 명령의 인자가 되지 않게", () => {
  assert.equal(withViewingLine("", here, false), "");
  assert.equal(withViewingLine("  \n", here, false), "  \n");
  assert.equal(withViewingLine("/compact", here, false), "/compact");
  assert.equal(withViewingLine("  /review 이 PR", here, false), "  /review 이 PR");
});

test("경로의 대괄호는 퍼센트로 쓴다 — 꼬리의 닫는 괄호와 헷갈리지 않게", () => {
  assert.equal(viewingPathOf({ path: "/members/[id]" }), "/members/%5Bid%5D");
  const composed = withViewingLine(WORDS, { path: "/members/[id]" }, false);
  assert.equal(stripViewingLine(composed), WORDS, "대괄호가 든 경로도 온전히 떼어진다");
});

test("떼기는 붙이기의 역이다 — 첨부 섹션이 뒤따라도 말과 섹션만 남는다", () => {
  const withTail = withViewingLine(WORDS, here, false);
  assert.equal(stripViewingLine(withTail), WORDS);
  const section =
    '<attachment name="logo.png" type="image/png" path="/x/logo.png">저장됐어요</attachment>';
  assert.equal(stripViewingLine(`${withTail}\n\n${section}`), `${WORDS}\n\n${section}`);
  assert.equal(stripViewingLine(WORDS), WORDS, "꼬리가 없으면 그대로");
});

test("꼬리는 제목 파생의 눈에 첫 줄로 서지 않는다 — 말이 있으면 말의 첫 줄이 제목이다", () => {
  const withTail = withViewingLine(WORDS, here, false);
  assert.equal(meaningfulFirstLine(withTail), WORDS);
  assert.deepEqual(turnSubjectOf(withTail), { message: WORDS });
});

test("다시 연 대화의 에코는 꼬리를 뗀다 — 다른 사건과 꼬리 없는 에코는 그대로", () => {
  const events: ChatEvent[] = [
    { kind: "user.echo", text: withViewingLine(WORDS, here, false), images: 0 },
    { kind: "user.echo", text: "꼬리 없는 말", images: 0 },
    { kind: "text.done", blockId: "b", text: "[지금 사용자가 보는 화면: /x]", agentId: null },
  ];
  const stripped = stripReplayedViewing(events);
  assert.equal((stripped[0] as { text: string }).text, WORDS);
  assert.equal(stripped[1], events[1], "바뀌지 않은 사건은 같은 객체다");
  assert.equal(stripped[2], events[2], "AI 의 답은 건드리지 않는다");
});
