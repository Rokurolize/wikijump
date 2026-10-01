import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {openSidebar, closeSidebar} from '../src/sidebar-interaction.mjs';
import {expandMobileTopSubmenu, expandTabletTopNavigation} from '../src/navigation-interaction.mjs';

const require = createRequire(new URL('../../../../framerail/package.json', import.meta.url));
const {chromium} = require('@playwright/test');

test('sidebar close uses the source link when visible geometry is occluded', async () => {
  const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    await page.setContent('<style>#side-bar{display:none}#container-wrap:target #side-bar{display:block}#side-bar{position:relative}#cover{position:absolute;inset:0;z-index:2}</style><div id="container-wrap"><a href="#container-wrap">Menu</a><div id="side-bar"><a id="close" href="##">Close</a><div id="cover">content</div></div></div>');
    const hash = await openSidebar(page);
    await closeSidebar(page, hash);
    assert.equal(await page.evaluate(() => location.hash), '##');
    assert.equal(await page.locator('#side-bar').isVisible(), false);
  } finally { await browser.close(); }
});

test('mobile parent fails closed when its control is outside the viewport', async () => {
  const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    await page.setContent('<style>.mobile-top-bar{margin-top:1000px}.mobile-top-bar > ul > li > ul{display:none}.mobile-top-bar > ul > li.open > ul{display:block;position:fixed;top:20px;left:20px}#cover{position:fixed;inset:0;z-index:99}</style><div class="mobile-top-bar"><ul><li><a href="#menu">Menu</a><ul><li><a href="#child">Child</a></li></ul></li></ul></div><div id="cover"></div><script>document.querySelector(".mobile-top-bar > ul > li > a").onclick=e=>{e.preventDefault();e.currentTarget.parentElement.classList.toggle("open")}</script>');
    await assert.rejects(expandMobileTopSubmenu(page), /navigation parent control is outside viewport/);
    assert.equal(await page.locator('.mobile-top-bar > ul > li > ul').isVisible(), false);
  } finally { await browser.close(); }
});

test('mobile submenu activates when source action brings its rendered geometry into the viewport', async () => {
  const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    await page.setContent('<style>.mobile-top-bar{position:fixed;top:20px}.mobile-top-bar > ul > li > ul{display:block;position:fixed;left:-500px;top:60px}.mobile-top-bar > ul > li.open > ul{left:20px}</style><div class="mobile-top-bar"><ul><li><a href="#menu">Menu</a><ul><li><a href="#child">Child</a></li></ul></li></ul></div><script>document.querySelector(".mobile-top-bar > ul > li > a").onclick=e=>{e.preventDefault();e.currentTarget.parentElement.classList.toggle("open")}</script>');
    const submenu = page.locator('.mobile-top-bar > ul > li > ul');
    assert.equal(await submenu.isVisible(), true);
    assert.equal(await submenu.evaluate(e=>e.getBoundingClientRect().right<=0), true);
    await expandMobileTopSubmenu(page);
    assert.equal(await submenu.evaluate(e=>e.getBoundingClientRect().left>=0), true);
  } finally { await browser.close(); }
});

test('javascript submenu source control expands from its pointer hover state', async () => {
  const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    await page.setContent('<style>.mobile-top-bar > ul > li > ul{display:none;position:fixed;top:60px;left:20px}.mobile-top-bar > ul > li:hover > ul{display:block}</style><div class="mobile-top-bar"><ul><li><a href="javascript:;">Menu</a><ul><li><a href="#child">Child</a></li></ul></li></ul></div>');
    await expandMobileTopSubmenu(page);
    assert.equal(await page.locator('.mobile-top-bar > ul > li > ul').evaluate(e=>e.getBoundingClientRect().top>=0), true);
  } finally { await browser.close(); }
});

test('occluded in-viewport javascript control cannot certify a user action', async () => {
  const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    await page.setContent('<style>.mobile-top-bar{position:fixed;top:20px}.mobile-top-bar > ul > li > ul{display:none;position:fixed;top:60px;left:20px}.mobile-top-bar > ul > li.open > ul{display:block}#cover{position:fixed;inset:0;z-index:99}</style><div class="mobile-top-bar"><ul><li><a href="javascript:;">Menu</a><ul><li><a href="#child">Child</a></li></ul></li></ul></div><div id="cover"></div><script>document.querySelector(".mobile-top-bar > ul > li > a").onclick=e=>{e.preventDefault();e.currentTarget.parentElement.classList.add("open")}</script>');
    await assert.rejects(expandMobileTopSubmenu(page), /navigation parent control is occluded/);
    assert.equal(await page.locator('.mobile-top-bar > ul > li').evaluate(e=>e.classList.contains('open')), false);
  } finally { await browser.close(); }
});

test('tablet discovers rendered desktop navigation by geometry and expands submenu', async () => {
  const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 768, height: 1024}});
    await page.setContent('<style>.top-bar{display:block}.mobile-top-bar{display:none}.top-bar ul ul{display:none}.top-bar li:hover > ul{display:block}</style><div id="top-bar"><div class="top-bar"><ul><li><a href="#parent">Parent</a><ul><li><a href="#child">Child</a></li></ul></li></ul></div><div class="mobile-top-bar"></div></div>');
    await expandTabletTopNavigation(page);
    assert.equal(await page.locator('.top-bar li > ul').isVisible(), true);
  } finally { await browser.close(); }
});
