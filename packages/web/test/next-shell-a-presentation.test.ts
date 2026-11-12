import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ProjectSummary } from "@colonova-design/protocol";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import type { Daemon } from "../src/lib/daemon-client.ts";
import { L } from "../src/next/labels.ts";

let vite: ViteDevServer;
let ProjectSwitcher: typeof import("../src/next/sidebar/ProjectSwitcher.tsx").ProjectSwitcher;
before(async () => {
  vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, ws: false, watch: null },
    appType: "custom",
  });
  ({ ProjectSwitcher } = await vite.ssrLoadModule("/src/next/sidebar/ProjectSwitcher.tsx"));
});
after(async () => {
  await vite?.close();
});
const project = {
  slug: "sample",
  name: "sample",
  phase: "ready",
  working: false,
  pendingChanges: 0,
  handoff: null,
} as ProjectSummary;
function render(patch: Partial<ProjectSummary> = {}) {
  const active = { ...project, ...patch };
  return renderToStaticMarkup(
    createElement(ProjectSwitcher, {
      daemon: {} as Daemon,
      projects: [active],
      active,
      onSwitch: () => undefined,
      onToast() {},
    }),
  );
}
test("U-006: 머리의 제출 전 반복만 걷고 준비·진행·검토 상태는 남긴다", () => {
  assert.ok(!render().includes(L.cycle.draft));
  for (const [patch, word] of [
    [{ working: true }, L.journey.making],
    [{ phase: "cloning" }, L.sidebar.preparing],
    [{ phase: "missing" }, L.sidebar.notOpened],
    [{ handoff: { state: "open" } }, L.cycle.review],
  ] as const)
    assert.ok(render(patch as Partial<ProjectSummary>).includes(word));
});
const read = (file: string) =>
  readFileSync(new URL(`../src/next/${file}`, import.meta.url), "utf8");
test("U-168 · U-189: 고친 면은 색 토큰을 쓰며 사용하지 않는 선언 셋은 남기지 않는다", () => {
  assert.match(read("ui/ui.css"), /color: var\(--mark-ink\)/);
  assert.doesNotMatch(read("ui/ui.css"), /color: #fff;/);
  assert.doesNotMatch(read("sidebar/sidebar.css") + read("shell.css"), /rgba\(/);
  assert.doesNotMatch(read("next.css") + read("ui/tokens.css"), /--(?:serif|elev-3|w-home):/);
  // fs-hero는 크기 눈금의 명시 계약(next-tokens)이므로 유지한다.
  assert.match(read("ui/tokens.css"), /--fs-hero: 30px/);
});
test("U-135 · U-187 · U-190: 문서 곁말·메뉴 반경·개수 글자의 공통 규격", () => {
  assert.match(read("palette.css"), /min-height: var\(--h-input\)/);
  assert.match(
    read("palette.css"),
    /\.nx-pal-row:has\(\.nx-pal-folder\) \.nx-pal-folder\s*\{[^}]*flex: 1 1 100%/,
  );
  const menu = read("sidebar/sidebar.css").match(/\.nx \.nx-conv-menu\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(menu, /border-radius: var\(--r\)/);
  const count = read("ui/ui.css").match(/\.nx-cnt\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(count, /font-variant-numeric: tabular-nums/);
});

test("이관 U-136 · U-157 · U-164 · U-167: 간격·초점·강조 글자의 공통 규격", () => {
  const sheet = read("ui/sheet.css");
  assert.match(sheet, /min-height: var\(--h-md\)/);
  assert.match(sheet, /margin-bottom: var\(--sp-6\)/);
  assert.doesNotMatch(sheet, /border-bottom:/);
  assert.match(read("shell.css"), /\.nx \.nx-fold-cmp:focus-visible\s*\{[^}]*outline-offset: -4px/);
  assert.match(
    read("ui/ui.css"),
    /\.nx \.nx-pop:focus-visible\s*\{[^}]*outline: 2px solid var\(--focus\)/,
  );
  assert.match(read("ui/ui.css"), /\.nx-pill--accent\s*\{[^}]*color: var\(--accent-ink\)/);
  assert.match(
    read("next.css"),
    /\.nx \.nx-addr\.nx-addr--tint b\s*\{[^}]*color: var\(--accent-ink\)/,
  );
});
