import assert from "node:assert/strict";
import { test } from "node:test";
import type { DraftBlockView, DraftTableRow } from "@colonova-design/protocol";
import { L } from "../src/next/labels.ts";
// 순수 모듈 — src 에서 곧장 읽는다(next-plans.test.ts 와 같은 모양).
import {
  blockStatusLabel,
  listToText,
  tableAddColumn,
  tableAddRow,
  tableRemoveColumn,
  tableRemoveRow,
  textToList,
  tokenLegend,
  viewToMarkdown,
} from "../src/next/plans/draft/draft-model.ts";

/**
 * 초안 블록 도우미의 순수 시험(2026-10-23 · 최종 구현 계획 F1) — 읽기 화면의 마크다운, 토큰의 사람 말,
 * 목록 · 표 편집 칸의 왕복이 리액트 없이 잡힌다.
 */

const cell = (text: string, header = false) => ({ header, text });

const row = (...texts: string[]): DraftTableRow => ({
  cells: texts.map((text) => cell(text, false)),
});

const headerRow = (...texts: string[]): DraftTableRow => ({
  cells: texts.map((text) => cell(text, true)),
});

test("읽기 화면의 마크다운 — 제목 · 문단 · 목록 · 표가 각각의 모양으로 선다", () => {
  const tokens: Record<string, string> = {};
  const heading: DraftBlockView = { kind: "heading", level: 3, text: "계획의 바탕" };
  const paragraph: DraftBlockView = { kind: "paragraph", text: "첫 문장이다." };
  const bullets: DraftBlockView = { kind: "list", ordered: false, items: ["가", "나"] };
  const numbers: DraftBlockView = { kind: "list", ordered: true, items: ["가", "나", "다"] };
  const table: DraftBlockView = {
    kind: "table",
    rows: [headerRow("이름", "상태"), row("가", "준비"), row("나\n둘째 줄", "완료")],
  };
  assert.equal(viewToMarkdown(heading, tokens), "### 계획의 바탕");
  assert.equal(viewToMarkdown(paragraph, tokens), "첫 문장이다.");
  assert.equal(viewToMarkdown(bullets, tokens), "- 가\n- 나");
  assert.equal(viewToMarkdown(numbers, tokens), "1. 가\n2. 나\n3. 다");
  assert.equal(
    viewToMarkdown(table, tokens),
    "| 이름 | 상태 |\n| --- | --- |\n| 가 | 준비 |\n| 나 / 둘째 줄 | 완료 |",
  );
});

test("읽기 화면의 마크다운 — 보존 조각은 화면이 따로 그리므로 빈 글이다", () => {
  const preserved: DraftBlockView = { kind: "preserved", label: "macro:info" };
  assert.equal(viewToMarkdown(preserved, { t1: "macro:info" }), "");
});

test("토큰을 사람의 말로 — 혼자 오면 〔이름〕 이 되고 쌍은 안 글만 남는다", () => {
  const single = "앞 ⟦t1⟧ 뒤";
  assert.equal(
    viewToMarkdown({ kind: "paragraph", text: single }, { t1: "macro:info" }),
    "앞 〔정보 상자〕 뒤",
  );
  const pair = "머리 ⟦c1⟧이 블록은 누가 쓴다⟦/c1⟧ 꼬리";
  assert.equal(
    viewToMarkdown({ kind: "paragraph", text: pair }, { c1: "comment-anchor" }),
    "머리 이 블록은 누가 쓴다 꼬리",
  );
  assert.equal(viewToMarkdown({ kind: "paragraph", text: "⟦t9⟧" }, {}), "〔Confluence 요소〕");
});

test("토큰 안내 — 글에 나타난 토큰만, 나타난 순서대로", () => {
  const tokens = { t1: "macro:info", c1: "comment-anchor", t2: "image" };
  const legend = tokenLegend("⟦t2⟧ 가 ⟦c1⟧안⟦/c1⟧ 나 ⟦t1⟧ 다 ⟦t2⟧", tokens);
  assert.deepEqual(
    legend.map((item) => item.name),
    ["t2", "c1", "t1"],
  );
  assert.deepEqual(
    legend.map((item) => item.label),
    ["이미지", "코멘트 닻", "정보 상자"],
  );
  assert.deepEqual(tokenLegend("토큰이 없는 글", tokens), []);
});

test("목록 편집 칸 — 한 줄에 한 항목, 빈 줄은 무시하고 왕복이 같다", () => {
  assert.deepEqual(textToList("가\n\n나\n"), ["가", "나"]);
  assert.deepEqual(textToList("\n  \n"), []);
  assert.equal(listToText(["가", "나"]), "가\n나");
  assert.deepEqual(textToList(listToText(["가", "나", "다"])), ["가", "나", "다"]);
});

test("표 도우미 — 새 행은 칸 수를 맞추고 머리가 아니다", () => {
  const rows = [headerRow("이름", "상태"), row("가", "준비")];
  const added = tableAddRow(rows, 1);
  assert.equal(added.length, 3);
  assert.deepEqual(
    added[1]?.cells.map((c) => [c.header, c.text]),
    [
      [false, ""],
      [false, ""],
    ],
  );
  // 자리를 넘기면 맨 뒤에 붙는다.
  assert.equal(tableAddRow(rows, 9).length, 3);
  assert.equal(tableAddRow([], 0).length, 1);
});

test("표 도우미 — 마지막 행 · 열을 빼고, 하나 남은 것은 남긴다", () => {
  const rows = [headerRow("이름", "상태"), row("가", "준비")];
  const fewer = tableRemoveRow(rows, 1);
  assert.equal(fewer.length, 1);
  assert.deepEqual(
    fewer[0]?.cells.map((c) => c.text),
    ["이름", "상태"],
  );
  assert.deepEqual(tableRemoveRow(rows.slice(0, 1), 0), rows.slice(0, 1));

  const narrow = tableRemoveColumn(rows, 1);
  assert.deepEqual(
    narrow.map((r) => r.cells.map((c) => c.text)),
    [["이름"], ["가"]],
  );
  const one = [headerRow("이름")];
  assert.deepEqual(tableRemoveColumn(one, 0), one);
});

test("표 도우미 — 새 열은 모든 행에 더하고 머리 여부를 따른다", () => {
  const rows = [headerRow("이름", "상태"), row("가", "준비")];
  const wider = tableAddColumn(rows);
  assert.deepEqual(
    wider.map((r) => r.cells.map((c) => [c.header, c.text])),
    [
      [
        [true, "이름"],
        [true, "상태"],
        [true, ""],
      ],
      [
        [false, "가"],
        [false, "준비"],
        [false, ""],
      ],
    ],
  );
  assert.equal(tableAddColumn([]).length, 1);
});

test("처지 배지 — 블록의 처지가 사람의 말로 선다", () => {
  assert.equal(blockStatusLabel("same"), L.drafts.statusSame);
  assert.equal(blockStatusLabel("changed"), L.drafts.statusChanged);
  assert.equal(blockStatusLabel("new"), L.drafts.statusNew);
  assert.equal(blockStatusLabel("conflict"), L.drafts.statusConflict);
});

test("토큰의 사람 말 — 대표 갈래와 매크로 · 모르는 이름", () => {
  const say = L.drafts.tokenLabel;
  assert.equal(say("macro:info"), "정보 상자");
  assert.equal(say("macro:warning"), "경고 상자");
  assert.equal(say("macro:jira"), "지라 연결");
  assert.equal(say("macro:custom-thing"), "custom-thing 매크로");
  assert.equal(say("image"), "이미지");
  assert.equal(say("link:user"), "사람 멘션");
  assert.equal(say("comment-anchor"), "코멘트 닻");
  assert.equal(say("table:merged"), "병합 셀이 있는 표");
  assert.equal(say("heading:complex"), "복잡한 단락");
  assert.equal(say("format:bold"), "글 모양");
  assert.equal(say("element:custom"), "Confluence 요소");
  assert.equal(say("what-is-this"), "Confluence 요소");
});
