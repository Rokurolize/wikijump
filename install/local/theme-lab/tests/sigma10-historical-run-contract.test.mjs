import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadHistoricalSigma10RunContract, HISTORICAL_SIGMA10_RUN_CONTRACT_SHA256 } from '../sigma10-migration/historical-run-contract.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('historical Sigma-10 contract uses the identity captured in all 460 archived audit records', async () => {
  const { contract, sha256 } = await loadHistoricalSigma10RunContract();
  const audit = JSON.parse(await readFile(new URL('../sigma10-migration/evidence/interactive-visual-audit.json', import.meta.url), 'utf8'));
  assert.equal(audit.records.length, 460);
  assert.deepEqual([...new Set(audit.records.map(row => row.run_contract_sha256))], [sha256]);
  assert.equal(sha256, HISTORICAL_SIGMA10_RUN_CONTRACT_SHA256);
  assert.equal(contract.schema, 'scp_jp_sigma10_migration_run.v1');
  const current = await readFile(new URL('../sigma10-migration/run-contract.json', import.meta.url));
  assert.notEqual(hash(current), sha256, 'current runtime identity must not silently replace the historical contract');
  const { expected_runtime_source_sha256, schema: maintainedSchema } = JSON.parse(current);
  assert.match(expected_runtime_source_sha256, /^[a-f0-9]{64}$/u);
  assert.equal(maintainedSchema, contract.schema, 'historical and current contracts use the same migration contract format');
});

test('historical Sigma-10 contract rejects modified bytes, even if JSON stays valid', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sigma10-historical-contract-'));
  try {
    const target = path.join(dir, 'altered.json');
    await writeFile(target, '{"schema":"scp_jp_sigma10_migration_run.v1"}\n');
    await assert.rejects(loadHistoricalSigma10RunContract(target), /historical Sigma-10 run contract SHA-256 mismatch/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
