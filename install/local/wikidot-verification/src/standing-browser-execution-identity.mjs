import {
  collectCandidateSourceExecutionIdentity,
  validateCandidateSourceExecutionIdentity,
} from "./candidate-source-execution-identity.mjs";

export const STANDING_BROWSER_EXECUTION_IDENTITY_SCHEMA =
  "wikijump.standing_browser_execution_identity.v1";

export const STANDING_BROWSER_EXECUTION_MODULES = Object.freeze([
  "install/local/wikidot-verification/src/standing-browser-execution-identity.mjs",
  "install/local/wikidot-verification/src/candidate-source-execution-identity.mjs",
  "install/local/wikidot-verification/scripts/run-standing-browser-parity.mjs",
  "install/local/wikidot-verification/src/atomic-no-replace.mjs",
  "install/local/wikidot-verification/src/browser-request-gate.mjs",
  "install/local/wikidot-verification/src/capture-egress-proxy.mjs",
  "install/local/wikidot-verification/src/standing-browser-canaries.mjs",
  "install/local/wikidot-verification/src/first-divergent-element.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-browser-session.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-contract.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-observation.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-reference.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-runner.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
  "install/local/wikidot-verification/src/standing-browser-pseudo-layout.mjs",
  "install/local/wikidot-verification/src/standing-browser-runtime-identity.mjs",
  "install/local/wikidot-verification/src/standing-browser-screenshot.mjs",
]);

export function validateCandidateExecutionIdentity(value, candidateIdentity) {
  return validateCandidateSourceExecutionIdentity(
    value,
    candidateIdentity,
    STANDING_BROWSER_EXECUTION_MODULES,
    { schema: STANDING_BROWSER_EXECUTION_IDENTITY_SCHEMA },
  );
}

export async function collectCandidateExecutionIdentity(candidateIdentity) {
  return await collectCandidateSourceExecutionIdentity(
    candidateIdentity,
    STANDING_BROWSER_EXECUTION_MODULES,
    { schema: STANDING_BROWSER_EXECUTION_IDENTITY_SCHEMA },
  );
}
