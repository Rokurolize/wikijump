import test from 'node:test';
import assert from 'node:assert/strict';

import {validateCanonicalMatrixWaivers} from '../src/canonical-matrix-waiver-validity.mjs';
import {matchCanonicalContainmentWaivers} from '../src/canonical-ledger-waiver.mjs';

// Synthetic ledger + matrix exercising the ruling-(a) predicate directly
// (no filesystem root needed): a non-pass row is acceptable iff its waiver
// re-matches an in-tree entry exactly.
const packageName='synth-theme';
const themeCssSha256='c'.repeat(64), themeSourceSha256='s'.repeat(64), scenarioSha256='e'.repeat(64);
const key=JSON.stringify([packageName,'chromium','narrow-mobile','page.normal','settled']);
const entry={id:'OD-T1-synthetic',instrument:'semantic_document_containment',decision:'OD-T1',package:packageName,
  match:{observation_key:key,candidate_overflow_px:11,baseline_overflow_px:0},
  candidate_source_sha256:themeSourceSha256,candidate_sha256:themeCssSha256};
const ledgerDocument={entries:[entry]};
const failObservation={page_content:true,viewport_width:320,candidate_document_overflow_px:11,baseline_document_overflow_px:0};
const passChecks={verification_scope:'pass',target_acceptance:'pass',image_diagnostics:'pass',japanese_glyph_rendering:'pass'};

// Mint honest waivers with the same matcher the runner uses.
function mintWaivers(failures){
  return matchCanonicalContainmentWaivers(ledgerDocument,{packageName,themeCssSha256,themeSourceSha256,scenarioSha256,failures});
}
const settledFailure={engine:'chromium',sessionProfile:'anonymous',kind:'state',id:'settled',
  viewportWidth:320,candidateOverflowPx:11,baselineOverflowPx:0};
function matrixWith({states,failTargetAcceptance=false,waivers,probes=null,checks=null}){
  const interaction_states=[
    {id:'settled',status:states.settled??'pass',...(states.settled==='fail'?{observation:{...failObservation}}:{})},
    {id:'responsive-shell',status:states.responsive??'pass'}];
  return {schema:'theme_lab_scenario_matrix.v1',scenario_sha256:scenarioSha256,
    ledger_waivers:waivers,
    engines:{chromium:{anonymous:{canonical_execution:{
      check_evidence:{...passChecks,...(checks??{}),...(failTargetAcceptance?{target_acceptance:'fail'}:{})},
      interaction_states,semantic_probes:probes??[{id:'headings',status:'pass'}]}}}}};
}
const ctx={packageName,themeCssSha256,themeSourceSha256,scenarioSha256,ledgerDocument};

test('waived row with a matching entry is valid',()=>{
  const matrix=matrixWith({states:{settled:'fail'},failTargetAcceptance:true,waivers:mintWaivers([settledFailure])});
  assert.deepEqual(validateCanonicalMatrixWaivers({matrix,...ctx}),[]);
});

test('waived row whose entry is absent is invalid',()=>{
  const matrix=matrixWith({states:{settled:'fail'},waivers:mintWaivers([settledFailure])});
  assert.match(validateCanonicalMatrixWaivers({matrix,...ctx,ledgerDocument:{entries:[]}}).join('; '),/absent from the in-tree ledger/u);
});

test('waived row whose px differs is invalid',()=>{
  const matrix=matrixWith({states:{settled:'fail'},waivers:mintWaivers([settledFailure])});
  // Row measures 12px against an 11px entry.
  matrix.engines.chromium.anonymous.canonical_execution.interaction_states[0].observation.candidate_document_overflow_px=12;
  assert.match(validateCanonicalMatrixWaivers({matrix,...ctx}).join('; '),/does not re-match/u);
});

test('waived row whose sha differs is invalid',()=>{
  const matrix=matrixWith({states:{settled:'fail'},waivers:mintWaivers([settledFailure])});
  assert.match(validateCanonicalMatrixWaivers({matrix,...ctx,themeCssSha256:'d'.repeat(64)}).join('; '),/does not re-match/u);
});

test('unwaived non-pass row is invalid',()=>{
  const matrix=matrixWith({states:{settled:'fail'},waivers:[]});
  assert.match(validateCanonicalMatrixWaivers({matrix,...ctx}).join('; '),/no ledger waiver/u);
});

test('target_acceptance with one unwaived state is invalid',()=>{
  const matrix=matrixWith({states:{settled:'fail'},failTargetAcceptance:true,waivers:[]});
  const failures=validateCanonicalMatrixWaivers({matrix,...ctx});
  assert.ok(failures.some(f=>/unwaived state/u.test(f)));
});

test('tampered waiver hash is invalid',()=>{
  const [waiver]=mintWaivers([settledFailure]);
  const matrix=matrixWith({states:{settled:'fail'},waivers:[{...waiver,finding_sha256:'0'.repeat(64)}]});
  assert.match(validateCanonicalMatrixWaivers({matrix,...ctx}).join('; '),/does not re-match/u);
});

test('all-pass matrix is valid with no waivers',()=>{
  const matrix=matrixWith({states:{}});
  assert.deepEqual(validateCanonicalMatrixWaivers({matrix,...ctx}),[]);
});
