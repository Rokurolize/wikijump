#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import {
  buildCorpusSnapshot,
  discoverCanonicalCorpusFiles,
} from '../src/corpus-snapshot.mjs';
import { publishBytesNoReplace } from '../src/atomic-no-replace.mjs';
import { stableStringify } from '../src/canonical-json.mjs';
import {runCliIfMain} from '../src/cli-entry.mjs';
import { CORPUS_SNAPSHOT_HASH_WORKER_URL } from '../src/corpus-snapshot-hash-worker.mjs';

export function usage() {
  return 'Usage: freeze-corpus-snapshot.mjs --corpus-root <path> --output <lock.json> [--branch <name>...] [--repository <name>=<path>#<ref>...] [--file <name>=<path>...] [--hash-workers <count>]';
}

export function parseArgs(argv) {
  const args = {
    corpusRoot: null,
    output: null,
    branches: [],
    repositories: [],
    files: [],
    hashWorkers: Math.min(8, Math.max(1, os.availableParallelism())),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === '--corpus-root') args.corpusRoot = next();
    else if (arg === '--output') args.output = next();
    else if (arg === '--branch') args.branches.push(next());
    else if (arg === '--repository') args.repositories.push(next());
    else if (arg === '--file') args.files.push(next());
    else if (arg === '--hash-workers') args.hashWorkers = Number.parseInt(next(), 10);
    else if (arg === '--help' || arg === '-h') return { help: true };
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.corpusRoot) throw new Error('--corpus-root is required');
  if (!args.output) throw new Error('--output is required');
  if (!Number.isInteger(args.hashWorkers) || args.hashWorkers < 1) {
    throw new Error('--hash-workers must be a positive integer');
  }
  return args;
}

function hashInWorker(paths) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(CORPUS_SNAPSHOT_HASH_WORKER_URL);
    worker.once('message', (results) => {
      worker.terminate().then(() => resolve(results), reject);
    });
    worker.once('error', reject);
    worker.postMessage(paths);
  });
}

async function hashFiles(entries, workerCount) {
  const batches = Array.from({ length: Math.min(workerCount, entries.length) }, () => []);
  for (const [index, entry] of entries.entries()) {
    batches[index % batches.length].push(entry.absolute);
  }
  const results = await Promise.all(batches.map(hashInWorker));
  return new Map(results.flat());
}

function repositorySnapshot(specification) {
  const equals = specification.indexOf('=');
  if (equals <= 0) throw new Error(`invalid --repository value: ${specification}`);
  const name = specification.slice(0, equals);
  const pathAndRef = specification.slice(equals + 1);
  const hash = pathAndRef.lastIndexOf('#');
  const repositoryPath = path.resolve(hash === -1 ? pathAndRef : pathAndRef.slice(0, hash));
  const reference = hash === -1 ? 'HEAD' : pathAndRef.slice(hash + 1);
  const git = (...args) => execFileSync('git', ['-C', repositoryPath, ...args], { encoding: 'utf8' }).trim();
  if (git('status', '--porcelain=v1', '--untracked-files=all') !== '') {
    throw new Error(`repository is not clean: ${repositoryPath}`);
  }
  return {
    name,
    path: repositoryPath,
    reference,
    commit: git('rev-parse', `${reference}^{commit}`),
    tree: git('rev-parse', `${reference}^{tree}`),
    source_clean: true,
  };
}

function sourceFileSnapshot(specification) {
  const equals = specification.indexOf('=');
  if (equals <= 0) throw new Error(`invalid --file value: ${specification}`);
  const name = specification.slice(0, equals);
  if (!/^[a-z][a-z0-9_.-]*$/u.test(name)) throw new Error(`invalid --file name: ${name}`);
  const filePath = path.resolve(specification.slice(equals + 1));
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error(`source file must be a single-link regular file: ${filePath}`);
  }
  const bytes = fs.readFileSync(filePath);
  return {name, path: filePath, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex')};
}

export async function main(argv, { stdout = console.log } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    stdout(usage());
    return 0;
  }
  const repositories = args.repositories.map(repositorySnapshot).sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(repositories.map(({name}) => name)).size !== repositories.length) throw new Error('duplicate --repository name');
  const files = args.files.map(sourceFileSnapshot).sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(files.map(({name}) => name)).size !== files.length) throw new Error('duplicate --file name');
  const branches = args.branches.length === 0 ? null : args.branches;
  const canonicalFiles = discoverCanonicalCorpusFiles(args.corpusRoot, branches);
  const fileIntegrityCache = await hashFiles(canonicalFiles, args.hashWorkers);
  const snapshot = buildCorpusSnapshot({
    corpusRoot: args.corpusRoot,
    branches,
    repositories,
    fileIntegrityCache,
    sourceFiles: files,
  });
  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  const publication = await publishBytesNoReplace(
    path.resolve(args.output),
    `${stableStringify(snapshot)}\n`,
  );
  if (publication !== 'created') {
    throw new Error(`freeze output already exists: ${path.resolve(args.output)}`);
  }
  stdout(stableStringify({
    output: path.resolve(args.output),
    manifest_sha256: snapshot.manifest_sha256,
    ...snapshot.totals,
  }));
  return 0;
}

await runCliIfMain(import.meta.url, main, {
  onError: (error) => {
    console.error(error.stack ?? error.message);
    return 1;
  },
});
