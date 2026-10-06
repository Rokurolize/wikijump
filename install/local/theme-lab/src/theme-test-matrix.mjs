import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {loadBrowserType} from './browser-lab.mjs';
import {playwrightBrowserVersions} from './playwright-browser-versions.mjs';
import {materializeThemeTestScenario} from './theme-test-scenario-config.mjs';
import {runThemeScenarioSmoke} from './theme-test-runner.mjs';

const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function runThemeScenarioMatrix({root,config,siteStateReceipt,renderedShell=null,browserRoot,pathPrefix='/tmp/theme-lab-canonical',sessionStorageStates,runSingle=runThemeScenarioSmoke,loadType=loadBrowserType,readVersions=playwrightBrowserVersions}){
  const materialized=materializeThemeTestScenario(root,config);
  const measurement=JSON.parse(fs.readFileSync(path.join(root,materialized.bindings.measurement_contract.path),'utf8'));
  const expectedVersions=readVersions(browserRoot);
  const expectedEngines=measurement.browser_engines;
  if(JSON.stringify(Object.keys(expectedVersions).sort())!==JSON.stringify([...expectedEngines].sort()))throw new Error('installed Playwright browser set does not match canonical measurement contract');
  const engines={};
  for(const engine of expectedEngines){
    const browserType=loadType(engine,browserRoot);
    const result=await runSingle({root,config,siteStateReceipt,renderedShell,browserType,browserEngine:engine,expectedBrowserVersions:expectedVersions,socketPath:`${pathPrefix}.${engine}.sock`,sessionStorageStates});
    if(result.scenario_sha256!==materialized.scenario_sha256)throw new Error(`scenario SHA drift in ${engine} run`);
    const profiles={};
    for(const profile of measurement.session_profiles){
      const run=result.runs?.[profile];if(!run)throw new Error(`missing ${engine}/${profile} canonical run`);
      if(run.measurement_receipt?.engine!==engine||run.measurement_receipt?.session_profile!==profile)throw new Error(`mismatched measurement receipt for ${engine}/${profile}`);
      if(run.measurement_receipt.browser_version!==expectedVersions[engine])throw new Error(`browser version drift in ${engine}/${profile}`);
      if(Object.values(run.canonical_execution.check_evidence??{}).some(status=>status!=='pass')||[...run.canonical_execution.interaction_states,...run.canonical_execution.semantic_probes].some(row=>row.status!=='pass'))throw new Error(`canonical execution failed for ${engine}/${profile}`);
      profiles[profile]={measurement_receipt:run.measurement_receipt,canonical_execution:run.canonical_execution};
    }
    engines[engine]=profiles;
  }
  const base={schema:'theme_lab_scenario_matrix.v1',scenario_sha256:materialized.scenario_sha256,measurement_contract_sha256:materialized.bindings.measurement_contract.sha256,engines};
  return {...base,matrix_receipt_sha256:sha(base),canonical_acceptance_eligible:false,blockers:['canonical scenario matrix is not yet bound into package browser audit/finalizer evidence']};
}
