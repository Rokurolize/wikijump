import crypto from 'node:crypto';

const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function themeTestMeasurementReceipt({scenarioSha256,measurementContractSha256,measurementContract,engine,browserVersion,sessionProfile,canonicalExecutionSha256,expectedVersions}){
  if(!/^[0-9a-f]{64}$/u.test(scenarioSha256??''))throw new Error('invalid scenario SHA for measurement receipt');
  if(!/^[0-9a-f]{64}$/u.test(measurementContractSha256??''))throw new Error('invalid measurement contract SHA');
  if(measurementContract?.schema!=='theme_lab_measurement_contract.v1')throw new Error('unsupported measurement contract schema');
  if(!measurementContract.browser_engines?.includes(engine))throw new Error(`browser engine is outside measurement contract: ${engine}`);
  if(!measurementContract.session_profiles?.includes(sessionProfile))throw new Error(`session profile is outside measurement contract: ${sessionProfile}`);
  if(!/^[0-9a-f]{64}$/u.test(canonicalExecutionSha256??''))throw new Error('invalid canonical execution SHA');
  if(measurementContract.browser_version_policy!=='exact-runtime-version-receipt')throw new Error('measurement contract does not require exact browser versions');
  const expected=expectedVersions?.[engine];
  if(typeof expected!=='string'||!expected)throw new Error(`expected browser version is unavailable: ${engine}`);
  if(browserVersion!==expected)throw new Error(`browser version mismatch for ${engine}: expected ${expected}, observed ${browserVersion}`);
  const payload={schema:'theme_lab_measurement_receipt.v1',scenario_sha256:scenarioSha256,measurement_contract_sha256:measurementContractSha256,engine,browser_version:browserVersion,session_profile:sessionProfile,canonical_execution_sha256:canonicalExecutionSha256};
  return {...payload,receipt_sha256:sha(payload)};
}
