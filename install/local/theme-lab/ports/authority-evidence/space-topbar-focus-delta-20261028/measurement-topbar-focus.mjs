// Same-target before/after measurement for the space top-bar focus behavior
// (defect S10B-3). The Sigma-9 fixture page carries the candidate stack; the
// "with" variant appends only the correction block. For each variant the
// script keyboard-focuses a top-bar parent link and records whether its
// submenu opens, then mouse-hovers the same item and records that the hover
// opening still works. Loopback GET only.
import {createRequire} from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const {chromium} = require('/home/roku/.local/state/wikijump/theme-lab/runtime-source-campaign-20261023/framerail/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.js');
const T = '/home/roku/.local/state/wikijump/agents/wt-fixbatch/install/local/theme-lab';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a, []));
const candidate = fs.readFileSync(T + '/ports/space/candidate.css', 'utf8');
const correction = fs.readFileSync(args.correction, 'utf8').trim();
const PAGE = 'https://scpaiueouiuiuiui.wikijump.localhost:3410/run-owned%3Atheme-lab-visual-acceptance-imported-20260924';
const browser = await chromium.launch();
const rows = [];
for (const width of [1440, 1024]) {
  for (const variant of ['without', 'with']) {
    const ctx = await browser.newContext({viewport: {width, height: 900}, ignoreHTTPSErrors: true});
    const page = await ctx.newPage();
    await page.goto(PAGE, {waitUntil: 'load', timeout: 60000});
    await page.waitForSelector('#top-bar', {timeout: 30000});
    await page.waitForTimeout(1500);
    await page.evaluate((css) => {
      const link = document.querySelector('link[rel="stylesheet"][href*="theme"]');
      if (link) { link.disabled = true; link.media = 'not all'; }
      const st = document.createElement('style'); st.textContent = css; document.head.append(st);
    }, variant === 'with' ? candidate + '\n' + correction : candidate);
    await page.waitForTimeout(1000);
    const focusState = await page.evaluate(() => {
      const li = [...document.querySelectorAll('#top-bar .top-bar > ul > li')].find(x => x.querySelector(':scope > ul'));
      const a = li.querySelector(':scope > a');
      const ul = li.querySelector(':scope > ul');
      a.focus();
      const cs = getComputedStyle(ul);
      return {link_text: a.textContent.trim(), opacity: cs.opacity, pointer_events: cs.pointerEvents};
    });
    const li = page.locator('#top-bar .top-bar > ul > li:has(> ul)').first();
    await li.hover();
    await page.waitForTimeout(600);
    const hoverState = await page.evaluate(() => {
      const li = [...document.querySelectorAll('#top-bar .top-bar > ul > li')].find(x => x.querySelector(':scope > ul'));
      const cs = getComputedStyle(li.querySelector(':scope > ul'));
      return {opacity: cs.opacity, pointer_events: cs.pointerEvents};
    });
    rows.push({width, variant, focus: focusState, hover: hoverState});
    await ctx.close();
  }
}
await browser.close();
const pairs = [1440, 1024].map(width => {
  const w = rows.find(r => r.width === width && r.variant === 'without');
  const c = rows.find(r => r.width === width && r.variant === 'with');
  return {width, without_focus: w.focus, with_focus: c.focus, without_hover: w.hover, with_hover: c.hover};
});
const verdict = {
  without_defect_reproduced: pairs.every(p => p.without_focus.opacity === '1' && p.without_focus.pointer_events === 'auto'),
  with_correction_clears_defect: pairs.every(p => p.with_focus.opacity === '0' && p.with_focus.pointer_events === 'none'),
  hover_opening_preserved: pairs.every(p => p.with_hover.opacity === '1' && p.with_hover.pointer_events === 'auto'),
};
verdict.pass = verdict.without_defect_reproduced && verdict.with_correction_clears_defect && verdict.hover_opening_preserved;
const receipt = {
  schema: 'theme_lab_jp_correction_delta.v1',
  decision_authority: 'SCP_JP_TARGET_RUNTIME_INDEPENDENT_DELTA_ONLY',
  measured_at: new Date().toISOString(),
  scenario: 'space-topbar-focus',
  origin: 'https://scpaiueouiuiuiui.wikijump.localhost:3410',
  fixture_page: 'run-owned:theme-lab-visual-acceptance-imported-20260924',
  target_selector: '#top-bar .top-bar > ul > li > ul',
  inputs: {
    'ports/space/candidate.css': {sha256: sha(Buffer.from(candidate)), bytes: candidate.length},
    correction: {sha256: sha(Buffer.from(correction)), bytes: correction.length, role: 'correction'},
  },
  comparison: pairs,
  verdict,
};
fs.writeFileSync(args.out, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({out: args.out, verdict}));
