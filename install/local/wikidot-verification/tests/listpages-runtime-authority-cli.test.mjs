import assert from "node:assert/strict";
import test from "node:test";

import {
  parseArgs,
} from "../scripts/capture-listpages-runtime-authority.mjs";

test("runtime authority capture CLI requires every process and service locator", () => {
  const parsed = parseArgs([
    "node",
    "capture-listpages-runtime-authority.mjs",
    "--pid",
    "1234",
    "--runtime-config",
    "runtime.toml",
    "--build-manifest",
    "manifest.json",
    "--rpc-url",
    "http://127.0.0.1:12747/jsonrpc",
    "--site",
    "sandbox-for-codex",
    "--cache-container",
    "cache",
    "--database-container",
    "database",
    "--files-container",
    "files",
    "--output-identity",
    "identity.json",
    "--output-proof",
    "proof.json",
  ]);
  assert.equal(parsed.pid, 1234);
  assert.match(parsed.runtimeConfig, /runtime\.toml$/u);
  assert.match(parsed.buildManifest, /manifest\.json$/u);

  assert.throws(
    () => parseArgs([
      "node",
      "capture-listpages-runtime-authority.mjs",
      "--pid",
      "1234",
    ]),
    /--runtime-config is required/,
  );
});
