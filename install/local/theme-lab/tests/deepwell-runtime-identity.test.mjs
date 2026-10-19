import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertDeepwellRuntimeIdentity,
  createDeepwellRuntimeIdentity,
  deepwellRuntimeIdentityFromHeaders,
  deepwellRuntimeIdentityMatchesContract,
  deepwellRuntimeSourceIdentity,
  parseCurlDeepwellRuntimeHeaders,
  requireDeepwellRuntimeIdentity,
} from "../src/deepwell-runtime-identity.mjs";

const identity = createDeepwellRuntimeIdentity({
  source_sha256: "a".repeat(64),
  ftml_git_revision: "b".repeat(40),
  container_id: "c".repeat(64),
  image_id: `sha256:${"d".repeat(64)}`,
  binary_sha256: "e".repeat(64),
  config_sha256: "f".repeat(64),
});
const headers = {
  "X-Theme-Lab-Backend-Source-Sha": identity.source_sha256,
  "X-Theme-Lab-Backend-FTML-Git-Revision": identity.ftml_git_revision,
  "X-Theme-Lab-Backend-Container-Id": identity.container_id,
  "X-Theme-Lab-Backend-Image-Id": identity.image_id,
  "X-Theme-Lab-Backend-Binary-Sha": identity.binary_sha256,
  "X-Theme-Lab-Backend-Config-Sha": identity.config_sha256,
  "X-Theme-Lab-Backend-Identity-Sha": identity.identity_sha256,
};

test("Deepwell response identity binds source, FTML, running image, executable and config", () => {
  assert.equal(
    requireDeepwellRuntimeIdentity(identity).identity_sha256,
    identity.identity_sha256,
  );
  assert.equal(
    deepwellRuntimeIdentityFromHeaders(headers).identity_sha256,
    identity.identity_sha256,
  );
  assert.equal(
    deepwellRuntimeIdentityFromHeaders(new Headers(headers)).identity_sha256,
    identity.identity_sha256,
  );
  const parsed = parseCurlDeepwellRuntimeHeaders(
    `HTTP/2 103\r\n\r\nHTTP/2 200\r\n${Object.entries(headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\r\n")}\r\n\r\n`,
  );
  assert.equal(
    parsed.backendRuntimeIdentity.identity_sha256,
    identity.identity_sha256,
  );
  assert.equal(
    assertDeepwellRuntimeIdentity(identity, parsed.backendRuntimeIdentity)
      .identity_sha256,
    identity.identity_sha256,
  );
  assert.equal(
    deepwellRuntimeIdentityMatchesContract(
      { backend_runtime_identity: identity },
      { expected_backend_runtime_identity: identity },
    ),
    true,
  );
  assert.equal(
    deepwellRuntimeIdentityMatchesContract(
      {
        backend_runtime_identity: {
          ...identity,
          image_id: `sha256:${"9".repeat(64)}`,
        },
      },
      { expected_backend_runtime_identity: identity },
    ),
    false,
  );
  assert.equal(
    deepwellRuntimeIdentityFromHeaders({
      "X-Theme-Lab-Backend-Source-Sha": identity.source_sha256,
    }),
    null,
  );
  assert.throws(
    () => assertDeepwellRuntimeIdentity(identity, null, "fixture"),
    /fixture/u,
  );
  assert.throws(
    () => parseCurlDeepwellRuntimeHeaders("HTTP/2 503\r\n\r\n"),
    /HTTP 503/u,
  );
});

test("Deepwell source identity ignores only generated locale package installs, not actual locale source", (t) => {
  const repo = fs.mkdtempSync(
    path.join(os.tmpdir(), "theme-lab-locale-source-"),
  );
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const locale = path.join(repo, "locales/typed");
  fs.mkdirSync(locale, { recursive: true });
  fs.mkdirSync(path.join(repo, "locales/fluent/en"), { recursive: true });
  fs.mkdirSync(path.join(repo, "deepwell"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "deepwell/Cargo.lock"),
    `[[package]]\nname = "ftml"\nsource = "git+https://example.test/ftml#${"e".repeat(40)}"\n`,
  );
  fs.writeFileSync(
    path.join(locale, "index.ts"),
    'export const ui = "source";\n',
  );
  const source = deepwellRuntimeSourceIdentity(repo);
  const installed = path.join(locale, "node_modules");
  fs.mkdirSync(path.join(installed, ".pnpm/pkg/node_modules"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(installed, ".pnpm/pkg/node_modules/file.js"),
    "installed",
  );
  fs.symlinkSync(
    path.join(installed, ".pnpm/pkg/node_modules"),
    path.join(installed, "pkg"),
  );
  assert.equal(
    deepwellRuntimeSourceIdentity(repo).source_sha256,
    source.source_sha256,
    "pnpm generated install does not change the source identity",
  );
  fs.writeFileSync(
    path.join(installed, ".pnpm/pkg/node_modules/file.js"),
    "updated installed package",
  );
  assert.equal(
    deepwellRuntimeSourceIdentity(repo).source_sha256,
    source.source_sha256,
  );
  fs.mkdirSync(path.join(repo, "locales/validator/target/debug"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(repo, "locales/validator/target/debug/generated"),
    "build output",
  );
  assert.equal(
    deepwellRuntimeSourceIdentity(repo).source_sha256,
    source.source_sha256,
  );
  fs.writeFileSync(
    path.join(locale, "index.ts"),
    'export const ui = "changed source";\n',
  );
  assert.notEqual(
    deepwellRuntimeSourceIdentity(repo).source_sha256,
    source.source_sha256,
    "versioned locale source must still change the runtime identity",
  );
  fs.symlinkSync(
    path.join(locale, "index.ts"),
    path.join(repo, "locales/fluent/en/unsafe.ftl"),
  );
  assert.throws(
    () => deepwellRuntimeSourceIdentity(repo),
    /cannot be a symlink/u,
    "unrecognized or source-language symlinks must still fail closed",
  );
});
