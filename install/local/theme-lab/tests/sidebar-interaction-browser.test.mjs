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

test('sidebar closes by hash and off-canvas geometry while remaining display block',async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.setContent('<style>#side-bar{display:block;position:fixed;left:-300px;width:250px;height:100vh}#container-wrap:target #side-bar{left:0}</style><div id="container-wrap"><a href="#container-wrap">Menu</a><div id="side-bar"><a class="close-menu" href="##">Close</a></div></div>');
  const hash=await openSidebar(page);await closeSidebar(page,hash);
  assert.equal(await page.locator('#side-bar').evaluate(e=>getComputedStyle(e).display),'block');
  assert.equal(await page.locator('#side-bar').evaluate(e=>e.getBoundingClientRect().right<=0),true);
 }finally{await browser.close()}
});

test('CSS-clipped source close anchor is activated through its own DOM click',async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.setContent('<style>#side-bar{display:block;position:fixed;left:-300px;width:250px;height:100vh}#container-wrap:target #side-bar{left:0}.close-menu{position:fixed;left:-1000px;visibility:hidden}</style><div id="container-wrap"><a href="#container-wrap">Menu</a><div id="side-bar"><a class="close-menu" href="##">Close</a></div></div>');
  const hash=await openSidebar(page);assert.equal(await page.locator('.close-menu').isVisible(),false);
  await closeSidebar(page,hash);assert.equal(await page.locator('#side-bar').evaluate(e=>e.getBoundingClientRect().right<=0),true);
 }finally{await browser.close()}
});

test('source opener is accepted as a sidebar toggle only when its event closes',async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.setContent('<style>#side-bar{display:block;position:fixed;left:-300px;width:250px;height:100vh}#side-bar.open{left:0}</style><a id="toggle" href="#container-wrap">Menu</a><div id="side-bar"></div><script>toggle.onclick=e=>{e.preventDefault();document.querySelector("#side-bar").classList.toggle("open");location.hash=document.querySelector("#side-bar").classList.contains("open")?"container-wrap":""}</script>');
  const hash=await openSidebar(page);await closeSidebar(page,hash);
  assert.equal(await page.locator('#side-bar').evaluate(e=>e.classList.contains('open')),false);
 }finally{await browser.close()}
});
