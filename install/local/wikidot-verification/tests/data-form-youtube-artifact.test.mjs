import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";

const artifactPath = new URL(
  "../artifacts/data-form-youtube-live-20260817.json",
  import.meta.url,
);
const casesPath = new URL(
  "../fixtures/data-form-youtube/cases.json",
  import.meta.url,
);

const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const cases = JSON.parse(await readFile(casesPath, "utf8"));

test("data-form YouTube evidence captures create edit reload and cleanup", () => {
  assert.equal(artifact.schema, "wikidot.live.data-form.youtube.v1");
  assert.equal(artifact.status, "observed");
  assert.equal(artifact.site, cases.site);
  assert.equal(artifact.surface_id, cases.surface_id);
  assert.equal(artifact.credentials_exposed, false);
  assert.deepEqual(artifact.remote_media_fetches, []);
  assert.equal(
    artifact.cases_fixture.path,
    "install/local/wikidot-verification/fixtures/data-form-youtube/cases.json",
  );
  assert.equal(artifact.cleanup.target_deleted, true);
  assert.equal(artifact.cleanup.template_deleted, true);
  assert.equal(artifact.cleanup.boundary_pages_deleted, true);
  assert.equal(
    artifact.cleanup.boundary_pages.length,
    cases.html_block_boundary_cases.length,
  );
  assert.ok(artifact.cleanup.boundary_pages.every(({deleted}) => deleted));
  assert.equal(artifact.cleanup.absence_verified, true);
});

test("wiki field editor and storage round-trip the raw embed source", () => {
  const expectedClasses = cases.expected.control_classes;
  assert.equal(artifact.create.editor.control.tag, cases.expected.control_tag);
  for (const className of expectedClasses) {
    assert.ok(artifact.create.editor.control.classes.includes(className));
  }
  assert.equal(artifact.create.editor.control.text, "");
  assert.equal(artifact.edit.editor.control.text, cases.create_submission);
  assert.equal(artifact.reload.editor.control.text, cases.edit_submission);
  assert.equal(
    artifact.create.saved_source,
    `video: '${cases.create_submission}'`,
  );
  assert.equal(
    artifact.edit.saved_source,
    `video: '${cases.edit_submission}'`,
  );
  assert.equal(artifact.reload.saved_source, artifact.edit.saved_source);
});

test("form_raw executes only inside the authored HTML block", () => {
  for (const [phase, submitted, width, height] of [
    [artifact.create, cases.create_submission, "320", "180"],
    [artifact.edit, cases.edit_submission, "640", "360"],
    [artifact.reload, cases.edit_submission, "640", "360"],
  ]) {
    assert.equal(
      phase.display.iframes.length,
      cases.expected.form_raw_inside_html_iframe_count,
    );
    assert.deepEqual(phase.display.iframes[0], {
      src: submitted.match(/src="([^"]+)"/u)[1],
      width,
      height,
    });
    assert.match(phase.display.form_data_control_html, /&lt;iframe/u);
    assert.doesNotMatch(phase.display.form_data_control_html, /<iframe\b/u);
    assert.equal(phase.display.contains_raw_outside_wrapper_literal, false);
    assert.match(
      phase.display.html,
      /<div class="form-raw-outside">\s*<p>&lt;iframe/u,
    );
    assert.equal(cases.expected.form_data_executes_iframe, false);
    assert.equal(cases.expected.form_raw_outside_html_executes_iframe, false);
  }
});

test("saved HTML blocks expose the observed single-empty-iframe boundary", () => {
  assert.equal(
    artifact.html_block_boundary.length,
    cases.html_block_boundary_cases.length,
  );
  for (const expected of cases.html_block_boundary_cases) {
    const observed = artifact.html_block_boundary.find(
      ({name}) => name === expected.name,
    );
    assert.ok(observed, `missing boundary observation ${expected.name}`);
    assert.equal(observed.source, expected.source);
    assert.equal(observed.expected_direct, expected.direct);
    assert.equal(observed.display.direct, expected.direct);
    assert.equal(observed.display.iframes.length, 1);
    if (expected.direct) {
      assert.ok(
        !observed.display.iframes[0].class?.includes("html-block-iframe"),
        `${expected.name} unexpectedly used the hosted wrapper`,
      );
    } else {
      assert.ok(
        observed.display.iframes[0].class?.includes("html-block-iframe"),
        `${expected.name} unexpectedly escaped the hosted wrapper`,
      );
    }
  }
});
