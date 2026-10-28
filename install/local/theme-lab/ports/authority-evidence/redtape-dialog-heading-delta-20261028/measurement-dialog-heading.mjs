// Same-target before/after measurement for the redtape dialog heading
// (defect Q1-8). The fixture page carries no runtime dialog DOM, so the
// probe synthesizes the exact odialog structure the candidate rules target
// (#odialog-container > .owindow > .title + .modal-body > h1/p) and measures
// the heading color against the dialog ground under the redtape candidate,
// with the BHL candidate as the family reference. Loopback GET only.
import {createRequire} from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const {chromium} = require('/home/roku/.local/state/wikijump/theme-lab/runtime-source-campaign-20261023/framerail/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.js');
const T = '/home/roku/.local/state/wikijump/agents/wt-fixbatch/install/local/theme-lab';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a, []));
const correction = fs.readFileSync(args.correction, 'utf8').trim();
const PAGE = 'https://scpaiueouiuiuiui.wikijump.localhost:3410/run-owned%3Atheme-lab-visual-acceptance-imported-20260924';
const lum = rgb => { const m = (rgb.match(/[0-9.]+/g) || []).map(Number); if (m.length < 3) return null; const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
const browser = await chromium.launch();
const rows = [];
for (const [stackName, file] of [['redtape', 'ports/redtape/candidate.css'], ['bhl-reference', 'ports/black-highlighter-theme/candidate.css']]) {
  for (const variant of ['without', 'with']) {
    if (stackName !== 'redtape' && variant === 'with') continue;
    const css = fs.readFileSync(T + '/' + file, 'utf8') + (variant === 'with' ? '\n' + correction : '');
    const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, ignoreHTTPSErrors: true});
    const page = await ctx.newPage();
    await page.goto(PAGE, {waitUntil: 'load', timeout: 60000});
    await page.waitForSelector('#top-bar', {timeout: 30000});
    await page.waitForTimeout(1200);
    const res = await page.evaluate((css) => {
      const link = document.querySelector('link[rel="stylesheet"][href*="theme"]');
      if (link) { link.disabled = true; link.media = 'not all'; }
      const st = document.createElement('style'); st.textContent = css; document.head.append(st);
      const host = document.createElement('div');
      host.innerHTML = '<div id="odialog-container"><div class="owindow error"><div class="title modal-header">エラー</div><div class="modal-body"><h1>権限がありません</h1><p>このページを編集する権限がありません。</p></div></div></div>';
      document.body.append(host);
      const ow = host.querySelector('.owindow');
      const h1 = host.querySelector('.modal-body h1');
      const p = host.querySelector('.modal-body p');
      return {owindow_bg: getComputedStyle(ow).backgroundColor, heading_color: getComputedStyle(h1).color, body_color: getComputedStyle(p).color};
    }, css);
    const lf = lum(res.heading_color), lb = lum(res.owindow_bg);
    rows.push({stack: stackName, variant, ...res, heading_contrast: Math.round(((Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05)) * 100) / 100});
    await ctx.close();
  }
}
await browser.close();
const rt = v => rows.find(r => r.stack === 'redtape' && r.variant === v);
const bh = rows.find(r => r.stack === 'bhl-reference');
const verdict = {
  without_defect_reproduced: rt('without').heading_contrast < 2,
  with_correction_clears_defect: rt('with').heading_contrast >= 4.5,
  bhl_reference_readable: bh.heading_contrast >= 4.5,
  body_text_unchanged: rt('without').body_color === rt('with').body_color,
};
verdict.pass = Object.values(verdict).every(Boolean);
const receipt = {
  schema: 'theme_lab_jp_correction_delta.v1',
  decision_authority: 'SCP_JP_TARGET_RUNTIME_INDEPENDENT_DELTA_ONLY',
  measured_at: new Date().toISOString(),
  scenario: 'redtape-dialog-heading',
  origin: 'https://scpaiueouiuiuiui.wikijump.localhost:3410',
  fixture_page: 'run-owned:theme-lab-visual-acceptance-imported-20260924',
  target_selector: '#odialog-container .owindow .modal-body h1',
  inputs: {
    'ports/redtape/candidate.css': {sha256: sha(fs.readFileSync(T + '/ports/redtape/candidate.css'))},
    correction: {sha256: sha(Buffer.from(correction)), bytes: correction.length, role: 'correction'},
  },
  comparison: rows,
  verdict,
  notes: 'The acceptance fixture page contains no runtime dialog DOM (verified: #odialog-container .owindow absent), so the probe synthesizes the odialog structure exactly as the candidate rules address it (.owindow > .title.modal-header + .modal-body > h1/p). Only computed colors are measured; no layout claim is made.',
};
fs.writeFileSync(args.out, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({out: args.out, verdict, rows}));
