import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {candidateIdentity} from '../ports/scripts/candidate-identity.mjs';

const themeLab = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ports = path.join(themeLab, 'ports');
const contractPath = path.join(ports, 'current-acceptance/run-contract.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('current browser run contract binds production Sigma-9 and exact current fixtures', () => {
  assert.equal(contract.schema, 'scp_jp_interactive_acceptance_run.v1');
  assert.deepEqual(contract.target_site, {
    slug: 'scpaiueouiuiuiui',
    origin: 'https://scpaiueouiuiuiui.wikijump.localhost:18443',
    locale: 'ja',
  });
  assert.equal(contract.baseline_theme.name, 'Sigma-9');
  assert.equal(contract.baseline_theme.runtime_stylesheet_href, '/wikidot/styles/sigma-fe5388a32e12.css');
  const baseline = fs.readFileSync(path.resolve(path.dirname(contractPath), contract.baseline_theme.replacement_css_path));
  assert.equal(sha(baseline), contract.baseline_theme.replacement_css_sha256);
  assert.equal(contract.baseline_theme.replacement_css_sha256, '2f58982dffd2a57f911971f7d7cd9706838c7a512bd8ffaaa0daea7c216517ba');

  for (const [key, fixture] of Object.entries({
    header_fixture: 'scp-jp-header.html',
    navigation_fixture: 'scp-jp-navigation.html',
    sidebar_fixture: 'scp-jp-sidebar.html',
  })) {
    assert.equal(contract[key].path, `../../fixtures/${fixture}`);
    assert.equal(sha(fs.readFileSync(path.resolve(path.dirname(contractPath), contract[key].path))), contract[key].sha256, `${fixture} hash`);
  }
});

test('current run contract covers the 35 registered packages and only the unregistered maintained package', () => {
  const campaign = JSON.parse(fs.readFileSync(path.join(ports, 'en-theme-campaign.json'), 'utf8'));
  const registered = new Set(['dear-dictator', ...campaign.themes.map(row => row.slug.replace(/^theme:/u, ''))]);
  const ledger = JSON.parse(fs.readFileSync(path.join(ports, 'adaptation-authority.json'), 'utf8'));
  const maintained = new Set(Object.keys(ledger.packages));
  assert.equal(registered.size, 35);
  assert.equal(maintained.size, 36);
  assert.deepEqual([...maintained].filter(name => !registered.has(name)), ['quand-le-soleil-se-couche']);
  assert.deepEqual(Object.keys(contract.additional_candidates), ['quand-le-soleil-se-couche']);
  assert.equal(new Set([...registered, ...Object.keys(contract.additional_candidates)]).size, 36);

  const candidate = contract.additional_candidates['quand-le-soleil-se-couche'];
  assert.equal(candidate.directory, '../quand-le-soleil-se-couche');
  const directory = path.resolve(ports, 'current-acceptance', candidate.directory);
  const css = fs.readFileSync(path.join(directory, 'candidate.css'));
  let base = Buffer.alloc(0);
  try { base = fs.readFileSync(path.join(directory, 'candidate-base.css')); } catch (error) { assert.equal(error.code, 'ENOENT'); }
  const sourceName = ledger.packages['quand-le-soleil-se-couche'].source_file;
  const source = fs.readFileSync(path.join(directory, sourceName));
  assert.equal(candidateIdentity(css, base).candidateSha, candidate.candidate_sha256);
  assert.equal(sha(source), candidate.source_sha256);
});

test('current run artifacts stay isolated below current-acceptance', () => {
  assert.match(contract.artifact_namespace, /^current-acceptance\/[a-z0-9-]+$/u);
  assert.equal(contract.audit_path, 'artifacts/interactive-visual-audit.json');
  const audit = path.resolve(path.dirname(contractPath), contract.audit_path);
  assert.ok(audit.startsWith(path.dirname(contractPath) + path.sep));
  assert.notEqual(audit, path.join(ports, 'interactive-visual-audit.json'));
  assert.equal(fs.existsSync(audit), false, 'contract creation must not fabricate acceptance evidence');
});
