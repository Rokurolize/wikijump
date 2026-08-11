import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const fixtureUrl = new URL("../fixtures/data-form-date-pagepath/cases.json", import.meta.url);
const artifactUrl = new URL("../artifacts/data-form-date-pagepath-live-20260810.json", import.meta.url);

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

test("date and pagepath artifact records the complete live lifecycle and cleanup", async () => {
  const fixture = await readJson(fixtureUrl);
  const artifact = await readJson(artifactUrl);

  assert.equal(artifact.schema, "wikidot.live.data-form.date-pagepath.v1");
  assert.equal(artifact.site, fixture.site);
  assert.equal(artifact.run_id, fixture.run_id);
  assert.deepEqual(artifact.surface_ids, fixture.surface_ids);
  assert.match(artifact.observed_at, /^2026-08-10T/);
  assert.equal(artifact.environment.locale, "en");
  assert.equal(artifact.environment.capture_timezone, "Asia/Tokyo");
  assert.equal(artifact.environment.storage_interpretation, "Direct public Ajax saves stored the submitted date scalar verbatim and pagepath values as submitted page fullnames");

  assert.deepEqual(artifact.fixture.identities.requested, fixture.fixture);
  assert.equal(artifact.fixture.cleanup.template_restored_or_deleted, true);
  assert.equal(artifact.fixture.cleanup.all_run_owned_pages_absent, true);
  assert.deepEqual(artifact.fixture.cleanup.remaining_pages, []);

  assert.deepEqual(artifact.cases.map(({case_id}) => case_id), fixture.cases.map(({case_id}) => case_id));
  for (const captured of artifact.cases) {
    const declared = fixture.cases.find(({case_id}) => case_id === captured.case_id);
    assert.ok(declared);
    assert.equal(captured.surface_id, declared.surface_id);
    assert.equal(captured.control, declared.control);
    assert.equal(captured.submitted, declared.submitted);
    assert.equal(captured.lifecycle.create_or_validation_captured, true);
    assert.equal(captured.lifecycle.saved_source_captured, true);
    assert.equal(captured.lifecycle.stored_representation_captured, true);
    assert.equal(captured.lifecycle.display_captured, true);
    assert.equal(captured.lifecycle.edit_captured, true);
    assert.equal(captured.lifecycle.reload_captured, true);
    assert.equal(typeof captured.result.validation_status, "string");
    assert.ok(Array.isArray(captured.result.create_field_values));
    assert.match(captured.result.create_form_sha256, /^[0-9a-f]{64}$/);
    assert.equal(typeof captured.result.saved_source, "string");
    assert.ok(Object.hasOwn(captured.result, "stored_representation"));
    assert.equal(typeof captured.result.display, "string");
    assert.ok(Object.hasOwn(captured.result, "edit_value"));
    assert.ok(Object.hasOwn(captured.result, "reload_value"));
  }

  const dateCases = artifact.cases.filter(({surface_id}) => surface_id === "data-forms-date-field");
  assert.equal(dateCases.filter(({control}) => control === "positive").length, 2);
  assert.equal(dateCases.filter(({control}) => control === "boundary").length, 2);
  assert.equal(dateCases.filter(({control}) => control === "positive").every(({submitted, result}) => result.validation_status === "accepted" && result.stored_representation === submitted), true);
  assert.equal(dateCases.every(({submitted, result}) => result.display.includes(submitted) && result.edit_value === submitted && result.reload_value === submitted), true);
  assert.equal(dateCases.filter(({control}) => control === "boundary").every(({submitted, result}) => ["accepted", "rejected"].includes(result.validation_status) && (result.validation_status === "accepted" ? result.stored_representation === submitted : result.stored_representation === null)), true);

  const pagepathCases = artifact.cases.filter(({surface_id}) => surface_id.startsWith("data-forms-pagepath"));
  assert.equal(pagepathCases.filter(({control}) => control === "positive").length, 2);
  assert.equal(pagepathCases.filter(({control}) => control === "negative").length, 2);
  assert.equal(pagepathCases.filter(({control}) => control === "positive").every(({result}) => result.validation_status === "accepted" && result.stored_representation === result.submitted_fullname), true);
  assert.deepEqual(pagepathCases.filter(({control}) => control === "positive").map(({result}) => result.display.trim().split(/\s+/).at(-1)), ["alpha", "beta"]);
  assert.equal(pagepathCases.filter(({control}) => control === "negative").every(({result}) => ["accepted", "rejected"].includes(result.validation_status) && (result.validation_status === "accepted" ? typeof result.stored_representation === "string" && result.stored_representation.length > 0 : result.stored_representation === null)), true);
});
