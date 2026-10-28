// W13 step-0 / delta probe. Mirrors the campaign delta harness page setup:
// loopback fixture page, shared-replay assets fulfilled locally, external
// requests aborted, runtime baseline link optionally disabled, CSS stack
// injected as one <style>, open action performed BEFORE injection (as in the
// delta harness), settle, then a named measurement in the page.
// Usage: node w13-probe.mjs --job=<job.json> --out=<receipt.json>
// Job: {origin, page, widths[], stack[] (theme-lab-relative css), keepLink,
//       correction (abs path or null), open:{click,wait}|null,
//       measure:"files|historyForm|creditHeritage|codeBlock|searchSynth|pane|generic",
//       navFixture:bool, screenshotDir}
import {createRequire} from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const {chromium} = require('/home/roku/.local/state/wikijump/theme-lab/runtime-source-campaign-20261023/framerail/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright/index.js');
const T = '/home/roku/.local/state/wikijump/agents/worktrees/jp-corrections-2506/install/local/theme-lab';
const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return [a.slice(2, i), a.slice(i + 1)]; }));
const job = JSON.parse(fs.readFileSync(args.job, 'utf8'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const stackCss = job.stack.map(rel => fs.readFileSync(path.join(T, rel), 'utf8')).join('\n');
const correctionCss = job.correction ? fs.readFileSync(job.correction, 'utf8') : '';
const inputs = {}; for (const rel of job.stack) { const b = fs.readFileSync(path.join(T, rel)); inputs[rel] = sha(b); }
if (job.correction) inputs[job.correction] = sha(Buffer.from(correctionCss));
const LINK = 'link[rel="stylesheet"][href="/wikidot/styles/sigma-fe5388a32e12.css"]';
const TYPES = {'.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.css': 'text/css', '.gif': 'image/gif', '.webp': 'image/webp', '.jpg': 'image/jpeg'};

const MEASURES = {
  files: `(() => {
    const R = el => { if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.x*10)/10, y: Math.round(r.y*10)/10, w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10, right: Math.round(r.right*10)/10}; };
    const t = document.querySelector('table.page-files');
    const area = document.querySelector('#action-area');
    const rows = t ? [...t.querySelectorAll('tr')].slice(0, 3).map(tr => [...tr.querySelectorAll('td,th')].map(c => ({cls: (typeof c.className === 'string' ? c.className : '').slice(0,30), text: c.textContent.trim().slice(0,40), w: Math.round(c.getBoundingClientRect().width*10)/10, scrollWidth: c.scrollWidth, clientWidth: c.clientWidth, scrollHeight: c.scrollHeight, clientHeight: c.clientHeight}))) : [];
    return {document_width: document.documentElement.scrollWidth, viewport: innerWidth,
      table: t ? {...R(t), scrollWidth: t.scrollWidth, clientWidth: t.clientWidth} : null,
      action_area: R(area), rows};
  })()`,
  historyForm: `(() => {
    const R = el => { if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.x*10)/10, y: Math.round(r.y*10)/10, w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10, right: Math.round(r.right*10)/10, bottom: Math.round(r.bottom*10)/10}; };
    const form = document.querySelector('#history-form-1');
    const area = document.querySelector('#action-area');
    const cs = form ? getComputedStyle(form) : null;
    const perPage = form ? [...form.querySelectorAll('select,input,label,td')].map(e => ({tag: e.tagName, text: (e.textContent||e.value||'').trim().slice(0,24), rect: R(e)})).filter(x => x.text.includes('evision') || x.tagName === 'SELECT') : [];
    return {document_width: document.documentElement.scrollWidth, viewport: innerWidth,
      form: form ? {...R(form), maxHeight: cs.maxHeight, overflowY: cs.overflowY, scrollHeight: form.scrollHeight, clientHeight: form.clientHeight} : null,
      action_area: R(area), per_page_controls: perPage.slice(0, 8)};
  })()`,
  creditHeritage: `(() => {
    const R = el => { if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.x*10)/10, y: Math.round(r.y*10)/10, w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10}; };
    const modal = document.querySelector('#u-credit-view');
    const module = document.querySelector('#u-credit-view .heritage-rating-module');
    const inPage = document.querySelector('#page-content .heritage-rating-module');
    const box = document.querySelector('#u-credit-view .modalbox');
    const info = el => { if (!el) return null; const cs = getComputedStyle(el); return {tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60), text: (el.textContent || '').trim().slice(0, 60), rect: R(el), color: cs.color, backgroundColor: cs.backgroundColor, opacity: cs.opacity, visibility: cs.visibility, display: cs.display}; };
    const label = module ? module.querySelector('.rating-module-text, span, div') : null;
    const subtree = module ? [...module.querySelectorAll('*')].slice(0, 14).map(e => { const cs = getComputedStyle(e); return {tag: e.tagName, cls: (typeof e.className === 'string' ? e.className : '').slice(0, 44), text: (e.textContent || '').trim().slice(0, 24), color: cs.color, bg: cs.backgroundColor, rect: R(e)}; }) : [];
    return {document_width: document.documentElement.scrollWidth, viewport: innerWidth, hash: location.hash, modal: info(modal), modalbox: info(box), heritage_module: info(module), heritage_label: info(label), in_page_module: info(inPage), subtree};
  })()`,
  codeBlock: `(() => {
    const R = el => { if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.x*10)/10, y: Math.round(r.y*10)/10, w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10, right: Math.round(r.right*10)/10}; };
    const code = document.querySelector('#page-content .code, #page-content div.code');
    const pc = document.querySelector('#page-content');
    const pre = code ? code.querySelector('pre') : null;
    const cs = code ? getComputedStyle(code) : null;
    return {document_width: document.documentElement.scrollWidth, viewport: innerWidth,
      page_content: R(pc),
      code: code ? {...R(code), scrollWidth: code.scrollWidth, clientWidth: code.clientWidth, overflowX: cs.overflowX, overflow: cs.overflow} : null,
      pre: pre ? {...R(pre), scrollWidth: pre.scrollWidth, clientWidth: pre.clientWidth, whiteSpace: getComputedStyle(pre).whiteSpace, overflowX: getComputedStyle(pre).overflowX} : null};
  })()`,
  searchSynth: `(() => {
    const R = el => { if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.x*10)/10, y: Math.round(r.y*10)/10, w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10}; };
    const input = document.querySelector('#search-top-box-input') || document.querySelector('#search-top-box input.text, .search input[type="text"], input.search');
    const form = document.querySelector('#search-top-box, form.search');
    const cs = input ? getComputedStyle(input) : null;
    return {document_width: document.documentElement.scrollWidth, viewport: innerWidth,
      input: input ? {...R(input), display: cs.display, visibility: cs.visibility, opacity: cs.opacity, value: input.value} : null,
      form: R(form)};
  })()`,
  pane: `(() => {
    const R = el => { if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.x*10)/10, y: Math.round(r.y*10)/10, w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10, right: Math.round(r.right*10)/10, bottom: Math.round(r.bottom*10)/10}; };
    const area = document.querySelector('#action-area');
    const acs = area ? getComputedStyle(area) : null;
    let behind = null;
    if (area) { const r = area.getBoundingClientRect(); const x = Math.min(innerWidth - 2, r.x + r.width / 2), y = Math.min(innerHeight - 2, r.y + 24);
      const stack = document.elementsFromPoint(x, y).slice(0, 5).map(e => ({tag: e.tagName, id: e.id, cls: (typeof e.className === 'string' ? e.className : '').slice(0, 40), bg: getComputedStyle(e).backgroundColor}));
      behind = {x, y, stack}; }
    return {document_width: document.documentElement.scrollWidth, viewport: innerWidth,
      action_area: area ? {...R(area), maxHeight: acs.maxHeight, backgroundColor: acs.backgroundColor, color: acs.color} : null, behind};
  })()`,
  hovertip: `(() => {
    const R = el => { if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.x*10)/10, y: Math.round(r.y*10)/10, w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10, right: Math.round(r.right*10)/10, bottom: Math.round(r.bottom*10)/10}; };
    const tips = [...document.querySelectorAll('.hovertip')].map(e => { const cs = getComputedStyle(e); return {cls: (typeof e.className === 'string' ? e.className : '').slice(0, 40), text: (e.textContent || '').trim().slice(0, 30), rect: R(e), display: cs.display, visibility: cs.visibility, opacity: cs.opacity, position: cs.position}; });
    const title = document.querySelector('#page-title');
    return {document_width: document.documentElement.scrollWidth, viewport: innerWidth, hovertips: tips, page_title: R(title)};
  })()`,
  creditHovertip: `(() => {
    const R = el => { if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.x*10)/10, y: Math.round(r.y*10)/10, w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10, right: Math.round(r.right*10)/10, bottom: Math.round(r.bottom*10)/10}; };
    const title = document.querySelector('#page-title');
    const tips = [...document.querySelectorAll('.hovertip')].map(e => { const cs = getComputedStyle(e); const r = R(e); const inCredit = !!e.closest('[id*=credit], .credit, [class*=credit]'); return {text: (e.textContent || '').trim().slice(0, 30), rect: r, display: cs.display, visibility: cs.visibility, inCredit, parentCls: (typeof e.parentElement?.className === 'string' ? e.parentElement.className : '').slice(0, 40)}; }).filter(t => t.display !== 'none' || t.inCredit);
    return {document_width: document.documentElement.scrollWidth, viewport: innerWidth, hash: location.hash, page_title: R(title), tips};
  })()`,
  navFocus: `(() => {
    const R = el => { if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.x*10)/10, y: Math.round(r.y*10)/10, w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10, right: Math.round(r.right*10)/10, bottom: Math.round(r.bottom*10)/10}; };
    const active = document.activeElement;
    const info = el => { if (!el) return null; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); const cx = r.x + r.width / 2, cy = r.y + r.height / 2; const hit = (cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight) ? document.elementFromPoint(cx, cy) : null; return {tag: el.tagName, text: (el.textContent || '').trim().slice(0, 24), rect: R(el), display: cs.display, visibility: cs.visibility, hitIsSelfOrChild: hit ? (hit === el || el.contains(hit)) : null, hitDesc: hit ? (hit.tagName + (hit.id ? '#' + hit.id : '')) : null}; };
    const li = active ? active.closest('li') : null;
    const sub = li ? li.querySelector('ul') : null;
    return {document_width: document.documentElement.scrollWidth, viewport: innerWidth, active: info(active), submenu: info(sub)};
  })()`,
  generic: `(() => ({document_width: document.documentElement.scrollWidth, viewport: innerWidth}))()`,
};

const browser = await chromium.launch({headless: true});
const rows = [];
try {
  for (const variant of [{name: 'without', css: stackCss}, {name: 'with', css: stackCss + '\n' + correctionCss}]) {
    if (variant.name === 'with' && !job.correction) continue;
    for (const width of job.widths) {
      const context = await browser.newContext({ignoreHTTPSErrors: true, viewport: {width, height: 1000}, deviceScaleFactor: 1});
      await context.route('**/*', async route => {
        const u = new URL(route.request().url());
        if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
        if (u.origin === new URL(job.origin).origin) {
          const name = decodeURIComponent(u.pathname.replace(/^\//u, ''));
          for (const dir of ['ports/shared-replay-assets', 'ports/site/page-assets']) {
            const file = path.join(T, dir, name);
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
      if (job.open && job.open.clickJS) { await page.evaluate(sel => document.querySelector(sel)?.click(), job.open.clickJS); if (job.open.wait) await page.locator(job.open.wait).waitFor({timeout: 30000}); if (job.open.waitHash) await page.waitForFunction(h => location.hash === h, job.open.waitHash, {timeout: 30000}); await page.waitForTimeout(800); }
      else if (job.open && !job.openAfter) { await page.locator(job.open.click).first().click(); if (job.open.wait) await page.locator(job.open.wait).waitFor({timeout: 30000}); if (job.open.waitHash) await page.waitForFunction(h => location.hash === h, job.open.waitHash, {timeout: 30000}); await page.waitForTimeout(800); }
      if (job.pre && !job.preAfter) { for (const step of job.pre) { if (step.click) await page.locator(step.click).first().click(); if (step.type) await page.keyboard.type(step.type); if (step.wait) await page.waitForTimeout(step.wait); } await page.waitForTimeout(500); }
      await page.evaluate(({link, css, keepLink}) => {
        if (!keepLink) { const sheet = document.querySelector(link); if (sheet) { sheet.disabled = true; sheet.media = 'not all'; } }
        const style = document.createElement('style'); style.setAttribute('data-w13-probe', ''); style.textContent = css; document.head.append(style);
      }, {link: LINK, css: variant.css, keepLink: !!job.keepLink});
      if (job.open && job.openAfter) { await page.locator(job.open.click).first().click(); await page.locator(job.open.wait).waitFor({timeout: 30000}); await page.waitForTimeout(800); }
      await page.waitForTimeout(1500);
      if (job.pre && job.preAfter) { for (const step of job.pre) { if (step.focusFirstNav) { await page.evaluate(() => { const anchors = [...document.querySelectorAll('#header a, #top-bar a')].filter(a => { const r = a.getBoundingClientRect(); return r.width > 0 && r.y >= 0 && r.y < 260 && a.closest('li') && a.closest('ul'); }); const a = anchors[0]; if (a) a.focus(); }); await page.waitForTimeout(600); }
      if (step.focusSearch) { await page.evaluate(() => { const i = document.querySelector('#search-top-box-input'); if (i) { i.focus(); i.value = 'テスト'; i.dispatchEvent(new Event('input', {bubbles: true})); i.dispatchEvent(new Event('change', {bubbles: true})); } }); } if (step.click) await page.locator(step.click).first().click(); if (step.type) await page.keyboard.type(step.type); if (step.wait) await page.waitForTimeout(step.wait); } await page.waitForTimeout(500); }
      await page.evaluate(() => { for (const a of document.getAnimations()) { try { a.finish(); } catch {} } });
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.waitForTimeout(300);
      const measured = await page.evaluate(MEASURES[job.measure]);
      let screenshot = null;
      if (job.screenshotDir) { fs.mkdirSync(job.screenshotDir, {recursive: true}); const f = path.join(job.screenshotDir, `${job.measure}-${width}-${variant.name}.png`); await page.screenshot({path: f}); screenshot = f; }
      rows.push({width, variant: variant.name, http_status: response?.status() ?? null, measured, screenshot});
      await context.close();
    }
  }
} finally { await browser.close(); }
const receipt = {schema: 'w13_probe.v1', job: {origin: job.origin, page: job.page, measure: job.measure, widths: job.widths, keepLink: !!job.keepLink, open: job.open ?? null}, inputs, rows};
fs.writeFileSync(args.out, JSON.stringify(receipt, null, 1));
console.log(JSON.stringify({rows: rows.length, out: args.out}));
