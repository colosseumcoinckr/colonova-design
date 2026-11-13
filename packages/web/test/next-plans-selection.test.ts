import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";

let vite: ViteDevServer;
let PlansList: typeof import("../src/next/plans/PlansList.tsx").PlansList;
before(async () => {
  vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, ws: false, watch: null },
    appType: "custom",
  });
  ({ PlansList } = await vite.ssrLoadModule("/src/next/plans/PlansList.tsx"));
});
after(async () => {
  await vite?.close();
});
const noop = () => {};
const base = {
  rows: [
    {
      pageId: "1",
      kind: "doc" as const,
      title: "공식",
      version: 1,
      folder: "",
      depth: 0,
      hasChildren: false,
      path: "공식",
    },
  ],
  drafts: [],
  phase: "ready" as const,
  connected: true,
  rooted: true,
  expired: false,
  importing: false,
  query: "",
  onQuery: noop,
  collapsed: new Set<string>(),
  onToggle: noop,
  lastViewed: "1",
  onOpen: noop,
  onOpenDraft: noop,
  onRetry: noop,
  onImport: noop,
  onSettings: noop,
  hidden: false,
  focusId: null,
  onFocused: noop,
};
test("공식 문서와 본문 결과는 같은 현재 페이지 상태로 낭독된다", () => {
  const official = renderToStaticMarkup(createElement(PlansList, base));
  assert.match(official, /aria-current="page"[^>]*title="공식"/);
  const body = renderToStaticMarkup(
    createElement(PlansList, {
      ...base,
      query: "내용",
      bodySearch: { phase: "ready", hits: [{ pageId: "1", title: "공식", snippet: "내용" }] },
    }),
  );
  assert.match(body, /aria-current="page"[^>]*data-page-id="1"/);
});
test("새 초안도 현재 페이지 상태가 있고 폴더 본문은 펼침 상태를 갖는다", () => {
  const draft = {
    docKey: "new",
    pageId: null,
    title: "새 초안",
    revision: 1,
    state: "editing" as const,
    changedBlocks: 0,
    baseVersion: null,
    observedVersion: null,
    updatedAt: "2026-11-12T00:00:00Z",
  };
  const html = renderToStaticMarkup(
    createElement(PlansList, {
      ...base,
      activeDraftKey: "new",
      drafts: [draft],
      rows: [{ ...base.rows[0], kind: "folder", hasChildren: true }],
    }),
  );
  assert.match(html, /aria-expanded="true"[^>]*title="공식"/);
  assert.match(html, /aria-current="page"[^>]*aria-label="새 초안/);
});
test("목록 읽기 실패·만료를 본문이 안내할 때 작은 목록은 같은 실패를 반복하지 않는다", () => {
  const failed = renderToStaticMarkup(
    createElement(PlansList, { ...base, rows: [], phase: "failed", compact: true }),
  );
  assert.doesNotMatch(failed, /읽지 못했어요/);
  const expired = renderToStaticMarkup(
    createElement(PlansList, { ...base, rows: [], expired: true, compact: true }),
  );
  assert.doesNotMatch(expired, /만료|설정 열기/);
});
