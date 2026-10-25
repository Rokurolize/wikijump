// Finalizes the Sigma-10 migration decision (theme_lab_current_sigma10_acceptance.v1)
// from a finished browser audit and one canonical scenario matrix per maintained
// package. It writes nothing unless the same audit checks the completion gate
// applies (validateSigma10MigrationAudit) pass on these exact bytes. Overall
// status is derived from the evidence; nothing in it is invented.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync, gzipSync} from 'node:zlib';
import {resolveRunContractOption} from './current-run-contract-option.mjs';
import {validateCurrentSigma10Contract, validateSigma10MigrationAudit} from './campaign-completion.mjs';
import {validateCanonicalScenarioMatrix} from './theme-test-matrix-evidence.mjs';
import {playwrightBrowserVersions} from './playwright-browser-versions.mjs';
import {prepareContainedOutputFile, resolveExistingContainedFile} from './package-path.mjs';
import {canonicalJson} from './semantic-review-recording.mjs';

export const SIGMA10_ACCEPTANCE_SCHEMA = 'theme_lab_current_sigma10_acceptance.v1';
export const SIGMA10_CAMPAIGN_DIRECTORY = 'sigma10-migration/current-campaign';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const CONTRACT_WARNING = 'EXTERNAL_CONTRACT_UNVERIFIABLE';

// Returns {ok, failures, written}. A refusal writes nothing.
export function finalizeCurrentSigma10({root, auditPath, runContract, scenarioMatrixDirectory, browserRoot, nonblockingPath = null, gzip = false}) {
  const rootPath = fs.realpathSync(path.resolve(root));
  const failures = [];
  const ledger = JSON.parse(fs.readFileSync(resolveExistingContainedFile(rootPath, 'ports/adaptation-authority.json', 'Maintained package ledger'), 'utf8'));
  const names = Object.keys(ledger.packages).sort();
  const sigma10Contract = resolveRunContractOption(rootPath, runContract, {generation: 'sigma10'});
  const contractSha = sha(fs.readFileSync(resolveExistingContainedFile(rootPath, sigma10Contract, 'Sigma-10 run contract')));
  failures.push(...validateCurrentSigma10Contract(rootPath, sigma10Contract));

  const auditBytes = fs.readFileSync(path.resolve(auditPath));
  const sourceAudit = JSON.parse((auditPath.endsWith('.gz') ? gunzipSync(auditBytes) : auditBytes).toString('utf8'));

  const matrixDirectory = path.resolve(scenarioMatrixDirectory);
  const expectedFiles = names.map(name => `${name}.json`);
  const presentFiles = fs.readdirSync(matrixDirectory).sort();
  if (JSON.stringify(presentFiles) !== JSON.stringify(expectedFiles.slice().sort())) {
    failures.push(`scenario matrix directory must hold exactly one <package>.json per maintained package (${names.length}); found ${presentFiles.length} entries`);
  }

  // The installed Playwright versions must be the ones the matrices were measured with.
  const installed = playwrightBrowserVersions(path.resolve(browserRoot));
  for (const record of sourceAudit.records ?? []) {
    if (installed[record.browser_engine] !== record.browser_version) {
      failures.push(`browser audit ${record.browser_engine} ${record.browser_version} differs from the installed ${installed[record.browser_engine] ?? 'absent'} runtime`);
    }
  }

  const matrices = {}, evidence = {};
  for (const name of names) {
    let matrix;
    try {
      matrix = JSON.parse(fs.readFileSync(path.join(matrixDirectory, `${name}.json`), 'utf8'));
    } catch (error) {
      failures.push(`${name}: scenario matrix is unreadable: ${error.message}`);
      continue;
    }
    try {
      const canonical = validateCanonicalScenarioMatrix({root: rootPath, packageName: name, generation: 'sigma10', matrix, browserVersions: installed, runContract: sigma10Contract});
      matrices[name] = matrix;
      evidence[name] = {
        generation: 'sigma10',
        scenario_sha256: canonical.scenario_sha256,
        matrix_receipt_sha256: canonical.matrix_receipt_sha256,
        measurement_contract_sha256: canonical.measurement_contract_sha256,
      };
    } catch (error) {
      failures.push(`${name}: canonical scenario matrix is invalid: ${error.message}`);
    }
  }

  let nonblocking = [];
  if (nonblockingPath !== null) {
    const value = JSON.parse(fs.readFileSync(path.resolve(nonblockingPath), 'utf8'));
    if (!Array.isArray(value) || value.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
      failures.push('nonblocking observations must be a JSON array of objects');
    } else {
      nonblocking = value;
    }
  }

  // The audit that gets indexed carries the canonical matrices. An audit that
  // already embeds different matrices is refused rather than overwritten.
  const audit = {...sourceAudit};
  if (sourceAudit.canonical_scenarios !== undefined && canonicalJson(sourceAudit.canonical_scenarios) !== canonicalJson(matrices)) {
    failures.push('audit canonical_scenarios differ from the supplied scenario matrices');
  }
  audit.canonical_scenarios = matrices;

  failures.push(...validateSigma10MigrationAudit(rootPath, {sigma10Contract, audit, evidence, nonblockingObservations: nonblocking}));
  if (failures.length) return {ok: false, failures, written: []};

  const canonicalBytes = Buffer.from(`${JSON.stringify(audit, null, 2)}\n`);
  const reasons = {};
  const count = (key, n = 1) => { if (n) reasons[key] = (reasons[key] ?? 0) + n; };
  for (const review of Object.values(audit.semantic_reviews ?? {})) if (review?.status === 'warn') count('semantic_review_warn');
  for (const record of audit.records ?? []) if (record.classification === CONTRACT_WARNING) count('external_contract_unverifiable');
  count('nonblocking_observations', nonblocking.length);
  const status = Object.keys(reasons).length ? 'warn' : 'pass';

  const result = {
    schema: SIGMA10_ACCEPTANCE_SCHEMA,
    run_contract_sha256: contractSha,
    browser_audit_sha256: sha(canonicalBytes),
    overall_acceptance: {status, derived_from: reasons},
    canonical_scenario_evidence: evidence,
    nonblocking_observations: nonblocking,
  };

  const auditName = `${SIGMA10_CAMPAIGN_DIRECTORY}/${gzip ? 'browser-audit.json.gz' : 'browser-audit.json'}`;
  const receiptName = `${SIGMA10_CAMPAIGN_DIRECTORY}/accepted-result.json`;
  for (const relative of [auditName, receiptName]) {
    if (fs.existsSync(path.join(rootPath, relative))) {
      return {ok: false, failures: [`${relative} already exists; remove it deliberately before finalizing again`], written: []};
    }
  }
  const auditTarget = prepareContainedOutputFile(rootPath, auditName, 'Sigma-10 browser audit');
  const receiptTarget = prepareContainedOutputFile(rootPath, receiptName, 'Sigma-10 accepted result');
  fs.writeFileSync(auditTarget, gzip ? gzipSync(canonicalBytes) : canonicalBytes, {flag: 'wx'});
  fs.writeFileSync(receiptTarget, `${JSON.stringify(result, null, 2)}\n`, {flag: 'wx'});
  return {
    ok: true,
    failures: [],
    status,
    written: [path.relative(rootPath, auditTarget), path.relative(rootPath, receiptTarget)],
    browser_audit_sha256: result.browser_audit_sha256,
    run_contract_sha256: contractSha,
  };
}
