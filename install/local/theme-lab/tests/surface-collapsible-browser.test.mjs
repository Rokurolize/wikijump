import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {applySurfaceState,cleanupSurfaceState} from '../src/theme-surface-contract.mjs';
const require=createRequire(new URL('../../../../framerail/package.json',import.meta.url));const {chromium}=require('@playwright/test');
test('surface capture uses the visible Wikidot open/close controls across repeated modes',async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
 try{
  const page=await browser.newPage();await page.setContent('<style>#side-bar{position:fixed;inset:0;z-index:10;background:#eee}</style><div id="side-bar"><a href="/sidebar">Sidebar link</a></div><div id="page-content"><div class="collapsible-block"><div class="collapsible-block-folded"><a class="collapsible-block-link" href="javascript:;">Open</a></div><div class="collapsible-block-unfolded" style="display:none"><div class="collapsible-block-unfolded-link"><a class="collapsible-block-link" href="javascript:;">Close</a></div><p>JP content</p></div></div></div>');
  await page.evaluate(()=>{for(const a of document.querySelectorAll('a'))a.addEventListener('click',()=>{const hide=!!a.closest('.collapsible-block-unfolded-link');document.querySelector('.collapsible-block-folded').style.display=hide?'block':'none';document.querySelector('.collapsible-block-unfolded').style.display=hide?'none':'block'})});
  for(const width of [1440,390,1440,390]){await page.setViewportSize({width,height:844});await applySurfaceState(page,'content.collapsible','expanded');assert.equal(await page.locator('.collapsible-block-unfolded').isVisible(),true);await cleanupSurfaceState(page,'content.collapsible','expanded');assert.equal(await page.locator('.collapsible-block-unfolded').isVisible(),false)}
 }finally{await browser.close()}
});
