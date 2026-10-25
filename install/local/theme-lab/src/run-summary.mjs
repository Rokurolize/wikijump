// Runner summary accounting for real-port-regression (#2753): pass,
// warn, inconclusive and fail are separate outcomes. `inconclusive`
// means a local finding has no source-side authority; it is not a
// broken port, so the summary reports it apart from `fail`, and the
// exit code only folds it in under --fail-on=inconclusive (the default,
// which preserves the historical gate).
export function parseFailOn(argv) {
  const index = argv.indexOf('--fail-on');
  if (index === -1) return 'inconclusive';
  const value = argv[index + 1];
  if (value !== 'inconclusive' && value !== 'fail') {
    throw new Error(`--fail-on must be "inconclusive" or "fail": ${value ?? '(missing)'}`);
  }
  return value;
}

export function summarizeRun(rows, {mode, failures, inconclusives}) {
  const verdicts = {pass: 0, warn: 0, inconclusive: 0, fail: 0};
  for (const row of rows) {
    if (row.verdict in verdicts) verdicts[row.verdict] += 1;
  }
  return {
    total: rows.length,
    mode,
    verified: rows.filter((row) => row.status === 'verified').length,
    pass: rows.filter((row) => row.status === 'pass').length,
    warn_no_actionable_issues: rows.filter((row) => row.status === 'warn-no-actionable-issues').length,
    inconclusive: inconclusives.length,
    failed: failures.length,
    verdicts,
  };
}

export function runExitCode({failures, inconclusives}, failOn) {
  if (failures.length > 0) return 1;
  if (failOn === 'inconclusive' && inconclusives.length > 0) return 1;
  return 0;
}
