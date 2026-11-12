import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { parseClientMessage } from "../../../protocol/dist/index.js";
import { L } from "../../src/next/labels.ts";

import { chromium, startBrowserFixture } from "./browser-fixture.ts";

let fixture: Awaited<ReturnType<typeof startBrowserFixture>> | undefined;
let browser = null;
let page = null;
const errors: string[] = [];
before(async () => {
  if (!chromium) return;
  fixture = await startBrowserFixture(29211);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
});
after(async () => {
  await browser?.close();
  await fixture?.close();
});
const ui = (name: string, body: () => Promise<void>) =>
  test(name, { skip: chromium ? false : "전역 Playwright가 없는 환경", timeout: 60000 }, body);
const go = async (caseName = "plans-a-fix") => {
  await page.goto(`${fixture?.url}/dev/plans-fixture.html?case=${caseName}&w=1600&h=900`);
  await page.locator(".nx-dr-thread textarea").waitFor();
  await page.waitForFunction(() => !document.querySelector(".nx-dr-skel"));
};
const shot = async (name: string) => {
  if (!process.env.PLANS_A_SHOTS) return;
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await page.screenshot({
      path: join(process.env.PLANS_A_SHOTS, `${name}-${theme}.png`),
      fullPage: true,
    });
  }
};
const input = () => page.locator(".nx-dr-thread textarea");
const send = () => page.getByRole("button", { name: L.drafts.send, exact: true });
const select = (text: string) =>
  page.evaluate(
    (text) => window.dispatchEvent(new CustomEvent("nx:plan-selection", { detail: { text } })),
    text,
  );
const emit = (key: string, phase: string, text?: string, threadId = "t-1") =>
  page.evaluate(
    ({ key, phase, text, threadId }) =>
      window.__plansR.emit({
        type: "draft.ai",
        docKey: key,
        threadId,
        messageId: "stream",
        phase,
        text,
      }),
    { key, phase, text, threadId },
  );

ui(
  "U-098: 편집 중 다른 블록의 토큰·AI 고침·충돌 변경을 모두 잠그고 적용/취소는 남긴다",
  async () => {
    await go();
    await page.locator(".nx-dr-kept").first().waitFor();
    await page.locator('[data-block-id="b0"] .nx-dr-read').dblclick();
    await page.locator(".nx-dr-inline textarea").fill("아직 적용하지 않은 글");
    // 잠긴 동안 보존 조각은 누를 수 없는 글로 선다(2026-11-12 U-090 — 지울 손이 없으면 단추가 아니다).
    assert.equal(await page.locator('[data-block-id="b3"] .nx-dr-tokenchip').count(), 1);
    assert.equal(await page.locator('[data-block-id="b3"] button.nx-dr-tokenchip').count(), 0);
    for (const label of [
      L.drafts.keptApply,
      L.drafts.keptDrop,
      L.drafts.useMine,
      L.drafts.useTheirs,
    ]) {
      const buttons = page.getByRole("button", { name: label, exact: true });
      assert.ok((await buttons.count()) > 0, label);
      for (const button of await buttons.all())
        assert.equal(await button.isDisabled(), true, label);
    }
    assert.equal(
      await page.getByRole("button", { name: L.drafts.apply, exact: true }).isEnabled(),
      true,
    );
    assert.equal(
      await page.locator(".nx-dr-inline textarea").inputValue(),
      "아직 적용하지 않은 글",
    );
    assert.deepEqual(
      await page.evaluate(() => [
        window.__plansR.edits.length,
        window.__plansR.rejects,
        window.__plansR.resolves,
      ]),
      [0, 0, 0],
    );
    await page.getByRole("button", { name: L.drafts.apply, exact: true }).click();
    await page.waitForFunction(() => window.__plansR.edits.length === 1);
  },
);

for (const mode of ["delete", "conflict", "preserved"] as const)
  ui(`U-098: 편집 대상 ${mode} 갱신은 입력을 복사 가능하게 남기고 잠금을 푼다`, async () => {
    await go();
    await page.locator('[data-block-id="b0"] .nx-dr-read').dblclick();
    await page.locator(".nx-dr-inline textarea").fill("살려 둘 입력 전체");
    await page.evaluate((mode) => window.__plansR.change("b0", mode), mode);
    const recovery = page.getByRole("textbox", { name: L.drafts.editRecovered, exact: true });
    await recovery.waitFor();
    assert.match(await recovery.inputValue(), /살려 둘 입력 전체/);
    assert.equal(await page.locator(".nx-dr-inline").count(), 0);
    assert.equal(await page.locator(".nx-dr-revpick").isEnabled(), true);
    if (mode === "delete") await shot("recovered");
    await recovery.evaluate((el) => el.select());
    assert.equal(
      await recovery.evaluate((el) => el.selectionEnd - el.selectionStart),
      (await recovery.inputValue()).length,
    );
  });

ui("U-109: 실제 합친 8000자 경계·여러 줄 인용·첫 질문을 전송 전에 검사한다", async () => {
  await go("plans-a");
  for (const selection of ["abc", "나".repeat(8000), "나\n".repeat(2700)]) {
    await input().fill("");
    await select(selection);
    const budget = Math.max(0, 8000 - L.drafts.questionWithSelection("", selection).length);
    await page.waitForFunction(
      (budget) => document.querySelector(".nx-dr-thread textarea").maxLength === budget,
      budget,
    );
    if (budget > 0) {
      await input().fill("a".repeat(budget));
      assert.equal(await send().isEnabled(), true);
      await send().click();
      const text = await page.evaluate(() => window.__plansA.asks.at(-1)[1]);
      assert.equal(text.length, 8000);
      assert.equal(
        parseClientMessage(
          JSON.stringify({ type: "draft.ask", id: "boundary", docKey: "p-2001", text, refs: [] }),
        ).ok,
        true,
      );
      await page.evaluate(() => window.__plansA.resolveAsk());
      await page.waitForFunction(() => !document.querySelector(".nx-dr-selchip"));
    } else {
      assert.equal(await send().isDisabled(), true);
      assert.equal(await page.getByText(L.drafts.questionTooLong, { exact: true }).count(), 1);
    }
  }
  await go("plans-a&opened=0");
  await input().fill("기존 질문");
  await select("나\n".repeat(2700));
  await input().press("Control+Enter");
  assert.equal(await send().isDisabled(), true);
  assert.equal(await page.evaluate(() => window.__plansA.asks.length), 0);
  assert.equal(await input().inputValue(), "기존 질문");
  await shot("too-long");
  assert.equal(await page.locator(".nx-dr").count(), 0);
});

ui("U-113·114: A 진행→B 이동→늦은 종료→A 복귀·같은 문서 대화 전환", async () => {
  await go();
  await emit("p-2001", "started");
  await emit("p-2001", "text", "A-stream");
  await page.getByText("A-stream", { exact: true }).waitFor();
  await page.evaluate(() => window.__plansR.open("p-2002"));
  await input().fill("B 입력");
  await page.waitForFunction(
    () => !document.querySelector('.nx-dr-thread button[type="submit"]').disabled,
  );
  assert.equal(await page.getByText("A-stream", { exact: true }).count(), 0);
  await emit("p-2001", "done");
  assert.equal(await send().isEnabled(), true);
  await emit("p-2001", "started");
  await page.evaluate(() => window.__plansR.open("p-2001"));
  await page.locator(".nx-dr-working-line").waitFor();
  assert.equal(await send().isDisabled(), true);
  await emit("p-2001", "text", "new-A-stream");
  await page.evaluate(() => window.__plansR.pick("t-3"));
  await page.waitForFunction(() => !document.body.textContent.includes("new-A-stream"));
  await emit("p-2001", "text", "wrong-thread", "t-1");
  assert.equal(await page.getByText("wrong-thread", { exact: true }).count(), 0);
  await emit("p-2001", "done", undefined, "t-1");
  await input().fill("다른 대화의 완료 뒤 질문");
  await page.waitForFunction(
    () => !document.querySelector('.nx-dr-thread button[type="submit"]').disabled,
  );
});

ui(
  "U-113·114: 늦은 성공·실패가 다음 입력을 지우지 않고 발행 카드는 해당 문서에만 남는다",
  async () => {
    await go("plans-a&opened=0");
    await select("고른 원문");
    await page.getByRole("button", { name: L.drafts.addRef, exact: true }).click();
    await page.locator(".nx-dr-refrow").nth(2).click();
    await page.getByRole("button", { name: "근거로 담기", exact: true }).click();
    await input().fill("처음 질문");
    await send().click();
    assert.equal(await page.locator(".nx-dr-selchip").count(), 1);
    await page.waitForFunction(() => window.__plansA.asks.length === 1);
    const sent = await page.evaluate(() => window.__plansA.asks[0]);
    assert.ok(sent[1].includes("고른 원문"));
    assert.equal(sent[2].length, 1);
    await input().fill("다음 질문");
    await page.evaluate(() => window.__plansA.resolveAsk());
    await page.waitForFunction(() => !document.querySelector(".nx-dr-selchip"));
    assert.equal(await input().inputValue(), "다음 질문");
    await send().click();
    await page.getByTestId("switch-doc").click();
    await input().fill("B의 질문");
    await page.evaluate(() => window.__plansA.rejectAsk());
    assert.equal(await input().inputValue(), "B의 질문");
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("nx:plan-published", { detail: { docKey: "p-2002", version: 9 } }),
      ),
    );
    await page.locator(".nx-dr-doccard--pub").waitFor();
    await page.getByTestId("switch-doc").click();
    assert.equal(await page.locator(".nx-dr-doccard--pub").count(), 0);
  },
);

ui(
  "U-097: 실제 PlansColumn에서 지연 복원은 질문·되돌리기를 함께 잠그고 실패 후 재시도한다",
  async () => {
    await go();
    await page.locator(".nx-dr-revpick").click();
    await page.getByRole("menuitem").filter({ hasText: "초안 판 2" }).click();
    await page.locator(".nx-dr-oldrev button").first().click();
    await input().fill("복원 중 질문");
    assert.equal(await send().isDisabled(), true);
    const undo = page
      .locator(".nx-dr-doccard")
      .getByRole("button", { name: L.drafts.revert, exact: true });
    assert.equal(await undo.isDisabled(), true);
    await input().press("Control+Enter");
    assert.deepEqual(
      await page.evaluate(() => [
        window.__plansR.restores,
        window.__plansR.asks.length,
        window.__plansR.undos,
      ]),
      [1, 0, 0],
    );
    await page.evaluate(() => window.__plansR.pendingRestores[0].reject());
    await page.getByText(L.drafts.revRestoreFailed, { exact: true }).waitFor();
    assert.equal(await send().isEnabled(), true);
    await page.locator(".nx-dr-oldrev button").first().click();
    await page.evaluate(() => window.__plansR.open("p-2002"));
    await input().fill("다른 문서 질문");
    await page.waitForFunction(
      () => !document.querySelector('.nx-dr-thread button[type="submit"]').disabled,
    );
    await page.evaluate(() => window.__plansR.open("p-2001"));
    await page.locator(".nx-dr-revpick").waitFor();
    assert.equal(await send().isDisabled(), true);
    await page.evaluate(() => window.__plansR.pendingRestores[1].resolve());
    await input().fill("복원 후 질문");
    await page.waitForFunction(
      () => !document.querySelector('.nx-dr-thread button[type="submit"]').disabled,
    );
    assert.equal(await page.locator(".nx-dr-revpick").isEnabled(), true);
    assert.deepEqual(errors, []);
  },
);

ui("U-098: 표 편집의 입력도 대상 삭제 뒤 그대로 복구한다", async () => {
  await go();
  await page.locator('[data-block-id="b3"] .nx-dr-read').dblclick();
  await page.locator(".nx-dr-cell").first().fill("표에서 쓰던 글");
  await page.evaluate(() => window.__plansR.change("b3", "delete"));
  const recovery = page.getByRole("textbox", { name: L.drafts.editRecovered, exact: true });
  await recovery.waitFor();
  assert.match(await recovery.inputValue(), /표에서 쓰던 글/);
  assert.equal(await page.locator(".nx-dr-revpick").isEnabled(), true);
});

// 2026-11-12 PLANS-A-R2 — 서버 방송만 흉내 내고 입력·닫기·재열기는 실제 칸에서 걷는다.
const replaceBlocks = async (mode: "table" | "paragraph" | "single" | "empty") => {
  await page.evaluate((mode) => {
    const control = window.__plansR;
    const view = control.get("p-2001");
    const blocks =
      mode === "empty"
        ? []
        : mode === "single"
          ? view.blocks.filter((block) => block.id === "b0")
          : view.blocks.map((block) =>
              block.id !== (mode === "table" ? "b0" : "b3")
                ? block
                : {
                    ...block,
                    view:
                      mode === "table"
                        ? {
                            kind: "table",
                            rows: [{ cells: [{ text: "REMOTE TABLE", header: true }] }],
                          }
                        : { kind: "paragraph", text: "REMOTE PARAGRAPH" },
                  },
            );
    control.views.set(view.docKey, { ...view, blocks, revision: view.revision + 1 });
    control.emit({
      type: "draft.changed",
      docKey: view.docKey,
      revision: view.revision + 1,
      state: "editing",
    });
  }, mode);
};
const recoveredInput = () =>
  page.getByRole("textbox", { name: L.drafts.editRecovered, exact: true });

for (const mode of ["table", "paragraph"] as const)
  ui(`U-098 R2: 같은 블록의 ${mode} 전환 전에 쓰던 글을 되살리고 새 편집기를 막는다`, async () => {
    await go("plans-a-r2");
    const id = mode === "table" ? "b0" : "b3";
    await page.locator(`[data-block-id="${id}"] .nx-dr-read`).dblclick();
    await page
      .locator(mode === "table" ? ".nx-dr-inline textarea" : ".nx-dr-cell")
      .first()
      .fill("종류 전환 전에 쓰던 글");
    await replaceBlocks(mode);
    await recoveredInput().waitFor();
    assert.match(await recoveredInput().inputValue(), /종류 전환 전에 쓰던 글/);
    assert.doesNotMatch(await recoveredInput().inputValue(), /REMOTE/);
    assert.equal(await page.locator(".nx-dr-inline, .nx-dr-cell").count(), 0);
    assert.equal(await page.locator(".nx-dr-revpick").isEnabled(), true);
    await page.evaluate((id) => window.__plansR.change(id, "delete"), id);
    await page.waitForFunction((id) => !document.querySelector(`[data-block-id="${id}"]`), id);
    assert.equal(await recoveredInput().count(), 1);
    assert.match(await recoveredInput().inputValue(), /종류 전환 전에 쓰던 글/);
  });

ui("U-098 R2: 마지막 블록 삭제 뒤에도 직접 쓰기로 복구 글을 초안에 넣는다", async () => {
  await go("plans-a-r2");
  await replaceBlocks("single");
  await page.locator('[data-block-id="b0"] .nx-dr-read').dblclick();
  await page.locator(".nx-dr-inline textarea").fill("마지막 블록에서 쓰던 글");
  await replaceBlocks("empty");
  await recoveredInput().waitFor();
  await page.getByRole("button", { name: L.drafts.writeDirectly, exact: true }).click();
  await page.locator(".nx-dr-inline textarea").fill(await recoveredInput().inputValue());
  await page.getByRole("button", { name: L.drafts.apply, exact: true }).click();
  await page.waitForFunction(() => window.__plansR.edits.length === 2);
  assert.equal(await page.locator(".nx-dr-read").innerText(), "마지막 블록에서 쓰던 글");
  assert.equal(await recoveredInput().inputValue(), "마지막 블록에서 쓰던 글");
  await shot("recovered-empty-refilled");
});

ui("U-098 R2: Esc·재열기·문서 왕복에도 복구 글이 남고 직접 닫은 글만 지운다", async () => {
  await go("plans-a-r2");
  await page.locator('[data-block-id="b0"] .nx-dr-read').dblclick();
  await page.locator(".nx-dr-inline textarea").fill("A 문서에서 되살린 글");
  await page.evaluate(() => window.__plansR.change("b0", "delete"));
  await recoveredInput().waitFor();
  await page.locator(".nx-dr-revpick").focus();
  await page.keyboard.press("Escape");
  await page.locator(".nx-dr").waitFor({ state: "detached" });
  await page.evaluate(() => window.__plansR.open("p-2001"));
  await recoveredInput().waitFor();
  assert.equal(await recoveredInput().inputValue(), "A 문서에서 되살린 글");
  await page.evaluate(() => window.__plansR.open("p-2002"));
  await page.locator('[data-block-id="b0"]').waitFor();
  assert.equal(await recoveredInput().count(), 0);
  await page.evaluate(() => window.__plansR.open("p-2001"));
  await recoveredInput().waitFor();
  assert.equal(await recoveredInput().inputValue(), "A 문서에서 되살린 글");
  assert.equal(await page.getByText(L.drafts.editRecoveredNote, { exact: true }).count(), 1);
  await shot("recovered-retained");
  await recoveredInput()
    .locator("..")
    .getByRole("button", { name: L.modal.close, exact: true })
    .click();
  assert.equal(await recoveredInput().count(), 0);
  await page.locator(".nx-dr-revpick").focus();
  await page.keyboard.press("Escape");
  await page.locator(".nx-dr").waitFor({ state: "detached" });
  await page.evaluate(() => window.__plansR.open("p-2001"));
  await page.locator(".nx-dr-revpick").waitFor();
  assert.equal(await recoveredInput().count(), 0);
  assert.deepEqual(errors, []);
});

test("U-109: 합친 본문을 실제 선로 검사로 판정한다", () => {
  const parse = (text: string) =>
    parseClientMessage(
      JSON.stringify({ type: "draft.ask", id: "boundary", docKey: "p-2001", text, refs: [] }),
    );
  assert.equal(parse(L.drafts.questionWithSelection("a".repeat(7987), "abc")).ok, true);
  for (const [question, selection] of [
    ["a".repeat(8000), "abc"],
    ["질문", "나".repeat(8000)],
    ["질문", "나\n".repeat(2700)],
  ]) {
    assert.equal(parse(L.drafts.questionWithSelection(question, selection)).ok, false);
  }
});
