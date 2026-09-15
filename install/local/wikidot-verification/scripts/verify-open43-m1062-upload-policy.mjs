#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  verifyOpen43M1062UploadPolicyArtifact,
  validateOpen43M1062UploadPolicyFixture,
} from "../src/open43-m1062-upload-policy.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`missing ${name}`);
  return fileURLToPath(process.argv[index + 1]);
}

const fixturePath = argument("--fixture");
const artifactPath = argument("--artifact");
const fixtureBytes = await readFile(fixturePath);
const artifactBytes = await readFile(artifactPath);
const producerBytes = await readFile(new URL("capture-open43-m1062-upload-policy.py", import.meta.url));
const fixture = JSON.parse(fixtureBytes);
const artifact = JSON.parse(artifactBytes);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
validateOpen43M1062UploadPolicyFixture(fixture);
const result = verifyOpen43M1062UploadPolicyArtifact(fixture, artifact, {
  fixtureSha256: digest(fixtureBytes),
  producerSha256: digest(producerBytes),
});
process.stdout.write(`${JSON.stringify({ ...result, artifact_sha256: digest(artifactBytes) })}\n`);
