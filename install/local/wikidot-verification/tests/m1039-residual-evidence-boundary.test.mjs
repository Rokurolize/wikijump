import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const artifactUrls = {
  readonly: new URL(
    "../artifacts/open43-readonly-live-20260810.json",
    import.meta.url,
  ),
  pagination: new URL(
    "../artifacts/open43-m1039-files-pagination-history-live-20260810.json",
    import.meta.url,
  ),
  suffix: new URL(
    "../artifacts/m1039-files-suffix-live-20260914.json",
    import.meta.url,
  ),
  flickr: new URL(
    "../artifacts/m1039-flickr-provider-live-20260915.json",
    import.meta.url,
  ),
};

const artifactSha256 = {
  readonly: "9c98424c2082c7989e2c09e9c9c4e8082be8d3c8e42910383b3e323095b9a410",
  pagination: "ca3a7e3bd15c62e16ead704ecd6d3596ba5a308f9bbc9f9a0a90aee10b54c96b",
  suffix: "e91d5f3e58d8fc3e8e605abb768308182377e399877b4af51fd11962d932b228",
  flickr: "94f30d0000b9cb33340cf1f3ec5b037ce299e8d8375169a40bf2d46f5c9bfca2",
};

async function readArtifact(name) {
  const bytes = await readFile(artifactUrls[name]);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    artifactSha256[name],
    `${name} evidence must remain byte-identical to its sealed receipt`,
  );
  return JSON.parse(bytes.toString("utf8"));
}

test("M1039 retained Files evidence separates row shape from residual authority", async () => {
  const readonly = await readArtifact("readonly");
  const pagination = await readArtifact("pagination");
  const suffix = await readArtifact("suffix");

  assert.equal(readonly.mutated, false);
  const filesRule = readonly.general_rules.find(
    ({ evidence_id }) => evidence_id === "E_OPEN43_FILES_ROWS_20260810",
  );
  assert.ok(filesRule);
  assert.equal(filesRule.positive_controls, 3);
  assert.equal(filesRule.negative_controls, 3);
  assert.match(filesRule.observation, /File name, File type, Size/u);
  assert.match(filesRule.observation, /Manage attachments/u);
  assert.doesNotMatch(filesRule.observation, /pager|history|Unicode|duplicate|bytes/u);

  assert.equal(pagination.status, "blocked");
  assert.equal(pagination.mutation_performed, false);
  assert.equal(pagination.setup.active_rows_achieved, 0);
  assert.equal(pagination.setup.total_bytes_uploaded, 0);
  assert.deepEqual(pagination.promoted_rules, []);
  assert.ok(
    Object.values(pagination.public_interfaces).every(
      ({ status }) => status === "not_attempted_due_to_preflight_block",
    ),
  );
  assert.equal(
    pagination.blocked_reason.code,
    "private-page-acl-public-preflight-unavailable",
  );

  assert.equal(suffix.container_contract.suffix_generator, "not established by this evidence");
  assert.equal(suffix.cleanup.verified, true);
});

test("M1039 Flickr no-photo and failure reads never become provider authority", async () => {
  const readonly = await readArtifact("readonly");
  const flickr = await readArtifact("flickr");

  const blockedRead = readonly.attempted_but_still_blocked.find(
    ({ case_id }) => case_id === "M1039_FLICKR_ARGUMENTS_AND_PROVIDER",
  );
  assert.ok(blockedRead);
  assert.match(blockedRead.reason, /no-photo diagnostic/u);
  assert.match(blockedRead.reason, /photoset failure/u);
  assert.match(blockedRead.reason, /no provider success/u);

  assert.equal(flickr.status, "blocked");
  assert.equal(flickr.mutation_performed, false);
  assert.equal(flickr.observed_result.provider_success_observed, false);
  assert.equal(flickr.observed_result.provider_image_observed, false);
  assert.equal(flickr.observed_result.error_block_observed, false);
  assert.deepEqual(flickr.promoted_rules, []);
  assert.equal(
    flickr.terminal_boundary.code,
    "wikidot-provider-success-not-observed",
  );
  assert.equal(
    flickr.provider_network_metadata.direct_provider_request_performed,
    false,
  );
  assert.equal(
    flickr.provider_network_metadata.server_side_provider_trace_exposed,
    false,
  );
});
