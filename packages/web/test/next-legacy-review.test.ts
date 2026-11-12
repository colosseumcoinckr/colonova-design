import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";

let vite: ViteDevServer;
before(async () => {
  vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, ws: false, watch: null },
    appType: "custom",
  });
});
after(async () => {
  await vite?.close();
});

test("U-037: 성공 집계는 혼합·전부 실패·재시도·실행 중을 구별한다", async () => {
  const { activityCounts } = await vite.ssrLoadModule("/src/components/transcript/activity.tsx");
  const ok = { type: "tool", name: "Write", done: true };
  const failed = { ...ok, isError: true };
  assert.equal(activityCounts([failed, ok]).file, 1);
  assert.equal(activityCounts([failed]).file, 0);
  assert.equal(activityCounts([failed, { ...ok, id: "retry" }]).file, 1);
  assert.equal(activityCounts([{ ...ok, done: false }]).file, 0);
  assert.equal(activityCounts([{ ...failed, name: "Bash" }]).command, 0);
});

test("U-224: 체크 이름은 서식을 푼 항목 글을 포함하고 하위 목록은 제외한다", async () => {
  const { Markdown } = await vite.ssrLoadModule("/src/components/Markdown.tsx");
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      text: "- [x] **첫째** 항목\n- [ ] 둘째 항목\n  - [ ] 안쪽 항목",
    }),
  );
  for (const name of ["끝남: 첫째 항목", "남음: 둘째 항목", "남음: 안쪽 항목"]) {
    assert.ok(html.includes(`aria-label="${name}"`), html);
  }
});
