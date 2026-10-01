import test from 'node:test';
import assert from 'node:assert/strict';
import {measuredFacts, titleCompositionFact, planBrowserAcceptance, validateSemanticBrowserAcceptance} from '../src/semantic-browser-acceptance.mjs';
const sha = 'a'.repeat(64);
const row = overrides => ({theme: 'example', browser_engine: 'chromium', browser_version: '1',
  viewport: 'desktop', viewport_size: {width: 1440, height: 1000}, surface: 'page.normal', state: 'settled',
  screenshot: 'example.png', screenshot_sha256: sha, candidate_sha256: sha, candidate_source_sha256: sha,
  baseline_theme_css_sha256: sha, capture_state_action_contract_sha256: sha,
  asset_dependency_sha256: sha, fixture_contract_sha256: sha, runtime_surface_contract_sha256: sha,
  external_requests_sent: 0, asset_failures: [], page_errors: [], action_responses: [],
  unconfirmed_items: ['screenshot captured but awaiting image review'],
  visual_diagnostics: {viewport: {width: 1440, documentWidth: 1440}, title_overlaps: []}, ...overrides});

test('measured facts are independent of a pending screenshot judgment', () => {
  assert.deepEqual(measuredFacts(row()), {observation_identity: 'pass', capture_safety: 'pass', maintained_action_execution: 'pass', document_containment: 'pass'});
  const audit = {records: [row(), row({viewport: 'mobile'})]};
  const plan = planBrowserAcceptance(audit);
  assert.equal(plan.accounting.browser_records, 2);
  assert.equal(plan.accounting.distinct_visual_questions, 1);
  assert.equal(plan.visual_questions[0].observations.length, 2);
  assert.equal(audit.records[0].classification, undefined);
  assert.equal(audit.records[0].reviewed_after_last_change, undefined);
});

test('unknown safety and failed actions cannot be cleared by image review', () => {
  assert.equal(measuredFacts(row({action_responses: undefined})).capture_safety, 'missing');
  for (const override of [{external_requests_sent: 1}, {asset_failures: [{}]}, {page_errors: ['error']},
    {action_responses: [{status: 500}]}, {failure: 'failed'}, {unconfirmed_items: ['unknown actor']}]) {
    assert.equal(measuredFacts(row(override)).capture_safety, 'fail');
  }
  assert.equal(measuredFacts(row({surface: 'unrecognized.surface'})).maintained_action_execution, 'missing');
});

test('geometry detects an actual failure even when the action succeeded', () => {
  const r = row({visual_diagnostics: {viewport: {width: 390, documentWidth: 424}, title_overlaps: []}});
  assert.equal(measuredFacts(r).document_containment, 'fail');
  assert.equal(measuredFacts(r).maintained_action_execution, 'pass');
  assert.ok(validateSemanticBrowserAcceptance({records: [r]}).failures.some(f => f.includes('document_containment')));
  assert.equal(measuredFacts(row({visual_diagnostics: {viewport: {width: 390}}})).document_containment, 'missing');
});

test('a hidden query observation is a source-authority gap, not completed typing', () => {
  const hidden = row({surface: 'shell.search', state: 'typed-focused', action_contract_observation: {control: '#search-top-box-input', display: 'none'}});
  const plan = planBrowserAcceptance({records: [hidden]});
  assert.equal(plan.accounting.additional_source_authority_records, 1);
  assert.match(validateSemanticBrowserAcceptance({records: [hidden]}).failures[0], /requested action was not exercised/u);
});

test('hidden intersections are machine facts; unmeasured visibility requires a probe, not vision', () => {
  assert.equal(titleCompositionFact(row()), 'pass');
  assert.equal(titleCompositionFact(row({visual_diagnostics: {title_overlaps: [{effectively_visible: false}]}})), 'pass');
  const plan = planBrowserAcceptance({records: [row({visual_diagnostics: {title_overlaps: [{}]}})]});
  assert.deepEqual(plan.observations[0].additional_machine_evidence, ['document_containment', 'title_composition']);
  assert.equal(plan.accounting.distinct_visual_questions, 1);
  assert.equal(titleCompositionFact(row({visual_diagnostics: {title_overlaps: Array(16).fill({effectively_visible: false})}})), 'missing');
});

test('visible intersections produce a specific composition question', () => {
  const plan = planBrowserAcceptance({records: [row({visual_diagnostics: {title_overlaps: [{effectively_visible: true, text: 'menu'}]}})]});
  assert.equal(plan.accounting.distinct_visual_questions, 2);
  assert.match(plan.visual_questions[1].question, /intersection with the page title/u);
});

test('question identities and evidence depend on relevant observations, not unrelated audit changes', () => {
  const original = planBrowserAcceptance({records: [row()]});
  const changed = planBrowserAcceptance({records: [row(), row({theme: 'unrelated', screenshot_sha256: 'b'.repeat(64)})], updated_at: 'later'});
  assert.deepEqual(changed.visual_questions[0], original.visual_questions[0]);
  const scoped = planBrowserAcceptance({records: [row({candidate_sha256: 'b'.repeat(64)})]});
  assert.notEqual(scoped.visual_questions[0].id, original.visual_questions[0].id);
  const changedAction = planBrowserAcceptance({records: [row({capture_state_action_contract_sha256: 'b'.repeat(64)})]});
  assert.notEqual(changedAction.visual_questions[0].evidence_sha256, original.visual_questions[0].evidence_sha256);
});

test('a concrete visual question review binds every declared evidence item and cannot clear missing facts', () => {
  const audit = {records: [row()]}, q = planBrowserAcceptance(audit).visual_questions[0];
  audit.semantic_reviews = {[q.id]: {question: q.question, evidence_sha256: q.evidence_sha256,
    method: 'direct-visual-question-review', status: 'pass', note: 'Source typography, palette and artwork compared across the listed evidence.',
    reviewer: 'test', reviewed_at: '2026-10-01T00:00:00Z', decision_authority: 'SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY', port_conclusion_eligible: false,
    source_url: 'https://scp-wiki.wikidot.com/theme:example', source_snapshot: {path: 'source.txt', sha256: sha}, source_rendering: {path: 'source.png', sha256: sha}}};
  assert.equal(validateSemanticBrowserAcceptance(audit).status, 'pass');
  audit.records.push(row({viewport: 'mobile'}));
  assert.match(validateSemanticBrowserAcceptance(audit).failures.at(-1), /unanswered or stale/u);
  assert.notEqual(validateSemanticBrowserAcceptance({records: []}).status, 'pass');
});
