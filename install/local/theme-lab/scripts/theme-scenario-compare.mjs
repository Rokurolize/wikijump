#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {materializeThemeTestScenario} from '../src/theme-test-scenario-config.mjs';
import {compareThemeTestScenarios} from '../src/theme-test-comparison.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'..');
const value=name=>{const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:null};
const leftPath=value('--left'),rightPath=value('--right');
if(!leftPath||!rightPath)throw new Error('usage: theme-scenario-compare.mjs --left <scenario.json> --right <scenario.json> [--allow runtime,branch_profile,baseline,theme]');
const load=file=>materializeThemeTestScenario(root,JSON.parse(fs.readFileSync(path.resolve(file),'utf8')));
const allowed=(value('--allow')??'').split(',').map(item=>item.trim()).filter(Boolean);
const left=load(leftPath),right=load(rightPath);
process.stdout.write(JSON.stringify({left,right,comparison:compareThemeTestScenarios(left.scenario,right.scenario,{allowedDifferences:allowed})},null,2)+'\n');
