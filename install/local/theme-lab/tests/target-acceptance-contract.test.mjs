import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {TARGET_ACCEPTANCE_CONTRACT,TARGET_ACCEPTANCE_CONTRACT_SHA256} from '../src/target-acceptance-contract.mjs';

const lab=fileURLToPath(new URL('../',import.meta.url));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(lab,file))).digest('hex');

test('target acceptance contract binds every static fixture consumed by full acceptance',()=>{
  assert.equal(TARGET_ACCEPTANCE_CONTRACT.static_inputs.runtime_surface_parity_sha256,sha('fixtures/runtime-surface-parity.json'));
  assert.equal(TARGET_ACCEPTANCE_CONTRACT.static_inputs.surface_contract_fixture_sha256,sha('ports/interactive-visual-fixture/fixture.wikidot.txt'));
  assert.equal(TARGET_ACCEPTANCE_CONTRACT.static_inputs.torture_fixture_sha256,sha('fixtures/theme-torture.wikidot.txt'));
  assert.match(TARGET_ACCEPTANCE_CONTRACT.program_module_closure_sha256,/^[0-9a-f]{64}$/u);
  assert.match(TARGET_ACCEPTANCE_CONTRACT_SHA256,/^[0-9a-f]{64}$/u);
});
