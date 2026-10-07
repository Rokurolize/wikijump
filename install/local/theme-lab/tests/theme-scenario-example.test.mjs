import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {materializeThemeTestScenario} from '../src/theme-test-scenario-config.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('checked-in JP Sigma-9 example materializes all seven scenario axes',()=>{
  const config=JSON.parse(fs.readFileSync(path.join(root,'scenarios/jp-sigma9-extra-black-canonical.json'),'utf8'));
  const result=materializeThemeTestScenario(root,config);
  assert.equal(result.scenario.runtime.platform,'wikijump');
  assert.equal(result.scenario.branch_profile.id,'scp-jp');
  assert.equal(result.scenario.baseline.id,'sigma9');
  assert.equal(result.scenario.theme.id,'extra-black-highlighter-theme');
  assert.equal(result.scenario.corpus.id,'canonical-theme-corpus-v1');
  assert.equal(result.scenario.measurement.id,'canonical-browser-measurement-v1');
  assert.match(result.scenario_sha256,/^[0-9a-f]{64}$/u);
});

test('checked-in JP Sigma-10 example keeps branch and corpus identity while changing shell and baseline generation',()=>{
  const sigma9=materializeThemeTestScenario(root,JSON.parse(fs.readFileSync(path.join(root,'scenarios/jp-sigma9-extra-black-canonical.json'),'utf8')));
  const sigma10=materializeThemeTestScenario(root,JSON.parse(fs.readFileSync(path.join(root,'scenarios/jp-sigma10-extra-black-canonical.json'),'utf8')));
  assert.deepEqual(sigma10.scenario.branch_profile,sigma9.scenario.branch_profile);
  assert.deepEqual(sigma10.scenario.corpus,sigma9.scenario.corpus);
  assert.deepEqual(sigma10.scenario.theme,sigma9.scenario.theme);
  assert.notDeepEqual(sigma10.scenario.shell_profile,sigma9.scenario.shell_profile);
  assert.notDeepEqual(sigma10.scenario.baseline,sigma9.scenario.baseline);
});
