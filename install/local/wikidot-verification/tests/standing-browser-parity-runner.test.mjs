import assert from "node:assert/strict";
import test from "node:test";

import { main as runParityCli, usage as parityCliUsage } from "../scripts/run-standing-browser-parity.mjs";
import { closeParityBrowserResources } from "../src/standing-browser-parity-browser-session.mjs";
import {
  isCandidateParityMode,
  parseStandingBrowserParityArgs,
  validateCandidateRefreshReceipt,
} from "../src/standing-browser-parity-runner.mjs";

const policy = "/tmp/standing-policy.json";

test("candidate diagnostic mode receives the same local browser topology as official candidate mode", () => {
  assert.equal(isCandidateParityMode("candidate"), true);
  assert.equal(isCandidateParityMode("candidate-diagnostic"), true);
  assert.equal(isCandidateParityMode("live-reference"), false);
});

test("standing parity CLI exposes result and help without opening a browser", async () => {
  const output = [];
  const code = await runParityCli(["node", "script", "--mode", "candidate"], {
    parseArgs: () => ({mode: "candidate"}),
    runParity: async () => ({mode: "candidate", status: "pass", output_dir: "/tmp/parity"}),
    stdout: (line) => output.push(JSON.parse(line)),
  });
  assert.equal(code, 0);
  assert.deepEqual(output, [{
    schema: "wikijump.standing_browser_parity_cli_result.v1",
    mode: "candidate",
    status: "pass",
    output_dir: "/tmp/parity",
  }]);
  assert.match(parityCliUsage(), /live-reference/u);
  assert.match(parityCliUsage(), /candidate-diagnostic/u);
});

test("parity browser cleanup attempts every resource and reports every failure", async () => {
  const attempts = [];
  const context = {
    async close() {
      attempts.push("context");
      throw new Error("context close failed");
    },
  };
  const browser = {
    async close() {
      attempts.push("browser");
      throw new Error("browser close failed");
    },
  };

  await assert.rejects(
    () => closeParityBrowserResources(context, browser),
    (error) => {
      assert(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      return true;
    },
  );
  assert.deepEqual(attempts, ["context", "browser"]);
});

test("live reference capture requires a policy before a browser can be opened", () => {
  const args = parseStandingBrowserParityArgs([
    "node",
    "runner",
    "--mode",
    "live-reference",
    "--output-dir",
    "/tmp/standing-reference",
    "--live-completion-policy",
    policy,
    "--viewport",
    "1440x960",
  ]);
  assert.equal(args.mode, "live-reference");
  assert.deepEqual(args.viewport, { width: 1440, height: 960 });
  assert.equal(args.timeoutMs, 900_000);
  assert.throws(
    () =>
      parseStandingBrowserParityArgs([
        "node",
        "runner",
        "--mode",
        "live-reference",
        "--output-dir",
        "/tmp/standing-reference",
      ]),
    /live-completion-policy/u,
  );
});

test("candidate capture requires its sealed identity and exact live reference digest", () => {
  assert.throws(
    () =>
      parseStandingBrowserParityArgs([
        "node",
        "runner",
        "--mode",
        "candidate",
        "--output-dir",
        "/tmp/standing-candidate",
        "--live-completion-policy",
        policy,
      ]),
    /candidate-identity/u,
  );
  const args = parseStandingBrowserParityArgs([
    "node",
    "runner",
    "--mode",
    "candidate",
    "--output-dir",
    "/tmp/standing-candidate",
    "--live-completion-policy",
    policy,
    "--candidate-identity",
    "/tmp/candidate.json",
    "--live-reference-ledger",
    "/tmp/reference.json",
    "--live-reference-sha256",
    "a".repeat(64),
  ]);
  assert.equal(args.mode, "candidate");
  assert.equal(args.liveReferenceSha256, "a".repeat(64));
});

test("candidate diagnostic capture requires the same sealed inputs but remains a distinct mode", () => {
  const args = parseStandingBrowserParityArgs([
    "node",
    "runner",
    "--mode",
    "candidate-diagnostic",
    "--output-dir",
    "/tmp/standing-candidate-diagnostic",
    "--live-completion-policy",
    policy,
    "--candidate-identity",
    "/tmp/candidate.json",
    "--live-reference-ledger",
    "/tmp/reference.json",
    "--live-reference-sha256",
    "b".repeat(64),
    "--candidate-refresh-receipt",
    "/tmp/refresh.json",
    "--candidate-refresh-sha256",
    "c".repeat(64),
  ]);
  assert.equal(args.mode, "candidate-diagnostic");
  assert.equal(args.liveReferenceSha256, "b".repeat(64));
  assert.equal(args.candidateRefreshSha256, "c".repeat(64));
});

test("official candidate mode refuses diagnostic refresh evidence", () => {
  assert.throws(
    () => parseStandingBrowserParityArgs([
      "node",
      "runner",
      "--mode",
      "candidate",
      "--output-dir",
      "/tmp/standing-candidate",
      "--live-completion-policy",
      policy,
      "--candidate-identity",
      "/tmp/candidate.json",
      "--live-reference-ledger",
      "/tmp/reference.json",
      "--live-reference-sha256",
      "a".repeat(64),
      "--candidate-refresh-receipt",
      "/tmp/refresh.json",
      "--candidate-refresh-sha256",
      "b".repeat(64),
    ]),
    /only in candidate-diagnostic mode/u,
  );
});

function renderedArtifact(overrides = {}) {
  return {
    page_id: 1,
    category_id: 2,
    revision_id: 3,
    source_sha256: "a".repeat(64),
    compiled_body_html_sha256: "b".repeat(64),
    compiled_body_styles_sha256: "c".repeat(64),
    compiled_generator: "ftml v1.42.0+roku.20260630.1; deepwell-render/v8",
    compiled_at: "2026-08-12T00:00:00.000Z",
    ...overrides,
  };
}

function diagnosticRefreshReceipt() {
  const targets = [
    ["scp-9506", 3000000026, 100000003],
    ["scp-744", 3000019112, 100000003],
    ["scp-2117", 3000013070, 100000003],
    ["scp-5516", 3000016951, 100000003],
    ["scp-8980", 3000020821, 100000003],
    ["theme:basalt", 3000000020, 100000005],
  ];
  return {
    schema: "wikijump.diagnostic_candidate_page_refresh.v2",
    status: "pass",
    classification: "diagnostic_non_promotional",
    controller: {path: "/controller.mjs", sha256: "f".repeat(64)},
    candidate_identity: {sha256: "d".repeat(64)},
    actor: {
      user_id: -1,
      authentication: "sealed_session_and_rpc_bearer",
      permission: "page_edit_checked_before_page_rerender",
    },
    site: {site_id: 6000006, slug: "scp-wiki"},
    rendered_artifact_authority: {
      ftml_sha: `${"62ebba4e"}${"0".repeat(32)}`,
      compiled_generator: "ftml v1.42.0+roku.20260630.1; deepwell-render/v8",
    },
    pages: targets.map(([slug, pageId, categoryId]) => ({
        slug,
        before: renderedArtifact({page_id: pageId, category_id: categoryId}),
        after: renderedArtifact({page_id: pageId, category_id: categoryId, compiled_body_html_sha256: "e".repeat(64)}),
        finalization_state: "page_rerender_endpoint_complete",
      })),
  };
}

const candidateIdentity = Object.freeze({
  sha256: "d".repeat(64),
  value: {candidate: {ftml_sha: `${"62ebba4e"}${"0".repeat(32)}`}},
});

test("candidate diagnostic refresh binds complete rendered artifact identities", () => {
  const receipt = diagnosticRefreshReceipt();
  assert.equal(validateCandidateRefreshReceipt(receipt, candidateIdentity), receipt);
  const staleSource = structuredClone(receipt);
  staleSource.pages[0].after.source_sha256 = "f".repeat(64);
  assert.throws(
    () => validateCandidateRefreshReceipt(staleSource, candidateIdentity),
    /changed source identity/u,
  );
  const missingFinalization = structuredClone(receipt);
  delete missingFinalization.pages[0].finalization_state;
  assert.throws(
    () => validateCandidateRefreshReceipt(missingFinalization, candidateIdentity),
    /page set is invalid/u,
  );
  const legacy = structuredClone(receipt);
  legacy.schema = "wikijump.diagnostic_candidate_page_refresh.v1";
  assert.throws(
    () => validateCandidateRefreshReceipt(legacy, candidateIdentity),
    /receipt is invalid/u,
  );
  const wrongRenderer = structuredClone(receipt);
  wrongRenderer.pages[0].after.compiled_generator = "ftml v0.0.0; deepwell-render/v8";
  assert.throws(
    () => validateCandidateRefreshReceipt(wrongRenderer, candidateIdentity),
    /renderer identity is invalid/u,
  );
  const wrongTarget = structuredClone(receipt);
  wrongTarget.pages[0].before.page_id = 99;
  wrongTarget.pages[0].after.page_id = 99;
  assert.throws(
    () => validateCandidateRefreshReceipt(wrongTarget, candidateIdentity),
    /target identity is invalid/u,
  );
});
