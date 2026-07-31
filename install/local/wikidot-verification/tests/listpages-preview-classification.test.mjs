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
  const liveLinkedTitle =
    '<div class="list-pages-box"><a href="/same-page">Title A B</a></div>';
  const localLinkedTitle =
    '<div class="list-pages-box"><a href="/same-page">Title A\u00a0B</a></div>';
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
    [
      "imported-file-origin-altered",
      liveImportedFile,
      localImportedFile.replace("image.png", "altered.png"),
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
      "html-block-nonce",
      '<div class="list-pages-box"><iframe src="/target/html/4587713091c90020f4639c0c8a574dc6035899fe-123" allowtransparency="true" frameborder="0" class="html-block-iframe"></iframe></div>',
      '<div class="list-pages-box"><iframe src="/target/html/4587713091c90020f4639c0c8a574dc6035899fe-456" allowtransparency="true" frameborder="0" class="html-block-iframe"></iframe></div>',
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
  const references = cases.map(([caseId, liveHtml]) =>
    reference(caseId, source, liveHtml)
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
        "imported-file-origin-altered",
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
      ["html-block-nonce", "canonical-html-block-route-nonce", "none"],
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
