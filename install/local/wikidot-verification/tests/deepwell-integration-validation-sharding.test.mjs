import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const source = readFileSync(
  path.join(repositoryRoot, "install/local/wikidot-verification/scripts/run-deepwell-integration-validation.mjs"),
  "utf8",
);

test("sharded Deepwell validation compiles test artifacts once before fan-out", () => {
  assert.match(source, /"test", "--offline", "--locked",[\s\S]*--manifest-path", "deepwell\/Cargo.toml",[\s\S]*deepwellTestCompileArgs\(cargoTestArgs\)/u);
  const compileIndex = source.indexOf("deepwellTestCompileArgs(cargoTestArgs)");
  const fanoutIndex = source.indexOf("await runShards(shards");
  assert.ok(compileIndex >= 0, "single compile step is present");
  assert.ok(fanoutIndex > compileIndex, "shard fan-out follows the single compile step");
});
