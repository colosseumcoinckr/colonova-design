import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";

let vite: ViteDevServer;
let Switch: typeof import("../src/next/settings/parts.tsx").Switch;
before(async () => {
  vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, ws: false, watch: null },
    appType: "custom",
  });
  ({ Switch } = await vite.ssrLoadModule("/src/next/settings/parts.tsx"));
});
after(async () => {
  await vite?.close();
});
test("저장 중 스위치는 눌리지 않고 진행 상태를 알린다", () => {
  const busy = renderToStaticMarkup(
    createElement(Switch, { on: true, label: "설정", disabled: true, onChange: () => {} }),
  );
  assert.match(busy, /disabled=""/);
  assert.match(busy, /aria-busy="true"/);
  assert.match(busy, /aria-checked="true"/);
  const ready = renderToStaticMarkup(
    createElement(Switch, { on: false, label: "설정", onChange: () => {} }),
  );
  assert.doesNotMatch(ready, /disabled|aria-busy/);
});
