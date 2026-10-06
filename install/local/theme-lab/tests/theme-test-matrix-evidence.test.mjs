import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {CANONICAL_INTERACTION_STATES,CANONICAL_SEMANTIC_PROBES} from '../src/theme-canonical-execution.mjs';
import {themeScenarioConfigForPackage} from '../src/theme-scenario-factory.mjs';
import {materializeThemeTestScenario} from '../src/theme-test-scenario-config.mjs';
import {runThemeScenarioMatrix} from '../src/theme-test-matrix.mjs';
import {validateCanonicalScenarioMatrix} from '../src/theme-test-matrix-evidence.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const config=themeScenarioConfigForPackage(root,{generation:'sigma9',packageName:'bedrock'});
const materialized=materializeThemeTestScenario(root,config);
const receiptBase={schema:'theme_lab_live_site_state.v1',scenario_sha256:materialized.scenario_sha256,declared_site_state_sha256:materialized.scenario.branch_profile.site_state_sha256,site_id:17,site_slug:materialized.scenario.branch_profile.site_slug,observed:{}};
const siteStateReceipt={...receiptBase,receipt_sha256:crypto.createHash('sha256').update(JSON.stringify(receiptBase)).digest('hex')};
const versions={chromium:'141',firefox:'142',webkit:'26'};
const expectedBackendRuntimeIdentity=JSON.parse(fs.readFileSync(path.join(root,'ports/current-acceptance/run-contract.json'),'utf8')).expected_backend_runtime_identity;
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fakeSingle=async({browserEngine,expectedBrowserVersions})=>({schema:'theme_lab_scenario_smoke.v1',scenario_sha256:materialized.scenario_sha256,runs:Object.fromEntries(['anonymous','authenticated'].map(profile=>{const base={schema:'theme_lab_canonical_execution.v1',scenario_sha256:materialized.scenario_sha256,session_profile:profile,backend_runtime_identity:expectedBackendRuntimeIdentity,session_observation:{my_account_text:profile==='authenticated'?'Administrator':null,logout_link_present:profile==='authenticated',sign_in_link_present:profile==='anonymous'},check_evidence:{verification_scope:'pass',target_acceptance:'pass',image_diagnostics:'pass',japanese_glyph_rendering:'pass'},interaction_states:CANONICAL_INTERACTION_STATES.map(id=>({id,status:'pass'})),semantic_probes:CANONICAL_SEMANTIC_PROBES.map(id=>({id,status:'pass'}))};const execution={...base,canonical_execution_sha256:hash(base)};const receiptBase={schema:'theme_lab_measurement_receipt.v1',scenario_sha256:materialized.scenario_sha256,measurement_contract_sha256:materialized.bindings.measurement_contract.sha256,engine:browserEngine,browser_version:expectedBrowserVersions[browserEngine],session_profile:profile,canonical_execution_sha256:execution.canonical_execution_sha256};return[profile,{measurement_receipt:{...receiptBase,receipt_sha256:hash(receiptBase)},canonical_execution:execution}]}))});

test('canonical matrix evidence revalidates all six cells against the current package scenario',async()=>{
  const matrix=await runThemeScenarioMatrix({root,config,siteStateReceipt,browserRoot:'/fake',sessionStorageStates:{anonymous:null,authenticated:{}},runSingle:fakeSingle,loadType:()=>({}),readVersions:()=>versions});
  const validated=validateCanonicalScenarioMatrix({root,packageName:'bedrock',generation:'sigma9',matrix,browserVersions:versions});
  assert.equal(validated.matrix_receipt_sha256,matrix.matrix_receipt_sha256);
  const tampered=structuredClone(matrix);tampered.engines.firefox.authenticated.canonical_execution.semantic_probes[0].status='fail';
  assert.throws(()=>validateCanonicalScenarioMatrix({root,packageName:'bedrock',generation:'sigma9',matrix:tampered,browserVersions:versions}),/canonical execution contains a failure/u);
});
