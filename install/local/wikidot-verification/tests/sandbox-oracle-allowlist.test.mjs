import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {
  ALLOWED_SITE_SLUGS,
  DEFAULT_SITE_SLUG,
  ORACLE_RUN_OWNED_SLUG_PREFIX,
  oracleRunOwnedSlug,
  validateSiteSlug,
  validateTargetOrigin,
} from "../src/theme-localization-e2e.mjs";
import {SANDBOX_ORACLE_REGISTRY_SCHEMA} from "../src/sandbox-oracle.mjs";
import {SANDBOX_ORACLE_LOCAL_ORIGINS} from "../src/sandbox-oracle-browser-policy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HELPER_PATH = path.resolve(HERE, "../scripts/wikidot_theme_page_helper.py");

function registry() {
  return {
    schema: SANDBOX_ORACLE_REGISTRY_SCHEMA,
    fixtures: [{
      fixture_id: "syntax:basic",
      construct_family: "inline-formatting",
      guards: ["ftml-266"],
      owner: "FTML",
      assertion_class: "match-live",
      theme_family: null,
      provenance: {datestamp: "sandbox-oracle-20260805", content_sha256: "a".repeat(64)},
    }],
  };
}

test("site allowlist is frozen, shared, and constructs origins from the validated slug", () => {
  assert.deepEqual([...ALLOWED_SITE_SLUGS].sort(), ["sandbox-for-codex", DEFAULT_SITE_SLUG].sort());
  assert.equal(validateSiteSlug("sandbox-for-codex"), "sandbox-for-codex");
  assert.equal(validateTargetOrigin("http://sandbox-for-codex.wikidot.com", "wikidot", "sandbox-for-codex"), "http://sandbox-for-codex.wikidot.com");
  assert.equal(validateTargetOrigin("https://sandbox-for-codex.wikijump.localhost", "wikijump", "sandbox-for-codex"), "https://sandbox-for-codex.wikijump.localhost");
  assert.throws(() => validateTargetOrigin("https://scpaiueouiuiuiui.wikidot.com", "wikidot", "sandbox-for-codex"), /hard allowlist/);
  assert.throws(() => validateTargetOrigin("not a URL", "wikidot", "not-allowlisted"), /not allowlisted/);
});

test("sandbox oracle admits only the page and reserved SCP file origins locally", () => {
  assert.deepEqual(SANDBOX_ORACLE_LOCAL_ORIGINS, [
    "https://sandbox-for-codex.wikijump.localhost",
    "https://scp-wiki.wjfiles.localhost",
    "https://scp-jp.wjfiles.localhost"
  ]);
  assert(!SANDBOX_ORACLE_LOCAL_ORIGINS.some((origin) => origin.includes("*")));
});

test("oracle fixture slugs are registry-bound and use a distinct run-owned namespace", () => {
  assert.equal(oracleRunOwnedSlug("20260805-allowlist", "syntax:basic", registry()), `${ORACLE_RUN_OWNED_SLUG_PREFIX}20260805-allowlist-syntax:basic`);
  assert.throws(() => oracleRunOwnedSlug("20260805-allowlist", "syntax:missing", registry()), /not in the registry/);
  assert.throws(() => oracleRunOwnedSlug("20260805-allowlist", "syntax:basic", {
    ...registry(),
    fixtures: [{...registry().fixtures[0], fixture_id: "syntax/basic"}],
  }), /unsupported characters/);
});

test("Python helper enumerates the same mutation-site allowlist", async () => {
  const program = String.raw`
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("theme_helper", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(json.dumps(sorted(module.ALLOWED_SITE_SLUGS)))
print(module.site_origin("sandbox-for-codex"))
print(module.site_origin(module.DEFAULT_SITE_SLUG))
try: module.site_origin("scp-wiki")
except module.PublicError as error: print(error.code)
print(module.validate_oracle_slug("codex-oracle:20260805-allowlist-syntax:basic"))
try: module.validate_oracle_slug("codex-l10n:20260805-allowlist-syntax:basic")
except module.PublicError as error: print(error.code)
`;
  const result = spawnSync("python3", ["-c", program, HELPER_PATH], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  const [sites, oracleOrigin, defaultOrigin, rejected, oracleSlug, oracleRejected] = result.stdout.trim().split("\n");
  assert.deepEqual(JSON.parse(sites), [...ALLOWED_SITE_SLUGS].sort());
  assert.equal(oracleOrigin, "http://sandbox-for-codex.wikidot.com");
  assert.equal(defaultOrigin, `http://${DEFAULT_SITE_SLUG}.wikidot.com`);
  assert.equal(rejected, "site_not_allowed");
  assert.equal(oracleSlug, "codex-oracle:20260805-allowlist-syntax:basic");
  assert.equal(oracleRejected, "resource_not_allowed");
});
