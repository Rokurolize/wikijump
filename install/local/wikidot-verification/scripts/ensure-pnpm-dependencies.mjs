#!/usr/bin/env node

import process from "node:process";

import {
  ensurePnpmDependencies,
  resolvePersistentPnpmStoreDir,
} from "../src/pnpm-offline-store.mjs";

function parseArgs(argv) {
  let dir = null;
  let requirePath = null;
  let storeDir = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dir") {
      dir = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === "--require-path") {
      requirePath = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === "--store-dir") {
      storeDir = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === "-h" || arg === "--help") {
      process.stdout.write(
        [
          "Usage: ensure-pnpm-dependencies.mjs --dir <package-dir> [--require-path <relpath>] [--store-dir <dir>]",
          "",
          "Runs `pnpm install --frozen-lockfile --offline` against the persistent pnpm store",
          "outside /tmp. If pnpm reports a missing offline tarball outside a test network guard,",
          "fetches missing tarballs once and retries the offline install once.",
          "",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!dir) {
    throw new Error("--dir is required");
  }
  return { dir, requirePath, storeDir };
}

function main() {
  const { dir, requirePath, storeDir } = parseArgs(process.argv.slice(2));
  ensurePnpmDependencies({
    dir,
    requirePath,
    storeDir: storeDir ?? resolvePersistentPnpmStoreDir(),
  });
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.message ?? String(error)}\n`);
  process.exitCode = 1;
}
