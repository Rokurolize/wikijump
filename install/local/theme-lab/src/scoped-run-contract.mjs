import crypto from 'node:crypto';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

// The capture reads one candidate and viewport. Inventory membership is checked
// separately by the completion denominator. Output paths do not affect paint.
// Every other field, including unknown future fields, remains a dependency.
export function scopedRunContractSha(contract, {theme, viewport, browser_engine}) {
  const {additional_candidates, current_candidate_inventory, viewports, browser_engines,
    artifact_namespace, audit_path, ...shared} = contract;
  const candidate = additional_candidates?.[theme] ?? null;
  const inventory = current_candidate_inventory?.filter(row => row.package === theme) ?? null;
  return sha(JSON.stringify({shared, candidate, inventory, viewport: viewports?.[viewport] ?? null,
    browser_engine, engine_allowed: browser_engines?.includes(browser_engine) ?? false}));
}

export function captureRunContractIsCurrent(row, contract, exactSha) {
  // Missing semantic provenance cannot be inferred across an actual change.
  if (row.scoped_run_contract_sha256 != null) return row.scoped_run_contract_sha256 === scopedRunContractSha(contract, row);
  return row.run_contract_sha256 === exactSha;
}
