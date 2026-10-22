#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {createDeepwellPreviewClient} from '../src/deepwell-preview.mjs';
import {materializeThemeTestScenario} from '../src/theme-test-scenario-config.mjs';
import {verifyThemeScenarioSiteState} from '../src/theme-site-state-live.mjs';
import {themeScenarioConfigForPackage} from '../src/theme-scenario-factory.mjs';
import {runContractArgument} from '../src/current-run-contract-option.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const value=name=>{const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:null};
const file=value('--file'),siteSlug=value('--site')??'scpaiueouiuiuiui',runContract=runContractArgument(process.argv.slice(2)),rpcUrl=value('--rpc-url')??process.env.DEEPWELL_RPC_URL,packageName=value('--package'),generation=value('--generation');
if(file&&(packageName||generation))throw new Error('use either --file or --package/--generation, not both');
if((packageName===null)!==(generation===null))throw new Error('--package and --generation must be supplied together');
if(!file&&!packageName)throw new Error('usage: theme-scenario-live-state.mjs --file <scenario.json> [--site <slug>] OR --package <slug> --generation <sigma9|sigma10> [--run-contract <path>]');
if(runContract&&!packageName)throw new Error('--run-contract requires --package and --generation');
const config=packageName?themeScenarioConfigForPackage(root,{generation,packageName,runContract}):JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
const materialized=materializeThemeTestScenario(root,config);
const receipt=await verifyThemeScenarioSiteState({root,materialized,rpcClient:createDeepwellPreviewClient({...(rpcUrl?{rpcUrl}:{}),rpcToken:process.env.DEEPWELL_RPC_TOKEN}),siteSlug});
process.stdout.write(JSON.stringify(receipt,null,2)+'\n');
