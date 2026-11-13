/**
 * 큰 기획 문서의 성능 실측(합성) — 손으로 돌리는 측정(2026-10-23 · 작업 P1).
 *
 *   node scripts/bench/plans-blocks.bench.mjs
 *
 * 실제 문서 · 실제 Confluence 는 쓰지 않는다 — 합성 저장 포맷만 만들어
 * parseStorage · serializeStorage · projectBlock · renderBlock · composeDraftBody ·
 * deriveMarkdown · rebase(블록 지문 LCS)의 시간과 대략의 메모리를 잰다.
 * 같은 모듈의 문서 만들기 · 고침 만들기는 plans-blocks.test.mjs 도 함께 쓴다.
 * 데몬을 띄우지 않고, 임시 폴더의 DraftStore 와 시험 안의 가짜 클라이언트로만 돈다.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { deriveMarkdown } from "../../packages/daemon/dist/confluence-markdown.js";
import { composeDraftBody, DraftPublisher } from "../../packages/daemon/dist/draft-publish.js";
import { DraftStore } from "../../packages/daemon/dist/draft-store.js";
import {
  blockFingerprint,
  parseStorage,
  projectBlock,
  renderBlock,
  serializeStorage,
} from "../../packages/daemon/dist/storage-blocks.js";

// ————— 합성 문서 — 실제 문서를 흉내 내지 않는다 —————

/** 같은 글의 반복 — 블록 크기를 맞추는 어미. */
const 문장 = (seed, count) =>
  Array.from({ length: count }, (_, k) => `보통 문장 ${seed}-${k}`).join(" ");

/** 인라인 서식을 count 개 섞은 긴 문단 — 굵게 · 기울임 · 링크 · 엔티티를 돌아가며 넣는다. */
export function 긴문단(count, idx) {
  let out = `<p>긴문단-${idx} 문서자리-${idx} `;
  for (let f = 0; f < count; f += 1) {
    const kind = f % 4;
    if (kind === 0) out += `<strong>가늘게 ${idx}-${f}</strong> 사이 `;
    else if (kind === 1) out += `<em>기울임 ${idx}-${f}</em> 사이 `;
    else if (kind === 2) out += `<a href="/wiki/합성-${idx}-${f}">연결 ${f}</a> 사이 `;
    else out += `&amp;엔티티&nbsp;${idx}-${f} 사이 `;
  }
  return `${out}</p>`;
}

/** 행 30 · 열 6 짜리 표 — 첫 행이 머리칸이다. 첫 머리칸에 자리 표식을 심는다. */
function 합성표(idx) {
  const cell = (r, c) => {
    const text = r === 0 && c === 0 ? `문서자리-${idx} 칸` : `칸-${idx}-${r}-${c} 자리 글`;
    return `<${r === 0 ? "th" : "td"}>${text}</${r === 0 ? "th" : "td"}>`;
  };
  const row = (r) => `<tr>${Array.from({ length: 6 }, (_, c) => cell(r, c)).join("")}</tr>`;
  return `<table><thead>${row(0)}</thead><tbody>${Array.from({ length: 29 }, (_, k) =>
    row(k + 1),
  ).join("")}</tbody></table>`;
}

/** 블록 하나를 만든다 — 종류는 열두 칸 주기로 돌린다. idx 는 문서 순서 자리다. */
function 블록하니(idx, kind) {
  const m = `문서자리-${idx}`;
  switch (kind) {
    case 0:
      return `<h2>${m} 합성 절 제목 ${idx}</h2>`;
    case 1:
      return `<p>${m} ${문장(idx, 60)}</p>`;
    case 2:
      return `<p>${m} &amp;개체&nbsp;섞은 문단 <strong>굵게 ${idx}</strong> <em>기울임 ${idx}</em> <a href="/wiki/문서-${idx}">연결 ${idx}</a> <ac:inline-comment-marker ac:ref="anchor-${idx}">닻 글 ${idx}</ac:inline-comment-marker></p>`;
    case 3:
      return `<ul>${Array.from({ length: 30 }, (_, k) => `<li>${m} 항목 ${k}</li>`).join("")}</ul>`;
    case 4:
      return `<p>${m} ${문장(idx, 38)}</p>`;
    case 5:
      return 합성표(idx);
    case 6:
      return `<ac:structured-macro ac:name="info"><ac:parameter ac:name="title">참고 ${idx}</ac:parameter><ac:plain-text-body><![CDATA[${m} 합성 매크로 본문]]></ac:plain-text-body></ac:structured-macro>`;
    case 7:
      return `<h3>${m} 합성 소절 제목 ${idx}</h3>`;
    case 8:
      return `<p>${m} 그림과 사본 문단 <ac:image><ri:attachment ri:filename="합성-${idx}.png"/></ac:image> <ac:link><ri:page ri:content-title="합성 상대 ${idx}"/></ac:link></p>`;
    case 10:
      return `<p>${m} ${문장(idx, 58)}</p>`;
    default:
      return `<ol>${Array.from({ length: 20 }, (_, k) => `<li>${m} 차례 항목 ${k}</li>`).join("")}</ol>`;
  }
}

/** 블록 count 개짜리 합성 문서 — 가운데쯤에 인라인 서식 500개짜리 긴 문단을 하나 심는다. */
export function buildDoc(count) {
  // 긴 문단 자리 — layout 이 세 자리(9,10,11)를 묶어 먹지 않는 자리를 고른다.
  let longIdx = Math.floor(count / 3);
  while (longIdx % 12 >= 9) longIdx += 1;
  const parts = [];
  let emitted = 0;
  while (emitted < count) {
    const kind = emitted % 12;
    if (emitted === longIdx) {
      parts.push(긴문단(500, emitted));
      emitted += 1;
      continue;
    }
    if (kind === 9) {
      // layout 은 세 블록을 낸다 — 자리 셋을 미리 본다.
      const cellIdx = [emitted, emitted + 1, emitted + 2];
      const cells = cellIdx
        .map((idx, c) => `<ac:layout-cell><p>문서자리-${idx} 칸 문단 ${c}</p></ac:layout-cell>`)
        .join("");
      parts.push(
        `<ac:layout><ac:layout-section ac:type="three_equal">${cells}</ac:layout-section></ac:layout>`,
      );
      emitted += 3;
      continue;
    }
    parts.push(블록하니(emitted, kind));
    emitted += 1;
  }
  return `${parts.join("\n")}\n`;
}

/** 정해진 개수의 문서 순서 자리를 고른다 — offset 으로 자리를 나눠 겹치지 않게 한다. */
function 자리고르기(total, count, offset, taken) {
  const out = [];
  for (let k = 0; k < count; k += 1) {
    let idx = Math.min(total - 1, Math.floor(((k + offset) * total) / count));
    while (taken.has(idx) || out.includes(idx)) idx = (idx + 1) % total;
    out.push(idx);
    taken.add(idx);
  }
  return out.sort((a, b) => a - b);
}

/**
 * 다시 맞추기의 세 판 — 기준 원문과, 그것을 번갈아 고친 내 초안 · 원격 판.
 * 내 초안은 블록 30개를 고치고, 원격은 다른 블록 30개를 고치고 10개를 넣고 10개를 뺀다.
 */
export function buildRebaseFixture(count) {
  const xml = buildDoc(count);
  const doc = parseStorage(xml);
  const total = doc.blocks.length;
  const taken = new Set();
  const mineIdx = 자리고르기(total, Math.min(30, total), 0.1, taken);
  const remoteIdx = 자리고르기(total, Math.min(30, total), 0.6, taken);
  const insertIdx = 자리고르기(total, Math.min(10, total), 0.3, taken);
  const deleteIdx = 자리고르기(total, Math.min(10, total), 0.8, taken);
  const 고친 = (idx) => doc.blocks[idx].xml.replace(`문서자리-${idx}`, `문서자리-${idx}고침`);
  const mineBlocks = doc.blocks.map((block, idx) => ({
    id: block.id,
    slot: block.slot,
    kind: block.kind,
    xml: mineIdx.includes(idx) ? 고친(idx) : block.xml,
    baseFingerprint: blockFingerprint(block.xml),
  }));
  const pieces = [];
  doc.blocks.forEach((block, idx) => {
    if (insertIdx.includes(idx)) {
      pieces.push(`<p>문서자리-원격새${idx} 원격이 넣은 새 문단</p>`);
    }
    if (!deleteIdx.includes(idx)) {
      pieces.push(remoteIdx.includes(idx) ? 고친(idx) : block.xml);
    }
  });
  // 블록 원문은 앞의 공백을 이미 갖고 있다 — 이어 붙이고 끝의 줄바꿈만 더한다.
  const remoteXml = `${pieces.join("")}\n`;
  return {
    xml,
    remoteXml,
    frame: doc.frame,
    mineBlocks,
    mineIdx,
    remoteIdx,
    total,
  };
}

// ————— 시간 재기 —————

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** 같은 일을 5번 돌려 중앙값(ms)을 낸다. */
const 중앙값ms = (run, times = 5) => {
  const samples = [];
  for (let i = 0; i < times; i += 1) {
    const t0 = performance.now();
    run();
    samples.push(performance.now() - t0);
  }
  return median(samples);
};

const mb = (bytes) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)}MB`
    : `${(bytes / 1024).toFixed(0)}KB`;
const ms = (value) => (value >= 100 ? value.toFixed(0) : value.toFixed(1));

/** 없는 손잡이를 부르면 실패하는 가짜 클라이언트 — draft-publish 시험과 같은 감각이다. */
function fakeClient(mirror) {
  return new Proxy(
    {
      readPage: async () => ({ readable: true, value: { ...mirror } }),
    },
    {
      get(target, prop) {
        if (typeof prop === "string" && !(prop in target)) {
          throw new Error(`가짜 클라이언트에 없는 손잡이: ${prop}`);
        }
        return Reflect.get(target, prop);
      },
    },
  );
}

/** 다시 맞추기 한 바퀴 — 임시 폴더에 초안을 새로 두고 원격 판과 맞춘다. 시간과 메모리를 낸다. */
async function 재다시맞추기(fixture, times = 5) {
  const samples = [];
  const heaps = [];
  for (let i = 0; i < times; i += 1) {
    const root = mkdtempSync(join(tmpdir(), "plans-bench-"));
    try {
      const store = new DraftStore(root);
      const at = new Date().toISOString();
      store.create(
        {
          format: 1,
          docKey: "p-424242",
          kind: "existing",
          site: "https://합성.example.net",
          pageId: "424242",
          spaceId: "COLO",
          parent: { id: "9", type: "page", title: "합성 루트" },
          title: "합성 기획 문서",
          baseTitle: "합성 기획 문서",
          baseVersion: 4,
          baseFetchedAt: at,
          revision: 1,
          state: "editing",
          frame: fixture.frame,
          blocks: fixture.mineBlocks,
          observedVersion: null,
          pendingCommandId: null,
          createdAt: at,
          updatedAt: at,
        },
        fixture.xml,
      );
      const publisher = new DraftPublisher();
      const ctx = {
        store,
        client: fakeClient({
          id: "424242",
          title: "합성 기획 문서",
          version: 7,
          storage: fixture.remoteXml,
        }),
        rootId: "9",
        enabled: false,
        accountId: "acc-1",
        now: () => new Date(),
      };
      globalThis.gc?.();
      const heapBefore = process.memoryUsage().heapUsed;
      const t0 = performance.now();
      const result = await publisher.rebase(ctx, "p-424242");
      samples.push(performance.now() - t0);
      heaps.push(process.memoryUsage().heapUsed - heapBefore);
      // 결과의 뜻 — 부딪침이 없어야 하고, 아무도 못 건드린 블록은 원문 바이트 그대로여야 한다.
      if (result.state !== "editing")
        throw new Error(`다시 맞춘 판이 editing 이 아니다: ${result.state}`);
      if (result.blocks.length !== fixture.total) {
        throw new Error(`블록 수가 다르다: ${result.blocks.length} != ${fixture.total}`);
      }
      const baseDoc = parseStorage(fixture.xml);
      for (const block of result.blocks) {
        const hit = /문서자리-(원격새)?(\d+)/.exec(block.xml);
        if (hit === null) throw new Error("자리 표식이 없는 블록이 나왔다");
        if (block.theirsXml !== undefined) throw new Error("뜻밖의 충돌 블록이 있다");
        const idx = Number.parseInt(hit[2], 10);
        if (
          hit[1] !== undefined ||
          fixture.remoteIdx.includes(idx) ||
          fixture.mineIdx.includes(idx)
        )
          continue;
        const baseBlock = baseDoc.blocks[idx];
        if (baseBlock === undefined || baseBlock.xml !== block.xml) {
          throw new Error(`고치지 않은 블록의 바이트가 달라졌다: ${idx}`);
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  return { ms: median(samples), heap: median(heaps) };
}

// ————— 재기 —————

/** 한 크기의 문서에서 여섯 작업의 시간을 잰다. */
async function 크기잰기(name, count) {
  const xml = buildDoc(count);
  const doc = parseStorage(xml);
  const bytes = Buffer.byteLength(xml);
  if (serializeStorage(doc) !== xml)
    throw new Error(`${name}: parse → serialize 의 바이트가 다르다`);

  const draft = {
    format: 1,
    docKey: "p-424242",
    kind: "existing",
    site: "https://합성.example.net",
    pageId: "424242",
    spaceId: "COLO",
    parent: null,
    title: "합성 기획 문서",
    baseTitle: null,
    baseVersion: 4,
    baseFetchedAt: null,
    revision: 1,
    state: "editing",
    frame: doc.frame,
    blocks: doc.blocks.map((block) => ({ ...block, baseFingerprint: blockFingerprint(block.xml) })),
    observedVersion: null,
    pendingCommandId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (composeDraftBody(draft) !== xml)
    throw new Error(`${name}: composeDraftBody 의 바이트가 다르다`);

  const changed = doc.blocks.find((block) => block.kind === "paragraph" && block.xml.length > 200);
  const changedProj = projectBlock(changed);
  const changedView = { ...changedProj.view, text: `${changedProj.view.text} (고침)` };

  const meta = {
    pageId: "424242",
    space: "COLO",
    title: "합성 기획 문서",
    version: 4,
    updatedAt: null,
  };
  const rows = [];
  rows.push([`parseStorage`, ms(중앙값ms(() => parseStorage(xml)))]);
  rows.push([`serializeStorage`, ms(중앙값ms(() => serializeStorage(doc)))]);
  rows.push([
    `projectBlock 전체(${doc.blocks.length}블록)`,
    ms(
      중앙값ms(() => {
        for (const b of doc.blocks) projectBlock(b);
      }),
    ),
  ]);
  rows.push([`renderBlock(블록 1 고침)`, ms(중앙값ms(() => renderBlock(changed, changedView)))]);
  rows.push([`composeDraftBody`, ms(중앙값ms(() => composeDraftBody(draft)))]);
  rows.push([`deriveMarkdown`, ms(중앙값ms(() => deriveMarkdown(xml, meta)))]);
  const rebase = await 재다시맞추기(buildRebaseFixture(count));
  rows.push([`rebase(고침 30+30 · 넣음 10 · 뺌 10)`, `${ms(rebase.ms)} (${mb(rebase.heap)})`]);

  // 문서에 심은 긴 문단(서식 500개) — 투영과 렌더를 따로 잰다.
  const long = doc.blocks.find((block) => block.xml.includes("<p>긴문단-"));
  const longProj = projectBlock(long);
  const longView = { ...longProj.view, text: `${longProj.view.text} (고침)` };
  rows.push([`긴 문단 500 서식 · projectBlock`, ms(중앙값ms(() => projectBlock(long)))]);
  rows.push([`긴 문단 500 서식 · renderBlock`, ms(중앙값ms(() => renderBlock(long, longView)))]);
  return { rows, bytes, blocks: doc.blocks.length };
}

/** 인라인 서식 5,000개짜리 문단 하나 — 구분자 스택이 제곱으로 자라는지 보는 재기다. */
function 긴문단잰기(formatCount) {
  const xml = 긴문단(formatCount, 0);
  const block = parseStorage(xml).blocks[0];
  const proj = projectBlock(block);
  const view = { ...proj.view, text: `${proj.view.text} (고침)` };
  return {
    project: 중앙값ms(() => projectBlock(block)),
    render: 중앙값ms(() => renderBlock(block, view)),
    bytes: Buffer.byteLength(xml),
  };
}

const sizes = [
  ["보통", 200],
  ["큼", 1500],
  ["아주 큼", 5000],
];

export async function runBench(out = console) {
  const table = [];
  for (const [name, count] of sizes) {
    const { rows, bytes, blocks } = await 크기잰기(name, count);
    out.log(`\n# ${name} — 블록 ${blocks}개 · ${mb(bytes)}`);
    for (const [task, value] of rows) table.push([task, name, value]);
  }
  for (const count of [500, 5000, 20000]) {
    const r = 긴문단잰기(count);
    table.push([`긴 문단 ${count} 서식 · projectBlock`, "단독", ms(r.project)]);
    table.push([`긴 문단 ${count} 서식 · renderBlock`, "단독", ms(r.render)]);
  }
  // 표 — 작업 · 크기별 ms · 메모리(rebase 괄호 안).
  const tasks = [...new Set(table.map((row) => row[0]))];
  const lines = ["| 작업 | 보통 | 큼 | 아주 큼 | 단독 |", "|---|---|---|---|---|"];
  for (const task of tasks) {
    const pick = (size) => table.find((row) => row[0] === task && row[1] === size)?.[2] ?? "-";
    lines.push(
      `| ${task} | ${pick("보통")} | ${pick("큼")} | ${pick("아주 큼")} | ${pick("단독")} |`,
    );
  }
  out.log(`\n# 측정(중앙값 5회 · 시간 ms · rebase 괄호는 heapUsed 차)\n${lines.join("\n")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runBench();
}
