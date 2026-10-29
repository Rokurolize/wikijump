import {assertDeepwellRuntimeIdentity} from './deepwell-runtime-identity.mjs';
import {themeSessionObservationIsValid} from './theme-test-session-observation.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {CANONICAL_INTERACTION_STATES,CANONICAL_SEMANTIC_PROBES} from './theme-canonical-execution.mjs';
import {loadCanonicalLedgerDocument} from './canonical-ledger-waiver.mjs';
import {validateCanonicalMatrixWaivers} from './canonical-matrix-waiver-validity.mjs';
import {playwrightBrowserVersions} from './playwright-browser-versions.mjs';
import {themeScenarioConfigForPackage} from './theme-scenario-factory.mjs';
import {resolveRunContractOption} from './current-run-contract-option.mjs';
import {materializeThemeTestScenario} from './theme-test-scenario-config.mjs';
import {themeTestMeasurementReceipt} from './theme-test-measurement-receipt.mjs';

const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validHash=value=>/^[0-9a-f]{64}$/u.test(value??'');

function validateCanonicalExecution(execution,{scenarioSha256,profile,expectedBackendRuntimeIdentity}){
  if(execution?.schema!=='theme_lab_canonical_execution.v1')throw new Error(`invalid canonical execution schema for ${profile}`);
  if(execution.scenario_sha256!==scenarioSha256||execution.session_profile!==profile)throw new Error(`canonical execution identity mismatch for ${profile}`);
  if(!themeSessionObservationIsValid(profile,execution.session_observation))throw new Error(`canonical session role is unverified for ${profile}`);
  assertDeepwellRuntimeIdentity(expectedBackendRuntimeIdentity,execution.backend_runtime_identity,`canonical execution for ${profile}`);
  const checkKeys=['verification_scope','target_acceptance','image_diagnostics','japanese_glyph_rendering'];
  if(JSON.stringify(Object.keys(execution.check_evidence??{}))!==JSON.stringify(checkKeys))throw new Error(`canonical check evidence is incomplete for ${profile}`);
  // target_acceptance alone is judged by the waiver-aware predicate (ruling
  // (a)): it is acceptable iff every non-pass state row is acceptable. The
  // other checks are never waiver-eligible and stay strict here.
  if(checkKeys.some(key=>key!=='target_acceptance'&&execution.check_evidence[key]!=='pass'))throw new Error(`canonical check evidence is incomplete for ${profile}`);
  if(JSON.stringify(execution.interaction_states?.map(row=>row.id))!==JSON.stringify(CANONICAL_INTERACTION_STATES))throw new Error(`canonical interaction coverage mismatch for ${profile}`);
  if(JSON.stringify(execution.semantic_probes?.map(row=>row.id))!==JSON.stringify(CANONICAL_SEMANTIC_PROBES))throw new Error(`canonical semantic coverage mismatch for ${profile}`);
  // Non-pass rows are judged by the waiver-aware predicate in
  // validateCanonicalScenarioMatrix (ruling (a)), not here: this function
  // keeps the structural checks only.
  const {canonical_execution_sha256:recorded,...unsigned}=execution;
  if(!validHash(recorded)||recorded!==sha(unsigned))throw new Error(`canonical execution hash mismatch for ${profile}`);
  return recorded;
}

const runContractByGeneration={sigma9:'ports/current-acceptance/run-contract.json',sigma10:'sigma10-migration/current-campaign/run-contract.json'};
export function validateCanonicalScenarioMatrix({root,packageName,generation,matrix,browserVersions=null,runContract=null,ledgerDocument=null}){
  const contractPath=runContract===null?(runContractByGeneration[generation]??'missing-run-contract'):resolveRunContractOption(root,runContract,{generation});
  const expectedBackendRuntimeIdentity=JSON.parse(fs.readFileSync(path.join(root,contractPath),'utf8')).expected_backend_runtime_identity;
  const config=themeScenarioConfigForPackage(root,{generation,packageName,runContract});
  const materialized=materializeThemeTestScenario(root,config);
  if(matrix?.schema!=='theme_lab_scenario_matrix.v1')throw new Error('invalid canonical scenario matrix schema');
  if(matrix.scenario_sha256!==materialized.scenario_sha256)throw new Error(`${packageName}: canonical matrix uses a superseded scenario`);
  if(matrix.measurement_contract_sha256!==materialized.bindings.measurement_contract.sha256)throw new Error(`${packageName}: canonical matrix uses a superseded measurement contract`);
  const measurement=JSON.parse(fs.readFileSync(path.join(root,materialized.bindings.measurement_contract.path),'utf8'));
  const expectedVersions=browserVersions??playwrightBrowserVersions(path.resolve(root,'../../../framerail'));
  if(JSON.stringify(Object.keys(matrix.engines??{}))!==JSON.stringify(measurement.browser_engines))throw new Error(`${packageName}: canonical matrix browser engines are incomplete or reordered`);
  // Ruling (a): the waiver verdict comes first, so an unwaived non-pass row
  // reports as a row failure (the historical message) rather than as a
  // downstream hash mismatch. Every consumer of row statuses routes through
  // this one predicate — a non-pass row is acceptable iff its waiver
  // re-matches the in-tree ledger exactly. All callers (finalize, assembly,
  // completion, per-package finalize) inherit this standard.
  const waiverFailures=validateCanonicalMatrixWaivers({packageName,matrix,
    themeCssSha256:materialized.bindings.theme_css.sha256,themeSourceSha256:materialized.bindings.theme_source.sha256,
    scenarioSha256:materialized.scenario_sha256,ledgerDocument:ledgerDocument??loadCanonicalLedgerDocument()});
  if(waiverFailures.length)throw new Error(waiverFailures.join('; '));
  for(const engine of measurement.browser_engines){
    const profiles=matrix.engines[engine];
    if(JSON.stringify(Object.keys(profiles??{}))!==JSON.stringify(measurement.session_profiles))throw new Error(`${packageName}: canonical matrix session profiles are incomplete for ${engine}`);
    for(const profile of measurement.session_profiles){
      const cell=profiles[profile];
      const executionSha=validateCanonicalExecution(cell?.canonical_execution,{scenarioSha256:materialized.scenario_sha256,profile,expectedBackendRuntimeIdentity});
      const receipt=cell?.measurement_receipt;
      const rebuilt=themeTestMeasurementReceipt({scenarioSha256:materialized.scenario_sha256,measurementContractSha256:materialized.bindings.measurement_contract.sha256,measurementContract:measurement,engine,browserVersion:receipt?.browser_version,sessionProfile:profile,canonicalExecutionSha256:executionSha,expectedVersions});
      if(JSON.stringify(receipt)!==JSON.stringify(rebuilt))throw new Error(`${packageName}: canonical measurement receipt is stale for ${engine}/${profile}`);
    }
  }
  // The runner hashes ledger_waivers into the receipt when waivers exist
  // (theme-test-matrix.mjs:50-51); replicate its exact input shape and key
  // order here, or every waivered matrix fails this check. Waiver-free
  // matrices hash exactly as before.
  const base={schema:matrix.schema,scenario_sha256:matrix.scenario_sha256,measurement_contract_sha256:matrix.measurement_contract_sha256,engines:matrix.engines};
  const receiptInput=(matrix.ledger_waivers??[]).length?{...base,ledger_waivers:matrix.ledger_waivers}:base;
  if(!validHash(matrix.matrix_receipt_sha256)||matrix.matrix_receipt_sha256!==sha(receiptInput))throw new Error(`${packageName}: canonical matrix receipt hash mismatch`);
  return {scenario_sha256:materialized.scenario_sha256,matrix_receipt_sha256:matrix.matrix_receipt_sha256,measurement_contract_sha256:materialized.bindings.measurement_contract.sha256};
}
