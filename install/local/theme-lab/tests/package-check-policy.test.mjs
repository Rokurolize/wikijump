import assert from 'node:assert/strict';
import test from 'node:test';
import {PACKAGE_CHECK_TIMEOUT_MS} from '../src/package-check-policy.mjs';

test('full package check timeout accommodates measured surface-contract acceptance', () => {
  const measuredFullCheckMs = 157_154.9;
  assert.ok(PACKAGE_CHECK_TIMEOUT_MS > measuredFullCheckMs);
  assert.ok(PACKAGE_CHECK_TIMEOUT_MS < measuredFullCheckMs * 2);
});
