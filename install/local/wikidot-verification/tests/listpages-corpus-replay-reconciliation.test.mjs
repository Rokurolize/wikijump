import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  reconcileListPagesCorpusReplay,
} from "../src/listpages-corpus-replay-reconciliation.mjs";
import {
  classifyListPagesPreviewDifferential,
} from "../src/listpages-preview-classification.mjs";
import {
  compareListPagesPreviewHtml,
  LISTPAGES_PREVIEW_DIFFERENTIAL_SCHEMA,
  LISTPAGES_REPLAY_RUNTIME_IDENTITY_SCHEMA,
  LISTPAGES_REPLAY_RUNTIME_PROOF_SCHEMA,
} from "../src/listpages-preview-differential.mjs";
import {
  main as reconcileCli,
  parseArgs as parseReconcileArgs,
} from "../scripts/reconcile-listpages-corpus-replay.mjs";
import {
  sha256,
  visibleText,
} from "../src/syntax-differential.mjs";

async function writeJsonl(filePath, rows) {
  await fs.writeFile(
    filePath,
    rows.map((row) => `${JSON.stringify(row)}\n`).join(""),
  );
}

function invocation(id, source, pageFullname) {
  return {
    id,
    source,
    source_sha256: sha256(source),
    execution_context: "executable",
    literal_owner: null,
    context_replay_source: null,
    context_replay_source_sha256: null,
    semantic_cluster_key: "cluster",
    provenance: {
      branch: "en",
      page_fullname: pageFullname,
      source_path: `/corpus/en/pages/${pageFullname}/source.wikidot.txt`,
      line_start: 1,
      line_end: 1,
    },
  };
}

function classifiedCase(caseId, source, {
  classification = "matched",
  disposition = "none",
  differentialStatus = "match",
} = {}) {
  return {
    case_id: caseId,
    source,
    source_sha256: sha256(source),
    differential_status: differentialStatus,
    classification,
    disposition,
    rationale: `${classification} rationale`,
  };
}

async function fixture({ invocations, cases }) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-corpus-replay-"),
  );
  const invocationsPath = path.join(root, "invocations.jsonl");
  const classificationPath = path.join(root, "classification.json");
  await writeJsonl(invocationsPath, invocations);
  await fs.writeFile(
    classificationPath,
    `${JSON.stringify({
      schema: "wikijump_listpages_compat.preview_classification.v1",
      inputs: {
        verdict_path: "/evidence/verdict.json",
        references_path: "/evidence/references.jsonl",
      },
      cases,
    })}\n`,
  );
  return { invocationsPath, classificationPath };
}

test("maps one exact-source live classification to every corpus provenance", async () => {
  const source = "[[module ListPages]]%%title%%[[/module]]";
  const inputs = await fixture({
    invocations: [
      invocation("en:alpha:L1:B0", source, "alpha"),
      invocation("en:beta:L1:B0", source, "beta"),
    ],
    cases: [classifiedCase("en:alpha:L1:B0", source)],
  });

  const reconciliation = await reconcileListPagesCorpusReplay(inputs);

  assert.deepEqual(reconciliation.summary, {
    invocation_count: 2,
    unique_source_count: 1,
    exact_source_duplicate_count: 1,
    directly_captured_invocation_count: 1,
    classified_invocation_count: 2,
    unresolved_invocation_count: 0,
    actionable_unique_source_count: 0,
    actionable_invocation_count: 0,
    differential_statuses: { match: 2 },
    classifications: { matched: 2 },
    dispositions: { none: 2 },
    exit_code: 2,
  });
  assert.equal(reconciliation.cases[1].representative_case_id, "en:alpha:L1:B0");
  assert.equal(reconciliation.cases[1].direct_live_capture, false);
  assert.equal(reconciliation.cases[1].verification_status, "classified");
  assert.equal(reconciliation.cases[1].provenance.page_fullname, "beta");
});

test("reports actionable classifications across every exact-source occurrence", async () => {
  const source = '[[module ListPages rating="wat"]]x[[/module]]';
  const inputs = await fixture({
    invocations: [
      invocation("en:alpha:L1:B0", source, "alpha"),
      invocation("en:beta:L1:B0", source, "beta"),
    ],
    cases: [
      classifiedCase("en:alpha:L1:B0", source, {
        classification: "invalid-rating-error",
        disposition: "fix",
        differentialStatus: "mismatch",
      }),
    ],
  });

  const reconciliation = await reconcileListPagesCorpusReplay(inputs);

  assert.equal(reconciliation.summary.actionable_unique_source_count, 1);
  assert.equal(reconciliation.summary.actionable_invocation_count, 2);
  assert.equal(reconciliation.summary.exit_code, 1);
  assert.deepEqual(reconciliation.actionable_case_ids, [
    "en:alpha:L1:B0",
    "en:beta:L1:B0",
  ]);
});

test("reconciles memory-bounded classification shards as one exact-source set", async () => {
  const firstSource = "[[module ListPages]]first[[/module]]";
  const secondSource = "[[module ListPages]]second[[/module]]";
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-corpus-replay-shards-"),
  );
  const invocationsPath = path.join(root, "invocations.jsonl");
  await writeJsonl(invocationsPath, [
    invocation("en:first:L1:B0", firstSource, "first"),
    invocation("en:second:L1:B0", secondSource, "second"),
  ]);
  const classificationPaths = [];
  for (const [index, row] of [
    classifiedCase("en:first:L1:B0", firstSource),
    classifiedCase("en:second:L1:B0", secondSource),
  ].entries()) {
    const classificationPath = path.join(root, `classification-${index}.json`);
    await fs.writeFile(
      classificationPath,
      `${JSON.stringify({
        schema: "wikijump_listpages_compat.preview_classification.v1",
        inputs: {
          verdict_path: `/evidence/verdict-${index}.json`,
          references_path: `/evidence/references-${index}.jsonl`,
        },
        cases: [row],
      })}\n`,
    );
    classificationPaths.push(classificationPath);
  }

  const reconciliation = await reconcileListPagesCorpusReplay({
    invocationsPath,
    classificationPaths,
  });

  assert.equal(reconciliation.summary.unique_source_count, 2);
  assert.equal(reconciliation.summary.classified_invocation_count, 2);
  assert.equal(reconciliation.inputs.classifications.length, 2);
});

test("reuses refreshed shards when a stable case ID acquired a new source", async () => {
  const oldSource = "[[module ListPages]]old boundary[[/module]]";
  const currentSource = "{{[[module ListPages]]new literal boundary[[/module]]}}";
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-corpus-replay-refresh-"),
  );
  const invocationsPath = path.join(root, "invocations.jsonl");
  await writeJsonl(invocationsPath, [
    invocation("en:stable:L1:B0", currentSource, "stable"),
  ]);
  const classificationPaths = [];
  for (const [index, row] of [
    classifiedCase("en:stable:L1:B0", oldSource, {
      classification: "old-classification",
      disposition: "investigate",
      differentialStatus: "mismatch",
    }),
    classifiedCase("en:stable:L1:B0", currentSource),
  ].entries()) {
    const classificationPath = path.join(root, `classification-${index}.json`);
    await fs.writeFile(
      classificationPath,
      `${JSON.stringify({
        schema: "wikijump_listpages_compat.preview_classification.v1",
        inputs: {},
        cases: [row],
      })}\n`,
    );
    classificationPaths.push(classificationPath);
  }

  const reconciliation = await reconcileListPagesCorpusReplay({
    invocationsPath,
    classificationPaths,
  });

  assert.equal(reconciliation.summary.classified_invocation_count, 1);
  assert.equal(reconciliation.cases[0].classification, "matched");
  assert.deepEqual(
    reconciliation.inputs.classifications.map((input) => ({
      current: input.current_case_count,
      stale: input.stale_case_count,
    })),
    [
      { current: 0, stale: 1 },
      { current: 1, stale: 0 },
    ],
  );
});

test("reuses exact-source evidence whose original representative left the corpus", async () => {
  const source = "[[module ListPages]]shared exact source[[/module]]";
  const inputs = await fixture({
    invocations: [invocation("en:current:L1:B0", source, "current")],
    cases: [classifiedCase("en:historical:L9:B9", source)],
  });

  const reconciliation = await reconcileListPagesCorpusReplay(inputs);

  assert.equal(reconciliation.summary.classified_invocation_count, 1);
  assert.equal(
    reconciliation.cases[0].representative_case_id,
    "en:historical:L9:B9",
  );
  assert.equal(reconciliation.cases[0].direct_live_capture, false);
});

test("reconciles literal occurrences through their preserved owner context", async () => {
  const extracted = "[[module ListPages]]literal example[[/module]]";
  const replay = `{{${extracted}}}`;
  const row = invocation("en:literal:L1:B0", extracted, "literal");
  row.execution_context = "literal";
  row.literal_owner = "inline-monospace";
  row.context_replay_source = replay;
  row.context_replay_source_sha256 = sha256(replay);
  const inputs = await fixture({
    invocations: [row],
    cases: [classifiedCase("en:literal:L1:B0:literal-context", replay)],
  });

  const reconciliation = await reconcileListPagesCorpusReplay(inputs);

  assert.equal(reconciliation.summary.classified_invocation_count, 1);
  assert.equal(reconciliation.summary.directly_captured_invocation_count, 1);
  assert.equal(reconciliation.cases[0].source_sha256, sha256(extracted));
  assert.equal(reconciliation.cases[0].replay_source_sha256, sha256(replay));
  assert.equal(reconciliation.cases[0].classification, "matched");
});

test("reconciles repeated literal occurrences inside an argument-bearing code head", async () => {
  const extracted = "[[module ListPages]]literal CSS example[[/module]]";
  const replay =
    `[[code type="css"]]\n${extracted}\n${extracted}\n[[/code]]`;
  const row = invocation("en:literal-code:L2:B20", extracted, "literal-code");
  row.execution_context = "literal";
  row.literal_owner = "code-block";
  row.context_replay_source = replay;
  row.context_replay_source_sha256 = sha256(replay);
  const inputs = await fixture({
    invocations: [row],
    cases: [
      classifiedCase("en:literal-code:L2:B20:literal-context", replay),
    ],
  });

  const reconciliation = await reconcileListPagesCorpusReplay(inputs);

  assert.equal(reconciliation.summary.classified_invocation_count, 1);
  assert.equal(reconciliation.summary.directly_captured_invocation_count, 1);
  assert.equal(reconciliation.cases[0].replay_source_sha256, sha256(replay));
});

test("measures an invocation with no exact-source classification", async () => {
  const classified = "[[module ListPages]]x[[/module]]";
  const missing = "[[module ListPages]]y[[/module]]";
  const inputs = await fixture({
    invocations: [invocation("en:missing:L1:B0", missing, "missing")],
    cases: [classifiedCase("en:other:L1:B0", classified)],
  });

  const reconciliation = await reconcileListPagesCorpusReplay(inputs);

  assert.equal(reconciliation.summary.unresolved_invocation_count, 1);
  assert.equal(reconciliation.summary.classified_invocation_count, 0);
  assert.equal(reconciliation.summary.actionable_unique_source_count, 1);
  assert.equal(reconciliation.summary.actionable_invocation_count, 1);
  assert.equal(reconciliation.summary.exit_code, 1);
  assert.deepEqual(reconciliation.actionable_case_ids, ["en:missing:L1:B0"]);
  assert.equal(reconciliation.cases[0].verification_status, "unresolved");
  assert.equal(reconciliation.cases[0].classification, "unresolved");
});

test("rejects an invocation whose preserved source identity is inconsistent", async () => {
  const source = "[[module ListPages]]x[[/module]]";
  const row = invocation("en:alpha:L1:B0", source, "alpha");
  row.source_sha256 = "0".repeat(64);
  const inputs = await fixture({
    invocations: [row],
    cases: [classifiedCase("en:alpha:L1:B0", source)],
  });

  await assert.rejects(
    reconcileListPagesCorpusReplay(inputs),
    /source identity is invalid/,
  );
});

test("CLI writes a no-replace corpus reconciliation artifact", async () => {
  const source = "[[module ListPages]]%%title%%[[/module]]";
  const inputs = await fixture({
    invocations: [invocation("en:alpha:L1:B0", source, "alpha")],
    cases: [classifiedCase("en:alpha:L1:B0", source)],
  });
  const output = path.join(path.dirname(inputs.invocationsPath), "result.json");

  const code = await reconcileCli([
    "node",
    "reconcile-listpages-corpus-replay.mjs",
    "--invocations",
    inputs.invocationsPath,
    "--classification",
    inputs.classificationPath,
    "--output",
    output,
  ]);

  assert.equal(code, 2);
  const result = JSON.parse(await fs.readFile(output, "utf8"));
  assert.equal(result.summary.classified_invocation_count, 1);
  assert.equal((await fs.stat(output)).mode & 0o777, 0o400);
  await assert.rejects(
    reconcileCli([
      "node",
      "reconcile-listpages-corpus-replay.mjs",
      "--invocations",
      inputs.invocationsPath,
      "--classification",
      inputs.classificationPath,
      "--output",
      output,
    ]),
    /EEXIST/,
  );
});

test("CLI accepts repeatable classification shards", async () => {
  const firstSource = "[[module ListPages]]first[[/module]]";
  const secondSource = "[[module ListPages]]second[[/module]]";
  const first = await fixture({
    invocations: [
      invocation("en:first:L1:B0", firstSource, "first"),
      invocation("en:second:L1:B0", secondSource, "second"),
    ],
    cases: [classifiedCase("en:first:L1:B0", firstSource)],
  });
  const second = await fixture({
    invocations: [],
    cases: [classifiedCase("en:second:L1:B0", secondSource)],
  });
  const output = path.join(path.dirname(first.invocationsPath), "sharded-result.json");

  const code = await reconcileCli([
    "node",
    "reconcile-listpages-corpus-replay.mjs",
    "--invocations",
    first.invocationsPath,
    "--classification",
    first.classificationPath,
    "--classification",
    second.classificationPath,
    "--output",
    output,
  ]);

  assert.equal(code, 2);
  const result = JSON.parse(await fs.readFile(output, "utf8"));
  assert.equal(result.summary.classified_invocation_count, 2);
  assert.equal(result.inputs.classifications.length, 2);
});

test("authoritative reconciliation revalidates the transitive runtime chain", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-authoritative-reconcile-"),
  );
  const source = "[[module ListPages]]exact[[/module]]";
  const invocationsPath = path.join(root, "invocations.jsonl");
  const classificationPath = path.join(root, "classification.json");
  const verdictPath = path.join(root, "verdict.json");
  const referencesPath = path.join(root, "references.jsonl");
  const runtimeIdentityPath = path.join(root, "runtime-identity.json");
  const runtimeProofPath = path.join(root, "runtime-proof.json");
  const runtimeIdentity = {
    schema: LISTPAGES_REPLAY_RUNTIME_IDENTITY_SCHEMA,
    wikijump_sha: "1".repeat(40),
    wikijump_tree: "2".repeat(40),
    ftml_sha: "3".repeat(40),
    dependency_lock_sha256: "4".repeat(64),
    build_manifest_sha256: "a".repeat(64),
    build_artifact_key: `candidate-v3-${"b".repeat(64)}`,
    executable_sha256: "5".repeat(64),
    runtime_config_sha256: "6".repeat(64),
    runtime_environment_sha256: "0".repeat(64),
    profile: "release",
    rpc_url: "http://127.0.0.1:12747/jsonrpc",
    site_slug: "sandbox-for-codex",
    site_id: 7,
    service_image_sha256: {
      deepwell: "5".repeat(64),
      database: "7".repeat(64),
      cache: "8".repeat(64),
      files: "9".repeat(64),
    },
    service_host_port: { cache: 26379, database: 25432, files: 29000 },
  };
  const runtimeProof = {
    schema: LISTPAGES_REPLAY_RUNTIME_PROOF_SCHEMA,
    observed_at: "2026-07-30T00:00:00.000Z",
    run_nonce: "d".repeat(64),
    candidate: {
      wikijump_sha: runtimeIdentity.wikijump_sha,
      wikijump_tree: runtimeIdentity.wikijump_tree,
      ftml_sha: runtimeIdentity.ftml_sha,
      dependency_lock_sha256: runtimeIdentity.dependency_lock_sha256,
      build_manifest_sha256: runtimeIdentity.build_manifest_sha256,
      build_artifact_key: runtimeIdentity.build_artifact_key,
      executable_sha256: runtimeIdentity.executable_sha256,
      runtime_config_sha256: runtimeIdentity.runtime_config_sha256,
      runtime_environment_sha256:
        runtimeIdentity.runtime_environment_sha256,
      profile: runtimeIdentity.profile,
    },
    rpc_url: runtimeIdentity.rpc_url,
    site_slug: runtimeIdentity.site_slug,
    site_id: runtimeIdentity.site_id,
    service_image_sha256: { ...runtimeIdentity.service_image_sha256 },
    service_host_port: { ...runtimeIdentity.service_host_port },
    process: {
      pid: 1234,
      start_ticks: "5678",
      config_path: "/tmp/runtime.toml",
      build_manifest_path: "/tmp/manifest.json",
    },
    service_containers: {
      cache: "a".repeat(64),
      database: "b".repeat(64),
      files: "c".repeat(64),
    },
  };
  const runtimeIdentityText = `${JSON.stringify(runtimeIdentity)}\n`;
  const runtimeProofText = `${JSON.stringify(runtimeProof)}\n`;
  const rawHtml = "<p>exact</p>";
  const reference = {
    schema: "wikijump_syntax_differential.wikidot_reference.v1",
    syntax_case: {
      schema: "wikijump_syntax_differential.syntax_case.v1",
      case_id: "en:exact:L1:B0",
      source,
      title: "en:exact:L1:B0",
      wikidot_observation_tier: "page-preview",
      local_execution_tier: "wikijump-runtime",
    },
    source_sha256: sha256(source),
    captured_at: "2026-07-30T00:00:00.000Z",
    provenance: {
      site: "sandbox-for-codex",
      site_domain: "sandbox-for-codex.wikidot.com",
      module: "edit/PagePreviewModule",
      wikidot_py_version: "4.4.1",
      wikidot_py_commit: "4af7c8eaec00a3e7a29fe502234e0aeeef968233",
      requirements_sha256: "c".repeat(64),
      authenticated: false,
      mutated: false,
    },
    raw_html: rawHtml,
    raw_html_sha256: sha256(rawHtml),
  };
  const referencesText = `${JSON.stringify(reference)}\n`;
  const campaignScopePath = path.join(root, "scope.json");
  const validateCampaignScope = async () => ({
    path: campaignScopePath,
    sha256: "d".repeat(64),
    invocation_sha256: sha256(
      `${JSON.stringify(invocation("en:exact:L1:B0", source, "exact"))}\n`,
    ),
    invocation_count: 1,
    unique_replay_key_count: 1,
    live_reference_contract: {
      schema: "wikijump_syntax_differential.wikidot_reference.v1",
      sha256: sha256(referencesText),
      row_count: 1,
      site: "sandbox-for-codex",
      site_domain: "sandbox-for-codex.wikidot.com",
      module: "edit/PagePreviewModule",
      authenticated: false,
      mutated: false,
    },
    completion_contract: {
      classified_invocation_count: 1,
    },
  });
  await writeJsonl(invocationsPath, [
    invocation("en:exact:L1:B0", source, "exact"),
  ]);
  await fs.writeFile(runtimeIdentityPath, runtimeIdentityText);
  await fs.writeFile(runtimeProofPath, runtimeProofText);
  await fs.writeFile(referencesPath, referencesText);
  const observationStable = {
    run_nonce: runtimeProof.run_nonce,
    candidate: { ...runtimeProof.candidate },
    process: {
      pid: runtimeProof.process.pid,
      start_ticks: runtimeProof.process.start_ticks,
      executable_path: "/tmp/deepwell",
      executable_sha256: runtimeIdentity.executable_sha256,
      repository: "/tmp/wikijump",
      command_line_sha256: "e".repeat(64),
      environment_sha256: runtimeIdentity.runtime_environment_sha256,
      config_path: runtimeProof.process.config_path,
      config_sha256: runtimeIdentity.runtime_config_sha256,
      config_contents_sha256: runtimeIdentity.runtime_config_sha256,
      build_manifest_path: runtimeProof.process.build_manifest_path,
      build_manifest_sha256: runtimeIdentity.build_manifest_sha256,
    },
    rpc_url: runtimeIdentity.rpc_url,
    fixture_state_sha256: "f".repeat(64),
    random_cache_state_sha256: "a".repeat(64),
    services: Object.fromEntries(
      ["cache", "database", "files"].map((service) => [
        service,
        {
          container_id: runtimeProof.service_containers[service],
          image_sha256: runtimeIdentity.service_image_sha256[service],
          started_at: "2026-07-30T00:00:00.000Z",
          health: "healthy",
          host_port: runtimeIdentity.service_host_port[service],
        },
      ]),
    ),
  };
  const observationStableSha256 = sha256(JSON.stringify(observationStable));
  const beforeObservation = {
    schema: "wikijump_listpages_compat.runtime_observation.v1",
    status: "bound",
    phase: "before",
    observed_at: "2026-07-30T00:00:01.000Z",
    stable_sha256: observationStableSha256,
    stable: observationStable,
  };
  const afterObservation = {
    ...beforeObservation,
    phase: "after",
    observed_at: "2026-07-30T00:00:02.000Z",
  };
  const observeRuntime = async ({ phase }) => ({
    ...beforeObservation,
    phase,
    observed_at: "2026-07-30T00:00:03.000Z",
  });
  const verdict = {
    schema: LISTPAGES_PREVIEW_DIFFERENTIAL_SCHEMA,
    inputs: {
      authority: {
        mode: "authoritative",
        completion_eligible: true,
        runtime_observation_before_sha256: sha256(
          JSON.stringify(beforeObservation),
        ),
        runtime_observation_after_sha256: sha256(
          JSON.stringify(afterObservation),
        ),
        runtime_observation_stable_sha256: observationStableSha256,
      },
      runtime_identity_path: runtimeIdentityPath,
      runtime_identity_sha256: sha256(runtimeIdentityText),
      runtime_proof_path: runtimeProofPath,
      runtime_proof_sha256: sha256(runtimeProofText),
      references_path: referencesPath,
      references_sha256: sha256(referencesText),
    },
    runtime_observations: {
      before: beforeObservation,
      after: afterObservation,
    },
    cases: [{
      schema: `${LISTPAGES_PREVIEW_DIFFERENTIAL_SCHEMA}.case`,
      case_id: "en:exact:L1:B0",
      status: "match",
      live: {
        html_sha256: sha256(rawHtml),
        visible_text: visibleText(rawHtml),
      },
      local: {
        raw_html: rawHtml,
        html_sha256: sha256(rawHtml),
        visible_text: visibleText(rawHtml),
        styles: [],
      },
      comparison: compareListPagesPreviewHtml(reference, rawHtml),
    }],
    summary: {
      total: 1,
      counts: { match: 1 },
      exit_code: 0,
    },
  };
  const verdictText = `${JSON.stringify(verdict)}\n`;
  await fs.writeFile(verdictPath, verdictText);
  const classification = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
    authoritative: true,
    observeRuntime,
  });
  await fs.writeFile(
    classificationPath,
    `${JSON.stringify(classification)}\n`,
  );

  let replayCalls = 0;
  const reconciliation = await reconcileListPagesCorpusReplay({
    invocationsPath,
    classificationPaths: [classificationPath],
    authoritative: true,
    campaignScopePath,
    validateCampaignScope,
    observeRuntime,
    replayPreview: async () => {
      replayCalls += 1;
      return verdict;
    },
  });
  assert.equal(reconciliation.inputs.authority.completion_eligible, true);
  assert.equal(reconciliation.summary.exit_code, 0);
  assert.equal(replayCalls, 0);
  assert.equal(
    reconciliation.inputs.classifications[0].authoritative_replay.mode,
    "bound-classification",
  );

  const actualMismatch = structuredClone(verdict);
  const actualLocalHtml = "<p>TODO: module ListPages</p>";
  actualMismatch.cases[0].local.raw_html = actualLocalHtml;
  actualMismatch.cases[0].local.html_sha256 = sha256(actualLocalHtml);
  actualMismatch.cases[0].local.visible_text = visibleText(actualLocalHtml);
  actualMismatch.cases[0].comparison = compareListPagesPreviewHtml(
    reference,
    actualLocalHtml,
  );
  actualMismatch.cases[0].status = "mismatch";
  actualMismatch.summary = {
    total: 1,
    counts: { mismatch: 1 },
    exit_code: 1,
  };
  const fallbackClassification = JSON.parse(
    await fs.readFile(classificationPath, "utf8"),
  );
  fallbackClassification.inputs.authority.runtime_observation_stable_sha256 =
    "0".repeat(64);
  await fs.writeFile(
    classificationPath,
    `${JSON.stringify(fallbackClassification)}\n`,
  );
  replayCalls = 0;
  const replayedMismatch = await reconcileListPagesCorpusReplay({
    invocationsPath,
    classificationPaths: [classificationPath],
    authoritative: true,
    campaignScopePath,
    validateCampaignScope,
    observeRuntime,
    replayPreview: async () => {
      replayCalls += 1;
      return actualMismatch;
    },
  });
  assert.equal(replayedMismatch.summary.actionable_unique_source_count, 1);
  assert.equal(replayedMismatch.summary.exit_code, 1);
  assert.equal(replayCalls, 1);
  assert.equal(
    replayedMismatch.inputs.classifications[0].authoritative_replay.mode,
    "replayed-verdict",
  );

  await fs.writeFile(runtimeProofPath, '{"proof":"changed"}\n');
  await assert.rejects(
    reconcileListPagesCorpusReplay({
      invocationsPath,
      classificationPaths: [classificationPath],
      authoritative: true,
      campaignScopePath,
      validateCampaignScope,
      observeRuntime,
    }),
    /runtime proof changed after (?:the preview verdict|preview classification)/,
  );
  await fs.writeFile(runtimeProofPath, runtimeProofText);

  const forged = JSON.parse(await fs.readFile(classificationPath, "utf8"));
  forged.cases[0].classification = "forged-benign";
  await fs.writeFile(classificationPath, `${JSON.stringify(forged)}\n`);
  await assert.rejects(
    reconcileListPagesCorpusReplay({
      invocationsPath,
      classificationPaths: [classificationPath],
      authoritative: true,
      campaignScopePath,
      validateCampaignScope,
      observeRuntime,
    }),
    /differs from canonical recomputation/,
  );

  const diagnostic = classification;
  diagnostic.inputs.authority = {
    mode: "diagnostic",
    completion_eligible: false,
  };
  await fs.writeFile(classificationPath, `${JSON.stringify(diagnostic)}\n`);
  await assert.rejects(
    reconcileListPagesCorpusReplay({
      invocationsPath,
      classificationPaths: [classificationPath],
      authoritative: true,
      campaignScopePath,
      validateCampaignScope,
      observeRuntime,
    }),
    /authoritative reconciliation requires authoritative classifications/,
  );
});

test("reconciliation CLI exposes the authoritative completion gate", () => {
  const parsed = parseReconcileArgs([
    "node",
    "reconcile-listpages-corpus-replay.mjs",
    "--invocations",
    "invocations.jsonl",
    "--classification",
    "classification.json",
    "--authoritative",
    "--campaign-scope",
    "scope.json",
    "--output",
    "reconciliation.json",
  ]);
  assert.equal(parsed.authoritative, true);
  assert.match(parsed.campaignScope, /scope\.json$/u);
});
