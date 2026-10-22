import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {resolveExistingContainedFile} from './package-path.mjs';

// The current acceptance gates read one maintained run contract per
// generation. A task-owned runtime produces its own hash-bound contract
// (prepare-current-runtime-contract), so the gates accept an alternative
// contract only when it is an immutable, well-formed task contract inside the
// Theme Lab tree AND every audit row was captured against exactly that file.
// The default shared flow is unchanged.
export const DEFAULT_SIGMA9_RUN_CONTRACT = 'ports/current-acceptance/run-contract.json';
export const DEFAULT_SIGMA10_RUN_CONTRACT = 'sigma10-migration/current-campaign/run-contract.json';
const SIGMA9_TASK = /^ports\/current-acceptance\/run-contract-[a-z][a-z0-9-]{2,55}\.json$/u;
const SIGMA10_TASK = /^sigma10-migration\/current-campaign\/run-contract-[a-z][a-z0-9-]{2,55}\.json$/u;

export function resolveRunContractOption(root, value, {generation = 'sigma9'} = {}) {
  const fallback = generation === 'sigma10' ? DEFAULT_SIGMA10_RUN_CONTRACT : DEFAULT_SIGMA9_RUN_CONTRACT;
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || !value) throw new Error('--run-contract needs a path');
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved).split(path.sep).join('/');
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('--run-contract must stay inside Theme Lab');
  if (relative === fallback) return fallback;
  if (!(generation === 'sigma10' ? SIGMA10_TASK : SIGMA9_TASK).test(relative))
    throw new Error(`--run-contract must be the shared ${fallback} or a task-owned ${generation === 'sigma10' ? 'sigma10-migration/current-campaign/' : 'ports/current-acceptance/'}run-contract-<run-id>.json`);
  resolveExistingContainedFile(root, relative, 'Task-owned run contract');
  const document = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
  const schema = generation === 'sigma10' ? 'scp_jp_sigma10_migration_run.v1' : 'scp_jp_interactive_acceptance_run.v1';
  if (document?.schema !== schema) throw new Error(`--run-contract is not a ${schema} document`);
  return relative;
}

// Fail closed: a non-default contract only applies to an audit whose rows were
// all captured against that exact file.
export function auditMatchesRunContract(records, contractBytes) {
  const sha = crypto.createHash('sha256').update(contractBytes).digest('hex');
  const failures = [];
  for (const row of records ?? [])
    if (row.run_contract_sha256 !== sha) failures.push(`audit row was not captured against the supplied run contract: ${row.surface}.${row.state}`);
  return failures;
}
