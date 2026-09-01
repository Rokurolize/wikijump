import {
  DEFAULT_PARITY_BROWSER_ROOT,
  createParityBrowserControls,
  launchParityBrowser,
} from "./standing-browser-parity-browser-session.mjs";
import { captureBrowserParityObservation } from "./standing-browser-parity-observation.mjs";
import { sha256Value } from "./standing-browser-parity-util.mjs";

const DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 900 });
const DEFAULT_TIMEOUT_MS = 300_000;
const POLICY = Object.freeze({
  policy_version: "candidate-case-browser-v1",
  completion: "DOMContentLoaded followed by the shared bounded resource completion",
});

export function createCandidateBrowserContexts({
  candidateIdentity,
  outputDir,
  signal = null,
  credentialPolicy = "none",
  publicOrigins = [],
  privateInputIdentitySha256 = null,
  responseCacheOptions = null,
}) {
  if (credentialPolicy !== "none") {
    if (!Number.isSafeInteger(credentialPolicy?.storage_state_count) || credentialPolicy.storage_state_count < 1 || !/^[0-9a-f]{64}$/u.test(credentialPolicy.private_input_identity_sha256 ?? "")) {
      throw new Error("candidate browser credential policy is malformed");
    }
    if (privateInputIdentitySha256 !== credentialPolicy.private_input_identity_sha256) {
      throw new Error("candidate browser credential policy does not bind private input identity");
    }
  }
  let controls = null;
  let controlsPromise = null;
  let closed = false;
  let activeFixture = null;
  const sessions = [];
  const ownedContexts = new WeakSet();
  let credentialedContextCount = 0;

  async function getControls() {
    if (closed) throw new Error("candidate browser contexts are closed");
    if (signal?.aborted) {
      throw signal.reason ?? new Error("candidate browser context creation was aborted");
    }
    controlsPromise ??= createParityBrowserControls({
      args: { mode: "candidate-case", timeoutMs: DEFAULT_TIMEOUT_MS },
      outputDir,
      policy: { value: POLICY, sha256: sha256Value(POLICY) },
      candidate: candidateIdentity,
      credentialPolicy,
      publicOrigins,
      responseCacheOptions,
    });
    controls = await controlsPromise;
    if (activeFixture !== null) controls.setActiveFixture(activeFixture);
    return controls;
  }

  return Object.freeze({
    setActiveFixture(fixtureId) {
      if (!/^[A-Z][A-Z0-9_]+$/u.test(fixtureId)) {
        throw new Error("candidate browser fixture ID is invalid");
      }
      activeFixture = fixtureId;
      controls?.setActiveFixture(fixtureId);
    },

    async newCandidateContext({ storageState = null, viewport = DEFAULT_VIEWPORT } = {}) {
      if (credentialPolicy === "none" && storageState !== null) {
        throw new Error("candidate browser credential policy forbids storage state");
      }
      if (credentialPolicy !== "none") {
        if (storageState === null) throw new Error("credentialed candidate browser context requires storage state");
        if (credentialedContextCount >= credentialPolicy.storage_state_count) throw new Error("candidate browser credential context count exceeds policy");
        credentialedContextCount += 1;
      }
      const activeControls = await getControls();
      const session = await launchParityBrowser({
        browserRoot: DEFAULT_PARITY_BROWSER_ROOT,
        browserExecutable: null,
        controls: activeControls,
        local: true,
        viewport,
        storageState,
        responseCache: activeControls.responseCache,
      });
      sessions.push(session);
      ownedContexts.add(session.context);
      return Object.freeze({
        context: session.context,
        environment: session.environment,
      });
    },

    async captureCandidateObservation({ context, ...options }) {
      if (!ownedContexts.has(context)) {
        throw new Error("candidate observation requires a runner-owned browser context");
      }
      return await captureBrowserParityObservation({
        context,
        outputDir,
        ...options,
      });
    },

    async close() {
      if (closed) return null;
      closed = true;
      const failures = [];
      for (const session of sessions.reverse()) {
        await session.close().catch((error) => failures.push(error));
      }
      let gate = null;
      if (controls !== null) {
        gate = await controls.close().catch((error) => {
          failures.push(error);
          return null;
        });
      }
      if (credentialPolicy !== "none" && credentialedContextCount !== credentialPolicy.storage_state_count) {
        failures.push(new Error("candidate browser credential context count does not match policy"));
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "candidate browser contexts failed to close");
      }
      return {
        browser_context_count: sessions.length,
        browser_environments: sessions.map(({ environment }) => environment),
        request_gate: gate,
      };
    },
  });
}
