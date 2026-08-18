import assert from "node:assert/strict";
import {execFile as execFileCallback} from "node:child_process";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {promisify} from "node:util";
import test from "node:test";

import {main, parseArgs, verifyFinalZero} from "../scripts/verify-final-zero.mjs";

const execFile = promisify(execFileCallback);

const ftmlCommit = "3".repeat(40);
const ftmlTree = "4".repeat(40);
const runId = "candidate-run-000000000001";
const candidateArtifactKey = "c".repeat(64);
const catalogApiIds = [
  "categories-select", "deleted-methods", "files-get-meta", "files-get-one", "files-save-one", "files-select", "overview", "pages-get-meta", "pages-get-one", "pages-save-one", "pages-select", "posts-get", "posts-select", "tags-select", "users-get-me",
];
const framerailIds = [
  "categories.select", "files.get_meta", "files.get_one", "files.save_one", "files.select", "pages.get_meta", "pages.get_one", "pages.save_one", "pages.select", "posts.get", "posts.select", "system.listMethods", "system.methodHelp", "system.methodSignature", "system.multicall", "tags.select", "users.get_me",
];
const wikidotPyIds = [
  "changes/SiteChangesListModule:parameters=options,page,perpage", "dashboard/messages/DMInboxModule:parameters=page?", "dashboard/messages/DMSentModule:parameters=page?", "dashboard/messages/DMViewMessageModule:parameters=item", "edit/EditMetaModule:parameters=pageId", "files/PageFilesModule:parameters=page_id", "forum/ForumCommentsListModule:parameters=pageId", "forum/ForumStartModule:parameters=hidden", "forum/ForumViewCategoryModule:parameters=c,p", "forum/ForumViewThreadModule:parameters=t", "forum/ForumViewThreadPostsModule:parameters=pageNo,t", "forum/sub/ForumEditPostFormModule:parameters=postId,threadId", "forum/sub/ForumPostRevisionModule:parameters=revisionId", "forum/sub/ForumPostRevisionsModule:parameters=postId", "history/PageRevisionListModule:parameters=options,page_id,perpage", "history/PageSourceModule:parameters=revision_id", "history/PageVersionModule:parameters=revision_id", "list/ListPagesModule:parameters=module_body,p,pagetype,page_type,page-type,category,tags,tag,parent,created_at,createdat,updated_at,updatedat,created_by,createdby,rating,score,name,fullname,full_slug,fullslug,range,order,offset,limit,perpage,per_page,separate,wrapper,rss,rsstitle,rssdescription,rsshome,rsslimit,rssonly", "managesite/ManageSiteMembersApplicationsModule:parameters=(none)", "membership/MembersListModule:parameters=group,page", "pagerate/WhoRatedPageModule:parameters=pageId", "viewsource/ViewSourceModule:parameters=page_id",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeBytes(root, name, value) {
  const file = path.join(root, name);
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  await fs.writeFile(file, bytes, {mode: 0o600});
  return {path: file, sha256: sha256(bytes)};
}

async function writeJson(root, name, value) {
  return writeBytes(root, name, `${JSON.stringify(value)}\n`);
}

function deferredRecords() {
  return [
    ...catalogApiIds.map((id) => ({source_local_id: `catalog-feature:api-${id}`, kind: "catalog_feature", deferred_owner: "wikijump.xmlrpc-api"})),
    ...framerailIds.map((id) => ({source_local_id: `framerail-xmlrpc:${id}`, kind: "framerail_xmlrpc_method", deferred_owner: "wikijump.xmlrpc-api"})),
    ...wikidotPyIds.map((id) => ({source_local_id: `wikidot-py-amc-module:${id}`, kind: "wikidot_py_amc_module_shape", deferred_owner: "external.wikidot-py"})),
  ];
}

async function git(repository, ...arguments_) {
  const {stdout} = await execFile("git", ["-C", repository, ...arguments_], {encoding: "utf8"});
  return stdout.trim();
}

async function createMergeRepository(root) {
  const repository = path.join(root, "repository");
  await fs.mkdir(repository);
  await git(repository, "init", "--quiet", "--initial-branch=develop");
  await git(repository, "config", "user.email", "test@example.invalid");
  await git(repository, "config", "user.name", "Final Zero Test");
  await fs.writeFile(path.join(repository, "README"), "base\n");
  await git(repository, "add", "README");
  await git(repository, "commit", "--quiet", "-m", "base");
  await git(repository, "switch", "--quiet", "-c", "candidate");
  await fs.writeFile(path.join(repository, "README"), "candidate\n");
  await git(repository, "commit", "--quiet", "-am", "candidate");
  const candidateCommit = await git(repository, "rev-parse", "HEAD");
  await git(repository, "switch", "--quiet", "develop");
  await git(repository, "commit", "--quiet", "--allow-empty", "-m", "develop");
  const developCommit = await git(repository, "rev-parse", "HEAD");
  await git(repository, "merge", "--quiet", "--no-ff", "candidate", "-m", "merge candidate");
  return {
    path: repository,
    candidateCommit,
    developCommit,
    mergeCommit: await git(repository, "rev-parse", "HEAD"),
    mergeTree: await git(repository, "rev-parse", "HEAD^{tree}"),
  };
}

function promotionPrecondition({candidateCommit, tree}) {
  const imageRoles = ["cache", "caddy", "database", "deepwell", "files", "framerail", "wws"];
  return {
    schema: "wikijump.standing_promotion_precondition.v1",
    status: "pass",
    run_id: runId,
    verified_at: "2026-08-15T00:00:00.000Z",
    admission: Object.fromEntries(["candidate_parity_receipt_sha256", "candidate_identity_sha256", "live_reference_sha256", "live_completion_policy_sha256", "source_runner_sha256", "source_observation_sha256", "source_execution_identity_sha256"].map((name, index) => [name, String(index + 1).repeat(64)])),
    candidate: {artifact_key: candidateArtifactKey, wikijump_commit: candidateCommit, wikijump_tree: tree, ftml_sha: ftmlCommit, compose_project: "wikijump-candidate", expires_at: "2026-08-16T00:00:00.000Z"},
    build: {
      seal_sha256: "a".repeat(64),
      evidence_manifest_sha256: "b".repeat(64),
      verdict_sha256: "d".repeat(64),
      final_images_sha256: "e".repeat(64),
      run_id: runId,
      wikijump_commit: candidateCommit,
      wikijump_tree: tree,
      ftml_sha: ftmlCommit,
      images: Object.fromEntries(imageRoles.map((role) => [role, `sha256:${{cache: "4", caddy: "5", database: "6", deepwell: "1", files: "7", framerail: "2", wws: "3"}[role].repeat(64)}`])),
    },
    staging_home: {manifest_sha256: "f".repeat(64)},
  };
}

async function fixtures(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "final-zero-"));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const repository = await createMergeRepository(root);
  const wikijumpCommit = repository.mergeCommit;
  const wikijumpTree = repository.mergeTree;
  const promotion = promotionPrecondition({candidateCommit: repository.candidateCommit, tree: wikijumpTree});
  const inventory = await writeBytes(root, "inventory.json", "{\"frozen\":true}\n");
  const candidateArtifact = await writeBytes(root, "candidate-artifact.json", "candidate\n");
  const standingArtifact = await writeBytes(root, "standing-artifact.json", "standing\n");
  const promotionArtifact = await writeJson(root, "promotion-precondition.json", promotion);
  const activeImages = Object.fromEntries(["deepwell", "framerail", "wws"].map((service, index) => [service, {reference: `sha256:${String(index + 1).repeat(64)}`, id: `sha256:${String(index + 1).repeat(64)}`, repo_digests: [], labels: {}}]));
  const rollbackImages = Object.fromEntries(["deepwell", "framerail", "wws"].map((service, index) => [service, {reference: `sha256:${String(index + 7).repeat(64)}`, id: `sha256:${String(index + 7).repeat(64)}`, repo_digests: [], labels: {}}]));
  const prepared = await writeJson(root, "prepared-receipt.json", {schema_version: 1, kind: "standing-image-preparation", status: "pass", run_id: runId, wikijump_sha: wikijumpCommit, wikijump_tree: wikijumpTree, ftml_sha: ftmlCommit, dependency_lock_sha256: "8".repeat(64), promotion_precondition: promotionArtifact, images: activeImages});
  const runtimeIdentityValue = {schema: "wikijump_syntax_differential.wikijump_runtime_identity.v1", wikijump_sha: wikijumpCommit, ftml_sha: ftmlCommit, dependency_lock_sha256: "8".repeat(64), executable_sha256: "1".repeat(64), runtime_config_sha256: "9".repeat(64)};
  const runtimeIdentity = await writeJson(root, "runtime-identity.json", runtimeIdentityValue);
  const standingRefresh = await writeJson(root, "standing-refresh.json", {schema_version: 1, kind: "standing-promotion", status: "pass", run_id: runId, started_at: "2026-08-15T00:00:00.000Z", completed_at: "2026-08-15T00:01:00.000Z", activation_duration_seconds: 0, image_verification_duration_seconds: 0, compose_activation_duration_seconds: 0, health_duration_seconds: 0, canary_duration_seconds: 0, wikijump_sha: wikijumpCommit, wikijump_tree: wikijumpTree, ftml_sha: ftmlCommit, dependency_lock_sha256: "8".repeat(64), promotion_precondition: promotionArtifact, runtime_home: "/tmp/wikijump-standing", prepared_receipt: prepared, project_name: "wikijump-standing", network_name: "wikijump-standing_default", images: activeImages, rollback_images: rollbackImages, protected_volumes: ["runtime50x-postgres-data", "runtime50x-files-data"], runtime_differential_identity: {path: runtimeIdentity.path, sha256: runtimeIdentity.sha256, identity: runtimeIdentityValue}, health: {deepwell: "healthy", framerail: "healthy", wws: "healthy"}, canary: {url: "http://scp-wiki.wikijump.localhost/scp-9506", status: "pass", required_markers: ["scp-9506", "page-content"]}, cleanup: {status: "pass", candidate_receipt: prepared, receipt: prepared, superseded_images: []}, resource_disposition: {active: Object.fromEntries(Object.entries(activeImages).map(([service, image]) => [service, {owner: "standing-runtime", keep_until: "2026-08-16T00:00:00+00:00", id: image.id}])), rollback: Object.fromEntries(Object.entries(rollbackImages).map(([service, image]) => [service, {owner: "standing-runtime-rollback", keep_until: "2026-08-16T00:00:00+00:00", id: image.id}])), volumes: "protected-and-untouched", worktrees: "none created", target_directories: "none created"}});
  const records = deferredRecords();
  const surfaceId = "surface:00000001";
  const sourceLocalId = "catalog-feature:module-example";
  const row = {
    surface_id: surfaceId,
    actor: {state: "missing", reason: "not_recorded"},
    input: {state: "missing", reason: "not_recorded"},
    observable_interval: {state: "missing", reason: "not_recorded"},
    result: {state: "missing", reason: "not_recorded"},
    source: {state: "present", bindings: [{source_manifest_id: "manifest:00000001", raw_record_id: "raw:00000001"}]},
    evidence: {state: "present", references: []},
    tests: {state: "present", references: ["test:review.js#case"]},
    owners: {state: "present", specification: ["specification:00000001"], implementation: ["implementation:00000001"]},
    issues: {state: "present", numbers: [1365]},
    blockers: {state: "none", numbers: []},
    candidate: {state: "pass", artifacts: [candidateArtifact]},
    standing: {state: "pass", artifacts: [standingArtifact]},
    closure: {state: "closed", references: ["test:review.js#case"]},
  };
  const ledger = {
    schema: "wikijump.compatibility_ledger.v1",
    counts: {raw_records: 1, public_inventory_records: 1, canonical_surfaces: 1, input_alias_edges: 0, deduplication_relationships: 0},
    inputs: {inventory, wikijump: {commit: wikijumpCommit, tree: wikijumpTree}, ftml: {commit: ftmlCommit, tree: ftmlTree}},
    source_manifests: [{source_manifest_id: "manifest:00000001", source_class: "wikijump-consolidated-inventory", schema_id: "wikijump.compatibility_surface_inventory.v2", repository: "Rokurolize/wikijump", commit: wikijumpCommit, tree: wikijumpTree, path: inventory.path, sha256: inventory.sha256}],
    raw_source_records: [{source_manifest_id: "manifest:00000001", raw_record_id: "raw:00000001", record_sha256: "1".repeat(64)}],
    source_local_identities: [{source_manifest_id: "manifest:00000001", raw_record_id: "raw:00000001", source_local_id: sourceLocalId}],
    surface_assignments: [{assignment_id: "assignment:00000001", surface_id: surfaceId, source_manifest_id: "manifest:00000001", raw_record_id: "raw:00000001"}],
    relationships: [],
    deferred_exclusions: {count: records.length, by_kind: {catalog_feature: 15, framerail_xmlrpc_method: 17, wikidot_py_amc_module_shape: 22}, by_owner: {"external.wikidot-py": 22, "wikijump.xmlrpc-api": 32}, records},
    rows: [row],
  };
  const denominator = {schema: "wikijump.compatibility_final_zero_denominator.v1", status: "sealed", rows: [{surface_id: surfaceId, source_local_id: sourceLocalId, kind: "catalog_feature"}]};
  const deferredDenominator = {schema: "wikijump.compatibility_deferred_denominator.v1", status: "sealed", rows: records.map(({source_local_id: sourceLocalId, kind}) => ({surface_id: sourceLocalId, source_local_id: sourceLocalId, kind}))};
  const deferredLedger = {schema: "wikijump.compatibility_deferred_ledger.v1", status: "sealed", rows: records.map(({source_local_id: sourceLocalId, kind, deferred_owner: deferredOwner}) => ({surface_id: sourceLocalId, source_local_id: sourceLocalId, kind, deferred_owner: deferredOwner}))};
  const matrix = {
    schema: "wikijump.compatibility_standing_matrix.v2",
    status: "pass",
    run_id: runId,
    merge_commit: wikijumpCommit,
    merge_tree: wikijumpTree,
    ftml_sha: ftmlCommit,
    ftml_tree: ftmlTree,
    candidate_commit: repository.candidateCommit,
    candidate_artifact_key: candidateArtifactKey,
    promotion_precondition: promotionArtifact,
    standing_refresh: standingRefresh,
    rows: [{surface_id: surfaceId, source_local_id: sourceLocalId, kind: "catalog_feature", status: "pass", artifacts: [standingArtifact]}],
  };
  const standardsReview = {
    schema: "wikijump.compatibility_review.v1",
    status: "pass",
    axis: "standards",
    candidate_commit: repository.candidateCommit,
    candidate_tree: wikijumpTree,
    findings: [],
  };
  const specReview = {...standardsReview, axis: "spec"};
  const paths = {
    root,
    ledger: (await writeJson(root, "ledger.json", ledger)).path,
    denominator: (await writeJson(root, "denominator.json", denominator)).path,
    deferredDenominator: (await writeJson(root, "deferred-denominator.json", deferredDenominator)).path,
    deferredLedger: (await writeJson(root, "deferred-ledger.json", deferredLedger)).path,
    standingMatrix: (await writeJson(root, "standing-matrix.json", matrix)).path,
    standardsReview: (await writeJson(root, "standards-review.json", standardsReview)).path,
    specReview: (await writeJson(root, "spec-review.json", specReview)).path,
    repository: repository.path,
  };
  return {paths, ledger, denominator, deferredDenominator, deferredLedger, matrix, repository};
}

function inputMap(fixture) {
  return {repository: fixture.paths.repository, ledger: fixture.paths.ledger, denominator: fixture.paths.denominator, deferredDenominator: fixture.paths.deferredDenominator, deferredLedger: fixture.paths.deferredLedger, standingMatrix: fixture.paths.standingMatrix, standardsReview: fixture.paths.standardsReview, specReview: fixture.paths.specReview};
}

test("final-zero reconciles the exact denominator, row artifacts, deferred union, and canonical promotion", async (t) => {
  const fixture = await fixtures(t);
  const receipt = await verifyFinalZero(inputMap(fixture));
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.merge_commit, fixture.repository.mergeCommit);
  assert.deepEqual(Object.keys(receipt.inputs).sort(), ["deferred_denominator", "deferred_ledger", "denominator", "ledger", "repository", "spec_review", "standards_review", "standing_matrix", "standing_refresh"]);
  const output = path.join(fixture.paths.root, "receipt.json");
  const args = ["--ledger", fixture.paths.ledger, "--denominator", fixture.paths.denominator, "--deferred-denominator", fixture.paths.deferredDenominator, "--deferred-ledger", fixture.paths.deferredLedger, "--standing-matrix", fixture.paths.standingMatrix, "--standards-review", fixture.paths.standardsReview, "--spec-review", fixture.paths.specReview, "--repository", fixture.paths.repository, "--output", output];
  assert.equal(await main(args, {stdout: () => {}}), 0);
  assert.equal(await main(args, {stdout: () => {}}), 0);
});

test("final-zero rejects missing or extra current rows", async (t) => {
  const fixture = await fixtures(t);
  fixture.denominator.rows.push({surface_id: "surface:00000002", source_local_id: "catalog-feature:extra", kind: "catalog_feature"});
  await writeJson(fixture.paths.root, "denominator.json", fixture.denominator);
  await assert.rejects(verifyFinalZero(inputMap(fixture)), /missing or extra rows/u);
});

test("final-zero rejects a non-exact deferred wikidot.py/XML-RPC exclusion", async (t) => {
  const fixture = await fixtures(t);
  fixture.deferredDenominator.rows[0].source_local_id = "catalog-feature:api-not-frozen";
  await writeJson(fixture.paths.root, "deferred-denominator.json", fixture.deferredDenominator);
  await assert.rejects(verifyFinalZero(inputMap(fixture)), /unknown or wrong deferred identity/u);
});

test("final-zero rejects any catalog XML-RPC row leaking into the current ledger", async (t) => {
  for (const id of catalogApiIds) {
    const fixture = await fixtures(t);
    const sourceLocalId = `catalog-feature:api-${id}`;
    fixture.ledger.source_local_identities[0].source_local_id = sourceLocalId;
    await writeJson(fixture.paths.root, "ledger.json", fixture.ledger);
    await assert.rejects(verifyFinalZero(inputMap(fixture)), new RegExp(`contains deferred work: ${sourceLocalId}`));
  }
});

test("final-zero rejects deferred omission and reclassification", async (t) => {
  const omitted = await fixtures(t);
  omitted.deferredDenominator.rows.pop();
  await writeJson(omitted.paths.root, "deferred-denominator.json", omitted.deferredDenominator);
  await assert.rejects(verifyFinalZero(inputMap(omitted)), /exactly 54 rows/u);

  const reclassified = await fixtures(t);
  reclassified.deferredLedger.rows[0].kind = "framerail_xmlrpc_method";
  await writeJson(reclassified.paths.root, "deferred-ledger.json", reclassified.deferredLedger);
  await assert.rejects(verifyFinalZero(inputMap(reclassified)), /unknown, wrong, or duplicate row/u);
});

test("final-zero binds candidate artifact_key through the canonical promotion validator", async (t) => {
  const fixture = await fixtures(t);
  fixture.matrix.candidate_artifact_key = "d".repeat(64);
  await writeJson(fixture.paths.root, "standing-matrix.json", fixture.matrix);
  await assert.rejects(verifyFinalZero(inputMap(fixture)), /candidate artifact_key does not match/u);
});

test("final-zero rejects a candidate PR head used as the merge commit", async (t) => {
  const fixture = await fixtures(t);
  fixture.matrix.merge_commit = fixture.repository.candidateCommit;
  await writeJson(fixture.paths.root, "standing-matrix.json", fixture.matrix);
  await assert.rejects(verifyFinalZero(inputMap(fixture)), /candidate commit must differ from merge commit/u);
});

test("final-zero rejects a wrong merge tree or merge parent", async (t) => {
  const wrongTree = await fixtures(t);
  wrongTree.matrix.merge_tree = "f".repeat(40);
  await writeJson(wrongTree.paths.root, "standing-matrix.json", wrongTree.matrix);
  for (const name of ["standardsReview", "specReview"]) {
    const review = JSON.parse(await fs.readFile(wrongTree.paths[name], "utf8"));
    review.candidate_tree = wrongTree.matrix.merge_tree;
    await writeJson(wrongTree.paths.root, name === "standardsReview" ? "standards-review.json" : "spec-review.json", review);
  }
  await assert.rejects(verifyFinalZero(inputMap(wrongTree)), /matrix merge tree does not match/u);

  const wrongParent = await fixtures(t);
  wrongParent.matrix.candidate_commit = wrongParent.repository.developCommit;
  await writeJson(wrongParent.paths.root, "standing-matrix.json", wrongParent.matrix);
  for (const name of ["standardsReview", "specReview"]) {
    const review = JSON.parse(await fs.readFile(wrongParent.paths[name], "utf8"));
    review.candidate_commit = wrongParent.matrix.candidate_commit;
    await writeJson(wrongParent.paths.root, name === "standardsReview" ? "standards-review.json" : "spec-review.json", review);
  }
  await assert.rejects(verifyFinalZero(inputMap(wrongParent)), /promotion candidate PR head does not match/u);
});

test("final-zero rejects a standing matrix without its digest-bound standing refresh receipt", async (t) => {
  const fixture = await fixtures(t);
  delete fixture.matrix.standing_refresh;
  await writeJson(fixture.paths.root, "standing-matrix.json", fixture.matrix);
  await assert.rejects(verifyFinalZero(inputMap(fixture)), /standing matrix has missing or unknown fields/u);
});

test("final-zero requires distinct zero-finding Standards and Spec reviews for the candidate tree", async (t) => {
  const fixture = await fixtures(t);
  const review = JSON.parse(await fs.readFile(fixture.paths.standardsReview, "utf8"));
  review.findings = [{severity: "error", message: "unresolved"}];
  await writeJson(fixture.paths.root, "standards-review.json", review);
  await assert.rejects(verifyFinalZero(inputMap(fixture)), /standards review is not a zero-finding report/u);

  const wrongAxis = await fixtures(t);
  const spec = JSON.parse(await fs.readFile(wrongAxis.paths.specReview, "utf8"));
  spec.axis = "standards";
  await writeJson(wrongAxis.paths.root, "spec-review.json", spec);
  await assert.rejects(verifyFinalZero(inputMap(wrongAxis)), /spec review is not a zero-finding report/u);
});

test("final-zero rejects symlinked input and artifact paths", async (t) => {
  const fixture = await fixtures(t);
  const symlink = path.join(fixture.paths.root, "standing-matrix-link.json");
  await fs.symlink(fixture.paths.standingMatrix, symlink);
  const symlinked = {...inputMap(fixture), standingMatrix: symlink};
  await assert.rejects(verifyFinalZero(symlinked), /symbolic link/u);

  const value = JSON.parse(await fs.readFile(fixture.paths.ledger, "utf8"));
  const artifactLink = path.join(fixture.paths.root, "candidate-artifact-link.json");
  await fs.symlink(value.rows[0].candidate.artifacts[0].path, artifactLink);
  value.rows[0].candidate.artifacts[0].path = artifactLink;
  await writeJson(fixture.paths.root, "ledger.json", value);
  await assert.rejects(verifyFinalZero(inputMap(fixture)), /symbolic link/u);
});

test("final-zero CLI requires every frozen input", () => {
  assert.deepEqual(parseArgs(["--ledger", "/a", "--denominator", "/b", "--deferred-denominator", "/c", "--deferred-ledger", "/d", "--standing-matrix", "/e", "--standards-review", "/f", "--spec-review", "/g", "--repository", "/h", "--output", "/i"]), {ledger: "/a", denominator: "/b", "deferred-denominator": "/c", "deferred-ledger": "/d", "standing-matrix": "/e", "standards-review": "/f", "spec-review": "/g", repository: "/h", output: "/i"});
  assert.throws(() => parseArgs(["--ledger", "/a", "--denominator", "/b", "--deferred-denominator", "/c", "--deferred-ledger", "/d", "--standing-matrix", "/e", "--standards-review", "/f", "--spec-review", "/g", "--output", "/i"]), /--repository is required/u);
});
