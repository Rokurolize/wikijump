import assert from "node:assert/strict";
import test from "node:test";

import {
  buildListPagesRuntimeBudgetEnvelope,
} from "../src/listpages-runtime-budget-envelope.mjs";

test("derives reproducible ListPages runtime envelopes from invocation records", () => {
  const records = [
    {
      id: "en:one:L1:B0",
      branch: "en",
      page_fullname: "one",
      byte_start: 0,
      byte_end: 100,
      body: "x".repeat(60),
      attributes: [
        { name: "perPage", value: "250" },
        { name: "limit", value: "10" },
      ],
    },
    {
      id: "en:one:L2:B100",
      branch: "en",
      page_fullname: "one",
      byte_start: 100,
      byte_end: 140,
      body: "y".repeat(30),
      attributes: [],
    },
    {
      id: "jp:two:L1:B0",
      branch: "jp",
      page_fullname: "two",
      byte_start: 0,
      byte_end: 120,
      body: "z".repeat(80),
      attributes: [{ name: "limit", value: "250" }],
    },
  ];

  const envelope = buildListPagesRuntimeBudgetEnvelope(records, {
    inventoryPath: "inventory.jsonl",
    inventorySha256: "abc123",
    inventoryGeneratedAt: "2026-07-30T00:00:00.000Z",
  });

  assert.equal(envelope.source.invocation_count, 3);
  assert.equal(envelope.source.page_count, 2);
  assert.deepEqual(envelope.measurements.max_modules_per_page, {
    value: 2,
    branch: "en",
    page_fullname: "one",
  });
  assert.deepEqual(envelope.measurements.max_aggregate_module_span_bytes_per_page, {
    value: 140,
    branch: "en",
    page_fullname: "one",
  });
  assert.deepEqual(envelope.measurements.max_aggregate_template_body_bytes_per_page, {
    value: 90,
    branch: "en",
    page_fullname: "one",
  });
  assert.deepEqual(envelope.measurements.max_template_body_bytes, {
    value: 80,
    invocation_id: "jp:two:L1:B0",
    branch: "jp",
    page_fullname: "two",
  });
  assert.deepEqual(envelope.measurements.max_estimated_first_page_template_bytes, {
    value: 1_600,
    invocation_id: "jp:two:L1:B0",
    branch: "jp",
    page_fullname: "two",
    template_body_bytes: 80,
    estimated_rows: 20,
  });
  assert.equal(
    envelope.method.first_page_estimate,
    "template_body_bytes * min(valid numeric perPage or 20, valid numeric limit or infinity, 250)",
  );
  assert.equal(envelope.implementation_bounds.all_measurements_fit, true);
});
