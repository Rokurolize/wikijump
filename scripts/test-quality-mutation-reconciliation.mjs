// Reconcile multiple cargo-mutants shard runs and targeted replays by the
// frozen mutation identity, not by summing attempt-level result counters.
// Only mutation outcomes are accepted; the cargo-mutants baseline is ignored.

const STATES = new Set(["CaughtMutant", "MissedMutant", "Unviable", "UnviableMutant", "Timeout"]);

function extract(run, label) {
  if (!Array.isArray(run?.outcomes)) throw new Error(`${label} has no outcomes array`);
  const rows = [];
  for (const outcome of run.outcomes) {
    if (outcome.scenario === "Baseline") continue;
    const name = outcome.scenario?.Mutant?.name;
    if (typeof name !== "string" || !name || !STATES.has(outcome.summary)) {
      throw new Error(`${label} has an invalid mutation identity or outcome`);
    }
    rows.push({name, summary: outcome.summary === "UnviableMutant" ? "Unviable" : outcome.summary});
  }
  return rows;
}

function summarize(values) {
  const result = {caught: 0, missed: 0, unviable: 0, timeout: 0};
  for (const summary of values) {
    if (summary === "CaughtMutant") result.caught += 1;
    else if (summary === "MissedMutant") result.missed += 1;
    else if (summary === "Unviable") result.unviable += 1;
    else if (summary === "Timeout") result.timeout += 1;
    else throw new Error(`unknown normalized mutation summary: ${summary}`);
  }
  return result;
}

export function reconcileMutationRuns({baselineRuns, replays = []}) {
  if (!Array.isArray(baselineRuns) || baselineRuns.length === 0) {
    throw new Error("at least one frozen initial mutation shard is required");
  }
  const mutations = new Map();
  for (const [index, run] of baselineRuns.entries()) {
    for (const row of extract(run, `initial shard ${index}`)) {
      if (mutations.has(row.name)) throw new Error(`duplicate frozen mutation across initial shards: ${row.name}`);
      mutations.set(row.name, row.summary);
    }
  }
  if (mutations.size === 0) throw new Error("initial shards contain no mutation outcomes");
  const baseline = summarize(mutations.values());
  const transitions = [];
  for (const [index, run] of replays.entries()) {
    const seen = new Set();
    for (const row of extract(run, `targeted replay ${index}`)) {
      if (seen.has(row.name)) throw new Error(`duplicate mutation within targeted replay: ${row.name}`);
      seen.add(row.name);
      if (!mutations.has(row.name)) throw new Error(`targeted replay introduces an unreviewed mutation: ${row.name}`);
      const previous = mutations.get(row.name);
      if (previous === "CaughtMutant" && row.summary !== previous) {
        throw new Error(`targeted replay regresses a caught mutation: ${row.name}`);
      }
      if (previous !== row.summary) transitions.push({mutation: row.name, before: previous, after: row.summary, replay_index: index});
      mutations.set(row.name, row.summary);
    }
  }
  const final = summarize(mutations.values());
  return {
    schema: 1,
    frozen_mutants: mutations.size,
    baseline,
    reconciled: final,
    replay_attempts: replays.length,
    transitions,
    unresolved_survivors: [...mutations].filter(([, summary]) => summary === "MissedMutant").map(([mutation]) => mutation),
  };
}
