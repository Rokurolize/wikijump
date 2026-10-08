#!/usr/bin/env node
// Repository-local audit identity gate. No cargo, fixtures, network, or mutable output.
// This is NOT the full mutation inventory or behavioral acceptance verifier.
import {createHash} from "node:crypto";
import {existsSync, readFileSync, realpathSync} from "node:fs";
import {dirname, isAbsolute, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = process.env.WIKIJUMP_TEST_QUALITY_LEDGER ||
  resolve(root, "docs/development/test-quality-audit.json");
const fail = (message) => {throw new Error(message);};

function inRoot(path, label) {
  if (typeof path !== "string" || !path || isAbsolute(path)) {
    fail(`${label} must be a repository-relative path`);
  }
  const resolved = resolve(root, path);
  const local = relative(root, resolved);
  if (!local || local === ".." || local.startsWith("../") || isAbsolute(local)) {
    fail(`${label} escapes repository: ${path}`);
  }
  if (!existsSync(resolved)) fail(`${label} does not exist: ${path}`);
  const link = relative(root, realpathSync(resolved));
  if (!link || link === ".." || link.startsWith("../") || isAbsolute(link)) {
    fail(`${label} symlink points outside repository: ${path}`);
  }
  return resolved;
}

function verifyIdentity(identity, label) {
  if (!identity || !/^[0-9a-f]{64}$/u.test(identity.sha256 ?? "")) {
    fail(`${label} requires a SHA-256 identity`);
  }
  const bytes = readFileSync(inRoot(identity.path, label));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== identity.sha256) fail(`${label} SHA-256 drift: ${identity.path}`);
  return bytes;
}

export function verifyAuditIdentityLedger(ledger) {
  if (ledger?.schema !== 1 || !Array.isArray(ledger.lockfiles) ||
      !Array.isArray(ledger.owners) || ledger.owners.length === 0 ||
      !Array.isArray(ledger.next_mutation_frontier)) {
    fail("audit ledger is missing required collections");
  }
  const ids = new Set();
  let checked = 0;
  for (const identity of ledger.lockfiles) {
    verifyIdentity(identity, "lockfile");
    checked++;
  }
  for (const owner of ledger.owners) {
    if (typeof owner.id !== "string" || !owner.id || ids.has(owner.id)) {
      fail(`missing or duplicate owner id: ${owner.id}`);
    }
    ids.add(owner.id);
    verifyIdentity(owner.source, `source for ${owner.id}`);
    checked++;
    if (!Array.isArray(owner.tests) || owner.tests.length === 0) {
      fail(`owner ${owner.id} requires at least one test identity`);
    }
    for (const entry of owner.tests) {
      const testSource = verifyIdentity(entry, `test for ${owner.id}`).toString("utf8");
      checked++;
      if (!Array.isArray(entry.anchors) || entry.anchors.length === 0 ||
          entry.anchors.some((anchor) => typeof anchor !== "string" || !anchor || !testSource.includes(anchor))) {
        fail(`test for ${owner.id} has an invalid or missing anchor: ${entry.path}`);
      }
    }
  }
  for (const frontier of ledger.next_mutation_frontier) {
    if (typeof frontier.owner_candidate !== "string" || !frontier.owner_candidate || ids.has(frontier.owner_candidate)) {
      fail(`missing or duplicate frontier owner identity: ${frontier.owner_candidate}`);
    }
    ids.add(frontier.owner_candidate);
    verifyIdentity({path:frontier.source,sha256:frontier.source_sha256}, `frontier ${frontier.owner_candidate}`);
    checked++;
  }
  return {owners: ledger.owners.length, frontiers: ledger.next_mutation_frontier.length, identities: checked};
}

try {
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  const result = verifyAuditIdentityLedger(ledger);
  process.stdout.write(`Verified repository-local test quality identities: ${result.identities} files, ${result.owners} owner(s), ${result.frontiers} frontier(s). Mutation results not rechecked.\n`);
} catch (error) {
  console.error(`Test quality identity check failed: ${error.message}`);
  process.exitCode = 1;
}
