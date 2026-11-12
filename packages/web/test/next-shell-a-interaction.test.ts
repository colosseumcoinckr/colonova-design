import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import { L } from "../src/next/labels.ts";
import { initialNav, navReducer } from "../src/next/lib/nav.ts";

let vite: ViteDevServer;
let InlineConfirm: typeof import("../src/next/ui/InlineConfirm.tsx").InlineConfirm;
let Toast: typeof import("../src/next/ui/Toast.tsx").Toast;
before(async () => {
  vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, ws: false, watch: null },
    appType: "custom",
  });
  ({ InlineConfirm } = await vite.ssrLoadModule("/src/next/ui/InlineConfirm.tsx"));
  ({ Toast } = await vite.ssrLoadModule("/src/next/ui/Toast.tsx"));
});
after(async () => {
  await vite?.close();
});

test("U-198: 진행 중 확인은 실행을 잠그고 닫기와 계속 처리 안내를 함께 말한다", () => {
  const props = {
    title: "request",
    confirmLabel: "execute",
    cancelLabel: "cancel",
    onConfirm() {},
    onCancel() {},
  };
  const busy = renderToStaticMarkup(createElement(InlineConfirm, { ...props, busy: true }));
  assert.match(busy, /aria-busy="true"/);
  assert.match(busy, /disabled=""[^>]*>execute/);
  assert.ok(busy.includes(L.inlineConfirm.close));
  assert.ok(busy.includes(L.inlineConfirm.continuesAfterClose));
  assert.doesNotMatch(busy, />cancel</);
  const idle = renderToStaticMarkup(createElement(InlineConfirm, props));
  assert.match(idle, />cancel</);
  assert.ok(!idle.includes(L.inlineConfirm.continuesAfterClose));
});

test("U-132: 빈 토스트도 낭독 영역을 남기고 동작 알림은 만료 막대가 없다", () => {
  const empty = renderToStaticMarkup(createElement(Toast, { toast: null, onDone() {} }));
  assert.match(empty, /role="status"/);
  assert.doesNotMatch(empty, /nx-toast-text/);
  const action = renderToStaticMarkup(
    createElement(Toast, {
      toast: { text: "notice", seq: 1, action: { label: "do", run() {} } },
      onDone() {},
    }),
  );
  assert.equal((action.match(/role="status"/g) ?? []).length, 1);
  assert.doesNotMatch(action, /nx-toast-bar/);
});

test("U-151: 다른 오른쪽 탭에서 대화 열기로 돌아오면 대화 상태를 되찾는다", () => {
  const history = navReducer(initialNav(false), { type: "right-tab", tab: "history" });
  assert.equal(navReducer(history, { type: "thread" }).rightTab, "chat");
  const workspace = readFileSync(new URL("../src/next/Workspace.tsx", import.meta.url), "utf8");
  assert.match(workspace, /rightTab=\{narrow \? "chat" : state.rightTab\}/);
});

test("U-159 · U-160 · U-196: 실제 셸 호출부가 공통 탭·초점 계약을 잇는다", () => {
  const workspace = readFileSync(new URL("../src/next/Workspace.tsx", import.meta.url), "utf8");
  assert.equal((workspace.match(/aria-controls=\{`\$\{tabsId\}-\w+-panel`\}/g) ?? []).length, 3);
  assert.match(workspace, /nextTabIndex\(event.key, buttons.length, at\)/);
  assert.match(workspace, /useModalFocus\(sidebarRef, narrow && state.drawer\)/);
  assert.match(workspace, /inert=\{narrow && state.drawer\}/);
  assert.match(
    workspace,
    /if \(overlayOpen\(\) \|\| drawerOpen.current\)\s*\{\s*event.preventDefault\(\);\s*return;\s*\}/,
  );
  assert.match(workspace, /focusableElements\(region\)\[0\]/);
});

test("U-144 · U-194 · U-195: 실패 보존·공통 복사·줄인 움직임의 호출부 회귀를 막는다", () => {
  const problem = readFileSync(
    new URL("../src/next/status/ProblemLine.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(problem, /finally\(onClearInvite\)/);
  assert.match(problem, /catch\(\(\) => setCleanup\("failed"\)\)/);
  for (const file of ["ProblemLine", "WorkPopover"]) {
    const source = readFileSync(new URL(`../src/next/status/${file}.tsx`, import.meta.url), "utf8");
    assert.match(source, /<CopyButton/);
    assert.doesNotMatch(source, /useCopied/);
  }
  const submit = readFileSync(
    new URL("../src/next/status/SubmitPopover.tsx", import.meta.url),
    "utf8",
  );
  assert.match(submit, /scrollToTarget\(notices.current/);
  assert.doesNotMatch(submit, /behavior: "smooth"/);
});

test("U-055: 제출 범위는 화면 연결 미확인 파일 수로 말한다", () => {
  assert.equal(L.submitConfirm.outsideScreens(6), "화면에 연결되지 않은 파일 6개");
  assert.equal(
    L.submitConfirm.summaryOutside(6, "developer"),
    "화면에 연결되지 않은 파일 6개를 developer에게 제출해요",
  );
  assert.equal(L.submitConfirm.summaryOutside(6, ""), "화면에 연결되지 않은 파일 6개를 제출해요");
  assert.ok(L.submitConfirm.outsideDetail.includes("화면이 바뀌지 않았다는 뜻은 아니에요"));
});

test("NOTE-1: 팝 캡처는 안쪽 확인의 Escape 처리를 먼저 보낸다", () => {
  const source = readFileSync(new URL("../src/next/ui/Popover.tsx", import.meta.url), "utf8");
  const owns = source.indexOf('event.target.closest(".nx-iconf")');
  const stops = source.indexOf("event.stopImmediatePropagation()", owns);
  assert.ok(owns >= 0 && stops > owns);
  assert.match(source.slice(owns, stops), /if \(owner && el.contains\(owner\)\) return;/);
});
