#!/usr/bin/env node
// plans-g0-check — 계획 §13 G0 의 실측 껍데기(2026-10-23). 이 컴퓨터에서 읽기만으로
// SSOT 범위(트리 걷기) · 뿌리 아래 CQL · 원장을 대조해 사람이 읽는 표를 낸다.
//
// 쓰는 법:
//   COLONOVA_DESIGN_CONFLUENCE_EMAIL=… COLONOVA_DESIGN_CONFLUENCE_TOKEN=… \
//   node scripts/plans-g0-check.mjs --site <사이트> --root <뿌리 페이지 id> \
//     [--ledger <클론 또는 docs/plans 폴더>] [--json <파일>]
//
// 자격은 환경 변수(COLONOVA_DESIGN_CONFLUENCE_EMAIL · COLONOVA_DESIGN_CONFLUENCE_TOKEN)
// 에서만 읽는다 — 인자로 받지 않아 셸 기록에 남지 않는다.
//
// 읽기 전용 보장 — 전송은 scope-report 의 getOnlyTransport 로 감싸 GET 이 아닌 요청은
// 상대에 보내기 전에 던진다. whoAmI · direct-children 목록 · CQL 검색의 읽기만 나간다.
//
// 출력에는 문서 제목 · 본문 · 경로가 없다 — id 와 종류 · 수 · 걸린 시간 · 요청 수뿐이다.
//
// 걷기는 데몬(confluence-sync walkChildren)과 같은 규칙을 따른다: direct-children 목록의
// 재귀, current 가 아닌 것은 건너뛰고, page · folder · whiteboard · database · embed 아래는
// 내려가고, 모르는 종류에서 걷기는 빠짐없음이 아니 된다. 다른 점 하나 — 본문을 읽지 않는다
// (제목이 필요 없어서다). CQL 은 데몬 증분과 같은 꼴에 lastModified 를 아주 이른 때로 둔다
// (전부를 받는 쪽 — 증분의 좁힘 `id = 뿌리 OR ancestor = 뿌리` 도 같다).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  ConfluenceClient,
  createConfluenceTransport,
} from "../packages/daemon/dist/confluence-client.js";
import { parseConfluenceLedger } from "../packages/daemon/dist/confluence-ledger.js";
import { compareScope, getOnlyTransport } from "../packages/daemon/dist/scope-report.js";

const USAGE = [
  "G0 범위 대조 — 읽기만 실행한다.",
  "  COLONOVA_DESIGN_CONFLUENCE_EMAIL=… COLONOVA_DESIGN_CONFLUENCE_TOKEN=… \\",
  "  node scripts/plans-g0-check.mjs --site <사이트> --root <뿌리 페이지 id> \\",
  "    [--ledger <클론 또는 docs/plans 폴더>] [--json <파일>]",
  "뿌리는 숫자 id 여야 한다 — 숫자가 아니면 CQL 의 좁힘이 사이트 전체로 퍼진다.",
].join("\n");

const argv = process.argv.slice(2);
const option = (name) => {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  return value === undefined ? null : value;
};

const site = option("--site");
const rootId = option("--root");
const ledgerArg = option("--ledger");
const jsonPath = option("--json");
if (!site || !rootId || !/^\d+$/.test(rootId)) {
  console.error(USAGE);
  process.exit(1);
}

const email = process.env.COLONOVA_DESIGN_CONFLUENCE_EMAIL ?? "";
const token = process.env.COLONOVA_DESIGN_CONFLUENCE_TOKEN ?? "";
if (email === "" || token === "") {
  console.error(
    "자격이 없습니다 — COLONOVA_DESIGN_CONFLUENCE_EMAIL · COLONOVA_DESIGN_CONFLUENCE_TOKEN 를 환경 변수로 주세요.",
  );
  process.exit(1);
}

const startedAt = Date.now();
const { transport } = createConfluenceTransport(process.env, site);
const guarded = getOnlyTransport(transport);

// 요청 수와 CQL 페이지네이션의 상한 도달 — 클라이언트가 10쪽까지만 따라가므로, 10쪽을
// 받았는데 마지막 CQL 응답에 다음 표지가 남아 있으면 상한에 닿은 것이다.
let requests = 0;
let searchRequests = 0;
let lastSearchHadNext = false;
const counted = {
  async request(input) {
    requests += 1;
    const response = await guarded.request(input);
    if (input.url.startsWith("/wiki/rest/api/search")) {
      searchRequests += 1;
      const link = response.headers?.link;
      lastSearchHadNext = typeof link === "string" && link.includes('rel="next"');
    }
    return response;
  },
};
const client = new ConfluenceClient({ email, token }, counted);

// 1. 연결 확인 — 앱 자격(이메일 · 토큰)이 읽는 사람이다.
const me = await client.whoAmI();
if (!me.ok) {
  console.error(`연결 확인에 실패했습니다(${me.reason}) — ${me.detail}`);
  process.exit(1);
}
console.log(`연결 확인 — 앱 자격으로 읽습니다(사이트 ${site}).`);

// 2. 뿌리 아래 트리 걷기 — 데몬의 걷기와 같은 규칙(본문은 읽지 않는다).
const walk = [];
let walkComplete = true;
let walkUnauthorized = false;
walk.push({ id: rootId, type: "page", parentId: null });

async function walkChildren(parentId, parentType) {
  if (walkUnauthorized) return;
  const listed = await client.listDirectChildren(parentId, parentType);
  if (!listed.readable) {
    // 만료(401)면 걷기 전체가 만료다 — 데몬의 걷기와 같다. 그 밖은 그 갈래만 빠짐없음이 아니다.
    if (listed.reason === "unauthorized") walkUnauthorized = true;
    else walkComplete = false;
    return;
  }
  for (const child of listed.value) {
    if (walkUnauthorized) return;
    // current 가 아닌 것(archived)은 없는 것이다 — 데몬의 걷기와 같다.
    if (child.status !== null && child.status !== "current") continue;
    walk.push({ id: child.id, type: child.type, parentId });
    if (
      child.type === "page" ||
      child.type === "folder" ||
      child.type === "whiteboard" ||
      child.type === "database" ||
      child.type === "embed"
    ) {
      await walkChildren(child.id, child.type);
    } else {
      // 모르는 종류 — 아래를 읽을 길이 없으니 걷기는 빠짐없음이 아니다.
      walkComplete = false;
    }
  }
}

await walkChildren(rootId, "page");
if (walkUnauthorized) {
  console.error("걷기가 자격 만료(401)로 멎었다 — 토큰을 새로 내고 다시 돌려 주세요.");
  process.exit(1);
}
if (!walkComplete && walk.length === 1) {
  console.error("뿌리의 목록을 읽지 못했다 — 뿌리 페이지 id 와 권한을 확인해 주세요.");
  process.exit(1);
}

// 3. 뿌리 아래 CQL — 데몬 증분과 같은 꼴에 lastModified 를 아주 이른 때로 둔다(전부를 받는 쪽).
const scope = ` AND (id = ${rootId} OR ancestor = ${rootId})`;
const search = await client.searchPages(`type=page${scope} AND lastModified > "1970/01/01 00:00"`);
if (!search.readable) {
  console.error(`CQL 을 읽지 못했습니다(${search.reason}) — ${search.detail}`);
  process.exit(1);
}
const cql = search.value.map((hit) => ({ id: hit.id }));

// 4. 원장 — 클론 뿌리나 docs/plans 폴더를 받는다. 없으면 대조 없이 건너뛴다.
function ledgerFileOf(arg) {
  const abs = resolve(arg);
  const inPlans = basename(abs) === "plans" && basename(dirname(abs)) === "docs";
  return inPlans ? join(abs, "confluence.json") : join(abs, "docs", "plans", "confluence.json");
}

let ledger = null;
if (ledgerArg !== null) {
  const file = ledgerFileOf(ledgerArg);
  if (!existsSync(file)) {
    console.error("원장 파일이 없다 — --ledger 는 클론 뿌리나 docs/plans 폴더를 가리켜야 합니다.");
    process.exit(1);
  }
  ledger = parseConfluenceLedger(JSON.parse(readFileSync(file, "utf8")));
}
const ledgerEntries =
  ledger === null
    ? null
    : [
        ...Object.entries(ledger.pages).map(([id, page]) => ({ id, path: page.path })),
        ...Object.entries(ledger.folders).map(([id, folder]) => ({ id, path: folder.path })),
        ...Object.entries(ledger.unsupported).map(([id, item]) => ({ id, path: item.path })),
      ];

// 5. 대조와 표 — id 와 종류 · 수뿐이다(제목 · 본문 · 경로 없음).
const report = compareScope({
  walk,
  cql,
  ledger: ledgerEntries,
  walkComplete: walkComplete && !walkUnauthorized,
  pagesTruncated: searchRequests >= 10 && lastSearchHadNext,
});

const counts = report.walkCounts;
const lines = [];
lines.push(`G0 범위 대조 — 뿌리 ${rootId}`);
lines.push(
  `걷기 — page ${counts.page} · folder ${counts.folder} · whiteboard ${counts.whiteboard} · database ${counts.database} · embed ${counts.embed} · 그 밖 ${counts.other}`,
);
lines.push(`걷기 빠짐없음 — ${report.walkComplete ? "예" : "아니오(못 읽은 갈래가 있다)"}`);
lines.push(`CQL 상한 도달 — ${report.pagesTruncated ? "예(CQL 뒤가 잘렸을 수 있다)" : "아니오"}`);
lines.push(`폴더 아래 · CQL 빠짐 — ${report.missingUnderFolder}`);
for (const entry of report.missingFromCql) {
  if (entry.underFolder) lines.push(`  - ${entry.id}(폴더 아래)`);
}
lines.push(`뿌리 바로 아래 · CQL 빠짐 — ${report.missingDirect}`);
for (const entry of report.missingFromCql) {
  if (!entry.underFolder) lines.push(`  - ${entry.id}`);
}
lines.push(`CQL 에만 있는 문서 — ${report.cqlOnly.length}`);
for (const entry of report.cqlOnly) lines.push(`  - ${entry.id}`);
if (report.ledgerCompared) {
  lines.push(`원장에만 있는 문서 — ${report.onlyInLedger.length}`);
  for (const id of report.onlyInLedger) lines.push(`  - ${id}`);
  lines.push(`원장에 없는 문서(걷기에만) — ${report.onlyInWalk.length}`);
  for (const id of report.onlyInWalk) lines.push(`  - ${id}`);
} else {
  lines.push("원장 대조 — 원장이 없어 건너뛴다");
}
console.log(lines.join("\n"));
const elapsedMs = Date.now() - startedAt;
console.log(`요청 ${requests}회(CQL ${searchRequests}쪽) · ${elapsedMs}ms`);

if (jsonPath !== null) {
  writeFileSync(
    jsonPath,
    `${JSON.stringify(
      {
        report,
        meta: {
          rootId,
          requests,
          searchRequests,
          elapsedMs,
          ledgerCompared: report.ledgerCompared,
        },
      },
      null,
      2,
    )}\n`,
  );
  console.log(`결과의 JSON 을 적었다 — --json 로 가리킨 파일.`);
}
