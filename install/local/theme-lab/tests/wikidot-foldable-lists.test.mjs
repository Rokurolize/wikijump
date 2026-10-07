import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBrowser} from '../src/browser-lab.mjs';
import {wikidotFoldableLists} from '../../../../framerail/src/lib/wikidot/wikidot-foldable-lists.js';

test('native foldable menus and surrounding credit-list controls keep independent state and cleanup', async()=>{
  const browser=await loadBrowser('chromium').launch({headless:true});
  try {
    const page=await browser.newPage();
    await page.route('**/*', route=>route.abort());
    await page.setContent('<main><div class="foldable-list-container"><ul><li>Main<ul><li>Child</li></ul></li><li><a href="/elsewhere">Navigation</a><ul><li>Destination</li></ul></li><li class="plain">Plain</li></ul></div><ul class="creditRate"><li class="folded"><ul><li>_</li></ul><div class="creditButton foldable-list-container"><a href="javascript:;">Open</a></div><ul class="otherwise"><li class="folded"><ul><li>_</li></ul><div class="foldable-list-container"><a href="javascript:;">Other</a></div><div class="return-credits foldable-list-container"><a href="javascript:;">Return</a></div></li></ul></li></ul></main>');
    await page.evaluate(source=>{window.foldableAction=eval('('+source+')')(document.querySelector('main'));document.addEventListener('click',e=>e.preventDefault())},wikidotFoldableLists.toString());
    const menu=page.locator('main > div > ul > li').first();
    assert.equal(await menu.getAttribute('class'),'folded');
    assert.equal(await menu.locator(':scope > ul').evaluate(e=>e.style.display),'none');
    await menu.locator(':scope > a').click();
    assert.equal(await menu.getAttribute('class'),'unfolded');
    assert.equal(await menu.locator(':scope > ul').evaluate(e=>e.style.display),'');
    await page.locator('.creditButton a').click();
    assert.equal(await page.locator('.creditRate > li').getAttribute('class'),'unfolded');
    await page.getByText('Other',{exact:true}).click();
    assert.equal(await page.locator('.otherwise > li').getAttribute('class'),'unfolded');
    await page.locator('.return-credits a').click();
    assert.equal(await page.locator('.otherwise > li').getAttribute('class'),'folded');
    assert.equal(await page.locator('.creditRate > li').getAttribute('class'),'unfolded');
    await page.getByText('Navigation',{exact:true}).click();
    assert.equal(await page.getByText('Navigation',{exact:true}).locator('..').getAttribute('class'),'folded');
    await page.locator('.plain').click();
    assert.equal(await page.locator('.plain').getAttribute('class'),'plain');
    await page.evaluate(()=>document.querySelector('main').insertAdjacentHTML('beforeend','<div class="foldable-list-container"><ul><li>Replacement<ul><li>Nested</li></ul></li></ul></div>'));
    await page.waitForFunction(()=>document.querySelector('main > div:last-child li')?.classList.contains('folded'));
    await page.getByText('Replacement',{exact:true}).click();
    assert.equal(await page.locator('main > div:last-child li').first().getAttribute('class'),'unfolded');
    await page.evaluate(()=>window.foldableAction.destroy());
    await page.locator('.creditButton a').click();
    assert.equal(await page.locator('.creditRate > li').getAttribute('class'),'unfolded');
    assert.equal(await page.evaluate(()=>location.hash),'');
  } finally {await browser.close()}
});
