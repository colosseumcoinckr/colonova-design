import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import { MemoryCredentialStore } from "../../daemon/dist/credentials.js";
import { DraftPublisher } from "../../daemon/dist/draft-publish.js";
import { DraftService } from "../../daemon/dist/draft-service.js";
import { type DraftRecord, DraftStore } from "../../daemon/dist/draft-store.js";
import { blockFingerprint, parseStorage } from "../../daemon/dist/storage-blocks.js";
import type { Daemon } from "../src/lib/daemon-client.ts";

/** 기준 원문 → 선로 → 기존 읽기 렌더러를 함께 확인한다(2026-11-11 독립 검토 수정).
 * 합성 초안만 쓰며 Vite는 변환만 한다. 포트 · 브라우저 · 실사이트를 열지 않는다. */
let vite: ViteDevServer;
let DraftChanges: typeof import("../src/next/plans/draft/DraftChanges.tsx").DraftChanges;
before(async () => {
  vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, ws: false, watch: null },
    appType: "custom",
  });
  ({ DraftChanges } = await vite.ssrLoadModule("/src/next/plans/draft/DraftChanges.tsx"));
});
after(async () => {
  await vite?.close();
});

const KEY = "p-123";
const STORAGE = `<p>그대로 둘 문단</p>
<ac:structured-macro ac:name="info"><ac:rich-text-body><p>삭제 전 출고 승인 조건</p></ac:rich-text-body></ac:structured-macro>
<table><tbody><tr><td colspan="2"><p>병합 표의 승인 한도</p></td></tr></tbody></table>
<ul><li>상위 조건<ul><li>하위 예외 조건</li></ul></li></ul>`;

function rig() {
  const root = mkdtempSync(join(tmpdir(), "preserved-review-"));
  const store = new DraftStore(join(root, "plans"));
  const parsed = parseStorage(STORAGE);
  const record: DraftRecord = {
    format: 1,
    docKey: KEY,
    kind: "existing",
    site: "example.atlassian.net",
    pageId: "123",
    spaceId: "space",
    parent: null,
    title: "출고 정책",
    baseTitle: "출고 정책",
    baseVersion: 7,
    baseFetchedAt: "2026-11-11T00:00:00Z",
    revision: 0,
    state: "editing",
    frame: parsed.frame,
    blocks: parsed.blocks.map((block) => ({
      ...block,
      baseFingerprint: blockFingerprint(block.xml),
    })),
    observedVersion: null,
    pendingCommandId: null,
    createdAt: "2026-11-11T00:00:00Z",
    updatedAt: "2026-11-11T00:00:00Z",
  };
  store.create(record, STORAGE);
  let remoteCalls = 0;
  const service = new DraftService({
    registry: { activeSlug: () => "demo", paths: () => ({ root }) },
    machineSetting: { get: () => null },
    credentials: new MemoryCredentialStore(),
    claudeExecutable: () => null,
    broadcast() {},
    logger: { info() {}, warn() {}, error() {} },
    ai: async () => {
      throw new Error("검토에서 AI를 부르지 않는다");
    },
    publisher: new DraftPublisher(),
    transport: () => ({
      async request() {
        remoteCalls += 1;
        throw new Error("검토에서 원격을 부르지 않는다");
      },
    }),
  });
  const api = new Proxy({} as Daemon["api"], {
    get() {
      return () => {
        throw new Error("본문 검토는 읽기 렌더러만 쓴다");
      };
    },
  });
  const render = async () => {
    const before = store.read(KEY);
    const base = await service.revision(KEY, 0);
    const draft = await service.get(KEY);
    const html = renderToStaticMarkup(
      createElement(DraftChanges, {
        base,
        title: draft.title,
        blocks: draft.blocks,
        api,
        pageId: draft.pageId,
      }),
    );
    assert.deepEqual(store.read(KEY), before, "검토 읽기는 초안을 바꾸지 않는다");
    assert.equal(store.readBase(KEY), STORAGE, "기준 원문은 그대로다");
    assert.equal(remoteCalls, 0);
    return { base, draft, html };
  };
  return {
    store,
    record,
    service,
    render,
    cleanup() {
      service.stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("삭제된 정보 상자 · 병합 표 · 중첩 목록의 기준 판 내용을 실제로 그린다", async () => {
  const r = rig();
  try {
    const opened = await r.service.get(KEY);
    const preserved = opened.blocks.filter((block) => block.view.kind === "preserved");
    assert.equal(preserved.length, 3);
    await r.service.edit(
      KEY,
      opened.revision,
      preserved.map((block) => ({ type: "delete", blockId: block.id })),
    );
    const { base, draft, html } = await r.render();
    assert.equal(draft.blocks.length, 1);
    assert.equal(base.blocks.filter((block) => block.preview !== undefined).length, 3);
    assert.equal(base.blocks[0]?.preview, undefined, "일반 문단의 응답은 늘리지 않는다");
    assert.match(html, /삭제 전 출고 승인 조건/);
    assert.match(html, /colSpan="2"|colspan="2"/);
    assert.match(html, /병합 표의 승인 한도/);
    assert.match(html, /하위 예외 조건/);
    assert.match(html, /nx-dv--preview/);
  } finally {
    r.cleanup();
  }
});

test("같은 종류의 보존 블록이 바뀌어도 기준 판과 초안의 서로 다른 원문을 그린다", async () => {
  const r = rig();
  try {
    r.store.save(
      {
        ...r.record,
        blocks: r.record.blocks.map((block) => ({
          ...block,
          xml: block.xml.replace("삭제 전 출고 승인 조건", "수정 후 출고 승인 조건"),
        })),
      },
      r.record.revision,
    );
    const { base, draft, html } = await r.render();
    assert.equal(draft.blocks[1]?.status, "changed");
    assert.notDeepEqual(base.blocks[1]?.preview, draft.blocks[1]?.preview);
    assert.match(html, /삭제 전 출고 승인 조건/);
    assert.match(html, /수정 후 출고 승인 조건/);
    assert.ok(html.indexOf("삭제 전 출고 승인 조건") < html.indexOf("수정 후 출고 승인 조건"));
  } finally {
    r.cleanup();
  }
});
