#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {materializeThemeTestScenario} from '../src/theme-test-scenario-config.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const index=process.argv.indexOf('--file');
if(index<0||!process.argv[index+1])throw new Error('usage: theme-scenario.mjs --file <scenario-config.json>');
const configPath=path.resolve(process.argv[index+1]);
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
process.stdout.write(JSON.stringify(materializeThemeTestScenario(root,config),null,2)+'\n');
