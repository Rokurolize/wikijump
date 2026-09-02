import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  requireNonEmptyString,
  requirePlainObject,
  requireSha256,
  sha256File,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const VERIFICATION_ONLY_PREFIXES = [
  ".github/",
  "docs/development/candidate-case-set-manifest.json",
  "install/local/wikidot-verification/",
];

export const CANDIDATE_SOURCE_EXECUTION_IDENTITY_SCHEMA =
  "wikijump.candidate_source_execution_identity.v1";

function sourceManifest(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error("candidate source manifest must not be empty");
  const manifest = files.map((file) => requireNonEmptyString(file, "candidate source path")).sort();
  if (new Set(manifest).size !== manifest.length) throw new Error("candidate source manifest paths must be unique");
  for (const file of manifest) {
    const absolute = path.resolve(REPOSITORY_ROOT, file);
    if (path.isAbsolute(file) || !absolute.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) throw new Error(`candidate source path escapes the repository: ${file}`);
  }
  return manifest;
}

function gitObject(value, name) {
  if (!GIT_OBJECT.test(value ?? "")) throw new Error(`${name} must be a full lowercase Git object id`);
  return value;
}

function modules(value, files) {
  const expected = sourceManifest(files);
  if (!Array.isArray(value) || value.length !== expected.length) throw new Error("candidate source execution identity has an incomplete module manifest");
  const entries = value.map((entry) => requirePlainObject(entry, "candidate source manifest entry"));
  if (JSON.stringify(entries.map((entry) => entry.path)) !== JSON.stringify(expected)) throw new Error("candidate source execution identity module manifest does not name exactly the supplied sources");
  return Object.freeze(entries.map((entry) => ({
    path: entry.path,
    sha256: requireSha256(entry.sha256, `candidate source ${entry.path} SHA-256`),
  })));
}

function ftmlPin(lockContents) {
  const section = lockContents.match(/\[\[package\]\]\nname = "ftml"\n[\s\S]*?(?=\n\[\[package\]\]|$)/u)?.[0];
  const revision = section?.match(/^source = "[^"]+#([0-9a-f]{40})"$/mu)?.[1];
  if (!revision) throw new Error("deepwell/Cargo.lock does not contain an exact FTML revision");
  return revision;
}

export function validateCandidateSourceExecutionIdentity(value, candidateIdentity, files, { schema = CANDIDATE_SOURCE_EXECUTION_IDENTITY_SCHEMA } = {}) {
  const execution = requirePlainObject(value, "candidate source execution identity");
  if (execution.schema !== schema) throw new Error(`candidate source execution identity must use ${schema}`);
  if (execution.source_clean !== true) throw new Error("candidate source execution checkout is not clean");
  if (
    gitObject(execution.wikijump_commit, "candidate source Wikijump commit") !== candidateIdentity.candidate.wikijump_commit ||
    gitObject(execution.wikijump_tree, "candidate source Wikijump tree") !== candidateIdentity.candidate.wikijump_tree ||
    gitObject(execution.ftml_sha, "candidate source FTML SHA") !== candidateIdentity.candidate.ftml_sha
  ) throw new Error("candidate source execution identity does not bind the sealed candidate source identity");
  const manifest = modules(execution.modules, files);
  const manifestSha256 = requireSha256(execution.module_manifest_sha256, "candidate source module manifest SHA-256");
  if (sha256Value(manifest) !== manifestSha256) throw new Error("candidate source execution module manifest hash is invalid");
  return Object.freeze({
    schema,
    source_clean: true,
    wikijump_commit: candidateIdentity.candidate.wikijump_commit,
    wikijump_tree: candidateIdentity.candidate.wikijump_tree,
    ftml_sha: candidateIdentity.candidate.ftml_sha,
    modules: manifest,
    module_manifest_sha256: manifestSha256,
  });
}

async function git(args) {
  const { stdout } = await execFileAsync("git", ["-C", REPOSITORY_ROOT, ...args], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

async function assertCandidateRuntimeUnchanged(candidateCommit, head) {
  if (candidateCommit === head) return;
  await git(["merge-base", "--is-ancestor", candidateCommit, head]);
  const changed = (await git(["diff", "--name-only", `${candidateCommit}..${head}`])).split("\n").filter(Boolean);
  if (changed.length === 0 || changed.some((file) => !VERIFICATION_ONLY_PREFIXES.some((prefix) => file.startsWith(prefix)))) {
    throw new Error("candidate source execution identity does not bind the sealed candidate runtime");
  }
}

export async function collectCandidateSourceExecutionIdentity(candidateIdentity, files, options = {}) {
  const sourceFiles = sourceManifest(files);
  const [status, head, tree, lockContents] = await Promise.all([
    git(["status", "--porcelain=v1", "--untracked-files=all"]),
    git(["rev-parse", "HEAD"]),
    git(["rev-parse", "HEAD^{tree}"]),
    fs.readFile(path.join(REPOSITORY_ROOT, "deepwell", "Cargo.lock"), "utf8"),
  ]);
  await assertCandidateRuntimeUnchanged(candidateIdentity.candidate.wikijump_commit, head);
  if (status !== "") throw new Error("candidate source execution checkout must be clean");
  const manifest = [];
  for (const relativePath of sourceFiles) {
    const filePath = path.resolve(REPOSITORY_ROOT, relativePath);
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`candidate source is not a regular file: ${relativePath}`);
    manifest.push({ path: relativePath, sha256: await sha256File(filePath) });
  }
  const schema = options.schema ?? CANDIDATE_SOURCE_EXECUTION_IDENTITY_SCHEMA;
  return validateCandidateSourceExecutionIdentity({
    schema,
    source_clean: true,
    wikijump_commit: candidateIdentity.candidate.wikijump_commit,
    wikijump_tree: candidateIdentity.candidate.wikijump_tree,
    ftml_sha: ftmlPin(lockContents),
    modules: manifest,
    module_manifest_sha256: sha256Value(manifest),
  }, candidateIdentity, sourceFiles, { schema });
}
