import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";

const verificationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(verificationRoot, "../../..");
const casesPath = path.join(verificationRoot, "fixtures/comments-hideform-actor/cases.json");
const artifactPath = path.join(verificationRoot, "artifacts/forum-comments-hideform-actor-live-20260810.json");
const browserContractPath = path.join(verificationRoot, "fixtures/comments-hideform-actor/browser-run-contract.json");
const execFileAsync = promisify(execFile);
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const gitBlob = async (revision, sourcePath) => {
  const {stdout} = await execFileAsync("/usr/bin/git", ["cat-file", "blob", `${revision}:${sourcePath}`], {
    cwd: repositoryRoot,
    encoding: null,
    env: {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      LANG: "C",
      LC_ALL: "C",
      PATH: "/usr/bin:/bin"
    }
  });
  return stdout;
};

test("authenticated Comments hideForm evidence preserves the exact actor and form-state differential", async () => {
  const contract = JSON.parse(await fs.readFile(casesPath, "utf8"));
  const artifact = JSON.parse(await fs.readFile(artifactPath, "utf8"));

  assert.equal(contract.schema, "wikijump.comments_hideform_actor_cases.v1");
  assert.equal(artifact.schema, "wikijump.forum_comments_hideform_actor_live.v1");
  assert.equal(artifact.surface_id, "module-comments");
  assert.equal(artifact.audit_case_id, "Q1034_COMMENTS_HIDEFORM_ACTOR_AND_FORM_STATE");
  assert.equal(artifact.site, "sandbox-for-codex");
  assert.equal(artifact.page_fullname, contract.page_fullname);
  assert.deepEqual(artifact.actor, {label: "A", authentication: "session", permission: "comment-permitted"});
  assert.equal(artifact.comment_mutation, false);
  assert.equal(artifact.capture_status, "complete");
  assert.equal(artifact.closure_status, "non_closing_evidence");
  assert.equal(artifact.cases_contract_sha256, sha256(await fs.readFile(casesPath)));
  assert.deepEqual(artifact.attempted_routes, ["authenticated served GET"]);

  assert.deepEqual(artifact.cases.map(({case_id}) => case_id), contract.cases.map(({case_id}) => case_id));
  assert.equal(new Set(artifact.cases.map(({page_id}) => page_id)).size, 1);
  for (const [index, observed] of artifact.cases.entries()) {
    const expected = contract.cases[index];
    assert.equal(observed.source, expected.source);
    assert.equal(observed.source_sha256, sha256(expected.source));
    assert.deepEqual(observed.source_setup.request, {
      method: "POST",
      url: "http://sandbox-for-codex.wikidot.com/ajax-module-connector.php",
      actor_label: "A",
      status: 200,
      envelope: "wikidot-json-status-ok",
      mutation_capable_request: true,
      purpose: "replace run-owned page source only"
    });
    assert.deepEqual(observed.initial_dom.request, {
      method: "GET",
      url: `http://sandbox-for-codex.wikidot.com/${contract.page_fullname}`,
      actor_label: "A",
      status: 200,
      envelope: "text/html",
      mutation_capable_request: false
    });
    assert.ok(Buffer.byteLength(observed.initial_dom.bounded_body, "utf8") <= contract.body_limit_bytes);
    assert.match(observed.initial_dom.body_sha256, /^[0-9a-f]{64}$/u);
    assert.match(observed.initial_dom.bounded_body_sha256, /^[0-9a-f]{64}$/u);
    assert.equal(observed.initial_dom.observation.comments_box_count, 1);
    assert.equal(typeof observed.initial_dom.observation.new_post_form_present, "boolean");
    assert.equal(typeof observed.initial_dom.observation.new_post_button_present, "boolean");
    assert.deepEqual(observed.actions, {
      requests_sent: [],
      comment_form_opened: false,
      comment_submitted: false,
      mutation_capable_request_sent: false
    });
  }

  const byId = new Map(artifact.cases.map((entry) => [entry.case_id, entry]));
  assert.equal(new Set(artifact.cases.map(({initial_dom}) => initial_dom.body_sha256)).size, 1);
  for (const caseId of contract.cases.map(({case_id}) => case_id)) {
    assert.equal(byId.get(caseId).initial_dom.observation.new_post_form_present, false);
    assert.equal(byId.get(caseId).initial_dom.observation.new_post_button_present, true);
    assert.deepEqual(byId.get(caseId).initial_dom.observation.new_post_action_markers, []);
  }
  assert.match(artifact.observed_rules.scalar_differential, /same bounded page-content body/u);
  assert.equal(artifact.promotable_rules.length, 2);
  assert.match(artifact.remaining_gap, /Browser execution/u);

  assert.equal(artifact.cleanup.original_source_restored, true);
  assert.equal(artifact.cleanup.restored_source_sha256, artifact.cleanup.original_source_sha256);
  assert.equal(artifact.cleanup.restored_page_id, artifact.cleanup.original_page_id);
  assert.equal(artifact.cleanup.created_fixture_removed, true);
  assert.equal(artifact.cleanup.page_absent_after_removal, true);
  assert.deepEqual(artifact.redactions, ["credentials", "cookies", "session identifiers", "CSRF tokens", "page edit lock fields"]);
});

test("issue #1367 browser run contract varies actor and hideForm independently", async () => {
  const contract = JSON.parse(await fs.readFile(browserContractPath, "utf8"));
  assert.equal(contract.schema, "wikijump.comments_hideform_browser_run.v1");
  assert.equal(contract.issue, 1367);
  assert.equal(contract.status, "blocked_authority");
  assert.match(contract.source_revision, /^[0-9a-f]{40}$/u);

  const casesBytes = await gitBlob(contract.source_revision, contract.inputs.cases.path);
  assert.equal(sha256(casesBytes), contract.inputs.cases.sha256);
  const priorCases = JSON.parse(casesBytes.toString("utf8")).cases;
  assert.deepEqual(contract.sources, priorCases.slice(0, 4).map(({case_id, source}) => ({
    case_id,
    source,
    source_sha256: sha256(source)
  })));

  const artifactBytes = await gitBlob(contract.source_revision, contract.inputs.historical_artifact.path);
  assert.equal(sha256(artifactBytes), contract.inputs.historical_artifact.sha256);
  assert.equal(contract.inputs.historical_artifact.classification, "non_closing_historical");
  assert.deepEqual(contract.actors, [
    {label: "A", authentication: "session", permission: "comment-permitted"},
    {label: "B", authentication: "session", permission: "comment-denied"}
  ]);
  assert.equal(contract.actors.length * contract.sources.length, 8);
  assert.deepEqual(contract.required_intervals, ["domcontentloaded", "settled"]);
  assert.deepEqual(contract.preflight_required, [
    "actor_a_identity", "actor_b_identity", "authority_state_sha256", "browser_identity",
    "evidence_output_path", "fixture_fullname", "run_id"
  ]);
  assert.deepEqual(contract.evidence_fields, [
    "actor", "browser_identity", "case_id", "console_errors", "dom", "failed_requests",
    "form_present", "http_errors", "interval", "new_post_button_present", "page_errors",
    "screenshot", "source_sha256", "timestamp", "url"
  ]);
  assert.deepEqual(contract.authority, {
    required: [
      "authenticated-denied-actor",
      "authenticated-permitted-actor",
      "browser",
      "run-owned-sandbox-page-mutation"
    ],
    current: "not_authorized",
    source: "/home/roku/wjlab/state/current.json"
  });
  assert.deepEqual(contract.fixture, {
    site: "sandbox-for-codex",
    page_fullname_prefix: "codex-comments-hideform-browser-",
    preexisting_page_forbidden: true
  });
  assert.equal(contract.cleanup.required, true);
  assert.equal(contract.cleanup.page_absent_after_removal, true);
  assert.deepEqual(contract.redactions, ["credentials", "cookies", "session identifiers", "CSRF tokens", "page edit lock fields"]);
});
