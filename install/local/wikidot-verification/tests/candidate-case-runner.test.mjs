import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { sha256Value } from "../src/standing-browser-parity-util.mjs";
import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";

const mixedHex = (character, length) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(length / 2);
const hash = (character) => mixedHex(character, 64);
const git = (character) => mixedHex(character, 40);

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: {
      seal_sha256: hash("b"),
      verdict_sha256: hash("c"),
      final_images_sha256: hash("d"),
    },
    candidate: {
      owner: "candidate-case-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "wikijump-candidate-case-fixture",
      port_443_published: false,
      wikijump_commit: git("1"),
      wikijump_tree: git("2"),
      ftml_sha: git("3"),
      profile: "production-build",
      source_clean: true,
      images: { caddy: `sha256:${hash("e")}` },
      config: {
        isolated_overlay_sha256: hash("f"),
        promotion_base_manifest_sha256: hash("0"),
        effective_runtime_services_sha256: hash("4"),
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
      manifest_sha256: hash("5"),
      seal_sha256: hash("6"),
    },
  };
}

function oneCaseSet(
  events,
  {
    executeResult,
    omitRelease = false,
    caseVerification = null,
    verifiedCleanup = { public_absence_verified: true },
  } = {},
) {
  return {
    id: "fixture-one-case",
    caseIds: ["M1062_SERIALIZABLE_ACTION_RESPONSE"],
    prepareRun({ runId, resources }) {
      let page = null;
      return {
        sourceFiles: [],
        runtimeBindings: [],
        privateInputIdentity: { editor_session_sha256: hash("8") },
        async execute() {
          page = resources.register("page", {
            site_slug: "scpaiueouiuiuiui",
            page_slug: "run-owned-page",
          });
          events.push("registered");
          events.push("executed");
          return executeResult ?? [
            {
              case_id: "M1062_SERIALIZABLE_ACTION_RESPONSE",
              observations: {
                response_body_sha256: hash("9"),
                response_serialized: true,
              },
            },
          ];
        },
        async cleanup() {
          events.push("cleanup");
          if (page !== null && !omitRelease) {
            resources.release(page, {
              page_get: null,
              page_get_files: null,
              original_get_status: 404,
              original_head_status: 404,
            });
          }
          return {
            page_get: null,
            page_get_files: null,
            original_get_status: 404,
            original_head_status: 404,
          };
        },
        verifyCase(caseId, observations) {
          assert.equal(caseId, "M1062_SERIALIZABLE_ACTION_RESPONSE");
          assert.equal(observations.response_serialized, true);
          return caseVerification ?? { verified: true, response_body_sha256: observations.response_body_sha256 };
        },
        verifyCleanup(proof, resourceSnapshot) {
          assert.equal(proof.page_get, null);
          assert.equal(Array.isArray(resourceSnapshot), true);
          return verifiedCleanup;
        },
      };
    },
  };
}

function fixtureDependencies({ drift = false } = {}) {
  let observation = 0;
  return {
    collectExecutionIdentity: async () => ({
      schema: "fixture.execution_identity.v1",
      source_clean: true,
      module_manifest_sha256: hash("c"),
    }),
    observeRuntimeIdentity: async () => ({
      schema: "fixture.runtime_observation.v1",
      identity: drift ? `observation-${++observation}` : "stable",
    }),
    assertStableRuntimeIdentity(before, after) {
      assert.equal(before.identity, after.identity, "runtime identity drifted");
    },
    now: () => "2026-08-10T00:00:00.000Z",
  };
}

async function temporaryOutput(t, name = "evidence") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-case-runner-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return path.join(root, name);
}

async function runOne(t, caseSet, options = {}) {
  const identity = candidateIdentity();
  return await runCandidateCaseSet({
    candidateIdentity: identity,
    candidateIdentitySha256: sha256Value(identity),
    privateInput: { secret: "never-publish-me" },
    privateInputSha256: hash("b"),
    outputDir: options.outputDir ?? (await temporaryOutput(t)),
    caseSet,
    runId: "candidate-run-0123456789ab",
    dependencies: options.dependencies ?? fixtureDependencies(),
  });
}

function aggregateHas(pattern) {
  return (error) =>
    error instanceof AggregateError &&
    error.errors.some((cause) => pattern.test(cause.message));
}

test("CandidateCaseRunner publishes one exact case only after public cleanup and stable identity", async (t) => {
  const outputDir = await temporaryOutput(t);
  const events = [];
  let observation = 0;
  const identity = candidateIdentity();
  const result = await runCandidateCaseSet({
    candidateIdentity: identity,
    candidateIdentitySha256: sha256Value(identity),
    privateInput: { secret: "never-publish-me" },
    privateInputSha256: hash("b"),
    outputDir,
    caseSet: oneCaseSet(events),
    runId: "candidate-run-0123456789ab",
    dependencies: {
      collectExecutionIdentity: async () => ({
        schema: "fixture.execution_identity.v1",
        source_clean: true,
        module_manifest_sha256: hash("c"),
      }),
      observeRuntimeIdentity: async () => ({
        schema: "fixture.runtime_observation.v1",
        identity: "stable",
        sequence: ++observation,
      }),
      assertStableRuntimeIdentity(before, after) {
        assert.equal(before.identity, after.identity);
      },
      now: () => "2026-08-10T00:00:00.000Z",
    },
  });

  assert.equal(result.status, "pass");
  assert.deepEqual(events, ["registered", "executed", "cleanup"]);
  assert.equal(observation, 2);
  const aggregate = JSON.parse(
    await fs.readFile(path.join(outputDir, "candidate-case-receipt.json"), "utf8"),
  );
  assert.equal(aggregate.status, "pass");
  assert.deepEqual(aggregate.denominator.case_ids, [
    "M1062_SERIALIZABLE_ACTION_RESPONSE",
  ]);
  assert.equal("run_plan" in aggregate, false);
  await assert.rejects(fs.stat(path.join(outputDir, "run-plan.json")), { code: "ENOENT" });
  assert.equal(JSON.stringify(aggregate).includes("never-publish-me"), false);
  const caseReceipt = JSON.parse(
    await fs.readFile(
      path.join(outputDir, "cases", "M1062_SERIALIZABLE_ACTION_RESPONSE.json"),
      "utf8",
    ),
  );
  assert.equal(caseReceipt.status, "pass");
  assert.equal("run_plan_sha256" in caseReceipt, false);
  assert.equal(caseReceipt.cleanup.public_absence_verified, true);
});

test("CandidateCaseRunner rejects producer-authored verdicts after cleanup", async (t) => {
  const events = [];
  await assert.rejects(
    runOne(
      t,
      oneCaseSet(events, {
        executeResult: [
          {
            case_id: "M1062_SERIALIZABLE_ACTION_RESPONSE",
            status: "pass",
            observations: { response_serialized: false },
          },
        ],
      }),
    ),
    /producer-authored status or verdict is forbidden/u,
  );
  assert.deepEqual(events, ["registered", "executed", "cleanup"]);
});

test("CandidateCaseRunner rejects nonthrowing verification without explicit success", async (t) => {
  for (const caseVerification of [false, {}, { verified: false }]) {
    await assert.rejects(runOne(t, oneCaseSet([], { caseVerification })), /verification/u);
  }
});

test("CandidateCaseRunner rejects duplicate and skipped denominator entries", async (t) => {
  const observation = {
    case_id: "M1062_SERIALIZABLE_ACTION_RESPONSE",
    observations: { response_body_sha256: hash("9"), response_serialized: true },
  };
  await assert.rejects(
    runOne(t, oneCaseSet([], { executeResult: [observation, observation] })),
    /duplicated/u,
  );
  await assert.rejects(
    runOne(t, oneCaseSet([], { executeResult: [] })),
    /observation is missing/u,
  );
});

test("CandidateCaseRunner rejects missing cleanup proof and runtime identity drift", async (t) => {
  await assert.rejects(
    runOne(t, oneCaseSet([], { omitRelease: true })),
    aggregateHas(/run resource record contains unreleased resources/u),
  );
  await assert.rejects(
    runOne(t, oneCaseSet([], { verifiedCleanup: { public_absence_verified: false } })),
    aggregateHas(/cleanup did not prove public absence/u),
  );
  await assert.rejects(
    runOne(t, oneCaseSet([]), { dependencies: fixtureDependencies({ drift: true }) }),
    aggregateHas(/runtime identity drifted/u),
  );
});

test("CandidateCaseRunner never reuses a preexisting output directory", async (t) => {
  const outputDir = await temporaryOutput(t);
  await fs.mkdir(outputDir);
  await fs.writeFile(path.join(outputDir, "candidate-case-receipt.json"), "owned\n");
  await assert.rejects(
    runOne(t, oneCaseSet([]), { outputDir }),
    /output directory already exists/u,
  );
  assert.equal(
    await fs.readFile(path.join(outputDir, "candidate-case-receipt.json"), "utf8"),
    "owned\n",
  );
});

test("CandidateCaseSet prepareRun cannot register a resource before execution", async (t) => {
  const caseSet = oneCaseSet([]);
  const prepareRun = caseSet.prepareRun;
  caseSet.prepareRun = (args) => {
    args.resources.register("page", { page_slug: "too-early" });
    return prepareRun(args);
  };
  await assert.rejects(runOne(t, caseSet), /prepareRun must be side-effect-free/u);
});

test("CandidateCaseRunner owns and closes its lazy browser contexts", async (t) => {
  const events = [];
  const candidateBrowserContexts = {
    setActiveFixture(fixtureId) {
      events.push(`browser-fixture:${fixtureId}`);
    },
    async newCandidateContext() {
      events.push("browser-context");
      return { context: {}, environment: {} };
    },
    async captureCandidateObservation(options) {
      events.push(`browser-capture:${options.label}`);
      return { label: options.label };
    },
    async close() {
      events.push("browser-close");
    },
  };
  const caseSet = oneCaseSet(events);
  const prepareRun = caseSet.prepareRun;
  caseSet.prepareRun = (args) => {
    assert.equal(typeof args.candidateBrowserContexts.newCandidateContext, "function");
    assert.throws(
      () => args.candidateBrowserContexts.newCandidateContext(),
      /unavailable during prepareRun/u,
    );
    const run = prepareRun(args);
    run.browserPublicOrigins = ["https://www.youtube.com"];
    const execute = run.execute;
    const cleanup = run.cleanup;
    run.execute = async () => {
      await args.candidateBrowserContexts.setActiveFixture(
        "M1062_SERIALIZABLE_ACTION_RESPONSE",
      );
      await args.candidateBrowserContexts.captureCandidateObservation({
        label: "settings",
      });
      return await execute();
    };
    run.cleanup = async () => {
      assert.throws(
        () => args.candidateBrowserContexts.newCandidateContext(),
        /unavailable during prepareRun/u,
      );
      return await cleanup();
    };
    return run;
  };

  await runOne(t, caseSet, {
    dependencies: {
      ...fixtureDependencies(),
      createBrowserContexts(options) {
        assert.equal(options.outputDir.endsWith("evidence"), true);
        assert.equal(options.candidateIdentity.candidate.endpoint.port, 18443);
        assert.equal(options.credentialPolicy, "none");
        assert.equal(options.privateInputIdentitySha256, sha256Value({ editor_session_sha256: hash("8") }));
        assert.deepEqual(options.publicOrigins, ["https://www.youtube.com"]);
        return candidateBrowserContexts;
      },
    },
  });

  assert.deepEqual(events, [
    "browser-fixture:M1062_SERIALIZABLE_ACTION_RESPONSE",
    "browser-capture:settings",
    "registered",
    "executed",
    "browser-close",
    "cleanup",
  ]);
});

test("CandidateCaseRunner still performs public cleanup when browser close fails", async (t) => {
  const events = [];
  const caseSet = oneCaseSet(events);
  const prepareRun = caseSet.prepareRun;
  caseSet.prepareRun = (args) => {
    const run = prepareRun(args);
    const execute = run.execute;
    run.execute = async () => {
      await args.candidateBrowserContexts.newCandidateContext();
      return await execute();
    };
    return run;
  };
  await assert.rejects(
    runOne(t, caseSet, {
      dependencies: {
        ...fixtureDependencies(),
        createBrowserContexts() {
          return {
            async newCandidateContext() { return { context: {}, environment: {} }; },
            async close() { events.push("browser-close"); throw new Error("browser close failed"); },
          };
        },
      },
    }),
    aggregateHas(/browser close failed/u),
  );
  assert.deepEqual(events, ["registered", "executed", "browser-close", "cleanup"]);
});

test("CandidateCaseRunner leaves its browser graph unloaded when a case set never uses it", async (t) => {
  let browserOwnerCreations = 0;
  const result = await runOne(t, oneCaseSet([]), {
    dependencies: {
      ...fixtureDependencies(),
      createBrowserContexts() {
        browserOwnerCreations += 1;
        throw new Error("unused browser owner must not be created");
      },
    },
  });
  assert.equal(browserOwnerCreations, 0);
  assert.equal(result.browser_cleanup, null);
});
