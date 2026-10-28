// Freeze-3 hansarp probe. Mirrors the W13 probe page setup: loopback fixture
// page, shared-replay assets fulfilled locally, external requests aborted,
// runtime baseline stylesheet link disabled, CSS stack injected as one
// <style>, settle, then a named action + measurement in the page.
// Usage: node freeze3-probe.mjs --job=<job.json> --out=<receipt.json>
// Job: {origin, page, widths[], stack[] (abs css paths), variants:[{name,
//       extraCssFile|null}], action:"search|history|creditBack",
//       screenshotDir|null}
import {createRequire} from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const {chromium} = require('/home/roku/.local/state/wikijump/theme-lab/runtime-source-campaign-20261023/framerail/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright/index.js');
const TL = '/home/roku/.local/state/wikijump/agents/worktrees/freeze3-hansarp/install/local/theme-lab';
const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return [a.slice(2, i), a.slice(i + 1)]; }));
const job = JSON.parse(fs.readFileSync(args.job, 'utf8'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const readStack = rel => fs.readFileSync(rel.startsWith('/') ? rel : path.join(TL, rel), 'utf8');
const stackCss = (job.stack ?? []).map(readStack).join('\n');
const inputs = {};
for (const rel of (job.stack ?? [])) inputs[rel] = sha(Buffer.from(readStack(rel)));
const variants = (job.variants ?? [{name: 'only', extraCssFile: null}]).map(v => {
  const extra = v.extraCssFile ? fs.readFileSync(v.extraCssFile, 'utf8') : '';
  if (v.extraCssFile) inputs[v.extraCssFile] = sha(Buffer.from(extra));
  return {name: v.name, css: stackCss + '\n' + extra};
});
const TYPES = {'.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.css': 'text/css', '.gif': 'image/gif', '.webp': 'image/webp', '.jpg': 'image/jpeg'};

const OVERFLOW_FN = `(() => {
  const R = el => { const r = el.getBoundingClientRect(); return {x: Math.round(r.x*10)/10, y: Math.round(r.y*10)/10, w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10, right: Math.round(r.right*10)/10}; };
  const desc = el => ({tag: el.tagName, id: el.id || '', cls: (typeof el.className === 'string' ? el.className : '').slice(0, 50), text: (el.textContent || '').trim().slice(0, 30), rect: R(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth});
  const wide = [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && getComputedStyle(el).display !== 'none' && (r.right > innerWidth + 1 || r.left < -1); })
    .map(el => ({...desc(el), right_overflow: Math.round((el.getBoundingClientRect().right - innerWidth)*10)/10})).sort((a, b) => b.right_overflow - a.right_overflow).slice(0, 20);
  return {document_width: document.documentElement.scrollWidth, viewport: innerWidth, wide};
})()`;

const SEARCH_MEASURE = `(() => {
  const R = el => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return {x: Math.round(r.x*10)/10, y: Math.round(r.y*10)/10, w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10, right: Math.round(r.right*10)/10, display: cs.display, position: cs.position}; };
  const input = document.querySelector('#search-top-box-input');
  const form = document.querySelector('#search-top-box-form');
  const submit = document.querySelector('#search-top-box-form input[type="submit"]');
  const chain = [];
  let el = form;
  while (el && el !== document.body && chain.length < 6) { chain.push({sel: el.tagName + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().replace(/\\s+/g, '.').slice(0, 40) : ''), rect: R(el)}); el = el.parentElement; }
  return {input: input ? {...R(input), value: input.value, focused: document.activeElement === input} : null,
    form: R(form), submit: R(submit), ancestors: chain,
    active_element: document.activeElement ? (document.activeElement.tagName + '#' + (document.activeElement.id || '')) : null};
})()`;

const HISTORY_MEASURE = `(() => {
  const R = el => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return {x: Math.round(r.x*10)/10, y: Math.round(r.y*10)/10, w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10, right: Math.round(r.right*10)/10, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, width_css: cs.width, minWidth: cs.minWidth, whiteSpace: cs.whiteSpace, tableLayout: cs.tableLayout, borderSpacing: cs.borderSpacing, padding: cs.padding}; };
  const form = document.querySelector('#history-form-1');
  const area = document.querySelector('#action-area');
  const inside = form ? [...form.querySelectorAll('*')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 1); })
    .map(el => ({tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40), text: (el.textContent || '').trim().slice(0, 36), rect: R(el)})).slice(0, 30) : [];
  const table = form ? form.querySelector('table') : null;
  const rows = table ? [...table.querySelectorAll('tr')].slice(0, 4).map(tr => [...tr.querySelectorAll('td,th')].map(c => ({tag: c.tagName, text: (c.textContent || '').trim().slice(0, 28), rect: R(c)}))) : [];
  const revlist = document.querySelector('table.page-history, #revision-list, .page-history');
  return {form: R(form), action_area: R(area), table: R(table), rows, revision_list: R(revlist), inside_overflow: inside};
})()`;

async function settle(page) {
  await page.evaluate(() => { for (const a of document.getAnimations()) { try { a.finish(); } catch {} } });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(300);
}

const browser = await chromium.launch({headless: true});
const rows = [];
try {
  for (const variant of variants) {
    for (const width of job.widths) {
      const context = await browser.newContext({ignoreHTTPSErrors: true, viewport: {width, height: 1000}, deviceScaleFactor: 1});
      await context.addInitScript(() => {
        window.__focusTrace = [];
        const rec = type => e => { window.__focusTrace.push({type, t: Math.round(performance.now()), target: (e.target?.tagName || '') + '#' + (e.target?.id || ''), related: (e.relatedTarget?.tagName || '') + '#' + (e.relatedTarget?.id || ''), active: (document.activeElement?.tagName || '') + '#' + (document.activeElement?.id || '')}); };
        for (const t of ['focusin', 'focusout', 'focus', 'blur']) document.addEventListener(t, rec(t), true);
      });
      await context.route('**/*', async route => {
        const u = new URL(route.request().url());
        if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
        if (u.origin === new URL(job.origin).origin) {
          const name = decodeURIComponent(u.pathname.replace(/^\//u, ''));
          for (const dir of ['ports/shared-replay-assets', 'ports/site/page-assets']) {
            const file = path.join(TL, dir, name);
            if (/^[0-9a-f]{64}\.[a-z0-9]+$/u.test(name) && fs.existsSync(file)) return route.fulfill({status: 200, contentType: TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream', body: fs.readFileSync(file)});
          }
          return route.continue();
        }
        return route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      const response = await page.goto(`${job.origin}/${encodeURIComponent(job.page)}`, {waitUntil: 'load', timeout: 60000});
      await page.waitForSelector('#top-bar', {timeout: 30000});
      await page.waitForTimeout(2000);
      let actionResult = null;
      if (job.action === 'history') {
        await page.evaluate(sel => document.querySelector(sel)?.click(), '#history-button');
        await page.locator('#history-form-1').waitFor({timeout: 30000});
        await page.waitForTimeout(800);
      }
      await page.evaluate(css => {
        for (const sheet of document.querySelectorAll('link[rel="stylesheet"]')) { if ((sheet.getAttribute('href') || '').includes('/wikidot/styles/')) { sheet.disabled = true; sheet.media = 'not all'; } }
        const style = document.createElement('style'); style.setAttribute('data-freeze3-probe', ''); style.textContent = css; document.head.append(style);
      }, variant.css);
      await page.waitForTimeout(1500);
      await settle(page);
      if (job.action === 'search') {
        actionResult = await (async () => {
          const query = page.locator('#search-top-box-input');
          const submit = page.locator('#search-top-box-form input[type="submit"]');
          await submit.focus();
          const state = await query.evaluate(element => { const style = getComputedStyle(element), rect = element.getBoundingClientRect(); return {display: style.display, visibility: style.visibility, width: rect.width, height: rect.height, value: element.value}; });
          if (state.display === 'none' || state.visibility === 'hidden' || !state.width || !state.height) {
            const origin = new URL(page.url()).origin;
            const expected = '/search:site/q/' + encodeURIComponent(state.value);
            let observed = null, finish; const requested = new Promise(resolve => { finish = resolve; });
            const pattern = origin + '/search:site/q/**';
            const intercept = async route => { if (!route.request().isNavigationRequest()) return route.continue(); observed = new URL(route.request().url()).pathname; await route.fulfill({status: 204}); finish(); };
            await page.route(pattern, intercept);
            let timer, error = null;
            try {
              await submit.click({noWaitAfter: true});
              await Promise.race([requested, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('submit did not request search route')), 2000); })]);
            } catch (e) { error = e.message; } finally { clearTimeout(timer); await page.unroute(pattern, intercept); }
            return {mode: 'compact-submit', state, expected_path: expected, observed_path: observed, error};
          }
          await query.fill('SCP-JP テーマ');
          await query.focus();
          const immediate = await query.evaluate(element => element.value === 'SCP-JP テーマ' && document.activeElement === element);
          await page.waitForTimeout(1500);
          await settle(page);
          const afterSettle = await query.evaluate(element => ({typed_and_focused: element.value === 'SCP-JP テーマ' && document.activeElement === element, active: (document.activeElement?.tagName || '') + '#' + (document.activeElement?.id || '')}));
          const trace = await page.evaluate(() => window.__focusTrace ?? []);
          return {mode: 'typed-focused', state, typed_and_focused_immediate: immediate, after_settle: afterSettle, focus_trace: trace};
        })();
        await settle(page);
      }
      if (job.action === 'creditBack') {
        // Replicates the Sigma-10 campaign action for credit.otherwise
        // back-control-click (src/sigma10-credit-actions.mjs) exactly:
        // open view, open otherwise, scroll, return-credits click, fold waits.
        actionResult = await (async () => {
          const out = {steps: []};
          try {
            await page.locator('.creditRate > .rateBox > .rate-box-with-credit-button .creditButton a:visible').last().click({timeout: 10000});
            await page.locator('.creditRate > .rateBox.unfolded').waitFor({state: 'attached', timeout: 10000});
            await page.locator('#u-credit-view .modalbox').first().waitFor({state: 'visible', timeout: 10000});
            out.steps.push('view-open');
            await page.locator('#u-credit-view .creditRateOtherwise > li > .foldable-list-container a').click({timeout: 10000});
            await page.locator('.creditRateOtherwise > li.unfolded').waitFor({state: 'attached', timeout: 10000});
            await page.locator('#u-credit-otherwise .modalbox').waitFor({state: 'visible', timeout: 10000});
            out.steps.push('otherwise-open');
            await page.locator('#u-credit-otherwise .credit.otherwise').evaluate(element => element.scrollTop = element.scrollHeight);
            await settle(page);
            out.hit = await page.evaluate(() => {
              const control = document.querySelector('#u-credit-otherwise .return-credits a');
              if (!control) return {control: null};
              const r = control.getBoundingClientRect();
              const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
              const stack = document.elementsFromPoint(cx, cy).slice(0, 6).map(e => ({tag: e.tagName, id: e.id || '', cls: (typeof e.className === 'string' ? e.className : '').slice(0, 50), text: (e.textContent || '').trim().slice(0, 16), isControl: e === control || control.contains(e)}));
              const fa = document.querySelector('#main-content :is(#u-credit-view,#u-credit-otherwise) > .fader.foldable-list-container > a');
              const far = fa ? fa.getBoundingClientRect() : null;
              const facs = fa ? getComputedStyle(fa) : null;
              return {control_rect: {x: r.x, y: r.y, w: r.width, h: r.height}, control_visible: r.width > 0 && r.height > 0, click_point: {x: cx, y: cy}, stack,
                fader_anchor: fa ? {rect: {x: far.x, y: far.y, w: far.width, h: far.height, right: far.right, bottom: far.bottom}, style: {position: facs.position, zIndex: facs.zIndex, transform: facs.transform, translate: facs.translate}} : null};
            });
            await page.locator('#u-credit-otherwise .return-credits a').click({timeout: 8000});
            out.steps.push('back-clicked');
            await page.locator('.creditRateOtherwise > li.folded').waitFor({state: 'attached', timeout: 8000});
            await page.locator('#u-credit-otherwise .modalbox').waitFor({state: 'hidden', timeout: 8000});
            await page.locator('#u-credit-view .modalbox').first().waitFor({state: 'visible', timeout: 8000});
            out.steps.push('returned-to-view');
            out.back_click = 'pass';
          } catch (e) { out.back_click = 'fail'; out.error = e.message.split('\n').slice(0, 10).join(' | '); }
          return out;
        })();
        await settle(page);
      }
      if (job.action === 'creditDebug') {
        actionResult = await page.evaluate(() => {
          const info = sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return {rect: {x: r.x, y: r.y, w: r.width, h: r.height}, display: cs.display, visibility: cs.visibility, cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60)}; };
          const btns = [...document.querySelectorAll('.creditRate > .rateBox > .rate-box-with-credit-button .creditButton a')].map(a => ({text: (a.textContent || '').trim().slice(0, 20), visible: !!(a.offsetWidth || a.offsetHeight)}));
          return {creditRate: info('.creditRate'), rateBox: info('.creditRate > .rateBox'), uCreditView: info('#u-credit-view'), buttons: btns, hash: location.hash};
        });
        try { await page.locator('.creditRate > .rateBox > .rate-box-with-credit-button .creditButton a:visible').last().click({timeout: 6000}); actionResult.click = 'clicked'; } catch (e) { actionResult.click = 'click-failed: ' + e.message.split('\n')[0]; }
        await page.waitForTimeout(1500);
        actionResult.after = await page.evaluate(() => { const rb = document.querySelector('.creditRate > .rateBox'); const m = document.querySelector('#u-credit-view .modalbox'); const cs = m ? getComputedStyle(m) : null; return {rateBoxCls: rb ? (typeof rb.className === 'string' ? rb.className : '') : null, modal: m ? {display: cs.display, visibility: cs.visibility} : null, hash: location.hash}; });
      }
      const overflow = await page.evaluate(OVERFLOW_FN);
      let specific = null;
      if (job.action === 'search') specific = await page.evaluate(SEARCH_MEASURE);
      if (job.action === 'history') specific = await page.evaluate(HISTORY_MEASURE);
      let screenshot = null;
      if (job.screenshotDir) { fs.mkdirSync(job.screenshotDir, {recursive: true}); const f = path.join(job.screenshotDir, `${job.action}-${width}-${variant.name}.png`); await page.screenshot({path: f}); screenshot = f; }
      rows.push({width, variant: variant.name, http_status: response?.status() ?? null, action_result: actionResult, overflow, specific, screenshot});
      await context.close();
    }
  }
} finally { await browser.close(); }
const receipt = {schema: 'theme_lab_freeze3_probe.v1', job: {origin: job.origin, page: job.page, action: job.action, widths: job.widths}, inputs, rows};
fs.writeFileSync(args.out, JSON.stringify(receipt, null, 1));
console.log(JSON.stringify({rows: rows.length, out: args.out}));
