import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const markup = (title: string) =>
  renderToStaticMarkup(
    createElement(PlansList, {
      rows: [
        {
          pageId: "1",
          kind: "doc",
          title,
          version: 1,
          folder: "",
          depth: 0,
          hasChildren: false,
          path: title,
        },
      ],
      drafts: [],
      phase: "ready",
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
    }),
  );
// 2026-11-12 UI 조사 U-068 — 12자 이하도 줄임 대상이고 그림글자는 두 요소로 나누지 않는다.
test("짧은 제목 전체를 줄일 수 있는 요소에 둔다", () => {
  for (const title of ["WWWWWWWWWWWW", "짧은정책서", "Short"]) {
    const html = markup(title);
    assert.ok(html.includes(`<span class="nx-pl-title-main">${title}</span>`));
    assert.doesNotMatch(html, /nx-pl-title-tail/);
  }
});
test("가족·국기·피부색·조합형 글자가 분할 경계에 걸려도 한 요소 안에 남는다", () => {
  for (const glyph of ["👨‍👩‍👧‍👦", "🇰🇷", "👍🏽", "e\u0301"]) {
    const html = markup(`${glyph} 정책서 v0.1`);
    assert.ok(html.includes(glyph));
    const long = markup(`앞머리${glyph}12345678901`);
    assert.ok(long.includes(`nx-pl-title-tail">${glyph}12345678901</span>`));
  }
});
const source = (name: string) =>
  readFileSync(new URL(`../src/next/plans/${name}`, import.meta.url), "utf8");
test("목차의 글자는 유지하고 누름 높이를 기존 24px 토큰으로 확보한다", () => {
  assert.match(
    source("view/doc-view.css"),
    /\.nx \.nx-dv-toc-link \{[^}]*min-height: var\(--h-xs\);[^}]*font-size: var\(--fs-ui\)/,
  );
  assert.match(
    source("plans.css"),
    /\.nx-pl-title-tail \{[^}]*max-width: 75%;[^}]*text-overflow: ellipsis/,
  );
});

// 2026-11-12 감독자 셸 검토 인계 — 공통 아이콘 단추와 같은 특이도로 보조 색을 지킨다.
test("기획 대화 메뉴 단추의 색은 셸 아이콘 단추 규칙에 지지 않는다", () => {
  assert.match(source("plans.css"), /\.nx \.nx-pl-conv-menu \{[^}]*color: var\(--ink3\)/);
});
