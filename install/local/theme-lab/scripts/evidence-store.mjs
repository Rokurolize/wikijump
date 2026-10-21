#!/usr/bin/env node
// CLI wrapper: node install/local/theme-lab/scripts/evidence-store.mjs <command> ...
// Never deletes or modifies the source tree. See docs/agents/theme-lab.md.

import path from 'node:path';
import {
  defaultStorePath,
  ingest,
  materialize,
  parseArgs,
  verify
} from '../src/evidence-store.mjs';

const usage = `evidence-store <ingest <source-dir> --manifest <path> | materialize --manifest <path> --dest <dir> | verify [--manifest <path]> [--store <dir>]`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  const store = path.resolve(flags.store ?? DEFAULT_STORE());
  if (command === 'ingest') {
    const [sourceDir] = positional;
    if (!sourceDir || !flags.manifest) {
      throw new Error(`usage: evidence-store ingest <source-dir> --manifest <path> [--store <dir>]`);
    }
    const summary = await ingest(path.resolve(sourceDir), flags.manifest, store);
    console.log(JSON.stringify({ command, store, manifest: path.resolve(flags.manifest), ...summary }));
    return;
  }
  if (command === 'materialize') {
    if (!flags.manifest || !flags.dest) {
      throw new Error(`usage: evidence-store materialize --manifest <path> --dest <dir> [--store <dir>]`);
    }
    const summary = await materialize(flags.manifest, flags.dest, store);
    console.log(JSON.stringify({ command, store, ...summary }));
    return;
  }
  if (command === 'verify') {
    const summary = await verify(store, flags.manifest);
    console.log(JSON.stringify({ command, store, ...summary }));
    return;
  }
  throw new Error(usage);
}

await main().catch((error) => {
  console.error(`evidence-store: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
