#!/usr/bin/env node
// Explicit, offline repair of a flattened input from its reviewed source.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {candidatePageTags,materializeDefaultCss} from '../../src/runtime-theme-css.mjs';
import {digest} from '../../src/adaptation-authority.mjs';

const ports=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args=process.argv.slice(2);
if(args.some(arg=>arg!=='--write'&&!/^--theme=[a-z0-9-]+$/u.test(arg)))throw new Error('Use --theme=slug [--write]');
const selected=args.filter(arg=>arg.startsWith('--theme=')).map(arg=>arg.slice(8));
if(!selected.length)throw new Error('Select the reviewed package explicitly with --theme=slug');
const ledgerFile=path.join(ports,'adaptation-authority.json');
const ledger=JSON.parse(fs.readFileSync(ledgerFile));
// Validate every selected input before writing any file.
const repairs=selected.map(name=>{
  const pkg=ledger.packages[name];
  const sourceFile='maintenance/authority-base.wikidot.txt';
  if(!pkg?.inputs[sourceFile])throw new Error(`${name}: no authority-bound publication base`);
  const dir=path.join(ports,name),source=fs.readFileSync(path.join(dir,sourceFile),'utf8');
  if(digest(source)!==pkg.inputs[sourceFile])throw new Error(`${name}: unreviewed publication base`);
  const previous=fs.readFileSync(path.join(dir,'candidate-input.css'));
  if(digest(previous)!==pkg.inputs['candidate-input.css'])throw new Error(`${name}: unreviewed current input`);
  const disposition=pkg.blocks.find(row=>row.origin==='preserved-source');
  if(!disposition||disposition.sha256!==digest(previous))throw new Error(`${name}: missing source disposition`);
  const sourcePageTags=candidatePageTags(JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),source);
  const {css,modules}=materializeDefaultCss(source,{sourcePageTags});
  return {name,pkg,dir,sourceFile,source,previous,disposition,css,modules,sourcePageTags};
});
for(const repair of repairs){
  const {name,pkg,dir,sourceFile,source,previous,disposition,css,modules,sourcePageTags}=repair;
  const changed=digest(previous)!==digest(css);
  console.log(JSON.stringify({theme:name,changed,modules:modules.length,input_sha256:digest(css),write:args.includes('--write')}));
  if(!args.includes('--write')||!changed)continue;
  const receipt={schema:'theme_lab_published_runtime_css_materialization.v1',source_file:sourceFile,source_sha256:digest(source),runtime_active_tags:[],modules:modules.map(row=>({index:row.index,css_sha256:digest(row.css)})),previous_input_sha256:digest(previous),input_sha256:digest(css),public_writes:0,external_requests:0,rationale:'Materialize the exact active default article CSS modules from the already authority-bound publishable localization base. Exclude commented/false variant and theme-page presentation modules; source component includes and certified overlays remain their separate layers.'};
  if(!modules.length)receipt.source_page_tags=sourcePageTags;
  const receiptFile='runtime-css-materialization.json',bytes=JSON.stringify(receipt,null,2)+'\n';
  fs.writeFileSync(path.join(dir,receiptFile),bytes);
  fs.writeFileSync(path.join(dir,'candidate-input.css'),css);
  pkg.inputs['candidate-input.css']=digest(css);
  pkg.inputs[receiptFile]=digest(bytes);
  disposition.sha256=digest(css);
  disposition.rationale=receipt.rationale;
  disposition.evidence=[...(disposition.evidence??[]).filter(row=>row.path!==`${name}/${receiptFile}`),{path:`${name}/${receiptFile}`,sha256:digest(bytes),decision_authority:'FROZEN_WIKIDOT_SOURCE_MODULES'}];
}
if(args.includes('--write'))fs.writeFileSync(ledgerFile,JSON.stringify(ledger,null,2)+'\n');
