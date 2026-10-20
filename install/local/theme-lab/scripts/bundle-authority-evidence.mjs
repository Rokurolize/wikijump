#!/usr/bin/env node
// Deterministic packaging and verification for Theme Lab authority evidence.
//
// pack:    resolve every inventory file (checkout first, content store by
//          SHA-256 as fallback), re-hash what was read, write a manifest
//          (path, size, sha256, source path) and a reproducible USTAR
//          archive (sorted entries, fixed mtime/uid/gid/mode).
// extract: unpack an archive into a directory (refuses absolute paths and
//          `..` segments).
// verify:  check a restored tree byte for byte against the manifest.
//          Missing, mismatched, and unexpected files all fail.
//
// This tool never publishes or uploads anything: it writes only the local
// manifest, archive, and restored tree it is told to write. The durable
// store is a separate decision.
//
// Memory note: pack and extract buffer file bytes and the archive in
// memory. For the full multi-gigabyte evidence set, raise the heap (for
// example NODE_OPTIONS=--max-old-space-size=16384) or pack per-directory
// manifests; verify reads one file at a time and stays small.
//
// Usage:
//   bundle-authority-evidence.mjs pack --inventory <supplement.json>
//     --checkout <dir> [--store <objects-dir>]
//     --manifest <manifest.json> --archive <bundle.tar>
//   bundle-authority-evidence.mjs extract --archive <bundle.tar> --root <dir>
//   bundle-authority-evidence.mjs verify --manifest <manifest.json> --root <dir>
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildManifest,
  buildManifestEntries,
  createArchive,
  parseArchive,
  verifyRestored,
} from '../src/authority-evidence-bundle.mjs';

function usage() {
  return 'Usage: bundle-authority-evidence.mjs pack --inventory <supplement.json> --checkout <dir> [--store <objects-dir>] --manifest <manifest.json> --archive <bundle.tar> | extract --archive <bundle.tar> --root <dir> | verify --manifest <manifest.json> --root <dir>';
}

function parseArgs(argv) {
  const args = { command: argv[0] ?? null, inventory: null, checkout: null, store: null, manifest: null, archive: null, root: null };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === '--inventory') args.inventory = next();
    else if (arg === '--checkout') args.checkout = next();
    else if (arg === '--store') args.store = next();
    else if (arg === '--manifest') args.manifest = next();
    else if (arg === '--archive') args.archive = next();
    else if (arg === '--root') args.root = next();
    else if (arg === '--help' || arg === '-h') return { command: 'help' };
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

const sha256File = (filePath) => {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
};

function resolveBytes(relativePath, expectedSha, { checkout, store }) {
  const checkoutPath = path.join(checkout, relativePath);
  if (fs.existsSync(checkoutPath)) {
    return { bytes: fs.readFileSync(checkoutPath), sourcePath: checkoutPath };
  }
  if (store) {
    const objectPath = path.join(store, expectedSha.slice(0, 2), expectedSha);
    if (fs.existsSync(objectPath)) {
      return { bytes: fs.readFileSync(objectPath), sourcePath: objectPath };
    }
  }
  return null;
}

function listFilesRecursive(root) {
  const found = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) found.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  return found;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command === 'help' || !['pack', 'extract', 'verify'].includes(args.command)) {
    console.log(usage());
    return args.command === 'help' ? 0 : 2;
  }
  if (args.command === 'pack') {
    for (const key of ['inventory', 'checkout', 'manifest', 'archive']) {
      if (!args[key]) throw new Error(`pack requires --${key}`);
    }
    const inventory = JSON.parse(fs.readFileSync(args.inventory, 'utf8'));
    const bytesByPath = new Map();
    const entries = buildManifestEntries(inventory.files ?? [], (relativePath, sha) => {
      const found = resolveBytes(relativePath, sha, args);
      if (found) bytesByPath.set(relativePath, found.bytes);
      return found;
    });
    const archive = createArchive(entries.map((entry) => ({ path: entry.path, bytes: bytesByPath.get(entry.path) })));
    const manifest = buildManifest(entries, {
      inventorySha256: sha256File(args.inventory),
      archiveSha256: crypto.createHash('sha256').update(archive).digest('hex'),
    });
    fs.writeFileSync(args.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(args.archive, archive);
    console.log(JSON.stringify({ command: 'pack', entries: entries.length, total_bytes: manifest.total_bytes, manifest: args.manifest, archive: args.archive }));
    return 0;
  }
  if (args.command === 'extract') {
    if (!args.archive || !args.root) throw new Error('extract requires --archive and --root');
    const entries = parseArchive(fs.readFileSync(args.archive));
    for (const entry of entries) {
      const destination = path.join(args.root, entry.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, entry.bytes);
    }
    console.log(JSON.stringify({ command: 'extract', entries: entries.length, root: args.root }));
    return 0;
  }
  if (!args.manifest || !args.root) throw new Error('verify requires --manifest and --root');
  const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
  const report = verifyRestored(
    manifest,
    (relativePath) => {
      const full = path.join(args.root, relativePath);
      return fs.existsSync(full) ? fs.readFileSync(full) : null;
    },
    () => listFilesRecursive(args.root),
  );
  console.log(JSON.stringify(report, null, 2));
  return report.status === 'pass' ? 0 : 1;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) === new URL(import.meta.url).pathname : false;
if (invoked) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`bundle-authority-evidence: ${error.message}`);
      process.exit(1);
    },
  );
}
