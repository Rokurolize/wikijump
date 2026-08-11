import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateOpen43ConcurrencyLedger } from "../src/open43-concurrency-ledger.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../../../..");

const lane = (overrides = {}) => ({
  id: "q-users-ftml-pin-g2",
  agent: "/root/a_rate",
  issue_numbers: [1026],
  branch: "agent/open87-pr2/q-users-ftml-pin-g2",
  worktree: "/home/roku/wjlab/worktrees/open87-pr2/q-users-ftml-pin-g2",
  base: "7".repeat(40),
  head: null,
  status: "running",
  may_run_cargo: false,
  may_mutate_runtime: false,
  ...overrides,
});

const validLedger = () => ({
  schema: "wikijump.open43_concurrency_ledger.v1",
  campaign: "open43-pr2",
  updated_at: "2026-08-09T18:30:00+09:00",
  integration_branch: {
    repository: "Rokurolize/wikijump",
    branch: "fix/open87-pr2-modules-actions-media-settings",
    worktree: "/home/roku/.devspace/worktrees/wikijump-3af0335e",
    reconciled_head: "9".repeat(40),
  },
  limits: {
    configured_threads: 13,
    coordinator_threads: 1,
    writer_threads: 12,
    available_threads: 4,
  },
  brokers: {
    build: {
      owner: "/root",
      target_dir_pattern:
        "/home/roku/wjlab/targets/wikijump-<pushed-short-sha>-dev",
    },
    runtime: {
      owner: "/root",
      resources: [
        "task-db",
        "task-cache",
        "task-files",
        "candidate-process",
        "browser-profile",
      ],
    },
    standing: {
      owner: "/root",
      state: "frozen",
    },
  },
  lanes: [lane()],
});

test("a bounded lane ledger assigns Cargo and runtime mutation only to brokers", () => {
  assert.doesNotThrow(() => validateOpen43ConcurrencyLedger(validLedger()));
});

test("active lanes cannot exceed the currently available writer slots", () => {
  const ledger = validLedger();
  ledger.lanes = Array.from({ length: 4 }, (_, index) =>
    lane({
      id: `lane-${index}`,
      issue_numbers: [1026 + index],
      branch: `agent/open87-pr2/lane-${index}`,
      worktree: `/home/roku/wjlab/worktrees/open87-pr2/lane-${index}`,
    }),
  );
  assert.throws(
    () => validateOpen43ConcurrencyLedger(ledger),
    /available writer slots/u,
  );
});

test("active lanes cannot share an issue, branch, or worktree", () => {
  for (const duplicate of [
    lane({
      id: "duplicate-issue",
      branch: "agent/other",
      worktree: "/tmp/other",
    }),
    lane({
      id: "duplicate-branch",
      issue_numbers: [1038],
      worktree: "/tmp/other",
    }),
    lane({
      id: "duplicate-worktree",
      issue_numbers: [1038],
      branch: "agent/other",
    }),
  ]) {
    const ledger = validLedger();
    ledger.lanes.push(duplicate);
    assert.throws(() => validateOpen43ConcurrencyLedger(ledger), /duplicate/u);
  }
});

test("a source lane cannot acquire Cargo or runtime mutation authority", () => {
  for (const field of ["may_run_cargo", "may_mutate_runtime"]) {
    const ledger = validLedger();
    ledger.lanes[0][field] = true;
    assert.throws(() => validateOpen43ConcurrencyLedger(ledger), /broker/u);
  }
});

test("the committed Open43 concurrency ledger is valid", () => {
  const ledger = JSON.parse(
    readFileSync(
      path.join(
        repositoryRoot,
        "docs/development/open43-concurrency-ledger.json",
      ),
      "utf8",
    ),
  );
  assert.doesNotThrow(() => validateOpen43ConcurrencyLedger(ledger));
});
