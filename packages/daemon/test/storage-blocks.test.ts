import assert from "node:assert/strict";
import { test } from "node:test";
import type { DraftBlockView } from "@colonova-design/protocol";
import {
  blockFingerprint,
  newBlockXml,
  parseStorage,
  projectBlock,
  renderBlock,
  type StorageBlock,
  serializeStorage,
} from "../dist/storage-blocks.js";

/**
 * 저장 포맷 블록 엔진 시험(2026-10-23 · 최종 구현 계획 F1) — 합성 문서만 쓴다. 나누기가 원문을
 * 바이트까지 되살리는 약속, 종류별 투영과 토큰, 되돌리기의 거절 규칙, 새 블록 · 지문을 못 박는
 * 순수 시험이다. 프로세스도 네트워크도 띄우지 않는다.
 */

const DOC_BASIC = `<h1>합성 기획 표본</h1>
<p>이번 <strong>발표</strong>는 <em>짧게</em> 하고 <code>demo.sh</code>를 돌린다. 자료는 <a href="https://example.test/plan">계획 문서</a>에 있다.</p>
<ul>
  <li>첫 번째 항목</li>
  <li>두 번째 항목</li>
</ul>
<table>
  <thead>
    <tr>
      <th>단계</th>
      <th>할 일</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>준비</td>
      <td>화면을 고른다</td>
    </tr>
  </tbody>
</table>`;

const DOC_ENTITIES = `<p>간격&nbsp;띄우기 &amp; 조합 &#8361; &#x2606; 원래 &lt;보기&gt;</p>`;

const DOC_CDATA = `<ac:structured-macro ac:name="code">
  <ac:parameter ac:name="language">bash</ac:parameter>
  <ac:plain-text-body><![CDATA[a < b && c]]></ac:plain-text-body>
</ac:structured-macro>`;

const DOC_ANCHOR = `<p>앞<ac:inline-comment-marker ac:ref="r1">표시한 글</ac:inline-comment-marker>뒤</p>`;

const DOC_LAYOUT = `<ac:layout ac:type="two_equal">
  <ac:layout-section ac:type="two_equal">
    <ac:layout-cell>
      <p>왼쪽 첫 문단</p>
      <p>왼쪽 둘째 문단</p>
    </ac:layout-cell>
    <ac:layout-cell>
      <h2>오른쪽 제목</h2>
      <p>오른쪽 문단</p>
    </ac:layout-cell>
  </ac:layout-section>
</ac:layout>`;

const DOC_MERGED = `<table>
  <tbody>
    <tr>
      <td rowspan="2">병합 칸</td>
      <td>옆 칸</td>
    </tr>
    <tr>
      <td>아래 칸</td>
    </tr>
  </tbody>
</table>`;

const DOC_NESTED_LIST = `<ul>
  <li>바깥 항목
    <ul>
      <li>안 항목</li>
    </ul>
  </li>
</ul>`;

const DOC_GAPS = `<h1>제목</h1>

<p>문단</p>

`;

const DOC_INLINE_RICH = `<p>상태 <ac:structured-macro ac:name="status"><ac:parameter ac:name="title">진행</ac:parameter><ac:parameter ac:name="body">돌아가는 중</ac:parameter></ac:structured-macro> 링크 <ac:link><ri:page ri:content-title="표본 문서" ri:version-at-save="1"/></ac:link> 멘션 <ac:link><ri:user ri:userkey="u1"/></ac:link></p>`;

const DOC_STYLED_P = `<p style="color: red">붉은 문단</p>`;

const DOC_EMPTY = ``;

const DOC_CELL_LIST = `<table>
  <tbody>
    <tr>
      <th>이름</th>
      <td>
        <ul>
          <li>가</li>
        </ul>
      </td>
    </tr>
  </tbody>
</table>`;

// 판정에 더해 쓰는 보탬 문서들 — 같은 합성 규칙으로 만든다.
const DOC_AROUND_LAYOUT = `<p>앞 문단</p>
<ac:layout ac:type="single">
  <ac:layout-section ac:type="single">
    <ac:layout-cell>
      <p>칸 문단</p>
    </ac:layout-cell>
  </ac:layout-section>
</ac:layout>
<p>뒤 문단</p>`;

const DOC_EMPTY_CELL = `<ac:layout ac:type="two_equal">
  <ac:layout-section ac:type="two_equal">
    <ac:layout-cell>
      <p>왼쪽</p>
    </ac:layout-cell>
    <ac:layout-cell>
    </ac:layout-cell>
  </ac:layout-section>
</ac:layout>`;

const DOC_SIMPLE_TABLE = `<table>
  <tbody>
    <tr>
      <td>가</td>
      <td>나</td>
    </tr>
    <tr>
      <td>다</td>
      <td>라</td>
    </tr>
  </tbody>
</table>`;

const DOC_COLGROUP = `<table>
  <colgroup>
    <col />
    <col />
  </colgroup>
  <tbody>
    <tr>
      <td>가</td>
      <td>나</td>
    </tr>
  </tbody>
</table>`;

const DOC_LIST = `<ul>
  <li>하나</li>
  <li>둘</li>
</ul>`;

const DOC_LIST_P = `<ul><li><p>가</p></li><li><p>나</p></li></ul>`;

const DOC_BR_ESCAPES = `<p>이름<br/>값 *별 [각]</p>`;

const ALL_DOCS = [
  DOC_BASIC,
  DOC_ENTITIES,
  DOC_CDATA,
  DOC_ANCHOR,
  DOC_LAYOUT,
  DOC_MERGED,
  DOC_NESTED_LIST,
  DOC_GAPS,
  DOC_INLINE_RICH,
  DOC_STYLED_P,
  DOC_EMPTY,
  DOC_CELL_LIST,
  DOC_AROUND_LAYOUT,
  DOC_EMPTY_CELL,
  DOC_SIMPLE_TABLE,
  DOC_COLGROUP,
  DOC_LIST,
  DOC_LIST_P,
  DOC_BR_ESCAPES,
];

/** 한 문서짜리 뼈대에서 블록 하나를 꺼낸다. */
function soloBlock(xml: string): StorageBlock {
  const blocks = parseStorage(xml).blocks;
  assert.equal(blocks.length, 1);
  const block = blocks[0];
  assert.ok(block !== undefined);
  return block;
}

/** 되돌리기를 시도하고 거절되면 시험이 멈춘다. */
function renderOk(block: StorageBlock, view: DraftBlockView) {
  const result = renderBlock(block, view);
  assert.equal(result.ok, true, `되돌리기가 거절했다: ${result.ok ? "" : result.reason}`);
  return result;
}

test("모든 시험 문서에서 나누고 다시 잇으면 원문과 바이트까지 같다", () => {
  for (const xml of ALL_DOCS) {
    assert.equal(serializeStorage(parseStorage(xml)), xml);
  }
});

test("문서를 나누면 블록 순서 · 칸 이름 · 종류가 문서 순서대로 선다", () => {
  const basic = parseStorage(DOC_BASIC);
  assert.deepEqual(
    basic.blocks.map((block) => [block.id, block.slot, block.kind]),
    [
      ["b0", "main", "heading"],
      ["b1", "main", "paragraph"],
      ["b2", "main", "list"],
      ["b3", "main", "table"],
    ],
  );
  const layout = parseStorage(DOC_LAYOUT);
  assert.deepEqual(
    layout.blocks.map((block) => [block.id, block.slot, block.kind]),
    [
      ["b0", "L0.0", "paragraph"],
      ["b1", "L0.0", "paragraph"],
      ["b2", "L0.1", "heading"],
      ["b3", "L0.1", "paragraph"],
    ],
  );
});

test("layout 앞뒤의 최상위 묶음은 main 과 main.1 로 갈라지고 빈 셀은 블록 없는 칸이다", () => {
  const around = parseStorage(DOC_AROUND_LAYOUT);
  assert.deepEqual(
    around.blocks.map((block) => block.slot),
    ["main", "L0.0", "main.1"],
  );
  const slots = around.frame.flatMap((piece) => ("slot" in piece ? [piece.slot] : []));
  assert.deepEqual(slots, ["main", "L0.0", "main.1"]);
  const empty = parseStorage(DOC_EMPTY_CELL);
  assert.deepEqual(
    empty.blocks.map((block) => block.slot),
    ["L0.0"],
  );
  assert.ok(empty.frame.some((piece) => "slot" in piece && piece.slot === "L0.1"));
});

test("문서 사이의 공백은 다음 블록 앞부분이 되고 마지막 공백은 틀 조각으로 남는다", () => {
  const doc = parseStorage(DOC_GAPS);
  assert.equal(doc.blocks.length, 2);
  assert.equal(doc.blocks[0]?.xml, "<h1>제목</h1>");
  assert.equal(doc.blocks[1]?.xml, "\n\n<p>문단</p>");
  assert.deepEqual(doc.frame, [{ slot: "main" }, { raw: "\n\n" }]);
});

test("빈 문서는 블록도 틀도 없다", () => {
  const doc = parseStorage(DOC_EMPTY);
  assert.deepEqual(doc, { frame: [], blocks: [] });
});

test("제목 · 문단 · 목록 · 표가 사람이 고칠 투영으로 보인다", () => {
  const blocks = parseStorage(DOC_BASIC).blocks;
  const heading = blocks[0];
  const paragraph = blocks[1];
  const list = blocks[2];
  const table = blocks[3];
  assert.ok(
    heading !== undefined && paragraph !== undefined && list !== undefined && table !== undefined,
  );
  const headingProj = projectBlock(heading);
  assert.deepEqual(headingProj.view, { kind: "heading", level: 1, text: "합성 기획 표본" });
  assert.equal(headingProj.editable, true);
  const paragraphProj = projectBlock(paragraph);
  assert.deepEqual(paragraphProj.view, {
    kind: "paragraph",
    text: "이번 **발표**는 *짧게* 하고 `demo.sh`를 돌린다. 자료는 [계획 문서](https://example.test/plan)에 있다.",
  });
  assert.deepEqual(paragraphProj.tokens, {});
  const listProj = projectBlock(list);
  assert.deepEqual(listProj.view, {
    kind: "list",
    ordered: false,
    items: ["첫 번째 항목", "두 번째 항목"],
  });
  const tableProj = projectBlock(table);
  assert.deepEqual(tableProj.view, {
    kind: "table",
    rows: [
      {
        cells: [
          { header: true, text: "단계" },
          { header: true, text: "할 일" },
        ],
      },
      {
        cells: [
          { header: false, text: "준비" },
          { header: false, text: "화면을 고른다" },
        ],
      },
    ],
  });
});

test("엔티티는 글자로 풀려 보인다", () => {
  const proj = projectBlock(soloBlock(DOC_ENTITIES));
  assert.deepEqual(proj.view, {
    kind: "paragraph",
    text: "간격\u00A0띄우기 & 조합 ₩ ☆ 원래 <보기>",
  });
});

test("CDATA 를 담은 매크로는 고칠 수 없는 블록으로 보인다", () => {
  const block = soloBlock(DOC_CDATA);
  const proj = projectBlock(block);
  assert.deepEqual(proj.view, { kind: "preserved", label: "macro:code" });
  assert.equal(proj.editable, false);
  assert.deepEqual(proj.tokens, {});
});

test("코멘트 닻은 쌍 토큰으로 자리를 지킨다", () => {
  const block = soloBlock(DOC_ANCHOR);
  const proj = projectBlock(block);
  assert.deepEqual(proj.view, { kind: "paragraph", text: "앞⟦c1⟧표시한 글⟦/c1⟧뒤" });
  assert.deepEqual(proj.tokens, { c1: "comment-anchor" });
});

test("문단 안 매크로 · 링크 · 멘션은 홑 토큰으로 보인다", () => {
  const proj = projectBlock(soloBlock(DOC_INLINE_RICH));
  assert.deepEqual(proj.view, { kind: "paragraph", text: "상태 ⟦t1⟧ 링크 ⟦t2⟧ 멘션 ⟦t3⟧" });
  assert.deepEqual(proj.tokens, { t1: "macro:status", t2: "link:page", t3: "link:user" });
});

test("속성이 있는 문단도 문단 투영을 얻고 병합 · 중첩은 보존 전용이다", () => {
  const styled = projectBlock(soloBlock(DOC_STYLED_P));
  assert.deepEqual(styled.view, { kind: "paragraph", text: "붉은 문단" });
  assert.equal(styled.editable, true);
  const merged = projectBlock(soloBlock(DOC_MERGED));
  assert.deepEqual(merged.view, { kind: "preserved", label: "table:merged" });
  assert.equal(merged.editable, false);
  const nested = projectBlock(soloBlock(DOC_NESTED_LIST));
  assert.deepEqual(nested.view, { kind: "preserved", label: "list:nested" });
  assert.equal(nested.editable, false);
});

test("목록이 든 셀은 cell:complex 토큰 하나로 보이고 표는 여전히 고칠 수 있다", () => {
  const proj = projectBlock(soloBlock(DOC_CELL_LIST));
  assert.equal(proj.editable, true);
  assert.deepEqual(proj.view, {
    kind: "table",
    rows: [
      {
        cells: [
          { header: true, text: "이름" },
          { header: false, text: "⟦t1⟧" },
        ],
      },
    ],
  });
  assert.deepEqual(proj.tokens, { t1: "cell:complex" });
});

test("줄바꿈 · 빗표 · 대괄호는 투영에서 이스케이프로 읽힌다", () => {
  const proj = projectBlock(soloBlock(DOC_BR_ESCAPES));
  assert.deepEqual(proj.view, { kind: "paragraph", text: "이름\n값 \\*별 \\[각\\]" });
});

test("모든 블록에서 투영을 그대로 되돌리면 원문이 바이트까지 살아난다", () => {
  for (const xml of ALL_DOCS) {
    for (const block of parseStorage(xml).blocks) {
      const proj = projectBlock(block);
      const result = renderBlock(block, proj.view);
      assert.deepEqual(result, { ok: true, xml: block.xml, removedTokens: [] });
    }
  }
});

test("문단 글을 바꾸면 토큰이 살아난다", () => {
  const block = soloBlock(DOC_ANCHOR);
  const result = renderOk(block, { kind: "paragraph", text: "앞⟦c1⟧고친 글⟦/c1⟧뒤!" });
  assert.equal(
    result.xml,
    `<p>앞<ac:inline-comment-marker ac:ref="r1">고친 글</ac:inline-comment-marker>뒤!</p>`,
  );
  assert.deepEqual(result.removedTokens, []);
});

test("토큰을 지우면 removedTokens 에 이름이 선다", () => {
  const block = soloBlock(DOC_ANCHOR);
  const result = renderOk(block, { kind: "paragraph", text: "앞뒤!" });
  assert.equal(result.xml, "<p>앞뒤!</p>");
  assert.deepEqual(result.removedTokens, ["c1"]);
});

test("모르는 토큰 · 짝이 엇갈린 쌍 토큰 · 두 번 나온 토큰은 거절한다", () => {
  const anchor = soloBlock(DOC_ANCHOR);
  assert.equal(renderBlock(anchor, { kind: "paragraph", text: "앞⟦t9⟧뒤" }).ok, false);
  assert.equal(renderBlock(anchor, { kind: "paragraph", text: "⟦c1⟧표시한 글" }).ok, false);
  const span = soloBlock(
    `<p><span>밖<ac:inline-comment-marker ac:ref="r2">안</ac:inline-comment-marker>끝</span></p>`,
  );
  assert.equal(renderBlock(span, { kind: "paragraph", text: "⟦p1⟧a⟦c1⟧b⟦/p1⟧c⟦/c1⟧" }).ok, false);
  const rich = soloBlock(DOC_INLINE_RICH);
  assert.equal(renderBlock(rich, { kind: "paragraph", text: "⟦t1⟧ ⟦t1⟧" }).ok, false);
  // 쌍 토큰의 감싼 글은 그대로 두고 겉 글만 바꾼다.
  const spanProj = projectBlock(span);
  assert.deepEqual(spanProj.tokens, { p1: "format:span", c1: "comment-anchor" });
  const kept = renderOk(span, { kind: "paragraph", text: "겉⟦p1⟧밖⟦c1⟧안⟦/c1⟧끝⟦/p1⟧!" });
  assert.equal(
    kept.xml,
    `<p>겉<span>밖<ac:inline-comment-marker ac:ref="r2">안</ac:inline-comment-marker>끝</span>!</p>`,
  );
});

test("표의 셀 하나를 바꾸면 그 셀만 새로 만들어지고 다른 셀은 원문 조각 그대로다", () => {
  const block = soloBlock(DOC_SIMPLE_TABLE);
  const proj = projectBlock(block);
  assert.ok(proj.view.kind === "table");
  const rows = proj.view.rows.map((row, i) => {
    if (i !== 0) return row;
    const first = row.cells[0];
    assert.ok(first !== undefined);
    return { cells: [first, { header: false, text: "나!" }] };
  });
  const result = renderOk(block, { kind: "table", rows });
  assert.equal(
    result.xml,
    `<table>
  <tbody>
    <tr>
      <td>가</td>
      <td><p>나!</p></td>
    </tr>
    <tr>
      <td>다</td>
      <td>라</td>
    </tr>
  </tbody>
</table>`,
  );
});

test("표의 행을 더하고 뺀다", () => {
  const block = soloBlock(DOC_SIMPLE_TABLE);
  const proj = projectBlock(block);
  assert.ok(proj.view.kind === "table");
  const added = renderOk(block, {
    kind: "table",
    rows: [...proj.view.rows, { cells: [{ header: false, text: "마" }] }],
  });
  assert.ok(added.xml.includes("<tr><td><p>마</p></td></tr>"));
  assert.ok(added.xml.includes("<td>라</td>"));
  const removed = renderOk(block, { kind: "table", rows: proj.view.rows.slice(0, 1) });
  assert.ok(!removed.xml.includes("<td>다</td>"));
  assert.ok(removed.xml.includes("<td>가</td>"));
  assert.ok(removed.xml.includes("</tbody>"));
});

test("열 수가 바뀌면 colgroup 을 빼고 같으면 지킨다", () => {
  const block = soloBlock(DOC_COLGROUP);
  const proj = projectBlock(block);
  assert.ok(proj.view.kind === "table");
  const kept = renderOk(block, {
    kind: "table",
    rows: [
      {
        cells: [
          { header: false, text: "가" },
          { header: false, text: "나!" },
        ],
      },
    ],
  });
  assert.ok(kept.xml.includes("<colgroup>"));
  const dropped = renderOk(block, {
    kind: "table",
    rows: [
      {
        cells: [
          { header: false, text: "가" },
          { header: false, text: "나" },
          { header: false, text: "다" },
        ],
      },
    ],
  });
  assert.ok(!dropped.xml.includes("colgroup"));
});

test("cell:complex 셀을 고치면 거절하고 다른 셀을 고칠 때는 그대로 남긴다", () => {
  const block = soloBlock(DOC_CELL_LIST);
  const proj = projectBlock(block);
  assert.ok(proj.view.kind === "table");
  const row = proj.view.rows[0];
  assert.ok(row !== undefined);
  const complexCell = row.cells[1];
  assert.ok(complexCell !== undefined);
  const rejected = renderBlock(block, {
    kind: "table",
    rows: [
      {
        cells: [
          { header: true, text: "이름" },
          { header: false, text: "직접 쓴 글" },
        ],
      },
    ],
  });
  assert.equal(rejected.ok, false);
  const kept = renderOk(block, {
    kind: "table",
    rows: [
      {
        cells: [{ header: true, text: "이름!" }, complexCell],
      },
    ],
  });
  assert.ok(kept.xml.includes("<th><p>이름!</p></th>"));
  assert.ok(kept.xml.includes("<li>가</li>"));
});

test("병합 · 중첩으로 보존 전용이 된 블록은 같을 때만 받는다", () => {
  const merged = soloBlock(DOC_MERGED);
  const mergedView = projectBlock(merged).view;
  assert.deepEqual(renderBlock(merged, mergedView), {
    ok: true,
    xml: merged.xml,
    removedTokens: [],
  });
  assert.equal(renderBlock(merged, { kind: "paragraph", text: "병합 칸" }).ok, false);
  const macro = soloBlock(DOC_CDATA);
  assert.equal(renderBlock(macro, { kind: "paragraph", text: "코드" }).ok, false);
});

test("목록 항목을 고치고 더하고 종류를 바꾼다", () => {
  const block = soloBlock(DOC_LIST);
  const proj = projectBlock(block);
  assert.ok(proj.view.kind === "list");
  const edited = renderOk(block, { kind: "list", ordered: false, items: ["하나!", "둘"] });
  assert.equal(edited.xml, "<ul>\n  <li>하나!</li>\n  <li>둘</li>\n</ul>");
  const added = renderOk(block, {
    kind: "list",
    ordered: false,
    items: ["하나", "둘", "셋"],
  });
  assert.equal(added.xml, "<ul>\n  <li>하나</li>\n  <li>둘</li>\n  <li>셋</li>\n</ul>");
  const ordered = renderOk(block, { kind: "list", ordered: true, items: proj.view.items });
  assert.equal(ordered.xml, "<ol><li>하나</li>\n  <li>둘</li></ol>");
});

test("문단을 쓰던 목록은 그 모양을 지켜서 고친다", () => {
  const block = soloBlock(DOC_LIST_P);
  const result = renderOk(block, { kind: "list", ordered: false, items: ["가!", "나"] });
  assert.equal(result.xml, "<ul><li><p>가!</p></li><li><p>나</p></li></ul>");
});

test("새 블록은 네 종류로 만들고 글자는 엔티티로 쓴다", () => {
  assert.deepEqual(newBlockXml({ kind: "heading", level: 3, text: "제목" }), {
    ok: true,
    xml: "<h3>제목</h3>",
  });
  assert.deepEqual(newBlockXml({ kind: "paragraph", text: "a < b & c" }), {
    ok: true,
    xml: "<p>a &lt; b &amp; c</p>",
  });
  assert.deepEqual(newBlockXml({ kind: "paragraph", text: "가\n\n나" }), {
    ok: true,
    xml: "<p>가</p>\n<p>나</p>",
  });
  assert.deepEqual(newBlockXml({ kind: "list", ordered: false, items: ["가", "나"] }), {
    ok: true,
    xml: "<ul><li>가</li>\n<li>나</li></ul>",
  });
  assert.deepEqual(
    newBlockXml({
      kind: "table",
      rows: [
        {
          cells: [
            { header: true, text: "머리" },
            { header: false, text: "" },
          ],
        },
      ],
    }),
    { ok: true, xml: "<table><tr><th><p>머리</p></th><td><p /></td></tr></table>" },
  );
  // 새로 만든 블록은 다시 나눴을 때 같은 투영으로 돌아온다.
  const listXml = newBlockXml({ kind: "list", ordered: true, items: ["첫", "둘"] });
  assert.ok(listXml.ok);
  const parsed = projectBlock(soloBlock(listXml.xml));
  assert.deepEqual(parsed.view, { kind: "list", ordered: true, items: ["첫", "둘"] });
});

test("새 블록에 토큰이나 보존 종류는 받지 않는다", () => {
  assert.equal(newBlockXml({ kind: "paragraph", text: "⟦t1⟧" }).ok, false);
  assert.equal(newBlockXml({ kind: "preserved", label: "macro:info" }).ok, false);
});

test("문단을 제목으로 바꾸고 제목 수준을 옮기면 속성은 지킨다", () => {
  const paragraph = soloBlock(`<p>문단</p>`);
  const heading = renderOk(paragraph, { kind: "heading", level: 1, text: "문단" });
  assert.equal(heading.xml, "<h1>문단</h1>");
  const big = soloBlock(`<h2 class="big">제목</h2>`);
  const moved = renderOk(big, { kind: "heading", level: 3, text: "제목" });
  assert.equal(moved.xml, `<h3 class="big">제목</h3>`);
});

test("문단 속성 · 줄바꿈 · 이스케이프 글자는 되돌릴 때 원래 모양을 찾는다", () => {
  const styled = soloBlock(DOC_STYLED_P);
  const styledOut = renderOk(styled, { kind: "paragraph", text: "붉은 문단!" });
  assert.equal(styledOut.xml, `<p style="color: red">붉은 문단!</p>`);
  const brDoc = soloBlock(DOC_BR_ESCAPES);
  const brOut = renderOk(brDoc, { kind: "paragraph", text: "이름\n값 \\*별 \\[각\\]!" });
  assert.equal(brOut.xml, "<p>이름<br/>값 *별 [각]!</p>");
  const nbsp = soloBlock(DOC_ENTITIES);
  const nbspOut = renderOk(nbsp, { kind: "paragraph", text: "간격\u00A0띄우기!" });
  assert.equal(nbspOut.xml, "<p>간격\u00A0띄우기!</p>");
});

test("문단 글에 빈 줄이 있으면 문단을 나눈다", () => {
  const block = soloBlock(`<p>첫 문단</p>`);
  const result = renderOk(block, { kind: "paragraph", text: "첫 문단\n\n둘째 문단" });
  assert.equal(result.xml, "<p>첫 문단</p>\n<p>둘째 문단</p>");
});

test("지문은 같은 입력에 같고 다른 입력에 다르다", () => {
  assert.equal(blockFingerprint("<p>가</p>"), blockFingerprint("<p>가</p>"));
  assert.notEqual(blockFingerprint("<p>가</p>"), blockFingerprint("<p>나</p>"));
  assert.equal(blockFingerprint("<p>가</p>").length, 16);
  assert.ok(/^[0-9a-f]{16}$/.test(blockFingerprint("<p>가</p>")));
});

test("상태 매크로 토큰을 지키며 문단을 고친다", () => {
  const block = soloBlock(DOC_INLINE_RICH);
  const result = renderOk(block, { kind: "paragraph", text: "상태 ⟦t1⟧! 링크 ⟦t2⟧ 멘션 ⟦t3⟧" });
  assert.ok(result.xml.includes(`</ac:structured-macro>! 링크`));
  assert.ok(result.xml.includes(`<ac:parameter ac:name="title">진행</ac:parameter>`));
  assert.ok(result.xml.includes(`<ri:page ri:content-title="표본 문서" ri:version-at-save="1"/>`));
});

// ---------- 인라인 서식 되돌리기 — 작은 고침이 서식을 깨지 않는다(2026-10-23 · A1 후속) ----------

const RICH_CASES = [
  `<p><strong>b <em>c</em></strong> 끝</p>`,
  `<p><em>a <strong>b</strong> c</em></p>`,
  `<p><a href="https://e.com/a_(b)">괄호</a> 뒤</p>`,
];

const RICH_PARAGRAPHS = [
  ...RICH_CASES,
  `<p><em>앞</em><strong>중간</strong><em>끝</em></p>`,
  `<p><strong>하나</strong><em>둘</em><strong>셋</strong></p>`,
  `<p><em>가</em><em>나</em></p>`,
  `<p><strong>가</strong><strong>나</strong></p>`,
  `<p><em><strong>겹침</strong></em></p>`,
  `<p><strong><em>겹침</em> 뒤</strong></p>`,
  `<p><em>앞 <strong>겹침</strong></em></p>`,
  `<p><strong>겹 <em>치</em> 끝</strong></p>`,
  `<p>글 **a *b* c** 끝</p>`,
  `<p><ac:placeholder ac:has-empty-body="true"/><strong>굵게</strong> <a href="https://e.com/x?q=1&amp;v=2">쿼리</a></p>`,
];

test("굵게 안의 기울임은 문단을 고쳐도 그대로 살아난다", () => {
  const xml = RICH_CASES[0];
  assert.ok(xml !== undefined);
  const block = soloBlock(xml);
  const proj = projectBlock(block);
  assert.ok(proj.view.kind === "paragraph");
  assert.equal(proj.view.text, "**b *c*** 끝");
  const result = renderOk(block, { kind: "paragraph", text: "**b *c*** 끝!" });
  assert.equal(result.xml, "<p><strong>b <em>c</em></strong> 끝!</p>");
  assert.deepEqual(result.removedTokens, []);
});

test("기울임 안의 굵게가 사라지지 않는다", () => {
  const xml = RICH_CASES[1];
  assert.ok(xml !== undefined);
  const block = soloBlock(xml);
  const proj = projectBlock(block);
  assert.ok(proj.view.kind === "paragraph");
  assert.equal(proj.view.text, "*a **b** c*");
  const result = renderOk(block, { kind: "paragraph", text: "*a **b** c*!" });
  assert.equal(result.xml, "<p><em>a <strong>b</strong> c</em>!</p>");
  assert.deepEqual(result.removedTokens, []);
});

test("링크 주소의 균형 잡힌 괄호가 첫 닫힘에서 잘리지 않는다", () => {
  const xml = RICH_CASES[2];
  assert.ok(xml !== undefined);
  const block = soloBlock(xml);
  const proj = projectBlock(block);
  assert.ok(proj.view.kind === "paragraph");
  assert.equal(proj.view.text, "[괄호](https://e.com/a_\\(b\\)) 뒤");
  const result = renderOk(block, {
    kind: "paragraph",
    text: "[괄호](https://e.com/a_\\(b\\)) 뒤!",
  });
  assert.equal(result.xml, `<p><a href="https://e.com/a_(b)">괄호</a> 뒤!</p>`);
  assert.deepEqual(result.removedTokens, []);
});

test("단어 안 굵게에 빗장 글자를 치지 않는다", () => {
  const block = soloBlock(`<p>정책<strong>서</strong>를 본다</p>`);
  const proj = projectBlock(block);
  assert.ok(proj.view.kind === "paragraph");
  assert.equal(proj.view.text, "정책**서**를 본다");
  assert.ok(!proj.view.text.includes("\\"));
  const result = renderOk(block, { kind: "paragraph", text: "정책**서**를 본다!" });
  assert.equal(result.xml, "<p>정책<strong>서</strong>를 본다!</p>");
  assert.deepEqual(result.removedTokens, []);
});

test("단어 안 기울임에 빗장 글자를 치지 않는다", () => {
  const block = soloBlock(`<p>이<em>것</em>은</p>`);
  const proj = projectBlock(block);
  assert.ok(proj.view.kind === "paragraph");
  assert.equal(proj.view.text, "이*것*은");
  assert.ok(!proj.view.text.includes("\\"));
  const result = renderOk(block, { kind: "paragraph", text: "이*것*은!" });
  assert.equal(result.xml, "<p>이<em>것</em>은!</p>");
  assert.deepEqual(result.removedTokens, []);
});

test("로마자 단어 안 굵게에도 빗장 글자를 치지 않는다", () => {
  const block = soloBlock(`<p>a<strong>b</strong>c</p>`);
  const proj = projectBlock(block);
  assert.ok(proj.view.kind === "paragraph");
  assert.equal(proj.view.text, "a**b**c");
  assert.ok(!proj.view.text.includes("\\"));
  const result = renderOk(block, { kind: "paragraph", text: "a**b**c!" });
  assert.equal(result.xml, "<p>a<strong>b</strong>c!</p>");
  assert.deepEqual(result.removedTokens, []);
});

test("끝 공백은 표지 밖으로 나가고 되돌림도 그 모양이다", () => {
  const block = soloBlock(`<p><strong>텍스트 </strong>뒤</p>`);
  const proj = projectBlock(block);
  assert.ok(proj.view.kind === "paragraph");
  assert.equal(proj.view.text, "**텍스트** 뒤");
  const result = renderOk(block, { kind: "paragraph", text: "**텍스트** 뒤!" });
  assert.equal(result.xml, "<p><strong>텍스트</strong> 뒤!</p>");
  assert.deepEqual(result.removedTokens, []);
  // 고치지 않은 블록은 여전히 원문 바이트 그대로다.
  assert.deepEqual(renderBlock(block, proj.view), { ok: true, xml: block.xml, removedTokens: [] });
});

test("서식이 섞인 문단에서 끝에 ! 를 더하면 </p> 앞에 ! 만 더해진다", () => {
  for (const xml of RICH_PARAGRAPHS) {
    const block = soloBlock(xml);
    const proj = projectBlock(block);
    assert.ok(proj.view.kind === "paragraph", `문단 투영을 잃었다: ${xml}`);
    const text = `${proj.view.text}!`;
    const result = renderOk(block, { kind: "paragraph", text });
    assert.equal(result.xml, xml.replace("</p>", "!</p>"), `되돌림이 어긋났다: ${xml}`);
    assert.deepEqual(result.removedTokens, []);
    // 되돌린 문서를 다시 투영해도 같은 글이 나와야 한다 — 어긋나면 다음 고침에서 서식이 흔들린다.
    const reparsed = projectBlock(soloBlock(result.xml));
    assert.ok(reparsed.view.kind === "paragraph");
    assert.equal(reparsed.view.text, text, `다시 투영이 어긋났다: ${xml}`);
  }
});

test("경계 공백이 든 기울임은 공백이 표지 밖으로 나간 모양으로 되돌아온다", () => {
  const block = soloBlock(`<p>앞<em> <code>코드</code> </em>뒤</p>`);
  const proj = projectBlock(block);
  assert.ok(proj.view.kind === "paragraph");
  assert.equal(proj.view.text, "앞 *`코드`* 뒤");
  const result = renderOk(block, { kind: "paragraph", text: "앞 *`코드`* 뒤!" });
  assert.equal(result.xml, "<p>앞 <em><code>코드</code></em> 뒤!</p>");
  assert.deepEqual(result.removedTokens, []);
  // 고치지 않은 블록은 여전히 원문 바이트 그대로다.
  assert.deepEqual(renderBlock(block, proj.view), { ok: true, xml: block.xml, removedTokens: [] });
});
