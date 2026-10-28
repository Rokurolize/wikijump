// Same-target before/after measurements for the redtape pre-freeze fixes
// (Q1-9 mobile submenu grid, Q1-7 credit-modal heritage module). Stack: the
// frozen credit-component sheet under the redtape candidate (the heritage
// composition), candidate replaced Sigma-9 sheet. "with" appends only the
// correction blocks. Loopback GET only.
import {createRequire} from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const {chromium} = require('/home/roku/.local/state/wikijump/theme-lab/runtime-source-campaign-20261023/framerail/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.js');
const T = '/home/roku/.local/state/wikijump/agents/wt-fixbatch/install/local/theme-lab';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a, []));
const stack = fs.readFileSync(T + '/ports/shared-replay-assets/0f739579cd2a2dc899bdff7d5b0568cdd35696172fe759109adf40afdd22193d.css', 'utf8')
  + '\n' + fs.readFileSync(T + '/ports/redtape/candidate.css', 'utf8');
const navHtml = fs.readFileSync(T + '/fixtures/scp-jp-navigation.html', 'utf8');
const correction = fs.readFileSync(args.correction, 'utf8').trim();
const PAGE = 'https://scpaiueouiuiuiui.wikijump.localhost:3410/run-owned%3Atheme-lab-visual-acceptance-imported-20260924';
const browser = await chromium.launch();
async function setup(width, nav) {
  const ctx = await browser.newContext({viewport: {width, height: 900}, ignoreHTTPSErrors: true});
  const page = await ctx.newPage();
  await page.goto(PAGE, {waitUntil: 'load', timeout: 60000});
  await page.waitForSelector('#top-bar', {timeout: 30000});
  await page.waitForTimeout(1500);
  if (nav) { await page.locator('#top-bar').evaluate((e, html) => { e.innerHTML = html; }, navHtml); await page.waitForTimeout(500); }
  return {ctx, page};
}
function inject(page, css) {
  return page.evaluate((css) => {
    const link = document.querySelector('link[rel="stylesheet"][href*="theme"]');
    if (link) { link.disabled = true; link.media = 'not all'; }
    const st = document.createElement('style'); st.textContent = css; document.head.append(st);
  }, css);
}
const lum = rgb => { const m = (rgb.match(/[0-9.]+/g) || []).map(Number); if (m.length < 3) return null; const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
const rows = [];
for (const variant of ['without', 'with']) {
  const css = variant === 'with' ? stack + '\n' + correction : stack;
  // Q1-9: mobile submenu at 390 and 320
  for (const width of [390, 320]) {
    const {ctx, page} = await setup(width, true);
    await inject(page, css);
    await page.waitForTimeout(800);
    await page.locator('.open-menu').click().catch(() => {});
    await page.waitForTimeout(800);
    const menu = await page.evaluate(() => {
      const ul = document.querySelector('#top-bar .mobile-top-bar > ul > li > ul');
      if (!ul) return null;
      const cs = getComputedStyle(ul);
      const items = [...ul.children].filter(li => li.getBoundingClientRect().height > 0);
      const xs = new Set(items.map(li => Math.round(li.getBoundingClientRect().x)));
      return {display: cs.display, grid_template_columns: cs.gridTemplateColumns, items: items.length, distinct_item_x: xs.size};
    });
    rows.push({check: 'q1-9-mobile-submenu', width, variant, menu});
    await ctx.close();
  }
  // Q1-9 collateral: desktop submenu template at 1440
  {
    const {ctx, page} = await setup(1440, true);
    await inject(page, css);
    await page.waitForTimeout(800);
    const desk = await page.evaluate(() => {
      const ul = document.querySelector('#top-bar .top-bar > ul > li > ul');
      return ul ? {grid_template_columns: getComputedStyle(ul).gridTemplateColumns, display: getComputedStyle(ul).display} : null;
    });
    rows.push({check: 'q1-9-desktop-submenu', width: 1440, variant, menu: desk});
    await ctx.close();
  }
  // Q1-7: heritage module inside the credit view modal + page-level module (collateral)
  {
    const {ctx, page} = await setup(1440, false);
    await inject(page, css);
    await page.evaluate(() => { window.location.hash = 'u-credit-view'; });
    await page.waitForTimeout(1000);
    const her = await page.evaluate(() => {
      const pick = root => {
        if (!root) return null;
        const label = root.querySelector('.rate-points') || root;
        const bg = getComputedStyle(root).backgroundColor;
        const fg = getComputedStyle(label).color;
        return {module_bg: bg, label_color: fg};
      };
      return {in_modal: pick(document.querySelector('#u-credit-view .heritage-rating-module')),
              page_level: pick([...document.querySelectorAll('.heritage-rating-module')].find(m => !m.closest('#u-credit-view')))};
    });
    const contrast = h => { if (!h) return null; const lf = lum(h.label_color), lb = lum(h.module_bg); return lf === null || lb === null ? null : Math.round(((Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05)) * 100) / 100; };
    rows.push({check: 'q1-7-heritage-modal', width: 1440, variant, modal: her.in_modal, modal_label_contrast: contrast(her.in_modal), page_level: her.page_level});
    await ctx.close();
  }
}
await browser.close();
const get = (check, width, variant) => rows.find(r => r.check === check && r.width === width && r.variant === variant);
const verdict = {
  q1_9_without_reproduced: [390, 320].every(w => get('q1-9-mobile-submenu', w, 'without').menu.distinct_item_x === 2),
  q1_9_with_single_column: [390, 320].every(w => get('q1-9-mobile-submenu', w, 'with').menu.distinct_item_x === 1),
  q1_9_desktop_unchanged: JSON.stringify(get('q1-9-desktop-submenu', 1440, 'without').menu) === JSON.stringify(get('q1-9-desktop-submenu', 1440, 'with').menu),
  q1_7_without_white_box: lum(get('q1-7-heritage-modal', 1440, 'without').modal.module_bg) > 0.8,
  q1_7_with_dark_box: lum(get('q1-7-heritage-modal', 1440, 'with').modal.module_bg) < 0.05,
  q1_7_with_label_readable: get('q1-7-heritage-modal', 1440, 'with').modal_label_contrast >= 4.5,
  q1_7_page_level_unchanged: JSON.stringify(get('q1-7-heritage-modal', 1440, 'without').page_level) === JSON.stringify(get('q1-7-heritage-modal', 1440, 'with').page_level),
};
verdict.pass = Object.values(verdict).every(Boolean);
const receipt = {
  schema: 'theme_lab_jp_correction_delta.v1',
  decision_authority: 'SCP_JP_TARGET_RUNTIME_INDEPENDENT_DELTA_ONLY',
  measured_at: new Date().toISOString(),
  scenario: 'redtape-mobile-submenu-and-heritage-modal',
  origin: 'https://scpaiueouiuiuiui.wikijump.localhost:3410',
  fixture_page: 'run-owned:theme-lab-visual-acceptance-imported-20260924',
  inputs: {
    'ports/redtape/candidate.css': {sha256: sha(fs.readFileSync(T + '/ports/redtape/candidate.css')), bytes: fs.readFileSync(T + '/ports/redtape/candidate.css').length},
    'ports/shared-replay-assets/0f739579cd2a2dc899bdff7d5b0568cdd35696172fe759109adf40afdd22193d.css': {sha256: sha(fs.readFileSync(T + '/ports/shared-replay-assets/0f739579cd2a2dc899bdff7d5b0568cdd35696172fe759109adf40afdd22193d.css'))},
    correction: {sha256: sha(Buffer.from(correction)), bytes: correction.length, role: 'correction'},
  },
  comparison: rows,
  verdict,
  notes: 'Q1-7 pilot-frame caveat: the campaign pilot composition (W02 F5 comparison) shows the redtape modal heritage label in light text on the white box; the fixture composition inherits a dark label color instead. The correction therefore sets both the dark box background and the light on-dark text color from the theme own variables, so the modal heritage state is readable under either cascade balance; the box value is the measured divergence (sigma target: dark pill). Full verification at the W11 recapture.',
};
fs.writeFileSync(args.out, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({out: args.out, verdict}));
