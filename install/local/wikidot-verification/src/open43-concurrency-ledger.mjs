const SHA = /^[0-9a-f]{40}$/u;
const LANE_STATUSES = new Set(["running", "completed", "integrated"]);

const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

const duplicate = (values) => {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
};

export const validateOpen43ConcurrencyLedger = (ledger) => {
  invariant(
    ledger?.schema === "wikijump.open43_concurrency_ledger.v1",
    "unexpected Open43 concurrency ledger schema",
  );
  invariant(ledger.campaign === "open43-pr2", "unexpected campaign");
  invariant(
    SHA.test(ledger.integration_branch?.reconciled_head ?? ""),
    "integration reconciled head must be a full commit",
  );

  const {
    configured_threads,
    coordinator_threads,
    writer_threads,
    available_threads,
  } = ledger.limits ?? {};
  invariant(
    configured_threads === coordinator_threads + writer_threads,
    "configured thread limit must equal coordinator and writer limits",
  );
  invariant(
    Number.isInteger(available_threads) &&
      available_threads > coordinator_threads &&
      available_threads <= configured_threads,
    "available thread limit is invalid",
  );

  invariant(
    ledger.brokers?.build?.owner === "/root",
    "build broker must be /root",
  );
  invariant(
    ledger.brokers?.runtime?.owner === "/root",
    "runtime broker must be /root",
  );
  invariant(
    ledger.brokers?.standing?.owner === "/root",
    "standing broker must be /root",
  );
  invariant(
    ledger.brokers.standing.state === "frozen",
    "standing must remain frozen during source work",
  );

  invariant(Array.isArray(ledger.lanes), "lanes must be an array");
  for (const lane of ledger.lanes) {
    invariant(
      typeof lane.id === "string" && lane.id.length > 0,
      "lane id is required",
    );
    invariant(
      LANE_STATUSES.has(lane.status),
      `invalid lane status: ${lane.id}`,
    );
    invariant(
      SHA.test(lane.base ?? ""),
      `lane base must be a full commit: ${lane.id}`,
    );
    invariant(
      lane.status === "running"
        ? lane.head === null
        : SHA.test(lane.head ?? ""),
      `lane head does not match its status: ${lane.id}`,
    );
    invariant(
      Array.isArray(lane.issue_numbers) &&
        lane.issue_numbers.every(
          (issue) => Number.isInteger(issue) && issue > 0,
        ),
      `lane issues are invalid: ${lane.id}`,
    );
    invariant(
      lane.may_run_cargo === false && lane.may_mutate_runtime === false,
      `source lane cannot acquire a broker authority: ${lane.id}`,
    );
  }

  const active = ledger.lanes.filter((lane) => lane.status === "running");
  invariant(
    active.length <= available_threads - coordinator_threads,
    "active lanes exceed available writer slots",
  );
  for (const [label, values] of [
    ["issue", active.flatMap((lane) => lane.issue_numbers)],
    ["agent", active.map((lane) => lane.agent)],
    ["branch", active.map((lane) => lane.branch)],
    ["worktree", active.map((lane) => lane.worktree)],
  ]) {
    invariant(duplicate(values) === null, `duplicate active lane ${label}`);
  }

  return ledger;
};
