import assert from 'node:assert/strict';
import test from 'node:test';
import {assertRuntimeSourceSha,isThemeLabFixtureNavigationUrl,observationRuntimeSourceMatchesContract,parseCurlRuntimeResponseHeaders,requireRuntimeSourceSha,runtimeSourceShaFromHeaders} from '../src/runtime-source-identity.mjs';
import {buildVisualGateAssertion,validateVisualGateRecord,visualGateGlobalRuntimeDrift,visualGateIdentityRiskSnapshot,visualGateIdentityRiskTriggers,VISUAL_GATE_POLICY_SHA256} from '../src/visual-gate.mjs';
import {createDeepwellRuntimeIdentity} from '../src/deepwell-runtime-identity.mjs';

const current='a'.repeat(64);
const backend=createDeepwellRuntimeIdentity({source_sha256:'b'.repeat(64),ftml_git_revision:'c'.repeat(40),container_id:'d'.repeat(64),image_id:`sha256:${'e'.repeat(64)}`,binary_sha256:'f'.repeat(64),config_sha256:'1'.repeat(64)});

test('runtime source response identity is required and compared exactly',()=>{
  assert.equal(requireRuntimeSourceSha(current),current);
  assert.equal(runtimeSourceShaFromHeaders({'X-Theme-Lab-Runtime-Source-Sha':current}),current);
  assert.equal(runtimeSourceShaFromHeaders(new Headers({'X-Theme-Lab-Runtime-Source-Sha':current})),current);
  assert.equal(assertRuntimeSourceSha(current,current,'fixture'),current);
  const contract={expected_runtime_source_sha256:current};
  assert.equal(observationRuntimeSourceMatchesContract({runtime_source_sha256:current},contract),true);
  assert.equal(observationRuntimeSourceMatchesContract({runtime_source_sha256:'b'.repeat(64)},contract),false);
  assert.equal(observationRuntimeSourceMatchesContract({},contract),false);
  assert.throws(()=>assertRuntimeSourceSha(current,'b'.repeat(64),'fixture'),/does not match run contract/u);
  assert.throws(()=>assertRuntimeSourceSha(current,null,'fixture'),/missing a valid/u);
  assert.throws(()=>requireRuntimeSourceSha('not-a-sha'),/expected_runtime_source_sha256/u);
  assert.equal(isThemeLabFixtureNavigationUrl('https://scpaiueouiuiuiui.wikijump.localhost:3395/run-owned%3Atheme-lab-visual-acceptance-imported-20260924','https://scpaiueouiuiuiui.wikijump.localhost:3395'),true);
  assert.equal(isThemeLabFixtureNavigationUrl('https://scpaiueouiuiuiui.wikijump.localhost:3395/search:site/q/Search%20this%20site','https://scpaiueouiuiuiui.wikijump.localhost:3395'),false);
  assert.equal(isThemeLabFixtureNavigationUrl('https://scpaiueouiuiuiui.wikijump.localhost:3395/-/login','https://scpaiueouiuiuiui.wikijump.localhost:3395'),false);
});

test('curl fixture probe parser uses the final successful response header block',()=>{
  const parsed=parseCurlRuntimeResponseHeaders(`HTTP/2 103\r\n\r\nHTTP/2 200\r\nX-Theme-Lab-Runtime-Source-Sha: ${current}\r\n\r\n`);
  assert.deepEqual(parsed,{status:200,runtimeSourceSha:current});
  const missing=parseCurlRuntimeResponseHeaders('HTTP/2 200\r\n\r\n');
  assert.equal(missing.runtimeSourceSha,null);
  assert.throws(()=>assertRuntimeSourceSha(current,missing.runtimeSourceSha,'fixture'),/missing a valid/u);
  assert.throws(()=>parseCurlRuntimeResponseHeaders('HTTP/2 503\r\n\r\n'),/HTTP 503/u);
});

test('C and M machine evidence binds the measured runtime source SHA',()=>{
  const common={theme:'sample',browser_engine:'chromium',browser_version:'151.0',viewport:'desktop',surface:'shell.search',state:'typed-focused',scoped_authority_contract_sha256:'5'.repeat(64),
    candidate_sha256:'b'.repeat(64),candidate_source_sha256:'c'.repeat(64),asset_dependency_sha256:'d'.repeat(64),runtime_source_sha256:current,
    fixture_contract_sha256:'3'.repeat(64),backend_runtime_identity:backend,backend_runtime_identity_sha256:backend.identity_sha256,runtime_surface_contract_sha256:'4'.repeat(64),scoped_run_contract_sha256:'5'.repeat(64),
    run_contract_sha256:'e'.repeat(64),environment_contract_sha256:'f'.repeat(64),capture_state_action_contract_sha256:'1'.repeat(64),
    visual_diagnostics_contract_sha256:'2'.repeat(64),action_sequence:[{type:'focusin'}],
    visual_diagnostics:{viewport:{width:1024,height:900,client_width:1024,client_height:900,document_width:1024,scroll_y:0},title_overlaps:[],horizontalOverflow:[],elements:{
      '#search-top-box-input':{visibility:'visible',display:'block',rect:{x:10,y:10,width:100,height:24}},
      '#search-top-box-form input[type="submit"]':{visibility:'visible',display:'block',rect:{x:115,y:10,width:30,height:24}}
    }}};
  const assertion=buildVisualGateAssertion(common);
  // Every C row treats missing runtime identity as an incomparable prior.
  const laptopCurrent={...common,viewport:'laptop'};
  const laptopDrift=visualGateIdentityRiskSnapshot({...laptopCurrent,runtime_source_sha256:undefined});
  assert.deepEqual(visualGateIdentityRiskTriggers(laptopDrift,laptopCurrent,{hasPriorCapture:true}),['runtime-source-identity-missing']);
  assert.deepEqual(visualGateGlobalRuntimeDrift(laptopDrift,laptopCurrent,{hasPriorCapture:true}),['runtime-source-identity-missing']);
  // A legacy prior's scoped run contract is comparable only when it equals the binding-free scoped hash.
  const legacy=visualGateIdentityRiskSnapshot({...common,scoped_authority_contract_sha256:undefined,scoped_run_contract_sha256:'5'.repeat(64)},{currentScopedAuthoritySha:'5'.repeat(64)});
  assert.equal(legacy.previous_scoped_authority_contract_sha256,'5'.repeat(64));
  assert.equal(visualGateIdentityRiskSnapshot({...common,scoped_authority_contract_sha256:undefined,scoped_run_contract_sha256:'6'.repeat(64)},{currentScopedAuthoritySha:'5'.repeat(64)}).previous_scoped_authority_contract_sha256,null);
  assert.ok(visualGateIdentityRiskTriggers(visualGateIdentityRiskSnapshot({...common,scoped_authority_contract_sha256:'6'.repeat(64)}),laptopCurrent,{hasPriorCapture:true}).includes('scoped-authority-contract-identity-changed'));
  const previous=visualGateIdentityRiskSnapshot({...common,runtime_source_sha256:undefined});
  const triggers=visualGateIdentityRiskTriggers(previous,common,{hasPriorCapture:true});
  assert.ok(triggers.includes('runtime-source-identity-missing'));
  const cRow={...common,screenshot:'capture.png',screenshot_sha256:'3'.repeat(64),visual_gate:{policy_sha256:VISUAL_GATE_POLICY_SHA256,class:'C',risk_triggers:triggers,risk_assessment:{scope:'same-theme-surface-state-engine-viewport',identity_comparison_schema:'theme_lab_visual_risk_identity.v3',previous_capture_found:true,...previous,global_runtime_drift:visualGateGlobalRuntimeDrift(previous,common,{hasPriorCapture:true})}},state_machine_assertion:assertion};
  assert.deepEqual(validateVisualGateRecord(cRow,{requireVisualReview:false}),[]);
  assert.ok(validateVisualGateRecord({...cRow,visual_gate:{...cRow.visual_gate,risk_triggers:triggers.filter(trigger=>trigger!=='runtime-source-identity-missing')}},{requireVisualReview:false}).some(reason=>reason.includes('runtime-source-identity-missing')));
  assert.ok(validateVisualGateRecord({...cRow,state_machine_assertion:{...assertion,runtime_source_sha256:'9'.repeat(64)}},{requireVisualReview:false}).some(reason=>reason.includes('stale candidate/runtime evidence')));
  const oldBackend=visualGateIdentityRiskSnapshot({...common,backend_runtime_identity_sha256:undefined,backend_runtime_identity:undefined});
  const backendTriggers=visualGateIdentityRiskTriggers(oldBackend,common,{hasPriorCapture:true});
  assert.ok(backendTriggers.includes('backend-runtime-identity-missing'));
  assert.ok(validateVisualGateRecord({...cRow,visual_gate:{...cRow.visual_gate,risk_assessment:{...cRow.visual_gate.risk_assessment,...oldBackend,global_runtime_drift:visualGateGlobalRuntimeDrift(oldBackend,common,{hasPriorCapture:true})},risk_triggers:backendTriggers.filter(trigger=>trigger!=='backend-runtime-identity-missing')}},{requireVisualReview:false}).some(reason=>reason.includes('backend-runtime-identity-missing')));
  assert.ok(validateVisualGateRecord({...cRow,backend_runtime_identity_sha256:'9'.repeat(64)},{requireVisualReview:false}).some(reason=>reason.includes('Deepwell backend identity')));

  const noPrior=visualGateIdentityRiskSnapshot(null);
  const noPriorTriggers=visualGateIdentityRiskTriggers(noPrior,common,{hasPriorCapture:false});
  const noPriorRow={...cRow,visual_gate:{...cRow.visual_gate,risk_triggers:noPriorTriggers,risk_assessment:{scope:'same-theme-surface-state-engine-viewport',identity_comparison_schema:'theme_lab_visual_risk_identity.v3',previous_capture_found:false,...noPrior}}};
  noPriorRow.visual_gate.risk_assessment.global_runtime_drift=visualGateGlobalRuntimeDrift(noPrior,noPriorRow,{hasPriorCapture:false});
  assert.deepEqual(validateVisualGateRecord(noPriorRow,{requireVisualReview:false}),[]);

  const mBase={...common,browser_engine:'chromium',viewport:'narrow-mobile',surface:'credit.close-back',state:'restored'};
  const mRow={...mBase,visual_gate:{policy_sha256:VISUAL_GATE_POLICY_SHA256,class:'M',risk_triggers:[]},functional_assertion:{schema:'theme_lab_functional_assertion.v1',policy_sha256:VISUAL_GATE_POLICY_SHA256,key:'credit.close-back.restored',action_contract_sha256:mBase.capture_state_action_contract_sha256,action_completed:true,action_sequence_count:1,candidate_sha256:mBase.candidate_sha256,candidate_source_sha256:mBase.candidate_source_sha256,asset_dependency_sha256:mBase.asset_dependency_sha256,runtime_source_sha256:mBase.runtime_source_sha256,backend_runtime_identity_sha256:mBase.backend_runtime_identity_sha256,run_contract_sha256:mBase.run_contract_sha256,browser_engine:mBase.browser_engine,browser_version:mBase.browser_version,viewport:mBase.viewport}};
  assert.deepEqual(validateVisualGateRecord(mRow),[]);
  assert.ok(validateVisualGateRecord({...mRow,runtime_source_sha256:'9'.repeat(64)}).some(reason=>reason.includes('maintained functional action assertion')));
});
