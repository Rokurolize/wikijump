import crypto from 'node:crypto';

import {normalizeThemeTestScenario,themeTestScenarioSha} from './theme-test-scenario.mjs';

const AXES=['runtime','branch_profile','shell_profile','baseline','theme','measurement'];
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function compareThemeTestScenarios(leftInput,rightInput,{allowedDifferences=[]}={}){
  const left=normalizeThemeTestScenario(leftInput),right=normalizeThemeTestScenario(rightInput);
  const allowed=new Set(allowedDifferences);
  for(const axis of allowed)if(!AXES.includes(axis))throw new Error(`unsupported allowed scenario difference: ${axis}`);
  if(sha(left.corpus)!==sha(right.corpus))throw new Error('canonical corpus identity differs; theme comparisons require identical corpus and state-set bytes');
  const differences=[];
  for(const axis of AXES)if(sha(left[axis])!==sha(right[axis]))differences.push(axis);
  const unexpected=differences.filter(axis=>!allowed.has(axis));
  if(unexpected.length)throw new Error(`unexpected scenario differences: ${unexpected.join(', ')}`);
  const unused=[...allowed].filter(axis=>!differences.includes(axis));
  const contract={
    schema:'theme_lab_test_comparison.v1',
    left_scenario_sha256:themeTestScenarioSha(left),
    right_scenario_sha256:themeTestScenarioSha(right),
    corpus_sha256:sha(left.corpus),
    allowed_differences:[...allowed].sort(),
    observed_differences:differences,
    unused_allowed_differences:unused.sort(),
  };
  return {...contract,comparison_sha256:sha(contract)};
}
