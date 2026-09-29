import assert from 'node:assert/strict';
import test from 'node:test';
import {validateSigmaPreviewFinding} from '../sigma10-migration/preview-authority.mjs';
test('local or body-only preview evidence cannot become a migration prerequisite',()=>{
  const hypothesis={id:'SIGMA10-MOB-001',classification:'UNVERIFIED_PREVIEW_HYPOTHESIS',blocker:false,actionable:false,port_conclusion_eligible:false,confirmation_required:'manual real preview',read_only_preview_attempt:'preview receipt',source_saved_page_evidence:'saved receipt'};
  assert.doesNotThrow(()=>validateSigmaPreviewFinding(hypothesis));
  for(const key of ['blocker','actionable','port_conclusion_eligible'])assert.throws(()=>validateSigmaPreviewFinding({...hypothesis,[key]:true}),/cannot require/);
  assert.throws(()=>validateSigmaPreviewFinding({...hypothesis,classification:'CONFIRMED',blocker:true}),/true non-mutating/);
  assert.throws(()=>validateSigmaPreviewFinding(undefined),/missing/);
});
