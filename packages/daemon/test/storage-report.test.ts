import assert from "node:assert/strict";
import { test } from "node:test";
import { reportFolder, reportStorage } from "../dist/storage-report.js";

/**
 * G2 읽기 판정 보고 시험(2026-10-23 · 최종 구현 계획 G2) — 합성 저장 포맷만 쓴다. 종류 · 보존 사유 ·
 * 토큰 · 매크로의 수, 세 검사(되돌림 · 투영 되돌림 · 한 블록 편집), 깨진 문서의 사유 이름, 폴더 합계와
 * 제목 끔/켬, 결과에 본문 글이 남지 않음을 못 박는 순수 시험이다. 프로세스도 네트워크도 띄우지 않는다.
 */

const DOC_FULL = `<h1>합성표지 표제</h1>
<p>합성본문표지 <strong>굵은표지</strong>와 <em>기운표지</em></p>
<ul>
  <li>첫표지</li>
  <li>둘표지</li>
</ul>
<table><tbody><tr><th>머리표지</th><th>둘째표지</th></tr><tr><td>칸표지하나</td><td>칸표지둘</td></tr></tbody></table>
<ac:structured-macro ac:name="info"><ac:parameter ac:name="title">안내표지</ac:parameter><ac:rich-text-body><p>안내본문표지</p></ac:rich-text-body></ac:structured-macro>
<ac:layout ac:type="two_equal"><ac:layout-section ac:type="two_equal"><ac:layout-cell><p>왼칸표지</p></ac:layout-cell><ac:layout-cell><p>오른칸표지</p></ac:layout-cell></ac:layout-section></ac:layout>
<p>그림표지 <ac:image><ri:attachment ri:filename="figure.png" /></ac:image> 끝표지</p>
<p>문서표지 <ac:link><ri:page ri:content-title="합성상대" /></ac:link> 닫는다</p>
<p>닻표지<ac:inline-comment-marker ac:ref="s1">안표지</ac:inline-comment-marker>끝</p>
<table><tbody><tr><td rowspan="2">병합표지</td><td>옆칸표지</td></tr><tr><td>아래칸표지</td></tr></tbody></table>
<table><tbody><tr><td><table><tbody><tr><td>안칸표지</td></tr></tbody></table></td></tr></tbody></table>
<ul><li>겉표지<ul><li>속표지</li></ul></li></ul>
<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">bash</ac:parameter><ac:plain-text-body><![CDATA[합성 < 스크립트]]></ac:plain-text-body></ac:structured-macro>
<p>간격&nbsp;표지 &amp; 물음표지 &#8361;</p>`;

const DOC_PLAIN = `<h1>합성두번째 v1.0</h1>
<p>${"채움글자".repeat(200)}</p>`;

const DOC_BROKEN = "<table><tr><td>칸표지";

test("온갖 조각이 든 합성 문서의 종류 · 보존 · 토큰 · 매크로 수를 센다", () => {
  const report = reportStorage(DOC_FULL);
  assert.equal(report.blocks, 15);
  assert.deepEqual(report.byKind, {
    heading: 1,
    paragraph: 7, // 맨 문단 둘 + 레이아웃 두 칸 + 그림 · 문서 · 닻 문단 + 엔티티 문단
    list: 2,
    table: 3,
    preserved: 2, // info · code 매크로 블록
  });
  assert.deepEqual(report.preserved, {
    total: 5, // 매크로 둘 + 병합 셀 표 + 표 속 표 + 중첩 목록
    byReason: {
      "macro:info": 1,
      "macro:code": 1,
      "table:merged": 1,
      "table:nested": 1,
      "list:nested": 1,
    },
  });
  assert.equal(report.layoutSections, 1);
  assert.deepEqual(report.tokens, { image: 1, "link:page": 1, "comment-anchor": 1 });
  assert.deepEqual(report.macros, { info: 1, code: 1 }); // 블록 매크로 둘 — 인라인 매크로는 없다
});

test("고치지 않은 되돌림 · 투영 되돌림 · 한 블록 편집의 세 검사를 통과한다", () => {
  const report = reportStorage(DOC_FULL);
  assert.deepEqual(report.roundTrip, { ok: true, reason: null });
  assert.deepEqual(report.noopRender, { ok: true, failed: 0, reason: null });
  assert.deepEqual(report.isolatedEdit, { ok: true, reason: null });
});

test("인라인 매크로도 매크로 수에 더한다", () => {
  const DOC_INLINE_MACRO = `<p>앞 <ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">Blue</ac:parameter></ac:structured-macro> 뒤</p>`;
  const report = reportStorage(DOC_INLINE_MACRO);
  assert.deepEqual(report.tokens, { "macro:status": 1 });
  assert.deepEqual(report.macros, { status: 1 });
  assert.equal(report.preserved.total, 0);
});

test("깨진 문서도 던지지 않고 검사에 사유 이름을 남긴다", () => {
  const report = reportStorage(DOC_BROKEN);
  assert.equal(report.blocks, 1);
  assert.deepEqual(report.byKind, {
    heading: 0,
    paragraph: 0,
    list: 0,
    table: 1,
    preserved: 0,
  });
  assert.equal(report.roundTrip.ok, true); // 토크나이저가 원문을 통째로 지켜 되돌림은 통과한다
  assert.deepEqual(report.isolatedEdit, { ok: false, reason: "no-editable-paragraph" });
});

test("폴더 보고서에 문서별 판정과 합계를 더한다", () => {
  const folder = reportFolder(
    [
      { pageId: "101", title: "합성표제글자 v0.8", xml: DOC_FULL },
      { pageId: "102", title: "합성두번째 v1.0", xml: DOC_PLAIN },
    ],
    { titles: true },
  );
  assert.equal(folder.totals.documents, 2);
  assert.equal(folder.totals.blocks, 17);
  assert.equal(folder.totals.bytes, reportStorage(DOC_FULL).bytes + reportStorage(DOC_PLAIN).bytes);
  assert.deepEqual(folder.totals.byKind, {
    heading: 2,
    paragraph: 8,
    list: 2,
    table: 3,
    preserved: 2,
  });
  assert.equal(folder.totals.preserved.total, 5);
  assert.deepEqual(folder.totals.tokens, { image: 1, "link:page": 1, "comment-anchor": 1 });
  assert.deepEqual(folder.totals.checks, { roundTrip: 2, noopRender: 2, isolatedEdit: 2 });
  // 큰 문서 순 — 채움글자가 든 두 번째가 앞에 선다
  assert.deepEqual(
    folder.totals.largest.map((entry) => entry.pageId),
    ["102", "101"],
  );
  assert.deepEqual(
    folder.documents.map((document) => [document.stage, document.title]),
    [
      ["0.8", "합성표제글자 v0.8"],
      ["1.0", "합성두번째 v1.0"],
    ],
  );
});

test("제목을 끄면 결과에 제목과 표기가 한 글자도 없다", () => {
  const folder = reportFolder(
    [
      { pageId: "101", title: "합성표제글자 v0.8", xml: DOC_FULL },
      { pageId: "102", title: "합성두번째 v1.0", xml: DOC_PLAIN },
    ],
    { titles: false },
  );
  const dumped = JSON.stringify(folder);
  assert.ok(!dumped.includes("합성표제글자"));
  assert.ok(!dumped.includes("합성두번째"));
  assert.ok(!dumped.includes("0.8"));
  assert.deepEqual(
    folder.documents.map((document) => [document.title, document.stage]),
    [
      [null, null],
      [null, null],
    ],
  );
});

test("결과 어디에도 본문 글이 남지 않는다", () => {
  const dumped = JSON.stringify([
    reportStorage(DOC_FULL),
    reportStorage(DOC_BROKEN),
    reportFolder([{ pageId: "101", title: "합성표제글자 v0.8", xml: DOC_FULL }], { titles: true }),
  ]);
  assert.ok(!dumped.includes("합성본문표지"));
  assert.ok(!dumped.includes("안내본문표지"));
  assert.ok(!dumped.includes("합성 < 스크립트"));
});
