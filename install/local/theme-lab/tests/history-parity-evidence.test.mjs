import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const evidencePath = path.join(here, "../evidence/wikidot-history-parity-20260929.json");
const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
const responseRoot = path.join(here, "../evidence", evidence.raw_response_directory);
const EXPECTED_COLUMNS = [
  "revision-number",
  "from-to-radios",
  "flags",
  "view-version-source-actions",
  "author",
  "date",
  "comments",
];

test("frozen live Wikidot History evidence binds seven cells on SCP-EN and SCP-JP", () => {
  assert.equal(evidence.schema, "theme_lab_wikidot_history_parity_evidence.v1");
  assert.equal(evidence.actor.authenticated, false);
  assert.equal(evidence.actor.mutations, 0);
  assert.equal(evidence.sites.length, 2);

  for (const site of evidence.sites) {
    assert.deepEqual(site.history_contract.column_order, EXPECTED_COLUMNS, site.label);
    assert.equal(site.history_contract.table_count, 1, site.label);
    assert.deepEqual(site.history_contract.row_parent_tags, ["table"], site.label);
    assert.equal(site.history_contract.revision_rows.length, 10, site.label);
    assert.equal(site.mobile_behavior.status, "not_observable_in_AMC_fragment", site.label);
    assert.deepEqual(site.history_contract.revision_rows[0].radio_names, ["from", "to"], site.label);
    assert.equal(site.history_contract.revision_rows[0].author_selector, ".printuser", site.label);
    assert.equal(site.history_contract.revision_rows[0].date_selector, ".odate", site.label);

    const request = site.acquisition_requests.find((row) => row.request_id.endsWith("-02"));
    const responsePath = path.join(responseRoot, request.response_file);
    const rawBytes = fs.readFileSync(responsePath);
    assert.equal(crypto.createHash("sha256").update(rawBytes).digest("hex"), request.response_sha256);
    const response = JSON.parse(rawBytes.toString("utf8"));
    const rows = [...response.body.matchAll(/<tr\b[^>]*id="revision-row-[^"]+"[^>]*>([\s\S]*?)<\/tr>/gu)];
    assert.equal(rows.length, 10, site.label);
    for (const [, html] of rows) {
      assert.equal([...html.matchAll(/<td\b/gu)].length, 7, site.label);
      assert.match(html, /name="from"/u);
      assert.match(html, /name="to"/u);
      assert.match(html, /class="optionstd"/u);
      assert.match(html, /class="printuser avatarhover"/u);
      assert.match(html, /class="odate time_\d+ format_%25e%20%25b%20%25Y%7Cagohover"/u);
    }
  }

  const [en, jp] = evidence.sites;
  assert.deepEqual(en.history_contract.column_order, jp.history_contract.column_order);
  assert.notDeepEqual(en.history_contract.header_cells, jp.history_contract.header_cells);
  assert.ok(jp.history_contract.revision_rows.some((row) => row.flag_text === "F"));
});
