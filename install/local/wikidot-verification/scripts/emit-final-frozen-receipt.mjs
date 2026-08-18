#!/usr/bin/env node

import {execFile} from "node:child_process";
import path from "node:path";
import {promisify} from "node:util";

import {runCliIfMain} from "../src/cli-entry.mjs";
import {
  readStableRegularFile,
  requireNonEmptyString,
  sealJsonNoReplace,
} from "../src/standing-browser-parity-util.mjs";
import {
  validateFinalFrozenInputManifest,
  validateFinalFrozenReceipt,
  validateCompatibilityReview,
  validateImageProducer,
  validateSourceWriterRoster,
} from "../src/final-frozen-receipt-contract.mjs";

const execFileAsync = promisify(execFile);
const GIT_OBJECT = /^[0-9a-f]{40}$/u;

function gitObject(value, name) {
  if (!GIT_OBJECT.test(value ?? "")) {
    throw new Error(`${name} must be a full lowercase Git object id`);
  }
  return value;
}

function parseJson(bytes, name) {
  try {
    return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
  } catch (error) {
    throw new Error(`${name} must contain valid UTF-8 JSON`, {cause: error});
  }
}

async function artifactReference(filePath, sourceRoot, name) {
  const absolute = path.resolve(sourceRoot, requireNonEmptyString(filePath, name));
  const file = await readStableRegularFile(absolute, `${name}: ${absolute}`);
  return {path: absolute, sha256: file.sha256};
}

async function artifactReferences(filePaths, sourceRoot, name) {
  const paths = filePaths.map((filePath) => path.resolve(sourceRoot, filePath)).sort();
  if (new Set(paths).size !== paths.length) {
    throw new Error(`${name} contains duplicate file paths`);
  }
  return Promise.all(paths.map((filePath) => artifactReference(filePath, sourceRoot, name)));
}

export async function buildFinalFrozenReceipt({
  source,
  inputManifestPath,
  sourceWritersPath,
  sourceRoot = process.cwd(),
}) {
  const manifestPath = path.resolve(
    sourceRoot,
    requireNonEmptyString(inputManifestPath, "input manifest"),
  );
  const writersPath = path.resolve(
    sourceRoot,
    requireNonEmptyString(sourceWritersPath, "source writer registry"),
  );
  const manifestFile = await readStableRegularFile(manifestPath, "input manifest");
  const manifest = validateFinalFrozenInputManifest(
    parseJson(manifestFile.bytes, "input manifest"),
  );
  if (
    !manifest.lockfiles.some(
      (filePath) =>
        path.resolve(sourceRoot, filePath) ===
        path.resolve(sourceRoot, "deepwell/Cargo.lock"),
    )
  ) {
    throw new Error("lockfiles must include deepwell/Cargo.lock");
  }
  const normalizedSource = {
    wikijump_commit: gitObject(source?.wikijump_commit, "source Wikijump commit"),
    wikijump_tree: gitObject(source?.wikijump_tree, "source Wikijump tree"),
    ftml_sha: gitObject(source?.ftml_sha, "source FTML commit"),
    lockfiles: await artifactReferences(manifest.lockfiles, sourceRoot, "lockfiles"),
  };
  const [writerFile, verifier, fixtures, tools, denominator, standardsReviewFile, specReviewFile, imageProducerFile] =
    await Promise.all([
      readStableRegularFile(writersPath, "source writer registry"),
      artifactReferences(manifest.verifier, sourceRoot, "verifier"),
      artifactReferences(manifest.fixtures, sourceRoot, "fixtures"),
      artifactReferences(manifest.tools, sourceRoot, "tools"),
      artifactReferences(manifest.denominator, sourceRoot, "denominator"),
      readStableRegularFile(
        path.resolve(sourceRoot, manifest.reviews.standards),
        "standards review",
      ),
      readStableRegularFile(
        path.resolve(sourceRoot, manifest.reviews.spec),
        "spec review",
      ),
      readStableRegularFile(
        path.resolve(sourceRoot, manifest.images),
        "image producer output",
      ),
    ]);
  validateSourceWriterRoster(
    parseJson(writerFile.bytes, "source writer registry"),
    normalizedSource,
  );
  validateCompatibilityReview(
    parseJson(standardsReviewFile.bytes, "standards review"),
    "standards",
    normalizedSource,
  );
  validateCompatibilityReview(
    parseJson(specReviewFile.bytes, "spec review"),
    "spec",
    normalizedSource,
  );
  const identities = validateImageProducer(
    parseJson(imageProducerFile.bytes, "image producer output"),
    normalizedSource,
  );
  const receipt = {
    schema: "wikijump.phase4.final_frozen_receipt.v1",
    status: "FINAL_FROZEN",
    source: normalizedSource,
    verifier: {
      wikijump_commit: normalizedSource.wikijump_commit,
      wikijump_tree: normalizedSource.wikijump_tree,
      files: verifier,
    },
    fixtures,
    tools,
    denominator,
    reviews: {
      standards: {
        path: path.resolve(sourceRoot, manifest.reviews.standards),
        sha256: standardsReviewFile.sha256,
      },
      spec: {
        path: path.resolve(sourceRoot, manifest.reviews.spec),
        sha256: specReviewFile.sha256,
      },
    },
    images: {
      producer: {
        path: path.resolve(sourceRoot, manifest.images),
        sha256: imageProducerFile.sha256,
      },
      identities,
    },
    inputs: {
      manifest: {path: manifestPath, sha256: manifestFile.sha256},
      source_writers: {path: writersPath, sha256: writerFile.sha256},
    },
    source_writers: [],
  };
  validateFinalFrozenReceipt(receipt, {source: normalizedSource});
  return receipt;
}

async function git(sourceRoot, args) {
  const {stdout} = await execFileAsync(
    "git",
    ["-C", sourceRoot, ...args],
    {encoding: "utf8", maxBuffer: 1024 * 1024},
  );
  return stdout.trim();
}

export async function sourceIdentity(sourceRoot) {
  if (await git(sourceRoot, ["status", "--porcelain=v1", "--untracked-files=all"])) {
    throw new Error("source checkout must be clean");
  }
  const lockFile = await readStableRegularFile(
    path.join(sourceRoot, "deepwell/Cargo.lock"),
    "deepwell/Cargo.lock",
  );
  const lock = new TextDecoder("utf-8", {fatal: true}).decode(lockFile.bytes);
  const matches = [
    ...lock.matchAll(
      /\[\[package\]\]\nname = "ftml"[\s\S]*?^source = "[^"\n]+#([0-9a-f]{40})"$/gmu,
    ),
  ].map((match) => match[1]);
  if (new Set(matches).size !== 1) {
    throw new Error("deepwell/Cargo.lock must contain exactly one FTML revision");
  }
  return {
    wikijump_commit: await git(sourceRoot, ["rev-parse", "HEAD"]),
    wikijump_tree: await git(sourceRoot, ["rev-parse", "HEAD^{tree}"]),
    ftml_sha: matches[0],
  };
}

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return {help: true};
    const name = flag?.startsWith("--") ? flag.slice(2) : "";
    if (
      !["source-root", "input-manifest", "source-writers", "output"].includes(name) ||
      Object.hasOwn(args, name)
    ) {
      throw new Error(`unknown or duplicate option: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    args[name] = path.resolve(value);
    index += 1;
  }
  for (const name of ["source-root", "input-manifest", "source-writers", "output"]) {
    if (!args[name]) throw new Error(`--${name} is required`);
  }
  return args;
}

export function usage() {
  return "Usage: emit-final-frozen-receipt.mjs --source-root DIR --input-manifest FILE --source-writers FILE --output FILE";
}

export async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  const receipt = await buildFinalFrozenReceipt({
    source: await sourceIdentity(args["source-root"]),
    inputManifestPath: args["input-manifest"],
    sourceWritersPath: args["source-writers"],
    sourceRoot: args["source-root"],
  });
  const sealed = await sealJsonNoReplace(args.output, receipt);
  console.log(
    JSON.stringify({
      schema: receipt.schema,
      status: receipt.status,
      output: sealed.path,
      sha256: sealed.sha256,
    }),
  );
  return 0;
}

await runCliIfMain(import.meta.url, main);
