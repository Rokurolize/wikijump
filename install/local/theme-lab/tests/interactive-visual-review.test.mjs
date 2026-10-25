import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {applyVisualReviews, selectReviewRunContract} from '../ports/scripts/record-interactive-visual-review.mjs';
import {DEFAULT_SIGMA9_RUN_CONTRACT, DEFAULT_SIGMA10_RUN_CONTRACT} from '../src/current-run-contract-option.mjs';

// A Theme Lab-shaped tree with one task-owned Sigma-10 contract and no shared Sigma-10 contract.
function taskContractTree(schema = 'scp_jp_sigma10_migration_run.v1') {
  const themeLabRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'review-run-contract-'));
  const campaign = path.join(themeLabRoot, 'sigma10-migration/current-campaign');
  fs.mkdirSync(campaign, {recursive: true});
  fs.writeFileSync(path.join(campaign, 'run-contract-basalt-test.json'), JSON.stringify({schema}));
  return {themeLabRoot, audit: path.join(campaign, 'runs/basalt-test/interactive-visual-audit.json')};
}

const hash = 'a'.repeat(64);
const identity = new Map([['site', {candidate_sha256:'css-current', candidate_source_sha256:'source-current'}]]);
const row = () => ({theme:'site', candidate_sha256:'css-current', candidate_source_sha256:'source-current', screenshot_sha256:hash, classification:'UNCONFIRMED', visual_findings:[], intentional_differences:[], asset_failures:[], page_errors:[], external_requests_sent:0, unconfirmed_items:['screenshot captured but awaiting image review'], reviewed_after_last_change:false});

test('records exact-image review for duplicate rows only when both candidate identities are current', () => {
  const rows = [row(), row()];
  const result = applyVisualReviews(rows, [{screenshot_sha256:hash, classification:'PASS_NATURAL', note:'Text, logo and mobile masthead remain separate and legible.'}], identity, '2026-09-25T00:00:00Z');
  assert.deepEqual(result, {updated_rows:2, unique_images:1});
  assert.equal(rows[0].reviewed_after_last_change, true);
  assert.equal(rows[0].decision_authority, 'SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY');
  assert.equal(rows[0].port_conclusion_eligible, false);
  assert.equal(rows[0].visual_review.method, 'direct-image-vision-review');
  assert.equal(rows[0].visual_review.candidate_sha256, 'css-current');
  assert.equal(rows[0].visual_review.candidate_source_sha256, 'source-current');
  assert.equal(rows[0].visual_review.decision_authority, 'SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY');
  assert.equal(rows[0].visual_review.port_conclusion_eligible, false);
  assert.deepEqual(rows[1].unconfirmed_items, []);
});

test('rejects stale screenshot evidence without partially promoting rows', () => {
  const rows = [row(), {...row(), candidate_source_sha256:'old-source'}];
  assert.throws(() => applyVisualReviews(rows, [{screenshot_sha256:hash, classification:'PASS_NATURAL', note:'Text and controls look readable in this screenshot.'}], identity), /stale candidate evidence/u);
  assert.equal(rows[0].classification, 'UNCONFIRMED');
});

test('requires a specific reason for intentional divergence and never accepts unconfirmed as review', () => {
  assert.throws(() => applyVisualReviews([row()], [{screenshot_sha256:hash, classification:'PASS_INTENTIONAL_DIVERGENCE', note:'Visual result reviewed directly.'}], identity), /needs its reason/u);
  assert.throws(() => applyVisualReviews([row()], [{screenshot_sha256:hash, classification:'UNCONFIRMED', note:'Still need to inspect the screenshot.'}], identity), /invalid visual classification/u);
});


test('visual review cannot erase capture failures or publish a finding-free NEEDS_FIX', () => {
  const review={screenshot_sha256:hash,classification:'PASS_NATURAL',note:'Directly inspected this screenshot.'};
  for(const patch of [{failure:'timeout'},{asset_failures:['missing']},{page_errors:['error']},
    {external_requests_sent:1},{page_errors:undefined},{unconfirmed_items:['action/capture failed: timeout']},
    {action_responses:[{type:'failure',status:200}]}]) {
    const rows=[row(),{...row(),...patch}];
    assert.throws(()=>applyVisualReviews(rows,[review],identity),/capture evidence/);
    assert.equal(rows[0].classification,'UNCONFIRMED');
  }
  assert.throws(()=>applyVisualReviews([row()],[{...review,classification:'NEEDS_FIX'}],identity),/concrete finding/);
});

test('an explicit task-owned Sigma-10 run contract is selected for an audit beneath its directory', () => {
  const {themeLabRoot, audit} = taskContractTree();
  try {
    const selection = selectReviewRunContract({themeLabRoot, auditPath: audit, runContractOption: 'sigma10-migration/current-campaign/run-contract-basalt-test.json'});
    assert.equal(selection.generation, 'sigma10');
    assert.equal(selection.relative, 'sigma10-migration/current-campaign/run-contract-basalt-test.json');
    assert.equal(selection.contractPath, path.join(themeLabRoot, selection.relative));
  } finally {
    fs.rmSync(themeLabRoot, {recursive: true, force: true});
  }
});

test('without --run-contract a Sigma-10 audit needs the shared contract and never falls back to the Sigma-9 label', () => {
  const {themeLabRoot, audit} = taskContractTree();
  try {
    assert.throws(() => selectReviewRunContract({themeLabRoot, auditPath: audit}), /shared run contract .* or an explicit task-owned --run-contract/u);
    // With the shared contract present, the unchanged default is selected.
    fs.writeFileSync(path.join(themeLabRoot, DEFAULT_SIGMA10_RUN_CONTRACT), JSON.stringify({schema: 'scp_jp_sigma10_migration_run.v1'}));
    assert.equal(selectReviewRunContract({themeLabRoot, auditPath: audit}).relative, DEFAULT_SIGMA10_RUN_CONTRACT);
  } finally {
    fs.rmSync(themeLabRoot, {recursive: true, force: true});
  }
});

test('an explicit run contract must match the audit generation and the audit must live beneath it', () => {
  const {themeLabRoot, audit} = taskContractTree();
  try {
    const task = 'sigma10-migration/current-campaign/run-contract-basalt-test.json';
    // The audit sits in ports/, not beneath the task contract directory.
    assert.throws(() => selectReviewRunContract({themeLabRoot, auditPath: path.join(themeLabRoot, 'ports/interactive-visual-audit.json'), runContractOption: task}), /sigma9|shared|task-owned|below its explicit run contract/u);
    // A Sigma-9 task path cannot be used for an audit of the Sigma-10 generation.
    assert.throws(() => selectReviewRunContract({themeLabRoot, auditPath: audit, runContractOption: 'ports/current-acceptance/run-contract-basalt-test.json'}), /task-owned|shared/u);
    // A wrong-schema task document is rejected rather than trusted by name.
    const other = taskContractTree('scp_jp_interactive_acceptance_run.v1');
    try {
      assert.throws(() => selectReviewRunContract({themeLabRoot: other.themeLabRoot, auditPath: other.audit, runContractOption: task}), /scp_jp_sigma10_migration_run\.v1/u);
    } finally {
      fs.rmSync(other.themeLabRoot, {recursive: true, force: true});
    }
    // The shared Sigma-9 default is unchanged when no option is given.
    assert.equal(selectReviewRunContract({themeLabRoot, auditPath: path.join(themeLabRoot, 'ports/interactive-visual-audit.json')}).relative, DEFAULT_SIGMA9_RUN_CONTRACT);
  } finally {
    fs.rmSync(themeLabRoot, {recursive: true, force: true});
  }
});
