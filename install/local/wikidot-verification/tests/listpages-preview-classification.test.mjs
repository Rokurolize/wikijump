import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  classifyListPagesPreviewDifferential,
  writeListPagesPreviewClassification,
} from "../src/listpages-preview-classification.mjs";
import {
  parseArgs as parsePreviewClassificationArgs,
} from "../scripts/classify-listpages-preview-differential.mjs";
import {
  canonicalDom,
  sha256,
  visibleText,
} from "../src/syntax-differential.mjs";
import {
  compareListPagesPreviewHtml,
  LISTPAGES_PREVIEW_DIFFERENTIAL_SCHEMA,
  LISTPAGES_REPLAY_RUNTIME_IDENTITY_SCHEMA,
  LISTPAGES_REPLAY_RUNTIME_PROOF_SCHEMA,
} from "../src/listpages-preview-differential.mjs";

const referenceIdentities = new Map();

function reference(caseId, source, rawHtml) {
  const row = {
    schema: "wikijump_syntax_differential.wikidot_reference.v1",
    syntax_case: {
      schema: "wikijump_syntax_differential.syntax_case.v1",
      case_id: caseId,
      source,
      title: caseId,
      wikidot_observation_tier: "page-preview",
      local_execution_tier: "wikijump-runtime",
    },
    source_sha256: sha256(source),
    captured_at: "2026-07-27T00:00:00+00:00",
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
  referenceIdentities.set(caseId, {
    source_sha256: row.source_sha256,
    live_html_sha256: row.raw_html_sha256,
  });
  return row;
}

function mismatchCase(caseId, liveHtml, localHtml) {
  return {
    case_id: caseId,
    status: "mismatch",
    live: { visible_text: visibleText(liveHtml) },
    local: {
      visible_text: visibleText(localHtml),
      html_sha256: sha256(localHtml),
    },
    comparison: {
      identities: referenceIdentities.get(caseId),
      checks: {
        dom_tree: {
          status: "mismatch",
          local: canonicalDom(localHtml),
        },
      },
    },
  };
}

async function liveArtifactReference(fileName, caseId) {
  const text = await fs.readFile(
    new URL(`../artifacts/${fileName}`, import.meta.url),
    "utf8",
  );
  const row = text
    .trimEnd()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line))
    .find((candidate) => candidate.syntax_case?.case_id === caseId);
  assert.ok(row, `missing live artifact case ${caseId}`);
  referenceIdentities.set(caseId, {
    source_sha256: row.source_sha256,
    live_html_sha256: row.raw_html_sha256,
  });
  return row;
}

async function writeIdentityFixture({
  references,
  cases,
}) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-identity-classify-"),
  );
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  await fs.writeFile(
    referencesPath,
    references.map((row) => `${JSON.stringify(row)}\n`).join(""),
  );
  await fs.writeFile(
    verdictPath,
    JSON.stringify({ cases }),
  );
  return { referencesPath, verdictPath };
}

function identityBoundMatch(referenceRow, overrides = {}) {
  return {
    case_id: referenceRow.syntax_case.case_id,
    status: "match",
    comparison: {
      identities: {
        source_sha256: referenceRow.source_sha256,
        live_html_sha256: referenceRow.raw_html_sha256,
      },
    },
    ...overrides,
  };
}

function authoritativeIdentity() {
  return {
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
}

function authoritativeProof(identity) {
  return {
    schema: LISTPAGES_REPLAY_RUNTIME_PROOF_SCHEMA,
    observed_at: "2026-07-30T00:00:00.000Z",
    run_nonce: "d".repeat(64),
    candidate: {
      wikijump_sha: identity.wikijump_sha,
      wikijump_tree: identity.wikijump_tree,
      ftml_sha: identity.ftml_sha,
      dependency_lock_sha256: identity.dependency_lock_sha256,
      build_manifest_sha256: identity.build_manifest_sha256,
      build_artifact_key: identity.build_artifact_key,
      executable_sha256: identity.executable_sha256,
      runtime_config_sha256: identity.runtime_config_sha256,
      runtime_environment_sha256: identity.runtime_environment_sha256,
      profile: identity.profile,
    },
    rpc_url: identity.rpc_url,
    site_slug: identity.site_slug,
    site_id: identity.site_id,
    service_image_sha256: { ...identity.service_image_sha256 },
    service_host_port: { ...identity.service_host_port },
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
}

function authoritativeObservation(identity, proof, phase) {
  const stable = {
    run_nonce: proof.run_nonce,
    candidate: { ...proof.candidate },
    process: {
      pid: proof.process.pid,
      start_ticks: proof.process.start_ticks,
      executable_path: "/tmp/deepwell",
      executable_sha256: identity.executable_sha256,
      repository: "/tmp/wikijump",
      command_line_sha256: "e".repeat(64),
      environment_sha256: identity.runtime_environment_sha256,
      config_path: proof.process.config_path,
      config_sha256: identity.runtime_config_sha256,
      config_contents_sha256: identity.runtime_config_sha256,
      build_manifest_path: proof.process.build_manifest_path,
      build_manifest_sha256: identity.build_manifest_sha256,
    },
    rpc_url: identity.rpc_url,
    fixture_state_sha256: "f".repeat(64),
    random_cache_state_sha256: "a".repeat(64),
    services: Object.fromEntries(
      ["cache", "database", "files"].map((service) => [
        service,
        {
          container_id: proof.service_containers[service],
          image_sha256: identity.service_image_sha256[service],
          started_at: "2026-07-30T00:00:00.000Z",
          health: "healthy",
          host_port: identity.service_host_port[service],
        },
      ]),
    ),
  };
  return {
    schema: "wikijump_listpages_compat.runtime_observation.v1",
    status: "bound",
    phase,
    observed_at: "2026-07-30T00:00:01.000Z",
    stable_sha256: sha256(JSON.stringify(stable)),
    stable,
  };
}

function authoritativeMatch(referenceRow) {
  const rawHtml = referenceRow.raw_html;
  return {
    schema: `${LISTPAGES_PREVIEW_DIFFERENTIAL_SCHEMA}.case`,
    case_id: referenceRow.syntax_case.case_id,
    status: "match",
    live: {
      html_sha256: referenceRow.raw_html_sha256,
      visible_text: visibleText(rawHtml),
    },
    local: {
      raw_html: rawHtml,
      html_sha256: sha256(rawHtml),
      visible_text: visibleText(rawHtml),
      styles: [],
    },
    comparison: compareListPagesPreviewHtml(referenceRow, rawHtml),
  };
}

test("preview classifier requires a case-ID bijection", async () => {
  const first = reference("case-a", "source a", "<p>a</p>");
  const second = reference("case-b", "source b", "<p>b</p>");

  await assert.rejects(
    classifyListPagesPreviewDifferential(await writeIdentityFixture({
      references: [first, second],
      cases: [
        identityBoundMatch(first),
        identityBoundMatch(first),
      ],
    })),
    /duplicate verdict case ID case-a/,
  );

  await assert.rejects(
    classifyListPagesPreviewDifferential(await writeIdentityFixture({
      references: [first, first],
      cases: [
        identityBoundMatch(first),
        identityBoundMatch(second),
      ],
    })),
    /duplicate live reference case ID case-a/,
  );

  await assert.rejects(
    classifyListPagesPreviewDifferential(await writeIdentityFixture({
      references: [first, second],
      cases: [identityBoundMatch(first)],
    })),
    /verdict\/reference case IDs differ.*missing case-b/,
  );

  const extra = reference("case-c", "source c", "<p>c</p>");
  await assert.rejects(
    classifyListPagesPreviewDifferential(await writeIdentityFixture({
      references: [first, second],
      cases: [
        identityBoundMatch(first),
        identityBoundMatch(extra),
      ],
    })),
    /verdict\/reference case IDs differ.*missing case-b.*extra case-c/,
  );
});

test("preview classifier binds every verdict row to source and live HTML identities", async () => {
  const live = reference("case-a", "source a", "<p>a</p>");

  for (const [name, identities] of [
    ["missing", undefined],
    ["source", {
      source_sha256: "0".repeat(64),
      live_html_sha256: live.raw_html_sha256,
    }],
    ["live HTML", {
      source_sha256: live.source_sha256,
      live_html_sha256: "0".repeat(64),
    }],
  ]) {
    const row = identityBoundMatch(live);
    row.comparison.identities = identities;
    await assert.rejects(
      classifyListPagesPreviewDifferential(await writeIdentityFixture({
        references: [live],
        cases: [row],
      })),
      new RegExp(`verdict ${name} identity`, "u"),
    );
  }
});

test("authoritative classification preserves and revalidates the runtime identity chain", async () => {
  const live = reference("case-a", "source a", "<p>a</p>");
  const fixture = await writeIdentityFixture({
    references: [live],
    cases: [authoritativeMatch(live)],
  });
  const runtimeIdentityPath = path.join(
    path.dirname(fixture.verdictPath),
    "runtime-identity.json",
  );
  const runtimeProofPath = path.join(
    path.dirname(fixture.verdictPath),
    "runtime-proof.json",
  );
  const runtimeIdentityText = '{"schema":"validated-runtime-identity"}\n';
  const runtimeProofText = '{"schema":"validated-running-proof"}\n';
  await fs.writeFile(runtimeIdentityPath, runtimeIdentityText);
  await fs.writeFile(runtimeProofPath, runtimeProofText);
  const verdict = JSON.parse(await fs.readFile(fixture.verdictPath, "utf8"));
  const referencesText = await fs.readFile(fixture.referencesPath, "utf8");
  const observationStable = {
    run_nonce: "d".repeat(64),
    fixture_state_sha256: "f".repeat(64),
    random_cache_state_sha256: "a".repeat(64),
    candidate: { wikijump_sha: "1".repeat(40) },
    process: { pid: 1234 },
    services: {},
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
  verdict.inputs = {
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
    references_path: fixture.referencesPath,
    references_sha256: sha256(referencesText),
    runtime_identity_path: runtimeIdentityPath,
    runtime_identity_sha256: sha256(runtimeIdentityText),
    runtime_proof_path: runtimeProofPath,
    runtime_proof_sha256: sha256(runtimeProofText),
  };
  verdict.runtime_observations = {
    before: beforeObservation,
    after: afterObservation,
  };
  verdict.schema = LISTPAGES_PREVIEW_DIFFERENTIAL_SCHEMA;
  verdict.summary = {
    total: 1,
    counts: { match: 1 },
    exit_code: 0,
  };
  await fs.writeFile(fixture.verdictPath, JSON.stringify(verdict));

  await assert.rejects(
    classifyListPagesPreviewDifferential({
      ...fixture,
      authoritative: true,
    }),
    /runtime identity schema is unsupported/,
  );

  const identity = authoritativeIdentity();
  const proof = authoritativeProof(identity);
  const validBeforeObservation = authoritativeObservation(
    identity,
    proof,
    "before",
  );
  const validAfterObservation = authoritativeObservation(
    identity,
    proof,
    "after",
  );
  const validIdentityText = `${JSON.stringify(identity)}\n`;
  const validProofText = `${JSON.stringify(proof)}\n`;
  await fs.writeFile(runtimeIdentityPath, validIdentityText);
  await fs.writeFile(runtimeProofPath, validProofText);
  verdict.inputs.runtime_identity_sha256 = sha256(validIdentityText);
  verdict.inputs.runtime_proof_sha256 = sha256(validProofText);
  verdict.inputs.authority.runtime_observation_before_sha256 = sha256(
    JSON.stringify(validBeforeObservation),
  );
  verdict.inputs.authority.runtime_observation_after_sha256 = sha256(
    JSON.stringify(validAfterObservation),
  );
  verdict.inputs.authority.runtime_observation_stable_sha256 =
    validAfterObservation.stable_sha256;
  verdict.runtime_observations = {
    before: validBeforeObservation,
    after: validAfterObservation,
  };
  await fs.writeFile(fixture.verdictPath, JSON.stringify(verdict));

  const classified = await classifyListPagesPreviewDifferential({
    ...fixture,
    authoritative: true,
    observeRuntime: async ({ phase }) =>
      authoritativeObservation(identity, proof, phase),
  });
  assert.deepEqual(classified.inputs.authority, {
    mode: "authoritative",
    completion_eligible: true,
    runtime_identity_sha256: sha256(validIdentityText),
    runtime_proof_sha256: sha256(validProofText),
    runtime_observation_stable_sha256: validAfterObservation.stable_sha256,
  });

  const selfHashedObservationVerdict = structuredClone(verdict);
  for (const phase of ["before", "after"]) {
    const observation =
      selfHashedObservationVerdict.runtime_observations[phase];
    observation.stable.process.pid = 9999;
    observation.stable_sha256 = sha256(JSON.stringify(observation.stable));
    selfHashedObservationVerdict.inputs.authority[
      `runtime_observation_${phase}_sha256`
    ] = sha256(JSON.stringify(observation));
  }
  selfHashedObservationVerdict.inputs.authority
    .runtime_observation_stable_sha256 =
      selfHashedObservationVerdict.runtime_observations.after.stable_sha256;
  await fs.writeFile(
    fixture.verdictPath,
    JSON.stringify(selfHashedObservationVerdict),
  );
  await assert.rejects(
    classifyListPagesPreviewDifferential({
      ...fixture,
      authoritative: true,
      observeRuntime: async ({ phase }) =>
        authoritativeObservation(identity, proof, phase),
    }),
    /observation differs from its identity or proof/,
  );
  await fs.writeFile(fixture.verdictPath, JSON.stringify(verdict));

  const forgedVerdict = structuredClone(verdict);
  delete forgedVerdict.cases[0].local.raw_html;
  await fs.writeFile(fixture.verdictPath, JSON.stringify(forgedVerdict));
  await assert.rejects(
    classifyListPagesPreviewDifferential({
      ...fixture,
      authoritative: true,
      observeRuntime: async ({ phase }) =>
        authoritativeObservation(identity, proof, phase),
    }),
    /authoritative verdict local or live output is invalid/,
  );
  await fs.writeFile(fixture.verdictPath, JSON.stringify(verdict));

  await fs.writeFile(runtimeIdentityPath, '{"changed":true}\n');
  await assert.rejects(
    classifyListPagesPreviewDifferential({
      ...fixture,
      authoritative: true,
      observeRuntime: async ({ phase }) =>
        authoritativeObservation(identity, proof, phase),
    }),
    /runtime identity changed after the preview verdict/,
  );

  verdict.inputs.authority = {
    mode: "diagnostic",
    completion_eligible: false,
  };
  await fs.writeFile(fixture.verdictPath, JSON.stringify(verdict));
  await assert.rejects(
    classifyListPagesPreviewDifferential({
      ...fixture,
      authoritative: true,
      observeRuntime: async ({ phase }) =>
        authoritativeObservation(identity, proof, phase),
    }),
    /authoritative classification requires an authoritative preview verdict/,
  );
});

test("classification CLI and writer preserve authoritative evidence", async () => {
  const parsed = parsePreviewClassificationArgs([
    "node",
    "classify-listpages-preview-differential.mjs",
    "--verdict",
    "verdict.json",
    "--references",
    "references.jsonl",
    "--authoritative",
    "--output",
    "classification.json",
  ]);
  assert.equal(parsed.authoritative, true);

  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-classification-output-"),
  );
  const output = path.join(root, "classification.json");
  const classification = { schema: "classification" };
  await writeListPagesPreviewClassification(classification, output);
  assert.equal((await fs.stat(output)).mode & 0o777, 0o400);
  await assert.rejects(
    writeListPagesPreviewClassification(classification, output),
    (error) => error?.code === "EEXIST",
  );
});

test("preview classifier separates oracle defects from unexplained query or row mismatches", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const references = [
    reference(
      "invalid-range",
      '[[module ListPages range="bogus"]]\n%%title%%\n[[/module]]',
      '<div class="error-block">Invalid range argument.</div>',
    ),
    reference(
      "data",
      "[[module ListPages]]\n%%title%%\n[[/module]]",
      '<div class="list-pages-box"><div class="list-pages-item">live</div></div>',
    ),
    reference(
      "local-todo",
      "[[module ListPages]]\n[[#expr 1 + 1]]\n[[/module]]",
      '<div class="list-pages-box"></div>',
    ),
  ];
  await fs.writeFile(
    referencesPath,
    references.map((row) => `${JSON.stringify(row)}\n`).join(""),
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [
      mismatchCase(
        "invalid-range",
        '<div class="error-block">Invalid range argument.</div>',
        "",
      ),
      mismatchCase(
        "data",
        '<div class="list-pages-box"><div class="list-pages-item">live</div></div>',
        '<div class="list-pages-box"><div class="list-pages-item">local</div></div>',
      ),
      mismatchCase(
        "local-todo",
        '<div class="list-pages-box"></div>',
        "<p>TODO: module ListPages</p>",
      ),
    ],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(result.summary.classifications["invalid-range-error"], 1);
  assert.equal(
    result.summary.classifications["listpages-query-or-row-render-divergence"],
    1,
  );
  assert.equal(
    result.summary.classifications["local-listpages-unsupported-diagnostic"],
    1,
  );
  assert.equal(
    result.cases.find((row) => row.case_id === "local-todo").disposition,
    "investigate-renderer",
  );
});

test("preview classifier recognizes executed wrapper-free modules", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    '[[module ListPages separate="no" wrapper="no"]]',
    "%%index%%. %%title%%",
    "[[/module]]",
  ].join("\n");
  const liveHtml = "<p>1. live one<br>2. live two</p><div class=\"pager\">pages</div>";
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(reference("wrapper-free", source, liveHtml))}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [{
      case_id: "wrapper-free",
      status: "mismatch",
      live: { visible_text: "1. live one\n2. live two" },
      local: { visible_text: "1. local", html_sha256: "c".repeat(64) },
      comparison: {
        identities: referenceIdentities.get("wrapper-free"),
        checks: {
          dom_tree: {
            status: "mismatch",
            local: [{
              attrs: [],
              children: [{ type: "text", value: "1. local" }],
            }],
          },
        },
      },
    }],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "listpages-query-or-row-render-divergence",
  );
});

test("preview classifier does not mask a missing zero-row line as fixture state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    '[[module ListPages tags="+absent" separate="no" prependLine="ZERO_PRE"]]',
    "%%slug%%",
    "[[/module]]",
  ].join("\n");
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(reference(
      "zero-row-prepend",
      source,
      '<div class="list-pages-box"><p>ZERO_PRE</p></div>',
    ))}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [{
      case_id: "zero-row-prepend",
      status: "mismatch",
      live: { visible_text: "ZERO_PRE" },
      local: { visible_text: "", html_sha256: "c".repeat(64) },
      comparison: {
        identities: referenceIdentities.get("zero-row-prepend"),
        checks: {
          dom_tree: {
            status: "mismatch",
            local: [{
              attrs: [{ name: "class", value: "list-pages-box" }],
              children: [],
            }],
          },
        },
      },
    }],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "prepend-append-line-divergence",
  );
  assert.equal(result.cases[0].disposition, "investigate-renderer");
});

test("preview classifier keeps a current-page selector mismatch actionable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    '[[module ListPages name="scp-002" votes="="]]',
    "ROW=%%fullname%%",
    "[[/module]]",
  ].join("\n");
  const liveHtml = '<div class="list-pages-box"></div>';
  const localHtml = [
    '<div class="list-pages-box">',
    '<div class="list-pages-item"><p>ROW=scp-002</p></div>',
    "</div>",
  ].join("");
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(reference("current-votes", source, liveHtml))}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [mismatchCase("current-votes", liveHtml, localHtml)],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "listpages-query-or-row-render-divergence",
  );
  assert.equal(
    result.cases[0].disposition,
    "investigate-query-or-renderer",
  );
});

test("literal-context replay isolates ListPages ownership from unrelated rendering drift", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-literal-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    "[[code]]",
    '[[module ListPages tags="+example"]]',
    "%%title%%",
    "[[/module]]",
    "[[/code]]",
  ].join("\n");
  const cases = [
    {
      caseId: "literal-ok:literal-context",
      localText: '[[module ListPages tags="+example"]]\n%%title%%\n[[/module]]\n',
      localDom: [{
        attrs: [{ name: "class", value: "code" }],
        children: [],
      }],
    },
    {
      caseId: "literal-todo:literal-context",
      localText: "TODO: module ListPages",
      localDom: [],
    },
    {
      caseId: "literal-executed:literal-context",
      localText: "local row",
      localDom: [{
        attrs: [{ name: "class", value: "list-pages-box" }],
        children: [],
      }],
    },
    {
      caseId: "literal-live-executed:literal-context",
      localText: source,
      localDom: [{
        attrs: [{ name: "class", value: "code" }],
        children: [],
      }],
      liveHtml:
        '<div class="other list-pages-box"><div class="list-pages-item extra">live row</div></div>',
    },
  ];
  await fs.writeFile(
    referencesPath,
    cases.map(({ caseId, liveHtml }) => `${JSON.stringify(reference(
      caseId,
      source,
      liveHtml ??
        '<div class="code">[[module ListPages tags="+example"]]\n%%title%%\n[[/module]]</div>',
    ))}\n`).join(""),
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: cases.map(({ caseId, localText, localDom }) => ({
      case_id: caseId,
      status: "mismatch",
      live: {
        visible_text: '[[module ListPages tags="+example"]]\n%%title%%\n[[/module]]',
      },
      local: { visible_text: localText, html_sha256: "d".repeat(64) },
      comparison: {
        identities: referenceIdentities.get(caseId),
        checks: {
          dom_tree: { status: "mismatch", local: localDom },
        },
      },
    })),
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.deepEqual(
    result.cases[0],
    {
      ...result.cases[0],
      case_id: "literal-ok:literal-context",
      classification: "literal-context-nonexecution-parity",
      disposition: "none",
    },
  );
  for (const caseId of [
    "literal-todo:literal-context",
    "literal-executed:literal-context",
    "literal-live-executed:literal-context",
  ]) {
    const classified = result.cases.find((row) => row.case_id === caseId);
    assert.notEqual(
      classified.disposition,
      "none",
      `${caseId} must remain actionable when local output executes or diagnoses ListPages`,
    );
  }
});

test("literal-context execution parity requires exact ListPages-owned subtrees", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-literal-execution-classify-"),
  );
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    "[[module CSS]]",
    '[[module ListPages name="="]]',
    "%%title%%",
    "[[/module]]",
  ].join("\n");
  const exactOwned =
    '<div class="list-pages-box"><table><tbody><tr><th>Title</th></tr></tbody></table></div>';
  const liveExact = `<div class="live-fixture">${exactOwned}</div>`;
  const localExact = `<div class="local-fixture">${exactOwned}</div>`;
  const liveDifferent =
    '<div class="live-fixture"><div class="list-pages-box">LIVE ROW</div></div>';
  const localDifferent =
    '<div class="local-fixture"><div class="list-pages-box">LOCAL ROW</div></div>';
  const references = [
    reference(
      "literal-exact-execution:literal-context",
      source,
      liveExact,
    ),
    reference(
      "literal-different-execution:literal-context",
      source,
      liveDifferent,
    ),
  ];
  await fs.writeFile(
    referencesPath,
    references.map((row) => `${JSON.stringify(row)}\n`).join(""),
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [
      mismatchCase(
        "literal-exact-execution:literal-context",
        liveExact,
        localExact,
      ),
      mismatchCase(
        "literal-different-execution:literal-context",
        liveDifferent,
        localDifferent,
      ),
    ],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.deepEqual(
    result.cases.map((row) => [
      row.case_id,
      row.classification,
      row.disposition,
    ]),
    [
      [
        "literal-exact-execution:literal-context",
        "literal-context-listpages-execution-parity",
        "none",
      ],
      [
        "literal-different-execution:literal-context",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    ],
  );
});

test("preview classifier proves documented ListPages examples remain nonexecuting", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-documentation-classify-"),
  );
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const documentedSource = [
    "[[module ListPages]]@@}} replacement ",
    "{{[[module ListPages]]}} syntax\n",
    "@@[[module ListPages name=\"literal\"]]@@\n",
    "@@%%title%%@@\n",
    "@@[[/module]]@@",
  ].join("");
  const documentedText = [
    "[[module ListPages]]}} replacement ",
    "[[module ListPages]] syntax\n",
    "[[module ListPages name=\"literal\"]]\n",
    "%%title%%\n",
    "[[/module]]",
  ].join("");
  const nearMissSource = "[[module ListPages]]documentation";
  const stickySource = [
    "[[module ListPages]]@@\n",
    "@@[[div class=\"seed\"]]DOC@@[[/div]]@@\n",
    "@@[[/module]]",
  ].join("");
  const stickyText =
    "[[module ListPages]] [[div class=\"seed\"]]DOC[[/div]]\n@@[[/module]]";
  const missingLiteralText = documentedText.replace(
    '[[module ListPages name="literal"]]\n',
    "",
  );
  const cases = [
    [
      "documented-nonexecution",
      documentedSource,
      `<p>${documentedText}</p>`,
      `<div><p>${documentedText}</p></div>`,
    ],
    [
      "documented-missing-literal",
      documentedSource,
      `<p>${documentedText}</p>`,
      `<p>${missingLiteralText}</p>`,
    ],
    [
      "sticky-documented-nonexecution",
      stickySource,
      `<p>${stickyText}</p>`,
      `<div><p>${stickyText}</p></div>`,
    ],
    [
      "sticky-missing-boundary-space",
      stickySource,
      `<p>${stickyText}</p>`,
      `<p>${stickyText.replace("]] [[div", "]][[div")}</p>`,
    ],
    [
      "near-miss-documentation",
      nearMissSource,
      `<p>${nearMissSource}</p>`,
      `<div><p>${nearMissSource}</p></div>`,
    ],
  ];
  const references = cases.map(([caseId, source, liveHtml]) =>
    reference(caseId, source, liveHtml)
  );
  await fs.writeFile(
    referencesPath,
    references.map((row) => `${JSON.stringify(row)}\n`).join(""),
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: cases.map(([caseId, , liveHtml, localHtml]) =>
      mismatchCase(caseId, liveHtml, localHtml)
    ),
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.deepEqual(
    result.cases.map((row) => [
      row.case_id,
      row.classification,
      row.disposition,
    ]),
    [
      [
        "documented-nonexecution",
        "literal-documentation-nonexecution-parity",
        "none",
      ],
      [
        "documented-missing-literal",
        "other-preview-divergence",
        "investigate",
      ],
      [
        "sticky-documented-nonexecution",
        "literal-documentation-nonexecution-parity",
        "none",
      ],
      [
        "sticky-missing-boundary-space",
        "other-preview-divergence",
        "investigate",
      ],
      [
        "near-miss-documentation",
        "other-preview-divergence",
        "investigate",
      ],
    ],
  );
});

test("preview classifier narrowly separates owned parity and synchronized runtime fixtures", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-owned-fixture-classify-"),
  );
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = "[[module ListPages]]\n%%title_linked%%\n[[/module]]";
  const owned =
    '<div class="list-pages-box"><div class="list-pages-item">SAME ROW</div></div>';
  const liveAuthor = [
    '<div class="list-pages-box"><div class="list-pages-item"><p>by ',
    '<span class="printuser avatarhover">',
    '<a href="http://www.wikidot.com/user:info/user" onclick="listener(7)"><img src="avatar-7" alt="User"></a>',
    '<a href="http://www.wikidot.com/user:info/user" onclick="listener(7)">User</a>',
    '</span> <span class="odate time_1 format_live">1 Jan 2026</span>',
    "</p></div></div>",
  ].join("");
  const localAuthor = [
    '<div class="list-pages-box"><div class="list-pages-item"><p>',
    'by User <span class="odate time_1 format_local">1 Jan 2026</span>',
    "</p></div></div>",
  ].join("");
  const liveAuthorTable = [
    '<div class="list-pages-box"><table><tbody><tr><td>',
    '<span class="printuser avatarhover">',
    '<a href="http://www.wikidot.com/user:info/user" onclick="listener(7)"><img src="avatar-7" alt="User"></a>',
    '<a href="http://www.wikidot.com/user:info/user" onclick="listener(7)">User</a>',
    '</span></td><td><span class="odate time_1 format_live">',
    "1 Jan 2026</span></td></tr></tbody></table></div>",
  ].join("");
  const localAuthorTable = [
    '<div class="list-pages-box"><table><tbody><tr><td>User</td>',
    '<td><span class="odate time_1 format_local">',
    "1 Jan 2026</span></td></tr></tbody></table></div>",
  ].join("");
  const liveAuthorMetadata = [
    '<div class="list-pages-box"><p>',
    '<span class="printuser avatarhover">',
    '<a href="http://www.wikidot.com/user:info/user" onclick="listener(7)"><img src="avatar-7" alt="User"></a>',
    '<a href="http://www.wikidot.com/user:info/user" onclick="listener(7)">User</a>',
    "</span></p></div>",
  ].join("");
  const localAuthorMetadata = [
    '<div class="list-pages-box"><p>',
    '<span class="printuser avatarhover">',
    '<a href="/user:info/user" onclick="listener(0)"><img src="avatar-0" alt="User"></a>',
    '<a href="/user:info/user" onclick="listener(0)">User</a>',
    "</span></p></div>",
  ].join("");
  const liveAuthorLine = [
    '<div class="list-pages-box"><p>ROW<br>',
    '<span class="printuser avatarhover">',
    '<a href="http://www.wikidot.com/user:info/user" onclick="listener(7)"><img src="avatar-7" alt="User"></a>',
    '<a href="http://www.wikidot.com/user:info/user" onclick="listener(7)">User</a>',
    "</span><br></p></div>",
  ].join("");
  const localAuthorLine =
    '<div class="list-pages-box"><p>ROW<br>\nUser<br></p></div>';
  const liveAuthorPhrase = [
    '<div class="list-pages-box"><p>By ',
    '<span class="printuser avatarhover">',
    '<a href="http://www.wikidot.com/user:info/user" onclick="listener(7)"><img src="avatar-7" alt="User"></a>',
    '<a href="http://www.wikidot.com/user:info/user" onclick="listener(7)">User</a>',
    "</span>, last edited</p></div>",
  ].join("");
  const localAuthorPhrase =
    '<div class="list-pages-box"><p>By User, last edited</p></div>';
  const liveAuthorFallback = [
    '<div class="list-pages-box"><p>By ',
    '<span class="printuser avatarhover">',
    '<a href="http://www.wikidot.com/user:info/user" onclick="listener(7)">User does not match any existing user name</a>',
    '</span></p></div>',
  ].join("");
  const localAuthorFallback =
    '<div class="list-pages-box"><p>By User</p></div>';
  const liveAuthorErrorInline = [
    '<div class="list-pages-box"><p>By ',
    '<span class="error-inline"><em>User</em> does not match any existing user name</span>',
    "</p></div>",
  ].join("");
  const localAuthorErrorInline =
    '<div class="list-pages-box"><p>By User</p></div>';
  const liveAuthorSeparator = [
    '<div class="list-pages-box"><p>By ',
    '<span class="printuser avatarhover">',
    '<a href="http://www.wikidot.com/user:info/dr-talcite"><img src="avatar-7" alt="Dr Talcite"></a>',
    '<a href="http://www.wikidot.com/user:info/dr-talcite">Dr Talcite</a>',
    "</span></p></div>",
  ].join("");
  const localAuthorSeparator = [
    '<div class="list-pages-box"><p>By ',
    '<span class="printuser avatarhover">',
    '<a href="/user:info/Dr Talcite"><img src="avatar-0" alt="Dr Talcite"></a>',
    '<a href="/user:info/Dr Talcite">Dr Talcite</a>',
    "</span></p></div>",
  ].join("");
  const liveAuthorUnderscore = [
    '<div class="list-pages-box"><p>By ',
    '<span class="printuser avatarhover">',
    '<a href="http://www.wikidot.com/user:info/dc-yerko"><img src="avatar-7" alt="Dc-Yerko"></a>',
    '<a href="http://www.wikidot.com/user:info/dc-yerko">Dc-Yerko</a>',
    "</span></p></div>",
  ].join("");
  const localAuthorUnderscore = [
    '<div class="list-pages-box"><p>By ',
    '<span class="printuser avatarhover">',
    '<a href="/user:info/dc_yerko"><img src="avatar-0" alt="Dc_Yerko"></a>',
    '<a href="/user:info/dc_yerko">Dc_Yerko</a>',
    "</span></p></div>",
  ].join("");
  const localAuthorGenuinelyDifferent = localAuthorSeparator.replace(
    "/user:info/Dr Talcite",
    "/user:info/other-user",
  ).replaceAll("Dr Talcite", "Other User");
  const liveLinkedTitle =
    '<div class="list-pages-box"><a href="/same-page">Title A B</a></div>';
  const localLinkedTitle =
    '<div class="list-pages-box"><a href="/same-page">Title A\u00a0B</a></div>';
  const composedLinkedTitleSource = [
    '[[module ListPages separate="no"]]',
    "[[[%%link%%/noredirect/true | %%title%%]]]",
    "[[/module]]",
  ].join("\n");
  const liveComposedLinkedTitle =
    '<div class="list-pages-box"><a href="http://sandbox-for-codex.wikidot.com/page/noredirect/true">Live snapshot title</a></div>';
  const localComposedLinkedTitle =
    '<div class="list-pages-box"><a href="http://sandbox-for-codex.wikidot.com/page/noredirect/true">Imported title</a></div>';
  const liveMissingTarget =
    '<div class="list-pages-box"><a class="newpage" href="/missing-target">Missing target</a></div>';
  const localImportedTarget =
    '<div class="list-pages-box"><a href="/missing-target">Missing target</a></div>';
  const footnote = (nonce, footerNonce = nonce) => {
    const refId = nonce === null ? "1" : `${nonce}-1`;
    const footerId = footerNonce === null ? "1" : `${footerNonce}-1`;
    return [
      '<div class="list-pages-box"><p>ROW',
      '<sup class="footnoteref"><a ',
      `id="footnoteref-${refId}" href="javascript:;" class="footnoteref" `,
      `onclick="WIKIDOT.page.utils.scrollToReference('footnote-${refId}')">1</a></sup></p>`,
      '<div class="footnotes-footer"><div class="title">Footnotes</div>',
      `<div class="footnote-footer" id="footnote-${footerId}">`,
      `<a href="javascript:;" onclick="WIKIDOT.page.utils.scrollToReference('footnoteref-${footerId}')">1</a>. NOTE`,
      "</div></div></div>",
    ].join("");
  };
  const liveFootnoteWithAuthor = footnote("123456").replace(
    "ROW",
    [
      "ROW ",
      '<span class="printuser avatarhover">',
      '<a href="http://www.wikidot.com/user:info/user" onclick="listener(7)"><img src="avatar-7" alt="User"></a>',
      '<a href="http://www.wikidot.com/user:info/user" onclick="listener(7)">User</a>',
      "</span>",
    ].join(""),
  );
  const localFootnoteWithAuthor = footnote(null).replace("ROW", "ROW User");
  const liveImportedFile =
    '<div class="list-pages-box"><img src="http://storage.wikidot.com/local--files/page/image.png" alt="image"></div>';
  const localImportedFile =
    '<div class="list-pages-box"><img src="https://storage.files.invalid/local--files/page/image.png" alt="image"></div>';
  const localImportedFileWdfiles =
    '<div class="list-pages-box"><img src="https://storage.wdfiles.com/local--files/page/image.png" alt="image"></div>';
  const firstImageSource = [
    '[[module ListPages separate="yes"]]',
    "[[image :first]]",
    "%%title_linked%%",
    "[[/module]]",
  ].join("\n");
  const firstImageRow =
    '<p><a href="/help:editing-pages">Editing Pages</a></p>';
  const liveFirstImage = [
    '<div class="list-pages-box"><div class="list-pages-item">',
    '<img src="http://sandbox-for-codex.wikidot.com/local--files/help:editing-pages/sulphur.png" class="image" alt="sulphur.png">',
    firstImageRow,
    "</div></div>",
  ].join("");
  const localMissingFirstImage = [
    '<div class="list-pages-box"><div class="list-pages-item">',
    firstImageRow,
    "</div></div>",
  ].join("");
  const liveFootnoteWithImportedFile = footnote("123456").replace(
    "ROW",
    'ROW<img src="http://storage.wikidot.com/local--files/page/image.png" alt="image">',
  );
  const localFootnoteWithImportedFile = footnote(null).replace(
    "ROW",
    'ROW<img src="https://storage.files.invalid/local--files/page/image.png" alt="image">',
  );
  const featured = ({ id, slug, name, tagline = "" }) => [
    '<div class="featured-site-box">',
    `<div class="container"><a href="http://${slug}.wikidot.com">`,
    `<img id="featured-site-image-${id}" src="http://thumbnails.wdfiles.com/thumbnail/site/${slug}.wikidot.com/160.jpg" alt="${name} wiki">`,
    "</a></div>",
    '<div class="hovertip-container" id="special9387424" style="display: none">',
    `<div id="featured-site-image-${id}-hovertip1" class="featured-site-hovertip">`,
    `<img src="http://thumbnails.wdfiles.com/thumbnail/site/${slug}.wikidot.com/160.jpg" alt="${name} wiki" class="thumbnail">`,
    `<div class="description"><div class="name">${name}</div>`,
    tagline ? `<div class="tagline">${tagline}</div>` : "",
    "<hr><div class=\"stats\">Contributions last month: 0<br>Contributors: 1</div>",
    "</div></div></div></div>",
  ].join("");
  const liveFeatured = [
    '<div class="list-pages-box"><div class="list-pages-item">',
    "<p>FEATURED_START</p>",
    featured({ id: 7, slug: "live-site", name: "Live Site" }),
    "<p>FEATURED_END</p>",
    "</div></div>",
  ].join("");
  const localFeatured = [
    '<div class="list-pages-box"><div class="list-pages-item">',
    "<p>FEATURED_START</p>",
    featured({
      id: 9,
      slug: "local-site",
      name: "Local Site",
      tagline: "Local fixture",
    }),
    "<p>FEATURED_END</p>",
    "</div></div>",
  ].join("");
  const social = (id) => [
    `<span id="social${id}">`,
    '<a href="http://reddit.com/submit?url=http%3A%2F%2Fsandbox-for-codex.wikidot.com%2Fajax-module-connector.php&amp;title=TITLE" style="margin: 0 2px" title="Reddit">',
    '<img src="http://d3g0gp89917ko0.cloudfront.net/v--7690939296dc/common--images/social/reddit.png" alt="Reddit"></a>',
    '<a href="http://www.facebook.com/share.php?u=http%3A%2F%2Fsandbox-for-codex.wikidot.com%2Fajax-module-connector.php" style="margin: 0 2px" title="Facebook" onclick="window.open(\'http://www.facebook.com/sharer.php?u=\'+encodeURIComponent(location.href)+\'&amp;t=\'+encodeURIComponent(document.title),\'sharer\',\'toolbar=0,status=0,width=626,height=436\');return false;">',
    '<img src="http://d3g0gp89917ko0.cloudfront.net/v--7690939296dc/common--images/social/facebook.gif" alt="Facebook"></a>',
    "</span>",
    "<script type=\"text/javascript\">\n//<![CDATA[\n\n",
    `            var socialspan = $j("#social${id}")[0];\n`,
    "            var els = socialspan.getElementsByTagName(\"a\");\n",
    "            for (var i=0;i<els.length;i++) {\n",
    "                els[i].href = els[i].href.replace(\"TITLE\", encodeURIComponent(document.title));\n",
    "            }\n",
    "//]]>\n</script>",
  ].join("");
  const cases = [
    ["owned-parity", `${owned}<p>LIVE TAIL</p>`, `${owned}<p>LOCAL TAIL</p>`],
    ["author-fixture", liveAuthor, localAuthor],
    ["author-table-fixture", liveAuthorTable, localAuthorTable],
    ["author-metadata-fixture", liveAuthorMetadata, localAuthorMetadata],
    ["author-plain-line-fixture", liveAuthorLine, localAuthorLine],
    [
      "author-plain-line-altered",
      liveAuthorLine,
      '<div class="list-pages-box"><p>ROW<br>\nUser altered<br></p></div>',
    ],
    ["author-plain-phrase-fixture", liveAuthorPhrase, localAuthorPhrase],
    ["author-fallback-fixture", liveAuthorFallback, localAuthorFallback],
    [
      "author-error-inline-fixture",
      liveAuthorErrorInline,
      localAuthorErrorInline,
    ],
    [
      "author-error-inline-altered",
      liveAuthorErrorInline,
      localAuthorErrorInline.replace("By User", "By Altered"),
    ],
    ["author-separator-fixture", liveAuthorSeparator, localAuthorSeparator],
    ["author-underscore-fixture", liveAuthorUnderscore, localAuthorUnderscore],
    [
      "author-genuinely-different",
      liveAuthorSeparator,
      localAuthorGenuinelyDifferent,
    ],
    [
      "author-plain-phrase-altered",
      liveAuthorPhrase,
      localAuthorPhrase.replace("By User,", "By Altered,"),
    ],
    ["linked-title-space-fixture", liveLinkedTitle, localLinkedTitle],
    [
      "linked-title-space-altered",
      liveLinkedTitle,
      '<div class="list-pages-box"><a href="/same-page">Title A\u00a0C</a></div>',
    ],
    [
      "composed-linked-title-fixture",
      liveComposedLinkedTitle,
      localComposedLinkedTitle,
      composedLinkedTitleSource,
    ],
    [
      "composed-linked-title-target-altered",
      liveComposedLinkedTitle,
      localComposedLinkedTitle.replace(
        "/page/noredirect/true",
        "/different/noredirect/true",
      ),
      composedLinkedTitleSource,
    ],
    [
      "composed-linked-title-structure-altered",
      liveComposedLinkedTitle,
      localComposedLinkedTitle.replace(
        "Imported title",
        "<em>Imported title</em>",
      ),
      composedLinkedTitleSource,
    ],
    ["imported-page-existence", liveMissingTarget, localImportedTarget],
    [
      "imported-page-existence-target-altered",
      liveMissingTarget,
      localImportedTarget.replace("/missing-target", "/different-target"),
    ],
    [
      "imported-page-existence-class-altered",
      liveMissingTarget.replace('class="newpage"', 'class="newpage authored"'),
      localImportedTarget,
    ],
    ["footnote-nonce", footnote("123456"), footnote(null)],
    [
      "footnote-author-fixture",
      liveFootnoteWithAuthor,
      localFootnoteWithAuthor,
    ],
    [
      "footnote-author-altered",
      liveFootnoteWithAuthor,
      localFootnoteWithAuthor.replace("ROW User", "ROW Altered"),
    ],
    ["imported-file-origin", liveImportedFile, localImportedFile],
    ["imported-file-origin-wdfiles", liveImportedFile, localImportedFileWdfiles],
    [
      "imported-file-origin-wdfiles-site-altered",
      liveImportedFile,
      localImportedFileWdfiles.replace("storage.wdfiles", "other.wdfiles"),
    ],
    [
      "imported-file-origin-wdfiles-path-altered",
      liveImportedFile,
      localImportedFileWdfiles.replace("image.png", "altered.png"),
    ],
    [
      "imported-file-origin-altered",
      liveImportedFile,
      localImportedFile.replace("image.png", "altered.png"),
    ],
    [
      "first-image-fixture",
      liveFirstImage,
      localMissingFirstImage,
      firstImageSource,
    ],
    [
      "first-image-row-altered",
      liveFirstImage,
      localMissingFirstImage.replace("Editing Pages", "Altered row"),
      firstImageSource,
    ],
    [
      "first-image-owner-altered",
      liveFirstImage.replace(
        "local--files/help:editing-pages/",
        "local--files/different-page/",
      ),
      localMissingFirstImage,
      firstImageSource,
    ],
    [
      "footnote-imported-file",
      liveFootnoteWithImportedFile,
      localFootnoteWithImportedFile,
    ],
    [
      "inconsistent-footnote-nonce",
      footnote("123456", "654321"),
      footnote(null),
    ],
    ["featured-fixture", liveFeatured, localFeatured],
    [
      "social-nonce",
      `<div class="list-pages-box"><p>${social(12345)}</p></div>`,
      `<div class="list-pages-box"><p>${social(67890)}</p></div>`,
    ],
    [
      "social-short-nonce",
      `<div class="list-pages-box"><p>${social(3981)}</p></div>`,
      `<div class="list-pages-box"><p>${social(67890)}</p></div>`,
    ],
    [
      "social-too-long-nonce",
      `<div class="list-pages-box"><p>${social(123456)}</p></div>`,
      `<div class="list-pages-box"><p>${social(67890)}</p></div>`,
    ],
    [
      "html-block-nonce",
      '<div class="list-pages-box"><iframe src="/target/html/4587713091c90020f4639c0c8a574dc6035899fe-123" allowtransparency="true" frameborder="0" class="html-block-iframe"></iframe></div>',
      '<div class="list-pages-box"><iframe src="/target/html/4587713091c90020f4639c0c8a574dc6035899fe-456" allowtransparency="true" frameborder="0" class="html-block-iframe"></iframe></div>',
    ],
    [
      "html-block-preview-route",
      '<div class="list-pages-box"><iframe src="/codex-module-pageview-1785291684/html/4587713091c90020f4639c0c8a574dc6035899fe-123" allowtransparency="true" frameborder="0" class="html-block-iframe"></iframe></div>',
      '<div class="list-pages-box"><iframe src="/search:site/html/4587713091c90020f4639c0c8a574dc6035899fe-456" allowtransparency="true" frameborder="0" class="html-block-iframe"></iframe></div>',
    ],
    [
      "html-block-hash-differs",
      '<div class="list-pages-box"><iframe src="/target/html/4587713091c90020f4639c0c8a574dc6035899fe-123" allowtransparency="true" frameborder="0" class="html-block-iframe"></iframe></div>',
      '<div class="list-pages-box"><iframe src="/target/html/9adab2bd917d980be17b6b4f961e26713b9e6996-456" allowtransparency="true" frameborder="0" class="html-block-iframe"></iframe></div>',
    ],
    [
      "different-row",
      '<div class="list-pages-box"><div class="list-pages-item">LIVE ROW</div></div>',
      '<div class="list-pages-box"><div class="list-pages-item">LOCAL ROW</div></div>',
    ],
  ];
  const references = cases.map(([caseId, liveHtml, _localHtml, caseSource]) =>
    reference(caseId, caseSource ?? source, liveHtml)
  );
  await fs.writeFile(
    referencesPath,
    references.map((row) => `${JSON.stringify(row)}\n`).join(""),
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: cases.map(([caseId, liveHtml, localHtml]) =>
      mismatchCase(caseId, liveHtml, localHtml)
    ),
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.deepEqual(
    result.cases.map((row) => [
      row.case_id,
      row.classification,
      row.disposition,
    ]),
    [
      ["owned-parity", "listpages-owned-execution-parity", "none"],
      ["author-fixture", "synchronized-imported-author-state", "none"],
      [
        "author-table-fixture",
        "synchronized-imported-author-state",
        "none",
      ],
      [
        "author-metadata-fixture",
        "synchronized-imported-author-state",
        "none",
      ],
      [
        "author-plain-line-fixture",
        "synchronized-imported-author-state",
        "none",
      ],
      [
        "author-plain-line-altered",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
      [
        "author-plain-phrase-fixture",
        "synchronized-imported-author-state",
        "none",
      ],
      [
        "author-fallback-fixture",
        "synchronized-imported-author-state",
        "none",
      ],
      [
        "author-error-inline-fixture",
        "synchronized-imported-author-state",
        "none",
      ],
      [
        "author-error-inline-altered",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
      [
        "author-separator-fixture",
        "synchronized-imported-author-state",
        "none",
      ],
      [
        "author-underscore-fixture",
        "synchronized-imported-author-state",
        "none",
      ],
      [
        "author-genuinely-different",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
      [
        "author-plain-phrase-altered",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
      [
        "linked-title-space-fixture",
        "synchronized-imported-page-title-state",
        "none",
      ],
      [
        "linked-title-space-altered",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
      [
        "composed-linked-title-fixture",
        "synchronized-imported-page-title-state",
        "none",
      ],
      [
        "composed-linked-title-target-altered",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
      [
        "composed-linked-title-structure-altered",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
      [
        "imported-page-existence",
        "synchronized-imported-page-existence-state",
        "none",
      ],
      [
        "imported-page-existence-target-altered",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
      [
        "imported-page-existence-class-altered",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
      ["footnote-nonce", "canonical-footnote-route-nonce", "none"],
      [
        "footnote-author-fixture",
        "canonical-footnote-route-nonce",
        "none",
      ],
      [
        "footnote-author-altered",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
      [
        "imported-file-origin",
        "synchronized-imported-file-origin-state",
        "none",
      ],
      [
        "imported-file-origin-wdfiles",
        "synchronized-imported-file-origin-state",
        "none",
      ],
      [
        "imported-file-origin-wdfiles-site-altered",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
      [
        "imported-file-origin-wdfiles-path-altered",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
      [
        "imported-file-origin-altered",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
      [
        "first-image-fixture",
        "synchronized-imported-first-image-state",
        "none",
      ],
      [
        "first-image-row-altered",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
      [
        "first-image-owner-altered",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
      [
        "footnote-imported-file",
        "canonical-footnote-route-nonce",
        "none",
      ],
      [
        "inconsistent-footnote-nonce",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
      ["featured-fixture", "rotating-featured-site-state", "none"],
      ["social-nonce", "canonical-social-widget-nonce", "none"],
      ["social-short-nonce", "canonical-social-widget-nonce", "none"],
      [
        "social-too-long-nonce",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
      ["html-block-nonce", "canonical-html-block-route-nonce", "none"],
      [
        "html-block-preview-route",
        "canonical-html-block-route-nonce",
        "none",
      ],
      [
        "html-block-hash-differs",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
      [
        "different-row",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    ],
  );
});

test("preview classifier isolates unsynchronized random selected-row state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const cases = [
    {
      id: "random-size",
      source: [
        '[[module ListPages order="random" limit="1"]]',
        '[[div class="num[[#expr %%size%%%10]]"]]SAME[[/div]]',
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box"><div class="num2">SAME</div></div>',
      local:
        '<div class="list-pages-box"><div class="num7">SAME</div></div>',
      expected: ["unsynchronized-random-row-state", "none"],
    },
    {
      id: "random-link",
      source: [
        '[[module ListPages order="created_at desc" order="random" limit="@URL|1"]]',
        "[[[%%link%%|SAME]]]",
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box"><a href="/one">SAME</a></div>',
      local: '<div class="list-pages-box"><a href="/two">SAME</a></div>',
      expected: ["unsynchronized-random-row-state", "none"],
    },
    {
      id: "random-visible-change",
      source: [
        '[[module ListPages order="random" limit="1"]]',
        "%%link%%",
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box">ONE</div>',
      local: '<div class="list-pages-box">TWO</div>',
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "random-linked-title-selected-row",
      source: [
        '[[module ListPages order="random" limit="1"]]',
        "Random Page: %%title_linked%%",
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box"><div class="list-pages-item">Random Page: <a href="/one">Live</a></div></div>',
      local: '<div class="list-pages-box"><div class="list-pages-item">Random Page: <a href="/two">Local</a></div></div>',
      expected: ["unsynchronized-random-row-state", "none"],
    },
    {
      id: "random-name-title-selected-row",
      source: [
        '[[module ListPages order="random" limit="13" wrapper="no"]]',
        '[[a_ href="/%%fullname%%" class="book"]][[span]]%%name%%[[/span]][[span]]%%title%%[[/span]][[/a]]',
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box"><a class="book" href="/one"><span>ONE</span><span>Live title</span></a></div>',
      local: '<div class="list-pages-box"><a class="book" href="/two"><span>TWO</span><span>Local title</span></a></div>',
      expected: ["unsynchronized-random-row-state", "none"],
    },
    {
      id: "random-size-branch-selected-row",
      source: [
        '[[module ListPages order="random" limit="1" wrapper="no"]]',
        '[[#ifexpr %%size%%%14 != 0 | [!-- ]]ONE[[#ifexpr %%size%%%14 != 0 | --] ]]',
        '[[#ifexpr %%size%%%14 != 1 | [!-- ]]TWO[[#ifexpr %%size%%%14 != 1 | --] ]]',
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box"><p>ONE</p></div>',
      local: '<div class="list-pages-box"><p>TWO</p></div>',
      expected: ["unsynchronized-random-row-state", "none"],
    },
    {
      id: "random-direct-size-branch-selected-row",
      source: [
        '[[module ListPages order="random" limit="1" wrapper="no"]]',
        '[[#ifexpr %%size%%%14 != 0 | [!-- ]]ONE[[#ifexpr %%size%%%14 != 0 | --] ]]',
        '[[#ifexpr %%size%%%14 != 1 | [!-- ]]TWO[[#ifexpr %%size%%%14 != 1 | --] ]]',
        "[[/module]]",
      ].join("\n"),
      live: '<p><span class="live">ONE</span></p>',
      local: '<p><span class="local">TWO</span></p>',
      expected: ["unsynchronized-random-row-state", "none"],
    },
    {
      id: "random-direct-size-branch-multiline-selected-row",
      source: [
        '[[module ListPages order="random" limit="1" wrapper="no"]]',
        '[[#ifexpr %%size%%%34 != 0 | [!-- ]]**ONE**\nLine one[[#ifexpr %%size%%%34 != 0 | --] ]]',
        '[[#ifexpr %%size%%%34 != 1 | [!-- ]]**TWO**\nLine two\nLine three[[#ifexpr %%size%%%34 != 1 | --] ]]',
        "[[/module]]",
      ].join("\n"),
      live: "<p><strong>ONE</strong><br>\nLine one</p>",
      local: "<p><strong>TWO</strong><br>\nLine two<br>\nLine three</p>",
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "random-direct-size-branch-local-empty-remains-actionable",
      source: [
        '[[module ListPages order="random" limit="1" wrapper="no"]]',
        '[[#ifexpr %%size%%%14 != 0 | [!-- ]]ONE[[#ifexpr %%size%%%14 != 0 | --] ]]',
        '[[#ifexpr %%size%%%14 != 1 | [!-- ]]TWO[[#ifexpr %%size%%%14 != 1 | --] ]]',
        "[[/module]]",
      ].join("\n"),
      live: "<p>ONE</p>",
      local: "",
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "random-css-size-branch-selected-row",
      source: [
        '[[module ListPages order="random" limit="1" offset="1" wrapper="no"]]',
        '[[#ifexpr %%size%%%6 != 0 | [!-- ]]',
        '[[module CSS show="true"]]\\n:root { --selected: one; }\\n[[/module]]',
        '[[#ifexpr %%size%%%6 != 0 | --] ]]',
        "[[/module]]",
      ].join("\n"),
      live: '<div class="code"><div class="hl-main"><pre><span class="hl-code">LIVE CSS</span></pre></div></div>',
      local: '<div class="code"><div class="hl-main"><pre><span class="hl-reserved">LOCAL CSS</span></pre></div></div>',
      expected: ["unsynchronized-random-row-state", "none"],
    },
    {
      id: "random-css-size-branch-local-empty-fixture-state",
      source: [
        '[[module ListPages order="random" limit="1" offset="1" wrapper="no"]]',
        '[[#ifexpr %%size%%%6 != 0 | [!-- ]]',
        '[[module CSS show="true"]]\\n:root { --selected: one; }\\n[[/module]]',
        '[[#ifexpr %%size%%%6 != 0 | --] ]]',
        "[[/module]]",
      ].join("\n"),
      live: '<div class="code"><div class="hl-main"><pre><span class="hl-code">LIVE CSS</span></pre></div></div>',
      local: "",
      expected: ["unsynchronized-random-row-state", "none"],
    },
    {
      id: "random-direct-deterministic-size-branch",
      source: [
        '[[module ListPages order="name" limit="1" wrapper="no"]]',
        '[[#ifexpr %%size%%%14 != 0 | [!-- ]]ONE[[#ifexpr %%size%%%14 != 0 | --] ]]',
        '[[#ifexpr %%size%%%14 != 1 | [!-- ]]TWO[[#ifexpr %%size%%%14 != 1 | --] ]]',
        "[[/module]]",
      ].join("\n"),
      live: "<p><strong>ONE</strong></p>",
      local: "<p><em>TWO</em></p>",
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "random-direct-arbitrary-body",
      source: [
        '[[module ListPages order="random" limit="1" wrapper="no"]]',
        "%%link%%",
        "[[/module]]",
      ].join("\n"),
      live: "<p>ONE</p>",
      local: "<p>TWO</p>",
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "random-direct-size-branch-structure-altered",
      source: [
        '[[module ListPages order="random" limit="1" wrapper="no"]]',
        '[[#ifexpr %%size%%%14 != 0 | [!-- ]]ONE[[#ifexpr %%size%%%14 != 0 | --] ]]',
        '[[#ifexpr %%size%%%14 != 1 | [!-- ]]TWO[[#ifexpr %%size%%%14 != 1 | --] ]]',
        "[[/module]]",
      ].join("\n"),
      live: "<p><strong>ONE</strong></p>",
      local: "<div><p><em>TWO</em></p></div>",
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "deterministic-size",
      source: [
        '[[module ListPages order="name" limit="1"]]',
        '[[div class="num[[#expr %%size%%%10]]"]]SAME[[/div]]',
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box"><div class="num2">SAME</div></div>',
      local:
        '<div class="list-pages-box"><div class="num7">SAME</div></div>',
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
  ];
  await fs.writeFile(
    referencesPath,
    cases
      .map(({ id, source, live }) =>
        `${JSON.stringify(reference(id, source, live))}\n`
      )
      .join(""),
  );
  await fs.writeFile(
    verdictPath,
    JSON.stringify({
      cases: cases.map(({ id, live, local }) =>
        mismatchCase(id, live, local)
      ),
    }),
  );

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.deepEqual(
    result.cases.map((row) => [
      row.case_id,
      row.classification,
      row.disposition,
    ]),
    cases.map(({ id, expected }) => [id, ...expected]),
  );
});

test("preview classifier isolates synchronized relative-time query state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const cases = [
    {
      id: "relative-empty-local-fixture",
      source: [
        '[[module ListPages limit="1" updated_at="last 3 day"]]',
        "%%updated_at|%Y-%m-%d%% %%title%%",
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box"><div class="list-pages-item"><p><span class="odate time_1 format_live">1 Jan 2026</span> Live</p></div></div>',
      local: '<div class="list-pages-box"></div>',
      expected: [
        "synchronized-relative-time-query-state",
        "none",
      ],
    },
    {
      id: "relative-date-only-row",
      source: [
        '[[module ListPages limit="1" updated_at="older than 2 days"]]',
        "%%updated_at|%Y-%m-%d%% Fixed row",
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box"><div class="list-pages-item"><p><span class="odate time_2 format_live">1 Jan 2026</span> Fixed row</p></div></div>',
      local: '<div class="list-pages-box"><div class="list-pages-item"><p><span class="odate time_3 format_live">2 Jan 2026</span> Fixed row</p></div></div>',
      expected: ["synchronized-relative-time-query-state", "none"],
    },
    {
      id: "relative-bounded-multiple-empty-local",
      source: [
        '[[module ListPages limit="5" date="last 24 hours"]]',
        "%%title%%",
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box"><div class="list-pages-item"><span class="odate time_1">1 Jan</span> One</div><div class="list-pages-item"><span class="odate time_2">1 Jan</span> Two</div></div>',
      local: '<div class="list-pages-box"></div>',
      expected: [
        "synchronized-relative-time-query-state",
        "none",
      ],
    },
    {
      id: "relative-limit-is-larger-than-perpage",
      source: [
        '[[module ListPages limit="100" perPage="5" updated_at="last 3 days"]]',
        "%%updated_at%% %%title%%",
        "[[/module]]",
      ].join("\n"),
      live: `<div class="list-pages-box">${Array.from({length: 6}, (_, index) =>
        `<div class="list-pages-item"><span class="odate time_${index + 1}">${index + 1} Jan 2026</span> Row ${index + 1}</div>`
      ).join("")}</div>`,
      local: '<div class="list-pages-box"></div>',
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "relative-last-month-date-only-row",
      source: [
        '[[module ListPages limit="1" date="@URL|last month"]]',
        "%%created_at|%Y-%m%%",
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box"><div class="list-pages-item"><p><span class="odate time_1 format_live">1 Jul 2026</span></p></div></div>',
      local: '<div class="list-pages-box"><div class="list-pages-item"><p><span class="odate time_2 format_live">22 Jul 2026</span></p></div></div>',
      expected: [
        "synchronized-relative-time-query-state",
        "none",
      ],
    },
    {
      id: "relative-last-month-created-at-row",
      source: [
        '[[module ListPages limit="2" created_at="last month"]]',
        "%%created_at%% %%title%%",
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box"><div class="list-pages-item"><p><span class="odate time_3 format_live">3 Jul 2026</span> One</p></div></div>',
      local: '<div class="list-pages-box"><div class="list-pages-item"><p><span class="odate time_4 format_live">4 Jul 2026</span> One</p></div></div>',
      expected: [
        "synchronized-relative-time-query-state",
        "none",
      ],
    },
    {
      id: "relative-last-month-static-body-change",
      source: [
        '[[module ListPages limit="1" date="last month"]]',
        "STATIC BODY",
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box"><div class="list-pages-item"><p>LIVE</p></div></div>',
      local: '<div class="list-pages-box"><div class="list-pages-item"><p>LOCAL</p></div></div>',
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "relative-last-month-arbitrary-row-change",
      source: [
        '[[module ListPages limit="1" date="last month"]]',
        "%%title%%",
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box"><div class="list-pages-item"><p><span class="odate time_5 format_live">5 Jul 2026</span> LIVE</p></div></div>',
      local: '<div class="list-pages-box"><div class="list-pages-item"><p><span class="odate time_6 format_live">6 Jul 2026</span> LOCAL</p></div></div>',
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "relative-arbitrary-row-change",
      source: [
        '[[module ListPages limit="1" updated_at="last 3 day"]]',
        "%%updated_at%% Fixed row",
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box"><div class="list-pages-item"><p><span class="odate time_2 format_live">1 Jan 2026</span> LIVE</p></div></div>',
      local: '<div class="list-pages-box"><div class="list-pages-item"><p><span class="odate time_3 format_live">2 Jan 2026</span> LOCAL</p></div></div>',
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "relative-static-body-change",
      source: [
        '[[module ListPages limit="1" updated_at="last 3 day"]]',
        "STATIC BODY",
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box"><div class="list-pages-item"><p>LIVE</p></div></div>',
      local: '<div class="list-pages-box"></div>',
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "relative-random-link-empty-local",
      source: [
        '[[module Listpages date="last 24 hours" order="random" limit="1"]]',
        "[[*%%link%%|Random Work!]]",
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box"><div class="list-pages-item"><p><a target="_blank" href="http://sandbox-for-codex.wikidot.com/random-work">Random Work!</a></p></div></div>',
      local: '<div class="list-pages-box"></div>',
      expected: [
        "synchronized-relative-time-query-state",
        "none",
      ],
    },
    {
      id: "relative-random-static-body-empty-local",
      source: [
        '[[module Listpages date="last 24 hours" order="random" limit="1"]]',
        "STATIC",
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box"><div class="list-pages-item"><p>LIVE</p></div></div>',
      local: '<div class="list-pages-box"></div>',
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "relative-random-link-local-row-changed",
      source: [
        '[[module Listpages date="last 24 hours" order="random" limit="1"]]',
        "[[*%%link%%|Random Work!]]",
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box"><div class="list-pages-item"><p><a target="_blank" href="/one">Random Work!</a></p></div></div>',
      local: '<div class="list-pages-box"><div class="list-pages-item"><p><a target="_blank" href="/two">Random Work!</a></p></div></div>',
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "relative-table-window-row-set",
      source: [
        '[[module ListPages category="*" rating=">-2" tags="-scp" order="size desc desc" separate="false" date="last 30 day" perPage="16"]]',
        "|| %%title_linked%% || (+%%rating%%) || %%children%% ||",
        "[[/module]]",
      ].join("\n"),
      live: [
        '<div class="list-pages-box"><table class="wiki-content-table">',
        '<tr><td><a href="/old-window-page">Old window page</a></td><td>(+0)</td><td>0</td></tr>',
        '<tr><td><a href="/stable-page">Stable page</a></td><td>(+0)</td><td>0</td></tr>',
        '</table><div class="pager"><span class="pager-no">page 1 of 7</span><span class="current">1</span><span class="target"><a href="/ajax-module-connector.php/p/2">2</a></span></div></div>',
      ].join(""),
      local: [
        '<div class="list-pages-box"><table class="wiki-content-table">',
        '<tr><td><a href="/stable-page">Stable page</a></td><td>(+0)</td><td>0</td></tr>',
        '<tr><td><a href="/next-window-page">Next window page</a></td><td>(+0)</td><td>0</td></tr>',
        '</table><div class="pager"><span class="pager-no">page 1 of 7</span><span class="current">1</span><span class="target"><a href="/ajax-module-connector.php/p/2">2</a></span></div></div>',
      ].join(""),
      expected: [
        "synchronized-relative-time-query-state",
        "none",
      ],
    },
    {
      id: "relative-table-static-body-change",
      source: [
        '[[module ListPages category="*" date="last 30 day" perPage="16"]]',
        "|| STATIC ||",
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box"><table class="wiki-content-table"><tr><td>LIVE</td></tr></table></div>',
      local: '<div class="list-pages-box"><table class="wiki-content-table"><tr><td>LOCAL</td></tr></table></div>',
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "relative-table-shape-change",
      source: [
        '[[module ListPages category="*" date="last 30 day" perPage="16"]]',
        "|| %%title%% ||",
        "[[/module]]",
      ].join("\n"),
      live: '<div class="list-pages-box"><table class="wiki-content-table"><tr><td><a href="/one">One</a></td></tr></table></div>',
      local: '<div class="list-pages-box"><table class="wiki-content-table"><tr><td><a href="/one">One</a></td><td>unexpected</td></tr></table></div>',
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
  ];
  await fs.writeFile(
    referencesPath,
    cases
      .map(({ id, source, live }) =>
        `${JSON.stringify(reference(id, source, live))}\n`
      )
      .join(""),
  );
  await fs.writeFile(
    verdictPath,
    JSON.stringify({
      cases: cases.map(({ id, live, local }) =>
        mismatchCase(id, live, local)
      ),
    }),
  );

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.deepEqual(
    result.cases.map((row) => [
      row.case_id,
      row.classification,
      row.disposition,
    ]),
    cases.map(({ id, expected }) => [id, ...expected]),
  );
});

test("preview classifier isolates the bounded URL selector fixture shell", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-url-selector-classify-"),
  );
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    '[[module ListPages separate="no" created_at="@URL" order="created_by" perPage="250" tags="-jp" category="_default art"]]',
    '> %%created_at%%@@[[*user %%created_by%%]]@@',
    '> [[a href="/%%fullname%%" target="_blank"]]%%title%%[[/a]]',
    "[[/module]]",
  ].join("\n");
  const wrapper = (rows, pagerTarget = "/ajax-module-connector.php/p/2") => [
    '<div class="list-pages-box">',
    '<blockquote class="row-shell">',
    ...rows,
    "</blockquote>",
    `<div class="pager"><a href="${pagerTarget}">next</a></div>`,
    "</div>",
  ].join("");
  const live = wrapper([
    '<p data-source="stable"><a href="/alice" target="_blank">Alice</a></p>',
    '<p data-source="stable"><a href="/bob" target="_blank">Bob</a></p>',
  ]);
  const local = wrapper([
    '<p data-source="stable"><a href="/carol" target="_blank">Carol</a></p>',
    '<p data-source="stable"><a href="/dave" target="_blank">Dave</a></p>',
  ]);
  const alteredPager = wrapper(
    [
      '<p data-source="stable"><a href="/carol" target="_blank">Carol</a></p>',
      '<p data-source="stable"><a href="/dave" target="_blank">Dave</a></p>',
    ],
    "/ajax-module-connector.php/p/3",
  );
  const alteredShape = [
    '<div class="list-pages-box"><blockquote class="row-shell">',
    '<p data-source="stable"><a href="/carol" target="_blank">Carol</a></p>',
    "</blockquote>",
    '<div class="pager"><a href="/ajax-module-connector.php/p/2">next</a></div>',
    "</div>",
  ].join("");
  const alteredRowAttribute = local.replace(
    'data-source="stable"',
    'data-source="unexpected"',
  );
  const metadataLive = wrapper([
    '<p data-source="stable"><span class="odate time_100 format_%25Y">01 Jan 2026</span><span class="printuser"><a href="http://www.wikidot.com/user:info/live-user" onclick="WIKIDOT.page.listeners.userInfo(1); return false;"><img alt="live-user" class="small" src="http://www.wikidot.com/avatar.php?userid=1&amp%3Bsize=small" style="background-image:url(http://www.wikidot.com/userkarma.php?u=1)"></a></span><a href="/alice" target="_blank">Alice</a></p>',
    '<p data-source="stable"><span class="odate time_101 format_%25Y">02 Jan 2026</span><span class="printuser"><a href="http://www.wikidot.com/user:info/live-user" onclick="WIKIDOT.page.listeners.userInfo(1); return false;"><img alt="live-user" class="small" src="http://www.wikidot.com/avatar.php?userid=1&amp%3Bsize=small" style="background-image:url(http://www.wikidot.com/userkarma.php?u=1)"></a></span><a href="/bob" target="_blank">Bob</a></p>',
  ]);
  const metadataLocal = wrapper([
    '<p data-source="stable"><span class="odate time_200 format_%25Y">03 Mar 2026</span><span class="printuser"><a href="http://www.wikidot.com/user:info/local-user" onclick="WIKIDOT.page.listeners.userInfo(2); return false;"><img alt="local-user" class="small" src="http://www.wikidot.com/avatar.php?userid=2&amp%3Bsize=small" style="background-image:url(http://www.wikidot.com/userkarma.php?u=2)"></a></span><a href="/carol" target="_blank">Carol</a></p>',
    '<p data-source="stable"><span class="odate time_201 format_%25Y">04 Mar 2026</span><span class="printuser"><a href="http://www.wikidot.com/user:info/local-user" onclick="WIKIDOT.page.listeners.userInfo(2); return false;"><img alt="local-user" class="small" src="http://www.wikidot.com/avatar.php?userid=2&amp%3Bsize=small" style="background-image:url(http://www.wikidot.com/userkarma.php?u=2)"></a></span><a href="/dave" target="_blank">Dave</a></p>',
  ]);
  const staticLabelSource = source.replace(
    "> %%created_at%%@@",
    "> AUDIT LABEL %%created_at%%@@",
  );
  const staticLabelLive = wrapper([
    '<p data-source="stable">AUDIT LABEL <a href="/alice" target="_blank">Alice</a></p>',
  ]);
  const staticLabelLocal = wrapper([
    '<p data-source="stable">CHANGED LABEL <a href="/carol" target="_blank">Carol</a></p>',
  ]);
  const cases = [
    {
      id: "url-selector-selected-set",
      local,
      expected: ["synchronized-url-selector-fixture-state", "none"],
    },
    {
      id: "url-selector-pager-changed",
      local: alteredPager,
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "url-selector-row-shape-changed",
      local: alteredShape,
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "url-selector-row-attribute-changed",
      local: alteredRowAttribute,
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "url-selector-row-metadata-changed",
      live: metadataLive,
      local: metadataLocal,
      expected: ["synchronized-url-selector-fixture-state", "none"],
    },
    {
      id: "url-selector-authored-label-changed",
      source: staticLabelSource,
      live: staticLabelLive,
      local: staticLabelLocal,
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
  ];
  await fs.writeFile(
    referencesPath,
    cases.map(({ id, source: caseSource = source, live: caseLive = live }) =>
      `${JSON.stringify(reference(id, caseSource, caseLive))}\n`
    ).join(""),
  );
  await fs.writeFile(
    verdictPath,
    JSON.stringify({
      cases: cases.map(({
        id,
        source: caseSource = source,
        live: caseLive = live,
        local: caseLocal,
      }) =>
        mismatchCase(id, caseLive, caseLocal)
      ),
    }),
  );

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.deepEqual(
    result.cases.map((row) => [row.case_id, row.classification, row.disposition]),
    cases.map(({ id, expected }) => [id, ...expected]),
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("preview classifier isolates synchronized imported include state", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-include-classify-"),
  );
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const common = '<div class="list-pages-box"></div><div class="list-pages-box"></div>';
  const fixture = (targets) => ({
    source: [
      '[[module ListPages order="name" limit="1"]]%%title%%[[/module]]',
      ...targets.map((target) => `[[include :mirror:${target}]]`),
    ].join("\n"),
    live: `${common}<div class="license-shell"><div class="list-pages-box"> </div></div>`,
    local: `${common}${targets.map((target) =>
      `<div class="error-block">Included page "${target}" does not exist (<a href="/${target}/edit/true">create it now</a>)</div>`
    ).join("")}`,
  });
  const positiveOne = fixture(["component:license-box", "component:license-box-end"]);
  const positiveTwo = fixture(["theme:license", "theme:license-end"]);
  const negativeError = {
    ...positiveOne,
    local: positiveOne.local.replace("component:license-box-end", "other:page"),
  };
  const negativeRows = {
    ...positiveTwo,
    live: `${common}<div class="license-shell"><div class="list-pages-box"><div class="list-pages-item">row</div></div></div>`,
  };
  const cases = [
    { id: "imported-include-license", ...positiveOne, expected: ["synchronized-imported-include-state", "none"] },
    { id: "imported-include-theme", ...positiveTwo, expected: ["synchronized-imported-include-state", "none"] },
    { id: "imported-include-error-altered", ...negativeError, expected: ["listpages-query-or-row-render-divergence", "investigate-query-or-renderer"] },
    { id: "imported-include-row-altered", ...negativeRows, expected: ["listpages-query-or-row-render-divergence", "investigate-query-or-renderer"] },
  ];
  await fs.writeFile(
    referencesPath,
    cases.map(({ id, source, live }) =>
      `${JSON.stringify(reference(id, source, live))}\n`
    ).join(""),
  );
  await fs.writeFile(
    verdictPath,
    JSON.stringify({
      cases: cases.map(({ id, live, local }) => mismatchCase(id, live, local)),
    }),
  );

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.deepEqual(
    result.cases.map((row) => [row.case_id, row.classification, row.disposition]),
    cases.map(({ id, expected }) => [id, ...expected]),
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("preview classifier isolates repeated conditional imported include state without a wrapper", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-repeated-include-classify-"),
  );
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const fixture = (target, liveClass = "oracle__game") => {
    const source = [
      '[[module ListPages limit="1" offset="1" wrapper="no" separate="no" order="random" category="*"]]',
      `[[#ifexpr %%size%%%22 != 0 | [!-- ]][[include :test74p:${target}]]`,
      '[[#ifexpr %%size%%%22 != 0 | --] ]]',
      `[[#ifexpr %%size%%%22 != 1 | [!-- ]][[include :test74p:${target}]]`,
      '[[#ifexpr %%size%%%22 != 1 | --] ]]',
      "[[/module]]",
    ].join("\n");
    return {
      source,
      live: `<div class="${liveClass}"><span>LIVE IMPORT</span></div>`,
      local: `<div class="error-block">Included page "${target}" does not exist (<a href="/${target}/edit/true">create it now</a>)</div>`,
    };
  };
  const positiveOne = fixture("component:todays-one-oracle");
  const positiveTwo = fixture("component:alternate-oracle", "card-shell");
  const positiveDynamic = {
    ...positiveOne,
    id: "repeated-conditional-include-dynamic-prefix",
    source: positiveOne.source.replaceAll(
      "[[include :test74p:component:todays-one-oracle]]",
      "[[%%content{0}%%include :test74p:component:todays-one-oracle]]",
    ),
  };
  const negativeOrder = {
    ...positiveOne,
    source: positiveOne.source.replace('order="random"', 'order="name"'),
  };
  const negativeTarget = {
    ...positiveOne,
    local: positiveOne.local.replace(
      "component:todays-one-oracle",
      "component:other-oracle",
    ),
  };
  const negativeSibling = {
    ...positiveTwo,
    live: `${positiveTwo.live}<p>UNRELATED</p>`,
  };
  const cases = [
    {
      id: "repeated-conditional-include-one",
      ...positiveOne,
      expected: ["synchronized-imported-include-state", "none"],
    },
    {
      id: "repeated-conditional-include-two",
      ...positiveTwo,
      expected: ["synchronized-imported-include-state", "none"],
    },
    {
      ...positiveDynamic,
      expected: ["synchronized-imported-include-state", "none"],
    },
    {
      id: "repeated-conditional-include-deterministic",
      ...negativeOrder,
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "repeated-conditional-include-target-altered",
      ...negativeTarget,
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "repeated-conditional-include-sibling-altered",
      ...negativeSibling,
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
  ];
  await fs.writeFile(
    referencesPath,
    cases.map(({ id, source, live }) =>
      `${JSON.stringify(reference(id, source, live))}\n`
    ).join(""),
  );
  await fs.writeFile(
    verdictPath,
    JSON.stringify({
      cases: cases.map(({ id, live, local }) => mismatchCase(id, live, local)),
    }),
  );

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.deepEqual(
    result.cases.map((row) => [row.case_id, row.classification, row.disposition]),
    cases.map(({ id, expected }) => [id, ...expected]),
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("preview classifier isolates random redirect rows selected from different fixtures", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const live = [
    '<div class="list-pages-box"><div class="list-pages-item">',
    '<p><iframe src="https://snippets.wdfiles.com/local--code/code:iframe-redirect#http://sandbox-for-codex.wikidot.com/target" frameborder="0" scrolling="no" style="width: 9px; height: 9px;"></iframe></p>',
    "</div></div>",
  ].join("");
  const local = [
    '<div class="list-pages-box"><div class="list-pages-item">',
    '<div class="error-block">Sorry, no match for the embedded content.</div>',
    "</div></div>",
  ].join("");
  const cases = [
    {
      id: "random-redirect-default",
      source: [
        '[[module ListPages category="*" order="random" limit="1"]]',
        "[[include :snippets:redirect url=%%link%%]]",
        "[[/module]]",
      ].join("\n"),
      expected: ["unsynchronized-random-row-state", "none"],
    },
    {
      id: "random-redirect-tagged",
      source: [
        '[[module ListPages category="_default" order="random" limit="1" tag="-admin"]]',
        "[[include :snippets:redirect url=%%link%%]]",
        "[[/module]]",
      ].join("\n"),
      expected: ["unsynchronized-random-row-state", "none"],
    },
    {
      id: "deterministic-redirect-row",
      source: [
        '[[module ListPages category="*" order="name" limit="1"]]',
        "[[include :snippets:redirect url=%%link%%]]",
        "[[/module]]",
      ].join("\n"),
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "random-redirect-visible-row-change",
      source: [
        '[[module ListPages category="*" order="random" limit="1"]]',
        "[[include :snippets:redirect url=%%link%%]]",
        "[[/module]]",
      ].join("\n"),
      local: '<div class="list-pages-box"><div class="list-pages-item"><p>LOCAL ROW</p></div></div>',
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
  ];
  await fs.writeFile(
    referencesPath,
    cases
      .map(({ id, source }) => `${JSON.stringify(reference(id, source, live))}\n`)
      .join(""),
  );
  await fs.writeFile(
    verdictPath,
    JSON.stringify({
      cases: cases.map(({ id, local: caseLocal }) =>
        mismatchCase(id, live, caseLocal ?? local)
      ),
    }),
  );

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.deepEqual(
    result.cases.map((row) => [
      row.case_id,
      row.classification,
      row.disposition,
    ]),
    cases.map(({ id, expected }) => [id, ...expected]),
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("preview classifier isolates the evidenced malformed default-row shell from nested non-ListPages rendering", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-malformed-shell-classify-"),
  );
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const evidencedHead =
    "[[module Listpages @@以降という認識で良い。 [[/footnote]]";
  const evidencedSource = `${evidencedHead}\nOUTER SOURCE`;
  const similarUnevidencedSource =
    "[[module Listpages @@似ているが別の先頭。 [[/footnote]]\nOUTER SOURCE";
  const row = (slug, title, date, body) => [
    '<div class="list-pages-item">',
    `<h1><span><a href="/${slug}">${title}</a></span></h1>`,
    '<p>by <span class="printuser">Author</span>',
    `<span class="odate">${date}</span></p>`,
    body,
    "</div>",
  ].join("");
  const pager = (lastLabel = "next »") =>
    `<div class="pager"><a href="/ajax-module-connector.php/p/2">${lastLabel}</a></div>`;
  const wrapper = (rows, tail = pager()) =>
    `<div class="list-pages-box">${rows.join("")}${tail}</div>`;
  const liveRows = [
    row("alpha", "Alpha", "1 Jan 2026", "<p>LIVE ALPHA BODY</p>"),
    row("beta", "Beta", "2 Jan 2026", "<p>LIVE BETA BODY</p>"),
  ];
  const localRows = [
    row("alpha", "Alpha", "1 Jan 2026", "<p>LOCAL ALPHA BODY</p>"),
    row("beta", "Beta", "2 Jan 2026", "<p>LOCAL BETA BODY</p>"),
  ];
  const positiveLive = `${wrapper(liveRows)}<p>LIVE OUTER FTML</p>`;
  const positiveLocal = `${wrapper(localRows)}<p>LOCAL OUTER FTML</p>`;
  const cases = [
    {
      id: "evidenced-shell",
      source: evidencedSource,
      live: positiveLive,
      local: positiveLocal,
      expected:
        "listpages-malformed-default-row-shell-parity",
    },
    {
      id: "changed-row-target",
      source: evidencedSource,
      live: positiveLive,
      local: `${wrapper([
        row("changed", "Alpha", "1 Jan 2026", "<p>LOCAL ALPHA BODY</p>"),
        localRows[1],
      ])}<p>LOCAL OUTER FTML</p>`,
      expected: "listpages-query-or-row-render-divergence",
    },
    {
      id: "changed-row-order",
      source: evidencedSource,
      live: positiveLive,
      local: `${wrapper([...localRows].reverse())}<p>LOCAL OUTER FTML</p>`,
      expected: "listpages-query-or-row-render-divergence",
    },
    {
      id: "changed-row-metadata",
      source: evidencedSource,
      live: positiveLive,
      local: `${wrapper([
        row("alpha", "Alpha", "3 Jan 2026", "<p>LOCAL ALPHA BODY</p>"),
        localRows[1],
      ])}<p>LOCAL OUTER FTML</p>`,
      expected: "listpages-query-or-row-render-divergence",
    },
    {
      id: "changed-pager",
      source: evidencedSource,
      live: positiveLive,
      local:
        `${wrapper(localRows, pager("different"))}<p>LOCAL OUTER FTML</p>`,
      expected: "listpages-query-or-row-render-divergence",
    },
    {
      id: "extra-wrapper-child",
      source: evidencedSource,
      live: positiveLive,
      local: `${wrapper(localRows, `<p>EXTRA</p>${pager()}`)}<p>LOCAL OUTER FTML</p>`,
      expected: "listpages-query-or-row-render-divergence",
    },
    {
      id: "unevidenced-head",
      source: similarUnevidencedSource,
      live: positiveLive,
      local: positiveLocal,
      expected: "listpages-query-or-row-render-divergence",
    },
    {
      id: "unsupported-diagnostic",
      source: evidencedSource,
      live: positiveLive,
      local: `${positiveLocal}<p>TODO: module ListPages</p>`,
      expected: "local-listpages-unsupported-diagnostic",
    },
  ];
  const references = cases.map((entry) =>
    reference(entry.id, entry.source, entry.live)
  );
  await fs.writeFile(
    referencesPath,
    references.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
  );
  await fs.writeFile(
    verdictPath,
    JSON.stringify({
      cases: cases.map((entry) =>
        mismatchCase(entry.id, entry.live, entry.local)
      ),
    }),
  );

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.deepEqual(
    result.cases.map((entry) => [entry.case_id, entry.classification]),
    cases.map((entry) => [entry.id, entry.expected]),
  );
  assert.equal(result.cases[0].disposition, "none");
  for (const entry of result.cases.slice(1, -1)) {
    assert.equal(entry.disposition, "investigate-query-or-renderer");
  }
  assert.equal(
    result.cases.at(-1).disposition,
    "investigate-renderer",
  );
});

test("preview classifier narrows imported title spacing to the exact authored page-link shape", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-title-space-classify-"),
  );
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const linkedSource = [
    '[[module ListPages category="*" separate="no"]]',
    "[*%%link%% %%title%%]",
    "[[/module]]",
  ].join("\n");
  const unlinkedSource = [
    '[[module ListPages category="*" separate="no"]]',
    "%%title%%",
    "[[/module]]",
  ].join("\n");
  const liveHtml =
    '<div class="list-pages-box"><a href="/selected-page">Title 260526</a></div>';
  const localTitleSpace =
    '<div class="list-pages-box"><a href="/selected-page">Title\u00a0260526</a></div>';
  const localAltered =
    '<div class="list-pages-box"><a href="/selected-page">Changed\u00a0260526</a></div>';
  const cases = [
    {
      id: "authored-page-link-title-space",
      source: linkedSource,
      local: localTitleSpace,
      expected: ["synchronized-imported-page-title-state", "none"],
    },
    {
      id: "unrelated-link-title-space",
      source: unlinkedSource,
      local: localTitleSpace,
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "authored-page-link-title-altered",
      source: linkedSource,
      local: localAltered,
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
  ];
  await fs.writeFile(
    referencesPath,
    cases
      .map(({ id, source }) =>
        `${JSON.stringify(reference(id, source, liveHtml))}\n`
      )
      .join(""),
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: cases.map(({ id, local }) =>
      mismatchCase(id, liveHtml, local)
    ),
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.deepEqual(
    result.cases.map((row) => [
      row.case_id,
      row.classification,
      row.disposition,
    ]),
    cases.map(({ id, expected }) => [id, ...expected]),
  );
});

test("preview classifier narrows imported linked-title typography to identical selected targets", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-title-typography-classify-"),
  );
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const linkedSource = [
    '[[module ListPages separate="no"]]',
    "|| %%title_linked%% || %%size%% ||",
    "[[/module]]",
  ].join("\n");
  const unlinkedSource = [
    '[[module ListPages separate="no"]]',
    "|| [[[selected-page | Authored label]]] || %%size%% ||",
    "[[/module]]",
  ].join("\n");
  const liveHtml = [
    '<div class="list-pages-box"><table><tbody><tr>',
    '<td><a href="/selected-page">V7-block-anchor--a-incomplete-opening</a></td>',
    "<td>3</td></tr></tbody></table></div>",
  ].join("");
  const importedTypography = liveHtml.replace(
    "anchor--a",
    "anchor—a",
  );
  const cases = [
    {
      id: "linked-title-import-typography",
      source: linkedSource,
      local: importedTypography,
      expected: ["synchronized-imported-page-title-state", "none"],
    },
    {
      id: "linked-title-different-target",
      source: linkedSource,
      local: importedTypography.replace(
        'href="/selected-page"',
        'href="/different-page"',
      ),
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "linked-title-different-text",
      source: linkedSource,
      local: importedTypography.replace(
        "incomplete-opening",
        "changed-opening",
      ),
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
    {
      id: "authored-link-import-typography",
      source: unlinkedSource,
      local: importedTypography,
      expected: [
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    },
  ];
  await fs.writeFile(
    referencesPath,
    cases
      .map(({ id, source }) =>
        `${JSON.stringify(reference(id, source, liveHtml))}\n`
      )
      .join(""),
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: cases.map(({ id, local }) =>
      mismatchCase(id, liveHtml, local)
    ),
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.deepEqual(
    result.cases.map((row) => [
      row.case_id,
      row.classification,
      row.disposition,
    ]),
    cases.map(({ id, expected }) => [id, ...expected]),
  );
});

test("preview classifier records only the strict tabview bootstrap safety boundary", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-tabview-safety-classify-"),
  );
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    '[[module ListPages category="*" separate="no"]]',
    "[[tabview]]",
    "[[tab First]]First panel[[/tab]]",
    "[[tab Second]]Second panel[[/tab]]",
    "[[/tabview]]",
    "[[/module]]",
  ].join("\n");
  const tabview = (id, transport, secondDisplay = "display:none") => [
    transport.before,
    `<div class="yui-navset" id="${id}">`,
    '<ul class="yui-nav">',
    '<li class="selected"><a href="javascript:;"><em>First</em></a></li>',
    '<li><a href="javascript:;"><em>Second</em></a></li>',
    "</ul>",
    '<div class="yui-content">',
    "<div><p>First panel</p></div>",
    `<div style="${secondDisplay}"><p>Second panel</p></div>`,
    "</div>",
    "</div>",
    transport.after,
  ].join("");
  const liveTransport = (id, host = "d3g0gp89917ko0.cloudfront.net") => {
    const nonce = id.slice("wiki-tabview-".length);
    return {
      before:
        `<script src="http://${host}/v--7690939296dc/common--javascript/yahooui/tabview-min.js" type="text/javascript"></script>`,
      after: [
        '<script type="text/javascript">',
        "//<![CDATA[",
        "OZONE.dom.onDomReady(function(){",
        `var tabView${nonce} = new YAHOO.widget.TabView('${id}');`,
        '}, "dummy-ondomready-block");',
        "//]]>",
        "</script>",
      ].join(""),
    };
  };
  const localTransport = {
    before: "<!-- Wikidot tabview bootstrap omitted -->",
    after: "",
  };
  const footnote = (nonce) => {
    const suffix = nonce === null ? "1" : `${nonce}-1`;
    return [
      '<p>ROW <sup class="footnoteref"><a ',
      `id="footnoteref-${suffix}" href="javascript:;" class="footnoteref" `,
      `onclick="WIKIDOT.page.utils.scrollToReference('footnote-${suffix}')">1</a></sup></p>`,
      '<div class="footnotes-footer"><div class="title">Footnotes</div>',
      `<div class="footnote-footer" id="footnote-${suffix}">`,
      `<a href="javascript:;" onclick="WIKIDOT.page.utils.scrollToReference('footnoteref-${suffix}')">1</a>. NOTE`,
      "</div></div>",
    ].join("");
  };
  const liveId = `wiki-tabview-${"a".repeat(32)}`;
  const localId = `wiki-tabview-${"b".repeat(32)}`;
  const liveHtml = `<div class="list-pages-box">${
    tabview(liveId, liveTransport(liveId))
  }</div>`;
  const validLocal = `<div class="list-pages-box">${
    tabview(localId, localTransport)
  }</div>`;
  const liveFootnoteId = `wiki-tabview-${"c".repeat(32)}`;
  const localFootnoteId = `wiki-tabview-${"d".repeat(32)}`;
  const liveFootnote = `<div class="list-pages-box">${
    tabview(liveFootnoteId, liveTransport(liveFootnoteId))
  }${footnote("987654")}</div>`;
  const localFootnote = `<div class="list-pages-box">${
    tabview(localFootnoteId, localTransport)
  }${footnote(null)}</div>`;
  const cases = [
    ["tabview-safety", liveHtml, validLocal],
    ["tabview-footnote-route-safety", liveFootnote, localFootnote],
    [
      "tabview-static-altered",
      liveHtml,
      `<div class="list-pages-box">${
        tabview(localId, localTransport, "display:block")
      }</div>`,
    ],
    [
      "tabview-loader-altered",
      `<div class="list-pages-box">${
        tabview(
          liveId,
          liveTransport(liveId, "attacker.invalid"),
        )
      }</div>`,
      validLocal,
    ],
    [
      "tabview-extra-script",
      liveHtml,
      validLocal.replace(
        localTransport.before,
        `${localTransport.before}<script src="https://attacker.invalid/x.js"></script>`,
      ),
    ],
  ];
  const references = cases.map(([caseId, live]) =>
    reference(caseId, source, live)
  );
  await fs.writeFile(
    referencesPath,
    references.map((row) => `${JSON.stringify(row)}\n`).join(""),
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: cases.map(([caseId, live, local]) =>
      mismatchCase(caseId, live, local)
    ),
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.deepEqual(
    result.cases.map((row) => [
      row.case_id,
      row.classification,
      row.disposition,
    ]),
    [
      [
        "tabview-safety",
        "tabview-bootstrap-safety-preservation",
        "none",
      ],
      [
        "tabview-footnote-route-safety",
        "tabview-bootstrap-safety-preservation",
        "none",
      ],
      [
        "tabview-static-altered",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
      [
        "tabview-loader-altered",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
      [
        "tabview-extra-script",
        "listpages-query-or-row-render-divergence",
        "investigate-query-or-renderer",
      ],
    ],
  );
});

test("preview classifier does not mask a missing wrapper as fixture state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    '[[module ListPages wrapper="yes" separate="no"]]',
    '[[div class="authored-row-content"]]',
    '[[div class="list-pages-box"]]SAME_ROW[[/div]]',
    "[[/div]]",
    "[[/module]]",
  ].join("\n");
  const localHtml = [
    '<div class="authored-row-content">',
    '<div class="list-pages-box">SAME_ROW</div>',
    "</div>",
  ].join("");
  const liveHtml = `<div class="list-pages-box">${localHtml}</div>`;
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(reference("missing-wrapper", source, liveHtml))}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [mismatchCase("missing-wrapper", liveHtml, localHtml)],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "listpages-render-shape-divergence",
  );
  assert.equal(result.cases[0].disposition, "investigate-renderer");
});

test("preview classifier does not discard live siblings when proving a missing wrapper", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    '[[module ListPages wrapper="yes" separate="no"]]',
    "%%content%%",
    "[[/module]]",
  ].join("\n");
  const localHtml = '<div class="authored-row-content">SAME_ROW</div>';
  const liveHtml = [
    `<div class="list-pages-box">${localHtml}</div>`,
    '<div class="pager">PAGE_TWO</div>',
  ].join("");
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(reference("wrapper-with-live-sibling", source, liveHtml))}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [mismatchCase(
      "wrapper-with-live-sibling",
      liveHtml,
      localHtml,
    )],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "listpages-query-or-row-render-divergence",
  );
  assert.equal(result.cases[0].disposition, "investigate-query-or-renderer");
});

test("preview classifier ignores descendant wrapper classes in wrapper-free row data", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    '[[module ListPages wrapper="no" separate="no"]]',
    "%%content%%",
    "[[/module]]",
  ].join("\n");
  const liveHtml = [
    '<div class="authored-row-content">',
    '<div class="list-pages-box">LIVE_ROW</div>',
    "</div>",
  ].join("");
  const localHtml = '<div class="authored-row-content">LOCAL_ROW</div>';
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(reference("wrapper-free-row", source, liveHtml))}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [mismatchCase("wrapper-free-row", liveHtml, localHtml)],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "listpages-query-or-row-render-divergence",
  );
  assert.equal(result.cases[0].disposition, "investigate-query-or-renderer");
});

test("preview classifier keeps authored wrapper drift actionable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    "[[module ListPages]]",
    '[[div class="list-pages-box"]]SAME[[/div]]',
    "[[/module]]",
  ].join("\n");
  const liveHtml = '<div class="authored-row"><div class="list-pages-box">SAME</div></div>';
  const localHtml = '<div class="list-pages-box">SAME</div>';
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(reference("authored-wrapper-drift", source, liveHtml))}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [mismatchCase("authored-wrapper-drift", liveHtml, localHtml)],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "listpages-query-or-row-render-divergence",
  );
  assert.equal(result.cases[0].disposition, "investigate-query-or-renderer");
});

test("preview classifier uses a variable-bearing body anchor to detect a missing authored head", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const liveReference = await liveArtifactReference(
    "listpages-sections-partial-live.jsonl",
    "listpages-one-row-head-body-separate-no",
  );
  const liveHtml = liveReference.raw_html;
  const localHtml =
    '<div class="list-pages-box"><p>ROW=main:about</p></div>';
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(liveReference)}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [mismatchCase(
      liveReference.syntax_case.case_id,
      liveHtml,
      localHtml,
    )],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "listpages-section-template-divergence",
  );
  assert.equal(result.cases[0].disposition, "investigate-renderer");
});

test("preview classifier uses a variable-bearing body anchor to detect a missing authored foot", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const liveReference = await liveArtifactReference(
    "listpages-sections-partial-live.jsonl",
    "listpages-one-row-body-foot-separate-no",
  );
  const liveHtml = liveReference.raw_html;
  const localHtml =
    '<div class="list-pages-box"><p>ROW=main:about</p></div>';
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(liveReference)}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [mismatchCase(
      liveReference.syntax_case.case_id,
      liveHtml,
      localHtml,
    )],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "listpages-section-template-divergence",
  );
  assert.equal(result.cases[0].disposition, "investigate-renderer");
});

test("preview classifier keeps an ambiguous section and row-text collision actionable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    '[[module ListPages category="*" fullname="main:about" separate="no"]]',
    "[[head]]News[[/head]]",
    "[[body]]%%title%%[[/body]]",
    "[[/module]]",
  ].join("\n");
  const liveHtml =
    '<div class="list-pages-box"><p>News<br>Live title</p></div>';
  const localHtml = '<div class="list-pages-box"><p>News</p></div>';
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(reference("ambiguous-head-row", source, liveHtml))}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [mismatchCase("ambiguous-head-row", liveHtml, localHtml)],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "listpages-query-or-row-render-divergence",
  );
  assert.equal(result.cases[0].disposition, "investigate-query-or-renderer");
});

test("preview classifier checks all foot occurrences around a variable-bearing body anchor", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    '[[module ListPages category="*" fullname="main:about" separate="no"]]',
    "[[body]]%%title%%",
    "ROW_ANCHOR=%%fullname%%[[/body]]",
    "[[foot]]FOOT[[/foot]]",
    "[[/module]]",
  ].join("\n");
  const liveHtml = [
    '<div class="list-pages-box"><p>',
    "Live title<br>ROW_ANCHOR=main:about<br>FOOT",
    "</p></div>",
  ].join("");
  const localHtml = [
    '<div class="list-pages-box"><p>',
    "FOOT<br>ROW_ANCHOR=main:about<br>FOOT",
    "</p></div>",
  ].join("");
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(reference("foot-row-collision", source, liveHtml))}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [mismatchCase("foot-row-collision", liveHtml, localHtml)],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "listpages-query-or-row-render-divergence",
  );
  assert.equal(result.cases[0].disposition, "investigate-query-or-renderer");
});

test("preview classifier requires an authored foot after the final body row", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    '[[module ListPages category="*" separate="no"]]',
    "[[body]]%%title%%",
    "ROW_ANCHOR=%%fullname%%[[/body]]",
    "[[foot]]FOOT[[/foot]]",
    "[[/module]]",
  ].join("\n");
  const liveHtml = [
    '<div class="list-pages-box"><p>',
    "Live one<br>ROW_ANCHOR=main:one<br>",
    "Live two<br>ROW_ANCHOR=main:two<br>FOOT",
    "</p></div>",
  ].join("");
  const localHtml = [
    '<div class="list-pages-box"><p>',
    "Local one<br>ROW_ANCHOR=main:one<br>",
    "FOOT<br>ROW_ANCHOR=main:two",
    "</p></div>",
  ].join("");
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(reference("foot-before-final-row", source, liveHtml))}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [mismatchCase("foot-before-final-row", liveHtml, localHtml)],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "listpages-section-template-divergence",
  );
  assert.equal(result.cases[0].disposition, "investigate-renderer");
});
