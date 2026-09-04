import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const artifact = JSON.parse(
  await readFile(
    new URL("artifacts/issue1391-data-form-ui-era-live-20260905.json", root),
    "utf8",
  ),
);

const forbiddenMaterial = /(?:WIKIDOT_(?:USERNAME|PASSWORD|EMAIL|SESSION_ID)|wikidot_token7|lock[_-]?(?:id|secret)|set-cookie|cookie\s*:|password\s*:|@[a-z0-9.-]+\.[a-z]{2,})/i;

test("issue 1391 artifact is observed, redacted, and cleanup-complete", () => {
  assert.equal(artifact.schema, "wikijump.issue1391.data_form_ui_era_live.v1");
  assert.equal(artifact.issue, 1391);
  assert.equal(artifact.site, "sandbox-for-codex");
  assert.equal(artifact.status, "observed");
  assert.equal(artifact.blocked, null);
  assert.equal(artifact.cleanup.verified, true);
  assert.deepEqual(artifact.cleanup.remaining_run_owned_objects, []);
  const evidenceWithoutRedactionLabels = structuredClone(artifact);
  delete evidenceWithoutRedactionLabels.redactions;
  assert.doesNotMatch(JSON.stringify(evidenceWithoutRedactionLabels), forbiddenMaterial);
});

test("same template identity crosses form edit, removal, and restoration", () => {
  const {lifecycle} = artifact;
  assert.equal(lifecycle.template_a.page_id, lifecycle.after_form_removal.template_page_id);
  assert.equal(lifecycle.template_a.page_id, lifecycle.template_c.page_id);
  assert.equal(lifecycle.after_form_removal.same_template_identity, true);
  assert.equal(lifecycle.template_c.same_identity_as_a, true);

  assert.equal(lifecycle.before_created_with_form_a.browser_create.request["form-use"], "true");
  assert.equal(lifecycle.before_created_with_form_a.browser_create.request["form-fields"], "name");
  assert.equal(lifecycle.after_form_removal.before_edit.data_form, false);
  assert.equal(lifecycle.after_form_removal.before_edit.ordinary_textarea, true);
  assert.equal(lifecycle.formless_created.browser_create.editor.data_form, false);
});

test("restoring the form re-enables current-template behavior for both old page classes", () => {
  const restored = artifact.lifecycle.after_form_recreation_existing_pages;
  assert.equal(restored.before_view_convergence.observation.contains_field_c, true);
  assert.equal(restored.before_edit.data_form, true);
  assert.equal(restored.formless_view_convergence.observation.contains_field_c, true);
  assert.equal(restored.formless_edit.data_form, true);

  const edited = artifact.lifecycle.after_in_place_template_edit.view_convergence;
  assert.ok(edited.attempt >= 1);
  assert.equal(edited.observation.contains_field_b, true);
  const removed = artifact.lifecycle.after_form_removal.before_view_convergence;
  assert.ok(removed.attempt >= 1);
  assert.equal(removed.observation.contains_field_a, false);
  assert.equal(removed.observation.contains_field_b, false);
  assert.equal(removed.observation.contains_field_c, false);
});
