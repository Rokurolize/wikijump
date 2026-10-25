#!/usr/bin/env node
// Writes the Sigma-10 migration decision from a finished browser audit and one
// canonical scenario matrix per maintained package. Refuses (exit 1, nothing
// written) unless the completion gate's own audit checks pass on these bytes.
//
// usage: finalize-current-sigma10.mjs --audit=<file> --run-contract=<sigma10 contract>
//          --scenario-matrix=<dir holding <package>.json> --browser-root=<framerail>
//          [--nonblocking=<json array>] [--gzip]
//
// Exit 0: decision written. Exit 1: refused, nothing written. Exit 64: usage error.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {finalizeCurrentSigma10} from '../src/finalize-current-sigma10.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'usage: finalize-current-sigma10.mjs --audit=<file> --run-contract=<sigma10 contract> --scenario-matrix=<dir> --browser-root=<framerail> [--nonblocking=<file>] [--gzip]';
const KNOWN = new Set(['--audit', '--run-contract', '--scenario-matrix', '--browser-root', '--nonblocking', '--gzip']);

function parse(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--gzip') {
      if (options.gzip) throw new Error('--gzip may be supplied only once');
      options.gzip = true;
      continue;
    }
    const equals = arg.indexOf('=');
    const key = equals < 0 ? arg : arg.slice(0, equals);
    if (!KNOWN.has(key) || equals < 0 || equals === arg.length - 1) throw new Error(`invalid argument ${arg}`);
    if (options[key] !== undefined) throw new Error(`${key} may be supplied only once`);
    options[key] = arg.slice(equals + 1);
  }
  for (const key of ['--audit', '--run-contract', '--scenario-matrix', '--browser-root']) {
    if (!options[key]) throw new Error(`missing ${key}`);
  }
  return options;
}

let options;
try {
  options = parse(process.argv.slice(2));
} catch (error) {
  console.error(`${error.message}\n${usage}`);
  process.exit(64);
}

let result;
try {
  result = finalizeCurrentSigma10({
    root,
    auditPath: options['--audit'],
    runContract: options['--run-contract'],
    scenarioMatrixDirectory: options['--scenario-matrix'],
    browserRoot: options['--browser-root'],
    nonblockingPath: options['--nonblocking'] ?? null,
    gzip: options.gzip === true,
  });
} catch (error) {
  result = {ok: false, failures: [error.message], written: []};
}
console.log(JSON.stringify({command: 'finalize-current-sigma10', result: result.ok ? 'SIGMA-10 DECISION WRITTEN' : 'SIGMA-10 DECISION REFUSED', ...result}, null, 2));
process.exitCode = result.ok ? 0 : 1;
