#!/usr/bin/env node
import {loadThemeLabAuthenticatedStorage} from '../src/authenticated-storage.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {runThemeScenarioMatrix} from '../src/theme-test-matrix.mjs';
import {themeScenarioConfigForPackage} from '../src/theme-scenario-factory.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);const value=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:null};
for(const key of ['--package','--generation','--site-state-receipt','--authenticated-storage','--output'])if(!value(key))throw new Error(`Missing ${key}`);
const packageName=value('--package'),generation=value('--generation');
const config=themeScenarioConfigForPackage(root,{generation,packageName});
const siteStateReceipt=JSON.parse(fs.readFileSync(path.resolve(value('--site-state-receipt')),'utf8'));
const {storage:authenticatedStorage}=await loadThemeLabAuthenticatedStorage(value('--authenticated-storage'));
const renderedShell=value('--rendered-shell')?JSON.parse(fs.readFileSync(path.resolve(value('--rendered-shell')),'utf8')):null;
const browserRoot=value('--browser-root')?path.resolve(value('--browser-root')):path.resolve(root,'../../../framerail');
const result=await runThemeScenarioMatrix({root,config,siteStateReceipt,renderedShell,browserRoot,pathPrefix:`/tmp/theme-lab-canonical-${packageName}-${generation}`,sessionStorageStates:{anonymous:null,authenticated:authenticatedStorage}});
fs.writeFileSync(path.resolve(value('--output')),JSON.stringify(result,null,2)+'\n');
process.stdout.write(JSON.stringify({package:packageName,generation,scenario_sha256:result.scenario_sha256,matrix_receipt_sha256:result.matrix_receipt_sha256,canonical_acceptance_eligible:result.canonical_acceptance_eligible,blockers:result.blockers})+'\n');
