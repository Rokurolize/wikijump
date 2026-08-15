import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {buildFinalFrozenReceipt} from "../scripts/emit-final-frozen-receipt.mjs";
import {verifyFinalFrozenReceipt} from "../src/final-frozen-receipt-contract.mjs";

test("FINAL_FROZEN binds producer identities and stopped source lanes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "final-frozen-root-"));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const write = async (name, value) => {
    const filePath = path.join(root, name);
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, value, "utf8");
    return filePath;
  };
  const source = {
    wikijump_commit: "a".repeat(40),
    wikijump_tree: "b".repeat(40),
    ftml_sha: "c".repeat(40),
  };
  const imageIds = Object.fromEntries(
    ["deepwell", "framerail", "wws"].map((role, index) => [
      role,
      `sha256:${String.fromCharCode(100 + index).repeat(64)}`,
    ]),
  );
  const validImageOutput = () => ({
    status: "pass",
    wikijump_sha: source.wikijump_commit,
    wikijump_tree: source.wikijump_tree,
    ftml_sha: source.ftml_sha,
    images: Object.fromEntries(
      Object.entries(imageIds).map(([role, id]) => [role, {id}]),
    ),
  });
  const imagePath = await write("images.json", JSON.stringify(validImageOutput()));
  const manifestPath = await write(
    "inputs.json",
    JSON.stringify({
      lockfiles: [await write("deepwell/Cargo.lock", "lock")],
      verifier: [await write("verifier.mjs", "verifier")],
      fixtures: [await write("fixture.json", "fixture")],
      tools: [await write("tool.mjs", "tool")],
      denominator: [await write("denominator.json", "denominator")],
      images: imagePath,
    }),
  );
  const writersPath = await write(
    "writers.json",
    JSON.stringify({
      schema: "wikijump.phase4.source_writer_roster.v1",
      status: "pass",
      wikijump_commit: source.wikijump_commit,
      wikijump_tree: source.wikijump_tree,
      lanes: [{name: "phase4", state: "stopped"}],
    }),
  );
  const build = () =>
    buildFinalFrozenReceipt({
      source,
      inputManifestPath: manifestPath,
      sourceWritersPath: writersPath,
      sourceRoot: root,
    });

  const receipt = await build();
  assert.deepEqual(receipt.images.identities, imageIds);
  const receiptPath = await write("receipt.json", JSON.stringify(receipt));
  await verifyFinalFrozenReceipt({receiptPath, source});
  for (const key of ["wikijump_commit", "wikijump_tree", "ftml_sha"]) {
    await assert.rejects(
      verifyFinalFrozenReceipt({
        receiptPath,
        source: {...source, [key]: "f".repeat(40)},
      }),
      new RegExp(`final frozen source ${key}`, "u"),
      key,
    );
  }
  for (const reference of [
    receipt.inputs.manifest,
    receipt.inputs.source_writers,
    receipt.source.lockfiles[0],
    receipt.verifier.files[0],
    receipt.fixtures[0],
    receipt.tools[0],
    receipt.denominator[0],
    receipt.images.producer,
  ]) {
    const original = await fs.readFile(reference.path);
    await fs.writeFile(reference.path, Buffer.concat([original, Buffer.from("drift")]));
    await assert.rejects(
      verifyFinalFrozenReceipt({receiptPath, source}),
      /final frozen .* is stale/u,
    );
    await fs.writeFile(reference.path, original);
  }

  for (const [producerKey, sourceKey] of [
    ["wikijump_sha", "wikijump_commit"],
    ["wikijump_tree", "wikijump_tree"],
    ["ftml_sha", "ftml_sha"],
  ]) {
    const altered = validImageOutput();
    altered[producerKey] = "f".repeat(40);
    await fs.writeFile(imagePath, JSON.stringify(altered));
    await assert.rejects(
      build(),
      new RegExp(`image producer output ${producerKey} does not match`, "u"),
      sourceKey,
    );
  }
  await fs.writeFile(
    imagePath,
    JSON.stringify({...validImageOutput(), unknown: true}),
  );
  await assert.rejects(build(), /image producer output has missing or unknown fields/u);
  for (const role of Object.keys(imageIds)) {
    const altered = validImageOutput();
    altered.images[role].id = `sha256:${"e".repeat(64)}`;
    await fs.writeFile(imagePath, JSON.stringify(altered));
    const rebuilt = await build();
    assert.equal(rebuilt.images.identities[role], altered.images[role].id, role);
  }

  await fs.writeFile(imagePath, JSON.stringify(validImageOutput()));
  for (const key of ["wikijump_commit", "wikijump_tree"]) {
    const altered = {
      schema: "wikijump.phase4.source_writer_roster.v1",
      status: "pass",
      wikijump_commit: source.wikijump_commit,
      wikijump_tree: source.wikijump_tree,
      lanes: [{name: "phase4", state: "stopped"}],
    };
    altered[key] = "f".repeat(40);
    await fs.writeFile(writersPath, JSON.stringify(altered));
    await assert.rejects(build(), /source writer roster source identity is stale/u);
  }
  await fs.writeFile(
    writersPath,
    JSON.stringify({
      schema: "wikijump.phase4.source_writer_roster.v1",
      status: "pass",
      wikijump_commit: source.wikijump_commit,
      wikijump_tree: source.wikijump_tree,
      lanes: [{name: "phase4", state: "active"}],
    }),
  );
  await assert.rejects(build(), /lane phase4 is not stopped/u);

  await fs.writeFile(
    writersPath,
    JSON.stringify({
      schema: "wikijump.phase4.source_writer_roster.v1",
      status: "pass",
      wikijump_commit: source.wikijump_commit,
      wikijump_tree: source.wikijump_tree,
      lanes: [{name: "phase4", state: "stopped"}],
    }),
  );
  const stale = structuredClone(receipt);
  stale.images.identities.deepwell = `sha256:${"0".repeat(64)}`;
  await fs.writeFile(receiptPath, JSON.stringify(stale));
  await assert.rejects(
    verifyFinalFrozenReceipt({receiptPath, source}),
    /final frozen image identities are stale/u,
  );
  await fs.writeFile(receiptPath, JSON.stringify(receipt));
  await fs.writeFile(receiptPath, JSON.stringify({...receipt, unknown: true}));
  await assert.rejects(
    verifyFinalFrozenReceipt({receiptPath, source}),
    /missing or unknown fields/u,
  );
  await fs.writeFile(receiptPath, JSON.stringify(receipt));
  const manifestLink = path.join(root, "manifest-link.json");
  await fs.symlink(receipt.inputs.manifest.path, manifestLink);
  const symlinked = structuredClone(receipt);
  symlinked.inputs.manifest.path = manifestLink;
  await fs.writeFile(receiptPath, JSON.stringify(symlinked));
  await assert.rejects(
    verifyFinalFrozenReceipt({receiptPath, source}),
    /input manifest must be a regular file/u,
  );
});
