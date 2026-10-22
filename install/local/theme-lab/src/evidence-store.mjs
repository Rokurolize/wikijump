#!/usr/bin/env node
// Content-addressed Theme Lab evidence store.
//
// One copy of every evidence blob, deduplicated by SHA-256, with per-source
// manifests mapping original relative paths to hashes. Views materialize as
// hardlinks so per-candidate checkouts cost inodes, not bytes.
//
// Commands:
//   ingest <source-dir> --manifest <path> [--store <dir>]
//   materialize --manifest <path> --dest <dir> [--store <dir>]
//   verify [--store <dir>] [--manifest <path>]
//
// Layout: <store>/objects/<first-2-hex>/<full-sha256>, same sharding as the
// theme-integration replay/objects prototype. Never deletes or modifies the
// source tree. See docs/agents/theme-lab.md ('Evidence retention').
//
// Usage: node install/local/theme-lab/scripts/evidence-store.mjs <command> ...

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';

const STORE_SCHEMA = 'theme_lab_evidence_store.v1';
export const defaultStorePath = () =>
  path.join(
    process.env.HOME ?? process.env.USERPROFILE ?? '.',
    '.local/state/wikijump/theme-lab-store'
  );

const objectPath = (store, sha256) =>
  path.join(store, 'objects', sha256.slice(0, 2), sha256);

async function sha256File(filePath) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function walkFiles(root) {
  // Returns { files, symlinks, dirs }: absolute file paths, absolute
  // symlink paths, and relative posix dir paths. Sorted deterministically.
  const files = [];
  const symlinks = [];
  const dirs = [];
  const visit = async (dir, rel) => {
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort(
      (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    );
    if (rel !== '') dirs.push(rel);
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await visit(abs, childRel);
      } else if (entry.isFile()) {
        files.push(abs);
      } else if (entry.isSymbolicLink()) {
        symlinks.push({ abs, rel: childRel });
      }
    }
  };
  await visit(root, '');
  return { files, symlinks, dirs };
}

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

export async function ingest(sourceDir, manifestPath, store) {
  const sourceStat = await fs.stat(sourceDir).catch(() => null);
  if (!sourceStat || !sourceStat.isDirectory()) {
    throw new Error(`ingest source is not a directory: ${sourceDir}`);
  }
  const { files, symlinks, dirs } = await walkFiles(sourceDir);
  const manifest = {
    schema: STORE_SCHEMA,
    version: 1,
    created: new Date().toISOString(),
    source: path.resolve(sourceDir),
    files: {},
    dirs,
    skipped: { symlinks: 0, other: [] }
  };
  let newObjects = 0;
  let newBytes = 0;
  let totalBytes = 0;
  for (const { rel } of symlinks) {
    manifest.skipped.symlinks += 1;
    manifest.skipped.other.push(rel);
  }
  for (const abs of files) {
    const rel = path.relative(sourceDir, abs).split(path.sep).join('/');
    const stat = await fs.lstat(abs);
    if (!stat.isFile()) {
      manifest.skipped.other.push(rel);
      continue;
    }
    const sha256 = await sha256File(abs);
    const dest = objectPath(store, sha256);
    try {
      await fs.stat(dest);
    } catch {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.tmp-${process.pid}`;
      await pipeline(createReadStream(abs), createWriteStream(tmp, { mode: 0o444 }));
      await fs.rename(tmp, dest);
      newObjects += 1;
      newBytes += stat.size;
    }
    manifest.files[rel] = {
      sha256,
      bytes: stat.size,
      mode: stat.mode & 0o777
    };
    totalBytes += stat.size;
  }
  // Deterministic key order for stable, reviewable manifests.
  manifest.files = Object.fromEntries(
    Object.entries(manifest.files).sort(([a], [b]) => (a < b ? -1 : 1))
  );
  manifest.dirs = [...dirs].sort();
  await fs.mkdir(path.dirname(path.resolve(manifestPath)), { recursive: true });
  await fs.writeFile(
    path.resolve(manifestPath),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  return {
    files: Object.keys(manifest.files).length,
    dirs: manifest.dirs.length,
    skippedSymlinks: manifest.skipped.symlinks,
    skippedOther: manifest.skipped.other.length,
    totalBytes,
    newObjects,
    newBytes
  };
}

function resolveWithin(dest, rel) {
  // Manifests are operator-supplied; never let a rel path escape dest or
  // replace the destination root itself.
  const target = path.resolve(dest, rel);
  const relative = path.relative(dest, target);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`manifest path escapes destination or targets its root: ${rel}`);
  }
  return target;
}

async function assertSafeDirectoryChain(dest, relativeDirectory) {
  // Lexical containment alone is not enough: a pre-existing symlink inside
  // dest could redirect mkdir/rm/link into an unrelated directory. Every
  // existing component from dest to the target's parent must be a real dir.
  const rootStat = await fs.lstat(dest);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`materialize destination is not a real directory: ${dest}`);
  }
  if (!relativeDirectory || relativeDirectory === '.') return;

  let current = dest;
  for (const part of relativeDirectory.split(path.sep)) {
    if (!part || part === '.') continue;
    current = path.join(current, part);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    const relative = path.relative(dest, current).split(path.sep).join('/');
    if (stat.isSymbolicLink()) {
      throw new Error(`materialize destination path contains a symlink: ${relative}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`materialize destination path is not a directory: ${relative}`);
    }
  }
}

export async function materialize(manifestPath, destDir, store) {
  const manifest = JSON.parse(await fs.readFile(path.resolve(manifestPath), 'utf8'));
  if (manifest.schema !== STORE_SCHEMA) {
    throw new Error(`unsupported manifest schema: ${manifest.schema}`);
  }
  const dest = path.resolve(destDir);
  await fs.mkdir(dest, { recursive: true });
  await assertSafeDirectoryChain(dest, '');
  for (const rel of manifest.dirs) {
    const targetDir = resolveWithin(dest, rel);
    const relativeDirectory = path.relative(dest, targetDir);
    await assertSafeDirectoryChain(dest, relativeDirectory);
    await fs.mkdir(targetDir, { recursive: true });
    await assertSafeDirectoryChain(dest, relativeDirectory);
  }
  let linked = 0;
  let copied = 0;
  for (const [rel, entry] of Object.entries(manifest.files)) {
    const target = resolveWithin(dest, rel);
    const parent = path.dirname(target);
    const relativeParent = path.relative(dest, parent);
    await assertSafeDirectoryChain(dest, relativeParent);
    await fs.mkdir(parent, { recursive: true });
    await assertSafeDirectoryChain(dest, relativeParent);
    // rm removes an entry itself; the validated real-parent chain prevents
    // it or the following link from being redirected outside dest.
    await fs.rm(target, { force: true });
    try {
      await fs.link(objectPath(store, entry.sha256), target);
      linked += 1;
      // Linked views stay at the store object's 0o444: chmod follows the
      // link and would retarget the shared inode's mode for every view.
    } catch (error) {
      if (error?.code !== 'EXDEV') throw error;
      await pipeline(
        createReadStream(objectPath(store, entry.sha256)),
        createWriteStream(target, { mode: entry.mode })
      );
      copied += 1;
    }
  }
  return { files: Object.keys(manifest.files).length, linked, copied };
}

export async function verify(store, manifestPath) {
  // Re-hash every stored object and confirm each filename matches content.
  const objectsDir = path.join(store, 'objects');
  let objects = 0;
  let objectBytes = 0;
  const shards = await fs.readdir(objectsDir).catch(() => []);
  for (const shard of shards.sort()) {
    const names = await fs.readdir(path.join(objectsDir, shard));
    for (const name of names.sort()) {
      const full = path.join(objectsDir, shard, name);
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      const actual = await sha256File(full);
      if (actual !== name) {
        throw new Error(`object hash mismatch: ${full} hashes to ${actual}`);
      }
      objects += 1;
      objectBytes += stat.size;
    }
  }
  let manifestEntries = null;
  let manifestResolved = null;
  if (manifestPath) {
    const manifest = JSON.parse(await fs.readFile(path.resolve(manifestPath), 'utf8'));
    manifestEntries = Object.keys(manifest.files).length;
    manifestResolved = 0;
    for (const [rel, entry] of Object.entries(manifest.files)) {
      const full = objectPath(store, entry.sha256);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat || !stat.isFile() || stat.size !== entry.bytes) {
        throw new Error(`manifest entry unresolvable: ${rel} -> ${entry.sha256}`);
      }
      manifestResolved += 1;
    }
  }
  return { objects, objectBytes, manifestEntries, manifestResolved };
}
