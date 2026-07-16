import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  DeepwellJsonRpcClient,
  LISTPAGES_REPLAY_RUNTIME_IDENTITY_SCHEMA,
  LISTPAGES_REPLAY_RUNTIME_PROOF_SCHEMA,
  runListPagesPreviewDifferential,
  writePreviewDifferential,
} from "../src/listpages-preview-differential.mjs";
import {
  parseArgs as parsePreviewDifferentialArgs,
} from "../scripts/run-listpages-preview-differential.mjs";
import { sha256 } from "../src/syntax-differential.mjs";

function reference(caseId, source, rawHtml) {
  return {
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
}

async function writeReferences(filePath, rows) {
  await fs.writeFile(filePath, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
}

class FakeRpc {
  constructor(previews) {
    this.previews = previews;
  }

  async call(method, params) {
    if (method === "site_get") return { site_id: 7, slug: params.site };
    if (method === "wikidot_page_preview") {
      const value = this.previews.get(params.wikitext);
      if (value instanceof Error) throw value;
      return { body: value, styles: [] };
    }
    throw new Error(`unexpected method ${method}`);
  }
}

function authoritativeIdentity(overrides = {}) {
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
    ...overrides,
  };
}

function authoritativeProof(identity, overrides = {}) {
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
      config_path: "/tmp/listpages-runtime.toml",
      build_manifest_path: "/tmp/listpages-candidate-manifest.json",
    },
    service_containers: {
      cache: "a".repeat(64),
      database: "b".repeat(64),
      files: "c".repeat(64),
    },
    ...overrides,
  };
}

function boundRuntimeObservation(identity, proof, marker, observedAt, phase) {
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
    fixture_state_sha256: marker,
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
    observed_at: observedAt,
    stable_sha256: sha256(JSON.stringify(stable)),
    stable,
  };
}

async function writeAuthoritativeArtifacts(root, identity, proof) {
  const runtimeIdentityPath = path.join(root, "runtime-identity.json");
  const runtimeProofPath = path.join(root, "runtime-proof.json");
  await fs.writeFile(runtimeIdentityPath, `${JSON.stringify(identity)}\n`);
  await fs.writeFile(runtimeProofPath, `${JSON.stringify(proof)}\n`);
  return { runtimeIdentityPath, runtimeProofPath };
}

test("authoritative preview rejects absent or malformed runtime authority before RPC", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-preview-authority-"),
  );
  const referencesPath = path.join(root, "references.jsonl");
  await writeReferences(
    referencesPath,
    [reference("exact", "source", "<p>exact</p>")],
  );
  const rpcClient = new FakeRpc(new Map([["source", "<p>exact</p>"]]));
  rpcClient.calls = [];
  const call = rpcClient.call.bind(rpcClient);
  rpcClient.call = async (...args) => {
    rpcClient.calls.push(args);
    return call(...args);
  };

  await assert.rejects(
    runListPagesPreviewDifferential({
      referencesPath,
      rpcUrl: "http://127.0.0.1:12747/jsonrpc",
      siteSlug: "sandbox-for-codex",
      rpcClient,
      authoritative: true,
    }),
    /authoritative preview requires --runtime-identity and --runtime-proof/,
  );
  assert.equal(rpcClient.calls.length, 0);

  const identity = authoritativeIdentity({ schema: "invented" });
  const artifacts = await writeAuthoritativeArtifacts(
    root,
    identity,
    authoritativeProof(identity),
  );
  await assert.rejects(
    runListPagesPreviewDifferential({
      referencesPath,
      ...artifacts,
      rpcUrl: "http://127.0.0.1:12747/jsonrpc",
      siteSlug: "sandbox-for-codex",
      rpcClient,
      authoritative: true,
    }),
    /runtime identity schema is unsupported/,
  );
  assert.equal(rpcClient.calls.length, 0);
});

test("authoritative preview binds proof, endpoint, site, and every runtime digest", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-preview-binding-"),
  );
  const referencesPath = path.join(root, "references.jsonl");
  await writeReferences(
    referencesPath,
    [reference("exact", "source", "<p>exact</p>")],
  );
  const identity = authoritativeIdentity();
  const proof = authoritativeProof(identity);
  const artifacts = await writeAuthoritativeArtifacts(root, identity, proof);
  const rpcClient = new FakeRpc(new Map([["source", "<p>exact</p>"]]));
  const verdict = await runListPagesPreviewDifferential({
    referencesPath,
    ...artifacts,
    rpcUrl: identity.rpc_url,
    siteSlug: identity.site_slug,
    rpcClient,
    authoritative: true,
    observeRuntime: async ({ phase }) =>
      boundRuntimeObservation(
        identity,
        proof,
        "a".repeat(64),
        phase === "before"
          ? "2026-07-30T00:00:01.000Z"
          : "2026-07-30T00:00:02.000Z",
        phase,
      ),
  });
  assert.equal(verdict.inputs.authority.mode, "authoritative");
  assert.equal(verdict.inputs.authority.completion_eligible, true);
  assert.match(verdict.inputs.runtime_identity_sha256, /^[0-9a-f]{64}$/u);
  assert.match(verdict.inputs.runtime_proof_sha256, /^[0-9a-f]{64}$/u);

  for (const field of [
    "wikijump_sha",
    "wikijump_tree",
    "ftml_sha",
    "dependency_lock_sha256",
    "build_manifest_sha256",
    "build_artifact_key",
    "executable_sha256",
    "runtime_config_sha256",
    "profile",
  ]) {
    const changed = authoritativeProof(identity);
    changed.candidate[field] = field === "profile"
      ? "dev"
      : field === "build_artifact_key"
        ? `candidate-v3-${"0".repeat(64)}`
        : "0".repeat(identity[field].length);
    const changedArtifacts = await writeAuthoritativeArtifacts(
      await fs.mkdtemp(path.join(root, "changed-")),
      identity,
      changed,
    );
    await assert.rejects(
      runListPagesPreviewDifferential({
        referencesPath,
        ...changedArtifacts,
        rpcUrl: identity.rpc_url,
        siteSlug: identity.site_slug,
        rpcClient,
        authoritative: true,
      }),
      new RegExp(`runtime proof ${field} differs`, "u"),
    );
  }
});

test("authoritative preview observes the running endpoint before and after every RPC", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-preview-observed-runtime-"),
  );
  const referencesPath = path.join(root, "references.jsonl");
  await writeReferences(
    referencesPath,
    [reference("exact", "source", "<p>exact</p>")],
  );
  const identity = authoritativeIdentity();
  const proof = authoritativeProof(identity);
  const artifacts = await writeAuthoritativeArtifacts(root, identity, proof);
  const observations = [
    boundRuntimeObservation(
      identity,
      proof,
      "a".repeat(64),
      "2026-07-30T00:00:01.000Z",
      "before",
    ),
    boundRuntimeObservation(
      identity,
      proof,
      "a".repeat(64),
      "2026-07-30T00:00:02.000Z",
      "after",
    ),
  ];
  const phases = [];
  const expectedStableSha256 = observations[0].stable_sha256;
  const verdict = await runListPagesPreviewDifferential({
    referencesPath,
    ...artifacts,
    rpcUrl: identity.rpc_url,
    siteSlug: identity.site_slug,
    rpcClient: new FakeRpc(new Map([["source", "<p>exact</p>"]])),
    authoritative: true,
    observeRuntime: async ({ phase, identity: actualIdentity, proof: actualProof }) => {
      phases.push(phase);
      assert.deepEqual(actualIdentity, identity);
      assert.deepEqual(actualProof, proof);
      return observations.shift();
    },
  });

  assert.deepEqual(phases, ["before", "after"]);
  assert.equal(
    verdict.inputs.authority.runtime_observation_stable_sha256,
    expectedStableSha256,
  );
  assert.match(
    verdict.inputs.authority.runtime_observation_before_sha256,
    /^[0-9a-f]{64}$/u,
  );
  assert.match(
    verdict.inputs.authority.runtime_observation_after_sha256,
    /^[0-9a-f]{64}$/u,
  );
});

test("authoritative preview fails closed before RPC and on mid-replay replacement", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-preview-runtime-replacement-"),
  );
  const referencesPath = path.join(root, "references.jsonl");
  await writeReferences(
    referencesPath,
    [reference("exact", "source", "<p>exact</p>")],
  );
  const identity = authoritativeIdentity();
  const proof = authoritativeProof(identity);
  const artifacts = await writeAuthoritativeArtifacts(root, identity, proof);
  const rpcClient = new FakeRpc(new Map([["source", "<p>exact</p>"]]));
  rpcClient.calls = [];
  const call = rpcClient.call.bind(rpcClient);
  rpcClient.call = async (...args) => {
    rpcClient.calls.push(args);
    return call(...args);
  };

  await assert.rejects(
    runListPagesPreviewDifferential({
      referencesPath,
      ...artifacts,
      rpcUrl: identity.rpc_url,
      siteSlug: identity.site_slug,
      rpcClient,
      authoritative: true,
      observeRuntime: async () => {
        throw new Error("listener PID does not own the endpoint");
      },
    }),
    /listener PID does not own the endpoint/,
  );
  assert.equal(rpcClient.calls.length, 0);

  const observations = [
    boundRuntimeObservation(
      identity,
      proof,
      "a".repeat(64),
      "2026-07-30T00:00:01.000Z",
      "before",
    ),
    boundRuntimeObservation(
      identity,
      proof,
      "b".repeat(64),
      "2026-07-30T00:00:02.000Z",
      "after",
    ),
  ];
  await assert.rejects(
    runListPagesPreviewDifferential({
      referencesPath,
      ...artifacts,
      rpcUrl: identity.rpc_url,
      siteSlug: identity.site_slug,
      rpcClient,
      authoritative: true,
      observeRuntime: async () => observations.shift(),
    }),
    /runtime identity changed during preview replay/,
  );
});

test("diagnostic preview is explicitly completion-ineligible", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-preview-diagnostic-"),
  );
  const referencesPath = path.join(root, "references.jsonl");
  await writeReferences(
    referencesPath,
    [reference("exact", "source", "<p>exact</p>")],
  );
  const verdict = await runListPagesPreviewDifferential({
    referencesPath,
    rpcUrl: "http://127.0.0.1:12747/jsonrpc",
    siteSlug: "sandbox-for-codex",
    rpcClient: new FakeRpc(new Map([["source", "<p>exact</p>"]])),
  });
  assert.deepEqual(verdict.inputs.authority, {
    mode: "diagnostic",
    completion_eligible: false,
  });
});

test("preview CLI exposes an explicit authoritative contract", () => {
  const parsed = parsePreviewDifferentialArgs([
    "node",
    "run-listpages-preview-differential.mjs",
    "--references",
    "references.jsonl",
    "--runtime-identity",
    "identity.json",
    "--runtime-proof",
    "proof.json",
    "--authoritative",
    "--output",
    "verdict.json",
  ]);
  assert.equal(parsed.authoritative, true);
  assert.match(parsed.runtimeProof, /proof\.json$/u);
  assert.equal(parsed.rpcTimeoutMs, 30_000);
  assert.equal(
    parsePreviewDifferentialArgs([
      "node",
      "run-listpages-preview-differential.mjs",
      "--references",
      "references.jsonl",
      "--rpc-timeout-ms",
      "120000",
      "--output",
      "verdict.json",
    ]).rpcTimeoutMs,
    120_000,
  );
  assert.throws(
    () => parsePreviewDifferentialArgs([
      "node",
      "run-listpages-preview-differential.mjs",
      "--references",
      "references.jsonl",
      "--rpc-timeout-ms",
      "120001",
      "--output",
      "verdict.json",
    ]),
    /--rpc-timeout-ms must be an integer from 1 through 120000/,
  );
  assert.throws(
    () => parsePreviewDifferentialArgs([
      "node",
      "run-listpages-preview-differential.mjs",
      "--references",
      "references.jsonl",
      "--authoritative",
      "--output",
      "verdict.json",
    ]),
    /--runtime-identity and --runtime-proof are required with --authoritative/,
  );
});

class BoundedConcurrencyFakeRpc extends FakeRpc {
  constructor(previews) {
    super(previews);
    this.active = 0;
    this.maximumActive = 0;
  }

  async call(method, params) {
    if (method !== "wikidot_page_preview") {
      return super.call(method, params);
    }
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    try {
      const delay = Number(params.wikitext.split(":")[0]);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return { body: this.previews.get(params.wikitext), styles: [] };
    } finally {
      this.active -= 1;
    }
  }
}

test("preview differential records matches and mismatches", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-preview-diff-"));
  const referencesPath = path.join(root, "references.jsonl");
  await writeReferences(referencesPath, [
    reference("match", "**x**", "<p>x</p>"),
    reference("mismatch", "**y**", "<p>live</p>"),
  ]);
  const verdict = await runListPagesPreviewDifferential({
    referencesPath,
    rpcUrl: "http://127.0.0.1:1/jsonrpc",
    siteSlug: "sandbox-for-codex",
    rpcClient: new FakeRpc(new Map([
      ["**x**", "<p>x</p>"],
      ["**y**", "<p>local</p>"],
    ])),
  });

  assert.equal(verdict.summary.counts.match, 1);
  assert.equal(verdict.summary.counts.mismatch, 1);
  assert.equal(verdict.summary.exit_code, 1);
  assert.equal(verdict.inputs.rpc_timeout_ms, 30_000);
  const mismatch = verdict.cases.find((row) => row.case_id === "mismatch");
  assert.equal(mismatch.comparison.checks.visible_text.live, "live");
  assert.equal(mismatch.comparison.checks.visible_text.local, "local");
  assert.equal(mismatch.local.raw_html, "<p>local</p>");
});

test("preview differential rejects duplicate references before the first RPC", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-preview-duplicate-input-"),
  );
  const referencesPath = path.join(root, "references.jsonl");
  const duplicate = reference("duplicate", "source", "<p>live</p>");
  await writeReferences(referencesPath, [duplicate, duplicate]);
  const rpcClient = new FakeRpc(new Map());
  rpcClient.calls = 0;
  rpcClient.call = async () => {
    rpcClient.calls += 1;
    throw new Error("must not be called");
  };
  await assert.rejects(
    runListPagesPreviewDifferential({
      referencesPath,
      rpcUrl: "http://127.0.0.1:1/jsonrpc",
      siteSlug: "sandbox-for-codex",
      rpcClient,
    }),
    /duplicate live reference case ID duplicate/,
  );
  assert.equal(rpcClient.calls, 0);
});

test("Deepwell JSON-RPC client rejects redirects and protocol substitution", async () => {
  const responses = [
    {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ jsonrpc: "1.0", id: 1, result: {} }),
    },
    {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ jsonrpc: "2.0", id: 999, result: {} }),
    },
  ];
  const requests = [];
  const client = new DeepwellJsonRpcClient({
    rpcUrl: "http://127.0.0.1:1/jsonrpc",
    rpcToken: "0".repeat(64),
    fetchImpl: async (_url, options) => {
      requests.push(options);
      return responses.shift();
    },
  });
  await assert.rejects(
    client.call("site_get", {}),
    /mismatched protocol version or response ID/,
  );
  await assert.rejects(
    client.call("site_get", {}),
    /mismatched protocol version or response ID/,
  );
  assert.deepEqual(requests.map(({ redirect }) => redirect), ["error", "error"]);
});

test("preview differential records local errors and writes a verdict", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-preview-diff-error-"));
  const referencesPath = path.join(root, "references.jsonl");
  const output = path.join(root, "verdict.json");
  await writeReferences(referencesPath, [reference("boom", "source", "<p>live</p>")]);
  const verdict = await runListPagesPreviewDifferential({
    referencesPath,
    rpcUrl: "http://127.0.0.1:1/jsonrpc",
    siteSlug: "sandbox-for-codex",
    rpcClient: new FakeRpc(new Map([["source", new Error("boom")]])),
  });
  assert.equal(verdict.summary.counts["local-error"], 1);
  await writePreviewDifferential(verdict, output);
  assert.equal(JSON.parse(await fs.readFile(output, "utf8")).summary.counts["local-error"], 1);
  assert.equal((await fs.stat(output)).mode & 0o777, 0o400);
  await assert.rejects(
    writePreviewDifferential(verdict, output),
    (error) => error?.code === "EEXIST",
  );
});

test("preview differential bounds concurrency and preserves reference order", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-preview-diff-pool-"));
  const referencesPath = path.join(root, "references.jsonl");
  const rows = [
    reference("slow-first", "30:first", "<p>first</p>"),
    reference("fast-second", "1:second", "<p>second</p>"),
    reference("middle-third", "10:third", "<p>third</p>"),
    reference("fast-fourth", "1:fourth", "<p>fourth</p>"),
  ];
  await writeReferences(referencesPath, rows);
  const rpcClient = new BoundedConcurrencyFakeRpc(
    new Map(rows.map((row) => [row.syntax_case.source, row.raw_html])),
  );

  const verdict = await runListPagesPreviewDifferential({
    referencesPath,
    rpcUrl: "http://127.0.0.1:1/jsonrpc",
    siteSlug: "sandbox-for-codex",
    rpcClient,
    concurrency: 2,
  });

  assert.equal(rpcClient.maximumActive, 2);
  assert.deepEqual(
    verdict.cases.map(({ case_id }) => case_id),
    rows.map(({ syntax_case }) => syntax_case.case_id),
  );
  assert.equal(verdict.summary.counts.match, rows.length);
});

test("preview differential rejects unsafe concurrency values", async () => {
  await assert.rejects(
    runListPagesPreviewDifferential({
      referencesPath: "/does/not/matter.jsonl",
      rpcUrl: "http://127.0.0.1:1/jsonrpc",
      siteSlug: "sandbox-for-codex",
      rpcClient: new FakeRpc(new Map()),
      concurrency: 0,
    }),
    /concurrency must be an integer from 1 through 32/,
  );
});
