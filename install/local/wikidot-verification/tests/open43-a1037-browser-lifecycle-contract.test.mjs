import assert from "node:assert/strict";
import test from "node:test";

import {
  OPEN43_A1037_BROWSER_LIFECYCLE_SCHEMA,
  verifyOpen43A1037BrowserLifecycleReceipt,
} from "../src/open43-a1037-browser-lifecycle-contract.mjs";

const stages = () => Object.fromEntries([
  "initial_dom",
  "submit",
  "success",
  "error",
  "reload",
  "history",
  "focus",
  "keyboard",
  "repeated_submission",
].map((name) => [name, { observed: true, request_count: 0 }]));

function receipt() {
  return {
    schema: OPEN43_A1037_BROWSER_LIFECYCLE_SCHEMA,
    status: "pass",
    closure: "closed",
    run_id: "a1037-mailform-20260915t120000z-abcd",
    page_slug: "run-owned:a1037-mailform-abcd",
    lane: "mailform",
    browser_identity_sha256: "a".repeat(64),
    positive_authority: {
      mailform: { status: "pass", cleanup: { status: "pass" } },
    },
    modules: { mailform: { stages: stages() } },
    cleanup: {
      status: "pass",
      pages_closed: true,
      contexts_closed: true,
      storage_states_removed: true,
      request_gate_closed: true,
      run_owned_page_absent: true,
    },
    unexpected_mutation_count: 0,
    unexpected_external_request_count: 0,
  };
}

test("A1037 browser verifier requires positive authority and complete cleanup", () => {
  const result = verifyOpen43A1037BrowserLifecycleReceipt(receipt(), {
    runId: "a1037-mailform-20260915t120000z-abcd",
    pageSlug: "run-owned:a1037-mailform-abcd",
  });
  assert.equal(result.verified, true);
  assert.equal(result.module_stage_count, 9);
});

test("A1037 browser verifier rejects a missing positive mutation receipt", () => {
  const value = receipt();
  delete value.positive_authority.mailform;
  assert.throws(() => verifyOpen43A1037BrowserLifecycleReceipt(value), /positive authority/);
});

test("A1037 browser verifier rejects leaked browser or unexpected request state", () => {
  const value = receipt();
  value.cleanup.contexts_closed = false;
  assert.throws(() => verifyOpen43A1037BrowserLifecycleReceipt(value), /contexts_closed/);
  value.cleanup.contexts_closed = true;
  value.unexpected_mutation_count = 1;
  assert.throws(() => verifyOpen43A1037BrowserLifecycleReceipt(value), /unexpected requests/);
});
