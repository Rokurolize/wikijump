const SUMMARY_PATTERN =
  /Summary \[[^\]]+\]\s+(\d+) tests? run:\s+(\d+) passed(?:,\s+(\d+) skipped)?/gu;
const ANSI_ESCAPE_PATTERN = new RegExp(
  `${String.fromCharCode(0x1b)}\\[[0-9;?]*[ -/]*[@-~]`,
  "gu",
);
const OUTCOME_LINE_PATTERN =
  /^\s*(PASS|SLOW(?:\s+\+\s+LEAK)?|TIMEOUT-PASS|TIMEOUT|FAIL(?:\s+\+\s+LEAK)?|LEAK-FAIL|ABORT|EXEC-FAIL)\s+\[[^\]]+\]\s+(?:\(\s*\d+\/\d+\)\s+)?(\S+)\s+(\S+)\s*$/gmu;
const SAFE_NEXTEST_IDENTIFIER_PATTERN = /^[^\s()'"|&]+$/u;

export function stripAnsi(text) {
  return String(text ?? "").replace(ANSI_ESCAPE_PATTERN, "");
}

export function parseNextestSummary(text) {
  const summaries = [...stripAnsi(text).matchAll(SUMMARY_PATTERN)];
  const finalSummary = summaries.at(-1);
  if (!finalSummary) return null;

  return {
    tests: Number(finalSummary[1]),
    passed: Number(finalSummary[2]),
    skipped: finalSummary[3] === undefined ? 0 : Number(finalSummary[3]),
  };
}

export function evaluateNextestShard({code, signal, text}) {
  const summary = parseNextestSummary(text);
  const childSucceeded = code === 0 && !signal;

  return {
    ok: childSucceeded && summary !== null,
    summary,
    missingSuccessfulSummary: childSucceeded && summary === null,
  };
}

export function parseNextestTestOutcomes(text) {
  const cleanText = stripAnsi(text);
  const timedOut = [];
  const nonTimeoutFailed = [];
  const passed = [];
  const seenTimedOut = new Set();
  const seenFailed = new Set();
  const seenPassed = new Set();

  for (const match of cleanText.matchAll(OUTCOME_LINE_PATTERN)) {
    const [, status, binaryId, testName] = match;
    const key = `${binaryId}\0${testName}`;
    if (status === "TIMEOUT") {
      if (!seenTimedOut.has(key)) {
        seenTimedOut.add(key);
        timedOut.push({binaryId, testName});
      }
    } else if (status === "PASS" || status.startsWith("SLOW") || status === "TIMEOUT-PASS") {
      if (!seenPassed.has(key)) {
        seenPassed.add(key);
        passed.push({binaryId, testName});
      }
    } else if (!seenFailed.has(key)) {
      seenFailed.add(key);
      nonTimeoutFailed.push({binaryId, testName, status});
    }
  }

  return {timedOut, nonTimeoutFailed, passed};
}

export function planTimeoutOnlyRetry(runs) {
  const retryTargets = [];
  const nonTimeoutFailures = [];
  const seenTargets = new Set();
  const failedRuns = runs.filter((run) => run.code !== 0 || Boolean(run.signal));

  if (failedRuns.length === 0) {
    return {
      shouldRetry: false,
      reason: "all-passed",
      retryTargets,
      nonTimeoutFailures,
    };
  }

  let hasSignal = false;
  let hasMissingTimeouts = false;
  for (const run of failedRuns) {
    if (run.signal) {
      hasSignal = true;
      continue;
    }
    const {timedOut, nonTimeoutFailed} = parseNextestTestOutcomes(run.text);
    for (const failure of nonTimeoutFailed) {
      nonTimeoutFailures.push({...failure, shard: run.shard ?? null});
    }
    if (timedOut.length === 0) {
      hasMissingTimeouts = true;
    }
    for (const target of timedOut) {
      const key = `${target.binaryId}\0${target.testName}`;
      if (!seenTargets.has(key)) {
        seenTargets.add(key);
        retryTargets.push(target);
      }
    }
  }

  if (nonTimeoutFailures.length > 0) {
    return {
      shouldRetry: false,
      reason: "non-timeout-failure",
      retryTargets,
      nonTimeoutFailures,
    };
  }
  if (hasSignal) {
    return {
      shouldRetry: false,
      reason: "signal",
      retryTargets,
      nonTimeoutFailures,
    };
  }
  if (hasMissingTimeouts || retryTargets.length === 0) {
    return {
      shouldRetry: false,
      reason: "no-timeouts-found",
      retryTargets,
      nonTimeoutFailures,
    };
  }

  return {
    shouldRetry: true,
    reason: "timeout-only",
    retryTargets,
    nonTimeoutFailures,
  };
}

export function buildNextestExactFilterset(targets) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("buildNextestExactFilterset requires at least one target");
  }
  return targets
    .map(({binaryId, testName}) => {
      if (
        !SAFE_NEXTEST_IDENTIFIER_PATTERN.test(binaryId) ||
        !SAFE_NEXTEST_IDENTIFIER_PATTERN.test(testName)
      ) {
        throw new Error(`Unsafe nextest target identifier: ${binaryId} ${testName}`);
      }
      return `(binary_id(=${binaryId}) & test(=${testName}))`;
    })
    .join(" | ");
}
