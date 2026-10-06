import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveExistingContainedFile} from './package-path.mjs';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

// The capture reads one candidate and viewport. Inventory membership is checked
// separately by the completion denominator, and the publication freeze digest
// over all themes is validated separately by completion (each theme's own
// candidate entry and inventory row stay below). Output paths do not affect
// paint. Every other field, including unknown future fields, remains a dependency.
export function scopedRunContractSha(contract, {theme, viewport, browser_engine}) {
  const {additional_candidates, current_candidate_inventory, viewports, browser_engines,
    artifact_namespace, audit_path, candidate_set_sha256, ...shared} = contract;
  const candidate = additional_candidates?.[theme] ?? null;
  const inventory = current_candidate_inventory?.filter(row => row.package === theme) ?? null;
  return sha(JSON.stringify({shared, candidate, inventory, viewport: viewports?.[viewport] ?? null,
    browser_engine, engine_allowed: browser_engines?.includes(browser_engine) ?? false}));
}

export function readHistoricalRunContracts(rootDirectory = path.resolve(fileURLToPath(new URL('../evidence/browser-run-contract-history/',import.meta.url)))) {
  const root=fs.realpathSync(rootDirectory);
  const index=path.join(root,'index.json');
  if(!fs.existsSync(index))return new Map();
  const manifest=JSON.parse(fs.readFileSync(index,'utf8'));
  if(manifest.schema!=='theme_lab_run_contract_history.v1')throw new Error('unknown historical run contract schema');
  return new Map(manifest.contracts.map(binding=>{
    const file=resolveExistingContainedFile(root,binding.path,'historical run contract');
    const bytes=fs.readFileSync(file);
    if(crypto.createHash('sha256').update(bytes).digest('hex')!==binding.sha256)throw new Error('corrupt historical run contract');
    return [binding.sha256,JSON.parse(bytes)];
  }));
}

let historicalContracts;
export function captureRunContractIsCurrent(row, contract, exactSha, retainedContracts) {
  if (row.scoped_run_contract_sha256 != null) return row.scoped_run_contract_sha256 === scopedRunContractSha(contract, row);
  if(row.run_contract_sha256 === exactSha)return true;
  const history=retainedContracts??(historicalContracts??=readHistoricalRunContracts());
  const old=history.get(row.run_contract_sha256);
  // Derive equivalence only from the exact complete contract bound by the old
  // observation. Changed shared, fixture, baseline or selected-candidate inputs
  // still fail; another package's inventory entry cannot invalidate this one.
  return !!old && scopedRunContractSha(old,row)===scopedRunContractSha(contract,row);
}
