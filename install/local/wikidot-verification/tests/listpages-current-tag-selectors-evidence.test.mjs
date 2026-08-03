import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const artifactUrl = new URL(
  "../artifacts/listpages-current-tag-selectors-live-20260730.json",
  import.meta.url,
);

async function readArtifact() {
  return JSON.parse(await readFile(artifactUrl, "utf8"));
}

function targetSuffixes(caseRecord) {
  return caseRecord.names.map((name) => name.split("-target-").at(-1));
}

test("saved-holder evidence distinguishes current tags from signed literal tags", async () => {
  const artifact = await readArtifact();

  assert.equal(artifact.schema, "wikijump.wikidot_listpages_current_tags.v1");
  assert.equal(artifact.provenance.site, "sandbox-for-codex");
  assert.equal(artifact.provenance.authenticated_mutation, true);
  assert.equal(artifact.provenance.anonymous_saved_page_fetch, true);
  assert.equal(artifact.provenance.run_owned, true);
  assert.deepEqual(artifact.cleanup, {
    attempted: 11,
    deleted: 11,
    errors: [],
    retained: 0,
  });

  for (const holder of artifact.holders) {
    assert.deepEqual(holder.cases.positive_current.names, []);
    assert.deepEqual(holder.cases.positive_exact_current.names, []);
    assert.deepEqual(
      targetSuffixes(holder.cases.negative_current),
      ["alpha", "alpha-beta", "alpha-hidden", "beta", "hidden", "none"],
    );
    assert.deepEqual(
      targetSuffixes(holder.cases.negative_exact_current),
      ["alpha", "alpha-beta", "alpha-hidden", "beta", "hidden", "none"],
    );
  }
});

test("unsigned current selectors use only the holder's visible tags", async () => {
  const artifact = await readArtifact();
  const holders = new Map(artifact.holders.map((holder) => [holder.name, holder]));

  assert.deepEqual(targetSuffixes(holders.get("zero").cases.current), []);
  assert.deepEqual(
    targetSuffixes(holders.get("zero").cases.exact_current),
    ["hidden", "none"],
  );
  assert.deepEqual(
    targetSuffixes(holders.get("one").cases.current),
    ["alpha", "alpha-beta", "alpha-hidden"],
  );
  assert.deepEqual(
    targetSuffixes(holders.get("one").cases.exact_current),
    ["alpha", "alpha-hidden"],
  );
  assert.deepEqual(
    targetSuffixes(holders.get("multiple").cases.current),
    ["alpha", "alpha-beta", "alpha-hidden", "beta"],
  );
  assert.deepEqual(
    targetSuffixes(holders.get("multiple").cases.exact_current),
    ["alpha-beta"],
  );
  assert.deepEqual(
    targetSuffixes(holders.get("hidden-only").cases.exact_current),
    ["hidden", "none"],
  );
  assert.deepEqual(
    targetSuffixes(holders.get("mixed").cases.exact_current),
    ["alpha", "alpha-hidden"],
  );
});
