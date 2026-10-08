#!/usr/bin/env node
// Repository-local source identity gate. No cargo, fixtures, network, or mutable output.
// This is NOT the full test-quality or mutation acceptance verifier.
import {createHash} from "node:crypto";
import {existsSync, readFileSync, realpathSync} from "node:fs";
import {dirname, isAbsolute, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = process.env.WIKIJUMP_TEST_QUALITY_LEDGER ||
  resolve(root, "docs/development/test-quality-audit.json");
const fail = (message) => {throw new Error(message);};

function repositoryFile(file, label) {
  if (typeof file !== "string" || !file || isAbsolute(file)) {
    fail(`${label} must be a repository-relative path`);
  }
  const target = resolve(root, file);
  const local = relative(root, target);
  if (!local || local === ".." || local.startsWith("../") || isAbsolute(local)) {
    fail(`${label} escapes repository: ${file}`);
  }
  if (!existsSync(target)) fail(`${label} does not exist: ${file}`);
  const actual = relative(root, realpathSync(target));
  if (!actual || actual === ".." || actual.startsWith("../") || isAbsolute(actual)) {
    fail(`${label} symlink points outside repository: ${file}`);
  }
  return target;
}

function verifyIdentity(identity, label) {
  if (!identity || !/^[0-9a-f]{64}$/u.test(identity.sha256 ?? "")) {
    fail(`${label} requires a SHA-256 identity`);
  }
  const bytes = readFileSync(repositoryFile(identity.path, label));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== identity.sha256) fail(`${label} SHA-256 drift: ${identity.path}`);
  return bytes;
}

export function verifyAuditIdentityLedger(ledger) {
  if (ledger?.schema !== "wikijump.test_quality_audit.v1" ||
      !Array.isArray(ledger.inputs) || !Array.isArray(ledger.owners) ||
      ledger.owners.length === 0 || !Array.isArray(ledger.records)) {
    fail("audit ledger is missing required collections");
  }
  for (const input of ledger.inputs) verifyIdentity(input, "audit input");

  const records = new Map();
  for (const record of ledger.records) {
    if (records.has(record.path)) fail(`duplicate production source identity: ${record.path}`);
    verifyIdentity(record, "production source");
    records.set(record.path, record);
  }

  const ids = new Set();
  let mutationOwners = 0;
  for (const owner of ledger.owners) {
    if (typeof owner.id !== "string" || !owner.id || ids.has(owner.id)) {
      fail(`missing or duplicate owner id: ${owner.id}`);
    }
    ids.add(owner.id);
    if (!Array.isArray(owner.files) || owner.files.length === 0 ||
        !Array.isArray(owner.anchors) || owner.anchors.length === 0) {
      fail(`owner ${owner.id} requires source files and behavioral anchors`);
    }
    for (const file of owner.files) {
      if (!records.has(file)) fail(`owner ${owner.id} references an unknown source: ${file}`);
    }
    for (const anchor of owner.anchors) {
      const separator = typeof anchor === "string" ? anchor.indexOf("#") : -1;
      if (separator <= 0 || separator === anchor.length - 1) {
        fail(`owner ${owner.id} has an invalid anchor: ${anchor}`);
      }
      const file = anchor.slice(0, separator);
      const name = anchor.slice(separator + 1);
      const source = readFileSync(repositoryFile(file, `test anchor for ${owner.id}`), "utf8");
      if (!source.includes(name)) fail(`owner ${owner.id} has an invalid or missing anchor: ${anchor}`);
    }
    if (owner.mutation_inventory_sha256) {
      if (!/^[0-9a-f]{64}$/u.test(owner.mutation_inventory_sha256)) {
        fail(`owner ${owner.id} has an invalid mutation inventory identity`);
      }
      mutationOwners++;
    }
  }
  return {inputs: ledger.inputs.length, records: records.size, owners: ids.size, mutationOwners};
}

try {
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  const result = verifyAuditIdentityLedger(ledger);
  process.stdout.write(
    `Verified test quality identities: ${result.records} source files, ${result.inputs} inputs, ` +
    `${result.owners} owner(s), ${result.mutationOwners} mutation owner(s). Mutation results not rechecked.\n`,
  );
} catch (error) {
  console.error(`Test quality identity check failed: ${error.message}`);
  process.exitCode = 1;
}
