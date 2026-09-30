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

test('mobile parent activates its real submenu when offscreen and overlapped', async () => {
  const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    await page.setContent('<style>.mobile-top-bar{margin-top:1000px}.mobile-top-bar > ul > li > ul{display:none}.mobile-top-bar > ul > li.open > ul{display:block}#cover{position:fixed;inset:0;z-index:99}</style><div class="mobile-top-bar"><ul><li><a href="#menu">Menu</a><ul><li><a href="#child">Child</a></li></ul></li></ul></div><div id="cover"></div><script>document.querySelector(".mobile-top-bar > ul > li > a").onclick=e=>{e.preventDefault();e.currentTarget.parentElement.classList.toggle("open")}</script>');
    await expandMobileTopSubmenu(page);
    assert.equal(await page.locator('.mobile-top-bar > ul > li > ul').isVisible(), true);
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
