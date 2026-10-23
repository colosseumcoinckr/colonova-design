/**
 * 큰 기획 문서의 상한 시험(합성) — `scripts/bench/*.test.mjs` 가 함께 도는 가벼운 시험
 * (2026-10-23 · 작업 P1). 문서 만들기는 plans-blocks.bench.mjs 의 것을 함께 쓴다.
 * 느린 기계를 위한 넉넉한 상한만 본다 — 「큼」 문서의 parse+serialize+project 는 2초 안,
 * 「큼」 rebase 는 3초 안, 인라인 서식 5,000개짜리 긴 문단의 투영 · 렌더는 1초 안.
 * 실제 문서 · 실제 Confluence 는 쓰지 않는다.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { composeDraftBody, DraftPublisher } from "../../packages/daemon/dist/draft-publish.js";
import { DraftStore } from "../../packages/daemon/dist/draft-store.js";
import {
  blockFingerprint,
  parseStorage,
  projectBlock,
  renderBlock,
  serializeStorage,
} from "../../packages/daemon/dist/storage-blocks.js";
import { buildDoc, buildRebaseFixture, 긴문단 } from "./plans-blocks.bench.mjs";

/** 밀리초를 재고 돌려준다. */
const 잰 = (run) => {
  const t0 = performance.now();
  const value = run();
  return { ms: performance.now() - t0, value };
};

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

test("큰 문서 — 블록 1500개의 parse · serialize · project 는 2초 안이고 원문 바이트를 지킨다", () => {
  const xml = buildDoc(1500);
  const doc = parseStorage(xml);
  const draft = {
    format: 1,
    docKey: "p-1",
    kind: "existing",
    site: "https://합성.example.net",
    pageId: "1",
    spaceId: null,
    parent: null,
    title: "합성",
    baseTitle: null,
    baseVersion: null,
    baseFetchedAt: null,
    revision: 1,
    state: "editing",
    frame: doc.frame,
    blocks: doc.blocks.map((block) => ({ ...block, baseFingerprint: blockFingerprint(block.xml) })),
    observedVersion: null,
    pendingCommandId: null,
    createdAt: "2026-10-23T00:00:00.000Z",
    updatedAt: "2026-10-23T00:00:00.000Z",
  };
  const { ms: parseMs, value: parsed } = 잰(() => parseStorage(xml));
  const { ms: serializeMs, value: round } = 잰(() => serializeStorage(parsed));
  const { ms: projectMs } = 잰(() => {
    for (const block of doc.blocks) projectBlock(block);
  });
  const { ms: composeMs, value: body } = 잰(() => composeDraftBody(draft));
  assert.equal(round, xml, "parse → serialize 의 바이트가 다르다");
  assert.equal(body, xml, "composeDraftBody 의 바이트가 다르다");
  assert.ok(
    parseMs + serializeMs + projectMs < 2000,
    `parse+serialize+project 가 2초를 넘었다: ${(parseMs + serializeMs + projectMs).toFixed(0)}ms (parse ${parseMs.toFixed(0)} · serialize ${serializeMs.toFixed(0)} · project ${projectMs.toFixed(0)} · compose ${composeMs.toFixed(0)})`,
  );
});

test("큰 문서 — 30개씩 고친 두 판의 rebase 는 3초 안이고 고치지 않은 블록은 원문 그대로다", async () => {
  const fixture = buildRebaseFixture(1500);
  const root = mkdtempSync(join(tmpdir(), "plans-blocks-test-"));
  try {
    const store = new DraftStore(root);
    const at = "2026-10-23T00:00:00.000Z";
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
      now: () => new Date(at),
    };
    const t0 = performance.now();
    const result = await publisher.rebase(ctx, "p-424242");
    const ms = performance.now() - t0;
    assert.ok(ms < 3000, `rebase 가 3초를 넘었다: ${ms.toFixed(0)}ms`);
    assert.equal(result.state, "editing", "서로 다른 블록을 고쳤으니 부딪침이 없어야 한다");
    assert.equal(result.blocks.length, fixture.total, "뺀 10 · 넣은 10이 서로 맞아야 한다");
    const baseDoc = parseStorage(fixture.xml);
    for (const block of result.blocks) {
      const hit = /문서자리-(원격새)?(\d+)/.exec(block.xml);
      assert.ok(hit !== null, "자리 표식이 없는 블록이 나왔다");
      if (hit === null) continue;
      if (
        hit[1] !== undefined ||
        fixture.mineIdx.includes(Number(hit[2])) ||
        fixture.remoteIdx.includes(Number(hit[2]))
      )
        continue;
      const baseBlock = baseDoc.blocks[Number(hit[2])];
      assert.ok(
        baseBlock !== undefined && baseBlock.xml === block.xml,
        `고치지 않은 블록 ${hit[2]} 의 바이트가 달라졌다`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("긴 문단 — 인라인 서식 5000개의 투영과 렌더는 각각 1초 안이다", () => {
  const xml = 긴문단(5000, 0);
  const block = parseStorage(xml).blocks[0];
  const { ms: projectMs, value: proj } = 잰(() => projectBlock(block));
  const view = { ...proj.view, text: `${proj.view.text} (고침)` };
  const { ms: renderMs, value: rendered } = 잰(() => renderBlock(block, view));
  assert.ok(rendered.ok, `렌더가 거절됐다: ${rendered.ok ? "" : rendered.reason}`);
  assert.ok(projectMs < 1000, `투영이 1초를 넘었다: ${projectMs.toFixed(0)}ms`);
  assert.ok(renderMs < 1000, `렌더가 1초를 넘었다: ${renderMs.toFixed(0)}ms`);
  const same = renderBlock(block, proj.view);
  assert.ok(same.ok && same.xml === xml, "고치지 않은 긴 문단은 원문 바이트 그대로여야 한다");
});
