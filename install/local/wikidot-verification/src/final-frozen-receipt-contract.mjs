import path from "node:path";

import {
  isPlainObject,
  readStableRegularFile,
  requireNonEmptyString,
  requirePlainObject,
  requireSha256,
} from "./standing-browser-parity-util.mjs";

export const FINAL_FROZEN_RECEIPT_SCHEMA =
  "wikijump.phase4.final_frozen_receipt.v1";

const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/u;
const SOURCE_WRITER_ROSTER_SCHEMA =
  "wikijump.phase4.source_writer_roster.v1";
const REF_KEYS = ["path", "sha256"];
const MANIFEST_KEYS = [
  "denominator",
  "fixtures",
  "images",
  "lockfiles",
  "tools",
  "verifier",
];
const RECEIPT_KEYS = [
  "denominator",
  "fixtures",
  "images",
  "inputs",
  "schema",
  "source",
  "source_writers",
  "status",
  "tools",
  "verifier",
];

function exactKeys(value, expected, name) {
  if (
    JSON.stringify(Object.keys(value).sort()) !==
    JSON.stringify([...expected].sort())
  ) {
    throw new Error(`${name} has missing or unknown fields`);
  }
}

function gitObject(value, name) {
  if (!GIT_OBJECT.test(value ?? "")) {
    throw new Error(`${name} must be a full lowercase Git object id`);
  }
  return value;
}

function reference(value, name) {
  const ref = requirePlainObject(value, name);
  exactKeys(ref, REF_KEYS, name);
  const filePath = requireNonEmptyString(ref.path, `${name}.path`);
  if (!path.isAbsolute(filePath)) {
    throw new Error(`${name}.path must be absolute`);
  }
  return Object.freeze({
    path: filePath,
    sha256: requireSha256(ref.sha256, `${name}.sha256`),
  });
}

function references(value, name) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${name} must contain one or more file references`);
  }
  const result = value.map((entry, index) =>
    reference(entry, `${name}[${index}]`),
  );
  if (new Set(result.map((entry) => entry.path)).size !== result.length) {
    throw new Error(`${name} contains duplicate file references`);
  }
  return Object.freeze(result);
}

export function validateFinalFrozenInputManifest(value) {
  const manifest = requirePlainObject(value, "final frozen input manifest");
  exactKeys(manifest, MANIFEST_KEYS, "final frozen input manifest");
  for (const key of MANIFEST_KEYS) {
    if (key === "images") {
      if (typeof manifest[key] !== "string" || manifest[key] === "") {
        throw new Error(
          "final frozen input manifest images must name a producer output",
        );
      }
      continue;
    }
    if (
      !Array.isArray(manifest[key]) ||
      manifest[key].length === 0 ||
      manifest[key].some(
        (entry) => typeof entry !== "string" || entry === "",
      )
    ) {
      throw new Error(
        `final frozen input manifest ${key} must contain file paths`,
      );
    }
  }
  return manifest;
}

export function validateImageProducer(value, source) {
  const producer = requirePlainObject(value, "image producer output");
  exactKeys(
    producer,
    ["ftml_sha", "images", "status", "wikijump_sha", "wikijump_tree"],
    "image producer output",
  );
  if (producer.status !== "pass" || !isPlainObject(producer.images)) {
    throw new Error(
      "image producer output must be a passing receipt with an images object",
    );
  }
  for (const [producerKey, sourceKey] of [
    ["wikijump_sha", "wikijump_commit"],
    ["wikijump_tree", "wikijump_tree"],
    ["ftml_sha", "ftml_sha"],
  ]) {
    if (producer[producerKey] !== source[sourceKey]) {
      throw new Error(
        `image producer output ${producerKey} does not match the frozen source`,
      );
    }
  }
  const identities = Object.entries(producer.images).map(([role, image]) => {
    const id = typeof image === "string" ? image : image?.id;
    if (
      !/^[a-z][a-z0-9_-]*$/u.test(role) ||
      !IMAGE_ID.test(id ?? "")
    ) {
      throw new Error(
        `image producer output has no immutable image ID for ${role}`,
      );
    }
    return [role, id];
  });
  if (identities.length === 0) {
    throw new Error("image producer output must contain image identities");
  }
  return Object.freeze(Object.fromEntries(identities.sort()));
}

export function validateSourceWriterRoster(value, source) {
  const roster = requirePlainObject(value, "source writer roster");
  exactKeys(
    roster,
    ["lanes", "schema", "status", "wikijump_commit", "wikijump_tree"],
    "source writer roster",
  );
  if (
    roster.schema !== SOURCE_WRITER_ROSTER_SCHEMA ||
    roster.status !== "pass"
  ) {
    throw new Error("source writer roster is not a passing receipt");
  }
  if (
    roster.wikijump_commit !== source.wikijump_commit ||
    roster.wikijump_tree !== source.wikijump_tree
  ) {
    throw new Error("source writer roster source identity is stale");
  }
  if (!Array.isArray(roster.lanes) || roster.lanes.length === 0) {
    throw new Error("source writer roster must list every lane");
  }
  const names = new Set();
  for (const [index, lane] of roster.lanes.entries()) {
    const entry = requirePlainObject(lane, `source writer roster lane ${index}`);
    exactKeys(entry, ["name", "state"], `source writer roster lane ${index}`);
    const name = requireNonEmptyString(
      entry.name,
      `source writer roster lane ${index}.name`,
    );
    if (names.has(name)) {
      throw new Error("source writer roster has duplicate lanes");
    }
    names.add(name);
    if (entry.state !== "stopped") {
      throw new Error(`source writer roster lane ${name} is not stopped`);
    }
  }
  return Object.freeze({
    schema: SOURCE_WRITER_ROSTER_SCHEMA,
    status: "pass",
    wikijump_commit: source.wikijump_commit,
    wikijump_tree: source.wikijump_tree,
    lanes: Object.freeze(
      roster.lanes.map((lane) =>
        Object.freeze({name: lane.name, state: "stopped"}),
      ),
    ),
  });
}

export function validateFinalFrozenReceipt(value, {source = null} = {}) {
  const receipt = requirePlainObject(value, "final frozen receipt");
  exactKeys(receipt, RECEIPT_KEYS, "final frozen receipt");
  if (
    receipt.schema !== FINAL_FROZEN_RECEIPT_SCHEMA ||
    receipt.status !== "FINAL_FROZEN"
  ) {
    throw new Error("final frozen receipt is not a FINAL_FROZEN receipt");
  }
  const frozenSource = requirePlainObject(
    receipt.source,
    "final frozen source",
  );
  exactKeys(
    frozenSource,
    ["ftml_sha", "lockfiles", "wikijump_commit", "wikijump_tree"],
    "final frozen source",
  );
  const sourceIdentity = {
    wikijump_commit: gitObject(
      frozenSource.wikijump_commit,
      "final frozen Wikijump commit",
    ),
    wikijump_tree: gitObject(
      frozenSource.wikijump_tree,
      "final frozen Wikijump tree",
    ),
    ftml_sha: gitObject(frozenSource.ftml_sha, "final frozen FTML commit"),
  };
  if (source !== null) {
    for (const key of Object.keys(sourceIdentity)) {
      if (sourceIdentity[key] !== source[key]) {
        throw new Error(`final frozen source ${key} does not match the candidate`);
      }
    }
  }

  const verifier = requirePlainObject(receipt.verifier, "final frozen verifier");
  exactKeys(
    verifier,
    ["files", "wikijump_commit", "wikijump_tree"],
    "final frozen verifier",
  );
  if (
    verifier.wikijump_commit !== sourceIdentity.wikijump_commit ||
    verifier.wikijump_tree !== sourceIdentity.wikijump_tree
  ) {
    throw new Error("final frozen verifier source identity is stale");
  }
  const inputs = requirePlainObject(receipt.inputs, "final frozen inputs");
  exactKeys(inputs, ["manifest", "source_writers"], "final frozen inputs");
  const images = requirePlainObject(receipt.images, "final frozen images");
  exactKeys(images, ["identities", "producer"], "final frozen images");
  if (!Array.isArray(receipt.source_writers) || receipt.source_writers.length) {
    throw new Error("FINAL_FROZEN receipt has active source writers");
  }

  return Object.freeze({
    schema: FINAL_FROZEN_RECEIPT_SCHEMA,
    status: "FINAL_FROZEN",
    source: Object.freeze({
      ...sourceIdentity,
      lockfiles: references(frozenSource.lockfiles, "final frozen source.lockfiles"),
    }),
    verifier: Object.freeze({
      wikijump_commit: sourceIdentity.wikijump_commit,
      wikijump_tree: sourceIdentity.wikijump_tree,
      files: references(verifier.files, "final frozen verifier.files"),
    }),
    fixtures: references(receipt.fixtures, "final frozen fixtures"),
    tools: references(receipt.tools, "final frozen tools"),
    denominator: references(receipt.denominator, "final frozen denominator"),
    images: Object.freeze({
      producer: reference(images.producer, "final frozen images.producer"),
      identities: Object.freeze(
        Object.fromEntries(
          Object.entries(
            requirePlainObject(
              images.identities,
              "final frozen image identities",
            ),
          )
            .map(([role, id]) => {
              if (!/^[a-z][a-z0-9_-]*$/u.test(role) || !IMAGE_ID.test(id ?? "")) {
                throw new Error(`final frozen image identity is invalid for ${role}`);
              }
              return [role, id];
            })
            .sort(([left], [right]) => left.localeCompare(right)),
        ),
      ),
    }),
    inputs: Object.freeze({
      manifest: reference(inputs.manifest, "final frozen inputs.manifest"),
      source_writers: reference(
        inputs.source_writers,
        "final frozen inputs.source_writers",
      ),
    }),
    source_writers: Object.freeze([]),
  });
}

function parseJson(bytes, name) {
  try {
    return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
  } catch (error) {
    throw new Error(`${name} must contain valid UTF-8 JSON`, {cause: error});
  }
}

async function verifyReference(ref, name) {
  const file = await readStableRegularFile(ref.path, name);
  if (file.sha256 !== ref.sha256) {
    throw new Error(`${name} is stale`);
  }
  return file;
}

export async function verifyFinalFrozenReceipt({receiptPath, source}) {
  const receiptFile = await readStableRegularFile(
    receiptPath,
    "final frozen receipt",
  );
  const receipt = validateFinalFrozenReceipt(
    parseJson(receiptFile.bytes, "final frozen receipt"),
    {source},
  );
  const manifestFile = await verifyReference(
    receipt.inputs.manifest,
    "final frozen input manifest",
  );
  validateFinalFrozenInputManifest(
    parseJson(manifestFile.bytes, "final frozen input manifest"),
  );
  const writerFile = await verifyReference(
    receipt.inputs.source_writers,
    "final frozen source writer registry",
  );
  validateSourceWriterRoster(
    parseJson(writerFile.bytes, "final frozen source writer registry"),
    receipt.source,
  );

  await Promise.all([
    ...receipt.source.lockfiles.map((entry) =>
      verifyReference(entry, "final frozen lockfile"),
    ),
    ...receipt.verifier.files.map((entry) =>
      verifyReference(entry, "final frozen verifier"),
    ),
    ...receipt.fixtures.map((entry) =>
      verifyReference(entry, "final frozen fixture"),
    ),
    ...receipt.tools.map((entry) => verifyReference(entry, "final frozen tool")),
    ...receipt.denominator.map((entry) =>
      verifyReference(entry, "final frozen denominator"),
    ),
  ]);

  const imageProducerFile = await verifyReference(
    receipt.images.producer,
    "final frozen image producer",
  );
  const identities = validateImageProducer(
    parseJson(imageProducerFile.bytes, "final frozen image producer"),
    receipt.source,
  );
  if (JSON.stringify(identities) !== JSON.stringify(receipt.images.identities)) {
    throw new Error("final frozen image identities are stale");
  }
  return Object.freeze({
    path: path.resolve(receiptPath),
    sha256: receiptFile.sha256,
    receipt,
  });
}
