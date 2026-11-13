import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, startBrowserFixture } from "./browser-fixture.ts";

// 2026-11-12 UI 조사 U-029 · U-030 · U-045 · U-046 · U-047.
// node --test 로 실행하면 빈 포트에서 격리 견본 서버를 연다.
test("대화 비동기 여정 — 첨부 귀속·검색 재시도·답장 세대·발행 취소·근거 실패", {
  skip: chromium ? false : "전역 Playwright가 없는 환경",
}, async (t) => {
  const fixture = await startBrowserFixture();
  t.after(() => fixture.close());
  const b = await chromium.launch({ headless: true });
  t.after(() => b.close());
  const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
  p.setDefaultTimeout(15000);
  p.setDefaultNavigationTimeout(30000);
  const errors = [];
  p.on("pageerror", (e) => {
    errors.push(e.message);
  });
  await p.goto(`${fixture.url}/dev/thread-fixture.html?scene=empty`);
  await p.waitForTimeout(300);
  await p.evaluate(async (imports) => {
    const React = (await import(imports.react)).default;
    const { createRoot } = (await import(imports.dom)).default;
    const { Composer } = await import("/src/next/chat/Composer.tsx");
    const { ReplyBox } = await import("/src/next/chat/cards.tsx");
    const { PlanSyncLine } = await import("/src/next/chat/PlanSyncLine.tsx");
    const { PlanRefStrip } = await import("/src/next/chat/PlanRefStrip.tsx");
    const { mockDaemon } = await import("/dev/overlay-mocks.ts");
    const d = mockDaemon();
    d.api = { planRefresh: async () => ({}) };
    document.getElementById("root").style.display = "none";
    const div = document.createElement("div");
    div.className = "nx";
    div.style =
      "display:block;position:fixed;top:450px;left:200px;width:420px;height:auto;overflow:visible;z-index:99999";
    document.body.append(div);
    const root = createRoot(div);
    const h = React.createElement;
    const sessions = {
      commands: [],
      history: [],
      chipTarget: () => ({
        subject: "session",
        key: "test",
        provider: "claude",
        model: null,
        effort: null,
        fastMode: false,
        models: [],
        setModel: async () => {},
        setEffort: async () => {},
      }),
      refreshUsage: () => {},
    };
    let key = "a";
    let handle: { attach: (files: File[]) => void } | null = null;
    const files = {};
    window.results = { sent: 0, reply: 0, refs: 0 };
    window.readers = [];
    const Reader = window.FileReader;
    window.FileReader = class extends Reader {
      readAsDataURL(file) {
        window.readers.push(() =>
          file.name === "bad.txt" ? this.onerror(new Event("error")) : super.readAsDataURL(file),
        );
      }
    };
    d.api.findFiles = (q) =>
      new Promise((resolve, reject) => {
        files[q] = { resolve, reject };
      });
    const render = () =>
      root.render(
        h(Composer, {
          daemon: d,
          sessions,
          subject: "session",
          draftKey: key,
          placeholder: "message",
          onToast: () => {},
          onSend: async () => {
            window.results.sent++;
          },
          registerHandle: (v) => (handle = v),
        }),
      );
    window.switchTo = (k) => {
      key = k;
      render();
    };
    window.attach = () =>
      handle.attach([
        new File(["ok"], "good.txt", { type: "text/plain" }),
        new File(["bad"], "bad.txt", { type: "text/plain" }),
      ]);
    window.finishReads = () =>
      window.readers.splice(0).forEach((fn) => {
        fn();
      });
    window.files = files;
    render();
    let replyResolve: (() => void) | undefined;
    let replyKey = 0;
    window.showReply = () =>
      root.render(
        h(ReplyBox, {
          key: ++replyKey,
          placeholder: "reply",
          onSend: () => new Promise((r) => (replyResolve = r)),
          onSent: () => {
            window.results.reply++;
          },
        }),
      );
    window.finishReply = () => replyResolve();
    window.showSync = (result) =>
      root.render(
        h(PlanSyncLine, {
          key: result,
          requestId: "r",
          screenTitle: () => "",
          sync: {
            phase: "done",
            docs: [{ docKey: "p-1", pageId: "1", title: "문서", outcome: "adopted", changes: 1 }],
            linked: [],
          },
          hand: { publish: async () => result, open: () => {}, undo: async () => {} },
        }),
      );
    let refFail = true;
    d.api.draftRefs = async () => {
      window.results.refs++;
      if (refFail) throw Error("offline");
      return {
        refs: [
          {
            ref: {
              pageId: "1",
              title: "근거",
              docKey: null,
              version: 1,
              revision: null,
              sections: [],
            },
          },
        ],
      };
    };
    window.showRefs = () =>
      root.render(
        h(PlanRefStrip, { daemon: d, sessionId: "a", sentCount: 1, nav: {}, forceOpen: true }),
      );
    window.fixRefs = () => {
      refFail = false;
    };
  }, fixture.imports);
  await p.waitForTimeout(200);
  await p.evaluate(() => window.attach());
  await p.waitForTimeout(30);
  assert.match(await p.locator(".nx-cmp-note").last().textContent(), /읽고/);
  await p.evaluate(() => window.switchTo("b"));
  await p.waitForTimeout(50);
  await p.evaluate(() => window.finishReads());
  await p.waitForTimeout(150);
  assert.equal(await p.locator(".nx-att").count(), 0);
  await p.evaluate(() => window.switchTo("a"));
  await p.waitForTimeout(100);
  assert.equal(await p.locator(".nx-att").count(), 1);
  assert.match(await p.locator(".nx-att").textContent(), /good.txt/);
  assert.match(await p.locator(".nx-cmp-note").last().textContent(), /bad.txt/);
  const ta = p.locator("textarea:visible").last();
  await ta.fill("@old");
  await ta.press("End");
  await p.waitForTimeout(400);
  await p.waitForFunction(() => !!window.files.old);
  await p.evaluate(() => window.files.old.resolve(["old.txt"]));
  await p.waitForTimeout(60);
  assert.equal(await p.locator("[role=option]:visible").count(), 1);
  await ta.fill("@new");
  await ta.press("End");
  await ta.press("Enter");
  assert.equal(await ta.inputValue(), "@new");
  assert.equal(await p.evaluate(() => window.results.sent), 0);
  await p.waitForFunction(() => !!window.files.new);
  await p.evaluate(() => window.files.new.reject(Error("network")));
  await p.getByRole("button", { name: "다시 읽기", exact: true }).click();
  await p.waitForTimeout(170);
  await p.evaluate(() => window.files.new.resolve(["new.txt"]));
  await p.waitForTimeout(80);
  await ta.press("Enter");
  assert.match(await ta.inputValue(), /new.txt/);
  await p.evaluate(() => window.showReply());
  await p.waitForTimeout(60);
  await p.getByPlaceholder("reply").fill("first");
  await p.getByPlaceholder("reply").press("Enter");
  await p.evaluate(() => window.showReply());
  await p.waitForTimeout(60);
  await p.getByPlaceholder("reply").fill("second");
  await p.evaluate(() => window.finishReply());
  await p.waitForTimeout(60);
  assert.equal(await p.getByPlaceholder("reply").inputValue(), "second");
  assert.equal(await p.evaluate(() => window.results.reply), 0);
  await p.evaluate(() => window.showSync("cancelled"));
  await p.waitForTimeout(60);
  await p.getByRole("button", { name: "발행", exact: true }).click();
  await p.waitForTimeout(60);
  assert.equal(await p.locator(".nx-tone--red:visible").count(), 0);
  await p.evaluate(() => window.showSync("failed"));
  await p.waitForTimeout(60);
  await p.getByRole("button", { name: "발행", exact: true }).click();
  await p.waitForTimeout(60);
  assert.match(await p.locator(".nx-psync").textContent(), /발행하지 못/);
  await p.evaluate(() => window.showRefs());
  await p.waitForTimeout(60);
  assert.equal(await p.getByRole("button", { name: "다시 읽기", exact: true }).count(), 1);
  await p.evaluate(() => window.fixRefs());
  await p.getByRole("button", { name: "다시 읽기", exact: true }).click();
  await p.waitForTimeout(70);
  assert.match(await p.locator(".nx-pref").textContent(), /근거/);
  assert.deepEqual(errors, []);
  await b.close();
});
