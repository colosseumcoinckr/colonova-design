import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, startBrowserFixture } from "./browser-fixture.ts";

// 2026-11-12 CHAT 검토 발견 1·2·5 — 격리 견본에서 실제 부품의 지연 응답을 제어한다.
test("CHAT 검토 회귀", { skip: chromium ? false : "전역 Playwright가 없는 환경" }, async (t) => {
  const fixture = await startBrowserFixture();
  t.after(() => fixture.close());
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const setup = async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(30000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${fixture.url}/dev/thread-fixture.html?scene=empty`);
    await page.locator("textarea").waitFor();
    await page.evaluate(async (imports) => {
      const React = (await import(imports.react)).default;
      const { createRoot } = (await import(imports.dom)).default;
      const { Composer } = await import("/src/next/chat/Composer.tsx");
      const { ChatColumn } = await import("/src/next/chat/ChatColumn.tsx");
      const { sendMismatchNow } = await import("/src/next/lib/mismatch-model.ts");
      const { mockDaemon } = await import("/dev/overlay-mocks.ts");
      document.getElementById("root").remove();
      const host = document.createElement("div");
      host.id = "review";
      host.className = "nx";
      host.style = "display:block;width:420px;height:800px;margin:auto";
      document.body.append(host);
      const root = createRoot(host);
      const h = React.createElement;
      const daemon = mockDaemon();
      const api = daemon.api;
      daemon.api = {
        planRefresh: api.planRefresh,
        draftRefs: (id) =>
          new Promise((resolve, reject) => window.refReads.push({ id, resolve, reject })),
      };
      const sessions = {
        activeId: null,
        active: null,
        list: [],
        queue: [],
        outgoing: [],
        dropped: [],
        usage: null,
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
        setError: () => {},
        refreshUsage: () => {},
      };
      let key = "a";
      let handle: { attach: (files: File[]) => void } | null = null;
      window.sent = [];
      window.reads = [];
      window.refReads = [];
      const Reader = window.FileReader;
      window.FileReader = class extends Reader {
        readAsDataURL(file) {
          window.reads.push(() =>
            file.name === "bad.txt" ? this.onerror(new Event("error")) : super.readAsDataURL(file),
          );
        }
      };
      const render = () =>
        root.render(
          h(Composer, {
            daemon,
            sessions,
            subject: "session",
            draftKey: key,
            placeholder: "review message",
            listenPinsSend: true,
            onToast: () => {},
            onSend: async (text, attachments) => window.sent.push({ text, attachments }),
            registerHandle: (value) => {
              handle = value;
            },
          }),
        );
      window.switchTo = (next) => {
        key = next;
        render();
      };
      window.attach = (names) =>
        handle.attach(names.map((name) => new File([name], name, { type: "text/plain" })));
      window.finishReads = () =>
        window.reads.splice(0).forEach((finish) => {
          finish();
        });
      window.mismatch = () =>
        sendMismatchNow({
          api: {
            draftSnapshot: async () => ({
              attachment: { name: "plan.md", mediaType: "text/markdown", data: "cGxhbg==" },
            }),
          },
          brief: "계획대로 고쳐 주세요",
          target: { pageId: "1" },
        });
      window.showColumn = (id, sentCount) => {
        root.render(
          h(ChatColumn, {
            daemon,
            settings: { chat: { showThinking: true, showTools: true, disabledProviders: [] } },
            sessions: {
              ...sessions,
              activeId: id,
              active: {
                blocks: Array.from({ length: sentCount }, (_, i) => ({
                  type: "user",
                  id: `user-${i}`,
                  text: "말",
                  images: 0,
                })),
              },
            },
            pins: { list: [], ghosts: [] },
            project: null,
            nav: { showRightTab: () => {}, toast: () => {} },
            narrow: false,
          }),
        );
      };
      window.resolveRefs = (index, title) =>
        window.refReads[index].resolve({
          refs: title
            ? [
                {
                  ref: {
                    pageId: "1",
                    title,
                    docKey: null,
                    version: 1,
                    revision: null,
                    sections: [],
                  },
                },
              ]
            : [],
        });
      render();
    }, fixture.imports);
    await page.getByPlaceholder("review message").waitFor();
    t.after(async () => {
      await page.close();
      assert.deepEqual(errors, []);
    });
    return page;
  };

  await t.test(
    "발견 1: 첨부 읽는 중 바로 보내기는 거짓 성공 없이 브리프와 근거를 남긴다",
    async () => {
      const p = await setup();
      await p.evaluate(() => window.attach(["good.txt"]));
      await p.waitForFunction(() => window.reads.length === 1);
      assert.equal(await p.evaluate(() => window.mismatch()), "prefilled");
      assert.equal(await p.evaluate(() => window.sent.length), 0);
      assert.equal(await p.getByPlaceholder("review message").inputValue(), "계획대로 고쳐 주세요");
      assert.match(await p.locator("#review .nx-att").textContent(), /plan.md/);
      assert.equal(await p.locator("#review .nx-send").isDisabled(), true);
      await p.evaluate(() => window.finishReads());
      await p.waitForFunction(() => document.querySelectorAll("#review .nx-att").length === 2);
      await p.locator("#review .nx-send").click();
      await p.waitForFunction(() => window.sent.length === 1);
      assert.deepEqual(
        await p.evaluate(() => window.sent[0].attachments.map((a) => a.name).sort()),
        ["good.txt", "plan.md"],
      );
      assert.equal(await p.evaluate(() => window.mismatch()), "sent");
      await p.waitForFunction(() => window.sent.length === 2);
    },
  );

  await t.test("발견 2: 새 대화 초안 이월은 읽기 묶음·잠금·실패를 함께 옮긴다", async () => {
    const p = await setup();
    await p.evaluate(() => window.switchTo("new:review"));
    await p.getByPlaceholder("review message").fill("이월할 말");
    await p.evaluate(() => {
      window.attach(["good.txt"]);
      window.attach(["bad.txt"]);
    });
    await p.waitForFunction(() => window.reads.length === 2);
    await p.evaluate(() => window.switchTo("carried"));
    await p.waitForFunction(() => document.querySelector("#review textarea").value === "이월할 말");
    assert.equal(await p.locator("#review .nx-send").isDisabled(), true);
    await p.evaluate(() => window.switchTo("elsewhere"));
    await p.waitForFunction(() => document.querySelector("#review textarea").value === "");
    await p.evaluate(() => window.finishReads());
    await p.waitForTimeout(100);
    assert.equal(await p.locator("#review .nx-att").count(), 0);
    await p.evaluate(() => window.switchTo("carried"));
    await p.waitForFunction(() => document.querySelectorAll("#review .nx-att").length === 1);
    assert.equal(await p.getByPlaceholder("review message").inputValue(), "이월할 말");
    assert.match(await p.locator("#review .nx-att").textContent(), /good.txt/);
    assert.match(await p.locator("#review .nx-cmp-note").last().textContent(), /bad.txt/);
    assert.equal(await p.locator("#review .nx-send").isDisabled(), false);
    await p.evaluate(() => window.switchTo("new:review"));
    await p.waitForFunction(() => document.querySelector("#review textarea").value === "");
    assert.equal(await p.locator("#review .nx-att").count(), 0);
    assert.equal(await p.locator("#review .nx-cmp-note").filter({ hasText: "bad.txt" }).count(), 0);
  });

  await t.test("발견 5: 첫 조회와 실패는 알리고 같은 대화 재조회에는 칩을 유지한다", async () => {
    const p = await setup();
    await p.evaluate(() => window.showColumn("refs-a", 0));
    await p.waitForFunction(() => window.refReads.length === 1);
    assert.match(await p.locator("#review").textContent(), /읽는 중이에요/);
    await p.evaluate(() => window.resolveRefs(0, "근거"));
    await p.locator("#review .nx-dock-refs").waitFor();
    await p.locator("#review .nx-dock-refs").click();
    await p.locator("#review .nx-pref-chip").waitFor();
    await p.evaluate(() => window.showColumn("refs-a", 1));
    await p.waitForFunction(() => window.refReads.length === 2);
    assert.doesNotMatch(await p.locator("#review").textContent(), /읽는 중이에요/);
    assert.match(await p.locator("#review .nx-pref-chip").textContent(), /근거/);
    if (process.env.COLONOVA_CHAT_REVIEW_SHOTS) {
      await p.screenshot({
        path: join(process.env.COLONOVA_CHAT_REVIEW_SHOTS, "refs-refresh-light.png"),
      });
      await p.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
      });
      await p.screenshot({
        path: join(process.env.COLONOVA_CHAT_REVIEW_SHOTS, "refs-refresh-dark.png"),
      });
    }
    await p.evaluate(() => window.refReads[1].reject(Error("offline")));
    await p.getByRole("button", { name: "다시 읽기", exact: true }).waitFor();
    assert.match(await p.locator("#review .nx-pref-chip").textContent(), /근거/);
    await p.getByRole("button", { name: "다시 읽기", exact: true }).click();
    await p.waitForFunction(() => window.refReads.length === 3);
    assert.doesNotMatch(await p.locator("#review").textContent(), /읽는 중이에요/);
    await p.evaluate(() => window.resolveRefs(2, null));
    await p.waitForFunction(() => !document.querySelector("#review .nx-dock-refs"));
    await p.evaluate(() => window.showColumn("refs-a", 2));
    await p.waitForFunction(() => window.refReads.length === 4);
    assert.doesNotMatch(await p.locator("#review").textContent(), /읽는 중이에요/);
    await p.evaluate(() => window.showColumn("refs-b", 0));
    await p.waitForFunction(() => window.refReads.length === 5);
    assert.match(await p.locator("#review").textContent(), /읽는 중이에요/);
    await p.evaluate(() => window.resolveRefs(3, "늦은 근거"));
    assert.equal(await p.locator("#review .nx-dock-refs").count(), 0);
    await p.evaluate(() => window.resolveRefs(4, "새 근거"));
    await p.locator("#review .nx-dock-refs").waitFor();
  });
});
