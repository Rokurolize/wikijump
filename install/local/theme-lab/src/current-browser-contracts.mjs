import path from 'node:path';
import {execFileSync} from 'node:child_process';

// Anonymous contract dumping starts a disposable browser but opens no page or
// session. Recompute cheap contracts; never recapture pixels just to inspect
// the current dependency graph.
export function readCurrentBrowserContracts(root, contractPath) {
  const bytes = execFileSync(process.execPath, [path.join(root, 'ports/interactive-visual-fixture/capture-interactive.mjs'),
    '--anonymous', '--dump-contracts', `--run-contract=${path.join(root, contractPath)}`],
  {encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024});
  const document = JSON.parse(bytes);
  return new Map(document.states.map(state => [`${state.surface}.${state.state}`, state]));
}

export function observationHasCurrentActionAndFixture(row, contracts) {
  if (row.capture_action_model != null && row.capture_action_model !== 'theme_lab_action_contract.v3') return false;
  const current = contracts.get(`${row.surface}.${row.state}`);
  const expected = row.capture_action_model === 'theme_lab_action_contract.v3'
    ? [current?.action_contract_sha256] : current?.legacy_action_contract_alternatives ?? [current?.legacy_action_contract_sha256];
  return expected.some(value => typeof value === 'string' && row.capture_state_action_contract_sha256 === value) &&
    row.fixture_contract_sha256 === current.fixture_contract_sha256;
}
