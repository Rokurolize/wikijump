import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {dirname, relative} from "node:path";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function resolveWikidotLiveEvidenceFormat(evidence) {
  const format =
    evidence.format ?? (evidence.path.endsWith(".jsonl") ? "jsonl" : "json");
  if (format === "json" || format === "jsonl") {
    return format;
  }
  throw new Error(`Unsupported Wikidot live evidence format: ${format}`);
}

export function verifiedExternalEvidenceCaseIds(evidenceRow) {
  const indices = evidenceRow.external_indices ?? [];
  if (indices.length === 0) {
    return new Set();
  }

  const sums = evidenceRow.external_sha256s;
  if (!sums?.path || !sums?.sha256) {
    throw new Error("External evidence indices require a SHA256SUMS binding");
  }
  const sumsBytes = readFileSync(sums.path);
  if (sha256(sumsBytes) !== sums.sha256) {
    throw new Error(`External SHA256SUMS hash drifted: ${sums.path}`);
  }
  const expected = new Map();
  for (const line of sumsBytes.toString("utf8").split(/\r?\n/u)) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/u);
    if (match) {
      expected.set(match[2], match[1]);
    }
  }

  const caseIds = new Set();
  for (const index of indices) {
    if (!index?.path || !index.sha256) {
      throw new Error("External evidence index is missing its binding");
    }
    const indexBytes = readFileSync(index.path);
    if (sha256(indexBytes) !== index.sha256) {
      throw new Error(`External evidence index hash drifted: ${index.path}`);
    }
    const relativeIndexPath = relative(dirname(sums.path), index.path);
    if (expected.get(relativeIndexPath) !== index.sha256) {
      throw new Error(`External evidence index is not in SHA256SUMS: ${index.path}`);
    }
    const indexData = JSON.parse(indexBytes);
    if (!Array.isArray(indexData.entries)) {
      throw new Error(`External evidence index has no entries: ${index.path}`);
    }
    if (index.cases !== undefined &&
        (!Number.isInteger(index.cases) || index.cases !== indexData.entries.length)) {
      throw new Error(`External evidence index count drifted: ${index.path}`);
    }
    for (const entry of indexData.entries) {
      if (!entry?.case_id || !entry.path || !entry.sha256) {
        throw new Error(`External evidence entry is incomplete: ${index.path}`);
      }
      if (caseIds.has(entry.case_id)) {
        throw new Error(`Duplicate external evidence case: ${entry.case_id}`);
      }
      const rawBytes = readFileSync(entry.path);
      if (sha256(rawBytes) !== entry.sha256) {
        throw new Error(`External evidence raw hash drifted: ${entry.path}`);
      }
      if (JSON.parse(rawBytes).case_id !== entry.case_id) {
        throw new Error(`External evidence case ID drifted: ${entry.path}`);
      }
      const relativeRawPath = relative(dirname(sums.path), entry.path);
      if (expected.get(relativeRawPath) !== entry.sha256) {
        throw new Error(`External evidence raw is not in SHA256SUMS: ${entry.path}`);
      }
      caseIds.add(entry.case_id);
    }
  }
  return caseIds;
}

export function parseWikidotLiveEvidenceRows(rawEvidence, format = "json") {
  if (format === "json") {
    return [JSON.parse(rawEvidence)];
  }
  if (format === "jsonl") {
    return rawEvidence
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  throw new Error(`Unsupported Wikidot live evidence format: ${format}`);
}
