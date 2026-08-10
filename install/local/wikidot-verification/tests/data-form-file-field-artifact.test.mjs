import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const cases = JSON.parse(await readFile(new URL("fixtures/data-form-file-field/cases.json", root), "utf8"));
const artifact = JSON.parse(await readFile(new URL("artifacts/data-form-file-field-live-20260810.json", root), "utf8"));

const forbiddenMaterial = /(?:WIKIDOT_(?:USERNAME|PASSWORD|EMAIL|SESSION_ID)|wikidot_token7|lock[_-]?(?:id|secret)|csrf|set-cookie|cookie\s*:|password\s*:|@[a-z0-9.-]+\.[a-z]{2,})/i;
const phases = [
  "create_form",
  "create_submission",
  "create_saved_source",
  "create_storage",
  "create_display",
  "edit_form",
  "edit_submission",
  "edit_saved_source",
  "edit_storage",
  "edit_display",
  "reload",
  "cleanup",
];

test("file-field artifact has the exact public evidence identity and no secret material", () => {
  assert.equal(artifact.schema, "wikidot.live.data-form.file-field.v1");
  assert.equal(artifact.site, cases.site);
  assert.deepEqual(artifact.surface_ids, cases.surface_ids);
  assert.equal(artifact.actor_labels.mutation, "account-a");
  assert.equal(artifact.actor_labels.public_read, "anonymous");
  assert.equal(artifact.credentials_exposed, false);
  assert.doesNotMatch(JSON.stringify(artifact), forbiddenMaterial);
  assert.equal(artifact.runs.length, cases.runs.length);
  assert.deepEqual(artifact.runs.map(({run_id}) => run_id), cases.runs.map(({run_id}) => run_id));
});

test("file-field artifact is terminal and records every phase independently", () => {
  assert.ok(["observed", "blocked"].includes(artifact.status));
  for (const run of artifact.runs) {
    for (const phase of phases) {
      assert.ok(Object.hasOwn(run.phases, phase), `${run.run_id} is missing ${phase}`);
      assert.equal(typeof run.phases[phase], "object");
      assert.notEqual(run.phases[phase], null);
    }
  }
  assert.equal(artifact.cleanup.verified, true);
  assert.deepEqual(artifact.cleanup.remaining_run_owned_objects, []);
});

test("observed evidence promotes only rules with two positive and two negative passing controls", () => {
  if (artifact.status === "blocked") {
    assert.deepEqual(artifact.promoted_rules, []);
    assert.equal(typeof artifact.blocked_reason, "string");
    assert.ok(artifact.blocked_reason.length > 0);
    assert.equal(typeof artifact.missing_authority, "string");
    assert.ok(artifact.missing_authority.length > 0);
    assert.equal(typeof artifact.mutation_performed, "boolean");
    assert.ok(Array.isArray(artifact.attempted_public_routes));
    assert.ok(artifact.attempted_public_routes.length > 0);
    return;
  }

  assert.equal(artifact.blocked_reason, null);
  assert.equal(artifact.missing_authority, null);
  assert.equal(artifact.promoted_rules.length, cases.attempted_rules.length);
  for (const expected of cases.attempted_rules) {
    const rule = artifact.promoted_rules.find(({rule_id}) => rule_id === expected.rule_id);
    assert.ok(rule, `missing promoted rule ${expected.rule_id}`);
    assert.deepEqual(rule.positive_case_ids, expected.positive_case_ids);
    assert.deepEqual(rule.negative_case_ids, expected.negative_case_ids);
    assert.equal(rule.positive_case_ids.length, 2);
    assert.equal(rule.negative_case_ids.length, 2);
    assert.ok(rule.controls.every(({passed}) => passed === true));
  }
});

test("observed evidence separates target and storage attachment inventories", () => {
  if (artifact.status === "blocked") return;
  for (const run of artifact.runs) {
    const {create_storage: storage, create_display: display} = run.phases;
    assert.deepEqual(storage.target_page_attachments, []);
    assert.equal(storage.storage_page_attachments.length, 1);
    assert.equal(storage.storage_page_attachments[0].name, run.upload.filename);
    assert.equal(storage.storage_page_attachments[0].byte_length, run.upload.byte_length);
    assert.equal(storage.storage_page_attachments[0].sha256, run.upload.sha256);
    assert.equal(display.link.tag, "a");
    assert.equal(typeof display.link.href, "string");
    assert.equal(typeof display.link.text, "string");
  }
});
