import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const cases = JSON.parse(await readFile(new URL("fixtures/data-form-scalar-fields/cases.json", root), "utf8"));
const artifact = JSON.parse(await readFile(new URL("artifacts/data-form-hidden-password-static-url-live-20260810.json", root), "utf8"));

test("scalar field artifact is complete, independent, and secret-free", () => {
  assert.equal(artifact.schema, "wikidot.live.data-form.scalar-fields.v1");
  assert.equal(artifact.site, cases.site);
  assert.equal(artifact.credential_material, "none");
  assert.deepEqual(artifact.surface_ids, cases.field_runs.map((run) => run.surface_id));
  assert.equal(artifact.field_runs.length, 4);
  assert.equal(artifact.cleanup.verified, true);
  assert.deepEqual(artifact.cleanup.remaining_pages, []);
  assert.doesNotMatch(JSON.stringify(artifact), /(?:WIKIDOT_(?:SESSION_ID|PASSWORD)|wikidot_token7)=/i);
});

test("hidden generated forms declare no control, fragment, or form field", () => {
  const hidden = artifact.field_runs.find((run) => run.field === "hidden");
  assert.ok(hidden, "missing hidden run");
  for (const phase of [hidden.create, hidden.edit, hidden.reload]) {
    assert.equal(phase.control.tag, null);
    assert.equal(phase.form_fields, "");
    assert.equal(phase.field_fragment, null);
  }
});

for (const expectedRun of cases.field_runs) {
  test(`${expectedRun.field} has two positive and two negative live controls`, () => {
    const actual = artifact.field_runs.find((run) => run.field === expectedRun.field);
    assert.ok(actual, `missing ${expectedRun.field} run`);
    assert.equal(actual.surface_id, expectedRun.surface_id);
    assert.equal(actual.status, "observed");
    assert.equal(actual.template_source, expectedRun.template_source);
    assert.deepEqual(actual.controls.map(({case_id, polarity}) => ({case_id, polarity})), expectedRun.controls);
    assert.equal(actual.controls.filter(({polarity}) => polarity === "positive").length, 2);
    assert.equal(actual.controls.filter(({polarity}) => polarity === "negative").length, 2);
    assert.ok(actual.controls.every(({passed}) => passed === true));
  });

  test(`${expectedRun.field} records create, storage, display, edit, reload, and cleanup`, () => {
    const actual = artifact.field_runs.find((run) => run.field === expectedRun.field);
    assert.deepEqual(actual.submitted_values, {
      create: expectedRun.create_submission,
      edit: expectedRun.edit_submission,
    });
    assert.equal(actual.create.control.tag, expectedRun.expected.create_control_tag);
    assert.equal(actual.create.control.type, expectedRun.expected.create_control_type);
    assert.equal(actual.create.saved_source, expectedRun.expected.create_source);
    assert.equal(actual.create.display.text, expectedRun.expected.create_display_text);
    assert.equal(actual.edit.control.value, expectedRun.expected.edit_control_value);
    assert.equal(actual.edit.saved_source, expectedRun.expected.edit_source);
    assert.equal(actual.edit.display.text, expectedRun.expected.edit_display_text);
    assert.equal(actual.reload.saved_source, expectedRun.expected.edit_source);
    assert.equal(actual.reload.display.text, expectedRun.expected.edit_display_text);
    assert.equal(actual.cleanup.target_deleted, true);
    assert.equal(actual.cleanup.template_deleted, true);
    assert.equal(actual.cleanup.absence_verified, true);
  });
}
