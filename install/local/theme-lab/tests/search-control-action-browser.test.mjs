import test from 'node:test';
import assert from 'node:assert/strict';
import {loadChromium} from '../src/browser-lab.mjs';
import {exerciseHeaderSearch} from '../src/search-control-action.mjs';

test('search action types into visible fields and exercises source-hidden submit without leaving the fixture', async t => {
  const browser = await loadChromium().launch({headless: true});
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({contentType: 'text/html', body: '<title>Fixture</title>'}));
  await page.goto('http://127.0.0.1/header-fixture');
  const fixture = async hidden => {
    await page.setContent(`<style>#search-top-box-input{display:${hidden ? 'none' : 'inline-block'}}</style>
      <h1 id="page-title">Fixture</h1><form id="search-top-box-form" action="dummy">
      <input id="search-top-box-input" name="query" value="サイト内検索"><input type="submit" value="検索"></form>`);
    await page.evaluate(() => document.querySelector('form').addEventListener('submit', event => {
      event.preventDefault(); location.href = '/search:site/q/' + encodeURIComponent(document.querySelector('#search-top-box-input').value);
    }));
  };
  await fixture(false);
  assert.equal((await exerciseHeaderSearch(page)).mode, 'typed-focused');
  assert.equal(await page.locator('#search-top-box-input').inputValue(), 'SCP-JP テーマ');
  await fixture(true);
  const authority = {path: 'source-action.json', sha256: 'a'.repeat(64)};
  const hidden = await exerciseHeaderSearch(page, authority);
  assert.equal(hidden.mode, 'source-hidden-submit');
  assert.equal(hidden.observed_path, '/search:site/q/' + encodeURIComponent('サイト内検索'));
  assert.deepEqual(hidden.source_authority, authority);
  assert.equal(page.url(), 'http://127.0.0.1/header-fixture');
  assert.equal(await page.locator('#page-title').textContent(), 'Fixture');
  assert.equal(await page.locator('#search-top-box-input').inputValue(), 'サイト内検索');
});

test('a hidden input with a wrong native query route remains an action failure', async t => {
  const browser = await loadChromium().launch({headless: true});
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({contentType: 'text/html', body: '<form id="search-top-box-form"><input id="search-top-box-input" style="display:none" value="query"><input type="submit"></form>'}));
  await page.goto('http://127.0.0.1/header-fixture');
  await page.evaluate(() => document.querySelector('form').addEventListener('submit', event => {
    event.preventDefault(); location.href = '/search:site/q/wrong';
  }));
  await assert.rejects(exerciseHeaderSearch(page), /different query route/);
});
