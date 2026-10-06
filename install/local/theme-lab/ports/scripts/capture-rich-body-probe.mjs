#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {applyPreview, applyStylesheet, launchBrowser, loadChromium, openPage} from '../../src/browser-lab.mjs';
import {createDeepwellPreviewClient} from '../../src/deepwell-preview.mjs';
import {assertDeepwellRuntimeIdentity, readRunningDeepwellRuntimeIdentity} from '../../src/deepwell-runtime-identity.mjs';
import {assertRuntimeSourceSha} from '../../src/runtime-source-identity.mjs';
import {framerailSourceFingerprintSync} from '../../src/framerail-source-fingerprint.mjs';
import {frozenCandidateSetSha256} from '../../src/publication-candidate-freeze.mjs';
import {candidateIdentity} from './candidate-identity.mjs';
import {collectViewportOverflow} from '../../src/browser-lab.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const themeLab = path.resolve(scriptDir, '../..');
const repoRoot = path.resolve(themeLab, '../../..');
const runContractPath = path.join(themeLab, 'ports/current-acceptance/run-contract.json');
const frozenPath = path.join(themeLab, 'publication/frozen-candidate-set.json');
const fixturePath = path.join(themeLab, 'fixtures/theme-rich-body-probe.wikidot.txt');
const imagePath = path.join(themeLab, 'fixtures/theme-rich-body-probe.svg');
const sharedAssets = path.join(themeLab, 'ports/shared-replay-assets');
const outputDir = path.join(themeLab, 'ports/current-acceptance/rich-body-probe-20261006');
const transportOrigin = process.argv.find(arg => arg.startsWith('--transport-origin='))?.slice(19) ?? 'https://scpaiueouiuiuiui.wikijump.localhost:3395';
const transport = new URL(transportOrigin);
if (transport.protocol !== 'https:' || transport.hostname !== 'scpaiueouiuiuiui.wikijump.localhost') throw new Error('rich-body probe transport must be HTTPS on the authorized local authoring hostname');

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const runContract = await readJson(runContractPath);
const frozen = await readJson(frozenPath);
const frozenSetSha = frozenCandidateSetSha256(frozen);
if (frozenSetSha !== frozen.candidate_set_sha256 || frozenSetSha !== runContract.candidate_set_sha256) throw new Error('frozen candidate-set identity changed or differs from Sigma-9 contract');
const runContractSha = sha(await fs.readFile(runContractPath));
const fixtureBytes = await fs.readFile(fixturePath);
const fixtureSource = fixtureBytes.toString('utf8');
const fixtureSha = sha(fixtureBytes);
const imageBytes = await fs.readFile(imagePath);
const imageSha = sha(imageBytes);
const imageDataUrl = `data:image/svg+xml;base64,${imageBytes.toString('base64')}`;

const currentFramerailSha = framerailSourceFingerprintSync(repoRoot);
assertRuntimeSourceSha(runContract.expected_runtime_source_sha256, currentFramerailSha, 'current Framerail source');
const currentBackend = readRunningDeepwellRuntimeIdentity(repoRoot).identity;
assertDeepwellRuntimeIdentity(runContract.expected_backend_runtime_identity, currentBackend, 'current Deepwell backend');
const dockerEnv = execFileSync('docker', ['inspect', 'wikijump-local-development-deepwell-1', '--format', '{{range .Config.Env}}{{println .}}{{end}}'], {encoding: 'utf8'}).split(/\r?\n/u);
const tokenLine = dockerEnv.find(value => value.startsWith('DEEPWELL_RPC_TOKEN='));
if (!tokenLine || tokenLine.length === 'DEEPWELL_RPC_TOKEN='.length) throw new Error('current Deepwell container does not expose its local service token');
const previewClient = createDeepwellPreviewClient({rpcToken: tokenLine.slice('DEEPWELL_RPC_TOKEN='.length)});
const preview = await previewClient.preview({siteId: 6000003, title: 'Theme Lab rich-body supplemental probe', wikitext: fixtureSource});
if (!preview.body.includes('https://example.invalid/theme-lab-rich-body-probe.svg')) throw new Error('current Deepwell output no longer contains the fixture image macro');
const renderedBody = preview.body.replaceAll('https://example.invalid/theme-lab-rich-body-probe.svg', imageDataUrl);

const themes = frozen.nodes.filter(node => node.id.startsWith('theme:'));
if (themes.length !== frozen.inventory.theme_nodes) throw new Error(`frozen theme count mismatch: ${themes.length}`);
const packageFor = node => {
  if (node.publication_source.startsWith('../ports/')) return path.dirname(path.resolve(themeLab, 'publication', node.publication_source));
  const slug = node.id.slice('theme:'.length);
  const directory = slug === 'dear-dictator-jp' ? 'dear-dictator' : slug;
  return path.join(themeLab, 'ports', directory);
};
const assetMime = new Map([['.png','image/png'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.svg','image/svg+xml'],['.webp','image/webp'],['.gif','image/gif'],['.woff','font/woff'],['.woff2','font/woff2'],['.ttf','font/ttf'],['.eot','application/vnd.ms-fontobject'],['.css','text/css']]);
async function materializeCss(css, packageDir, label) {
  const pattern = /url\(\s*["']?(?:\.\/assets\/([^)'"\s]+)|(?:\.\/)?([a-f0-9]{64}\.[a-z0-9]+))["']?\s*\)/gu;
  const matches = [...css.matchAll(pattern)];
  const replacements = new Map();
  const dependencies = [];
  for (const match of matches) {
    const name = match[1] ?? match[2];
    const candidates = match[1]
      ? [path.join(packageDir, 'assets', name), path.join(sharedAssets, name)]
      : [path.join(sharedAssets, name), path.join(packageDir, 'assets', name), path.join(packageDir, name)];
    let file = null;
    for (const candidate of candidates) {
      const stat = await fs.stat(candidate).catch(() => null);
      if (stat?.isFile()) { file = candidate; break; }
    }
    if (!file) throw new Error(`${label} references missing local asset ${name}`);
    const bytes = await fs.readFile(file);
    const type = assetMime.get(path.extname(name).toLowerCase()) ?? 'application/octet-stream';
    replacements.set(name, `url("data:${type};base64,${bytes.toString('base64')}")`);
    dependencies.push({name, path:path.relative(themeLab,file), sha256:sha(bytes), bytes:bytes.length});
  }
  return {css:css.replace(pattern, (whole, legacy, digest) => replacements.get(legacy ?? digest) ?? whole), dependencies};
}
async function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, file);
}
const viewportSpecs = [{id:'320', width:320, height:900}, {id:'390', width:390, height:900}];
const browser = await launchBrowser({chromium: loadChromium()});
let page = null;
try {
  const pageUrl = new URL('/run-owned%3Atheme-lab-visual-acceptance-imported-20260924', transport).href;
  page = await openPage(browser, {url: pageUrl, viewport: {width:320,height:900}, localOnly:true});
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error?.message ?? error)));
  const runtime = page.__themeLabRuntimeIdentity;
  assertRuntimeSourceSha(runContract.expected_runtime_source_sha256, runtime?.header_source_sha256, 'built Framerail navigation response');
  if (!runtime?.backend_runtime_identity) throw new Error('built Framerail navigation response omitted Deepwell identity');
  assertDeepwellRuntimeIdentity(runContract.expected_backend_runtime_identity, runtime.backend_runtime_identity, 'built Framerail navigation response');

  await page.locator('link[rel="stylesheet"][href^="/wikidot/styles/sigma-"]').evaluateAll(links => links.forEach(link => {link.disabled = true; link.media = 'not all';}));
  const baselineCss = await fs.readFile(path.join(themeLab, 'fixtures/scp-jp-sigma9-offline.css'), 'utf8');
  await applyStylesheet(page, baselineCss, 'rich-body-sigma9-baseline');
  const headerHtml = await fs.readFile(path.join(themeLab, 'fixtures/scp-jp-header.html'), 'utf8');
  await page.locator('#header').evaluate((header, html) => {
    const template = document.createElement('template'); template.innerHTML = html;
    for (const tag of ['h1','h2']) header.querySelector(tag).replaceWith(template.content.querySelector(tag).cloneNode(true));
  }, headerHtml);
  const navigationHtml = await fs.readFile(path.join(themeLab, 'fixtures/scp-jp-navigation.html'), 'utf8');
  await page.locator('#top-bar').evaluate((bar, html) => {bar.innerHTML = html;}, navigationHtml);
  const sidebarHtml = await fs.readFile(path.join(themeLab, 'fixtures/scp-jp-sidebar.html'), 'utf8');
  await page.locator('#side-bar').evaluate((sidebar, html) => {sidebar.innerHTML = html;}, sidebarHtml);
  await applyPreview(page, {body: renderedBody, styles: preview.styles, title:'Theme Lab rich-body supplemental probe'});
  const folded = page.locator('#page-content .collapsible-block-folded .collapsible-block-link').first();
  if (await folded.count()) await folded.click();
  await page.waitForTimeout(80);
  const structure = await page.evaluate(() => {
    const content = document.querySelector('#page-content');
    const heads = Object.fromEntries([1,2,3,4,5,6].map(level => [level, content.querySelectorAll(`h${level}`).length]));
    const image = content.querySelector('.scp-image-block img');
    const link = [...content.querySelectorAll('a')].find(anchor => anchor.textContent.length >= 100);
    const table = content.querySelector('table');
    const pre = content.querySelector('pre');
    const footnoteRows = content.querySelectorAll('.footnotes-footer .footnote-footer').length;
    return {
      headings: heads,
      nested_ordered_list_count: content.querySelectorAll('ol ol').length,
      nested_unordered_list_count: content.querySelectorAll('ul ul').length,
      semantic_blockquote_count: content.querySelectorAll('blockquote').length,
      blockquote_class_count: content.querySelectorAll('.blockquote').length,
      table_count: content.querySelectorAll('table').length,
      table_column_count: table?.rows?.[0]?.cells?.length ?? 0,
      code_block_count: content.querySelectorAll('.code, pre').length,
      longest_code_text_characters: Math.max(0, ...[...content.querySelectorAll('.code, pre')].map(node => node.textContent.length)),
      image_block_count: content.querySelectorAll('.scp-image-block').length,
      image_count: content.querySelectorAll('.scp-image-block img').length,
      image_complete: image?.complete ?? false,
      image_natural_width: image?.naturalWidth ?? 0,
      image_caption_text: content.querySelector('.scp-image-caption')?.textContent.trim() ?? '',
      long_link_characters: link?.textContent.length ?? 0,
      long_link_href_characters: link?.href.length ?? 0,
      footnote_reference_count: content.querySelectorAll('.footnoteref').length,
      footnote_block_count: content.querySelectorAll('.footnotes-footer').length,
      footnote_item_count: footnoteRows,
      collapsible_count: content.querySelectorAll('.collapsible-block').length,
      collapsible_expanded: Boolean(content.querySelector('.collapsible-block-unfolded') && getComputedStyle(content.querySelector('.collapsible-block-unfolded')).display !== 'none'),
    };
  });
  const required = structure.headings[1] && structure.headings[2] && structure.headings[3] && structure.headings[4] && structure.headings[5] && structure.headings[6] && structure.nested_ordered_list_count > 0 && structure.nested_unordered_list_count > 0 && structure.semantic_blockquote_count > 0 && structure.blockquote_class_count > 0 && structure.table_column_count >= 5 && structure.code_block_count > 0 && structure.longest_code_text_characters > 200 && structure.image_block_count === 1 && structure.image_count === 1 && structure.image_complete && structure.image_natural_width === 300 && structure.image_caption_text.length > 0 && structure.long_link_characters >= 100 && structure.footnote_reference_count >= 2 && structure.footnote_block_count === 1 && structure.footnote_item_count >= 2 && structure.collapsible_count === 1 && structure.collapsible_expanded;
  if (!required) throw new Error(`rendered rich-body structure assertion failed: ${JSON.stringify(structure)}`);
  const baselineOverflow = await collectViewportOverflow(page, viewportSpecs);
  const baselineStructure = structure;
  const results = [];
  await fs.mkdir(path.join(outputDir, 'screenshots'), {recursive:true});
  const firstReceipt = {
    schema:'theme_lab_rich_body_supplemental_probe.v1',
    status:'capturing',
    generated_at:new Date().toISOString(),
    decision_authority:'SUPPLEMENTAL_CURRENT_CANDIDATE_VISUAL_REVIEW_ONLY',
    port_conclusion_eligible:false,
    candidate_set_sha256:frozenSetSha,
    frozen_candidate_set_sha256:sha(await fs.readFile(frozenPath)),
    sigma9_run_contract_sha256:runContractSha,
    target:{site_id:6000003, logical_origin:runContract.target_site.origin, transport_origin:transport.origin, fixture_page_path:'/run-owned%3Atheme-lab-visual-acceptance-imported-20260924'},
    runtime:{framerail_source_sha256:runtime.header_source_sha256, backend_runtime_identity:runtime.backend_runtime_identity, browser_engine:'chromium', browser_version:browser.version()},
    fixture:{path:path.relative(themeLab,fixturePath), source_sha256:fixtureSha, bytes:fixtureBytes.length, rendered_body_sha256:sha(Buffer.from(preview.body)), rendered_body_bytes:Buffer.byteLength(preview.body), image_asset_path:path.relative(themeLab,imagePath), image_asset_sha256:imageSha, feature_assertions:structure, baseline_overflow:baselineOverflow},
    baselines:{sigma9_offline_css_sha256:sha(Buffer.from(baselineCss)), header_fixture_sha256:sha(await fs.readFile(path.join(themeLab,'fixtures/scp-jp-header.html')),), navigation_fixture_sha256:sha(await fs.readFile(path.join(themeLab,'fixtures/scp-jp-navigation.html'))), sidebar_fixture_sha256:sha(await fs.readFile(path.join(themeLab,'fixtures/scp-jp-sidebar.html')))},
    candidate_count:themes.length,
    captures:results,
  };
  const receiptPath = path.join(outputDir, 'receipt.json');
  for (const node of themes) {
    const slug = node.id.slice('theme:'.length);
    const packageDir = packageFor(node);
    const sourcePath = path.resolve(themeLab, 'publication', node.publication_source);
    const sourceBytes = await fs.readFile(sourcePath);
    if (sha(sourceBytes) !== node.source_sha256) throw new Error(`${slug}: publication source no longer matches frozen candidate-set SHA`);
    const cssPath = path.join(packageDir,'candidate.css');
    const cssBytes = await fs.readFile(cssPath);
    const basePath = path.join(packageDir,'candidate-base.css');
    const baseBytes = await fs.readFile(basePath).catch(error => error.code === 'ENOENT' ? Buffer.alloc(0) : Promise.reject(error));
    const cssText = cssBytes.toString('utf8');
    const baseText = baseBytes.toString('utf8');
    const identity = candidateIdentity(cssBytes,baseBytes,new Set(node.candidate_css_sha256 ? [node.candidate_css_sha256] : []));
    if (node.candidate_css_sha256 && ![identity.rawSha,identity.combinedSha].includes(node.candidate_css_sha256)) throw new Error(`${slug}: candidate CSS/base identity differs from frozen candidate set`);
    const materializedBase = await materializeCss(baseText,packageDir,`${slug} candidate base CSS`);
    const materializedCss = await materializeCss(cssText,packageDir,`${slug} candidate CSS`);
    await applyStylesheet(page, `${materializedBase.css}\n${materializedCss.css}`, 'rich-body-theme-candidate');
    const dependencies = [...materializedBase.dependencies,...materializedCss.dependencies]
      .filter((item,index,items) => items.findIndex(other => other.path === item.path) === index)
      .sort((left,right) => left.path.localeCompare(right.path));
    const row = {
      theme:slug,
      source_sha256:node.source_sha256,
      candidate_source_path:path.relative(themeLab,sourcePath),
      candidate_css_identity_sha256:node.candidate_css_sha256 ?? identity.rawSha,
      candidate_css_raw_sha256:identity.rawSha,
      candidate_css_base_sha256:identity.baseSha,
      candidate_css_combined_sha256:identity.combinedSha,
      candidate_css_path:path.relative(themeLab,cssPath),
      candidate_base_css_path:baseBytes.length ? path.relative(themeLab,basePath) : null,
      candidate_asset_dependencies_sha256:sha(Buffer.from(JSON.stringify(dependencies))),
      candidate_asset_dependencies:dependencies,
      viewports:[],
    };
    for (const viewport of viewportSpecs) {
      const overflow = await collectViewportOverflow(page,[viewport]);
      const metrics = await page.evaluate(() => {
        const content = document.querySelector('#page-content');
        const root = document.documentElement;
        const longLink = [...content.querySelectorAll('a')].find(anchor => anchor.textContent.length >= 100);
        const image = content.querySelector('.scp-image-block img');
        const table = content.querySelector('table');
        const pre = content.querySelector('pre');
        const linkRect = longLink?.getBoundingClientRect();
        const imageRect = image?.getBoundingClientRect();
        const tableRect = table?.getBoundingClientRect();
        const preRect = pre?.getBoundingClientRect();
        return {
          viewport_width:root.clientWidth,
          document_width:root.scrollWidth,
          document_overflow_px:Math.max(0,root.scrollWidth-root.clientWidth),
          content_client_width:content.clientWidth,
          content_scroll_width:content.scrollWidth,
          long_link:{display:longLink?getComputedStyle(longLink).display:null,overflow_wrap:longLink?getComputedStyle(longLink).overflowWrap:null,width:linkRect?.width??null,right:linkRect?.right??null},
          image:{natural_width:image?.naturalWidth??0,width:imageRect?.width??null,right:imageRect?.right??null},
          table:{columns:table?.rows?.[0]?.cells?.length??0,width:tableRect?.width??null,right:tableRect?.right??null},
          code:{text_characters:pre?.textContent.length??0,width:preRect?.width??null,scroll_width:pre?.scrollWidth??null,client_width:pre?.clientWidth??null,overflow_x:pre?getComputedStyle(pre).overflowX:null},
        };
      });
      const bytes = await page.screenshot({fullPage:true,animations:'disabled'});
      const screenshotSha = sha(bytes);
      const screenshotName = `${slug}-chromium-${viewport.id}-${screenshotSha}.png`;
      const screenshotPath = path.join(outputDir,'screenshots',screenshotName);
      await fs.writeFile(screenshotPath,bytes);
      const pngWidth = bytes.readUInt32BE(16), pngHeight = bytes.readUInt32BE(20);
      row.viewports.push({id:viewport.id,width:viewport.width,height:viewport.height,overflow:overflow[viewport.id],metrics,screenshot:{path:path.relative(themeLab,screenshotPath),sha256:screenshotSha,bytes:bytes.length,png_width:pngWidth,png_height:pngHeight}});
    }
    results.push(row);
    firstReceipt.captures = results;
    firstReceipt.candidate_count_captured = results.length;
    firstReceipt.status = 'capturing';
    await atomicJson(receiptPath,firstReceipt);
    console.log(JSON.stringify({theme:slug,captured:results.length,viewport_images:row.viewports.length,source_sha256:row.source_sha256,candidate_css_raw_sha256:row.candidate_css_raw_sha256,overflow_320:row.viewports[0].metrics.document_overflow_px,overflow_390:row.viewports[1].metrics.document_overflow_px}));
  }
  firstReceipt.status = 'captured-review-pending';
  firstReceipt.completed_at = new Date().toISOString();
  firstReceipt.external_requests_sent = 0;
  firstReceipt.external_requests_blocked = page.__themeLabNetwork?.blocked_external_attempts ?? null;
  firstReceipt.page_errors = pageErrors;
  if (pageErrors.length) throw new Error(`rich-body browser page errors: ${JSON.stringify(pageErrors)}`);
  firstReceipt.receipt_sha256 = sha(Buffer.from(JSON.stringify(firstReceipt)));
  delete firstReceipt.receipt_sha256;
  firstReceipt.receipt_sha256 = sha(Buffer.from(JSON.stringify(firstReceipt)));
  await atomicJson(receiptPath,firstReceipt);
  console.log(JSON.stringify({schema:firstReceipt.schema,status:firstReceipt.status,candidate_set_sha256:frozenSetSha,run_contract_sha256:runContractSha,framerail_source_sha256:runtime.header_source_sha256,backend_runtime_identity_sha256:runtime.backend_runtime_identity.identity_sha256,themes:results.length,screenshots:results.reduce((sum,item)=>sum+item.viewports.length,0),receipt:receiptPath,receipt_sha256:firstReceipt.receipt_sha256}));
} finally {
  if (page && !page.isClosed()) await page.__themeLabContext.close().catch(()=>{});
  await browser.close().catch(()=>{});
}
