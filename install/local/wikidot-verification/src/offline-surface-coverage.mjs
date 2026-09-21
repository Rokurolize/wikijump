import fs from "node:fs/promises";
import path from "node:path";

export const OFFLINE_SURFACE_COVERAGE_SCHEMA =
  "wikijump.offline_compatibility_surface_coverage.v1";
export const FINAL_ZERO_SURFACE_COUNT = 900;
export const CAMPAIGN_ONLY_MIGRATED_COUNT = 100;

const SHA256_RE = /^[0-9a-f]{64}$/u;
const SURFACE_ID_RE = /^surface:\d{8}$/u;
const LANES = new Set(["products", "verification"]);

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

export function anchorFilePath(anchor) {
  if (typeof anchor !== "string" || anchor.length === 0) return null;
  const direct = anchor.match(
    /^(deepwell\/(?:src|tests)\/[^:#\s]+|wws\/(?:src|tests)\/[^:#\s]+|framerail\/tests\/[^:#\s]+|install\/local\/wikidot-verification\/tests\/[^:#\s]+)/u,
  );
  if (direct) return direct[1];
  const deepwellRunner = anchor.match(
    /^node install\/local\/wikidot-verification\/scripts\/(run-deepwell-integration-validation\.mjs)/u,
  );
  if (deepwellRunner) {
    return `install/local/wikidot-verification/scripts/${deepwellRunner[1]}`;
  }
  if (/^(?:DATABASE_URL=.* )?cargo test /u.test(anchor)) {
    const manifest = anchor.match(/--manifest-path\s+([^\s]+)/u)?.[1];
    return manifest ?? "deepwell/Cargo.toml";
  }
  const nodeTest = anchor.match(/^node --test\s+([^\s]+)/u)?.[1];
  if (nodeTest) return nodeTest;
  const script = anchor.match(/^(scripts\/[^\s]+)/u)?.[1];
  return script ?? null;
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

export async function verifyCoverageAnchorFiles(fixture, repositoryRoot) {
  const missing = [];
  const checked = new Set();
  for (const row of fixture.rows) {
    for (const anchor of row.anchors) {
      const relative = anchorFilePath(anchor);
      if (!relative || checked.has(relative)) continue;
      checked.add(relative);
      const absolute = path.resolve(repositoryRoot, relative);
      const relativeBack = path.relative(repositoryRoot, absolute);
      if (relativeBack.startsWith("..") || path.isAbsolute(relativeBack)) {
        missing.push({anchor, reason: "outside-repository"});
        continue;
      }
      const stat = await fs.lstat(absolute).catch(() => null);
      if (!stat?.isFile() || stat.isSymbolicLink()) {
        missing.push({anchor, path: relative, reason: "missing"});
      }
    }
  }
  return {status: missing.length === 0 ? "pass" : "fail", checked: checked.size, missing};
}
