import assert from 'node:assert/strict';
import test from 'node:test';

import {parseFailOn, runExitCode, summarizeRun} from '../src/run-summary.mjs';

test('parseFailOn defaults to inconclusive and validates the value', () => {
  assert.equal(parseFailOn([]), 'inconclusive');
  assert.equal(parseFailOn(['--fail-on', 'fail']), 'fail');
  assert.equal(parseFailOn(['--fail-on', 'inconclusive']), 'inconclusive');
  assert.throws(() => parseFailOn(['--fail-on', 'warn']), /--fail-on must be/);
  assert.throws(() => parseFailOn(['--fail-on']), /--fail-on must be/);
});

test('summary separates inconclusive from fail (retained snapshot distribution)', () => {
  // The retained full-regression snapshot behind #2753: 31 rows whose
  // verdict is inconclusive and 5 whose verdict is fail. The old summary
  // reported all 36 as "failed".
  const rows = [
    ...Array.from({length: 31}, () => ({verdict: 'inconclusive', status: 'inconclusive'})),
    ...Array.from({length: 5}, () => ({verdict: 'fail', status: 'fail'})),
  ];
  const summary = summarizeRun(rows, {mode: 'full-acceptance', failures: rows.slice(31), inconclusives: rows.slice(0, 31)});
  assert.equal(summary.total, 36);
  assert.equal(summary.failed, 5);
  assert.equal(summary.inconclusive, 31);
  assert.deepEqual(summary.verdicts, {pass: 0, warn: 0, inconclusive: 31, fail: 5});
});

test('exit code folds inconclusive in only under --fail-on=inconclusive', () => {
  const onlyInconclusive = {failures: [], inconclusives: [{slug: 'x'}]};
  assert.equal(runExitCode(onlyInconclusive, 'inconclusive'), 1);
  assert.equal(runExitCode(onlyInconclusive, 'fail'), 0);
  assert.equal(runExitCode({failures: [{slug: 'y'}], inconclusives: []}, 'fail'), 1);
  assert.equal(runExitCode({failures: [], inconclusives: []}, 'inconclusive'), 0);
});
