import fs from "node:fs/promises";
import path from "node:path";

import {extractDeclaredPublicTests} from "../../../../scripts/lib/wikidot-implementation-ledger.mjs";

export const OFFLINE_SURFACE_COVERAGE_SCHEMA =
  "wikijump.offline_compatibility_surface_coverage.v1";
export const FINAL_ZERO_SURFACE_COUNT = 900;
export const CAMPAIGN_ONLY_MIGRATED_COUNT = 100;

const SHA256_RE = /^[0-9a-f]{64}$/u;
const SURFACE_ID_RE = /^surface:\d{8}$/u;
const LANES = new Set(["products", "verification"]);
const DIRECT_ANCHOR_RE =
  /^(deepwell\/(?:src|tests)\/[^:#\s]+|wws\/(?:src|tests)\/[^:#\s]+|framerail\/tests\/[^:#\s]+|install\/local\/wikidot-verification\/tests\/[^:#\s]+)/u;
const DEEPWELL_RUNNER_RE =
  /^node (install\/local\/wikidot-verification\/scripts\/run-deepwell-integration-validation\.mjs)\b/u;
const CARGO_TEST_RE = /^(?:DATABASE_URL=\S+ )?cargo test\b/u;
const NODE_TEST_RE = /^node --test\b/u;
const SCRIPT_ANCHOR_RE = /^(scripts\/[^\s]+)/u;
const PUBLIC_TEST_FILE_ROOTS = [
  "deepwell/tests/",
  "framerail/tests/",
  "install/local/wikidot-verification/tests/",
  "install/standing/tests/",
  "wws/tests/",
];

function isSupportedPublicTestFile(relativePath) {
  if (/\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u.test(relativePath)) return true;
  return (
    relativePath.endsWith(".rs") &&
    PUBLIC_TEST_FILE_ROOTS.some((root) => relativePath.startsWith(root))
  );
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function strings(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value;
}

function sha256(value, label) {
  if (typeof value !== "string" || !SHA256_RE.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256`);
  }
  return value;
}

// An anchor is a coverage ownership claim. Commands name a runnable test entry
// point, plain paths name a runnable test target, and `<path>#<name>` /
// `<path>::<name>` additionally name the test (or evidence case) inside it.
function parseCoverageAnchor(anchor) {
  if (typeof anchor !== "string" || anchor.length === 0) return null;
  const runner = anchor.match(DEEPWELL_RUNNER_RE);
  if (runner) return {kind: "command", files: [runner[1]], fragment: null};
  if (CARGO_TEST_RE.test(anchor) || NODE_TEST_RE.test(anchor)) {
    const files = [];
    const nodeTest = anchor.match(/^node --test\s+(.+)$/u);
    if (nodeTest) {
      for (const file of nodeTest[1].split(/\s+/u)) {
        if (file.length > 0) files.push(file);
      }
    }
    const manifest = anchor.match(/--manifest-path\s+(\S+)/u);
    if (manifest) files.push(manifest[1]);
    else if (CARGO_TEST_RE.test(anchor)) files.push("deepwell/Cargo.toml");
    if (files.length === 0) return null;
    return {kind: "command", files, fragment: null};
  }
  const direct = anchor.match(DIRECT_ANCHOR_RE);
  if (!direct) {
    const script = anchor.match(SCRIPT_ANCHOR_RE);
    return script ? {kind: "file", files: [script[1]], fragment: null} : null;
  }
  const file = direct[1];
  const rest = anchor.slice(file.length);
  if (rest.length === 0) return {kind: "file", files: [file], fragment: null};
  if (rest.startsWith("#")) {
    return {kind: "named", files: [file], fragment: rest.slice(1)};
  }
  if (rest.startsWith("::")) {
    return {kind: "named", files: [file], fragment: rest.slice(2)};
  }
  return null;
}

export function anchorFilePath(anchor) {
  return parseCoverageAnchor(anchor)?.files[0] ?? null;
}

// Test anchors in the fixture use several repository conventions: a bare test
// name, a `tests::` module path, a `fn name()` wrapper, and `test::case`
// labels. Normalize all of them to the candidate test names they reference.
function declaredTestNames(fragment) {
  if (typeof fragment !== "string") return [];
  const text = fragment
    .trim()
    .replace(/^(?:pub\s+)?(?:async\s+)?fn\s+/u, "")
    .replace(/\(\)$/u, "");
  const names = [];
  for (const part of text.split(";")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    for (const segment of trimmed.split("::")) {
      const name = segment.trim();
      if (name.length > 0) names.push(name);
    }
  }
  return [...new Set(names)];
}

async function readSource(repositoryRoot, relativePath, cache) {
  if (cache.has(relativePath)) return cache.get(relativePath);
  const pending = fs
    .readFile(path.resolve(repositoryRoot, relativePath), "utf8")
    .catch(() => null);
  cache.set(relativePath, pending);
  return pending;
}

// `cargo test --test page` runs declarations that live in `page/*.rs`
// submodules, so a `page.rs#name` anchor must resolve against the whole module
// tree. The parsing itself is owned by the shared implementation ledger.
async function collectRustModuleTests(repositoryRoot, directory, target, sourceCache) {
  const absolute = path.resolve(repositoryRoot, directory);
  const relativeBack = path.relative(repositoryRoot, absolute);
  if (relativeBack.startsWith("..") || path.isAbsolute(relativeBack)) return;
  const entries = await fs.readdir(absolute, {withFileTypes: true}).catch(() => []);
  for (const entry of entries) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isFile() && entry.name.endsWith(".rs")) {
      const source = await readSource(repositoryRoot, relative, sourceCache);
      if (source === null) continue;
      const declared = extractDeclaredPublicTests(relative, source);
      if (declared !== null) for (const name of declared) target.add(name);
    } else if (entry.isDirectory()) {
      await collectRustModuleTests(repositoryRoot, relative, target, sourceCache);
    }
  }
}

async function declaredTestsFor(repositoryRoot, relativePath, cache) {
  if (cache.has(relativePath)) return cache.get(relativePath);
  const pending = (async () => {
    const source = await readSource(repositoryRoot, relativePath, cache.sourceCache);
    if (source === null) return null;
    const declared = extractDeclaredPublicTests(relativePath, source);
    if (declared === null) return null;
    const all = new Set(declared);
    if (relativePath.endsWith(".rs")) {
      const moduleDirectory = relativePath.endsWith("/mod.rs")
        ? path.posix.dirname(relativePath)
        : relativePath.slice(0, -3);
      await collectRustModuleTests(
        repositoryRoot,
        moduleDirectory,
        all,
        cache.sourceCache,
      );
    }
    return all;
  })();
  cache.set(relativePath, pending);
  return pending;
}

function createDeclaredTestCache() {
  const cache = new Map();
  cache.sourceCache = new Map();
  return cache;
}

export function validateOfflineSurfaceCoverage(value) {
  const fixture = object(value, "offline surface coverage");
  if (fixture.schema !== OFFLINE_SURFACE_COVERAGE_SCHEMA) {
    throw new Error(
      `offline surface coverage must use ${OFFLINE_SURFACE_COVERAGE_SCHEMA}`,
    );
  }
  if (fixture.status !== "portable") {
    throw new Error("offline surface coverage must be portable");
  }
  const finalZero = object(fixture.final_zero, "final_zero");
  sha256(finalZero.receipt_sha256, "final_zero.receipt_sha256");
  sha256(finalZero.denominator_sha256, "final_zero.denominator_sha256");
  sha256(
    finalZero.reconciled_ledger_sha256,
    "final_zero.reconciled_ledger_sha256",
  );
  if (finalZero.surface_count !== FINAL_ZERO_SURFACE_COUNT) {
    throw new Error(`final-zero surface count must remain ${FINAL_ZERO_SURFACE_COUNT}`);
  }
  const counts = object(fixture.counts, "counts");
  if (counts.total !== FINAL_ZERO_SURFACE_COUNT) {
    throw new Error(`coverage total must remain ${FINAL_ZERO_SURFACE_COUNT}`);
  }
  if (counts.campaign_only_migrated !== CAMPAIGN_ONLY_MIGRATED_COUNT) {
    throw new Error(
      `campaign-only migrated count must remain ${CAMPAIGN_ONLY_MIGRATED_COUNT}`,
    );
  }
  if (!Array.isArray(fixture.rows) || fixture.rows.length !== FINAL_ZERO_SURFACE_COUNT) {
    throw new Error(`coverage must contain exactly ${FINAL_ZERO_SURFACE_COUNT} rows`);
  }
  const seen = new Set();
  let campaignOnly = 0;
  for (const [index, rowValue] of fixture.rows.entries()) {
    const row = object(rowValue, `rows[${index}]`);
    if (typeof row.surface_id !== "string" || !SURFACE_ID_RE.test(row.surface_id)) {
      throw new Error(`rows[${index}].surface_id is invalid`);
    }
    if (seen.has(row.surface_id)) {
      throw new Error(`duplicate offline surface coverage: ${row.surface_id}`);
    }
    seen.add(row.surface_id);
    const lanes = strings(row.offline_lanes, `rows[${index}].offline_lanes`);
    if (lanes.length === 0 || lanes.some((lane) => !LANES.has(lane))) {
      throw new Error(`rows[${index}] has an unsupported offline lane`);
    }
    const anchors = strings(row.anchors, `rows[${index}].anchors`);
    if (anchors.length === 0) {
      throw new Error(`rows[${index}] has no offline executable anchor`);
    }
    if (
      anchors.some(
        (anchor) =>
          anchor.includes("/home/roku/") ||
          anchor.includes("wikidot.com") ||
          anchor.includes("wdfiles.com"),
      )
    ) {
      throw new Error(`rows[${index}] retains a host or live-Wikidot dependency`);
    }
    if (row.migrated_from_campaign_only === true) campaignOnly += 1;
  }
  if (campaignOnly !== CAMPAIGN_ONLY_MIGRATED_COUNT) {
    throw new Error("campaign-only migrated row count disagrees with the fixture summary");
  }
  return fixture;
}

export async function loadOfflineSurfaceCoverage(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  if (raw.includes("/home/roku/") || raw.includes("/home/roku/wjlab")) {
    throw new Error("portable coverage fixture contains a host-specific absolute path");
  }
  return validateOfflineSurfaceCoverage(JSON.parse(raw));
}

// Resolve every coverage row to at least one executable owner. Commands and
// plain paths are owners when their files exist. A named anchor is an owner
// only when its name is a declared runnable test (including Rust submodules);
// non-test/evidence files additionally accept an exact source-anchor match.
// Named anchors that resolve to none of these are reported, and a row is
// rejected when no anchor owns it.
export async function verifyCoverageAnchorFiles(fixture, repositoryRoot) {
  const missing = [];
  const unresolvedNamedTests = [];
  const rowsWithoutExecutableOwner = [];
  const checked = new Set();
  const cache = createDeclaredTestCache();

  for (const [index, row] of fixture.rows.entries()) {
    let owned = false;
    for (const anchor of row.anchors ?? []) {
      const target = parseCoverageAnchor(anchor);
      if (!target) continue;
      let filesOk = true;
      for (const relative of target.files) {
        const absolute = path.resolve(repositoryRoot, relative);
        const relativeBack = path.relative(repositoryRoot, absolute);
        if (relativeBack.startsWith("..") || path.isAbsolute(relativeBack)) {
          missing.push({anchor, reason: "outside-repository"});
          filesOk = false;
          continue;
        }
        checked.add(relative);
        const stat = await fs.lstat(absolute).catch(() => null);
        if (!stat?.isFile() || stat.isSymbolicLink()) {
          missing.push({anchor, path: relative, reason: "missing"});
          filesOk = false;
        }
      }
      if (!filesOk) continue;
      if (target.kind !== "named") {
        owned = true;
        continue;
      }

      const relativeFile = target.files[0];
      const declared = await declaredTestsFor(repositoryRoot, relativeFile, cache);
      const names = declaredTestNames(target.fragment);
      if (declared !== null && names.some((name) => declared.has(name))) {
        owned = true;
        continue;
      }
      if (!isSupportedPublicTestFile(relativeFile)) {
        // Source/evidence files keep the fixture's exact source-anchor
        // convention: the anchor names a symbol or evidence case rather than a
        // test declaration, and an uncaptured name must not silently own a row.
        const source = await readSource(
          repositoryRoot,
          relativeFile,
          cache.sourceCache,
        );
        if (
          source !== null &&
          (source.includes(target.fragment) ||
            source.includes(target.fragment.split("::")[0]))
        ) {
          owned = true;
          continue;
        }
      }
      // A supported public test file must declare the named runnable test. A
      // file-level declaration of some other test is not an executable owner.
      unresolvedNamedTests.push({
        anchor,
        path: relativeFile,
        name: target.fragment,
        reason: "not-a-declared-runnable-test",
      });
    }
    if (!owned) {
      rowsWithoutExecutableOwner.push({
        surface_id: row.surface_id ?? null,
        index,
        anchors: [...(row.anchors ?? [])],
      });
    }
  }

  const status =
    missing.length === 0 && rowsWithoutExecutableOwner.length === 0
      ? "pass"
      : "fail";
  return {
    status,
    checked: checked.size,
    missing,
    unresolvedNamedTests,
    rowsWithoutExecutableOwner,
  };
}
