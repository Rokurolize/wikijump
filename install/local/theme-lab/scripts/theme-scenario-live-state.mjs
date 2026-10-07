#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {createDeepwellPreviewClient} from '../src/deepwell-preview.mjs';
import {materializeThemeTestScenario} from '../src/theme-test-scenario-config.mjs';
import {verifyThemeScenarioSiteState} from '../src/theme-site-state-live.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const value=name=>{const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:null};
const file=value('--file'),siteSlug=value('--site')??'scpaiueouiuiuiui';
if(!file)throw new Error('usage: theme-scenario-live-state.mjs --file <scenario.json> [--site <slug>]');
const config=JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
const materialized=materializeThemeTestScenario(root,config);
const receipt=await verifyThemeScenarioSiteState({root,materialized,rpcClient:createDeepwellPreviewClient(),siteSlug});
process.stdout.write(JSON.stringify(receipt,null,2)+'\n');
