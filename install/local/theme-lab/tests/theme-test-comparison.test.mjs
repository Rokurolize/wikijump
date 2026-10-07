import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {THEME_TEST_SCENARIO_SCHEMA} from '../src/theme-test-scenario.mjs';
import {compareThemeTestScenarios} from '../src/theme-test-comparison.mjs';

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const scenario=()=>({schema:THEME_TEST_SCENARIO_SCHEMA,runtime:{platform:'wikijump',implementation:'runtime',implementation_sha256:sha('runtime'),origin:'https://jp.example.test'},branch_profile:{id:'scp-jp',locale:'ja',site_slug:'scp-jp',site_state_sha256:sha('site')},shell_profile:{id:'scp-jp-sigma9-shell',format:'rendered-html',shell_sha256:sha('shell'),injection_sha256:sha('injection')},baseline:{id:'sigma9',css_sha256:sha('base'),component_contract_sha256:sha('components')},theme:{id:'theme',css_sha256:sha('css'),source_sha256:sha('source'),asset_dependency_sha256:sha('assets')},corpus:{id:'corpus',manifest_sha256:sha('manifest'),source_sha256:sha('corpus'),state_set_sha256:sha('states')},measurement:{id:'measurement',contract_sha256:sha('measurement')}});

test('runtime parity comparison permits only the declared runtime difference',()=>{
  const left=scenario(),right=scenario();right.runtime={platform:'wikidot',implementation:'controlled-wikidot',implementation_sha256:sha('wikidot'),origin:'https://controlled-en.wikidot.test'};
  const result=compareThemeTestScenarios(left,right,{allowedDifferences:['runtime']});
  assert.deepEqual(result.observed_differences,['runtime']);
  assert.deepEqual(result.unused_allowed_differences,[]);
});

test('baseline migration comparison fails closed on an undeclared shell difference',()=>{
  const left=scenario(),right=scenario();right.baseline={id:'sigma10',css_sha256:sha('sigma10'),component_contract_sha256:sha('sigma10 components')};right.shell_profile.shell_sha256=sha('different shell');
  assert.throws(()=>compareThemeTestScenarios(left,right,{allowedDifferences:['baseline']}),/unexpected scenario differences: shell_profile/u);
});

test('canonical corpus can never vary inside a theme comparison',()=>{
  const left=scenario(),right=scenario();right.corpus.source_sha256=sha('other corpus');
  assert.throws(()=>compareThemeTestScenarios(left,right,{allowedDifferences:['theme']}),/canonical corpus identity differs/u);
});
