#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {applyPreview, applyStylesheet, collectViewportOverflow, launchBrowser, loadChromium, openPage} from '../../src/browser-lab.mjs';
import {createDeepwellPreviewClient} from '../../src/deepwell-preview.mjs';
import {assertDeepwellRuntimeIdentity, readRunningDeepwellRuntimeIdentity} from '../../src/deepwell-runtime-identity.mjs';
import {assertRuntimeSourceSha} from '../../src/runtime-source-identity.mjs';
import {framerailSourceFingerprintSync} from '../../src/framerail-source-fingerprint.mjs';
import {frozenCandidateSetSha256} from '../../src/publication-candidate-freeze.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const themeLab = path.resolve(scriptDir, '../..');
const repoRoot = path.resolve(themeLab, '../../..');
const outputDir = path.join(themeLab, 'ports/current-acceptance/rich-body-probe-20261006');
const contractPath = path.join(themeLab, 'ports/current-acceptance/run-contract.json');
const frozenPath = path.join(themeLab, 'publication/frozen-candidate-set.json');
const fixturePath = path.join(themeLab, 'fixtures/theme-rich-body-probe.wikidot.txt');
const imagePath = path.join(themeLab, 'fixtures/theme-rich-body-probe.svg');
const transportOrigin = process.argv.find(arg => arg.startsWith('--transport-origin='))?.slice(19) ?? 'https://scpaiueouiuiuiui.wikijump.localhost:3395';
const transport = new URL(transportOrigin);
if (transport.protocol !== 'https:' || transport.hostname !== 'scpaiueouiuiuiui.wikijump.localhost') throw new Error('rich-body baseline transport must be HTTPS on the authorized local authoring hostname');

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const contractBytes = await fs.readFile(contractPath);
const contract = JSON.parse(contractBytes);
const frozen = await readJson(frozenPath);
const candidateSetSha = frozenCandidateSetSha256(frozen);
if (candidateSetSha !== frozen.candidate_set_sha256 || candidateSetSha !== contract.candidate_set_sha256) throw new Error('frozen candidate-set identity changed or differs from Sigma-9 contract');
const currentFramerail = framerailSourceFingerprintSync(repoRoot);
assertRuntimeSourceSha(contract.expected_runtime_source_sha256, currentFramerail, 'current Framerail source');
const currentBackend = readRunningDeepwellRuntimeIdentity(repoRoot).identity;
assertDeepwellRuntimeIdentity(contract.expected_backend_runtime_identity, currentBackend, 'current Deepwell backend');

const dockerEnv = execFileSync('docker', ['inspect', 'wikijump-local-development-deepwell-1', '--format', '{{range .Config.Env}}{{println .}}{{end}}'], {encoding: 'utf8'}).split(/\r?\n/u);
const tokenLine = dockerEnv.find(value => value.startsWith('DEEPWELL_RPC_TOKEN='));
if (!tokenLine || tokenLine.length === 'DEEPWELL_RPC_TOKEN='.length) throw new Error('current Deepwell container does not expose its local service token');
const fixtureBytes = await fs.readFile(fixturePath);
const imageBytes = await fs.readFile(imagePath);
const preview = await createDeepwellPreviewClient({rpcToken: tokenLine.slice('DEEPWELL_RPC_TOKEN='.length)}).preview({siteId: 6000003, title: 'Theme Lab rich-body supplemental probe', wikitext: fixtureBytes.toString('utf8')});
if (!preview.body.includes('https://example.invalid/theme-lab-rich-body-probe.svg')) throw new Error('current Deepwell output no longer contains the fixture image macro');
const body = preview.body.replaceAll('https://example.invalid/theme-lab-rich-body-probe.svg', `data:image/svg+xml;base64,${imageBytes.toString('base64')}`);
const baselineCss = await fs.readFile(path.join(themeLab, 'fixtures/scp-jp-sigma9-offline.css'), 'utf8');
const headerHtml = await fs.readFile(path.join(themeLab, 'fixtures/scp-jp-header.html'), 'utf8');
const navigationHtml = await fs.readFile(path.join(themeLab, 'fixtures/scp-jp-navigation.html'), 'utf8');
const sidebarHtml = await fs.readFile(path.join(themeLab, 'fixtures/scp-jp-sidebar.html'), 'utf8');
const viewports = [{id: '320', width: 320, height: 900}, {id: '390', width: 390, height: 900}];
const browser = await launchBrowser({chromium: loadChromium()});
try {
  const page = await openPage(browser, {url: new URL('/run-owned%3Atheme-lab-visual-acceptance-imported-20260924', transport).href, viewport: {width: 320, height: 900}, localOnly: true});
  const runtime = page.__themeLabRuntimeIdentity;
  assertRuntimeSourceSha(contract.expected_runtime_source_sha256, runtime?.header_source_sha256, 'built Framerail navigation response');
  if (!runtime?.backend_runtime_identity) throw new Error('built Framerail navigation response omitted Deepwell identity');
  assertDeepwellRuntimeIdentity(contract.expected_backend_runtime_identity, runtime.backend_runtime_identity, 'built Framerail navigation response');
  await page.locator('link[rel="stylesheet"][href^="/wikidot/styles/sigma-"]').evaluateAll(links => links.forEach(link => {link.disabled = true; link.media = 'not all';}));
  await applyStylesheet(page, baselineCss, 'rich-body-sigma9-baseline');
  await page.locator('#header').evaluate((header, html) => {
    const template = document.createElement('template'); template.innerHTML = html;
    for (const tag of ['h1', 'h2']) header.querySelector(tag).replaceWith(template.content.querySelector(tag).cloneNode(true));
  }, headerHtml);
  await page.locator('#top-bar').evaluate((bar, html) => {bar.innerHTML = html;}, navigationHtml);
  await page.locator('#side-bar').evaluate((bar, html) => {bar.innerHTML = html;}, sidebarHtml);
  await applyPreview(page, {body, styles: preview.styles, title: 'Theme Lab rich-body supplemental probe'});
  const folded = page.locator('#page-content .collapsible-block-folded .collapsible-block-link').first();
  if (await folded.count()) await folded.click();
  await page.waitForTimeout(80);
  const captures = [];
  await fs.mkdir(path.join(outputDir, 'screenshots'), {recursive: true});
  for (const viewport of viewports) {
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    const overflow = await collectViewportOverflow(page, [viewport]);
    const bytes = await page.screenshot({fullPage: true, animations: 'disabled'});
    const screenshotSha = sha(bytes);
    const screenshotPath = path.join(outputDir, 'screenshots', `sigma9-baseline-chromium-${viewport.id}-${screenshotSha}.png`);
    await fs.writeFile(screenshotPath, bytes);
    captures.push({viewport: viewport.id, width: viewport.width, height: viewport.height, overflow: overflow[viewport.id], screenshot: {path: path.relative(themeLab, screenshotPath), sha256: screenshotSha, bytes: bytes.length, png_width: bytes.readUInt32BE(16), png_height: bytes.readUInt32BE(20)}});
  }
  const receipt = {
    schema: 'theme_lab_rich_body_baseline_capture.v1',
    generated_at: new Date().toISOString(),
    decision_authority: 'SUPPLEMENTAL_CURRENT_CANDIDATE_VISUAL_REVIEW_ONLY',
    port_conclusion_eligible: false,
    candidate_set_sha256: candidateSetSha,
    sigma9_run_contract_sha256: sha(contractBytes),
    target: {site_id: 6000003, logical_origin: contract.target_site.origin, transport_origin: transport.origin, fixture_page_path: '/run-owned%3Atheme-lab-visual-acceptance-imported-20260924', styles: 'SCP-JP Sigma-9 retained; theme candidate CSS omitted'},
    runtime: {framerail_source_sha256: runtime.header_source_sha256, backend_runtime_identity: runtime.backend_runtime_identity, browser_engine: 'chromium', browser_version: browser.version()},
    fixture: {path: path.relative(themeLab, fixturePath), source_sha256: sha(fixtureBytes), image_asset_path: path.relative(themeLab, imagePath), image_asset_sha256: sha(imageBytes), rendered_body_sha256: sha(Buffer.from(preview.body)), sigma9_offline_css_sha256: sha(Buffer.from(baselineCss))},
    captures,
  };
  const receiptPath = path.join(outputDir, 'baseline-receipt.json');
  receipt.receipt_sha256 = sha(Buffer.from(JSON.stringify(receipt)));
  await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({schema: receipt.schema, status: 'captured', candidate_set_sha256: candidateSetSha, sigma9_run_contract_sha256: receipt.sigma9_run_contract_sha256, framerail_source_sha256: runtime.header_source_sha256, backend_runtime_identity_sha256: runtime.backend_runtime_identity.identity_sha256, captures: captures.map(row => ({viewport: row.viewport, document_overflow_px: row.overflow.document_overflow_px, screenshot_sha256: row.screenshot.sha256})), receipt: receiptPath, receipt_sha256: receipt.receipt_sha256}));
} finally {
  await browser.close();
}
