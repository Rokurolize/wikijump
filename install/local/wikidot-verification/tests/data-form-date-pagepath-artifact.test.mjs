import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const fixtureUrl = new URL("../fixtures/data-form-date-pagepath/cases.json", import.meta.url);
const artifactUrl = new URL("../artifacts/data-form-date-pagepath-live-20260810.json", import.meta.url);
const pagepathControlFixtureUrl = new URL("../fixtures/data-form-date-pagepath/pagepath-control-20260817.json", import.meta.url);
const pagepathControlArtifactUrl = new URL("../artifacts/data-form-pagepath-control-live-20260817.json", import.meta.url);
const pagepathCreateNewFixtureUrl = new URL("../fixtures/data-form-date-pagepath/pagepath-create-new-20260817.json", import.meta.url);
const pagepathCreateNewArtifactUrl = new URL("../artifacts/data-form-pagepath-create-new-live-20260817.json", import.meta.url);
const pagepathRootBootstrapFixtureUrl = new URL("../fixtures/data-form-date-pagepath/pagepath-root-bootstrap-20260817.json", import.meta.url);
const pagepathRootBootstrapArtifactUrl = new URL("../artifacts/data-form-pagepath-root-bootstrap-live-20260817.json", import.meta.url);
const pagepathBacklinksFixtureUrl = new URL("../fixtures/data-form-date-pagepath/pagepath-backlinks-20260817.json", import.meta.url);
const pagepathBacklinksArtifactUrl = new URL("../artifacts/data-form-pagepath-backlinks-live-20260817.json", import.meta.url);

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

test("pagepath control artifact preserves the live initial tree controls and verbatim stored values", async () => {
  const fixture = await readJson(pagepathControlFixtureUrl);
  const artifact = await readJson(pagepathControlArtifactUrl);

  assert.equal(artifact.schema, "wikidot.live.data-form.pagepath-control.v1");
  assert.match(artifact.observed_at, /^2026-08-17T/);
  assert.equal(artifact.site, fixture.site);
  assert.equal(artifact.run_id, fixture.run_id);
  assert.deepEqual(artifact.surface_ids, fixture.surface_ids);
  assert.deepEqual(artifact.fixture.identities.requested, fixture.fixture);
  assert.equal(artifact.fixture.cleanup.all_run_owned_pages_absent, true);
  assert.deepEqual(artifact.fixture.cleanup.remaining_pages, []);

  assert.deepEqual(artifact.cases.map(({case_id}) => case_id), fixture.cases.map(({case_id}) => case_id));
  const expectedSelectCounts = new Map([
    ["pagepath-existing-first-level", 2],
    ["pagepath-existing-second-level", 3],
    ["pagepath-nonexistent", 1],
    ["pagepath-malformed-cross-category", 1],
  ]);
  for (const captured of artifact.cases) {
    const declared = fixture.cases.find(({case_id}) => case_id === captured.case_id);
    assert.ok(declared);
    assert.equal(captured.surface_id, declared.surface_id);
    assert.equal(captured.control, declared.control);
    assert.equal(captured.submitted, declared.submitted);
    assert.equal(captured.result.validation_status, "accepted");
    assert.equal(captured.result.stored_representation, declared.submitted);
    assert.equal(captured.result.submitted_fullname, declared.submitted);
    assert.equal(captured.result.pagepath_control.edit.value, declared.submitted);
    assert.deepEqual(captured.result.pagepath_control.reload, captured.result.pagepath_control.edit);

    for (const phase of ["create", "edit", "reload"]) {
      const control = captured.result.pagepath_control[phase];
      assert.equal(control.wrapper_class, "form-group");
      assert.equal(control.label_class, "col-sm-2 control-label");
      assert.equal(control.label_text, "Origin");
      const inputs = control.controls.filter(({tag}) => tag === "input");
      assert.deepEqual(inputs.map(({class: className}) => className), [
        "dataform-pagepath-value",
        "dataform-pagepath-category",
        "dataform-pagepath-max-level",
      ]);
      assert.equal(inputs[0].name, "field-origin");
      assert.equal(inputs[0].type, "hidden");
      assert.equal(inputs[1].value, fixture.fixture.tree_category);
      assert.equal(inputs[2].value, "3");
    }

    const rootSelect = captured.result.pagepath_control.create.controls.find(({tag}) => tag === "select");
    assert.ok(rootSelect);
    assert.equal(rootSelect.class, `dataform-pagepath-select-children-of-${fixture.fixture.tree_category}---_root`);
    assert.deepEqual(rootSelect.options, [
      {value: "", text: ""},
      {value: `${fixture.fixture.tree_category}:alpha`, text: "alpha"},
      {value: "+", text: "Create new"},
    ]);
    assert.equal(
      captured.result.pagepath_control.edit.controls.filter(({tag}) => tag === "select").length,
      expectedSelectCounts.get(captured.case_id),
    );
  }

  const positives = artifact.cases.filter(({control}) => control === "positive");
  assert.deepEqual(positives.map(({result}) => result.display.trim().split(/\s+/u).at(-1)), ["alpha", "beta"]);
  for (const negative of artifact.cases.filter(({control}) => control === "negative")) {
    assert.equal(negative.result.display.trim().split(/\s+/u).at(-1), "Origin");
  }

  const serialized = JSON.stringify(artifact);
  for (const forbidden of ["WIKIDOT_SESSION_ID", "WIKIDOT_USERNAME", "WIKIDOT_PASSWORD"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("pagepath Create new mutates the tree before the containing form is saved and survives cancel", async () => {
  const fixture = await readJson(pagepathCreateNewFixtureUrl);
  const artifact = await readJson(pagepathCreateNewArtifactUrl);

  assert.equal(artifact.schema, "wikidot.live.data-form.date-pagepath.v1");
  assert.match(artifact.observed_at, /^2026-08-17T/);
  assert.equal(artifact.site, fixture.site);
  assert.equal(artifact.run_id, fixture.run_id);
  assert.deepEqual(artifact.surface_ids, fixture.surface_ids);
  assert.deepEqual(artifact.fixture.identities.requested, fixture.fixture);
  assert.equal(artifact.fixture.cleanup.all_run_owned_pages_absent, true);
  assert.deepEqual(artifact.fixture.cleanup.remaining_pages, []);
  assert.equal(artifact.cases.length, 1);

  const captured = artifact.cases[0];
  const declared = fixture.cases[0];
  const createNew = captured.result.pagepath_create_new;
  const treeCategory = fixture.fixture.tree_category;
  const alpha = `${treeCategory}:alpha`;
  const beta = `${treeCategory}:beta`;
  const gamma = `${treeCategory}:${fixture.pagepath_create_new.title}`;

  assert.equal(captured.case_id, declared.case_id);
  assert.equal(captured.submitted, alpha);
  assert.equal(captured.result.stored_representation, alpha);
  assert.equal(createNew.expected_fullname, gamma);
  assert.equal(createNew.initial_input_value, "New item");
  assert.equal(createNew.before.chooser_class, "dataform-pagepath-chooser");
  assert.equal(createNew.after_create_new_selection.chooser_class, "dataform-pagepath-chooser");
  assert.deepEqual(
    createNew.after_create_new_selection.controls.slice(-2),
    [
      {tag: "input", class: "text", name: null, type: "text", value: "New item"},
      {tag: "a", class: "", text: "[x]", href: "javascript:;"},
    ],
  );

  assert.deepEqual(
    Object.fromEntries(Object.entries(createNew.request).filter(([key]) => key !== "callbackIndex")),
    {
      action: "DataFormAction",
      event: "newPage",
      category: treeCategory,
      parent: alpha,
      title: fixture.pagepath_create_new.title,
      moduleName: "Empty",
    },
  );
  assert.equal(typeof createNew.request.callbackIndex, "string");
  assert.equal(createNew.response.http_status, 200);
  assert.equal(createNew.response.body.status, "ok");
  assert.equal(createNew.response.body.fullname, gamma);
  assert.equal(Number.isInteger(createNew.response.body.CURRENT_TIMESTAMP), true);
  assert.equal(createNew.response.body.callbackIndex, createNew.request.callbackIndex);
  assert.equal(createNew.created_page_source, "");
  assert.equal(createNew.hidden_value_after_interaction, gamma);
  assert.equal(createNew.saved_page_source_after_interaction, `date_value: ''\norigin: '${alpha}'`);
  assert.deepEqual(createNew.cancel, {
    created_page_still_exists: true,
    created_page_source: "",
    saved_page_source_after_cancel: `date_value: ''\norigin: '${alpha}'`,
  });

  const alphaSelector = createNew.after_enter.controls.find(
    ({tag, class: className}) => tag === "select" && className.endsWith("---alpha"),
  );
  const gammaSelector = createNew.after_enter.controls.find(
    ({tag, class: className}) => tag === "select" && className.endsWith("---gamma"),
  );
  assert.ok(alphaSelector);
  assert.deepEqual(alphaSelector.options, [
    {value: "", text: "", selected: false},
    {value: beta, text: "beta", selected: false},
    {value: gamma, text: "gamma", selected: true},
    {value: "+", text: "Create new", selected: false},
  ]);
  assert.ok(gammaSelector);
  assert.deepEqual(gammaSelector.options, [
    {value: "", text: "", selected: true},
    {value: "+", text: "Create new", selected: false},
  ]);

  const serialized = JSON.stringify(artifact);
  for (const forbidden of ["WIKIDOT_SESSION_ID", "WIKIDOT_USERNAME", "WIKIDOT_PASSWORD", "lock_secret", "wikidot_token7"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("pagepath first root child creates the empty _root through the empty-parent DataFormAction", async () => {
  const fixture = await readJson(pagepathRootBootstrapFixtureUrl);
  const artifact = await readJson(pagepathRootBootstrapArtifactUrl);

  assert.equal(artifact.schema, "wikidot.live.data-form.date-pagepath.v1");
  assert.match(artifact.observed_at, /^2026-08-17T/);
  assert.equal(artifact.site, fixture.site);
  assert.equal(artifact.run_id, fixture.run_id);
  assert.equal(fixture.setup_tree_pages, false);
  assert.deepEqual(artifact.fixture.identities.requested, fixture.fixture);
  assert.equal(artifact.fixture.cleanup.all_run_owned_pages_absent, true);
  assert.deepEqual(artifact.fixture.cleanup.remaining_pages, []);

  const captured = artifact.cases[0];
  const createNew = captured.result.pagepath_create_new;
  const treeCategory = fixture.fixture.tree_category;
  const root = `${treeCategory}:_root`;
  const alpha = `${treeCategory}:alpha`;
  assert.equal(captured.submitted, "");
  assert.equal(captured.result.stored_representation, "");
  assert.equal(createNew.expected_fullname, alpha);
  assert.equal(createNew.before.controls.filter(({tag}) => tag === "select").length, 1);
  assert.deepEqual(
    Object.fromEntries(Object.entries(createNew.request).filter(([key]) => key !== "callbackIndex")),
    {
      action: "DataFormAction",
      event: "newPage",
      category: treeCategory,
      parent: "",
      title: "alpha",
      moduleName: "Empty",
    },
  );
  assert.equal(createNew.response.body.status, "ok");
  assert.equal(createNew.response.body.fullname, alpha);
  assert.deepEqual(createNew.root_page_after_interaction, {
    fullname: root,
    source: "",
  });
  assert.equal(createNew.created_page_source, "");
  assert.equal(createNew.hidden_value_after_interaction, alpha);
  assert.equal(createNew.saved_page_source_after_interaction, "date_value: ''\norigin: ''");
  assert.deepEqual(createNew.cancel, {
    created_page_still_exists: true,
    created_page_source: "",
    saved_page_source_after_cancel: "date_value: ''\norigin: ''",
  });
  assert.deepEqual(
    createNew.after_enter.controls
      .filter(({tag}) => tag === "select")
      .map(({class: className, options}) => ({className, options})),
    [
      {
        className: `dataform-pagepath-select-children-of-${treeCategory}---_root`,
        options: [
          {value: "", text: "", selected: false},
          {value: alpha, text: "alpha", selected: true},
          {value: "+", text: "Create new", selected: false},
        ],
      },
      {
        className: `dataform-pagepath-select-children-of-${treeCategory}---alpha`,
        options: [
          {value: "", text: "", selected: true},
          {value: "+", text: "Create new", selected: false},
        ],
      },
    ],
  );
});

test("pagepath stored values participate in the normal Wikidot Backlinks relation", async () => {
  const fixture = await readJson(pagepathBacklinksFixtureUrl);
  const artifact = await readJson(pagepathBacklinksArtifactUrl);

  assert.equal(artifact.schema, "wikidot.live.data-form.date-pagepath.v1");
  assert.match(artifact.observed_at, /^2026-08-17T/);
  assert.equal(artifact.site, fixture.site);
  assert.equal(artifact.run_id, fixture.run_id);
  assert.deepEqual(artifact.fixture.identities.requested, fixture.fixture);
  assert.equal(artifact.fixture.cleanup.all_run_owned_pages_absent, true);
  assert.deepEqual(artifact.fixture.cleanup.remaining_pages, []);
  assert.equal(artifact.cases.length, 1);

  const captured = artifact.cases[0];
  const backlink = captured.result.pagepath_backlinks;
  assert.equal(captured.case_id, fixture.pagepath_backlinks.case_id);
  assert.equal(backlink.target_fullname, captured.submitted);
  assert.deepEqual(backlink.before, {
    http_status: 200,
    links: [],
    visible_text: "",
  });
  assert.deepEqual(backlink.after, {
    http_status: 200,
    links: [
      {
        href: `/${fixture.fixture.form_category}:${captured.case_id}`,
        class: "",
        text: captured.case_id,
      },
    ],
    visible_text: captured.case_id,
  });

  const serialized = JSON.stringify(artifact);
  for (const forbidden of ["WIKIDOT_SESSION_ID", "WIKIDOT_USERNAME", "WIKIDOT_PASSWORD", "lock_secret", "wikidot_token7"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
