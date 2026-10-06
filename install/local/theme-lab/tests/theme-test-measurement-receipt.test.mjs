import test from 'node:test';
import assert from 'node:assert/strict';

import {themeTestMeasurementReceipt} from '../src/theme-test-measurement-receipt.mjs';

const contract={schema:'theme_lab_measurement_contract.v1',browser_engines:['chromium','firefox','webkit'],browser_version_policy:'exact-runtime-version-receipt',session_profiles:['anonymous','authenticated']};
const args={scenarioSha256:'1'.repeat(64),measurementContractSha256:'2'.repeat(64),measurementContract:contract,engine:'chromium',browserVersion:'141.0.7390.0',sessionProfile:'anonymous',canonicalExecutionSha256:'3'.repeat(64),expectedVersions:{chromium:'141.0.7390.0',firefox:'142.0',webkit:'26.0'}};

test('measurement receipt binds the exact launched browser version',()=>{
  const receipt=themeTestMeasurementReceipt(args);
  assert.equal(receipt.engine,'chromium');
  assert.equal(receipt.browser_version,'141.0.7390.0');
  assert.equal(receipt.session_profile,'anonymous');
  assert.equal(receipt.canonical_execution_sha256,'3'.repeat(64));
  assert.match(receipt.receipt_sha256,/^[0-9a-f]{64}$/u);
});

test('measurement receipt fails closed on engine or version drift',()=>{
  assert.throws(()=>themeTestMeasurementReceipt({...args,browserVersion:'other'}),/browser version mismatch/u);
  assert.throws(()=>themeTestMeasurementReceipt({...args,engine:'unknown'}),/outside measurement contract/u);
  assert.throws(()=>themeTestMeasurementReceipt({...args,sessionProfile:'unknown'}),/outside measurement contract/u);
  assert.throws(()=>themeTestMeasurementReceipt({...args,canonicalExecutionSha256:'bad'}),/canonical execution SHA/u);
});
