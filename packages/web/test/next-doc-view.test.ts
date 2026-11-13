import assert from "node:assert/strict";
import { test } from "node:test";
import type { DocBlock } from "@colonova-design/protocol";
import { L } from "../src/next/labels.ts";
// 순수 모듈 — src 에서 곧장 읽는다(next-doc-actions.test.ts 와 같은 모양).
import {
  attachmentKey,
  bodyOnlyHits,
  docInlineText,
  fencedCode,
  highlightParts,
  isImageType,
  labelProblem,
  labelResultLine,
  tocDepths,
  unknownMacros,
} from "../src/next/plans/view/doc-view-model.ts";

/** 기획서 보기의 순수 판정(2026-10-30 사용자 요청 — Confluence 기능 확장). */

const VIEW: DocBlock[] = [
  { t: "toc", entries: [] },
  {
    t: "panel",
    tone: "info",
    title: null,
    blocks: [{ t: "p", children: [{ t: "macro", name: "jira" }] }],
  },
  {
    t: "table",
    rows: [{ cells: [{ header: false, blocks: [{ t: "macro", name: "roadmap" }] }] }],
  },
  { t: "macro", name: "jira" },
  { t: "macro", name: "" },
];

test("그리지 못한 매크로 — 상자 · 표 속까지, 같은 이름은 한 번, 끊김 표시는 빼다", () => {
  assert.deepEqual(unknownMacros(VIEW).sort(), ["jira", "roadmap"]);
  assert.deepEqual(unknownMacros([{ t: "hr" }]), []);
});

test("목차의 들여쓰기는 가장 얕은 제목을 0 으로 센다", () => {
  assert.deepEqual(
    tocDepths([{ level: 2 }, { level: 3 }, { level: 2 }, { level: 4 }]),
    [0, 1, 0, 2],
  );
  assert.deepEqual(tocDepths([]), []);
});

test("그림 종류 — svg 는 그리지 않는다(글자 속 스크립트를 들이지 않는다)", () => {
  assert.ok(isImageType("image/png"));
  assert.ok(isImageType("image/JPEG"));
  assert.ok(!isImageType("image/svg+xml"));
  assert.ok(!isImageType("application/pdf"));
});

test("그림의 문장 — 크게 보기 단추와 겹판 제목은 사전에 있다(2026-11-03 그림 개선)", () => {
  assert.ok(L.confluence.imageZoom.length > 0);
  assert.ok(L.confluence.imageAlt.length > 0);
});

test("첨부 기억 열쇠는 NFC 로 맞춘다", () => {
  assert.equal(attachmentKey("1", "흐름도.png".normalize("NFD")), attachmentKey("1", "흐름도.png"));
  assert.notEqual(attachmentKey("1", "a.png"), attachmentKey("2", "a.png"));
});

test("라벨 이름 — 데몬과 같은 규칙에 이미 있는 라벨을 더한다", () => {
  assert.equal(labelProblem("정책", []), null);
  assert.equal(labelProblem("  ", []), "empty");
  assert.equal(labelProblem("두 단어", []), "invalid-char");
  assert.equal(labelProblem("Policy", ["policy"]), "duplicate");
  // 모든 문제에는 사람의 말이 있다.
  for (const reason of ["empty", "too-long", "invalid-char", "duplicate"] as const) {
    assert.ok(L.confluence.labelProblem[reason].length > 0);
  }
});

test("라벨 결과의 한 줄 — 적용됨은 없고, 모름은 다시 보내지 않는다고, 이유는 사전에서", () => {
  assert.equal(labelResultLine({ state: "applied", detail: "" }), null);
  assert.equal(labelResultLine({ state: "unknown", detail: "" }), L.confluence.labelUnknown);
  assert.equal(
    labelResultLine({ state: "failed", detail: "publish-disabled" }),
    L.confluence.labelReason["publish-disabled"],
  );
  assert.equal(labelResultLine({ state: "failed", detail: "모르는 말" }), L.confluence.labelFailed);
});

test("본문 찾기 — 제목 찾기가 보인 문서는 빼고, 미리 보기 글은 맞은 조각을 강조한다", () => {
  const hits = [
    { pageId: "1", title: "가", snippet: "…" },
    { pageId: "2", title: "나", snippet: "…" },
  ];
  assert.deepEqual(
    bodyOnlyHits(hits, new Set(["1"])).map((hit) => hit.pageId),
    ["2"],
  );
  assert.deepEqual(highlightParts("노쇼 정책은 노쇼를 센다", "노쇼"), [
    { text: "노쇼", hit: true },
    { text: " 정책은 ", hit: false },
    { text: "노쇼", hit: true },
    { text: "를 센다", hit: false },
  ]);
  assert.deepEqual(highlightParts("abc", ""), [{ text: "abc", hit: false }]);
});

test("울타리 코드 — 몸의 역따옴표보다 길게, 언어 이름은 안전한 글자만", () => {
  assert.equal(fencedCode("a", "json"), "```json\na\n```");
  assert.equal(fencedCode("x ```` y", null), "`````\nx ```` y\n`````");
  assert.equal(fencedCode("a", "js<script>"), "```jsscript\na\n```");
});

test("조각의 맨 글 — 상태 · 멘션 · 링크 안까지", () => {
  assert.equal(
    docInlineText([
      { t: "text", text: "담당 " },
      { t: "mention", name: "김기획" },
      { t: "text", text: " " },
      { t: "status", text: "완료", color: "green", subtle: false },
      { t: "link", href: "https://x", children: [{ t: "text", text: " 링크" }] },
    ]),
    "담당 @김기획 완료 링크",
  );
});

test("크기 · 판 기록 · 상자 이름의 문장", () => {
  assert.equal(L.confluence.size(512), "512B");
  assert.equal(L.confluence.size(2048), "2KB");
  assert.equal(L.confluence.size(3 * 1024 * 1024), "3.0MB");
  assert.equal(L.confluence.historyBy("", "어제"), "어제");
  assert.equal(L.confluence.panelTone("warning"), "주의");
  assert.equal(L.confluence.panelTone("모름"), "상자");
});
