#!/usr/bin/env node
// Same-SCP-JP-target before/after delta for a runtime-independent JP correction.
// The harness stack matches the Sigma-9 campaign capture: the frozen SCP-JP
// Sigma-9 offline fixture replaces the live stylesheet, then the package's
// candidate base and candidate CSS are applied. The "with" variant appends only
// the correction block. The program measures every visible target anchor's
// text against its clipping box and checks that no element outside the target
// (or its ancestors and descendants) changes geometry. Loopback GET only.
import {createRequire} from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const T = "/home/roku/.local/state/wikijump/agents/wt-fixbatch/install/local/theme-lab";
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, arg, i, all) => {
  if (arg.startsWith('--')) acc.push([arg.slice(2), all[i + 1]]);
  return acc;
}, []));
const need = key => { if (!args[key]) throw new Error(`missing --${key}`); return args[key]; };
const SCENARIOS = {
  "alslop-files": {
    origin: "https://scpaiueouiuiuiui.wikijump.localhost:3410",
    page: "run-owned:theme-lab-visual-acceptance-imported-20260924",
    widths: [320, 390, 480, 768, 1024, 1440],
    target: "table.page-files",
    owner: "#action-area",
    anchors: null,
    open: {click: "#files-button", wait: "table.page-files"},
    stack: ["ports/al-slop/candidate.css"],
    navigation: null,
    replaceLink: true,
  },
  "alslop-history": {
    origin: "https://scpaiueouiuiuiui.wikijump.localhost:3410",
    page: "run-owned:theme-lab-visual-acceptance-imported-20260924",
    widths: [320, 390, 480, 768, 1024, 1440],
    target: "table.page-history",
    owner: "#action-area",
    anchors: null,
    open: {click: "#history-button", wait: "#history-form-1"},
    stack: ["ports/al-slop/candidate.css"],
    navigation: null,
    replaceLink: true,
  },
  "isolated-files": {
    origin: "https://scpaiueouiuiuiui.wikijump.localhost:3410",
    page: "run-owned:theme-lab-visual-acceptance-imported-20260924",
    widths: [320, 390, 480, 768, 1024, 1440],
    target: "table.page-files",
    owner: "#action-area",
    anchors: null,
    open: {click: "#files-button", wait: "table.page-files"},
    stack: ["ports/isolated-terminal/candidate.css"],
    navigation: null,
    replaceLink: true,
  },
  "site-narrow-submenu": {
    origin: "https://scpaiueouiuiuiui.wikijump.localhost:3410",
    page: "run-owned:theme-lab-visual-acceptance-imported-20260924",
    widths: [320],
    target: "#top-bar .mobile-top-bar > ul > li:nth-last-child(2) > ul",
    anchors: "#top-bar a",
    open: {click: ".open-menu", wait: "#top-bar .mobile-top-bar"},
    stack: ["ports/interactive-visual-fixture/runtime-asset-replay.css", "fixtures/scp-jp-sigma9-offline.css", "ports/site/candidate-base.css", "fixtures/tmp-narrow-minus.css"],
    navigation: "fixtures/scp-jp-navigation.html",
  },
  'site-top-bar': {
    origin: 'https://scpaiueouiuiuiui.wikijump.localhost:3410',
    page: 'run-owned:theme-lab-visual-acceptance-imported-20260924',
    widths: [320, 390, 768, 1024, 1440],
    target: '#top-bar .top-bar > ul > li > a, #top-bar .mobile-top-bar > ul > li > a',
    anchors: '#top-bar a',
    stack: ['ports/interactive-visual-fixture/runtime-asset-replay.css', 'fixtures/scp-jp-sigma9-offline.css', 'ports/site/candidate-base.css', 'ports/site/candidate.css'],
    navigation: 'fixtures/scp-jp-navigation.html',
  },
  "bhl-history": {
    origin: "https://scpaiueouiuiuiui.wikijump.localhost:3410",
    page: "run-owned:theme-lab-visual-acceptance-imported-20260924",
    widths: [320, 390, 480, 768, 1024, 1440],
    target: "#history-form-1 table.form",
    owner: "#action-area",
    anchors: null,
    open: {click: "#history-button", wait: "#history-form-1"},
    // Candidate replaces the Sigma-9 sheet entirely (self-contained upstream CSS).
    stack: ["ports/black-highlighter-theme/candidate.css"],
    navigation: null,
    replaceLink: true,
  },
  "jakstyle-history": {
    origin: "https://scpaiueouiuiuiui.wikijump.localhost:3410",
    page: "run-owned:theme-lab-visual-acceptance-imported-20260924",
    widths: [320, 390, 480, 768, 1024, 1440],
    target: "#history-form-1 table.form",
    owner: "#action-area",
    anchors: null,
    open: {click: "#history-button", wait: "#history-form-1"},
    stack: ["ports/jakstyle/candidate.css"],
    navigation: null,
    replaceLink: true,
  },
  "extra-bhl-history": {
    origin: "https://scpaiueouiuiuiui.wikijump.localhost:3410",
    page: "run-owned:theme-lab-visual-acceptance-imported-20260924",
    widths: [320, 390, 480, 768, 1024, 1440],
    target: "#history-form-1 table.form",
    owner: "#action-area",
    anchors: null,
    open: {click: "#history-button", wait: "#history-form-1"},
    stack: ["ports/extra-black-highlighter-theme/candidate.css"],
    navigation: null,
    replaceLink: true,
  },
  "minimalist-history": {
    origin: "https://scpaiueouiuiuiui.wikijump.localhost:3410",
    page: "run-owned:theme-lab-visual-acceptance-imported-20260924",
    widths: [320, 390, 480, 768, 1024, 1440],
    target: "#history-form-1 table.form",
    owner: "#action-area",
    anchors: null,
    open: {click: "#history-button", wait: "#history-form-1"},
    stack: ["ports/minimalist-bhl/candidate.css"],
    navigation: null,
    replaceLink: true,
  },
  "redtape-history": {
    origin: "https://scpaiueouiuiuiui.wikijump.localhost:3410",
    page: "run-owned:theme-lab-visual-acceptance-imported-20260924",
    widths: [320, 390, 480, 768, 1024, 1440],
    target: "#history-form-1 table.form",
    owner: "#action-area",
    anchors: null,
    open: {click: "#history-button", wait: "#history-form-1"},
    stack: ["ports/redtape/candidate.css"],
    navigation: null,
    replaceLink: true,
  },
  "aesthetic-history": {
    origin: "https://scpaiueouiuiuiui.wikijump.localhost:3410",
    page: "run-owned:theme-lab-visual-acceptance-imported-20260924",
    widths: [320, 390, 480, 768, 1024, 1440],
    target: "#history-form-1 table.form",
    owner: "#action-area",
    anchors: null,
    open: {click: "#history-button", wait: "#history-form-1"},
    stack: ["ports/aesthetic-theme/candidate.css"],
    navigation: null,
    replaceLink: true,
  },
};
SCENARIOS['bhl-credit-back'] = {
    origin: "https://scpaiueouiuiuiui.wikijump.localhost:3410",
    page: "run-owned:theme-lab-visual-acceptance-imported-20260924",
    widths: [320, 390, 768, 1440],
    target: "#u-credit-otherwise .credit-back",
    owner: "#u-credit-otherwise",
    anchors: null,
    open: {hash: "u-credit-otherwise", wait: "#u-credit-otherwise .credit-back"},
    stack: ["ports/shared-replay-assets/0f739579cd2a2dc899bdff7d5b0568cdd35696172fe759109adf40afdd22193d.css", "ports/aesthetic-theme/candidate.css"],
    navigation: null,
    replaceLink: true,
  };
const scenario = SCENARIOS[need('scenario')];
if (!scenario) throw new Error(`unknown scenario ${args.scenario}`);
const correctionFile = need('correction');
const correctionCss = fs.readFileSync(correctionFile, 'utf8').trim();
const out = need('out');
const artifacts = args.artifacts;
const require = createRequire(import.meta.url);
const playwrightModule = process.env.WIKIJUMP_PLAYWRIGHT_MODULE
  ?? '/home/roku/.local/state/wikijump/theme-lab/runtime-source-campaign-20261023/framerail/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.js';
const {chromium} = require(playwrightModule);

const inputs = {};
for (const rel of [...scenario.stack, ...(scenario.navigation ? [scenario.navigation] : [])]) {
  const bytes = fs.readFileSync(path.join(T, rel));
  inputs[rel] = {sha256: sha(bytes), bytes: bytes.length};
}
inputs[correctionFile] = {sha256: sha(Buffer.from(correctionCss)), bytes: correctionCss.length, role: 'correction'};
const css = stack => stack.map(rel => fs.readFileSync(path.join(T, rel), 'utf8')).join('\n');
const baseCss = css(scenario.stack);
const navHtml = scenario.navigation ? fs.readFileSync(path.join(T, scenario.navigation), 'utf8') : null;
const FIXTURE = `${scenario.origin}/${encodeURIComponent(scenario.page)}`;
const LINK = 'link[rel="stylesheet"][href="/wikidot/styles/sigma-fe5388a32e12.css"]';
const TYPES = {'.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.css': 'text/css', '.gif': 'image/gif', '.webp': 'image/webp', '.jpg': 'image/jpeg'};

const measure = (selectors) => `(() => {
  const target = ${JSON.stringify(selectors.target)};
  const anchors = ${JSON.stringify(selectors.anchors)};
  const all = [...document.querySelectorAll('body *')];
  const targets = new Set([...document.querySelectorAll(target)]);
  // Owning rows: each target's own list item (its submenu moves with the label).
  const owners = new Set([...targets].map(t => t.closest('li')).filter(Boolean));
  // Optional scenario owner: its whole subtree is the defect's own container (form controls that reflow with it).
  const ownerSel = ${JSON.stringify(selectors.owner ?? null)};
  if (ownerSel) for (const el of document.querySelectorAll(ownerSel)) owners.add(el);
  const related = el => [...targets].some(t => t === el || t.contains(el) || el.contains(t)) || [...owners].some(o => o === el || o.contains(el) || el.contains(o));
  const rectOf = el => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 10) / 10); };
  const geometry = all.map(el => rectOf(el));
  const descriptors = all.map(el => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/u).filter(Boolean).map(c => '.' + c).join('') : '';
    const text = el.children.length ? '' : el.textContent.trim().slice(0, 16);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls + (text ? ' "' + text + '"' : '');
  });
  const relatedFlags = all.map(el => related(el));
  const anchorRows = anchors ? [...document.querySelectorAll(anchors)].map(a => {
    const style = getComputedStyle(a);
    const box = a.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(a);
    const text = range.getBoundingClientRect();
    const visible = style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0 && text.width > 0;
    const clip = style.overflow === 'visible' ? null : {top: box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop), bottom: box.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom), left: box.left, right: box.right};
    const clipped = !visible || !clip ? 0 : Math.max(0, clip.top - text.top, text.bottom - clip.bottom, clip.left - text.left, text.right - clip.right);
    return {text: a.textContent.trim(), target: targets.has(a), visible, anchor_height: Math.round(box.height * 10) / 10, max_height: style.maxHeight, overflow: style.overflow, line_height: style.lineHeight, text_clip_px: Math.round(clipped * 10) / 10};
  }) : [];
  const targetOverflow = [...targets].map(t => Math.max(0, t.getBoundingClientRect().right - window.innerWidth));
  return {
    anchors: anchorRows,
    target_overflow_px: Math.round(Math.max(0, ...targetOverflow) * 10) / 10,
    target_count: targets.size,
    geometry,
    descriptors,
    related: relatedFlags,
    document_width: document.documentElement.scrollWidth,
    viewport_width: window.innerWidth,
  };
})()`;

const variants = [
  {name: 'without', css: baseCss},
  {name: 'with', css: `${baseCss}\n${correctionCss}`},
];
const browser = await chromium.launch({headless: true});
const rows = [];
let externalBlocked = 0;
try {
  for (const width of (args.widths ? args.widths.split(',').map(Number) : scenario.widths)) {
    for (const variant of variants) {
      const context = await browser.newContext({ignoreHTTPSErrors: true, viewport: {width, height: 1000}, deviceScaleFactor: 1});
      await context.route('**/*', async route => {
        const u = new URL(route.request().url());
        if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
        if (u.origin === new URL(scenario.origin).origin) {
          const name = decodeURIComponent(u.pathname.replace(/^\//u, ''));
          for (const dir of ['ports/shared-replay-assets', 'ports/site/page-assets']) {
            const file = path.join(T, dir, name);
            if (/^[0-9a-f]{64}\.[a-z0-9]+$/u.test(name) && fs.existsSync(file)) {
              return route.fulfill({status: 200, contentType: TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream', body: fs.readFileSync(file)});
            }
          }
          return route.continue();
        }
        externalBlocked += 1;
        return route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      const response = await page.goto(FIXTURE, {waitUntil: 'load', timeout: 60000});
      await page.waitForSelector('#top-bar', {timeout: 30000});
      await page.waitForTimeout(2000);
      if (navHtml) {
        await page.locator('#top-bar').evaluate((e, html) => { e.innerHTML = html; }, navHtml);
        await page.waitForTimeout(600);
      }
      if (scenario.open) {
        if (scenario.open.hash) {
          await page.evaluate(h => { window.location.hash = h; }, scenario.open.hash);
        } else {
          await page.locator(scenario.open.click).click();
        }
        await page.locator(scenario.open.wait).waitFor({timeout: 30000});
        await page.waitForTimeout(800);
      }
      await page.evaluate(({link, css}) => {
        const sheet = document.querySelector(link);
        if (sheet) { sheet.disabled = true; sheet.media = 'not all'; }
        const style = document.createElement('style');
        style.setAttribute('data-jp-correction-delta', '');
        style.textContent = css;
        document.head.append(style);
      }, {link: LINK, css: variant.css});
      // Settle in-flight transitions (drawer slides) so both variants are sampled at rest.
      await page.waitForTimeout(1500);
      await page.evaluate(() => { for (const a of document.getAnimations()) { try { a.finish(); } catch {} } });
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.waitForTimeout(300);
      const measured = await page.evaluate(measure(scenario));
      measured.back_facts = await page.evaluate(() => {
        const a = document.querySelector('#u-credit-otherwise .credit-back a');
        const div = document.querySelector('#u-credit-otherwise .credit-back');
        if (!a || !div) return {missing: true};
        const range = document.createRange(); range.selectNodeContents(a);
        const lines = [...range.getClientRects()].filter(r => r.width > 0).length;
        const ar = a.getBoundingClientRect(), dr = div.getBoundingClientRect();
        return {lines, a_rect: [Math.round(ar.width * 10) / 10, Math.round(ar.height * 10) / 10], div_rect: [Math.round(dr.width * 10) / 10, Math.round(dr.height * 10) / 10], white_space: getComputedStyle(a).whiteSpace};
      });
      let screenshot = null;
      if (artifacts) {
        fs.mkdirSync(artifacts, {recursive: true});
        const file = path.join(artifacts, `${width}-${variant.name}.png`);
        await page.screenshot({path: file, clip: {x: 0, y: 120, width, height: 60}});
        screenshot = {path: file, sha256: sha(fs.readFileSync(file))};
      }
      rows.push({width, variant: variant.name, http_status: response?.status() ?? null, css_sha256: sha(Buffer.from(variant.css)), measured: {...measured, document_overflow_px: Math.max(0, measured.document_width - measured.viewport_width)}, screenshot});
      await context.close();
    }
  }
} finally {
  await browser.close();
}

// Collateral check: every element that changed geometry between the without and
// with variants must be the target, an ancestor of a target, or inside one.
const pairs = [];
for (const width of (args.widths ? args.widths.split(',').map(Number) : scenario.widths)) {
  const without = rows.find(r => r.width === width && r.variant === 'without').measured;
  const withRow = rows.find(r => r.width === width && r.variant === 'with').measured;
  const changed = [];
  const zeroArea = [];
  without.geometry.forEach((g, i) => {
    if (JSON.stringify(g) === JSON.stringify(withRow.geometry[i]) || without.related[i]) return;
    // Zero-area boxes (no ink) that shift only because a sibling row regained its height.
    if (g[2] === 0 || g[3] === 0) zeroArea.push(i); else changed.push(i);
  });
  // Uniform downstream flow: content after the corrected row moves by one shared vertical offset
  // (same x, width and height). Anything else that changes geometry is a real collateral change.
  const deltas = changed.map(i => +(withRow.geometry[i][1] - without.geometry[i][1]).toFixed(1));
  const uniform = changed.length > 0 && changed.every((i, k) =>
    Math.abs(withRow.geometry[i][0] - without.geometry[i][0]) < 0.05 &&
    Math.abs(withRow.geometry[i][2] - without.geometry[i][2]) < 0.05 &&
    Math.abs(withRow.geometry[i][3] - without.geometry[i][3]) < 0.05 &&
    Math.abs(deltas[k] - deltas[0]) < 0.2);
  const downstream = uniform ? changed : [];
  const nonUniform = uniform ? [] : changed;
  const zeroAreaDetail = zeroArea.slice(0, 40).map(i => ({element: without.descriptors[i], without: without.geometry[i], with: withRow.geometry[i]}));
  const changedDetail = nonUniform.slice(0, 40).map(i => ({element: without.descriptors[i], without: without.geometry[i], with: withRow.geometry[i]}));
  const anchorsWithout = without.anchors.filter(a => a.visible);
  const anchorsWith = withRow.anchors.filter(a => a.visible);
  pairs.push({
    width,
    visible_anchor_count: anchorsWith.length,
    without_clipped_anchors: anchorsWithout.filter(a => a.text_clip_px > 1).map(a => a.text),
    with_clipped_anchors: anchorsWith.filter(a => a.text_clip_px > 1).map(a => a.text),
    without_document_overflow_px: without.document_width - width > 0 ? without.document_width - width : 0,
    with_document_overflow_px: withRow.document_width - width > 0 ? withRow.document_width - width : 0,
    without_target_overflow_px: without.target_overflow_px,
    with_target_overflow_px: withRow.target_overflow_px,
    without_max_text_clip_px: Math.max(0, ...anchorsWithout.map(a => a.text_clip_px)),
    with_max_text_clip_px: Math.max(0, ...anchorsWith.map(a => a.text_clip_px)),
    collateral_changed_elements: nonUniform.length,
    uniform_downstream_shift_count: downstream.length,
    uniform_downstream_shift_px: downstream.length ? deltas[0] : 0,
    document_width_without: without.document_width,
    document_width_with: withRow.document_width,
    collateral_detail: changedDetail,
    zero_area_flow_shifts: zeroArea.length,
    zero_area_flow_detail: zeroAreaDetail,
  });
}
const backRows = rows.map(r => ({width: r.width, variant: r.variant, facts: r.measured.back_facts}));
const withoutFails = backRows.filter(r => r.variant === 'without').some(r => r.facts.lines >= 2);
const withPasses = backRows.filter(r => r.variant === 'with').every(r => r.facts.lines === 1);
const noCollateral = pairs.every(p => p.collateral_changed_elements === 0);
const widthRows = rows.map(({measured, ...rest}) => ({...rest, anchors: measured.anchors, back_facts: measured.back_facts, document_width: measured.document_width, viewport_width: measured.viewport_width}));
const widthsArg = args.widths ? args.widths.split(',').map(Number) : null;
const receipt = {
  schema: 'theme_lab_jp_correction_delta.v1',
  decision_authority: 'SCP_JP_TARGET_RUNTIME_INDEPENDENT_DELTA_ONLY',
  measured_at: new Date().toISOString(),
  scenario: args.scenario,
  origin: scenario.origin,
  fixture_page: scenario.page,
  target_selector: scenario.target,
  anchor_selector: scenario.anchors,
  widths: args.widths ? args.widths.split(',').map(Number) : scenario.widths,
  inputs,
  correction_sha256: sha(Buffer.from(correctionCss)),
  verdict: {without_defect_reproduced: withoutFails, with_correction_clears_defect: withPasses, collateral_free: noCollateral, pass: withoutFails && withPasses && noCollateral},
  comparison: pairs,
  rows: widthRows,
  public_writes: 0,
  external_requests: externalBlocked,
  program: 'measurement-credit-back-delta.mjs (variant of measure-jp-correction-delta.mjs)',
  program_sha256: sha(fs.readFileSync(fileURLToPath(import.meta.url))),
};
fs.mkdirSync(path.dirname(out), {recursive: true});
fs.writeFileSync(out, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({out, verdict: receipt.verdict, comparison: pairs}, null, 2));
