// 입력창 시트 검증 — headless Playwright + dev fixture(독립 브라우저, live Electron 아님).
// 실행: packages/web 에서 vite 를 띄운 뒤
//   node packages/web/test/cold/composer-sheet.cjs
// 판정: DOM 노드 동일성(재마운트 없음의 직접 증명) + 상태 보존(글·인메모리 첨부) +
//       초점 복귀 + aria + CSS 특이도 회귀.
const { join } = require('node:path');
const { homedir } = require('node:os');
const { chromium } = require(join(homedir(), '.local/lib/node_modules/playwright'));

const BASE = process.env.FIXTURE_URL || 'http://127.0.0.1:29181/dev/composer-sheet-fixture.html';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
  const page = await (await browser.newContext({ viewport: { width: 860, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?tab=preview', { waitUntil: 'networkidle' });

  const foldRow = page.locator('.nx-fold-cmp');
  const host = () => page.locator('.nx-sheet-host');
  const composerTextarea = () => page.locator('.nx-composer textarea');

  // ── 1. 접힌 한 줄 렌더 — 리셋에 지지 않는 바탕/윗선(특이도 버그 회귀) ──
  const foldBox = await foldRow.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, borderTop: cs.borderTopWidth, pad: cs.paddingLeft };
  });
  check('fold row: opaque background (reset beaten)', foldBox.bg !== 'rgba(0, 0, 0, 0)' && foldBox.bg !== 'transparent', foldBox.bg);
  check('fold row: top border drawn', foldBox.borderTop === '1px', foldBox.borderTop);
  check('fold row: padded (14px)', foldBox.pad === '14px', foldBox.pad);

  // ── 2. 접힌 한 줄 누름 → 시트 펼침 + 초점 ──
  await foldRow.click();
  await page.waitForSelector('.nx-sheet-host .nx-composer', { timeout: 5000 });
  check('sheet host populated after fold click', (await host().locator('.nx-composer').count()) === 1);
  check('fold row hidden while sheet open', !(await foldRow.isVisible()));
  check('host NOT aria-hidden', (await host().getAttribute('aria-hidden')) === null);
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
  check('focus lands in composer textarea', focusedTag === 'TEXTAREA', focusedTag);

  // ── 3. 글 입력 + 인메모리 첨부 → 노드 표식 ──
  const TEXT = '시트 보존 검증 메모';
  await page.fill('.nx-sheet-host .nx-composer textarea', TEXT);
  const fileInput = page.locator('.nx-composer input[type=file]');
  await fileInput.setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture-bytes') });
  await page.waitForSelector('.nx-sheet-host .nx-att', { timeout: 5000 });
  check('attachment chip rendered', (await host().locator('.nx-att').count()) === 1);
  // 노드 동일성 표식 — 재마운트면 새 노드가 온다
  const areaBefore = await page.evaluateHandle(() => document.querySelector('.nx-composer textarea'));
  const chipBefore = await page.evaluateHandle(() => document.querySelector('.nx-att'));

  // ── 4. Esc 접기 — 시트 접히고 초점이 접힌 한 줄로 ──
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('sheet folded on Escape', (await host().locator('.nx-composer').count()) === 0);
  check('fold row back after Escape', await foldRow.isVisible());
  const focusAfterEsc = await page.evaluate(() => document.activeElement?.className);
  check('focus returns to fold row on Escape', String(focusAfterEsc).includes('nx-fold-cmp'), String(focusAfterEsc));

  // ── 5. 재펼침 — 같은 노드 + 글·첨부 보존(재마운트 없음의 직접 증명) ──
  await foldRow.click();
  await page.waitForSelector('.nx-sheet-host .nx-composer', { timeout: 5000 });
  const areaAfter = await page.evaluateHandle(() => document.querySelector('.nx-composer textarea'));
  const chipAfter = await page.evaluateHandle(() => document.querySelector('.nx-att'));
  const sameArea = await page.evaluate(([a, b]) => a === b, [areaBefore, areaAfter]);
  const sameChip = await page.evaluate(([a, b]) => a === b, [chipBefore, chipAfter]);
  check('textarea DOM node survives fold→reopen (no remount)', sameArea);
  check('attachment chip DOM node survives (no remount)', sameChip);
  check('typed text preserved', (await composerTextarea().inputValue()) === TEXT);
  check('attachment still attached', (await host().locator('.nx-att').count()) === 1);

  // ── 6. 접기 버튼(⌄) — Esc 와 같은 길 ──
  await page.locator('.nx-sheet-host .nx-composer button[title="입력창 접기"]').click();
  await page.waitForTimeout(400);
  check('fold button collapses sheet', (await host().locator('.nx-composer').count()) === 0);
  check('fold row visible again', await foldRow.isVisible());

  // ── 7. 화면→대화 탭 — 입력창이 대화 칸에 서고 상태 유지 ──
  await foldRow.click();
  await page.waitForSelector('.nx-sheet-host .nx-composer', { timeout: 5000 });
  await page.evaluate(() => window.__setTab('chat'));
  await page.waitForTimeout(600);
  const chatWrap = page.locator('.nx-chat-slot .nx-composer');
  check('composer lands in chat column on tab switch', (await chatWrap.count()) === 1);
  check('text preserved across preview→chat', (await chatWrap.locator('textarea').inputValue()) === TEXT);
  check('attachment survives tab switch', (await chatWrap.locator('.nx-att').count()) === 1);
  const areaInChat = await page.evaluateHandle(() => document.querySelector('.nx-chat-slot .nx-composer textarea'));
  const sameAreaChat = await page.evaluate(([a, b]) => a === b, [areaBefore, areaInChat]);
  check('same textarea node preview→chat (no remount)', sameAreaChat);

  // ── 8. 대화→화면 복귀 — 시트는 접힌 채, 다시 열면 같은 노드 ──
  await page.evaluate(() => window.__setTab('preview'));
  await page.waitForTimeout(400);
  check('back to preview: fold row present', await foldRow.isVisible());
  check('sheet stays folded after tab hop', (await host().locator('.nx-composer').count()) === 0);
  await foldRow.click();
  await page.waitForSelector('.nx-sheet-host .nx-composer', { timeout: 5000 });
  const areaAgain = await page.evaluateHandle(() => document.querySelector('.nx-composer textarea'));
  const sameArea2 = await page.evaluate(([a, b]) => a === b, [areaBefore, areaAgain]);
  check('same textarea node after full tab round-trip', sameArea2);
  check('text survives tab round-trip', (await composerTextarea().inputValue()) === TEXT);
  check('attachment survives tab round-trip', (await host().locator('.nx-att').count()) === 1);

  // ── 9. 넓혔다가 다시 좁히기 — 창 크기 전이도 상태를 지킨다 ──
  await page.evaluate(() => window.__setNarrow(false));
  await page.waitForTimeout(500);
  const wideWrap = page.locator('.nx-chat-slot .nx-composer');
  check('wide: composer back in chat column', (await wideWrap.count()) === 1);
  check('wide: text preserved', (await wideWrap.locator('textarea').inputValue()) === TEXT);
  check('wide: attachment preserved', (await wideWrap.locator('.nx-att').count()) === 1);
  await page.evaluate(() => window.__setNarrow(true));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__setTab('preview'));
  await page.waitForTimeout(400);
  check('re-narrow: fold row back', await foldRow.isVisible());
  await foldRow.click();
  await page.waitForSelector('.nx-sheet-host .nx-composer', { timeout: 5000 });
  const areaFinal = await page.evaluateHandle(() => document.querySelector('.nx-composer textarea'));
  const sameArea3 = await page.evaluate(([a, b]) => a === b, [areaBefore, areaFinal]);
  check('same textarea node after resize round-trip', sameArea3);
  check('re-narrow: text still preserved', (await composerTextarea().inputValue()) === TEXT);
  check('re-narrow: attachment still there', (await host().locator('.nx-att').count()) === 1);

  // ── 10. 페이지 에러 없음 ──
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

  const fails = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} PASS`);
  process.exitCode = fails.length ? 1 : 0;
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
