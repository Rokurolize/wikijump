import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {loadChromium} from '../src/browser-lab.mjs';
import {measureTitleComposition} from '../src/title-composition.mjs';
import {measureTitleTextIntersections} from '../src/title-text-intersections.mjs';

test('a menu crossing empty title-container space is a machine fact; actual text intersection remains visible', async t => {
  const browser = await loadChromium().launch({headless: true});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport: {width: 1000, height: 800}});
  await page.route('**/*', route => route.abort());
  await page.setContent('<style>#page-title{position:absolute;left:0;top:0;width:900px;height:40px} .menu{position:absolute;top:0;left:700px}</style><div id="page-title">Title</div><a class="menu">Menu</a>');
  const containers = await page.evaluate(measureTitleComposition);
  assert.equal(containers.overlaps[0].effectively_visible, true);
  assert.deepEqual((await page.evaluate(measureTitleTextIntersections, containers.overlaps)).intersections, []);
  await page.locator('.menu').evaluate(element => {element.style.left = '0';});
  const actual = await page.evaluate(measureTitleComposition);
  assert.equal((await page.evaluate(measureTitleTextIntersections, actual.overlaps)).intersections.length, 1);
  await page.locator('#page-title').evaluate(element => {element.style.top = '-100px';});
  await page.locator('.menu').evaluate(element => {element.style.top = '-100px';});
  const offscreen = await page.evaluate(measureTitleComposition);
  assert.deepEqual((await page.evaluate(measureTitleTextIntersections, offscreen.overlaps)).intersections, []);
});
import {wikidotRevisionSourceHtml} from '../../../../framerail/src/lib/wikidot-history-contract.js';

test('composition observes inherited hiding and clipping instead of treating hidden boxes as visual failures', async t => {
  const browser = await loadChromium().launch({headless: true});
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.setContent(`<style>#page-title{position:absolute;left:0;top:0;width:100px;height:30px}
    .menu{position:absolute;left:0;top:0} .hidden{opacity:0}.clip{height:0;overflow:hidden}</style>
    <div id="page-title">Title</div><div class="menu hidden"><a>Hidden inherited opacity</a></div>
    <div class="menu clip"><a>Clipped inherited box</a></div><div class="menu"><a>Visible menu</a></div>`);
  const measured = await page.evaluate(measureTitleComposition);
  assert.equal(measured.complete, true);
  assert.deepEqual(measured.overlaps.map(row => [row.text, row.effectively_visible]),
    [['Hidden inherited opacity', false], ['Clipped inherited box', false], ['Visible menu', true]]);
});

test('source-authoritative historical-source div stays inside the phone article without a theme override', async t => {
  const browser = await loadChromium().launch({headless: true});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  await page.route('**/*', route => route.abort());
  const base = await fs.readFile(new URL('../../../../framerail/static/wikidot/styles/wikidot-base-165bc434fd1d.css', import.meta.url), 'utf8');
  const source = '日本語 source\n\n<img src=x onerror="throw new Error()">';
  await page.setContent(`<style>${base}</style><div style="width:351px;margin-left:20px">${wikidotRevisionSourceHtml(source)}</div>`);
  const measured = await page.locator('.page-source').evaluate(node => ({tag: node.tagName,
    right: node.getBoundingClientRect().right, text: node.textContent, images: node.querySelectorAll('img').length,
    breaks: node.querySelectorAll('br').length, document_width: document.documentElement.scrollWidth}));
  assert.equal(measured.tag, 'DIV');
  assert.ok(measured.right <= 390);
  assert.ok(measured.document_width <= 390);
  assert.equal(measured.images, 0);
  assert.equal(measured.breaks, 2);
  assert.equal(measured.text, source);
});
