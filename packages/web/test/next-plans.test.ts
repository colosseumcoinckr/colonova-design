import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { L } from "../src/next/labels.ts";
import { initialNav, navReducer } from "../src/next/lib/nav.ts";
// 순수 모듈 — src 에서 곧장 읽는다(next-labels.test.ts 와 같은 모양).
import {
  docUrl,
  filterPlanRows,
  importLine,
  macroHeadings,
  type PlanDoc,
  planBodyBlocks,
  planCommentRows,
  planRows,
  splitFrontmatter,
  syncLine,
  visiblePlanRows,
} from "../src/next/plans/plans-list.ts";

/**
 * 기획서 칸의 순수 조립 시험(2026-10-18 기획서 동기화 1단계 · M4, 같은 날 개선 패스) — 목록 · 접기 · 찾기 ·
 * 머리말 떼기 · 자리 표시 · 가져오기 줄이 리액트 없이 잡힌다.
 */

const doc = (path: string, title: string, version: number, pageId = title): PlanDoc => ({
  path,
  title,
  version,
  pageId,
});

test("목록 조립 — 경로의 걸음 순서로 서고 깊이가 들여쓰기가 된다", () => {
  const rows = planRows([
    doc("COLO/8.8 ColoNova/02.기능설계", "02.기능설계", 1),
    doc("COLO/8.8 ColoNova", "8.8 ColoNova", 13),
    doc("COLO/8.8 ColoNova/01.시스템분석", "01.시스템분석", 7),
  ]);
  // 숫자 머리가 앞에 선다.
  assert.deepEqual(
    rows.map((row) => row.title),
    ["8.8 ColoNova", "01.시스템분석", "02.기능설계"],
  );
  assert.deepEqual(
    rows.map((row) => row.depth),
    [0, 1, 1],
  );
});

test("목록 조립 — 숫자는 숫자로 센다(v2 가 v10 앞)", () => {
  const rows = planRows([
    doc("COLO/루트/정책서 v10", "정책서 v10", 1),
    doc("COLO/루트/정책서 v2", "정책서 v2", 1),
    doc("COLO/루트", "루트", 1),
  ]);
  assert.deepEqual(
    rows.map((row) => row.title),
    ["루트", "정책서 v2", "정책서 v10"],
  );
});

test("목록 조립 — 폴더 아래는 이어서 선다: 이름이 폴더 이름으로 시작하는 형제가 사이에 끼지 않는다", () => {
  // 글자 통째로 견주면 공백이 `/` 보다 앞이라 `02.정책서 v2` 가 `02.정책서` 와 그 아래 문서 사이로 들어온다.
  const rows = planRows([
    doc("COLO/루트/02.정책서/주문", "주문", 1),
    doc("COLO/루트/02.정책서 v2", "02.정책서 v2", 1),
    doc("COLO/루트/02.정책서", "02.정책서", 1),
    doc("COLO/루트", "루트", 1),
  ]);
  assert.deepEqual(
    rows.map((row) => row.title),
    ["루트", "02.정책서", "주문", "02.정책서 v2"],
  );
});

test("목록 조립 — 폴더 표시와 바로 위 폴더 이름", () => {
  const rows = planRows([
    doc("COLO/루트", "루트", 1),
    doc("COLO/루트/폴더", "폴더", 1),
    doc("COLO/루트/폴더/문서", "문서", 1),
  ]);
  assert.deepEqual(
    rows.map((row) => row.hasChildren),
    [true, true, false],
  );
  // 뿌리는 폴더가 없다(공간 이름을 보이지 않는다).
  assert.deepEqual(
    rows.map((row) => row.folder),
    ["", "루트", "폴더"],
  );
});

test("목록 조립 — 공간 이름이 비어 뿌리 경로가 한 걸음이어도 아래 문서가 한 칸 들어간다", () => {
  const rows = planRows([doc("루트", "루트", 1), doc("루트/문서", "문서", 1)]);
  assert.deepEqual(
    rows.map((row) => row.depth),
    [0, 1],
  );
});

test("접기 — 접은 폴더의 자손만 가려지고 형제는 그대로다", () => {
  const rows = planRows([
    doc("COLO/루트", "루트", 1),
    doc("COLO/루트/가", "가", 1),
    doc("COLO/루트/가/가1", "가1", 1),
    doc("COLO/루트/가/가1/가1a", "가1a", 1),
    doc("COLO/루트/가/가2", "가2", 1),
    doc("COLO/루트/나", "나", 1),
    doc("COLO/루트/나/나1", "나1", 1),
  ]);
  const titles = (collapsed: string[]) =>
    visiblePlanRows(rows, new Set(collapsed)).map((row) => row.title);
  assert.deepEqual(titles([]), ["루트", "가", "가1", "가1a", "가2", "나", "나1"]);
  assert.deepEqual(titles(["가"]), ["루트", "가", "나", "나1"]);
  // 안쪽 폴더만 접으면 그 아래만 가려진다.
  assert.deepEqual(titles(["가1"]), ["루트", "가", "가1", "가2", "나", "나1"]);
  // 바깥을 접으면 안쪽의 접힘은 상관없다 — 모두 가려진다.
  assert.deepEqual(titles(["가", "가1"]), ["루트", "가", "나", "나1"]);
  assert.deepEqual(titles(["루트"]), ["루트"]);
});

test("찾기 — 조각이 모두 들어 있어야 맞고, 폴더 이름도 본다", () => {
  const rows = planRows([
    doc("COLO/루트", "루트", 1),
    doc("COLO/루트/02.정책서", "02.정책서", 1),
    doc("COLO/루트/02.정책서/[정책서] 주문 접수", "[정책서] 주문 접수", 1),
    doc("COLO/루트/03.기능설계서/[기능설계서] 주문 목록", "[기능설계서] 주문 목록", 1),
  ]);
  const found = (query: string) => filterPlanRows(rows, query).map((row) => row.title);
  assert.equal(found("").length, rows.length);
  assert.equal(found("   ").length, rows.length);
  assert.deepEqual(found("주문"), ["[정책서] 주문 접수", "[기능설계서] 주문 목록"]);
  // 둘 다 들어 있어야 한다 — 폴더 이름(02.정책서)과 제목 조각(접수)이 따로 맞아도 된다.
  assert.deepEqual(found("02.정책서 접수"), ["[정책서] 주문 접수"]);
  assert.deepEqual(found("없는말"), []);
  // 대소문자 · 한글 조합 방식(NFD)은 가리지 않는다.
  assert.deepEqual(found("접수".normalize("NFD")), ["[정책서] 주문 접수"]);
});

test("매크로가 든 절만 가려진다 — 뷰어의 표시 자료는 머리말뿐이다", () => {
  assert.deepEqual(
    macroHeadings([
      { heading: "도메인 지도", macro: false },
      { heading: "주의", macro: true },
      { heading: "일정", macro: true },
    ]),
    ["주의", "일정"],
  );
  assert.deepEqual(macroHeadings([]), []);
  assert.deepEqual(macroHeadings([{ heading: "맑은 절", macro: false }]), []);
});

// 데몬(`confluence-markdown.ts`)이 파생 마크다운 맨 위에 남기는 머리말 그대로.
const FRONTMATTER = [
  "---",
  "confluence:",
  '  pageId: "2001"',
  '  space: "COLO"',
  '  title: "[정책서] \\"주문\\" 접수"',
  "  version: 7",
  '  updatedAt: "2026-10-16T09:12:00.000Z"',
  "---",
  "",
].join("\n");

test("머리말 떼기 — 제목 · 판 · 고친 때를 읽고 본문만 남긴다", () => {
  const { meta, body } = splitFrontmatter(`${FRONTMATTER}\n## 1. 목적\n\n본문\n`);
  assert.equal(meta.title, '[정책서] "주문" 접수');
  assert.equal(meta.version, 7);
  assert.equal(meta.updatedAt, "2026-10-16T09:12:00.000Z");
  // 머리말이 본문으로 새면 마크다운이 이를 가로줄 + 큰 제목으로 읽는다.
  assert.equal(body, "## 1. 목적\n\n본문\n");
  assert.ok(!body.includes("confluence:"));
});

test("머리말 떼기 — 단계 줄이 있어도, 본문이 빈 문서여도 멈추지 않는다", () => {
  const text = FRONTMATTER.replace(
    '  updatedAt: "2026-10-16T09:12:00.000Z"\n',
    '  updatedAt: "2026-10-16T09:12:00.000Z"\nstage: "0.7"\n',
  );
  const { meta, body } = splitFrontmatter(text);
  assert.equal(meta.version, 7);
  assert.equal(body, "");
});

test("머리말 떼기 — 머리말이 없거나 닫히지 않으면 본문 전체를 그대로 돌려준다", () => {
  for (const text of [
    "## 그냥 본문\n",
    "---\n본문의 가로줄로 시작\n---\n끝",
    "---\nconfluence:\n  title: 닫히지 않음\n",
    "",
  ]) {
    const { meta, body } = splitFrontmatter(text);
    assert.equal(body, text);
    assert.deepEqual(meta, { title: null, version: null, updatedAt: null });
  }
});

test("본문 조립 — 한 줄 전체가 자리 표시면 상자로, 문장이나 표 칸 속이면 알약 글로", () => {
  const blocks = planBodyBlocks(
    [
      "## 용어",
      "",
      "| 용어 | 비고 |",
      "| --- | --- |",
      `| 마스터 | [${L.plans.macroMarker}: status] |`,
      "",
      `[${L.plans.macroMarker}: info]`,
      "",
      "끝 문장",
      `[${L.plans.attachMarker}: 흐름도.png]`,
    ].join("\n"),
  );
  assert.deepEqual(blocks, [
    {
      kind: "md",
      text: [
        "## 용어",
        "",
        "| 용어 | 비고 |",
        "| --- | --- |",
        `| 마스터 | \`${L.plans.macroInline("status")}\` |`,
      ].join("\n"),
    },
    { kind: "note", text: L.plans.macroInline("info") },
    { kind: "md", text: "끝 문장" },
    { kind: "note", text: L.plans.attachInline("흐름도.png") },
  ]);
});

test("본문 조립 — 울타리 코드 안의 글은 건드리지 않는다", () => {
  const code = [
    "```text",
    `[${L.plans.macroMarker}: info]`,
    "```",
    "",
    `[${L.plans.macroMarker}: warning]`,
  ].join("\n");
  const blocks = planBodyBlocks(code);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]?.kind, "md");
  assert.ok(blocks[0]?.text.includes(`[${L.plans.macroMarker}: info]`));
  assert.deepEqual(blocks[1], { kind: "note", text: L.plans.macroInline("warning") });
});

test("본문 조립 — 마커는 데몬이 남기는 자리 표시와 글자가 같다", () => {
  // 두 글은 따로 산다(labels.ts · 데몬) — 어느 쪽이 바뀌면 본문이 상자 · 알약 대신 날것의 글로 보인다.
  const daemon = readFileSync(
    join(import.meta.dirname, "../../daemon/src/confluence-markdown.ts"),
    "utf8",
  );
  assert.ok(daemon.includes(`[${L.plans.macroMarker}: `));
  assert.ok(daemon.includes(`[${L.plans.attachMarker}: `));
});

test("코멘트 줄 — 작성자가 없으면 `이름 없음`, 시각은 문장으로, 고정은 인정한 고리는 뺀다", () => {
  const rows = planCommentRows([
    {
      author: "",
      body: "이 문장은 누가 썼나요?",
      createdAt: "2026-10-18T01:00:00Z",
      anchorText: null,
    },
    {
      author: "정인권",
      body: "여기 사이트 이름이 바뀌었어요",
      createdAt: null,
      anchorText: "colosseum",
    },
  ]);
  assert.equal(rows[0]?.author, L.plans.commentNoAuthor);
  assert.equal(rows[0]?.anchor, null);
  assert.equal(rows[1]?.anchor, L.plans.commentAnchor("colosseum"));
  assert.equal(rows[1]?.when, null);
  // 열쇠는 순서다 — 안 풀린 목록의 자리가 곧 화면의 자리다.
  assert.deepEqual(
    rows.map((row) => row.key),
    ["0", "1"],
  );
});

test("가져오기의 끝 — 바뀐 게 없으면 그렇게, 상한에 닿으면 더 누르라고 말한다", () => {
  assert.equal(importLine({ imported: 0, capped: false }), L.plans.importUpToDate);
  assert.equal(importLine({ imported: 3, capped: false }), L.plans.importChanged(3));
  assert.equal(importLine({ imported: 500, capped: true }), L.plans.importCapped(500));
});

test("가져오기 줄 — 도는 중 · 끊김 · 방금 끝남 · 마지막 때 · 아직 없음의 차례", () => {
  const at = new Date(Date.now() - 5 * 60_000).toISOString();
  const alive = { expired: false, lastImportAt: at, pages: 12 };
  const lapsed = { ...alive, expired: true };
  assert.deepEqual(syncLine(alive, true, null), { tone: "plain", text: L.plans.importing });
  // 끊긴 것이 지난 가져오기의 실패보다 앞선다 — 실패의 이유가 끊김이다.
  assert.deepEqual(syncLine(lapsed, false, { kind: "failed" }), {
    tone: "warn",
    text: L.plans.statusExpired,
  });
  assert.deepEqual(syncLine(alive, false, { kind: "failed" }), {
    tone: "bad",
    text: L.plans.importFailed,
  });
  assert.equal(
    syncLine(alive, false, { kind: "done", imported: 2, capped: false }).text,
    L.plans.importChanged(2),
  );
  assert.ok(syncLine(alive, false, null).text.endsWith(L.plans.statusImported("", 12).trim()));
  assert.equal(
    syncLine({ expired: false, lastImportAt: null, pages: 0 }, false, null).text,
    L.plans.syncNever,
  );
  assert.equal(syncLine(undefined, false, null).text, L.plans.syncNever);
});

test("문서 주소 — 사이트가 호스트로 읽힐 때만, 페이지 번호로 연다", () => {
  assert.equal(
    docUrl("colosseum.atlassian.net", "2001"),
    "https://colosseum.atlassian.net/wiki/pages/viewpage.action?pageId=2001",
  );
  // 프로토콜 · 뒤의 경로는 걷는다.
  assert.equal(
    docUrl("https://colosseum.atlassian.net/wiki/", "2001"),
    "https://colosseum.atlassian.net/wiki/pages/viewpage.action?pageId=2001",
  );
  assert.equal(docUrl("", "2001"), null);
  assert.equal(docUrl("not a host!", "2001"), null);
  assert.equal(docUrl("colosseum.atlassian.net", ""), null);
});

test("오른쪽 칸 전환 — 홈으로 가면 기획서 읽기는 끝나고, 대화를 여는 것은 칸을 건드리지 않는다", () => {
  let s = navReducer(initialNav(false), { type: "plans" });
  // 기획서를 읽다가 다른 대화를 여는 것은 읽기를 끊지 않는다.
  s = navReducer(s, { type: "thread" });
  assert.equal(s.pane, "plans");
  // 홈으로 가면 끝난다 — 홈에서 새 요청을 시작해 넘어올 때 AI 가 고치는 미리보기가 앞에 선다.
  s = navReducer(s, { type: "home" });
  assert.equal(s.view, "home");
  assert.equal(s.pane, "preview");
});

test("오른쪽 칸 전환 — 기획서 항목은 대화 틀 위에 서고, 프로젝트가 바뀌면 닫힌다", () => {
  let s = initialNav(false);
  s = navReducer(s, { type: "plans" });
  assert.equal(s.view, "thread");
  assert.equal(s.tab, "preview");
  assert.equal(s.pane, "plans");
  // 돌아오는 길 — 미리보기 칸이 같은 자리를 다시 쓴다.
  s = navReducer(s, { type: "pane", pane: "preview" });
  assert.equal(s.pane, "preview");
  s = navReducer(s, { type: "plans" });
  s = navReducer(s, { type: "project-changed" });
  assert.equal(s.pane, "preview");
  assert.equal(s.view, "home");
});
