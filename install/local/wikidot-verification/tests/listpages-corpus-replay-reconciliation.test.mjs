import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  reconcileListPagesCorpusReplay,
} from "../src/listpages-corpus-replay-reconciliation.mjs";
import {
  main as reconcileCli,
  parseArgs as parseReconcileArgs,
} from "../scripts/reconcile-listpages-corpus-replay.mjs";
import { sha256 } from "../src/syntax-differential.mjs";

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
    exit_code: 0,
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
  row.literal_owner = "monospace";
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

test("fails closed when an invocation has no exact-source classification", async () => {
  const classified = "[[module ListPages]]x[[/module]]";
  const missing = "[[module ListPages]]y[[/module]]";
  const inputs = await fixture({
    invocations: [invocation("en:missing:L1:B0", missing, "missing")],
    cases: [classifiedCase("en:other:L1:B0", classified)],
  });

  await assert.rejects(
    reconcileListPagesCorpusReplay(inputs),
    /missing live\/local classification for corpus replay source/,
  );
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

  assert.equal(code, 0);
  const result = JSON.parse(await fs.readFile(output, "utf8"));
  assert.equal(result.summary.classified_invocation_count, 1);
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

  assert.equal(code, 0);
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
  const runtimeIdentityText = '{"identity":"exact"}\n';
  const runtimeProofText = '{"proof":"exact"}\n';
  const referencesText = "frozen references\n";
  await writeJsonl(invocationsPath, [
    invocation("en:exact:L1:B0", source, "exact"),
  ]);
  await fs.writeFile(runtimeIdentityPath, runtimeIdentityText);
  await fs.writeFile(runtimeProofPath, runtimeProofText);
  await fs.writeFile(referencesPath, referencesText);
  const verdict = {
    inputs: {
      authority: { mode: "authoritative", completion_eligible: true },
      runtime_identity_path: runtimeIdentityPath,
      runtime_identity_sha256: sha256(runtimeIdentityText),
      runtime_proof_path: runtimeProofPath,
      runtime_proof_sha256: sha256(runtimeProofText),
      references_path: referencesPath,
      references_sha256: sha256(referencesText),
    },
  };
  const verdictText = `${JSON.stringify(verdict)}\n`;
  await fs.writeFile(verdictPath, verdictText);
  await fs.writeFile(
    classificationPath,
    `${JSON.stringify({
      schema: "wikijump_listpages_compat.preview_classification.v1",
      inputs: {
        verdict_path: verdictPath,
        verdict_sha256: sha256(verdictText),
        references_path: referencesPath,
        references_sha256: sha256(referencesText),
        authority: {
          mode: "authoritative",
          completion_eligible: true,
          runtime_identity_sha256: sha256(runtimeIdentityText),
          runtime_proof_sha256: sha256(runtimeProofText),
        },
      },
      cases: [classifiedCase("en:exact:L1:B0", source)],
    })}\n`,
  );

  const reconciliation = await reconcileListPagesCorpusReplay({
    invocationsPath,
    classificationPaths: [classificationPath],
    authoritative: true,
  });
  assert.equal(reconciliation.inputs.authority.completion_eligible, true);

  await fs.writeFile(runtimeProofPath, '{"proof":"changed"}\n');
  await assert.rejects(
    reconcileListPagesCorpusReplay({
      invocationsPath,
      classificationPaths: [classificationPath],
      authoritative: true,
    }),
    /runtime proof changed after preview classification/,
  );

  const diagnostic = JSON.parse(await fs.readFile(classificationPath, "utf8"));
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
    "--output",
    "reconciliation.json",
  ]);
  assert.equal(parsed.authoritative, true);
});
