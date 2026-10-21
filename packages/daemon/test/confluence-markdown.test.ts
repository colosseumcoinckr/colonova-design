import assert from "node:assert/strict";
import { test } from "node:test";
import { type ConfluenceMeta, deriveMarkdown } from "../dist/confluence-markdown.js";

/**
 * 저장 포맷 → 파생 마크다운 (2026-10-18 기획서 동기화 · 계획 항목 8) — 표 · 목록 ·
 * 제목 왕복과 매크로 절 판정, 첨부 자리 표시, 머리말 이스케이프를 못 박는 순수 시험이다.
 * 프로세스도 네트워크도 띄우지 않는다.
 */

const META: ConfluenceMeta = {
  pageId: "1818591273",
  space: "~63dcb628491b20ef64b9cd71",
  title: "콜로노바 데이터 모델",
  version: 1,
  updatedAt: "2026-06-16T01:32:32Z",
};

/** 머리말 닫기와 그 뒤 빈 줄 다음의 몸 — 끝의 줄바꿈 한 칸은 뗀다.
 *  몸에 `---` 줄이 또 와도 첫 닫기만 건드린다. */
const bodyOf = (markdown: string): string => markdown.slice(markdown.indexOf("\n---\n") + 6, -1);

test("빈 문서 — 머리말만 나가고 앱은 멈추지 않는다", () => {
  const derived = deriveMarkdown("", META);
  assert.equal(
    derived.markdown,
    [
      "---",
      "confluence:",
      '  pageId: "1818591273"',
      '  space: "~63dcb628491b20ef64b9cd71"',
      '  title: "콜로노바 데이터 모델"',
      "  version: 1",
      '  updatedAt: "2026-06-16T01:32:32Z"',
      "---",
      "",
    ].join("\n"),
  );
  assert.deepEqual(derived.sections, []);
  // 빈칫글만 든 저장 포맷도 빈 몸이다.
  assert.equal(bodyOf(deriveMarkdown("  \n", META).markdown), "");
});

test("머리말 — 없는 키는 만들지 않고 version 은 따옴표 없는 숫자로 나간다", () => {
  const derived = deriveMarkdown("", { ...META, space: null, updatedAt: null });
  assert.deepEqual(derived.markdown.split("\n"), [
    "---",
    "confluence:",
    '  pageId: "1818591273"',
    '  title: "콜로노바 데이터 모델"',
    "  version: 1",
    "---",
    "",
  ]);
  // stage 인수가 없으면 stage 키도 없다.
  assert.ok(!derived.markdown.includes("stage:"));
});

test("머리말 — stage 인수가 있으면 이중따옴표 문자열로 더해진다", () => {
  const derived = deriveMarkdown("", META, "0.8");
  assert.deepEqual(derived.markdown.split("\n").slice(-3), ['stage: "0.8"', "---", ""]);
});

test("머리말 — 특수문자 제목은 이중따옴표 안에서 안전하게 감긴다", () => {
  // `:` · `#` · `"` · 줄바꿈이 든 제목 — YAML 이 머리말을 글자로만 읽게 한다.
  const special = deriveMarkdown("", { ...META, title: '주제: "결제" #1\n둘째 줄' });
  assert.ok(special.markdown.includes('  title: "주제: \\"결제\\" #1\\n둘째 줄"'));
  // 역슬래시는 두 배로 감는다.
  const slashed = deriveMarkdown("", { ...META, title: "a\\b" });
  assert.ok(slashed.markdown.includes('  title: "a\\\\b"'));
});

test("제목 · 문단 — 같은 요소가 마크다운으로 읽힌다(굵게 · 기울임 · 코드 · 글자 참조)", () => {
  const storage =
    "<h1>도입</h1>" +
    "<p>첫 <strong>문단</strong> &amp; 특수문자 &lt;태그&gt;.</p>" +
    "<h2>둘째 제목</h2>" +
    "<p><em>기울임</em>과 <code>let x</code>.</p>";
  const derived = deriveMarkdown(storage, META);
  assert.equal(
    bodyOf(derived.markdown),
    [
      "# 도입",
      "",
      "첫 **문단** & 특수문자 <태그>.",
      "",
      "## 둘째 제목",
      "",
      "*기울임*과 `let x`.",
    ].join("\n"),
  );
  assert.deepEqual(derived.sections, [
    { heading: "도입", macro: false },
    { heading: "둘째 제목", macro: false },
  ]);
});

test("깊은 목록 — 세 단 이상도 층마다 두 칸씩 들여 쓴다", () => {
  const storage =
    "<ul><li>하나<ol><li>하나-하나<ul><li>깊이 셋</li></ul></li></ol></li><li>둘</li></ul>";
  assert.equal(
    bodyOf(deriveMarkdown(storage, META).markdown),
    ["- 하나", "  1. 하나-하나", "    - 깊이 셋", "- 둘"].join("\n"),
  );
});

test("표 — GFM 표로 읽고 칸 안의 세로줄은 이스케이프한다", () => {
  const storage =
    "<table><thead><tr><th>항목</th><th>값</th></tr></thead>" +
    "<tbody><tr><td>지연</td><td>12ms</td></tr>" +
    "<tr><td>동시 | 확인</td><td>3</td></tr></tbody></table>";
  assert.equal(
    bodyOf(deriveMarkdown(storage, META).markdown),
    ["| 항목 | 값 |", "| --- | --- |", "| 지연 | 12ms |", "| 동시 \\| 확인 | 3 |"].join("\n"),
  );
});

test("코드 매크로 — 언어를 붙인 울타리로 읽고 그 절은 macro: true 다", () => {
  const storage =
    "<h2>코드 절</h2>" +
    '<ac:structured-macro ac:name="code">' +
    '<ac:parameter ac:name="language">typescript</ac:parameter>' +
    "<ac:plain-text-body><![CDATA[const a: number = 1;]]></ac:plain-text-body>" +
    "</ac:structured-macro>";
  const derived = deriveMarkdown(storage, META);
  assert.equal(
    bodyOf(derived.markdown),
    ["## 코드 절", "", "```typescript", "const a: number = 1;", "```"].join("\n"),
  );
  // 매크로 든 절은 macro: true — 코드 매크로도 ac:structured-macro 다(매개변수가 깎여나가므로 보수적으로).
  assert.deepEqual(derived.sections, [{ heading: "코드 절", macro: true }]);
});

test("그 밖의 매크로 — 자리 표시 문장이 되고 그 절은 macro: true 다", () => {
  const storage =
    "<h1>상태 절</h1><p>본문.</p>" +
    "<h1>매크로 절</h1>" +
    '<ac:structured-macro ac:name="status"><ac:parameter ac:name="title">작성 중</ac:parameter></ac:structured-macro>' +
    "<p>매크로 뒤.</p>";
  const derived = deriveMarkdown(storage, META);
  assert.ok(bodyOf(derived.markdown).includes("[Confluence 매크로: status]"));
  assert.deepEqual(derived.sections, [
    { heading: "상태 절", macro: false },
    { heading: "매크로 절", macro: true },
  ]);
});

test("첨부 참조 — 깨진 마크다운 링크로 나오지 않고 자리 표시 문장이 된다", () => {
  const storage =
    "<h1>참조</h1>" +
    '<p><ac:image><ri:attachment ri:filename="구성도.png"/></ac:image></p>' +
    '<p><ac:link><ri:attachment ri:filename="요구규격.pdf"/></ac:link></p>' +
    '<p><ac:link><ri:page ri:content-title="8.8 콜로노바"/>' +
    "<ac:plain-text-link-body><![CDATA[다른 문서로]]></ac:plain-text-link-body></ac:link></p>" +
    '<p><ac:link><ri:url ri:value="https://example.com/guide"/></ac:link></p>';
  const body = bodyOf(deriveMarkdown(storage, META).markdown);
  assert.ok(body.includes("[첨부: 구성도.png]"));
  assert.ok(body.includes("[첨부: 요구규격.pdf]"));
  assert.ok(body.includes("다른 문서로"));
  assert.ok(body.includes("https://example.com/guide"));
  // 마크다운 링크 문법은 아예 없다 — 깨진 링크가 나올 자리가 없다.
  assert.ok(!body.includes("]("));
});

test("인용 · 수평선 — 인용은 `>` 로, 수평선은 `---` 로 읽힌다", () => {
  const storage = "<blockquote><p>인용 첫째.</p><p>인용 둘째.</p></blockquote><hr/><p>끝.</p>";
  assert.equal(
    bodyOf(deriveMarkdown(storage, META).markdown),
    ["> 인용 첫째.", ">", "> 인용 둘째.", "", "---", "", "끝."].join("\n"),
  );
});
