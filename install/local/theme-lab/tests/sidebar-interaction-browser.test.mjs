import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {openSidebar,closeSidebar} from '../src/sidebar-interaction.mjs';
const require=createRequire(new URL('../../../../framerail/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
test('source-owned container target controls open and close without a synthetic button',async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.setContent('<style>#side-bar{display:none}#container-wrap:target #side-bar{display:block}</style><div id="container-wrap"><a id="u-sb-button" href="#container-wrap">Menu</a><div id="side-bar">JP sidebar<a href="##">Close</a></div></div>');
  const hash=await openSidebar(page);assert.equal(hash,'#container-wrap');assert.equal(await page.locator('#side-bar').isVisible(),true);
  await closeSidebar(page,hash);assert.equal(await page.locator('#side-bar').isVisible(),false);
 }finally{await browser.close()}
});
