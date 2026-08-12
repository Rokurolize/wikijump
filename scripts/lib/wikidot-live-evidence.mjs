export function resolveWikidotLiveEvidenceFormat(evidence) {
  const format =
    evidence.format ?? (evidence.path.endsWith(".jsonl") ? "jsonl" : "json");
  if (format === "json" || format === "jsonl") {
    return format;
  }
  throw new Error(`Unsupported Wikidot live evidence format: ${format}`);
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
