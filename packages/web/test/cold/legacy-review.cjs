/** 2026-11-12 LEGACY-R — 지정 사본 견본의 실제 Chromium 회귀 검사. */
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { homedir } = require('node:os');
const { mkdirSync, writeFileSync } = require('node:fs');
const { chromium } = require(join(homedir(), '.local/lib/node_modules/playwright'));
const url = process.argv[2];
const out = process.argv[3];
if (!url || !out) throw new Error('URL and evidence directory required');
const input = `INPUT ${'long '.repeat(1000)} END INPUT`;
const result = `RESULT ${'long '.repeat(1000)} END RESULT`;
const summary = `근황 전체 ${'내용 '.repeat(100)} 마지막 근황`;
(async () => {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const passed = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.getByRole('button', { name: '팝 열기', exact: true }).waitFor();
    // 실제 앱 순서: next.css 다음에 styles.css를 둔다.
    await page.evaluate(() => {
      const style = [...document.querySelectorAll('style')].find((s) => s.dataset.viteDevId?.endsWith('/src/styles.css'));
      if (!style) throw new Error('styles.css missing');
      document.head.append(style);
    });
    const opener = page.getByRole('button', { name: '팝 열기', exact: true });
    await opener.focus();
    await page.keyboard.press('Enter');
    const inner = page.getByRole('button', { name: '팝 안 단추', exact: true });
    await inner.focus();
    const bubble = page.locator('.tip__bubble--shown.nx-fast-tip');
    await bubble.waitFor({ state: 'visible' });
    const before = await bubble.evaluate((el) => ({ maxWidth: getComputedStyle(el).maxWidth, width: el.getBoundingClientRect().width }));
    writeFileSync(join(out, 'tooltip-width.json'), JSON.stringify(before, null, 2));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.tip__bubble--shown.nx-fast-tip')).opacity === '1');
    await page.screenshot({ path: join(out, 'tooltip-light.png') });
    if (!process.env.ALLOW_OLD_WIDTH) assert.equal(before.maxWidth, '280px');
    for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
      const prevented = await inner.evaluate((el, props) => {
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...props });
        el.dispatchEvent(event);
        return event.defaultPrevented;
      }, init);
      assert.equal(prevented, false);
      assert.equal(await bubble.count(), 1);
      assert.equal(await page.getByRole('dialog', { name: '검토 팝' }).count(), 1);
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.tip__bubble--shown.nx-fast-tip'));
    assert.equal(await page.getByRole('dialog', { name: '검토 팝' }).count(), 1);
    assert.equal(await inner.evaluate((el) => document.activeElement === el), true);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: '검토 팝' }).waitFor({ state: 'detached' });
    passed.push('팝 안 초점→툴팁→조합 Esc 무효→Esc 툴팁만 닫힘→Esc 팝 닫힘');
    for (const [name, expected] of [['mixed', 1], ['failed', 0], ['retry', 1]]) {
      const section = page.locator(`[data-case="${name}"]`);
      await section.locator('.activity__head').click();
      if (expected) assert.match(await section.locator('.activity__counts').innerText(), /화면 파일 1개/);
      else assert.equal(await section.locator('.activity__counts').count(), 0);
    }
    passed.push('혼합·전부 실패·재시도 성공 집계');
    const raw = page.locator('[data-case="raw"]');
    await raw.locator('.tool__head').focus();
    await page.keyboard.press('Enter');
    assert.equal(await raw.locator('.tool__taskfull').innerText(), summary);
    const wrapping = await raw.locator('.tool__taskfull').evaluate((el) => ({
      whiteSpace: getComputedStyle(el).whiteSpace, overflowWrap: getComputedStyle(el).overflowWrap,
      fits: el.scrollWidth <= el.clientWidth,
    }));
    assert.deepEqual(wrapping, { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fits: true });
    const copies = raw.getByRole('button', { name: '전체 복사', exact: true });
    // 펼치기 전에도 원문 전체를 키보드로 복사한다.
    await copies.nth(0).focus();
    await page.keyboard.press('Enter');
    await raw.getByRole('button', { name: '복사했어요', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), input);
    await raw.getByRole('button', { name: '전체 복사', exact: true }).last().focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(async (text) => (await navigator.clipboard.readText()) === text, result);
    for (let i = 0; i < 2; i++) {
      await raw.getByRole('button', { name: '전체 보기', exact: true }).first().focus();
      await page.keyboard.press('Enter');
    }
    assert.equal(await raw.locator('.tool__body > pre').nth(0).textContent(), input);
    assert.equal(await raw.locator('.tool__body > pre').nth(1).textContent(), result);
    passed.push('근황 전체 줄바꿈·입력/결과 전체 복사·전체 보기 키보드');
    const actions = page.locator('[data-case="actions"]');
    const action = actions.getByRole('button', { name: '뒤로 보내기', exact: true });
    for (const mode of ['throw', 'reject', 'moved']) {
      await page.getByRole('combobox', { name: '실패 방식' }).selectOption(mode);
      const count = Number(await page.getByTestId('calls').innerText());
      await action.click();
      if (mode !== 'throw') assert.equal(await actions.locator('.tool__act').isDisabled(), true);
      await actions.getByRole('alert').waitFor();
      assert.equal(Number(await page.getByTestId('calls').innerText()), count + 1);
      assert.equal(await action.isEnabled(), true);
      await action.click();
      assert.equal(await actions.locator('.tool__act').isDisabled(), true);
      await actions.locator('.tool__act').dispatchEvent('click');
      assert.equal(Number(await page.getByTestId('calls').innerText()), count + 2);
      await page.waitForFunction(() => !document.querySelector('[data-case="actions"] .tool__act').disabled);
      assert.equal(await actions.getByRole('alert').count(), 0);
    }
    passed.push('동기 throw·비동기 거절·moved:false 안내와 잠금·중복 방지·재시도');
    for (const name of ['끝남: 첫째 항목', '남음: 둘째 항목', '남음: 안쪽 항목']) {
      assert.equal(await page.getByRole('checkbox', { name, exact: true }).count(), 1);
    }
    passed.push('체크 상자의 항목별 접근 이름');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await opener.focus();
    await page.keyboard.press('Enter');
    await inner.focus();
    await bubble.waitFor({ state: 'visible' });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.tip__bubble--shown.nx-fast-tip')).opacity === '1');
    await page.screenshot({ path: join(out, 'tooltip-dark.png') });
    assert.deepEqual(errors, []);
    writeFileSync(join(out, 'runtime.json'), JSON.stringify({ passed, errors }, null, 2));
    console.log('PASS', passed.length, before);
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
