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
SCENARIOS['turbo-headings'] = {
    origin: "https://scpaiueouiuiuiui.wikijump.localhost:3410",
    page: "run-owned:theme-lab-visual-acceptance-imported-20260924",
    widths: [320, 390, 768, 1024, 1440],
    target: "#page-title, #main-content h1, #main-content h2",
    owner: "#main-content",
    anchors: null,
    open: null,
    stack: ["ports/turbo-vision/candidate.css"],
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
  const headingHeads = [...document.querySelectorAll('h1, h2, h3, #page-title')];
  const headingFlags = all.map(el => headingHeads.some(h => h === el || h.contains(el) || el.contains(h)));
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
    related: relatedFlags, heading_flags: headingFlags,
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
        await page.locator(scenario.open.click).click();
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
      measured.heading_facts = await page.evaluate(() => {
        const probe = el => {
          const cs = getComputedStyle(el);
          const range = document.createRange(); range.selectNodeContents(el);
          const tops = [...new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.y * 10) / 10))].sort((a, b) => a - b);
          const pitches = [];
          for (let i = 1; i < tops.length; i++) pitches.push(Math.round((tops[i] - tops[i - 1]) * 10) / 10);
          const ghost = document.createElement(el.tagName);
          ghost.textContent = 'Agjp';
          ghost.style.cssText = 'position:absolute;visibility:hidden;font-family:' + cs.fontFamily + ';font-size:' + cs.fontSize + ';font-weight:' + cs.fontWeight + ';line-height:normal;';
          document.body.append(ghost);
          const natural = Math.round(ghost.getBoundingClientRect().height * 10) / 10;
          ghost.remove();
          const pitch = pitches.length ? Math.min(...pitches) : null;
          return {tag: el.tagName.toLowerCase(), id: el.id || null, text: el.textContent.trim().slice(0, 30), font_size: cs.fontSize, line_height: cs.lineHeight, natural_line_px: natural, lines: tops.length, min_pitch_px: pitch, overlap_px: tops.length > 1 && pitch !== null ? Math.round(Math.max(0, natural - pitch) * 10) / 10 : 0};
        };
        return [...document.querySelectorAll('#page-title, #main-content h1, #main-content h2')].map(probe);
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
  const headingFlow = [];
  without.geometry.forEach((g, i) => {
    if (JSON.stringify(g) === JSON.stringify(withRow.geometry[i]) || without.related[i]) return;
    // Growth inside the corrected heading family itself (same x and width: a
    // wrapped heading line box getting taller) is the correction acting on its
    // own selector family, not collateral; it is disclosed as heading_flow.
    if (without.heading_flags[i] && Math.abs(g[0] - withRow.geometry[i][0]) < 0.05 && Math.abs(g[2] - withRow.geometry[i][2]) < 0.05) { headingFlow.push(i); return; }
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
  const headingFlowDetail = headingFlow.slice(0, 40).map(i => ({element: without.descriptors[i], without: without.geometry[i], with: withRow.geometry[i]}));
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
    heading_family_growth_count: headingFlow.length,
    heading_family_growth_detail: headingFlowDetail,
  });
}
const headingRows = rows.map(r => ({width: r.width, variant: r.variant, facts: r.measured.heading_facts}));
const mobileOverlap = (row) => row.facts.some(f => f.overlap_px > 1);
const withoutFails = headingRows.filter(r => r.variant === 'without' && r.width <= 768).some(mobileOverlap);
const withPasses = headingRows.filter(r => r.variant === 'with' && r.width <= 768).every(r => !mobileOverlap(r))
  && headingRows.filter(r => r.width > 768).every(r => {
    const w = headingRows.find(x => x.width === r.width && x.variant === 'with');
    const wo = headingRows.find(x => x.width === r.width && x.variant === 'without');
    return JSON.stringify(w.facts) === JSON.stringify(wo.facts);
  });
const noCollateral = pairs.every(p => p.collateral_changed_elements === 0);
const widthRows = rows.map(({measured, ...rest}) => ({...rest, anchors: measured.anchors, heading_facts: measured.heading_facts, document_width: measured.document_width, viewport_width: measured.viewport_width}));
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
  program: 'measurement-heading-delta.mjs (variant of measure-jp-correction-delta.mjs)',
  program_sha256: sha(fs.readFileSync(fileURLToPath(import.meta.url))),
};
fs.mkdirSync(path.dirname(out), {recursive: true});
fs.writeFileSync(out, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({out, verdict: receipt.verdict, comparison: pairs}, null, 2));
