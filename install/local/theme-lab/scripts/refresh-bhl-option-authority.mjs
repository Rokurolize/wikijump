#!/usr/bin/env node
// Writes a successor of the BHL option authority with the framerail fingerprint
// measured from this checkout. The backend runtime identity comes only from
// --backend-identity-receipt, a file that holds a Deepwell runtime identity
// (either the identity itself or {backend_runtime_identity: ...}). The receipt
// must pass requireDeepwellRuntimeIdentity and must name the same source and
// FTML revision as this checkout. The tool never measures a container.
//
// It also writes a successor dependency graph. Its targeted scenarios pin the
// new authority bytes in current_authority_sha256. Both files are written only
// to --output-dir. Copy them into ports/black-highlighter-theme/option-scenarios/
// and publication/ explicitly.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {deepwellRuntimeSourceIdentity, requireDeepwellRuntimeIdentity} from '../src/deepwell-runtime-identity.mjs';
import {framerailSourceFingerprintSync} from '../src/framerail-source-fingerprint.mjs';

export const THEME_LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AUTHORITY = 'ports/black-highlighter-theme/option-scenarios/authority.json';
const GRAPH = 'publication/dependency-graph.json';
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

export class BhlAuthorityError extends Error {}

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const serialize = value => `${JSON.stringify(value, null, 2)}\n`;

// The repository root is three levels above the theme-lab directory, as in the
// freeze generator and the validator.
export function refreshBhlOptionAuthority({root = THEME_LAB, receiptText, observedAt}) {
  if (typeof receiptText !== 'string') throw new BhlAuthorityError('--backend-identity-receipt is required; the backend identity is never measured or copied from the checkout');
  if (!DATE.test(observedAt ?? '') || Number.isNaN(Date.parse(observedAt))) throw new BhlAuthorityError(`observed-at must be YYYY-MM-DD: ${observedAt}`);
  const repoRoot = path.resolve(root, '../../..');

  let receipt;
  try {
    receipt = JSON.parse(receiptText);
  } catch (error) {
    throw new BhlAuthorityError(`backend identity receipt is not JSON: ${error.message}`);
  }
  const identity = requireDeepwellRuntimeIdentity(structuredClone(receipt.backend_runtime_identity ?? receipt), 'backend identity receipt');
  const checkout = deepwellRuntimeSourceIdentity(repoRoot);
  if (identity.source_sha256 !== checkout.source_sha256 || identity.ftml_git_revision !== checkout.ftml_git_revision) {
    throw new BhlAuthorityError(`backend identity was not built from this checkout: receipt source ${identity.source_sha256} / FTML ${identity.ftml_git_revision}, checkout source ${checkout.source_sha256} / FTML ${checkout.ftml_git_revision}`);
  }
  const framerail = framerailSourceFingerprintSync(repoRoot);

  const authorityPath = path.join(root, AUTHORITY);
  const authorityBytes = fs.readFileSync(authorityPath);
  const authority = JSON.parse(authorityBytes.toString('utf8'));
  const successor = {
    ...authority,
    observed_at: observedAt,
    framerail: {...authority.framerail, fingerprint_sha256: framerail},
    backend_runtime_identity: identity,
  };
  const authorityText = serialize(successor);
  const newAuthoritySha = sha256(Buffer.from(authorityText));

  const graph = JSON.parse(fs.readFileSync(path.join(root, GRAPH), 'utf8'));
  const repinned = [];
  for (const scenario of graph.targeted_scenarios ?? []) {
    if (!Object.hasOwn(scenario, 'current_authority_sha256')) continue;
    repinned.push({id: scenario.id, from: scenario.current_authority_sha256, to: newAuthoritySha});
    scenario.current_authority_sha256 = newAuthoritySha;
  }
  return {
    authorityText,
    graphText: serialize(graph),
    authoritySha256: newAuthoritySha,
    previousFramerail: authority.framerail?.fingerprint_sha256 ?? null,
    framerail,
    identitySha256: identity.identity_sha256,
    repinned,
  };
}

function parseArguments(argv) {
  const options = {root: THEME_LAB, receipt: null, observedAt: null, outputDir: null};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) throw new BhlAuthorityError(`${argument} requires a value`);
      index += 1;
      return next;
    };
    if (argument === '--root') options.root = path.resolve(value());
    else if (argument === '--backend-identity-receipt') options.receipt = path.resolve(value());
    else if (argument === '--observed-at') options.observedAt = value();
    else if (argument === '--output-dir') options.outputDir = path.resolve(value());
    else throw new BhlAuthorityError(`unknown argument: ${argument}`);
  }
  if (!options.receipt) throw new BhlAuthorityError('--backend-identity-receipt is required; the backend identity is never measured or copied from the checkout');
  if (!options.observedAt || !options.outputDir) throw new BhlAuthorityError('usage: refresh-bhl-option-authority.mjs --backend-identity-receipt FILE --observed-at YYYY-MM-DD --output-dir DIR [--root DIR]');
  return options;
}

export function main(argv = process.argv.slice(2), {log = console.log, error = console.error} = {}) {
  let options;
  let result;
  try {
    options = parseArguments(argv);
    const receiptText = fs.readFileSync(options.receipt, 'utf8');
    result = refreshBhlOptionAuthority({root: options.root, receiptText, observedAt: options.observedAt});
  } catch (failure) {
    error(`BHL option authority refresh refused: ${failure.message}`);
    return 2;
  }
  fs.mkdirSync(options.outputDir, {recursive: true});
  fs.writeFileSync(path.join(options.outputDir, 'authority.json'), result.authorityText);
  fs.writeFileSync(path.join(options.outputDir, 'dependency-graph.json'), result.graphText);
  log(`wrote ${path.join(options.outputDir, 'authority.json')} (sha256 ${result.authoritySha256})`);
  log(`wrote ${path.join(options.outputDir, 'dependency-graph.json')}`);
  log(`framerail fingerprint ${result.previousFramerail} -> ${result.framerail}`);
  log(`backend identity ${result.identitySha256}`);
  log(`re-pinned targeted scenarios: ${result.repinned.map(item => item.id).join(', ') || 'none'}`);
  log(`next: copy authority.json to ${AUTHORITY} and dependency-graph.json to ${GRAPH}`);
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main();
}
