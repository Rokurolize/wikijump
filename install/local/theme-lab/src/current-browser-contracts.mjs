import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {playwrightBrowserVersions} from './playwright-browser-versions.mjs';
import {ACCEPTANCE_VIEWPORTS} from './acceptance-viewports.mjs';
import {scopedRunContractSha} from './scoped-run-contract.mjs';
import {observationRuntimeSourceMatchesContract} from './runtime-source-identity.mjs';
import {deepwellRuntimeIdentityMatchesContract,requireDeepwellRuntimeIdentity} from './deepwell-runtime-identity.mjs';

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const viewportById=new Map(ACCEPTANCE_VIEWPORTS.map(row=>[row.id,{width:row.width,height:row.height}]));

// Anonymous contract dumping starts a disposable browser but opens no page or
// session. Recompute cheap contracts; never recapture pixels just to inspect
// the current dependency graph.
export function readCurrentBrowserContracts(root, contractPath, {browserRoot=path.resolve(root,'../../../framerail')}={}) {
  const bytes = execFileSync(process.execPath, [path.join(root, 'ports/interactive-visual-fixture/capture-interactive.mjs'),
    '--anonymous', '--dump-contracts', `--run-contract=${path.join(root, contractPath)}`],
  {encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    env:{...process.env,THEME_LAB_BROWSER_ROOT:browserRoot}});
  const document = JSON.parse(bytes);
  const contracts = new Map(document.states.map(state => [`${state.surface}.${state.state}`, state]));
  contracts.browser_versions = playwrightBrowserVersions(browserRoot);
  contracts.target_site = document.target_site;
  contracts.expected_runtime_source_sha256 = document.expected_runtime_source_sha256;
  contracts.expected_backend_runtime_identity = requireDeepwellRuntimeIdentity(document.expected_backend_runtime_identity, `${contractPath} browser run contract`);
  return contracts;
}

export function observationHasCurrentActionAndFixture(row, contracts) {
  if(!observationRuntimeSourceMatchesContract(row,{expected_runtime_source_sha256:contracts.expected_runtime_source_sha256}))return false;
  if(!deepwellRuntimeIdentityMatchesContract(row,{expected_backend_runtime_identity:contracts.expected_backend_runtime_identity}))return false;
  const expectedBrowserVersion=contracts.browser_versions?.[row.browser_engine];
  if (typeof expectedBrowserVersion !== 'string' || row.browser_version !== expectedBrowserVersion) return false;
  const target=contracts.target_site;
  if(!target||row.target_site!==target.slug||row.locale!==target.locale)return false;
  try{
    const actual=new URL(row.transport_origin),logical=new URL(target.origin);
    if(actual.protocol!==logical.protocol||actual.hostname!==logical.hostname)return false;
  }catch{return false}
  if (row.capture_action_model != null && row.capture_action_model !== 'theme_lab_action_contract.v3') return false;
  const current = contracts.get(`${row.surface}.${row.state}`);
  if (typeof current?.fixture_slug === 'string' && row.fixture !== current.fixture_slug) return false;
  if (!['logged_out','administrator'].includes(row.session_state)) return false;
  if (current?.guest === true && row.session_state !== 'logged_out') return false;
  const expected = row.capture_action_model === 'theme_lab_action_contract.v3'
    ? [current?.action_contract_sha256] : current?.legacy_action_contract_alternatives ?? [current?.legacy_action_contract_sha256];
  return expected.some(value => typeof value === 'string' && row.capture_state_action_contract_sha256 === value) &&
    row.fixture_contract_sha256 === current.fixture_contract_sha256;
}

export function browserEnvironmentContractHashes(row,contracts,runContract,runContractSha,{assetDependencySha,candidateStructureSha=null}={}){
  if(!observationRuntimeSourceMatchesContract(row,runContract))return null;
  if(!deepwellRuntimeIdentityMatchesContract(row,runContract))return null;
  if(row.backend_runtime_identity_sha256!==row.backend_runtime_identity?.identity_sha256)return null;
  const viewportSize=viewportById.get(row.viewport);
  if(!viewportSize)return null;
  const current=contracts.get(`${row.surface}.${row.state}`),browserVersion=contracts.browser_versions?.[row.browser_engine];
  if(typeof current?.fixture_contract_sha256!=='string'||typeof browserVersion!=='string'||typeof assetDependencySha!=='string')return null;
  const environmentInputs={fixtureSha:current.fixture_contract_sha256,site:runContract.target_site,transportOrigin:row.transport_origin,
    baselineTheme:runContract.baseline_theme,browserEngine:row.browser_engine,browserVersion,viewportName:row.viewport,viewportSize,
    assetDependencySha,runtimeSourceSha:row.runtime_source_sha256,backendRuntimeIdentitySha:row.backend_runtime_identity_sha256,...(candidateStructureSha?{candidate_structure_sha256:candidateStructureSha}:{})};
  const scoped=sha(JSON.stringify({scopedContractSha:scopedRunContractSha(runContract,row),...environmentInputs}));
  const legacy=sha(JSON.stringify({runContractSha,...environmentInputs}));
  return {viewportSize,scoped,legacy};
}

export function observationHasCurrentEnvironment(row,contracts,runContract,runContractSha,dependencies={}){
  const hashes=browserEnvironmentContractHashes(row,contracts,runContract,runContractSha,dependencies);
  if(!hashes||JSON.stringify(row.viewport_size)!==JSON.stringify(hashes.viewportSize))return false;
  if(row.environment_contract_sha256===hashes.scoped)return true;
  return row.run_contract_sha256===runContractSha&&row.environment_contract_sha256===hashes.legacy;
}
