import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";

let vite: ViteDevServer;
let ReadState: typeof import("../src/next/ui/ReadState.tsx").ReadState;
before(async () => {
  vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, ws: false, watch: null },
    appType: "custom",
  });
  ({ ReadState } = await vite.ssrLoadModule("/src/next/ui/ReadState.tsx"));
});
after(async () => {
  await vite?.close();
});

test("읽기 상태는 읽는 중 · 빈 값 · 실패 · 본문을 섞지 않는다", () => {
  const loading = renderToStaticMarkup(
    createElement(ReadState, { state: { phase: "loading" } }, "old-data"),
  );
  assert.match(loading, /aria-busy="true"/);
  assert.doesNotMatch(loading, /old-data|<button/);
  const empty = renderToStaticMarkup(createElement(ReadState, { state: { phase: "empty" } }));
  assert.match(empty, /표시할 내용이 없어요/);
  assert.doesNotMatch(empty, /<button|role="alert"/);
  const failed = renderToStaticMarkup(
    createElement(ReadState, { state: { phase: "failed", onRetry: () => {} }, body: "read-error" }),
  );
  assert.match(failed, /role="alert"/);
  assert.match(failed, /read-error/);
  assert.match(failed, /<button[^>]*>다시 읽기/);
  assert.equal(
    renderToStaticMarkup(createElement(ReadState, { state: { phase: "ready" } }, "new-data")),
    "new-data",
  );
});
