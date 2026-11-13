import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { L } from "../../src/next/labels.ts";
import { chromium, startBrowserFixture } from "./browser-fixture.ts";

// 2026-11-12 UI 조사 U-078 — 실제 확인판과 원격 요청의 완료 순서를 분리해 검증한다.
test("U-078: 코멘트 해결의 초점·Esc·진행 중 닫기·실패 알림", {
  skip: chromium ? false : "전역 Playwright가 없는 환경",
  timeout: 60000,
}, async (t) => {
  const fixture = await startBrowserFixture();
  t.after(() => fixture.close());
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  page.setDefaultTimeout(15000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${fixture.url}/dev/thread-fixture.html?scene=empty`);
  await page.locator("textarea").waitFor();
  await page.evaluate(async (imports) => {
    const React = (await import(imports.react)).default;
    const { createRoot } = (await import(imports.dom)).default;
    const { DocComments } = await import("/src/next/plans/comments/DocComments.tsx");
    document.getElementById("root").remove();
    const host = document.createElement("div");
    host.className = "nx";
    host.style = "display:block;width:440px;margin:24px auto;padding:16px;overflow:auto";
    document.body.append(host);
    window.resolveCalls = [];
    window.refreshes = [];
    window.outerEscapes = 0;
    const daemon = {
      api: {
        docCommentResolve: (command) =>
          new Promise((resolve, reject) => {
            window.resolveCalls.push({ command, resolve, reject });
          }),
      },
    };
    const comments = [1, 2].map((id) => ({
      id: `c${id}`,
      kind: "inline",
      version: 1,
      author: "기획자",
      body: `확인할 코멘트 ${id}`,
      createdAt: "2026-11-12T00:00:00Z",
      anchorText: "본문",
      editable: true,
    }));
    const root = createRoot(host);
    let generation = 0;
    window.renderComments = () =>
      root.render(
        React.createElement(
          "div",
          {
            onKeyDown: (event) => {
              if (event.key === "Escape") window.outerEscapes++;
            },
          },
          React.createElement(DocComments, {
            key: generation++,
            daemon,
            pageId: "page-1",
            comments,
            body: { current: null },
            onRefresh: (pageId) => window.refreshes.push(pageId),
            writable: true,
          }),
        ),
      );
    window.renderComments();
  }, fixture.imports);
  const row = () => page.locator(".nx-dc-row").first();
  const opener = () => row().getByRole("button", { name: L.comments.resolve, exact: true });
  const confirm = () => page.locator(".nx-iconf");
  const shot = async (name: string) => {
    if (!process.env.TAIL_SHOTS) return;
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(process.env.TAIL_SHOTS, `${name}-${theme}.png`) });
    }
  };

  await t.test("그만두기에 초점을 두고 Esc는 확인만 닫은 뒤 발신 단추로 돌아간다", async () => {
    await opener().click();
    const cancel = confirm().getByRole("button", { name: L.comments.cancel, exact: true });
    await page.waitForFunction(
      (label) => document.activeElement?.textContent === label,
      L.comments.cancel,
    );
    assert.equal(await cancel.evaluate((el) => el === document.activeElement), true);
    await shot("resolve-confirm");
    await cancel.press("Escape");
    await confirm().waitFor({ state: "detached" });
    assert.equal(await opener().evaluate((el) => el === document.activeElement), true);
    assert.equal(await page.evaluate(() => window.outerEscapes), 0);
  });

  await t.test(
    "진행 중에는 실행·다른 쓰기를 잠그고 닫은 뒤에도 결과를 같은 줄에 남긴다",
    async () => {
      await page.locator(".nx-dc textarea").fill("보존할 작성 중인 글");
      await opener().click();
      await confirm().getByRole("button", { name: L.comments.resolveGo, exact: true }).click();
      assert.equal(
        await confirm()
          .getByRole("button", { name: L.comments.resolveGo, exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await page
          .locator(".nx-dc-row")
          .nth(1)
          .getByRole("button", { name: L.comments.resolve, exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await page.locator(".nx-dc textarea").evaluate((el) => !!el.closest("[inert]")),
        true,
      );
      await shot("resolve-busy");
      await confirm()
        .getByRole("button", { name: L.inlineConfirm.close, exact: true })
        .press("Escape");
      await confirm().waitFor({ state: "detached" });
      assert.equal(await opener().evaluate((el) => el === document.activeElement), true);
      assert.equal(await page.evaluate(() => window.outerEscapes), 0);
      await opener().click();
      assert.equal(
        await confirm()
          .getByRole("button", { name: L.comments.resolveGo, exact: true })
          .isDisabled(),
        true,
      );
      await confirm().getByRole("button", { name: L.inlineConfirm.close, exact: true }).click();
      await page.evaluate(() =>
        window.resolveCalls[0].resolve({ state: "failed", detail: "comment-changed" }),
      );
      await row()
        .getByRole("alert")
        .getByText(L.comments.reason["comment-changed"], { exact: true })
        .waitFor();
      assert.equal(await page.evaluate(() => window.resolveCalls.length), 1);
      assert.equal(await page.locator(".nx-dc textarea").inputValue(), "보존할 작성 중인 글");
      assert.equal(
        await page.locator(".nx-dc textarea").evaluate((el) => !!el.closest("[inert]")),
        false,
      );
      await shot("resolve-failed-closed");
      await opener().click();
      assert.equal(
        await confirm()
          .getByRole("button", { name: L.comments.resolveGo, exact: true })
          .isEnabled(),
        true,
      );
      await confirm().getByRole("button", { name: L.comments.cancel, exact: true }).click();
    },
  );

  await t.test(
    "열린 확인의 실패와 결과 불명은 alert로 남고 불명은 다시 보내지 않는다",
    async () => {
      for (const outcome of ["failed", "unknown", "throw"]) {
        await page.evaluate(() => window.renderComments());
        await opener().click();
        await confirm().getByRole("button", { name: L.comments.resolveGo, exact: true }).click();
        await page.evaluate((outcome) => {
          const pending = window.resolveCalls.at(-1);
          if (outcome === "throw") pending.reject(new Error("offline"));
          else pending.resolve({ state: outcome, detail: "comment-changed" });
        }, outcome);
        const label =
          outcome === "failed" ? L.comments.reason["comment-changed"] : L.comments.unknown;
        await row().getByRole("alert").getByText(label, { exact: true }).waitFor();
        assert.equal(
          await confirm()
            .getByRole("button", { name: L.comments.resolveGo, exact: true })
            .isDisabled(),
          true,
        );
        if (outcome !== "failed") {
          await row().getByRole("button", { name: L.comments.reread, exact: true }).click();
          assert.equal(await page.evaluate(() => window.refreshes.at(-1)), "page-1");
        }
        await shot(`resolve-${outcome}`);
      }
    },
  );

  await t.test("확인을 닫은 뒤 성공해도 적용 알림과 다시 읽기는 한 번만 실행한다", async () => {
    await page.evaluate(() => window.renderComments());
    await opener().click();
    await confirm().getByRole("button", { name: L.comments.resolveGo, exact: true }).click();
    await confirm().getByRole("button", { name: L.inlineConfirm.close, exact: true }).click();
    const count = await page.evaluate(() => window.refreshes.length);
    await page.evaluate(() => window.resolveCalls.at(-1).resolve({ state: "applied" }));
    await page.getByRole("status").getByText(L.comments.applied.resolve, { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.refreshes.length), count + 1);
    assert.equal(await confirm().count(), 0);
  });
  assert.deepEqual(errors, []);
});
