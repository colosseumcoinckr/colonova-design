import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";

let vite: ViteDevServer;
let dock: typeof import("../src/next/chat/WorkDock.tsx");
let thread: typeof import("../src/next/chat/Thread.tsx");
let cards: typeof import("../src/next/chat/cards.tsx");
before(async () => {
  vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, ws: false, watch: null },
    appType: "custom",
  });
  dock = await vite.ssrLoadModule("/src/next/chat/WorkDock.tsx");
  thread = await vite.ssrLoadModule("/src/next/chat/Thread.tsx");
  cards = await vite.ssrLoadModule("/src/next/chat/cards.tsx");
});
after(async () => {
  await vite?.close();
});
const noop = () => {};
const dockProps = {
  row: { kind: "run" },
  runWord: "작업 중",
  startedAt: null,
  plan: null,
  onStop: noop,
  stopping: false,
  onAskGo: noop,
  entries: 0,
  daemon: { api: {} },
  sessionId: "a",
  nav: {},
} as unknown as Parameters<typeof import("../src/next/chat/WorkDock.tsx").WorkDock>[0];

test("U-048 계획이 없으면 열 수 없는 팝을 약속하지 않는다", () => {
  const html = renderToStaticMarkup(createElement(dock.WorkDock, dockProps));
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /aria-haspopup="dialog"|aria-expanded="true"/);
});
test("U-047 근거 0과 읽기 실패가 구별되고 실패에는 재시도가 남는다", () => {
  const html = renderToStaticMarkup(
    createElement(dock.WorkDock, {
      ...dockProps,
      row: null,
      refPhase: "failed",
      onRefsRetry: noop,
    }),
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /다시 읽기/);
  assert.equal(renderToStaticMarkup(createElement(dock.WorkDock, { ...dockProps, row: null })), "");
});
test("U-023 첨부만 있는 대기 요청도 그림과 파일 수를 보여 준다", () => {
  const props = {
    blocks: [],
    queue: [{ id: "q", text: "", images: 1, files: 2 }],
    outgoing: [],
    dropped: [],
    live: false,
    preparing: false,
  };
  const html = renderToStaticMarkup(createElement(thread.Thread, props as never));
  assert.match(html, /그림 1장/);
  assert.match(html, /파일 2개/);
});
test("U-197 기술 오류는 안내문으로 표시하고 받은 원문은 접힌 자료에 남는다", () => {
  const html = renderToStaticMarkup(
    createElement(cards.NoticeCard, {
      marker: { kind: "notice", text: "API token invalid /tmp/file" } as never,
      body: "original",
    }),
  );
  assert.doesNotMatch(html, /<b>API/);
  assert.match(html, /original/);
});
