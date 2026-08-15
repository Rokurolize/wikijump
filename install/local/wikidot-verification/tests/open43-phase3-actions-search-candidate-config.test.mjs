import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const configUrl = new URL("../fixtures/open43-phase3-actions-search-candidate.json", import.meta.url);

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

test("Phase 3 candidate configuration is complete and duplicate-free", async () => {
  const config = await readJson(configUrl);
  assert.equal(config.schema, "wikijump.open43.phase3_actions_search_handoff.v1");
  assert.equal(config.status, "handoff_only");
  assert.deepEqual(Object.keys(config).sort(), ["case_ids", "schema", "status"].sort());
  assert.equal(new Set(config.case_ids).size, config.case_ids.length, "duplicate candidate case ID");
  assert.equal(config.case_ids.length, 28);
  assert.equal(config.case_ids.some((caseId) => /RATE_LIMIT/u.test(caseId)), false, "speculative rate-limit case entered the shared denominator");
  assert.ok(config.case_ids.every((caseId) => /^[A-Z][A-Z0-9_]+$/u.test(caseId)), "handoff case IDs must be stable identifiers");
});
