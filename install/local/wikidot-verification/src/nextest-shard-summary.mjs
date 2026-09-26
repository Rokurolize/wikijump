const SUMMARY_PATTERN =
  /Summary \[[^\]]+\]\s+(\d+) tests? run:\s+(\d+) passed(?:,\s+(\d+) skipped)?/gu;

export function parseNextestSummary(text) {
  const summaries = [...text.matchAll(SUMMARY_PATTERN)];
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
