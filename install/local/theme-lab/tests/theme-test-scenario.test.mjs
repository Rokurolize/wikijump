import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {THEME_TEST_SCENARIO_SCHEMA,normalizeThemeTestScenario,themeTestScenarioSha} from '../src/theme-test-scenario.mjs';

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const base=()=>({
  schema:THEME_TEST_SCENARIO_SCHEMA,
  runtime:{platform:'wikijump',implementation:'wikijump-local',implementation_sha256:sha('wikijump runtime'),origin:'https://jp.example.test'},
  branch_profile:{id:'scp-jp',locale:'ja',site_slug:'scp-jp',site_state_sha256:sha('jp page existence/tags/permissions')},
  shell_profile:{id:'scp-jp-sigma9-shell',format:'rendered-html',shell_sha256:sha('jp sigma9 shell'),injection_sha256:sha('injection')},
  baseline:{id:'sigma9',css_sha256:sha('sigma9'),component_contract_sha256:sha('sigma9 components')},
  theme:{id:'extra-black-highlighter-theme',css_sha256:sha('theme css'),source_sha256:sha('ported source'),asset_dependency_sha256:sha('theme assets')},
  corpus:{id:'canonical-theme-corpus-v1',manifest_sha256:sha('corpus manifest'),source_sha256:sha('corpus source'),state_set_sha256:sha('corpus states')},
  measurement:{id:'canonical-browser-measurement-v1',contract_sha256:sha('measurement')},
});

test('scenario identity keeps runtime, branch, shell, baseline, theme, corpus and measurement as independent axes',()=>{
  const original=base(),identity=normalizeThemeTestScenario(original),originalSha=themeTestScenarioSha(original);
  assert.equal(identity.branch_profile.id,'scp-jp');
  const variants=[
    value=>{value.runtime.platform='wikidot'},
    value=>{value.runtime.implementation_sha256=sha('different runtime')},
    value=>{value.runtime.origin='https://other.example.test'},
    value=>{value.shell_profile.shell_sha256=sha('different shell')},
    value=>{value.shell_profile.injection_sha256=sha('different injection map')},
    value=>{value.branch_profile.site_state_sha256=sha('different missing-link state')},
    value=>{value.branch_profile.site_slug='other-site'},
    value=>{value.baseline.id='sigma10';value.baseline.css_sha256=sha('sigma10')},
    value=>{value.baseline.component_contract_sha256=sha('different baseline components')},
    value=>{value.theme.css_sha256=sha('different theme')},
    value=>{value.theme.asset_dependency_sha256=sha('different theme assets')},
    value=>{value.corpus.manifest_sha256=sha('different corpus contract')},
    value=>{value.corpus.source_sha256=sha('different corpus')},
    value=>{value.corpus.state_set_sha256=sha('different interactions')},
    value=>{value.measurement.contract_sha256=sha('different measurement')},
  ];
  for(const mutate of variants){const next=structuredClone(original);mutate(next);assert.notEqual(themeTestScenarioSha(next),originalSha)}
});

test('scenario identity fails closed when a semantic axis lacks byte identity',()=>{
  for(const mutate of [
    value=>{delete value.branch_profile.site_state_sha256},
    value=>{delete value.runtime.implementation_sha256},
    value=>{delete value.baseline.css_sha256},
    value=>{delete value.baseline.component_contract_sha256},
    value=>{delete value.theme.source_sha256},
    value=>{delete value.theme.asset_dependency_sha256},
    value=>{delete value.corpus.manifest_sha256},
    value=>{delete value.corpus.state_set_sha256},
    value=>{delete value.measurement.contract_sha256},
  ]){const next=base();mutate(next);assert.throws(()=>normalizeThemeTestScenario(next),/sha256 digest/u)}
});
