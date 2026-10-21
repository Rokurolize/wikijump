import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LOCKFILES,
  buildFinalFrozenReceipt,
  parseArgs as parseFinalFrozenArgs,
} from "../scripts/emit-final-frozen-receipt.mjs";
import {parsePreflightOutput} from "../scripts/run-consolidated-validation.mjs";
import {
  CONSOLIDATED_VALIDATION_SCHEMA,
  FINAL_FROZEN_RECEIPT_SCHEMA,
  validateConsolidatedValidation,
  validateFinalFrozenReceipt,
  validateImageProducer,
  verifyFinalFrozenReceipt,
} from "../src/final-frozen-receipt-contract.mjs";

const SOURCE = Object.freeze({
  wikijump_commit: "a".repeat(40),
  wikijump_tree: "b".repeat(40),
  ftml_sha: "c".repeat(40),
});

function validation(overrides = {}) {
  return {
    schema: CONSOLIDATED_VALIDATION_SCHEMA,
    status: "pass",
    started_at: "2026-10-15T00:00:00.000Z",
    completed_at: "2026-10-15T01:00:00.000Z",
    wikijump_commit: SOURCE.wikijump_commit,
    wikijump_tree: SOURCE.wikijump_tree,
    base_commit: "d".repeat(40),
    mode: "final",
    groups: {deepwell: true, verification: true},
    checks: [
      {name: "deepwell clippy", status: "ok"},
      {name: "deepwell full tests", status: "ok"},
    ],
    tool_versions: {node: "v24"},
    preflight: {exit: 0, log: {path: "/log", sha256: "e".repeat(64)}, source_sha256: {}},
    ...overrides,
  };
}

function imageProducer(source = SOURCE) {
  return {
    status: "pass",
    wikijump_sha: source.wikijump_commit,
    wikijump_tree: source.wikijump_tree,
    ftml_sha: source.ftml_sha,
    images: {
      deepwell: {id: `sha256:${"1".repeat(64)}`},
      framerail: {id: `sha256:${"2".repeat(64)}`},
      wws: {id: `sha256:${"3".repeat(64)}`},
    },
  };
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "final-frozen-v2-"));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  for (const lockfile of LOCKFILES) {
    await fs.mkdir(path.dirname(path.join(root, lockfile)), {recursive: true});
    await fs.writeFile(path.join(root, lockfile), `lock ${lockfile}`);
  }
  const write = async (name, value) => {
    const filePath = path.join(root, "evidence", name);
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, JSON.stringify(value));
    return filePath;
  };
  return {root, write};
}

function frozenReceipt(overrides = {}) {
  const git = "d".repeat(40);
  const sha = "a".repeat(64);
  const ref = (name) => ({path: `/evidence/${name}`, sha256: sha});
  return {
    schema: FINAL_FROZEN_RECEIPT_SCHEMA,
    status: "FINAL_FROZEN",
    source: {
      wikijump_commit: SOURCE.wikijump_commit,
      wikijump_tree: SOURCE.wikijump_tree,
      ftml_sha: SOURCE.ftml_sha,
      lockfiles: [ref("Cargo.lock"), ref("package-lock.json")],
    },
    validation: {
      base_commit: git,
      check_count: 2,
      groups: {deepwell: true},
      path: "/evidence/validation.json",
      sha256: sha,
    },
    images: {
      identities: {deepwell: `sha256:${"1".repeat(64)}`},
      producer: ref("image-producer.json"),
    },
    ...overrides,
  };
}

test("FINAL_FROZEN receipt shape rejects wrong status, stale source, and malformed fields", () => {
  const valid = validateFinalFrozenReceipt(frozenReceipt(), {source: SOURCE});
  assert.equal(valid.status, "FINAL_FROZEN");
  assert.equal(valid.source.lockfiles.length, 2);
  assert.throws(
    () => validateFinalFrozenReceipt(frozenReceipt({status: "FROZEN"}), {source: SOURCE}),
    /not a FINAL_FROZEN/u,
  );
  assert.throws(
    () => validateFinalFrozenReceipt(frozenReceipt(), {source: {...SOURCE, wikijump_commit: "f".repeat(40)}}),
    /wikijump_commit does not match the expected source/u,
  );
  assert.throws(
    () => validateFinalFrozenReceipt(frozenReceipt({images: {identities: {}, producer: {path: "/evidence/image-producer.json", sha256: "a".repeat(64)}}}), {source: SOURCE}),
    /no identities/u,
  );
  assert.throws(
    () => validateFinalFrozenReceipt(frozenReceipt({extra: true}), {source: SOURCE}),
    /missing or unknown fields/u,
  );
  assert.throws(
    () => validateFinalFrozenReceipt(frozenReceipt({source: {...frozenReceipt().source, wikijump_commit: "xyz"}}), {source: SOURCE}),
    /full lowercase Git object id/u,
  );
  assert.throws(
    () => validateFinalFrozenReceipt(frozenReceipt({source: {...frozenReceipt().source, lockfiles: []}}), {source: SOURCE}),
    /one or more file references/u,
  );
  assert.throws(
    () =>
      validateFinalFrozenReceipt(
        frozenReceipt({source: {...frozenReceipt().source, lockfiles: [{path: "/evidence/Cargo.lock", sha256: "a".repeat(64)}, {path: "/evidence/Cargo.lock", sha256: "b".repeat(64)}]}}),
        {source: SOURCE},
      ),
    /duplicate file references/u,
  );
  assert.throws(
    () => validateFinalFrozenReceipt(frozenReceipt({validation: {...frozenReceipt().validation, path: "relative/validation.json"}}), {source: SOURCE}),
    /must be absolute/u,
  );
});

test("FINAL_FROZEN image producer rejects failure, bad identities, and emptiness", () => {
  assert.deepEqual(Object.keys(validateImageProducer(imageProducer(), SOURCE)), ["deepwell", "framerail", "wws"]);
  assert.throws(
    () => validateImageProducer({...imageProducer(), status: "fail"}, SOURCE),
    /passing receipt/u,
  );
  assert.throws(
    () => validateImageProducer({...imageProducer(), images: {deepwell: {id: "not-an-image-id"}}}, SOURCE),
    /no immutable image ID for deepwell/u,
  );
  assert.throws(
    () => validateImageProducer({...imageProducer(), images: {}}, SOURCE),
    /must contain image identities/u,
  );
});

test("FINAL_FROZEN consolidated shape rejects wrong schema and empty groups", () => {
  assert.throws(
    () => validateConsolidatedValidation(validation({schema: "wikijump.consolidated_validation_receipt.v1"}), SOURCE),
    /unsupported schema/u,
  );
  assert.throws(
    () => validateConsolidatedValidation(validation({groups: {}}), SOURCE),
    /selected no check groups/u,
  );
});

test("FINAL_FROZEN CLI takes only executed-evidence inputs", () => {
  const args = parseFinalFrozenArgs([
    "--source-root", "/repo",
    "--validation-receipt", "/evidence/validation.json",
    "--image-producer", "/evidence/image-producer.json",
    "--output", "/evidence/final-frozen.json",
  ]);
  assert.equal(args["validation-receipt"], "/evidence/validation.json");
  assert.throws(() => parseFinalFrozenArgs(["--attestation", "zero-findings-reviewed"]), /unknown or duplicate option/u);
});

test("FINAL_FROZEN binds a passing validation and the sealed images of one source", async (t) => {
  const {root, write} = await fixture(t);
  const receipt = await buildFinalFrozenReceipt({
    source: SOURCE,
    sourceRoot: root,
    validationReceiptPath: await write("validation.json", validation()),
    imageProducerPath: await write("image-producer.json", imageProducer()),
  });
  assert.equal(receipt.status, "FINAL_FROZEN");
  assert.equal(receipt.validation.check_count, 2);
  assert.equal(receipt.source.lockfiles.length, LOCKFILES.length);
  const receiptPath = await write("final-frozen.json", receipt);
  const verified = await verifyFinalFrozenReceipt({receiptPath, source: SOURCE});
  assert.deepEqual(Object.keys(verified.receipt.images.identities), ["deepwell", "framerail", "wws"]);
});

test("FINAL_FROZEN refuses validation that failed, ran nothing, or is for another source", async (t) => {
  const {root, write} = await fixture(t);
  const producer = await write("image-producer.json", imageProducer());
  const build = async (value) => buildFinalFrozenReceipt({
    source: SOURCE,
    sourceRoot: root,
    validationReceiptPath: await write(`validation-${Math.random()}.json`, value),
    imageProducerPath: producer,
  });
  await assert.rejects(
    build(validation({status: "fail", checks: [{name: "deepwell full tests", status: "failed"}]})),
    /did not pass: deepwell full tests/u,
  );
  await assert.rejects(build(validation({checks: []})), /ran no checks/u);
  await assert.rejects(build(validation({wikijump_commit: "f".repeat(40)})), /source identity is stale/u);
  await assert.rejects(build(validation({mode: "checkpoint"})), /final barrier/u);
});

test("FINAL_FROZEN verification rejects summaries disagreeing with their files", async (t) => {
  const {root, write} = await fixture(t);
  const receipt = await buildFinalFrozenReceipt({
    source: SOURCE,
    sourceRoot: root,
    validationReceiptPath: await write("validation.json", validation()),
    imageProducerPath: await write("image-producer.json", imageProducer()),
  });
  await verifyFinalFrozenReceipt({receiptPath: await write("final-frozen.json", receipt), source: SOURCE});
  await assert.rejects(
    verifyFinalFrozenReceipt({
      receiptPath: await write("tampered-validation.json", {
        ...receipt,
        validation: {...receipt.validation, base_commit: "9".repeat(40)},
      }),
      source: SOURCE,
    }),
    /validation summary disagrees with its receipt/u,
  );
  await assert.rejects(
    verifyFinalFrozenReceipt({
      receiptPath: await write("tampered-images.json", {
        ...receipt,
        images: {...receipt.images, identities: {deepwell: `sha256:${"9".repeat(64)}`}},
      }),
      source: SOURCE,
    }),
    /image identities are stale/u,
  );
});

test("FINAL_FROZEN verification rejects a receipt file that is not UTF-8 JSON", async (t) => {
  const {root} = await fixture(t);
  const receiptPath = path.join(root, "evidence", "binary.json");
  await fs.mkdir(path.dirname(receiptPath), {recursive: true});
  await fs.writeFile(receiptPath, Buffer.from([0xff, 0xfe, 0x00]));
  await assert.rejects(
    verifyFinalFrozenReceipt({receiptPath, source: SOURCE}),
    /must contain valid UTF-8 JSON/u,
  );
});

test("FINAL_FROZEN verification rejects changed validation bytes and foreign images", async (t) => {
  const {root, write} = await fixture(t);
  const validationPath = await write("validation.json", validation());
  const receipt = await buildFinalFrozenReceipt({
    source: SOURCE,
    sourceRoot: root,
    validationReceiptPath: validationPath,
    imageProducerPath: await write("image-producer.json", imageProducer()),
  });
  const receiptPath = await write("final-frozen.json", receipt);
  await fs.writeFile(validationPath, JSON.stringify(validation({base_commit: "9".repeat(40)})));
  await assert.rejects(verifyFinalFrozenReceipt({receiptPath, source: SOURCE}), /validation is stale/u);

  await assert.rejects(
    buildFinalFrozenReceipt({
      source: SOURCE,
      sourceRoot: root,
      validationReceiptPath: await write("validation-2.json", validation()),
      imageProducerPath: await write("foreign.json", imageProducer({...SOURCE, wikijump_tree: "0".repeat(40)})),
    }),
    /wikijump_tree does not match the frozen source/u,
  );
});

test("an inconclusive preflight check is recorded and still blocks a frozen final receipt", () => {
  const parsed = parsePreflightOutput([
    "preflight: groups: theme_lab=true ",
    "=== Theme Lab adaptation authority",
    "--- Theme Lab adaptation authority: ok (3s)",
    "=== Theme Lab current campaign completion",
    "--- Theme Lab current campaign completion: INCONCLUSIVE (1s)",
    "preflight: INCONCLUSIVE (no evidence to judge; not a pass): Theme Lab current campaign completion",
    "preflight: all selected checks passed",
  ].join("\n"));
  assert.deepEqual(parsed.checks, [
    {name: "Theme Lab adaptation authority", status: "ok", duration_seconds: 3},
    {name: "Theme Lab current campaign completion", status: "inconclusive", duration_seconds: 1},
  ]);
  assert.throws(
    () => validateConsolidatedValidation(validation({checks: parsed.checks, status: "pass"}), SOURCE),
    /did not pass: Theme Lab current campaign completion/u,
  );
});

test("preflight output yields selected groups and every check result", () => {
  const parsed = parsePreflightOutput([
    "preflight: groups: deepwell=true wws=false verification=true ",
    "=== deepwell fmt",
    "--- deepwell fmt: ok",
    "=== deepwell clippy",
    "--- deepwell clippy: ok (41s)",
    "=== deepwell full tests",
    "--- deepwell full tests: FAILED (312s)",
    "preflight: FAILED: deepwell full tests",
  ].join("\n"));
  assert.deepEqual(parsed.groups, {deepwell: true, wws: false, verification: true});
  assert.deepEqual(parsed.checks, [
    {name: "deepwell fmt", status: "ok"},
    {name: "deepwell clippy", status: "ok", duration_seconds: 41},
    {name: "deepwell full tests", status: "failed", duration_seconds: 312},
  ]);
  assert.throws(
    () => validateConsolidatedValidation(validation({checks: parsed.checks, status: "fail"}), SOURCE),
    /did not pass: deepwell full tests/u,
  );
});
