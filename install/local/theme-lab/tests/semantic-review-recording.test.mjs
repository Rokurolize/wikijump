import test from 'node:test';
import assert from 'node:assert/strict';
import {measuredFacts, titleCompositionFact, planBrowserAcceptance, validateSemanticBrowserAcceptance, TITLE_COMPOSITION_CONTRACT_SHA256, TITLE_TEXT_CONTRACT_SHA256, observationKey} from '../src/semantic-browser-acceptance.mjs';
import {BASELINE_DOCUMENT_CONTAINMENT_CONTRACT_SHA256,BASELINE_DOCUMENT_CONTAINMENT_SCHEMA} from '../src/baseline-document-containment.mjs';
import {VISUAL_GATE_POLICY_SHA256,visualGatePolicyRow,visualGateSelectorsFor,buildVisualGateAssertion,visualGateGlobalRuntimeDrift} from '../src/visual-gate.mjs';
import {createDeepwellRuntimeIdentity} from '../src/deepwell-runtime-identity.mjs';
const sha = 'a'.repeat(64);
const backendRuntimeIdentity=createDeepwellRuntimeIdentity({source_sha256:'b'.repeat(64),ftml_git_revision:'c'.repeat(40),container_id:'d'.repeat(64),image_id:`sha256:${'e'.repeat(64)}`,binary_sha256:'f'.repeat(64),config_sha256:'1'.repeat(64)});
const row = (overrides={}) => {
  const record={theme:'example',browser_engine:'chromium',browser_version:'1',viewport:'desktop',viewport_size:{width:1440,height:1000},surface:'page.normal',state:'settled',
    candidate_sha256:sha,candidate_source_sha256:sha,baseline_theme_css_sha256:sha,capture_state_action_contract_sha256:sha,
    asset_dependency_sha256:sha,fixture_contract_sha256:sha,runtime_surface_contract_sha256:sha,runtime_source_sha256:sha,
    backend_runtime_identity:backendRuntimeIdentity,backend_runtime_identity_sha256:backendRuntimeIdentity.identity_sha256,
    run_contract_sha256:'2'.repeat(64),scoped_run_contract_sha256:'3'.repeat(64),environment_contract_sha256:'4'.repeat(64),
    external_requests_sent:0,asset_failures:[],page_errors:[],action_responses:[],unconfirmed_items:['screenshot captured but awaiting image review'],
    visual_diagnostics:{viewport:{width:1440,height:1000,client_width:1440,client_height:1000,document_width:1440,documentWidth:1440},title_overlaps:[]},...overrides};
  const policy=visualGatePolicyRow(record),size=record.viewport_size??{width:1440,height:1000};
  const suppliedViewport=record.visual_diagnostics?.viewport;
  const measuredViewport=Object.hasOwn(overrides??{},'visual_diagnostics')?{...suppliedViewport}:{width:size.width,height:size.height,...suppliedViewport};
  measuredViewport.height??=size.height;
  if(measuredViewport.width!==undefined)measuredViewport.client_width??=measuredViewport.width;
  if(measuredViewport.height!==undefined)measuredViewport.client_height??=measuredViewport.height;
  if(measuredViewport.document_width!==undefined)measuredViewport.documentWidth??=measuredViewport.document_width;
  if(measuredViewport.documentWidth!==undefined)measuredViewport.document_width??=measuredViewport.documentWidth;
  record.visual_diagnostics={...record.visual_diagnostics,viewport:measuredViewport,title_overlaps:record.visual_diagnostics?.title_overlaps??[],elements:{...record.visual_diagnostics?.elements}};
  record.visual_diagnostics_contract_sha256='5'.repeat(64);
  record.action_sequence=[...(record.action_sequence??[]),{type:'focusin'},{type:'pointerover'}];
  const riskTriggers=policy?.class==='C'?['no-comparable-prior-capture',...(record.visual_diagnostics.title_overlaps.some(item=>item.effectively_visible===true)?['visible-title-composition']:[])]:[];
  record.visual_gate={policy_sha256:VISUAL_GATE_POLICY_SHA256,class:policy?.class??null,risk_triggers:riskTriggers,
    ...(policy?.class==='C'?{risk_assessment:{scope:'same-theme-surface-state-engine-viewport',identity_comparison_schema:'theme_lab_visual_risk_identity.v3',previous_capture_found:false,global_runtime_drift:visualGateGlobalRuntimeDrift({},record,{hasPriorCapture:false})}}:{})};
  if(policy?.class==='C'){
    for(const selector of visualGateSelectorsFor(policy,record))record.visual_diagnostics.elements[selector]={visibility:'visible',display:'block',rect:{x:4,y:4,width:120,height:36}};
    const action=record.action_contract_observation;
    if(action?.control==='#search-top-box-input'&&action.display==='none')record.visual_diagnostics.elements['#search-top-box-input']={visibility:'hidden',display:'none',rect:{x:0,y:0,width:0,height:0}};
    if(policy.key==='credit.view.open'&&!record.baseline_theme)record.action_contract_observation={...action,location_hash:'#u-credit-view'};
    if(policy.key==='credit.otherwise.open'&&!record.baseline_theme)record.action_contract_observation={...action,location_hash:'#u-credit-otherwise'};
    record.state_machine_assertion=buildVisualGateAssertion(record);
    if(policy.key==='content.tabview.second-tab-selected')record.state_machine_assertion.selected=true;
  }
  if(policy?.class==='M'){
    delete record.screenshot;delete record.screenshot_sha256;delete record.visual_review;
    record.functional_assertion={schema:'theme_lab_functional_assertion.v1',policy_sha256:VISUAL_GATE_POLICY_SHA256,key:policy.key,
      action_contract_sha256:record.capture_state_action_contract_sha256,action_completed:true,action_sequence_count:record.action_sequence.length,
      candidate_sha256:record.candidate_sha256,candidate_source_sha256:record.candidate_source_sha256,asset_dependency_sha256:record.asset_dependency_sha256,
      runtime_source_sha256:record.runtime_source_sha256,backend_runtime_identity_sha256:record.backend_runtime_identity_sha256,run_contract_sha256:record.run_contract_sha256,
      browser_engine:record.browser_engine,browser_version:record.browser_version,viewport:record.viewport};
    delete record.visual_gate.risk_assessment;record.visual_gate.risk_triggers=[];
  }else{
    record.screenshot??='example.png';record.screenshot_sha256??=sha;record.classification??='PASS_NATURAL';
    record.visual_review={method:'direct-image-vision-review',screenshot_sha256:record.screenshot_sha256,candidate_sha256:record.candidate_sha256,
      candidate_source_sha256:record.candidate_source_sha256,reviewer:'test',note:'Exact screenshot checked against the current candidate and source.',reviewed_at:'2026-10-01T00:00:00Z'};
  }
  return record;
};

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {SEMANTIC_BROWSER_MODEL} from '../src/semantic-browser-acceptance.mjs';
import {SEMANTIC_DECISIONS_SCHEMA, applySemanticReviewRecording, recordSemanticReviews} from '../src/semantic-review-recording.mjs';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const RECORDER = path.resolve(TESTS_DIR, '../scripts/record-semantic-browser-reviews.mjs');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const SOURCE_URL = 'https://scp-wiki.wikidot.com/theme:example';
const NOTE = 'Compared the frozen source renderings with the candidate screenshots; differences are documented localization only.';

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-review-recording-'));
}

function viewportsOf(question) {
  return [...new Set(question.observations.map(observation => JSON.parse(observation.key)[2]))];
}

// Writes frozen-source artifacts under the root and returns their declared bindings.
function writeSources(root, viewports) {
  const write = (relative, text) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const bytes = Buffer.from(text);
    fs.writeFileSync(file, bytes);
    return {path: relative, sha256: digest(bytes)};
  };
  const snapshot = write('source/upstream.txt', 'frozen source text\n');
  const renderings = Object.fromEntries(viewports.map(viewport => [viewport, {
    source_html: write(`source/${viewport}.html`, `<html>${viewport}</html>`),
    source_rendering: write(`source/${viewport}.png`, `png ${viewport}`),
    source_rendering_receipt: write(`source/${viewport}-receipt.json`, JSON.stringify({viewport}))
  }]));
  return {snapshot, renderings};
}

function decisionFor(question, root, overrides = {}) {
  const source = writeSources(root, viewportsOf(question));
  return {
    schema: SEMANTIC_DECISIONS_SCHEMA,
    decisions: {
      [question.id]: {
        decision: 'warn',
        note: NOTE,
        evidence_sha256: question.evidence_sha256,
        reviewer: 'test reviewer',
        reviewed_at: '2026-10-22T00:00:00Z',
        source_url: SOURCE_URL,
        source_snapshot: source.snapshot,
        source_renderings: source.renderings,
        ...overrides
      }
    }
  };
}

// Builds an audit file, its decisions file, and the root that holds the sources.
function scenario({rows = [row()], extra = {}, decisionOverrides = {}, mutateDecisions} = {}) {
  const dir = scratch();
  const audit = {records: rows, ...extra};
  const auditPath = path.join(dir, 'interactive-visual-audit.json');
  fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2) + '\n');
  const question = planBrowserAcceptance(audit).visual_questions[0];
  const decisions = decisionFor(question, dir, decisionOverrides);
  if (mutateDecisions) mutateDecisions(decisions, question);
  const decisionsPath = path.join(dir, 'semantic-review-decisions.json');
  fs.writeFileSync(decisionsPath, JSON.stringify(decisions, null, 2) + '\n');
  return {dir, auditPath, decisionsPath, question, decisions};
}

function apply(s, options = {}) {
  return applySemanticReviewRecording({
    auditPath: s.auditPath,
    decisionsPath: s.decisionsPath,
    root: s.dir,
    now: new Date('2026-10-22T10:00:00Z'),
    ...options
  });
}

const backups = dir => fs.readdirSync(dir).filter(name => name.includes('.before-semantic-recording-'));
const readAudit = file => JSON.parse(fs.readFileSync(file, 'utf8'));

test('records the decision, backs up the original audit, stamps the model, and validates', () => {
  const s = scenario();
  const before = fs.readFileSync(s.auditPath);
  const result = apply(s);
  assert.equal(result.ok, true, result.failures?.join('\n'));
  assert.equal(result.written, true);
  assert.deepEqual(fs.readFileSync(result.backup), before, 'backup holds the exact original bytes');
  const after = readAudit(s.auditPath);
  assert.equal(after.acceptance_model, SEMANTIC_BROWSER_MODEL);
  assert.equal(validateSemanticBrowserAcceptance(after).status, 'pass');
  const review = after.semantic_reviews[s.question.id];
  assert.equal(review.status, 'warn');
  assert.equal(review.method, 'direct-visual-question-review');
  assert.equal(review.evidence_sha256, s.question.evidence_sha256);
  assert.equal(review.port_conclusion_eligible, false);
  assert.equal(review.decision_authority, 'SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY');
  assert.equal(review.question, s.question.question);
  assert.deepEqual(Object.keys(review.source_renderings), ['desktop']);
});

test('is idempotent: rerunning with the same decisions changes nothing and writes no second backup', () => {
  const s = scenario();
  assert.equal(apply(s).written, true);
  const bytes = fs.readFileSync(s.auditPath);
  const second = apply(s, {now: new Date('2026-10-22T11:00:00Z')});
  assert.equal(second.ok, true);
  assert.equal(second.written, false);
  assert.equal(second.changed, false);
  assert.equal(second.outcomes[0].action, 'unchanged');
  assert.deepEqual(fs.readFileSync(s.auditPath), bytes);
  assert.equal(backups(s.dir).length, 1);
});

test('refuses when a visual question has no decision and writes nothing', () => {
  const s = scenario({mutateDecisions: decisions => { decisions.decisions = {}; }});
  const before = fs.readFileSync(s.auditPath);
  const result = apply(s);
  assert.equal(result.ok, false);
  assert.equal(result.written, false);
  assert.match(result.failures.join('\n'), /no decision recorded/u);
  assert.deepEqual(fs.readFileSync(s.auditPath), before);
  assert.equal(backups(s.dir).length, 0);
});

test('refuses a decision that names an unknown visual question', () => {
  const s = scenario({mutateDecisions: (decisions, question) => {
    decisions.decisions['0'.repeat(64)] = decisions.decisions[question.id];
  }});
  const result = apply(s);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /unknown visual question/u);
  assert.equal(result.written, false);
});

test('refuses a decision bound to different evidence', () => {
  const s = scenario({decisionOverrides: {evidence_sha256: 'b'.repeat(64)}});
  const result = apply(s);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /does not match the current question evidence/u);
  assert.equal(readAudit(s.auditPath).acceptance_model, undefined);
});

test('refuses a fail decision: a failing question cannot be stamped as accepted', () => {
  const s = scenario({decisionOverrides: {decision: 'fail'}});
  const result = apply(s);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /decision fail cannot be recorded/u);
  assert.equal(result.written, false);
});

test('refuses source artifacts whose bytes differ from the declared sha256', () => {
  const s = scenario({mutateDecisions: decisions => {
    const entry = Object.values(decisions.decisions)[0];
    entry.source_snapshot = {...entry.source_snapshot, sha256: 'c'.repeat(64)};
  }});
  const result = apply(s);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /source_snapshot: file bytes do not match/u);
});

test('refuses a question whose responsive viewport lacks a source rendering', () => {
  const rows = [row(), row({viewport: 'mobile', viewport_size: {width: 390, height: 844}})];
  const s = scenario({rows, mutateDecisions: (decisions, question) => {
    const entry = decisions.decisions[question.id];
    delete entry.source_renderings.mobile;
  }});
  const result = apply(s);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /no source rendering supplied for viewport mobile/u);
});

test('refuses a screenshot that has no direct review at its exact sha256', () => {
  const rowWithStaleReview = row();
  rowWithStaleReview.visual_review = {...rowWithStaleReview.visual_review, screenshot_sha256: 'b'.repeat(64)};
  const s = scenario({rows: [rowWithStaleReview]});
  const result = apply(s);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /not directly reviewed at its exact sha256/u);
  assert.equal(readAudit(s.auditPath).acceptance_model, undefined);
});

test('refuses to stamp a failing audit and leaves it byte-identical', () => {
  const s = scenario({rows: [row({external_requests_sent: 1})]});
  const before = fs.readFileSync(s.auditPath);
  const result = apply(s);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /machine failure/u);
  assert.equal(result.written, false);
  assert.deepEqual(fs.readFileSync(s.auditPath), before);
  assert.equal(backups(s.dir).length, 0);
});

test('keeps an existing review that differs from the decision unless replace is explicit', () => {
  const s = scenario();
  const older = {...s.decisions.decisions[s.question.id], status: 'pass', note: 'An earlier review that reached a different decision.', reviewed_at: '2026-10-01T00:00:00Z', source_url: SOURCE_URL};
  const seeded = readAudit(s.auditPath);
  seeded.semantic_reviews = {[s.question.id]: {
    question: s.question.question, evidence_sha256: s.question.evidence_sha256, method: 'direct-visual-question-review',
    status: older.status, note: older.note, reviewer: older.reviewer, reviewed_at: older.reviewed_at, source_url: older.source_url,
    source_snapshot: older.source_snapshot, source_renderings: older.source_renderings,
    decision_authority: 'SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY', port_conclusion_eligible: false
  }};
  fs.writeFileSync(s.auditPath, JSON.stringify(seeded, null, 2) + '\n');
  const before = fs.readFileSync(s.auditPath);
  const refused = apply(s);
  assert.equal(refused.ok, false);
  assert.match(refused.failures.join('\n'), /pass --replace to overwrite/u);
  assert.deepEqual(fs.readFileSync(s.auditPath), before);
  const replaced = apply(s, {replace: true});
  assert.equal(replaced.ok, true, replaced.failures?.join('\n'));
  assert.equal(replaced.outcomes[0].action, 'replaced');
  assert.equal(readAudit(s.auditPath).semantic_reviews[s.question.id].status, 'warn');
  assert.equal(backups(s.dir).length, 1);
});

test('dry run validates and reports the result without writing anything', () => {
  const s = scenario();
  const before = fs.readFileSync(s.auditPath);
  const result = apply(s, {dryRun: true});
  assert.equal(result.ok, true);
  assert.equal(result.written, false);
  assert.equal(result.dry_run, true);
  assert.equal(result.acceptance_model, SEMANTIC_BROWSER_MODEL);
  assert.deepEqual(fs.readFileSync(s.auditPath), before);
  assert.equal(backups(s.dir).length, 0);
});

test('pure planner refuses a decisions file with the wrong schema', () => {
  const s = scenario();
  const result = recordSemanticReviews({audit: readAudit(s.auditPath), decisions: {schema: 'other'}, root: s.dir});
  assert.equal(result.ok, false);
  assert.equal(result.audit, null);
  assert.match(result.failures[0], /decisions schema must be/u);
});

test('command line: exit 64 on usage, 0 when recorded or unchanged, 1 on refusal with nothing written', () => {
  const s = scenario();
  const run = extra => spawnSync(process.execPath, [RECORDER, ...extra], {encoding: 'utf8'});
  assert.equal(run([]).status, 64);
  const recorded = run(['--audit', s.auditPath, '--decisions', s.decisionsPath, '--root', s.dir]);
  assert.equal(recorded.status, 0, recorded.stdout + recorded.stderr);
  assert.equal(JSON.parse(recorded.stdout).written, true);
  const unchanged = run(['--audit', s.auditPath, '--decisions', s.decisionsPath, '--root', s.dir]);
  assert.equal(unchanged.status, 0);
  assert.equal(JSON.parse(unchanged.stdout).written, false);
  const refusing = scenario({decisionOverrides: {decision: 'fail'}});
  const refused = run(['--audit', refusing.auditPath, '--decisions', refusing.decisionsPath, '--root', refusing.dir]);
  assert.equal(refused.status, 1);
  assert.equal(JSON.parse(refused.stdout).ok, false);
  assert.equal(readAudit(refusing.auditPath).acceptance_model, undefined);
});
