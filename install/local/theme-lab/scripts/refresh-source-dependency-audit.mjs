#!/usr/bin/env node
// Writes a dated successor of the source-dependency freeze audit, with each
// theme's candidate source and candidate.css hashes recomputed from repository
// bytes. Refuses when a theme's include or @import surface differs from the
// audit-era bytes, because that changes its dependency rows and needs a real
// dependency audit. Audit-era bytes are read from --prior-bytes-dir, where each
// file is named by its SHA-256 and must hash to that name.
//
// Pass the successor to build-candidate-freeze.mjs with
// --source-dependency-audit. The file is written only to --output-dir.

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolveExistingContainedFile} from '../src/package-path.mjs';
import {refreshSourceDependencyAudit, SourceDependencyAuditError, sourceAuditSha256} from '../src/source-dependency-audit-refresh.mjs';

export const THEME_LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT_ID = 'source-dependency-audit';
const DEFAULT_AUDIT = 'publication/evidence/audits/theme-lab-source-dependency-freeze-audit-20261006.json';

function parseArguments(argv) {
  const options = {root: THEME_LAB, refreshedAt: null, outputDir: null, priorBytesDir: null, audit: null};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) throw new SourceDependencyAuditError(`${argument} requires a value`);
      index += 1;
      return next;
    };
    if (argument === '--root') options.root = path.resolve(value());
    else if (argument === '--refreshed-at') options.refreshedAt = value();
    else if (argument === '--output-dir') options.outputDir = path.resolve(value());
    else if (argument === '--prior-bytes-dir') options.priorBytesDir = path.resolve(value());
    else if (argument === '--audit') options.audit = value();
    else throw new SourceDependencyAuditError(`unknown argument: ${argument}`);
  }
  if (!options.refreshedAt || !options.outputDir) {
    throw new SourceDependencyAuditError('usage: refresh-source-dependency-audit.mjs --refreshed-at YYYY-MM-DD --output-dir DIR [--prior-bytes-dir DIR] [--root DIR] [--audit ROOT_RELATIVE]');
  }
  return options;
}

export function refreshFromFiles(options) {
  const frozenPath = path.join(options.root, 'publication', 'frozen-candidate-set.json');
  const frozen = JSON.parse(fs.readFileSync(frozenPath, 'utf8'));
  const listed = (frozen.authority?.artifacts ?? []).find(artifact => artifact.id === AUDIT_ID)?.path ?? DEFAULT_AUDIT;
  const auditRelative = options.audit ?? listed;
  const auditBytes = fs.readFileSync(resolveExistingContainedFile(options.root, auditRelative, 'Source-dependency audit'));
  const graph = JSON.parse(fs.readFileSync(path.join(options.root, 'publication', 'dependency-graph.json'), 'utf8'));
  const priorBytes = expected => {
    if (!options.priorBytesDir) throw new SourceDependencyAuditError('--prior-bytes-dir is required when a theme hash changed');
    const file = path.join(options.priorBytesDir, expected);
    if (!/^[a-f0-9]{64}$/u.test(expected) || !fs.existsSync(file)) throw new Error(`no file named ${expected} in ${options.priorBytesDir}`);
    return fs.readFileSync(file);
  };
  return refreshSourceDependencyAudit({
    audit: JSON.parse(auditBytes.toString('utf8')),
    graph,
    root: options.root,
    refreshedAt: options.refreshedAt,
    priorBytes,
    predecessorSha256: sourceAuditSha256(auditBytes),
  });
}

export function main(argv = process.argv.slice(2), {log = console.log, error = console.error} = {}) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (failure) {
    error(failure.message);
    return 2;
  }
  let result;
  try {
    result = refreshFromFiles(options);
  } catch (failure) {
    error(`source-dependency audit refresh refused: ${failure.message}`);
    return 2;
  }
  fs.mkdirSync(options.outputDir, {recursive: true});
  const name = `theme-lab-source-dependency-freeze-audit-${options.refreshedAt}.json`;
  const output = path.join(options.outputDir, name);
  fs.writeFileSync(output, result.text);
  log(`wrote ${output}`);
  log(`themes with refreshed hashes: ${result.changes.length}`);
  for (const change of result.changes) log(`  ${change.theme}: source ${change.from.source} -> ${change.to.source}; css ${change.from.css} -> ${change.to.css}`);
  log(`next: copy to publication/evidence/audits/${name} and pass --source-dependency-audit publication/evidence/audits/${name} to build-candidate-freeze.mjs`);
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main();
}
