import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {planBrowserAcceptance} from '../src/semantic-browser-acceptance.mjs';
import {validateSemanticSourceAuthority} from '../src/semantic-source-authority.mjs';

test('hidden search alternatives require current source visibility, navigation, viewport and exact retained artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-search-source-'));
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const url = 'https://scp-wiki.wikidot.com/theme:example', sourceHash = 'a'.repeat(64);
  const size = {width: 1440, height: 1000}, html = '<form>source fixture</form>';
  try {
    fs.mkdirSync(path.join(root, 'ports/example'), {recursive: true});
    fs.writeFileSync(path.join(root, 'ports/example/manifest.json'), JSON.stringify({reference_url: url, en_source_sha256: sourceHash}));
    fs.writeFileSync(path.join(root, 'source.html'), html);
    fs.writeFileSync(path.join(root, 'measurement.mjs'), 'source measurement fixture');
    const document = {schema: 'theme_lab_wikidot_search_control.v1', theme: 'example', source_url: url, source_sha256: sourceHash,
      public_writes: 0, external_requests_sent: 0, offline: true, original_html_sha256: sha(html), replay_entry: '/o/' + sha(html),
      artifacts: [{path: 'source.html', sha256: sha(html)}], measurement_programs: [{path: 'measurement.mjs', sha256: sha('source measurement fixture')}],
      source_measurements: [{viewport: 'desktop', viewport_size: size, source_sha256: sourceHash, original_html_sha256: sha(html), loaded: {offline: true},
        after_focus: {display: 'none', value: 'Search this site'}, navigation: '/search:site/q/Search%20this%20site',
        handler: {search: 'native submit', events: [{type: 'submit', fn: 'native submit'}]}}]};
    const audit = {records: [{theme: 'example', viewport: 'desktop', viewport_size: size}]};
    const save = () => {
      const bytes = JSON.stringify(document); fs.writeFileSync(path.join(root, 'receipt.json'), bytes);
      audit.records[0].action_contract_observation = {mode: 'source-hidden-submit', source_authority: {path: 'receipt.json', sha256: sha(bytes)}};
    };
    save(); assert.deepEqual(validateSemanticSourceAuthority(root, audit), []);
    document.source_measurements[0].after_focus.display = 'block'; save(); assert.ok(validateSemanticSourceAuthority(root, audit).length);
    document.source_measurements[0].after_focus.display = 'none';
    document.source_measurements[0].navigation = '/search:site/q/other'; save(); assert.ok(validateSemanticSourceAuthority(root, audit).length);
    document.source_measurements[0].navigation = '/search:site/q/Search%20this%20site';
    document.external_requests_sent = 1; save(); assert.ok(validateSemanticSourceAuthority(root, audit).length);
    document.external_requests_sent = 0; save();
    fs.writeFileSync(path.join(root, 'source.html'), 'changed source'); assert.ok(validateSemanticSourceAuthority(root, audit).length);
  } finally {fs.rmSync(root, {recursive: true, force: true});}
});

test('retained unmodified source captures are reusable; patched or mutating captures are not source oracles', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-source-'));
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const source = 'a'.repeat(64), html = 'b'.repeat(64), image = 'c'.repeat(64);
  const url = 'https://scp-wiki.wikidot.com/theme:example';
  try {
    fs.mkdirSync(path.join(root, 'ports/example'), {recursive: true});
    fs.writeFileSync(path.join(root, 'ports/example/manifest.json'), JSON.stringify({reference_url: url, en_source_sha256: source}));
    const audit = {records: [{theme: 'example', surface: 'page.normal', state: 'settled'}]};
    const question = planBrowserAcceptance(audit).visual_questions[0];
    const receipt = {schema: 'theme_lab_wikidot_adaptation_ab.v1', url, public_writes: 0, external_browser_requests: 0,
      snapshot: {replay_complete: true, entry: '/o/' + html},
      rows: [{variant: 'without', css_sha256: sha(''), dom_sha256: html, screenshot_sha256: image}]};
    const save = () => {
      const bytes = JSON.stringify(receipt); fs.writeFileSync(path.join(root, 'source-capture.json'), bytes);
      audit.semantic_reviews = {[question.id]: {source_url: url, source_snapshot: {sha256: source}, source_html: {sha256: html}, source_rendering: {sha256: image},
        source_rendering_receipt: {path: 'source-capture.json', sha256: sha(bytes)}}};
    };
    save(); assert.deepEqual(validateSemanticSourceAuthority(root, audit), []);
    for (const [key, value] of [['public_writes', 1], ['external_browser_requests', 1]]) {
      receipt[key] = value; save(); assert.ok(validateSemanticSourceAuthority(root, audit).length); receipt[key] = 0;
    }
    receipt.rows[0].css_sha256 = sha('candidate diagnostic CSS'); save(); assert.ok(validateSemanticSourceAuthority(root, audit).length);
    receipt.rows[0].css_sha256 = sha(''); receipt.rows[0].variant = 'with'; save(); assert.ok(validateSemanticSourceAuthority(root, audit).length);
  } finally {fs.rmSync(root, {recursive: true, force: true});}
});
