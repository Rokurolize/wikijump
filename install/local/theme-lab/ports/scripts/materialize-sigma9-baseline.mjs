#!/usr/bin/env node
// Reproduce the frozen production SCP-JP baseline without network acquisition.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {materializeFrozenCss} from '../../src/frozen-css.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const cache=path.join(root,'ports/authority-evidence/replay');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const url='https://scp-jp.github.io/files/util/main/styles/sigma-9.min.css';
const {css,dependencies}=materializeFrozenCss(cache,url);
const out=path.join(root,'fixtures/scp-jp-sigma9-offline.css');
const receipt=JSON.stringify({schema:'theme_lab_frozen_baseline.v1',url,css_sha256:sha(css),dependencies,public_writes:0},null,2)+'\n';
if(process.argv.includes('--check')){
 if(fs.readFileSync(out,'utf8')!==css||fs.readFileSync(out.replace('.css','.json'),'utf8')!==receipt)throw new Error('Frozen SCP-JP baseline is stale');
}else {fs.writeFileSync(out,css);fs.writeFileSync(out.replace('.css','.json'),receipt)}
console.log(JSON.stringify({status:'pass',dependencies:dependencies.length,css_sha256:sha(css)}));
