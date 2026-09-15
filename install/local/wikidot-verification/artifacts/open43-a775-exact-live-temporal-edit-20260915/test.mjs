#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const artifactPath = path.join(root, "evidence.json");
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readRelative(relativePath) {
  const file = path.join(root, relativePath);
  assert.ok(fs.existsSync(file), `missing artifact file: ${relativePath}`);
  return file;
}

assert.equal(artifact.schema, "wikijump.open43.a775_exact_live_temporal_edit.v1");
assert.equal(artifact.case_id, "A775_EXACT_LIVE_TEMPORAL_EDIT");
assert.equal(artifact.issue, 775);
assert.equal(artifact.authority.holder.source_literal, "[[button edit]]");
assert.equal(artifact.authority.holder.source_utf8_bytes, 15);
assert.equal(artifact.authority.holder.source_sha256, "18eaaff42907aad81a2d05a013a0eda522ec1c22f86d1c45f14968fa91fe2ed1");
assert.equal(artifact.authority.holder.pre_delete_render.control_outer_html, "<a class=\"wiki-standalone-button\" href=\"javascript:;\" onclick=\"WIKIDOT.page.listeners.editClick(event)\">edit</a>");
assert.equal(artifact.browser.executable.sha256, "caf423e184f0bcefe2ee5bef40539a3c005c63beb44e3321c0834929a13af733");
assert.equal(artifact.browser.version.product, "Chrome/152.0.7977.83");
assert.equal(artifact.capture.candidate_or_local_product_browser_run, false);
assert.equal(artifact.capture.cargo_or_docker_run, false);
assert.equal(artifact.capture.product_source_changed, false);
assert.equal(artifact.capture.generated_audit_ledger_or_routing_changed, false);

const sidecar = fs.readFileSync(path.join(root, "evidence.json.sha256"), "utf8").trim().split(/\s+/u)[0];
assert.equal(sidecar, sha256(artifactPath), "evidence sidecar digest mismatch");

const manifestPath = readRelative(artifact.bundle.manifest_relative_path);
assert.equal(sha256(manifestPath), artifact.bundle.manifest_sha256, "manifest digest mismatch");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const manifestEntries = new Map(manifest.files.map((entry) => [entry.path, entry]));
for (const entry of [...artifact.bundle.raw_files, ...artifact.bundle.cleanup_files]) {
  const file = readRelative(entry.path);
  assert.deepEqual(manifestEntries.get(entry.path), entry, `manifest entry mismatch: ${entry.path}`);
  assert.equal(fs.statSync(file).size, entry.bytes, `size mismatch: ${entry.path}`);
  assert.equal(sha256(file), entry.sha256, `digest mismatch: ${entry.path}`);
}

const expectedModes = new Map([
  ["anonymous", new Set(["click", "keyboard", "double", "history"])],
  ["admin-A", new Set(["click", "keyboard", "double", "history"])],
  ["member-B", new Set(["click", "keyboard", "double", "history"])],
  ["member-C", new Set(["click", "keyboard", "double"])],
]);
const observedModes = new Map();
for (const run of artifact.runs) {
  assert.ok(expectedModes.has(run.actor), `unexpected actor: ${run.actor}`);
  const actorModes = observedModes.get(run.actor) ?? new Set();
  actorModes.add(run.mode);
  observedModes.set(run.actor, actorModes);
  readRelative(run.file);
  assert.ok(run.timeline.length >= 3, `${run.actor}/${run.mode} timeline is too short`);
  assert.equal(run.timeline.find((entry) => entry.label === "after-dispatch")?.state.body_class, "wait");
  assert.equal(run.dispatch_loading, true);
  if (run.mode === "double") assert.equal(run.activation_mode_request_count, 2, `${run.actor} double-click request count`);
  if (run.mode !== "double") assert.equal(run.activation_mode_request_count, 1, `${run.actor}/${run.mode} request count`);
  if (run.result === "editor") assert.equal(run.timeline.find((entry) => entry.label === "sample-3000ms")?.state.editor?.id, "edit-page-textarea");
  if (run.result === "permission_denied") assert.ok(run.dialogs.some((text) => text.includes("Permission error")));
  if (run.result === "page_lock_conflict") assert.ok(run.dialogs.some((text) => text.includes("Page lock conflict")));
  if (run.mode === "history") {
    assert.equal(run.timeline.find((entry) => entry.label === "history-after-back")?.state.path, "/");
    assert.equal(run.timeline.find((entry) => entry.label === "history-after-forward")?.state.path, "/open43-a775-a775-live-20260914t234252z-2");
  }
}
for (const [actor, modes] of expectedModes) assert.deepEqual(observedModes.get(actor), modes, `${actor} mode coverage`);

const cleanup = artifact.cleanup;
assert.equal(cleanup.holder_created_run_owned, true);
assert.equal(cleanup.holder_deleted_via_observed_ui, true);
assert.equal(cleanup.post_delete_authenticated_browser.control_present, false);
assert.equal(cleanup.post_delete_authenticated_browser.editor_present, false);
assert.equal(cleanup.anonymous_cache_bypassed_get.status, 404);
const cleanupBody = readRelative(cleanup.anonymous_cache_bypassed_get.body_relative_path);
assert.equal(sha256(cleanupBody), cleanup.anonymous_cache_bypassed_get.body_sha256);
const cleanupHeaders = readRelative(cleanup.anonymous_cache_bypassed_get.headers_relative_path);
assert.match(fs.readFileSync(cleanupHeaders, "utf8"), /wikidot_token7=\[redacted\]/u);

const frozenText = fs.readFileSync(artifactPath, "utf8") + fs.readFileSync(manifestPath, "utf8") + fs.readFileSync(cleanupHeaders, "utf8");
assert.doesNotMatch(frozenText, /WIKIDOT_SESSION_ID|PHPSESSID|password\s*[:=]/iu);
assert.doesNotMatch(frozenText, /scpaiueouiuiuiui|voted-fated-smuggler/u);

process.stdout.write(JSON.stringify({ok: true, schema: artifact.schema, runs: artifact.runs.length, retained_files: manifest.files.length, cleanup_status: cleanup.anonymous_cache_bypassed_get.status}) + "\n");
