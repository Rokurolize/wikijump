import test from 'node:test';
import assert from 'node:assert/strict';
import {measuredFacts, titleCompositionFact, planBrowserAcceptance, validateSemanticBrowserAcceptance, TITLE_TEXT_CONTRACT_SHA256, observationKey} from '../src/semantic-browser-acceptance.mjs';
const sha = 'a'.repeat(64);
const row = overrides => ({theme: 'example', browser_engine: 'chromium', browser_version: '1',
  viewport: 'desktop', viewport_size: {width: 1440, height: 1000}, surface: 'page.normal', state: 'settled',
  screenshot: 'example.png', screenshot_sha256: sha, candidate_sha256: sha, candidate_source_sha256: sha,
  baseline_theme_css_sha256: sha, capture_state_action_contract_sha256: sha,
  asset_dependency_sha256: sha, fixture_contract_sha256: sha, runtime_surface_contract_sha256: sha,
  external_requests_sent: 0, asset_failures: [], page_errors: [], action_responses: [],
  unconfirmed_items: ['screenshot captured but awaiting image review'],
  visual_diagnostics: {viewport: {width: 1440, documentWidth: 1440}, title_overlaps: []}, ...overrides});
const withTextIntersections = record => ({...record, title_text_contract_sha256: TITLE_TEXT_CONTRACT_SHA256,
  title_text_measurement: {schema: 'theme_lab_title_text_intersections.v1', complete: true,
    title_text_rects: [{x: 0, y: 0, width: 100, height: 30}], intersections: record.visual_diagnostics.title_overlaps}});

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

test('source-hidden search execution needs a real matching route and bound source proof', () => {
  const action = {schema: 'theme_lab_search_action.v1', control: '#search-top-box-input', mode: 'source-hidden-submit',
    query: {display: 'none', value: 'サイト内検索'}, expected_path: '/search:site/q/' + encodeURIComponent('サイト内検索'),
    observed_path: '/search:site/q/' + encodeURIComponent('サイト内検索'), source_authority: {path: 'source.json', sha256: sha}};
  const input = value => row({surface: 'shell.search', state: 'typed-focused', action_contract_observation: value});
  assert.equal(measuredFacts(input(action)).maintained_action_execution, 'pass');
  assert.equal(measuredFacts(input({...action, source_authority: null})).maintained_action_execution, 'source-required');
  assert.equal(measuredFacts(input({...action, observed_path: '/search:site/q/wrong'})).maintained_action_execution, 'source-required');
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
  const visible = row({visual_diagnostics: {title_overlaps: [{effectively_visible: true, text: 'menu'}]}});
  assert.equal(titleCompositionFact(visible), 'missing');
  const plan = planBrowserAcceptance({records: [withTextIntersections(visible)]});
  assert.equal(plan.accounting.distinct_visual_questions, 2);
  assert.match(plan.visual_questions[1].question, /layering over the page title/u);
});

test('a transient navigation overlay is machine-settled over a clean exact-context reading state', () => {
  const overlap = {effectively_visible:true,tag:'A',id:'',class:'menu-control',text:'ガイドハブ',color:'black',background:'white',position:'absolute',z:'20',ancestors:[{tag:'LI'},{tag:'UL',position:'absolute',rect:{x:0,y:50,width:100,height:60}},{tag:'LI'}]};
  const action = withTextIntersections(row({surface:'nav.mobile-top',state:'submenu-expanded',viewport:'mobile',viewport_size:{width:390,height:844},
    runtime_surface_contract_sha256:'b'.repeat(64),transport_origin:'https://candidate-action.invalid',
    visual_diagnostics:{viewport:{width:390,documentWidth:390},title_overlaps:[{...overlap,rect:{x:0,y:50,width:100,height:60}}]}}));
  const normal = row({viewport:'mobile',viewport_size:{width:390,height:844},transport_origin:'https://candidate-reading.invalid',
    visual_diagnostics:{viewport:{width:390,documentWidth:390},title_overlaps:[]}});
  const plan = planBrowserAcceptance({records:[normal,action]});
  assert.equal(plan.visual_questions.filter(q=>q.kind==='ambiguous_composition').length,0);
  const observation = plan.observations.find(item => item.key === observationKey(action));
  assert.equal(observation.facts.title_composition,'pass');
  assert.match(observation.machine_explanations[0],/transient navigation overlay/u);
});

test('transient overlay settlement fails closed on context drift, unsafe actions, or a dirty reading state', () => {
  const overlap = {effectively_visible:true,tag:'A',id:'',class:'menu-control',text:'ガイドハブ',color:'black',background:'white',position:'absolute',z:'20',ancestors:[{tag:'LI'},{tag:'UL',position:'absolute',rect:{x:0,y:50,width:100,height:60}},{tag:'LI'}]};
  const action = withTextIntersections(row({surface:'nav.mobile-top',state:'submenu-expanded',viewport:'mobile',viewport_size:{width:390,height:844},
    visual_diagnostics:{viewport:{width:390,documentWidth:390},title_overlaps:[{...overlap,rect:{x:0,y:50,width:100,height:60}}]}}));
  const normal = row({viewport:'mobile',viewport_size:{width:390,height:844},visual_diagnostics:{viewport:{width:390,documentWidth:390},title_overlaps:[]}});
  const count = records => planBrowserAcceptance({records}).visual_questions.filter(q=>q.kind==='ambiguous_composition').length;
  assert.equal(count([{...normal,candidate_sha256:'b'.repeat(64)},action]),1);
  assert.equal(count([normal,{...action,failure:'action failed'}]),1);
  const overlappingNormal = withTextIntersections({...normal,
    visual_diagnostics:{viewport:{width:390,documentWidth:390},title_overlaps:[{...overlap,rect:{x:0,y:50,width:100,height:60}}]}});
  assert.equal(count([overlappingNormal,action]),1);
});

test('non-navigation title intersections remain visual questions even with a clean reading state', () => {
  const overlap = {effectively_visible:true,tag:'A',id:'',class:'control',text:'Control',color:'black',background:'white',position:'absolute',z:'20'};
  const normal = row({viewport:'mobile',viewport_size:{width:390,height:844},visual_diagnostics:{viewport:{width:390,documentWidth:390},title_overlaps:[]}});
  const search = withTextIntersections(row({surface:'shell.search',state:'typed-focused',viewport:'mobile',viewport_size:{width:390,height:844},
    visual_diagnostics:{viewport:{width:390,documentWidth:390},title_overlaps:[{...overlap,rect:{x:0,y:50,width:100,height:60}}]}}));
  assert.equal(planBrowserAcceptance({records:[normal,search]}).visual_questions.filter(q=>q.kind==='ambiguous_composition').length,1);
});

test('one composition obligation binds responsive/action observations without declaring images equivalent', () => {
  const overlap = {effectively_visible:true,tag:'A',id:'',class:'menu-control',text:'Menu',color:'black',background:'white',position:'absolute',z:'20'};
  const first = withTextIntersections(row({visual_diagnostics:{viewport:{width:1440,documentWidth:1440},title_overlaps:[{...overlap,rect:{x:20,y:100,width:200,height:30}}]}}));
  const second = withTextIntersections(row({viewport:'mobile',state:'different-action',screenshot_sha256:'b'.repeat(64),capture_state_action_contract_sha256:'c'.repeat(64),
    visual_diagnostics:{viewport:{width:390,documentWidth:390},title_overlaps:[{...overlap,rect:{x:0,y:50,width:100,height:60}}]}}));
  const before = planBrowserAcceptance({records:[first]}).visual_questions.find(q=>q.kind==='ambiguous_composition');
  const after = planBrowserAcceptance({records:[first,second]}).visual_questions.filter(q=>q.kind==='ambiguous_composition');
  assert.equal(after.length,1);assert.equal(after[0].id,before.id);
  assert.equal(after[0].observations.length,2);assert.notEqual(after[0].evidence_sha256,before.evidence_sha256);
  assert.match(after[0].question,/A.menu-control/u);
});

test('question identities and evidence depend on relevant observations, not unrelated audit changes', () => {
  const original = planBrowserAcceptance({records: [row()]});
  const changed = planBrowserAcceptance({records: [row(), row({theme: 'unrelated', screenshot_sha256: 'b'.repeat(64)})], updated_at: 'later'});
  assert.deepEqual(changed.visual_questions[0], original.visual_questions[0]);
  const scoped = planBrowserAcceptance({records: [row({candidate_sha256: 'b'.repeat(64)})]});
  assert.notEqual(scoped.visual_questions[0].id, original.visual_questions[0].id);
  const changedAction = planBrowserAcceptance({records: [row({capture_state_action_contract_sha256: 'b'.repeat(64)})]});
  assert.equal(changedAction.visual_questions[0].evidence_sha256, original.visual_questions[0].evidence_sha256);
  const additionalMeasurement = planBrowserAcceptance({records: [row({title_text_contract_sha256: 'c'.repeat(64),
    title_composition_contract_sha256: 'd'.repeat(64)})]});
  assert.equal(additionalMeasurement.visual_questions[0].evidence_sha256, original.visual_questions[0].evidence_sha256);
});

test('a concrete visual question review binds every declared evidence item and cannot clear missing facts', () => {
  const audit = {records: [row()]}, q = planBrowserAcceptance(audit).visual_questions[0];
  audit.semantic_reviews = {[q.id]: {question: q.question, evidence_sha256: q.evidence_sha256,
    method: 'direct-visual-question-review', status: 'pass', note: 'Source typography, palette and artwork compared across the listed evidence.',
    reviewer: 'test', reviewed_at: '2026-10-01T00:00:00Z', decision_authority: 'SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY', port_conclusion_eligible: false,
    source_url: 'https://scp-wiki.wikidot.com/theme:example', source_snapshot: {path: 'source.txt', sha256: sha}, source_html: {path: 'source.html', sha256: sha}, source_rendering: {path: 'source.png', sha256: sha}, source_rendering_receipt: {path: 'source-capture.json', sha256: sha}}};
  assert.equal(validateSemanticBrowserAcceptance(audit).status, 'pass');
  audit.records.push(row({viewport: 'mobile'}));
  assert.match(validateSemanticBrowserAcceptance(audit).failures.at(-1), /unanswered or stale/u);
  assert.notEqual(validateSemanticBrowserAcceptance({records: []}).status, 'pass');
});
