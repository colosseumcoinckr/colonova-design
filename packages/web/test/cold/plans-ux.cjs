// 기획서 UX 회귀. 개발 웹 서버를 켠 뒤 저장소 뿌리에서 실행한다.
// node packages/web/test/cold/plans-ux.cjs
// 실제 프로젝트 데이터 대신 plans-fixture의 가짜 데몬만 쓴다.
const { join } = require('node:path');
const { homedir } = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require(join(homedir(), '.local/lib/node_modules/playwright'));
const base = process.env.FIXTURE_URL || 'http://127.0.0.1:29173/dev/plans-fixture.html';
(async () => {
 const browser = await chromium.launch();
 try {
 const page = await browser.newPage({ viewport: { width: 1840, height: 1050 } });
 const errors = []; page.on('pageerror', (error) => errors.push(error.message));

 await page.goto(base+'?case=screens-partial&w=1400&h=900');
 await page.getByRole('button',{name:'이어진 화면',exact:true}).click();
 await page.getByText('연결된 화면을 읽지 못했어요',{exact:true}).waitFor();
 await page.locator('.nx-pl-scrname').filter({hasText:'주문 목록'}).waitFor();
 assert(!(await page.getByText(/아직 이어진 화면이 없어요/).isVisible()));
 await page.getByRole('button',{name:'다시 시도',exact:true}).click();
 await page.getByText('회원가입',{exact:true}).waitFor();
 assert(!(await page.getByText('연결된 화면을 읽지 못했어요',{exact:true}).isVisible()));
 console.log('PASS 화면 연결 부분 실패: 성공한 기록 유지 + 오류 표시 + 재시도 복구');
 await page.goto(base+'?case=many-drafts&w=1400&h=900');
 await page.getByRole('button',{name:'새 초안 8 · 새 문서 초안',exact:true}).waitFor({timeout:5000}).catch(async()=>{
  assert.equal(await page.locator('.nx-pl-row--ghost').count(),8);
 });
 assert.equal(await page.locator('.nx-pl-row--ghost').count(),8);
 console.log('PASS 새 문서 초안 여덟 개 접근 가능');
 await page.goto(base+'?case=conversations-failed&w=1400&h=900');
 await page.getByText('기획 대화를 읽지 못했어요. 다시 시도해 주세요',{exact:true}).waitFor();
 await page.getByRole('button',{name:'다시 시도',exact:true}).click();
 await page.locator('.nx-pl-conv-btn').first().waitFor();
 console.log('PASS 기획 대화 목록 읽기 실패와 재시도');
 await page.goto(base+'?case=list&w=1400&h=900');
 await page.locator('.nx-pl-find-in').fill('법무');
 await page.locator('.nx-pl-row--hit').first().click();
 await page.locator('.nx-pl-body').waitFor();
 await page.locator('[data-search-hit]').waitFor();
 assert((await page.locator('[data-search-hit]').innerText()).includes('법무'));
 console.log('PASS 본문 찾기 결과의 첫 일치 위치 표시');
 assert.equal(errors.length,0,errors.join('\n'));


 await page.goto(base+'?case=list&w=1800&h=950');
 await page.locator('.nx-pl-conv-btn').first().click();
 await page.getByRole('button',{name:'대화 메뉴',exact:true}).click();
 await page.getByRole('menuitem',{name:'대화 지우기',exact:true}).click();
 await page.getByText('이 기획 대화를 지울까요?',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.activeElement.textContent),'그만두기');
 await page.getByRole('button',{name:'그만두기',exact:true}).click();
 assert.equal(await page.locator('.nx-pl-conv-btn').count(),3);
 console.log('PASS 대화 삭제 확인 + 취소 기본초점 + 취소후 보존');
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'근거 더하기',exact:false}).click();
 await page.locator('.nx-dr-refrow').first().click();
 await page.getByRole('checkbox',{name:'1. 목적',exact:true}).check();
 await page.getByRole('button',{name:'근거로 담기',exact:true}).click();
 assert(await page.locator('.nx-dr-thread').getByText('1. 목적',{exact:false}).isVisible());
 console.log('PASS 실제 문서 절 체크목록에서 근거 담기');
 const edit=page.locator('.nx-dr-block').getByRole('button',{name:'고치기',exact:true}).first();

 await page.locator('.nx-dr-block').first().hover();
 await edit.click();
 const input=page.locator('.nx-dr-inline-area');const original=await input.inputValue();
 await input.fill('취소 검증용 임시 문장');
 await page.locator('.nx-dr-inline').getByRole('button',{name:'취소',exact:true}).click();
 assert.equal(await page.getByText('취소 검증용 임시 문장',{exact:true}).count(),0);
 await page.locator('.nx-dr-block').first().hover();
 await edit.click();assert.equal(await input.inputValue(),original);
 console.log('PASS 인라인 취소 클릭이 저장을 일으키지 않고 기존 글 유지');
 assert.equal(errors.length,0,errors.join('\n'));

 for (const width of [320, 800, 1440]) {
   await page.setViewportSize({ width: width + 40, height: 900 });
   await page.goto(`${base}?case=list&narrow=1&w=${width}&h=800`);
   await page.locator('.nx-pl-doc[aria-busy="false"] .nx-pl-body').waitFor();
   const overflow = await page.locator('.nx-plans').evaluate((el) => ({
     width: el.clientWidth, scroll: el.scrollWidth,
     buttons: [...el.querySelectorAll('button')].filter((button) => button.getClientRects().length && button.getBoundingClientRect().right > el.getBoundingClientRect().right + 2).length,
   }));
   assert.equal(overflow.scroll, overflow.width); assert.equal(overflow.buttons, 0);
   console.log(`PASS 기획서 ${width}px 가로 넘침 없음`);
 }
 assert.equal(errors.length, 0, errors.join('\n'));
 } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
