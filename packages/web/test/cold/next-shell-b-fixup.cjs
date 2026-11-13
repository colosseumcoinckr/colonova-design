// 2026-11-12 SHELL-B 검토 — 격리 견본의 실제 부품. 원격 쓰기는 모의한다.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(path.join(require('node:os').homedir(), '.local/lib/node_modules/playwright'));
const base = process.env.SHELL_B_FIXTURE_URL || 'http://127.0.0.1:29215';
const shots = process.env.SHELL_B_SHOTS;
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      window.__captureFail = true;
      HTMLElement.prototype.executeJavaScript = async () => null;
      HTMLElement.prototype.reload = () => {};
      window.colonovaDesignDesktop = { preview: { native: true, snapshot: async () => {
        if (window.__captureFail) throw Error('capture');
        if (window.__captureWait) await new Promise(resolve => { window.__finishCapture = resolve; });
        return { jpeg: 'fixture-image', console: [] };
      } } };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text; } } });
    });
    const show = async () => {
      await page.getByRole('button', { name: '더 보기', exact: true }).click();
      await page.getByRole('button', { name: /AI에게 이 화면 보여 주기/ }).click();
    };
    await page.goto(`${base}/dev/overlay-fixture.html?case=previewScope`);
    await show();
    await page.getByRole('alert').filter({ hasText: '화면을 담지 못했어요' }).waitFor();
    assert.equal(await page.getByRole('alert').getByRole('button').count(), 0);
    await page.evaluate(() => { window.__captureFail = false; });
    await show();
    await page.getByRole('alert').filter({ hasText: '보냈는지 확인하지 못했어요' }).waitFor();
    assert.equal(await page.getByRole('alert').getByRole('button').count(), 0);
    assert.equal(await page.evaluate(() => window.__recovery.calls.length), 1);
    if (shots) await page.screenshot({ animations: 'disabled', path: path.join(shots, 'send-uncertain-light.png') });
    await page.evaluate(() => window.__scope.setSlug('fixture-B'));
    await page.waitForFunction(() => !document.querySelector('.nx-look-error'));
    assert.equal(await page.evaluate(() => window.__recovery.calls.length), 1);
    await show();
    await page.getByRole('alert').filter({ hasText: '보냈는지 확인하지 못했어요' }).waitFor();
    await page.evaluate(() => window.__scope.setThread('other'));
    await page.waitForFunction(() => !document.querySelector('.nx-look-error'));
    await page.evaluate(() => { window.__captureWait = true; });
    await show();
    await page.waitForFunction(() => !!window.__finishCapture);
    await page.evaluate(() => window.__scope.setRoot('/fixture-C'));
    await page.evaluate(() => window.__finishCapture());
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__recovery.calls.length), 2);
    assert.equal(await page.locator('.nx-look-error').count(), 0);
    console.log('U-012: 캡처 실패·원래 단추 복구·재전송 손 없음·프로젝트/대화 전환·늦은 캡처 폐기 통과');

    for (const mode of ['success', 'different', 'fail', 'hang', 'early']) {
      await page.goto(`${base}/dev/overlay-fixture.html?case=aiReconcile`);
      const sw = page.getByRole('switch', { name: '기획서와 화면을 서로 맞춰요' });
      await sw.click();
      assert.equal(await sw.isDisabled(), true);
      await page.evaluate(mode => {
        window.__loopControl.fail = mode === 'fail';
        window.__loopControl.hang = mode === 'hang';
        window.__loopControl.value = mode === 'different';
        if (mode === 'early') window.__broadcastLoop(false);
      }, mode);
      if (mode === 'early') { await page.waitForTimeout(50); assert.equal(await sw.isDisabled(), true); }
      await page.evaluate(() => window.__settleLoop());
      await page.waitForFunction(() => !document.querySelector('[role=switch][aria-label="기획서와 화면을 서로 맞춰요"]').disabled);
      assert.equal(await sw.getAttribute('aria-checked'), ['different', 'fail', 'hang'].includes(mode) ? 'true' : 'false');
      assert.equal(await page.evaluate(() => window.__loopControl.reads), mode === 'early' ? 0 : 1);
      if (['fail', 'hang'].includes(mode)) await page.getByRole('alert').filter({ hasText: '저장한 설정을 확인하지 못했어요' }).waitFor();
      console.log(`U-120: ${mode} 통과`);
    }

    await page.goto(`${base}/dev/overlay-fixture.html?case=searchPick`);
    await page.getByRole('button', { name: '바꾸기', exact: true }).click();
    const input = page.locator('#nx-conf-root');
    await input.fill('same');
    await input.press('Enter');
    await page.evaluate(() => window.__searchPending[0].resolve({ roots: [{ id: 'old', title: 'old-result' }] }));
    await page.getByText('old-result', { exact: true }).waitFor();
    await input.press('Enter');
    await page.locator('.nx-sroots-row').filter({ hasText: 'old-result' }).getByRole('button').click();
    await page.getByRole('button', { name: '바꾸기', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '찾기', exact: true }).isDisabled(), false);
    await page.evaluate(() => window.__searchPending[1].resolve({ roots: [{ id: 'late', title: 'late-result' }] }));
    await page.waitForTimeout(100);
    assert.equal(await page.getByText('late-result', { exact: true }).count(), 0);
    console.log('U-119: 재검색 중 기존 결과 선택·다시 열기·늦은 답 폐기 통과');

    for (const theme of ['light', 'dark']) {
      for (const c of ['w2', 'q']) {
        await page.goto(`${base}/dev/onboarding-fixture.html?case=${c}&theme=${theme}&hold=1`);
        const primary = page.locator('.nx-btn--pri');
        await primary.waitFor();
        assert.equal(await primary.count(), 1);
        assert.match(await primary.innerText(), c === 'w2' ? /다시 확인/ : /파일 고르기/);
        if (shots) await page.screenshot({ animations: 'disabled', path: path.join(shots, `${c}-${theme}.png`) });
      }
    }
    console.log('U-143: w2·NoProjects 으뜸 손 각 하나, 밝음·어둠 통과');
    await page.goto(`${base}/dev/onboarding-fixture.html?case=tool-diagnostic&hold=1`);
    await page.locator('.nx-ob-step').first().getByRole('button').first().click();
    await page.waitForTimeout(100);
    assert.ok(!(await page.locator('.nx-ob').innerText()).includes('EACCES'));
    await page.getByRole('button', { name: '담당자에게 보낼 내용 복사' }).click();
    await page.waitForFunction(() => window.__copied?.includes('fixture-original-cause'));
    assert.match(await page.evaluate(() => window.__copied), /corepack enable pnpm.*EACCES/);
    console.log('U-141: 숨긴 설치 실패 원문 진단 복사 통과');
    for (const theme of ['light', 'dark']) {
      await page.goto(`${base}/dev/overlay-fixture.html?case=historyLong&theme=${theme}`);
      const long = '가'.repeat(80) + '…';
      await page.getByRole('button', { name: new RegExp(long) }).waitFor();
      assert.equal(await page.locator('.nx-ht').filter({ hasText: long }).count(), 1);
      assert.equal(await page.getByText('나'.repeat(79), { exact: true }).count(), 1);
      if (shots) await page.screenshot({ animations: 'disabled', path: path.join(shots, `history-long-${theme}.png`) });
    }
    console.log('U-010: 긴 제목의 화면·접근 이름 말줄임표, 짧은 제목 유지 통과');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
