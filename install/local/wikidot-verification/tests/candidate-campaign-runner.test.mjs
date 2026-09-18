import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCandidateCampaignSchedule,
  runCandidateCampaign,
} from "../src/candidate-campaign-runner.mjs";
import { CANDIDATE_CASE_SETS } from "../src/candidate-case-command.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("candidate campaign schedule keeps Q1035 first and only parallelizes declared read-only sets", () => {
  const schedule = buildCandidateCampaignSchedule();
  assert.equal(schedule.first.name, "open43-q1035-sitechanges");
  assert.equal(schedule.first.execution_class, "read_only");
  assert.ok(schedule.read_only.length >= 10);
  assert.ok(schedule.read_only.every(({ execution_class: executionClass }) => executionClass === "read_only"));
  assert.ok(schedule.exclusive.every(({ execution_class: executionClass }) => executionClass === "exclusive"));
  assert.equal(
    1 + schedule.read_only.length + schedule.exclusive.length,
    Object.values(CANDIDATE_CASE_SETS).filter(({ aliasOf }) => aliasOf === undefined).length,
  );
});

test("candidate campaign holds one lease, overlaps read-only work, then serializes exclusive work", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-campaign-runner-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const privateDir = path.join(root, "private");
  await fs.mkdir(privateDir, { mode: 0o700 });
  await fs.writeFile(path.join(privateDir, "input.json"), "{}\n", { mode: 0o600 });
  const identityPath = path.join(root, "identity.json");
  const identityBytes = `${JSON.stringify({ identity: "candidate" })}\n`;
  await fs.writeFile(identityPath, identityBytes);
  const identitySha256 = sha256(identityBytes);
  const executionNames = Object.entries(CANDIDATE_CASE_SETS)
    .filter(([, registered]) => registered.aliasOf === undefined)
    .map(([name]) => name);
  const inputReceiptPath = path.join(root, "input-receipt.json");
  await fs.writeFile(inputReceiptPath, `${JSON.stringify({
    schema: "wikijump.compatibility_candidate_input_receipt.v2",
    status: "pass",
    candidate: { editable_identity_sha256: identitySha256 },
    output_private_dir: privateDir,
    private_files: ["input.json"],
    case_set_private_inputs: Object.fromEntries(executionNames.map((name) => [name, "input.json"])),
  })}\n`);

  let activeReadOnly = 0;
  let maxActiveReadOnly = 0;
  let exclusiveActive = 0;
  let leaseCount = 0;
  const events = [];
  const schedule = buildCandidateCampaignSchedule();
  const classByName = new Map([
    [schedule.first.name, schedule.first.execution_class],
    ...schedule.read_only.map(({ name, execution_class: executionClass }) => [name, executionClass]),
    ...schedule.exclusive.map(({ name, execution_class: executionClass }) => [name, executionClass]),
  ]);
  const dependencies = {
    async candidateCaseSet(name) {
      return { id: name, caseIds: ["X"], prepareRun() {} };
    },
    async readPrivateCandidateCaseInput() {
      return { value: {}, sha256: "0".repeat(64) };
    },
    async withCandidateGlobalLease(_options, operation) {
      leaseCount += 1;
      return await operation();
    },
    async runCandidateCaseSet({ caseSet }) {
      const executionClass = classByName.get(caseSet.id);
      events.push(`start:${caseSet.id}`);
      if (executionClass === "read_only") {
        activeReadOnly += 1;
        maxActiveReadOnly = Math.max(maxActiveReadOnly, activeReadOnly);
        assert.equal(exclusiveActive, 0);
        await new Promise((resolve) => setTimeout(resolve, caseSet.id === "open43-q1035-sitechanges" ? 1 : 6));
        activeReadOnly -= 1;
      } else {
        assert.equal(activeReadOnly, 0);
        assert.equal(exclusiveActive, 0);
        exclusiveActive = 1;
        await new Promise((resolve) => setTimeout(resolve, 1));
        exclusiveActive = 0;
      }
      events.push(`end:${caseSet.id}`);
      return { status: "pass" };
    },
    now: () => "2026-09-18T00:00:00.000Z",
  };

  const result = await runCandidateCampaign({
    candidateIdentityPath: identityPath,
    inputReceiptPath,
    outputDir: path.join(root, "campaign"),
    parallelReadOnly: 3,
    dependencies,
  });
  assert.equal(result.status, "pass");
  assert.equal(result.completed.length, executionNames.length);
  assert.equal(leaseCount, 1);
  assert.ok(maxActiveReadOnly >= 2);
  assert.deepEqual(events.slice(0, 2), [
    "start:open43-q1035-sitechanges",
    "end:open43-q1035-sitechanges",
  ]);
  const firstExclusiveStart = events.findIndex((event) =>
    event.startsWith("start:") && classByName.get(event.slice("start:".length)) === "exclusive"
  );
  const lastReadOnlyEnd = Math.max(...events.map((event, index) =>
    event.startsWith("end:") && classByName.get(event.slice("end:".length)) === "read_only" ? index : -1
  ));
  assert.ok(firstExclusiveStart > lastReadOnlyEnd);
});
