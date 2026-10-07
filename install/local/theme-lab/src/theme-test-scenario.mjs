import crypto from 'node:crypto';

export const THEME_TEST_SCENARIO_SCHEMA='theme_lab_test_scenario.v1';
const SHA=/^[0-9a-f]{64}$/u;

function text(value,label){
  if(typeof value!=='string'||!value.trim())throw new Error(`${label} must be a non-empty string`);
  return value;
}
function digest(value,label){
  if(!SHA.test(value??''))throw new Error(`${label} must be a sha256 digest`);
  return value;
}
function optionalDigest(value,label){
  if(value===null||value===undefined)return null;
  return digest(value,label);
}

// This identity deliberately separates seven independent experimental axes.
// Paths and orchestration details stay outside the identity; callers bind the
// exact bytes they actually rendered into the corresponding hashes.
export function normalizeThemeTestScenario(input){
  if(input?.schema!==THEME_TEST_SCENARIO_SCHEMA)throw new Error(`unknown theme-test scenario schema: ${input?.schema}`);
  const platform=text(input.runtime?.platform,'runtime.platform');
  if(!['wikidot','wikijump'].includes(platform))throw new Error(`unsupported runtime platform: ${platform}`);
  return {
    schema:THEME_TEST_SCENARIO_SCHEMA,
    runtime:{
      platform,
      implementation:text(input.runtime?.implementation,'runtime.implementation'),
      implementation_sha256:digest(input.runtime?.implementation_sha256,'runtime.implementation_sha256'),
      origin:text(input.runtime?.origin,'runtime.origin'),
    },
    branch_profile:{
      id:text(input.branch_profile?.id,'branch_profile.id'),
      locale:text(input.branch_profile?.locale,'branch_profile.locale'),
      site_slug:text(input.branch_profile?.site_slug,'branch_profile.site_slug'),
      site_state_sha256:digest(input.branch_profile?.site_state_sha256,'branch_profile.site_state_sha256'),
    },
    shell_profile:{
      id:text(input.shell_profile?.id,'shell_profile.id'),
      format:text(input.shell_profile?.format,'shell_profile.format'),
      shell_sha256:digest(input.shell_profile?.shell_sha256,'shell_profile.shell_sha256'),
      injection_sha256:digest(input.shell_profile?.injection_sha256,'shell_profile.injection_sha256'),
    },
    baseline:{
      id:text(input.baseline?.id,'baseline.id'),
      css_sha256:digest(input.baseline?.css_sha256,'baseline.css_sha256'),
      component_contract_sha256:digest(input.baseline?.component_contract_sha256,'baseline.component_contract_sha256'),
    },
    theme:{
      id:text(input.theme?.id,'theme.id'),
      css_sha256:digest(input.theme?.css_sha256,'theme.css_sha256'),
      base_css_sha256:optionalDigest(input.theme?.base_css_sha256,'theme.base_css_sha256'),
      source_sha256:digest(input.theme?.source_sha256,'theme.source_sha256'),
      asset_dependency_sha256:digest(input.theme?.asset_dependency_sha256,'theme.asset_dependency_sha256'),
    },
    corpus:{
      id:text(input.corpus?.id,'corpus.id'),
      manifest_sha256:digest(input.corpus?.manifest_sha256,'corpus.manifest_sha256'),
      source_sha256:digest(input.corpus?.source_sha256,'corpus.source_sha256'),
      state_set_sha256:digest(input.corpus?.state_set_sha256,'corpus.state_set_sha256'),
    },
    measurement:{
      id:text(input.measurement?.id,'measurement.id'),
      contract_sha256:digest(input.measurement?.contract_sha256,'measurement.contract_sha256'),
    },
  };
}

export function themeTestScenarioSha(input){
  return crypto.createHash('sha256').update(JSON.stringify(normalizeThemeTestScenario(input))).digest('hex');
}
