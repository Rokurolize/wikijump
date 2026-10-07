import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {themeScenarioConfigForPackage} from '../src/theme-scenario-factory.mjs';
import {materializeThemeTestScenario} from '../src/theme-test-scenario-config.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('package scenario factory changes only the theme axis of a generation template',()=>{
  const config=themeScenarioConfigForPackage(root,{generation:'sigma9',packageName:'bedrock'});
  assert.equal(config.theme.id,'bedrock');
  assert.equal(config.theme.css,'ports/bedrock/candidate.css');
  assert.equal(config.theme.source,'ports/bedrock/candidate.wikidot.source.txt');
  assert.equal(config.theme.base_css,undefined);
  const materialized=materializeThemeTestScenario(root,config);
  assert.equal(materialized.scenario.theme.id,'bedrock');
  assert.equal(materialized.scenario.theme.base_css_sha256,null);
});

test('package scenario factory binds declared candidate-base CSS without changing generation identity',()=>{
  const sigma9=themeScenarioConfigForPackage(root,{generation:'sigma9',packageName:'site'});
  const sigma10=themeScenarioConfigForPackage(root,{generation:'sigma10',packageName:'site'});
  assert.equal(sigma9.theme.base_css,'ports/site/candidate-base.css');
  assert.equal(sigma10.theme.base_css,'ports/site/candidate-base.css');
  const left=materializeThemeTestScenario(root,sigma9),right=materializeThemeTestScenario(root,sigma10);
  assert.equal(left.scenario.theme.base_css_sha256,right.scenario.theme.base_css_sha256);
  assert.notEqual(left.scenario.baseline.id,right.scenario.baseline.id);
  assert.notEqual(left.scenario.shell_profile.id,right.scenario.shell_profile.id);
});

test('package scenario factory fails closed on unknown packages and generations',()=>{
  assert.throws(()=>themeScenarioConfigForPackage(root,{generation:'sigma11',packageName:'bedrock'}),/unsupported canonical scenario generation/u);
  assert.throws(()=>themeScenarioConfigForPackage(root,{generation:'sigma9',packageName:'not-a-real-theme'}),/unknown maintained package/u);
});
