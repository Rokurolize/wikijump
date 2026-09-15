import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const artifactUrl = new URL(
  "../artifacts/m1039-flickr-provider-live-20260915.json",
  import.meta.url,
);

const ARTIFACT_SHA256 =
  "94f30d0000b9cb33340cf1f3ec5b037ce299e8d8375169a40bf2d46f5c9bfca2";
const RESPONSE_BODY_SHA256 =
  "2656dfadb5fe24c25efc938edbbf6c0f8f180a63a12a43ec1a575d42b95ef640";

async function readArtifact() {
  const bytes = await readFile(artifactUrl);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    ARTIFACT_SHA256,
    "the retained Flickr terminal receipt must remain byte-identical",
  );
  return JSON.parse(bytes.toString("utf8"));
}

test("M1039 Flickr probe preserves the exact anonymous terminal response", async () => {
  const artifact = await readArtifact();

  assert.equal(artifact.schema, "wikijump.m1039_flickr_provider_probe.v1");
  assert.equal(artifact.status, "blocked");
  assert.equal(
    artifact.target_surface_id,
    "open43-audit-case:M1039_FLICKR_ARGUMENTS_AND_PROVIDER",
  );
  assert.equal(artifact.site, "sandbox-for-codex");
  assert.equal(artifact.actor, "anonymous");
  assert.equal(artifact.authenticated, false);
  assert.equal(artifact.mutation_performed, false);
  assert.deepEqual(artifact.request.form, {
    mode: "page",
    moduleName: "edit/PagePreviewModule",
    source: '[[module FlickrGallery tags="nasa" perPage="1"]]',
    title: "m1039-flickr-provider-success-probe",
  });
  assert.equal(artifact.request.body_sha256, "75f09c3b1a8d28fc9cb6419be6a8eef31ac42ae4a0319ac4a4b6cf32f833f338");
  assert.equal(artifact.request.cookies_sent, false);
  assert.equal(artifact.request.authorization_sent, false);
  assert.equal(artifact.response.http_status, 200);
  assert.equal(artifact.response.body_sha256, RESPONSE_BODY_SHA256);
  assert.equal(
    createHash("sha256").update(artifact.response.body).digest("hex"),
    RESPONSE_BODY_SHA256,
  );

  const payload = JSON.parse(artifact.response.body);
  assert.equal(payload.status, "ok");
  assert.equal(payload.title, "m1039-flickr-provider-success-probe");
  assert.equal(payload.CURRENT_TIMESTAMP, 1789431495);
  assert.match(payload.body, /class="flickr-gallery-box makeHoverTitles"/u);
  assert.match(payload.body, /Sorry, no photos\./u);
  assert.doesNotMatch(payload.body, /<img\b/u);
  assert.deepEqual(payload.jsInclude, [artifact.observed_result.js_include]);
  assert.deepEqual(payload.cssInclude, []);
  assert.equal(payload.callbackIndex, null);
});

test("M1039 Flickr probe records the terminal boundary without provider authority", async () => {
  const artifact = await readArtifact();

  assert.deepEqual(artifact.acquisition, {
    tool: "wikidot.py anonymous AMC connector",
    transport: "direct site-scoped AMC request without site-page discovery",
    external_request_count: 1,
    attempt_limit: 1,
    request_timeout_seconds: 20,
    no_retry: true,
    barrier_written_before_request: true,
    response_sealed_after_request: true,
    sealed_response_record_sha256: "65f5ff006d26d4198868254bb4f1aba10e53166d19c7257d5c47422ad4b547c8",
  });
  assert.deepEqual(artifact.observed_result, {
    amc_status: "ok",
    rendered_body_sha256: "368c318015591fb4502aff7e7640a66c0b892213268d4acd652e1bf487031fda",
    provider_success_observed: false,
    no_photo_diagnostic_observed: true,
    error_block_observed: false,
    provider_image_observed: false,
    js_include: "http://d3g0gp89917ko0.cloudfront.net/v--7690939296dc/common--modules/js/wiki/image/FlickrGalleryModule.js",
  });
  assert.equal(artifact.provider_network_metadata.direct_provider_request_performed, false);
  assert.equal(artifact.provider_network_metadata.server_side_provider_trace_exposed, false);
  assert.deepEqual(artifact.provider_network_metadata.client_visible_url_candidates, []);
  assert.deepEqual(artifact.promoted_rules, []);
  assert.equal(artifact.credentials_exposed, false);
  assert.equal(artifact.terminal_boundary.code, "wikidot-provider-success-not-observed");
  assert.match(artifact.terminal_boundary.next_action, /without retrying/u);

  const serialized = JSON.stringify(artifact);
  assert.doesNotMatch(serialized, /WIKIDOT_SESSION_ID=[^;\s]+/u);
  assert.doesNotMatch(serialized, /wikidot_token7=[^&\s]+/u);
  assert.doesNotMatch(serialized, /(?:Cookie|Authorization):\s*[^\s]+/iu);
});
