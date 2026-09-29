#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertPublishablePackage} from '../../src/adaptation-authority.mjs';
const ports=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ledger=JSON.parse(fs.readFileSync(path.join(ports,'adaptation-authority.json'),'utf8'));
const results=Object.keys(ledger.packages).map(name=>assertPublishablePackage(name,{checkOutputs:true}));
console.log(JSON.stringify({status:'pass',packages:results.length,blocks:results.reduce((n,r)=>n+r.audited,0),publishable_without_authority:0,results},null,2));
