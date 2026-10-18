import crypto from 'node:crypto';
import fs from 'node:fs/promises';

// The original 2026-09-27 migration capture binds this exact run contract.
// The maintained run-contract.json gained a runtime identity in 8f0573bdd3;
// rewriting old evidence to match it would erase the historical binding.
export const HISTORICAL_SIGMA10_RUN_CONTRACT_SHA256 = '7d2313c1d42f010bd3a893e1364ba56931b56044ba1f782ed0ee887fde6deba9';

export async function loadHistoricalSigma10RunContract(file = new URL('./historical-run-contract.json', import.meta.url)) {
  const bytes = await fs.readFile(file);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== HISTORICAL_SIGMA10_RUN_CONTRACT_SHA256) {
    throw new Error(`historical Sigma-10 run contract SHA-256 mismatch: ${sha256}`);
  }
  return { contract: JSON.parse(bytes), sha256 };
}
