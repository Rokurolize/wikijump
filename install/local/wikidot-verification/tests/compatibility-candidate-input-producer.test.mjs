import assert from "node:assert/strict";
import test from "node:test";

import { COMPATIBILITY_CANDIDATE_INPUT_RECEIPT_SCHEMA, parseCompatibilityCandidateInputArgs } from "../src/compatibility-candidate-input-producer.mjs";

test("compatibility candidate input producer requires distinct identity-bound paths", () => {
  assert.equal(COMPATIBILITY_CANDIDATE_INPUT_RECEIPT_SCHEMA, "wikijump.compatibility_candidate_input_receipt.v1");
  const parsed = parseCompatibilityCandidateInputArgs(["--candidate-identity", "candidate.json", "--private-runtime", "runtime.json", "--template-private-dir", "template", "--output-private-dir", "output", "--receipt", "receipt.json"]);
  assert.match(parsed["candidate-identity"], /candidate\.json$/u);
  assert.notEqual(parsed["template-private-dir"], parsed["output-private-dir"]);
  assert.throws(() => parseCompatibilityCandidateInputArgs(["--candidate-identity", "candidate.json"]), /Usage/u);
});
