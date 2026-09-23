#!/usr/bin/env node
// Measure CSS edit -> actionable, local Theme Lab verdicts after each foreign
// reference has been opened once. All checks stay on persistent browser daemons.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../../');
const ports = path.join(root, 'install/local/theme-lab/ports');
const lab = path.join(root, 'install/local/theme-lab/scripts/theme-lab.mjs');
const manifest = JSON.parse(fs.readFileSync(path.join(ports, 'en-theme-campaign.json'), 'utf8'));
const socket = process.env.THEME_LAB_SOCKET ?? '/tmp/theme-lab-en34.sock';
const siteId = process.env.THEME_LAB_SITE_ID ?? '6000003';
const cases = process.argv.includes('--only')
  ? manifest.themes.filter((row) => row.slug === process.argv[process.argv.indexOf('--only') + 1])
  : manifest.themes;
if (!cases.length) throw new Error('no matching theme cases');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-lab-iteration-bench-'));
const measurements = [];

function run(theme, ordinal, measured, includeWikitext) {
  const name = theme.slug.split(':', 1)[0] === 'theme' ? theme.slug.slice(6) : theme.slug;
  const dir = path.join(root, theme.port_package_path);
  const css = fs.readFileSync(path.join(dir, 'candidate.css'), 'utf8');
  const cssPath = path.join(tmp, `${name}-${ordinal}.css`);
  fs.writeFileSync(cssPath, `${css}\n/* warm edit benchmark ${ordinal} */\n`);
  const args = [lab, 'check', '--socket', socket, '--site-id', siteId,
    '--css', cssPath,
    '--reference', `https://scp-wiki.wikidot.com/${theme.slug}`, '--offline',
    '--selectors', fs.existsSync(path.join(dir, 'acceptance-selectors.txt'))
      ? path.join(dir, 'acceptance-selectors.txt') : path.join(ports, 'shared-acceptance-selectors.txt'),
    '--title', theme.slug, '--compact', '--iteration'];
  if (includeWikitext) args.push('--wikitext', path.join(dir, 'candidate.wikidot.txt'));
  const pageAssets = path.join(dir, 'page-assets.json');
  if (includeWikitext && fs.existsSync(pageAssets)) args.push('--page-assets', pageAssets);
  const result = spawnSync(process.execPath, args, {cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024});
  if (result.status !== 0) throw new Error(`${theme.slug} check failed: ${result.stderr || result.stdout}`);
  const output = JSON.parse(result.stdout).result;
  if (!output || output.verification_scope?.mode !== 'iteration') throw new Error(`${theme.slug} did not return iteration scope`);
  if (output.next_actions?.length || output.verdict === 'fail') throw new Error(`${theme.slug} has unresolved actionable findings: ${JSON.stringify(output.next_actions)}`);
  if ((output.assets?.external_requests ?? 0) !== 0) throw new Error(`${theme.slug} made external requests`);
  if (measured) measurements.push({slug: theme.slug, timing_ms: output.timing_ms, verdict: output.verdict, actions: output.next_actions.length, external_requests: output.assets?.external_requests ?? 0});
}

for (const theme of cases) {
  run(theme, 'warmup', false, true); // load reference and install the preview DOM once
  for (let i = 1; i <= 3; i += 1) run(theme, i, true, false);
}
const values = measurements.map((row) => row.timing_ms.total);
values.sort((a, b) => a - b);
const median = (items) => items.length % 2 ? items[(items.length - 1) / 2] : (items[items.length / 2 - 1] + items[items.length / 2]) / 2;
const stages = {};
for (const key of ['preview_ms', 'css_ms', 'reference_ms']) {
  const values = measurements.map((row) => row.timing_ms[key]).filter(Number.isFinite);
  stages[key] = values.length ? Math.round(median(values) * 10) / 10 : null;
}
const output = {
  mode: 'CSS file changed per run; warm preview DOM and offline local reference reused; persistent Theme Lab daemon; iteration verdict defers viewport/torture/widget-interaction/visual acceptance',
  cases: cases.length,
  warmups_per_case: 1,
  measured_edits_per_case: 3,
  measurements: measurements.length,
  warm_edit_verdict_median_ms: Math.round(median(values) * 10) / 10,
  warm_edit_verdict_max_ms: Math.round(Math.max(...values) * 10) / 10,
  stage_median_ms: stages,
  failures: 0,
  external_requests: measurements.reduce((sum, row) => sum + row.external_requests, 0),
  next_actions: measurements.reduce((sum, row) => sum + row.actions, 0),
  per_theme_median_ms: Object.fromEntries(cases.map((theme) => {
    const own = measurements.filter((row) => row.slug === theme.slug).map((row) => row.timing_ms.total).sort((a, b) => a - b);
    return [theme.slug, Math.round(median(own) * 10) / 10];
  })),
};
fs.writeFileSync(path.join(ports, 'warm-edit-verdict-benchmark.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
fs.rmSync(tmp, {recursive: true, force: true});
