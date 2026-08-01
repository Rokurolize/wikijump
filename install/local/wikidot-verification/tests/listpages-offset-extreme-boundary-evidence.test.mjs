import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const referenceUrl = new URL(
  "../artifacts/listpages-offset-extreme-boundary-live.jsonl",
  import.meta.url,
);

const MAXIMUM_OBSERVED_EMPTY_OFFSET = 9_223_372_036_855_000_063n;
const MINIMUM_OBSERVED_ERROR_OFFSET = 9_223_372_036_855_000_064n;
const EMPTY_HTML_SHA256 =
  "763d5a40c30ee55b6e41dd6cc1920f5e564ec566b1037d9daa9607e3a1f0b590";
const ERROR_HTML_SHA256 =
  "c82266ad8c5e1faa9a89d15865f3dd78544b8dd61c989cc41a059af77a18c76f";

async function readReferences() {
  return (await readFile(referenceUrl, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function offsetFrom(reference) {
  return BigInt(
    reference.syntax_case.case_id.replace("lp-offset-boundary-", ""),
  );
}

test("live ListPages offset evidence establishes the exact extreme boundary", async () => {
  const references = await readReferences();

  assert.equal(references.length, 78);
  for (const reference of references) {
    assert.equal(reference.schema, "wikijump_syntax_differential.wikidot_reference.v1");
    assert.equal(reference.provenance.authenticated, false);
    assert.equal(reference.provenance.mutated, false);
    assert.equal(reference.provenance.module, "edit/PagePreviewModule");
    assert.equal(reference.provenance.site, "scp-wiki");
  }

  const byOffset = new Map(
    references.map((reference) => [offsetFrom(reference), reference]),
  );
  assert.equal(
    byOffset.get(MAXIMUM_OBSERVED_EMPTY_OFFSET).raw_html_sha256,
    EMPTY_HTML_SHA256,
  );
  assert.equal(
    byOffset.get(MINIMUM_OBSERVED_ERROR_OFFSET).raw_html_sha256,
    ERROR_HTML_SHA256,
  );
  assert.equal(
    MINIMUM_OBSERVED_ERROR_OFFSET - MAXIMUM_OBSERVED_EMPTY_OFFSET,
    1n,
  );
});

test("sampled values on each side keep distinct empty and error dispositions", async () => {
  const references = await readReferences();

  for (const reference of references) {
    const offset = offsetFrom(reference);
    assert.equal(
      reference.raw_html_sha256,
      offset <= MAXIMUM_OBSERVED_EMPTY_OFFSET
        ? EMPTY_HTML_SHA256
        : ERROR_HTML_SHA256,
      reference.syntax_case.case_id,
    );
  }
});
