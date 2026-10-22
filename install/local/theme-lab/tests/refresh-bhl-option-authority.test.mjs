import {describe, test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDeepwellRuntimeIdentity, deepwellRuntimeSourceIdentity} from '../src/deepwell-runtime-identity.mjs';
import {framerailSourceFingerprintSync} from '../src/framerail-source-fingerprint.mjs';
import {BhlAuthorityError, main, refreshBhlOptionAuthority} from '../scripts/refresh-bhl-option-authority.mjs';

const themeLab = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(themeLab, '../../..');
const AUTHORITY = path.join(themeLab, 'ports/black-highlighter-theme/option-scenarios/authority.json');
const GRAPH = path.join(themeLab, 'publication/dependency-graph.json');
const authorityBefore = fs.readFileSync(AUTHORITY, 'utf8');
const graphBefore = fs.readFileSync(GRAPH, 'utf8');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const checkout = deepwellRuntimeSourceIdentity(repo);

// A complete identity built from this checkout, as a validated receipt would carry.
function checkoutReceipt(overrides = {}) {
  const identity = createDeepwellRuntimeIdentity({
    source_sha256: checkout.source_sha256,
    ftml_git_revision: checkout.ftml_git_revision,
    container_id: 'a'.repeat(64),
    image_id: `sha256:${'b'.repeat(64)}`,
    binary_sha256: 'c'.repeat(64),
    config_sha256: 'd'.repeat(64),
    ...overrides,
  });
  return JSON.stringify({schema: 'theme_lab_backend_identity_receipt.v1', backend_runtime_identity: identity});
}

describe('BHL option authority refresh', () => {
  test('refuses without a receipt, and never takes the backend identity from the checkout', () => {
    assert.throws(() => refreshBhlOptionAuthority({root: themeLab, receiptText: undefined, observedAt: '2026-10-23'}),
      /backend identity is never measured or copied from the checkout/u);
  });

  test('refuses an invalid observed date', () => {
    assert.throws(() => refreshBhlOptionAuthority({root: themeLab, receiptText: checkoutReceipt(), observedAt: '2026-02-30T'}),
      /observed-at must be YYYY-MM-DD/u);
  });

  test('refuses a receipt whose identity hash is tampered with', () => {
    const receipt = JSON.parse(checkoutReceipt());
    receipt.backend_runtime_identity.identity_sha256 = '0'.repeat(64);
    assert.throws(() => refreshBhlOptionAuthority({root: themeLab, receiptText: JSON.stringify(receipt), observedAt: '2026-10-23'}),
      /backend identity receipt expected_backend_runtime_identity SHA-256 is invalid/u);
  });

  test('refuses a receipt that is not JSON', () => {
    assert.throws(() => refreshBhlOptionAuthority({root: themeLab, receiptText: '{not json', observedAt: '2026-10-23'}),
      /is not JSON/u);
  });

  test('refuses the recorded identity, which was not built from this checkout', () => {
    const recorded = JSON.parse(fs.readFileSync(AUTHORITY, 'utf8')).backend_runtime_identity;
    assert.throws(() => refreshBhlOptionAuthority({root: themeLab, receiptText: JSON.stringify({backend_runtime_identity: recorded}), observedAt: '2026-10-23'}),
      /was not built from this checkout/u);
  });

  test('a receipt built from this checkout writes the measured framerail fingerprint and identity', () => {
    const result = refreshBhlOptionAuthority({root: themeLab, receiptText: checkoutReceipt(), observedAt: '2026-10-23'});
    const authority = JSON.parse(result.authorityText);
    assert.equal(authority.framerail.fingerprint_sha256, framerailSourceFingerprintSync(repo));
    assert.equal(authority.observed_at, '2026-10-23');
    assert.equal(authority.backend_runtime_identity.source_sha256, checkout.source_sha256);
    assert.equal(authority.backend_runtime_identity.identity_sha256, result.identitySha256);
    // Everything else is carried.
    const original = JSON.parse(authorityBefore);
    assert.deepEqual(authority.pages, original.pages);
    assert.deepEqual(authority.candidate, original.candidate);
    assert.deepEqual(authority.option_candidates, original.option_candidates);
    assert.deepEqual(authority.source_intent_review, original.source_intent_review);
    assert.equal(authority.framerail.runtime_origin, original.framerail.runtime_origin);
  });

  test('re-pins every targeted scenario that carries current_authority_sha256 to the new authority bytes', () => {
    const result = refreshBhlOptionAuthority({root: themeLab, receiptText: checkoutReceipt(), observedAt: '2026-10-23'});
    const graph = JSON.parse(result.graphText);
    const originalGraph = JSON.parse(graphBefore);
    const scenarios = graph.targeted_scenarios.filter(scenario => Object.hasOwn(scenario, 'current_authority_sha256'));
    assert.ok(scenarios.length >= 2);
    for (const scenario of scenarios) assert.equal(scenario.current_authority_sha256, result.authoritySha256);
    assert.equal(result.authoritySha256, sha(result.authorityText));
    assert.deepEqual(result.repinned.map(item => item.id), scenarios.map(item => item.id));
    // Only the pin changed in the graph.
    const restore = structuredClone(graph);
    for (const scenario of restore.targeted_scenarios) if (Object.hasOwn(scenario, 'current_authority_sha256')) scenario.current_authority_sha256 = originalGraph.targeted_scenarios.find(item => item.id === scenario.id).current_authority_sha256;
    assert.deepEqual(restore, originalGraph);
  });

  test('the serialized authority keeps the committed file layout', () => {
    // A no-op rewrite of the committed file reproduces its bytes, so the successor diff is minimal.
    assert.equal(`${JSON.stringify(JSON.parse(authorityBefore), null, 2)}\n`, authorityBefore);
    assert.equal(`${JSON.stringify(JSON.parse(graphBefore), null, 2)}\n`, graphBefore);
  });

  test('the committed files are not modified by a refresh', () => {
    refreshBhlOptionAuthority({root: themeLab, receiptText: checkoutReceipt(), observedAt: '2026-10-23'});
    assert.equal(fs.readFileSync(AUTHORITY, 'utf8'), authorityBefore);
    assert.equal(fs.readFileSync(GRAPH, 'utf8'), graphBefore);
  });
});

describe('BHL option authority refresh CLI', () => {
  test('exits 2 without a receipt and writes nothing', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bhl-authority-refusal-'));
    try {
      const lines = [];
      const capture = {log: line => lines.push(line), error: line => lines.push(line)};
      assert.equal(main(['--observed-at', '2026-10-23', '--output-dir', outputDir], capture), 2);
      assert.match(lines.join('\n'), /--backend-identity-receipt is required/u);
      assert.equal(main(['--backend-identity-receipt', '/nonexistent/receipt.json', '--observed-at', '2026-10-23', '--output-dir', outputDir], capture), 2);
      assert.equal(main(['--backend-identity-receipt', 'x', '--observed-at', '2026-10-23', '--output-dir', outputDir, '--bogus', 'y'], capture), 2);
      assert.deepEqual(fs.readdirSync(outputDir), []);
    } finally {
      fs.rmSync(outputDir, {recursive: true, force: true});
    }
  });

  test('a valid receipt writes the successor authority and graph to the output directory', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bhl-authority-success-'));
    const receiptFile = path.join(outputDir, 'receipt.json');
    try {
      fs.writeFileSync(receiptFile, checkoutReceipt());
      const lines = [];
      assert.equal(main(['--backend-identity-receipt', receiptFile, '--observed-at', '2026-10-23', '--output-dir', path.join(outputDir, 'out')],
        {log: line => lines.push(line), error: line => lines.push(line)}), 0);
      const authority = JSON.parse(fs.readFileSync(path.join(outputDir, 'out', 'authority.json'), 'utf8'));
      const graph = JSON.parse(fs.readFileSync(path.join(outputDir, 'out', 'dependency-graph.json'), 'utf8'));
      assert.equal(authority.framerail.fingerprint_sha256, framerailSourceFingerprintSync(repo));
      for (const scenario of graph.targeted_scenarios.filter(item => Object.hasOwn(item, 'current_authority_sha256')))
        assert.equal(scenario.current_authority_sha256, sha(fs.readFileSync(path.join(outputDir, 'out', 'authority.json'), 'utf8')));
      assert.equal(fs.readFileSync(AUTHORITY, 'utf8'), authorityBefore);
    } finally {
      fs.rmSync(outputDir, {recursive: true, force: true});
    }
  });

  test('errors are typed', () => {
    assert.throws(() => refreshBhlOptionAuthority({root: themeLab, receiptText: undefined, observedAt: '2026-10-23'}), BhlAuthorityError);
  });
});
