import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import type * as markdown from "../src/components/Markdown.tsx";
import { markdownHeadings } from "../src/lib/markdown-headings.ts";

let vite: ViteDevServer;
let Markdown: typeof markdown.Markdown;
before(async () => {
  vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, ws: false, watch: null },
    appType: "custom",
  });
  ({ Markdown } = await vite.ssrLoadModule("/src/components/Markdown.tsx"));
});
after(async () => {
  await vite?.close();
});

test("U-090: 일반·상태 보존 조각은 읽을 때 초점을 잡지 않는다", () => {
  for (const machineTokens of [undefined, { t1: "macro:status:Green:완료" }]) {
    const html = renderToStaticMarkup(
      createElement(Markdown, {
        text: "조각 ⟦t1⟧",
        tokens: { t1: "보존한 표" },
        machineTokens,
      }),
    );
    assert.match(html, /<span class="nx-dr-tokenchip/);
    assert.doesNotMatch(html, /<button|<a /);
  }
});

test("U-090: 지우기 가능한 보존 조각만 대상 이름을 가진 단추다", () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      text: "⟦t1⟧",
      tokens: { t1: "보존한 표" },
      onTokenRemove: () => {},
    }),
  );
  assert.match(html, /<button/);
  assert.match(html, /aria-label="보존한 표 조각 지우기"/);
});

test("U-219: 한글·서식·중복 제목의 주소와 외부 링크를 구분한다", () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      text: "[안](#받는-곳) [밖](https://example.com)\n\n## **받는** 곳\n\n## 받는 곳\n\n## 받는 곳-1",
    }),
  );
  assert.ok(html.includes(`href="#${encodeURIComponent("받는-곳")}" rel=`));
  assert.match(html, /href="https:\/\/example.com" target="_blank"/);
  for (const anchor of ["받는-곳", "받는-곳-1", "받는-곳-1-1"]) {
    assert.ok(html.includes(`data-md-anchor="${anchor}"`));
  }
});

test("U-219: 문서별 접두가 다르고 기존 제목 자료를 보존한다", () => {
  const tree = {
    type: "root",
    children: [
      {
        type: "heading",
        children: [{ type: "text", value: "A" }],
        data: { hProperties: { title: "kept" } },
      },
    ],
  };
  markdownHeadings({ prefix: "doc-" })(tree);
  assert.deepEqual(tree.children[0]?.data.hProperties, {
    title: "kept",
    id: "doc-a",
    "data-md-anchor": "a",
  });
  const html = renderToStaticMarkup(
    createElement(
      "div",
      {},
      createElement(Markdown, { text: "# Same" }),
      createElement(Markdown, { text: "# Same" }),
    ),
  );
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, 2);
});

test("U-224: 읽기 체크 목록의 완료·남음은 체크 상태와 이름으로 읽는다", () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, { text: "- [x] 완료 항목\n- [ ] 남은 항목" }),
  );
  assert.match(html, /type="checkbox" disabled="" aria-label="끝남: 완료 항목" checked=""/);
  assert.match(html, /type="checkbox" disabled="" aria-label="남음: 남은 항목"/);
});

test("U-139: 현재 열린 실패 대화도 실패 표식과 상태 말을 보존한다", async () => {
  const { Palette } = await vite.ssrLoadModule("/src/components/shell/Palette.tsx");
  const html = renderToStaticMarkup(
    createElement(Palette, {
      titleForThread: (t: { title: string }) => t.title,
      activeSessionId: "t1",
      activeSlug: "demo",
      projects: [
        {
          slug: "demo",
          name: "Demo",
          phase: "ready",
          working: false,
          pendingCount: 0,
          pendingChanges: 0,
          handoff: null,
          threads: [
            { id: "t1", title: "실패 대화", state: "idle", updatedAt: "2026-11-12T10:00:00Z" },
          ],
        },
      ],
      hiddenThreads: { has: () => false },
      transcripts: { t1: { state: "error", blocks: [] } },
      onOpenThread: () => {},
      onCreateSession: () => {},
      onActivateProject: async () => true,
      onOpenSettings: () => {},
      onClose: () => {},
    }),
  );
  assert.match(html, /nx-dot--red/);
  assert.match(html, /AI가 멈췄어요|AI.*실패|AI.*못/);
  const { L } = await vite.ssrLoadModule("/src/next/labels.ts");
  assert.ok(html.includes(`${L.vocab.aiFailed} · ${L.palette.nowOpen}`));
});

test("U-221: 분리선은 각 조절 방식의 안내를 호버에도 보여 준다", async () => {
  const { Splitter } = await vite.ssrLoadModule("/src/components/shell/Splitter.tsx");
  for (const resetHint of ["기본 폭으로", "폭을 차례로"]) {
    const html = renderToStaticMarkup(
      createElement(Splitter, {
        side: "right",
        width: 400,
        bounds: { min: 320, max: 640 },
        active: false,
        label: "대화 폭",
        resetHint,
        onPointerDown: () => {},
        onPointerMove: () => {},
        onPointerUp: () => {},
        onNudge: () => {},
        onReset: () => {},
      }),
    );
    assert.ok(html.includes(`title="대화 폭 · ${resetHint}"`));
    assert.ok(html.includes(`aria-label="대화 폭 · ${resetHint}"`));
  }
});
