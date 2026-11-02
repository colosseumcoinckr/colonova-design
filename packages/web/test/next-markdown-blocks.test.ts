import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-drafts.test.ts 와 같은 모양).
import { textToList } from "../src/next/plans/draft/draft-model.ts";
import {
  blocksFromDom,
  clipboardBlocks,
  type DomLike,
  escapeHref,
  escapeText,
  inlineText,
  insertEdits,
  pipeTable,
  typedShift,
} from "../src/next/plans/draft/markdown-blocks.ts";

/**
 * 직접 고치기의 마크다운 길(2026-11-02 사용자 지시) — 표식 변환 · 파이프 표 · 붙여넣기의 HTML → 투영
 * 방언 변환이 리액트 없이 잡힌다. 이스케이프는 데몬 storage-blocks.ts 의 projectText 와 같은
 * 눈금이다 — 여기서 어긋나면 발행 때 글이 물린다.
 */

// ————— 가짜 DOM — DomLike 의 좁은 구조만 지킨다 —————

const text = (body: string): DomLike => ({
  nodeType: 3,
  nodeName: "#text",
  childNodes: [],
  textContent: body,
  getAttribute: undefined,
});

const el = (
  name: string,
  children: DomLike[] = [],
  attrs: Record<string, string> = {},
): DomLike => ({
  nodeType: 1,
  nodeName: name,
  childNodes: children,
  textContent: null,
  getAttribute: (one: string) => attrs[one] ?? null,
});

test("이스케이프 — 특수 글자는 감싸고 줄바꿈은 한 칸, 주소의 괄호 · 공백은 지켜낸다", () => {
  assert.equal(escapeText("a*b [c] \\e ⟦f⟧"), "a\\*b \\[c\\] \\\\e \\⟦f\\⟧");
  assert.equal(escapeText("백틱 ` 그대로"), "백틱 \\` 그대로");
  assert.equal(escapeText("줄\n바꿈"), "줄 바꿈");
  assert.equal(escapeText("그냥 글"), "그냥 글");
  assert.equal(escapeHref("https://example.com/a (b)"), "https://example.com/a\\ \\(b\\)");
});

test("표식 — 방금 머리에 친 순간만 종류를 바꾼다", () => {
  assert.deepEqual(typedShift("규칙", "- 규칙"), { kind: "list", ordered: false, rest: "규칙" });
  assert.deepEqual(typedShift("규칙", "* 규칙"), { kind: "list", ordered: false, rest: "규칙" });
  assert.deepEqual(typedShift("규칙", "1. 규칙"), { kind: "list", ordered: true, rest: "규칙" });
  assert.deepEqual(typedShift("계획", "### 계획"), { kind: "heading", level: 3, rest: "계획" });
  // 한 글자씩 칠 때 — 표식만 든 중간 상태(`-규칙`)를 지나 ` ` 를 치는 순간에도 걸린다
  // (2026-11-02 실액 검증: 이 갈래가 없으면 기존 문단 앞의 타이핑은 늘 실패했다).
  assert.deepEqual(typedShift("-규칙", "- 규칙"), { kind: "list", ordered: false, rest: "규칙" });
  assert.deepEqual(typedShift("#계획", "# 계획"), { kind: "heading", level: 1, rest: "계획" });
  assert.deepEqual(typedShift("1.규칙", "1. 규칙"), { kind: "list", ordered: true, rest: "규칙" });
  // 빈 문단의 타이핑 — `-` 후 `- `.
  assert.deepEqual(typedShift("", "- "), { kind: "list", ordered: false, rest: "" });
  // 이미 표식으로 시작하던 글을 고치는 때 · 표식 없이 쓰는 때는 그대로다.
  assert.equal(typedShift("- 가", "- 갂"), null);
  assert.equal(typedShift("가", "가나다"), null);
  assert.equal(typedShift("가", "1. 다"), null);
});

test("파이프 표 — 막대 모양을 줄과 칸으로, --- 줄은 머리 칸 표로", () => {
  const rows = pipeTable("| 항목 | 값 |\n| --- | --- |\n| 노쇼 | 3회 |");
  assert.deepEqual(rows, [
    {
      cells: [
        { header: true, text: "항목" },
        { header: true, text: "값" },
      ],
    },
    {
      cells: [
        { header: false, text: "노쇼" },
        { header: false, text: "3회" },
      ],
    },
  ]);
  // 머리 표시가 없으면 모두 몸통 칸이고, 짧은 줄은 빈 칸으로 맞춘다.
  assert.deepEqual(pipeTable("| a | b |\n| c |"), [
    {
      cells: [
        { header: false, text: "a" },
        { header: false, text: "b" },
      ],
    },
    {
      cells: [
        { header: false, text: "c" },
        { header: false, text: "" },
      ],
    },
  ]);
  assert.equal(pipeTable("그냥 문단이다"), null);
  assert.equal(pipeTable("a | b"), null); // 막대로 싸이지 않은 한 줄은 표가 아니다
});

test("목록 편집 칸 — 줄머리 표식을 걷는다(마크다운 목록을 붙여 넣으면 항목으로 선다)", () => {
  assert.deepEqual(textToList("- 가\n* 나\n3. 다"), ["가", "나", "다"]);
  assert.deepEqual(textToList("가\n나"), ["가", "나"]);
});

test("붙여넣기 — 굵게 · 기울임 · 코드 · 링크가 투영 방언으로, 특수 글자는 감싸진다", () => {
  const para = el("p", [
    text("출고는 "),
    el("strong", [text("당일")]),
    text("이고 "),
    el("em", [text("지역")]),
    text("마다 "),
    el("code", [text("zone_id")]),
    text(" 확인 — "),
    el("a", [text("규칙 문서")], { href: "https://example.com/a b" }),
    el("br"),
    text("끝 *별표*"),
  ]);
  assert.equal(
    inlineText(para),
    "출고는 **당일**이고 *지역*마다 `zone_id` 확인 — [규칙 문서](https://example.com/a\\ b)\n끝 \\*별표\\*",
  );
  // 경계 공백은 표지 밖으로 — 데몬 wrapDelims 와 같은 결.
  assert.equal(inlineText(el("strong", [text(" 굵게 ")])), " **굵게** ");
});

test("붙여넣기 — 문단 · 제목 · 목록 · 표로 나누고 중첩 목록은 평평하게", () => {
  const blocks = blocksFromDom(
    el("body", [
      el("h2", [text("세부 규칙")]),
      el("p", [text("노쇼 3회면 "), el("strong", [text("예약 차단")])]),
      el("ul", [
        el("li", [text("첫째"), el("ul", [el("li", [text("속항목")])])]),
        el("li", [text("둘째")]),
      ]),
      el("table", [
        el("tbody", [
          el("tr", [el("th", [text("항목")]), el("th", [text("값")])]),
          el("tr", [el("td", [text("노쇼")]), el("td", [text("3회")])]),
        ]),
      ]),
    ]),
  );
  assert.deepEqual(blocks, [
    { kind: "heading", level: 2, text: "세부 규칙" },
    { kind: "paragraph", text: "노쇼 3회면 **예약 차단**" },
    { kind: "list", ordered: false, items: ["첫째", "속항목", "둘째"] },
    {
      kind: "table",
      rows: [
        {
          cells: [
            { header: true, text: "항목" },
            { header: true, text: "값" },
          ],
        },
        {
          cells: [
            { header: false, text: "노쇼" },
            { header: false, text: "3회" },
          ],
        },
      ],
    },
  ]);
});

test("붙여넣기 — div 로 싸인 문단도 나누고, 묶음 없는 인라인 꾸밈은 흐르는 글에 보탠다", () => {
  const blocks = blocksFromDom(
    el("body", [
      el("div", [el("p", [text("첫째 문단.")]), el("p", [text("둘째 문단.")])]),
      el("span", [text("흐르는 "), el("b", [text("글")])]),
    ]),
  );
  assert.deepEqual(blocks, [
    { kind: "paragraph", text: "첫째 문단." },
    { kind: "paragraph", text: "둘째 문단." },
    { kind: "paragraph", text: "흐르는 **글**" },
  ]);
});

test("여러 블록 걸음 — 같은 닻의 insert 는 역순으로 쌓아 붙은 순서 그대로 선다", () => {
  const edits = insertEdits("b1", [
    { kind: "paragraph", text: "하나" },
    { kind: "paragraph", text: "둘" },
  ]);
  assert.deepEqual(
    edits.map((edit) => (edit.type === "insert" ? edit.view : null)),
    [
      { kind: "paragraph", text: "둘" },
      { kind: "paragraph", text: "하나" },
    ],
  );
  assert.ok(edits.every((edit) => edit.type === "insert" && edit.afterBlockId === "b1"));
});

test("클립보드 — DOMParser 가 없는 자리(시험)는 null, 부른 쪽이 글로 붙인다", () => {
  assert.equal(clipboardBlocks("<p>글</p>"), null);
});

test("배선 — 제자리 고치기 · 고치는 칸 · 표 칸이 같은 길로 쓴다", () => {
  const editor = readFileSync(
    new URL("../src/next/plans/draft/DraftEditor.tsx", import.meta.url),
    "utf8",
  );
  // 제자리 고치기와 고치는 칸이 표식 변환을 부르고, 표 판정은 적용할 때 있다.
  assert.match(editor, /const shift = typedShift\(value, next\);/);
  assert.match(editor, /const shift = typedShift\(draft\.text, next\);/);
  assert.match(editor, /const rows = pipeTable\(value\);/);
  // 붙여넣기 — 세 칸 모두 거치고, 남는 조각은 한 요청에 역순으로 싣는다.
  assert.match(editor, /onPaste=\{onPaste\}/);
  assert.match(editor, /onPaste=\{\(event\) =>\s*onPaste\(event,/);
  assert.match(editor, /insertEdits\(block\.id, extra\)/);
  assert.match(editor, /onApplyEdits=\{pasteEdits\}/);
});
