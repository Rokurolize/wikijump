import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const referenceUrl = new URL(
  "../artifacts/listpages-unquoted-comparison-discriminators-live.jsonl",
  import.meta.url,
);

async function readReferences() {
  return (await readFile(referenceUrl, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

test("impossible unquoted ListPages comparisons are inert on live Wikidot", async () => {
  const references = await readReferences();

  assert.deepEqual(
    references.map(({ syntax_case: syntaxCase }) => syntaxCase.case_id),
    [
      "lp-unquoted-discriminator-rating",
      "lp-unquoted-discriminator-score-alias",
      "lp-unquoted-discriminator-votes",
      "lp-unquoted-discriminator-created-at",
      "lp-unquoted-discriminator-createdat-alias",
      "lp-unquoted-discriminator-date-alias",
    ],
  );

  for (const reference of references) {
    assert.equal(reference.schema, "wikijump_syntax_differential.wikidot_reference.v1");
    assert.equal(reference.provenance.authenticated, false);
    assert.equal(reference.provenance.mutated, false);
    assert.equal(reference.provenance.module, "edit/PagePreviewModule");
    assert.equal(reference.provenance.site, "scp-wiki");
    assert.equal(
      reference.raw_html.replace(/\s+/gu, " ").trim(),
      "<p>ROW=scp-002</p>",
    );
    assert.equal(
      reference.raw_html_sha256,
      "9fcef75fd8b8de4492f9c5ac7d754b7c52b7d05faf00bda8fd8c1432a3a6fc2d",
    );
  }

  assert.equal(
    new Set(references.map(({ raw_html_sha256: sha256 }) => sha256)).size,
    1,
  );
});
