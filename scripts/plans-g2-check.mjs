#!/usr/bin/env node
/**
 * G2 읽기 판정 껍데기(2026-10-23 · 최종 구현 계획 G2) — 이 컴퓨터의 기획서 캐시(docs/plans)를
 * 블록 엔진(packages/daemon/dist/storage-report.js)으로 재어 숫자만 본다. 실제 기획 문서는
 * 어디로도 보내지 않고, 출력에 문서의 본문 글은 한 글자도 나오지 않는다 — 문서 줄에는 페이지 id ·
 * 판 · 크기 · 종류별 수 · 검사 결과만 실고, 제목과 업무 단계 표기는 --titles 를 켜야 붙는다.
 * 네트워크 요청이 없고, --json 으로 정한 파일 외에는 아무것도 쓰지 않는다.
 *
 *   node scripts/plans-g2-check.mjs <클론 또는 docs/plans 폴더> [--titles] [--json <파일>] [--only <페이지id,…>]
 *
 * 클론 뿌리를 주면 docs/plans 의 원장(docs/plans/confluence.json)을 읽고, docs/plans 폴더를
 * 주면 그 자리의 원장을 읽는다. 원장에 없는 .storage.xml 파일은 건너뛴다.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const reportModule = join(repoRoot, "packages", "daemon", "dist", "storage-report.js");

if (!existsSync(reportModule)) {
  console.error("데몬 빌드가 없다 — pnpm build 를 먼저 돌린다.");
  process.exit(1);
}
const { reportFolder } = await import(reportModule);

function fail(message) {
  console.error(message);
  process.exit(1);
}

const USAGE =
  "사용법: node scripts/plans-g2-check.mjs <클론 또는 docs/plans 폴더> [--titles] [--json <파일>] [--only <페이지id,…>]";

const args = process.argv.slice(2);
let folder = null;
let titles = false;
let jsonFile = null;
let only = null;
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--titles") titles = true;
  else if (arg === "--json") {
    i += 1;
    const value = args[i];
    if (value === undefined) fail("--json 뒤에 파일 경로가 필요하다");
    jsonFile = resolve(value);
  } else if (arg === "--only") {
    i += 1;
    const value = args[i];
    if (value === undefined) fail("--only 뒤에 페이지 id 가 필요하다");
    only = new Set(
      value
        .split(",")
        .map((piece) => piece.trim())
        .filter(Boolean),
    );
  } else if (arg.startsWith("-")) fail(`모르는 꼬리표: ${arg}\n${USAGE}`);
  else if (folder === null) folder = arg;
  else fail(`문서 폴더는 하나만 준다.\n${USAGE}`);
}
if (folder === null) fail(USAGE);

const input = resolve(folder);
const directLedger = join(input, "confluence.json");
const nestedLedger = join(input, "docs", "plans", "confluence.json");
let plansDir = null;
let ledgerFile = null;
if (existsSync(directLedger)) {
  plansDir = input;
  ledgerFile = directLedger;
} else if (existsSync(nestedLedger)) {
  plansDir = join(input, "docs", "plans");
  ledgerFile = nestedLedger;
} else fail(`원장을 찾지 못했다 — ${input} 아래에 confluence.json 이 없다`);

let ledger;
try {
  ledger = JSON.parse(readFileSync(ledgerFile, "utf8"));
} catch (error) {
  fail(`원장을 읽지 못했다: ${error.message}`);
}
const pages = ledger?.pages;
if (typeof pages !== "object" || pages === null) fail("원장에 pages 목록이 없다");

const ids = Object.keys(pages).sort(
  (a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b, "en"),
);
const entries = [];
const skipped = []; // 원장에 적혀도 .storage.xml 이 없는 문서 — id 만 남긴다
for (const id of ids) {
  if (only !== null && !only.has(id)) continue;
  const path = typeof pages[id]?.path === "string" ? pages[id].path : null;
  const file = path === null ? null : join(plansDir, `${path}.storage.xml`);
  if (file === null || !existsSync(file)) {
    skipped.push(id);
    continue;
  }
  entries.push({
    pageId: id,
    title: typeof pages[id].title === "string" ? pages[id].title : "",
    xml: readFileSync(file, "utf8"),
  });
}
if (entries.length === 0) fail("건너뛴 뒤 남는 문서가 없다 — 원장과 docs/plans 의 파일을 본다");

const report = reportFolder(entries, { titles });
const totals = report.totals;

const idWidth = Math.max(9, ...report.documents.map((document) => document.pageId.length));
let head = `${"페이지id".padEnd(idWidth)}  판  바이트  블록(h/p/l/t/보존)  보존  토큰  매크로  검사`;
if (titles) head += "  표기  제목";

console.log(
  `문서 ${totals.documents}개 · 합계 ${totals.bytes}바이트` +
    (skipped.length > 0 ? ` · 저장본이 없어 건너뛴 ${skipped.length}개` : ""),
);
console.log(head);
for (const document of report.documents) {
  const r = document.report;
  const marks =
    (r.roundTrip.ok ? "o" : "x") + (r.noopRender.ok ? "o" : "x") + (r.isolatedEdit.ok ? "o" : "x");
  const tokenCount = Object.values(r.tokens).reduce((sum, count) => sum + count, 0);
  const macroCount = Object.values(r.macros).reduce((sum, count) => sum + count, 0);
  let line =
    document.pageId.padEnd(idWidth) +
    `  ${String(pages[document.pageId]?.version ?? "?").padStart(2)}` +
    `  ${String(r.bytes).padStart(6)}` +
    `  ${`${r.byKind.heading}/${r.byKind.paragraph}/${r.byKind.list}/${r.byKind.table}/${r.byKind.preserved}`.padStart(17)}` +
    `  ${String(r.preserved.total).padStart(4)}` +
    `  ${String(tokenCount).padStart(4)}` +
    `  ${String(macroCount).padStart(6)}` +
    `  ${marks}`;
  if (titles) line += `  ${document.stage ?? "-"}  ${document.title ?? ""}`;
  console.log(line);
}

console.log(
  `합계 블록 ${totals.blocks}개 — 제목 ${totals.byKind.heading} · 문단 ${totals.byKind.paragraph} · ` +
    `목록 ${totals.byKind.list} · 표 ${totals.byKind.table} · 보존 ${totals.byKind.preserved}`,
);
console.log(
  `검사 통과(문서 수) — 되돌림 ${totals.checks.roundTrip} · 투영 되돌림 ${totals.checks.noopRender} · ` +
    `한 블록 편집 ${totals.checks.isolatedEdit}`,
);
const dumpCounts = (title, map) => {
  const lines = Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"));
  if (lines.length > 0)
    console.log(`${title}: ${lines.map(([name, count]) => `${name} ${count}`).join(" · ")}`);
};
dumpCounts("보존 사유", totals.preserved.byReason);
dumpCounts("토큰 라벨", totals.tokens);
dumpCounts("매크로", totals.macros);
console.log("큰 문서 다섯:");
for (const entry of totals.largest) {
  console.log(`  ${entry.pageId.padEnd(idWidth)} ${String(entry.bytes).padStart(6)}바이트`);
}

if (jsonFile !== null) {
  writeFileSync(jsonFile, `${JSON.stringify({ plansDir, skipped, report }, null, 2)}\n`, "utf8");
  console.log(`같은 내용을 파일에 썼다: ${jsonFile}`);
}
