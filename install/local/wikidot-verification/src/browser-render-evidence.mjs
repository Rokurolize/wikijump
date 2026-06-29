import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function safePathSegment(value) {
  const original = String(value);
  const hash = crypto.createHash("sha256").update(original).digest("hex").slice(0, 12);
  const prefix = original
    .replace(/[^A-Za-z0-9._:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 140) || "row";
  return `${prefix}-${hash}`;
}

export function compactVisibleText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export function inventoryRows(inventory) {
  if (!isObject(inventory) || inventory.schema !== "wikijump_full_parity.corpus_inventory_lock.v1") {
    throw new Error("inventory must use schema wikijump_full_parity.corpus_inventory_lock.v1");
  }
  if (!Array.isArray(inventory.rows)) {
    throw new Error("inventory.rows must be an array");
  }
  return inventory.rows.filter(isObject);
}

export function rowsForShard({rows, shardManifest, shardId}) {
  if (!isObject(shardManifest) || shardManifest.schema !== "wikijump_full_parity.corpus_shard_manifest.v1") {
    throw new Error("shard manifest must use schema wikijump_full_parity.corpus_shard_manifest.v1");
  }
  const shard = (shardManifest.shards ?? []).find((item) => item?.shard_id === shardId);
  if (!shard) {
    throw new Error(`shard not found: ${shardId}`);
  }
  const wanted = new Set(shard.fixture_ids ?? []);
  return rows.filter((row) => wanted.has(row.fixture_id));
}

export function selectInventoryRows({rows, fixtureIds = [], shardManifest = null, shardId = null, limit = null}) {
  let selected = rows;

  if (fixtureIds.length > 0) {
    const wanted = new Set(fixtureIds);
    selected = selected.filter((row) => wanted.has(row.fixture_id));
  }

  if (shardId) {
    if (!shardManifest) {
      throw new Error("--shard-id requires --shard-manifest");
    }
    const shardRows = rowsForShard({rows, shardManifest, shardId});
    const shardSet = new Set(shardRows.map((row) => row.fixture_id));
    selected = selected.filter((row) => shardSet.has(row.fixture_id));
  }

  if (limit !== null) {
    selected = selected.slice(0, limit);
  }

  return selected;
}

export function rowSourceUrl(row) {
  return firstNonEmptyString(row.source_url, row.live_url, row.wikidot_url);
}

export function rowLocalUrl(row, localUrlField = "local_https_url") {
  return firstNonEmptyString(row[localUrlField], row.local_https_url, row.local_http_url, row.local_url);
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return "";
}

export function buildEvidenceRecord({row, source, local, sourceArtifact, localArtifact, sourceScreenshot, localScreenshot, localUrlField}) {
  const fixtureId = row.fixture_id;
  if (!fixtureId) {
    throw new Error("inventory row is missing fixture_id");
  }

  return {
    schema: "wikijump_full_parity.browser_rendering_record.v1",
    evidence_type: "browser_rendering",
    fixture_id: fixtureId,
    family: row.family ?? null,
    slug: row.slug ?? null,
    source_url: rowSourceUrl(row),
    local_url: rowLocalUrl(row, localUrlField),
    source_browser_artifact: sourceArtifact,
    local_browser_artifact: localArtifact,
    source_screenshot_artifact: sourceScreenshot ?? null,
    local_screenshot_artifact: localScreenshot ?? null,
    source_visible_text: compactVisibleText(source?.visibleText),
    local_visible_text: compactVisibleText(local?.visibleText),
    source_status: source?.status ?? null,
    local_status: local?.status ?? null,
    source_final_url: source?.finalUrl ?? null,
    local_final_url: local?.finalUrl ?? null,
    source_console_errors: source?.consoleErrors ?? [],
    local_console_errors: local?.consoleErrors ?? [],
    source_failed_requests: source?.failedRequests ?? [],
    local_failed_requests: local?.failedRequests ?? [],
    capture_errors: [
      ...(source?.error ? [{side: "source", message: source.error}] : []),
      ...(local?.error ? [{side: "local", message: local.error}] : []),
    ],
  };
}

export async function writeEvidenceArtifacts({outputDir, row, source, local, screenshot}) {
  const rowDir = path.join(outputDir, safePathSegment(row.fixture_id));
  await fs.mkdir(rowDir, {recursive: true});

  const sourceDom = path.join(rowDir, "live.dom.html");
  const localDom = path.join(rowDir, "local.dom.html");
  await fs.writeFile(sourceDom, source?.html ?? "", "utf8");
  await fs.writeFile(localDom, local?.html ?? "", "utf8");

  return {
    sourceArtifact: sourceDom,
    localArtifact: localDom,
    sourceScreenshot: screenshot ? path.join(rowDir, "live.png") : null,
    localScreenshot: screenshot ? path.join(rowDir, "local.png") : null,
  };
}
