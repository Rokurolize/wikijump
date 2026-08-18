import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  aggregateCandidateCaseCampaign,
} from "../scripts/aggregate-candidate-case-campaign.mjs";
import {buildCandidateCaseSetManifest} from "../scripts/build-candidate-case-set-manifest.mjs";
import {
  CANDIDATE_CASE_AGGREGATE_SCHEMA,
  CANDIDATE_CASE_RECEIPT_SCHEMA,
} from "../src/candidate-case-runner.mjs";
import {sha256Value} from "../src/standing-browser-parity-util.mjs";

const mixed = (first, second, length) => `${first}${second}`.repeat(length / 2);
const hash = (first, second = "1") => mixed(first, second, 64);
const git = (first, second = "1") => mixed(first, second, 40);
const image = (first, second = "1") => `sha256:${hash(first, second)}`;
const runId = "candidate-run-0123456789ab";

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a", "1"),
    build: {
      seal_sha256: hash("b", "2"),
      verdict_sha256: hash("c", "3"),
      final_images_sha256: hash("d", "4"),
    },
    candidate: {
      owner: "candidate-campaign-test",
      expires_at: "2099-08-18T00:00:00.000Z",
      compose_project: "wikijump-candidate-campaign-test",
      port_443_published: false,
      wikijump_commit: git("1", "2"),
      wikijump_tree: git("2", "3"),
      ftml_sha: git("3", "4"),
      profile: "production-build",
      source_clean: true,
      images: {caddy: image("e", "5")},
      config: {
        isolated_overlay_sha256: hash("f", "6"),
        promotion_base_manifest_sha256: hash("7", "8"),
        effective_runtime_services_sha256: hash("8", "9"),
      },
      endpoint: {
        scheme: "https",
        host: "scpaiueouiuiuiui.wikijump.localhost",
        port: 18443,
        resolved_addresses: ["127.0.0.1"],
        allowed_origin_set: [
          "https://scpaiueouiuiuiui.wikijump.localhost:18443",
          "https://scpaiueouiuiuiui.wjfiles.localhost:18443",
        ],
        local_connect_address: "127.0.0.1",
      },
    },
    evidence: {
      status: "sealed",
      manifest_sha256: hash("9", "a"),
      seal_sha256: hash("a", "b"),
    },
  };
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), {recursive: true});
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600});
}

async function sha256File(filePath) {
  const {createHash} = await import("node:crypto");
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function campaignFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-campaign-"));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const identityPath = path.join(root, "identity.json");
  const manifestPath = path.join(root, "manifest.json");
  const identity = candidateIdentity();
  const manifest = buildCandidateCaseSetManifest();
  await writeJson(identityPath, identity);
  await writeJson(manifestPath, manifest);
  const identitySha = await sha256File(identityPath);
  const receipts = [];
  for (const [setIndex, row] of manifest.case_sets.entries()) {
    const directory = path.join(root, `set-${String(setIndex).padStart(2, "0")}`);
    const cases = [];
    for (const [caseIndex, caseId] of row.case_ids.entries()) {
      const casePath = path.join(directory, "cases", `${caseId}.json`);
      await writeJson(casePath, {
        schema: CANDIDATE_CASE_RECEIPT_SCHEMA,
        status: "pass",
        run_id: runId,
        candidate_case_set: row.name,
        case_id: caseId,
        candidate_identity_sha256: identitySha,
        marker: `${setIndex}:${caseIndex}`,
      });
      cases.push({case_id: caseId, path: casePath, sha256: await sha256File(casePath)});
    }
    await writeJson(path.join(directory, "cleanup.json"), {
      schema: "wikijump.candidate_case_cleanup.v1",
      status: "pass",
      run_id: runId,
      proof: {}, resources: [], public_absence_verified: true,
      resources_released: true, vacant: true, browser_closed: true, reason: null,
    });
    const receiptPath = path.join(directory, "candidate-case-receipt.json");
    await writeJson(receiptPath, {
      schema: CANDIDATE_CASE_AGGREGATE_SCHEMA,
      status: "pass",
      run_id: runId,
      candidate_case_set: row.name,
      candidate_identity_sha256: identitySha,
      denominator: {
        count: row.case_ids.length,
        case_ids: row.case_ids,
        sha256: sha256Value(row.case_ids),
      },
      runtime_identity: {stable: true},
      cleanup: {public_absence_verified: true},
      cleanup_receipt: "cleanup.json",
      resources: [],
      cases,
    });
    receipts.push(receiptPath);
  }
  return {root, identityPath, manifestPath, receipts, manifest};
}

test("candidate campaign aggregate exactly covers every execution case set and case once", async (t) => {
  const fixture = await campaignFixture(t);
  const aggregate = await aggregateCandidateCaseCampaign({
    candidateIdentityPath: fixture.identityPath,
    manifestPath: fixture.manifestPath,
    receiptPaths: fixture.receipts,
    now: new Date("2026-08-18T00:00:00.000Z"),
  });
  assert.equal(aggregate.status, "pass");
  assert.equal(aggregate.execution_case_set_count, fixture.manifest.execution_case_set_count);
  assert.equal(aggregate.case_count, fixture.manifest.case_sets.reduce((count, row) => count + row.case_ids.length, 0));
  assert.equal(new Set(aggregate.cases.map(({case_id}) => case_id)).size, aggregate.case_count);
  assert.equal(aggregate.case_sets.every(({cleanup}) => /^[0-9a-f]{64}$/u.test(cleanup.sha256)), true);
});

test("candidate campaign accepts site-bound identity projections only for one sealed runtime", async (t) => {
  const fixture = await campaignFixture(t);
  const primary = JSON.parse(await fs.readFile(fixture.identityPath, "utf8"));
  const projected = structuredClone(primary);
  projected.candidate.endpoint.host = "scp-wiki.wikijump.localhost";
  projected.candidate.endpoint.allowed_origin_set = [
    "https://scp-wiki.wikijump.localhost:18443",
    "https://scp-wiki.wjfiles.localhost:18443",
  ];
  const projectedPath = path.join(fixture.root, "identity-scp-wiki.json");
  await writeJson(projectedPath, projected);
  const projectedSha = await sha256File(projectedPath);

  const receiptPath = fixture.receipts[0];
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
  receipt.candidate_identity_sha256 = projectedSha;
  for (const caseRef of receipt.cases) {
    const caseValue = JSON.parse(await fs.readFile(caseRef.path, "utf8"));
    caseValue.candidate_identity_sha256 = projectedSha;
    await writeJson(caseRef.path, caseValue);
    caseRef.sha256 = await sha256File(caseRef.path);
  }
  await writeJson(receiptPath, receipt);

  const aggregate = await aggregateCandidateCaseCampaign({
    candidateIdentityPaths: [fixture.identityPath, projectedPath],
    manifestPath: fixture.manifestPath,
    receiptPaths: fixture.receipts,
    now: new Date("2026-08-18T00:00:00.000Z"),
  });
  assert.equal(aggregate.status, "pass");
  assert.equal(aggregate.candidate_identity_projections.length, 2);

  projected.artifact_key = hash("f", "0");
  await writeJson(projectedPath, projected);
  await assert.rejects(
    aggregateCandidateCaseCampaign({
      candidateIdentityPaths: [fixture.identityPath, projectedPath],
      manifestPath: fixture.manifestPath,
      receiptPaths: fixture.receipts,
      now: new Date("2026-08-18T00:00:00.000Z"),
    }),
    /do not bind the same runtime/u,
  );
});

test("candidate campaign aggregate fails closed on missing, duplicate, or cross-run receipts", async (t) => {
  const fixture = await campaignFixture(t);
  await assert.rejects(
    aggregateCandidateCaseCampaign({
      candidateIdentityPath: fixture.identityPath,
      manifestPath: fixture.manifestPath,
      receiptPaths: fixture.receipts.slice(1),
      now: new Date("2026-08-18T00:00:00.000Z"),
    }),
    /exactly .* execution case-set receipts/u,
  );
  await assert.rejects(
    aggregateCandidateCaseCampaign({
      candidateIdentityPath: fixture.identityPath,
      manifestPath: fixture.manifestPath,
      receiptPaths: [...fixture.receipts.slice(0, -1), fixture.receipts[0]],
      now: new Date("2026-08-18T00:00:00.000Z"),
    }),
    /unknown or duplicate/u,
  );

  const changedPath = fixture.receipts[0];
  const changed = JSON.parse(await fs.readFile(changedPath));
  changed.run_id = "candidate-run-ffffffffffff";
  await writeJson(changedPath, changed);
  await assert.rejects(
    aggregateCandidateCaseCampaign({
      candidateIdentityPath: fixture.identityPath,
      manifestPath: fixture.manifestPath,
      receiptPaths: fixture.receipts,
      now: new Date("2026-08-18T00:00:00.000Z"),
    }),
    /different run IDs/u,
  );
});

test("candidate campaign aggregate verifies immutable case artifacts and cleanup", async (t) => {
  const fixture = await campaignFixture(t);
  const firstReceipt = JSON.parse(await fs.readFile(fixture.receipts[0]));
  await fs.appendFile(firstReceipt.cases[0].path, "drift");
  await assert.rejects(
    aggregateCandidateCaseCampaign({
      candidateIdentityPath: fixture.identityPath,
      manifestPath: fixture.manifestPath,
      receiptPaths: fixture.receipts,
      now: new Date("2026-08-18T00:00:00.000Z"),
    }),
    /identity moved/u,
  );
});
