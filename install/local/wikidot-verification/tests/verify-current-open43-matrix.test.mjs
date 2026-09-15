import assert from "node:assert/strict";
import test from "node:test";

import { buildCurrentOpen43Matrix } from "../scripts/verify-current-open43-matrix.mjs";

function audit(path, issues) {
  return { path, value: { issues } };
}

test("current matrix filters stale audit owners and computes the live dependency frontier", () => {
  const openIssues = [
    {
      number: 1,
      title: "one",
      state: "OPEN",
      blockedBy: { nodes: [], totalCount: 0 },
    },
    {
      number: 2,
      title: "two",
      state: "OPEN",
      blockedBy: { nodes: [{ number: 1, state: "OPEN" }], totalCount: 1 },
    },
    { number: 1089, title: "tracking", state: "OPEN" },
  ];
  const audits = [audit("audit-a.json", [
    {
      issue: 1,
      source_ready: [{ case_id: "A_READY" }],
      needs_source: [],
      candidate_required: [{ case_id: "A_CANDIDATE" }],
      blocked_evidence: [],
    },
    {
      issue: 2,
      subrows: [
        { case_id: "B_BLOCKED", classification: "blocked_evidence" },
      ],
    },
    {
      issue: 3,
      source_ready: [{ case_id: "STALE" }],
      needs_source: [],
      candidate_required: [],
      blocked_evidence: [],
    },
  ])];

  const result = buildCurrentOpen43Matrix(openIssues, audits);
  assert.equal(result.status, "audit_only");
  assert.deepEqual(result.counts, {
    product_issue_count: 2,
    acceptance_row_count: 3,
    classifications: {
      source_ready: 1,
      needs_source: 0,
      candidate_required: 1,
      blocked_evidence: 1,
    },
  });
  assert.deepEqual(result.dependencies, [{ blocker_issue: 1, blocked_issue: 2 }]);
  assert.deepEqual(result.closure_frontier.currently_unblocked_issue_numbers, [1]);
  assert.deepEqual(result.closure_frontier.currently_blocked_issue_numbers, [2]);
  assert.equal(result.closure_frontier.no_issue_is_pre_standing_ready, true);
  assert.deepEqual(result.reconciliation.stale_audit_issue_numbers, [3]);
});

test("current matrix rejects an open product issue without an audit owner", () => {
  assert.throws(
    () => buildCurrentOpen43Matrix(
      [{ number: 1, state: "OPEN" }, { number: 1089, state: "OPEN" }],
      [],
    ),
    /current open product issue #1 has no audit owner/u,
  );
});

test("current matrix rejects duplicate case IDs across audit owners", () => {
  assert.throws(
    () => buildCurrentOpen43Matrix(
      [{ number: 1, state: "OPEN" }, { number: 2, state: "OPEN" }, { number: 1089, state: "OPEN" }],
      [audit("audit-a.json", [
        { issue: 1, source_ready: [{ case_id: "DUP" }], needs_source: [], candidate_required: [], blocked_evidence: [] },
        { issue: 2, source_ready: [{ case_id: "DUP" }], needs_source: [], candidate_required: [], blocked_evidence: [] },
      ])],
    ),
    /case DUP is duplicated/u,
  );
});
