// Freeze-3 class-B reproduction: sigma10 credit actions on sigma10-main with
// the full S10 stack (sigma10-offline baseline + candidate), WITHOUT finishing
// animations before the click, with a mouse path over the panel like a real
// click, and a hit-test of the otherwise fader anchor at the control point.
// Usage: node freeze3-credit-repro.mjs --job=<job.json> --out=<receipt.json>
// Job: {origin, page, widths[], stack[], variants:[{name, extraCssFile|null}]}
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
const variants = (job.variants ?? []).map(v => {
  const extra = v.extraCssFile ? fs.readFileSync(v.extraCssFile, 'utf8') : '';
  if (v.extraCssFile) inputs[v.extraCssFile] = sha(Buffer.from(extra));
  return {name: v.name, css: stackCss + '\n' + extra};
});
const TYPES = {'.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.css': 'text/css', '.gif': 'image/gif', '.webp': 'image/webp', '.jpg': 'image/jpeg'};

const HIT_FN = `(() => {
  const control = document.querySelector('#u-credit-otherwise .return-credits a');
  if (!control) return {control: null};
  const r = control.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const stack = document.elementsFromPoint(cx, cy).slice(0, 6).map(e => ({tag: e.tagName, id: e.id || '', cls: (typeof e.className === 'string' ? e.className : '').slice(0, 50), text: (e.textContent || '').trim().slice(0, 16), isControl: e === control || control.contains(e)}));
  const info = a => { if (!a) return null; const b = a.getBoundingClientRect(); const cs = getComputedStyle(a); return {rect: {x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom}, style: {position: cs.position, zIndex: cs.zIndex, transform: cs.transform, translate: cs.translate, display: cs.display, visibility: cs.visibility}}; };
  const viewAnchor = document.querySelector('#u-credit-view > .fader.foldable-list-container > a, #main-content #u-credit-view > .fader > a');
  const otherwiseAnchor = document.querySelector('#u-credit-otherwise > .fader.foldable-list-container > a, #main-content #u-credit-otherwise > .fader > a');
  const faderDiv = document.querySelector('#u-credit-otherwise > .fader, #main-content #u-credit-otherwise > .fader');
  return {control_rect: {x: r.x, y: r.y, w: r.width, h: r.height}, click_point: {x: cx, y: cy}, stack,
    view_anchor: info(viewAnchor), otherwise_anchor: info(otherwiseAnchor), otherwise_fader_div: info(faderDiv)};
})()`;

const browser = await chromium.launch({headless: true});
const rows = [];
try {
  for (const variant of variants) {
    for (const width of job.widths) {
      const context = await browser.newContext({ignoreHTTPSErrors: true, viewport: {width, height: 1000}, deviceScaleFactor: 1});
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
      await page.evaluate(css => {
        for (const sheet of document.querySelectorAll('link[rel="stylesheet"]')) { if ((sheet.getAttribute('href') || '').includes('/wikidot/styles/')) { sheet.disabled = true; sheet.media = 'not all'; } }
        const style = document.createElement('style'); style.setAttribute('data-freeze3-probe', ''); style.textContent = css; document.head.append(style);
      }, variant.css);
      await page.waitForTimeout(1200);
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
        // No animation finishing: hit-test at rest, then after a mouse path
        // over the panel to the control (the hover state a real click sees).
        out.hit_at_rest = await page.evaluate(HIT_FN);
        const cp = out.hit_at_rest.click_point;
        if (cp) { await page.mouse.move(cp.x, cp.y, {steps: 12}); await page.waitForTimeout(350); }
        out.hit_after_hover = await page.evaluate(HIT_FN);
        await page.locator('#u-credit-otherwise .return-credits a').click({timeout: 5000});
        out.steps.push('back-clicked');
        await page.locator('.creditRateOtherwise > li.folded').waitFor({state: 'attached', timeout: 8000});
        await page.locator('#u-credit-otherwise .modalbox').waitFor({state: 'hidden', timeout: 8000});
        await page.locator('#u-credit-view .modalbox').first().waitFor({state: 'visible', timeout: 8000});
        out.steps.push('returned-to-view');
        out.back_click = 'pass';
      } catch (e) { out.back_click = 'fail'; out.error = e.message.split('\n').slice(0, 12).join(' | '); }
      rows.push({width, variant: variant.name, http_status: response?.status() ?? null, action_result: out});
      await context.close();
    }
  }
} finally { await browser.close(); }
const receipt = {schema: 'theme_lab_freeze3_credit_repro.v1', job: {origin: job.origin, page: job.page, widths: job.widths}, inputs, rows};
fs.writeFileSync(args.out, JSON.stringify(receipt, null, 1));
console.log(JSON.stringify({rows: rows.length, out: args.out}));
