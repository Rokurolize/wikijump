#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { runCliIfMain } from '../src/cli-entry.mjs';
import {
  buildRosterManifest,
  verifyRosterManifest,
} from '../src/roster-import-manifest.mjs';
import { stableStringify } from '../src/canonical-json.mjs';

export function usage() {
  return 'Usage: build-roster-import-manifest.mjs --capture <capture.json> --output <manifest.json>\n       build-roster-import-manifest.mjs --verify --manifest <manifest.json> [--capture <capture.json>]';
}

export function parseArgs(argv) {
  const args = { capture: null, output: null, manifest: null, verify: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === '--capture') args.capture = next();
    else if (arg === '--output') args.output = next();
    else if (arg === '--manifest') args.manifest = next();
    else if (arg === '--verify') args.verify = true;
    else if (arg === '--help' || arg === '-h') return { help: true };
    else throw new Error(`unknown argument: ${arg}\n${usage()}`);
  }
  return args;
}

function readJson(label, file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read ${label} ${file}: ${error.message}`);
  }
}

export function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  if (args.verify) {
    if (args.manifest === null) throw new Error(`--verify requires --manifest\n${usage()}`);
    const manifest = readJson('manifest', args.manifest);
    const capture = args.capture === null ? null : readJson('capture', args.capture);
    const result = verifyRosterManifest(manifest, capture);
    console.log(stableStringify(result));
    return result.ok ? 0 : 1;
  }
  if (args.capture === null || args.output === null) {
    throw new Error(`building a manifest requires --capture and --output\n${usage()}`);
  }
  const manifest = buildRosterManifest(readJson('capture', args.capture));
  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(args.output, `${stableStringify(manifest)}\n`);
  console.log(stableStringify({ manifest_sha256: manifest.manifest_sha256, row_count: manifest.row_count }));
  return 0;
}

await runCliIfMain(import.meta.url, main);
