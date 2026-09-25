#!/usr/bin/env node
// Build resumable image-review units from current audit evidence. Exact-byte
// duplicates share one visual inspection unit; each source row remains listed
// so action traces, state coverage, and provenance still receive separate checks.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {candidateIdentity} from './candidate-identity.mjs';

const portsDir=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const auditPath=path.join(portsDir,'interactive-visual-audit.json');
const args=new Map(process.argv.slice(2).filter(arg=>arg.startsWith('--')).map(arg=>{const [key,...rest]=arg.slice(2).split('=');return[key,rest.join('=')]}));
const selected=(name,value)=>!args.has(name)||args.get(name).split(',').includes(value);
const audit=JSON.parse(await fs.readFile(auditPath,'utf8'));
const groups=new Map();
const stale=[],missing=[];
const currentThemeIdentity=new Map();
const knownThemeIdentities=new Map();
for(const row of audit.records??[]){const values=knownThemeIdentities.get(row.theme)??new Set();if(row.candidate_sha256)values.add(row.candidate_sha256);knownThemeIdentities.set(row.theme,values)}
for(const row of audit.records??[]){
  if(!selected('theme',row.theme)||!selected('engine',row.browser_engine)||!selected('viewport',row.viewport))continue;
  if(!row.screenshot){missing.push({theme:row.theme,engine:row.browser_engine,viewport:row.viewport,surface:row.surface,state:row.state,reason:'no screenshot path'});continue}
  const filename=path.join(portsDir,row.screenshot);
  let bytes;try{bytes=await fs.readFile(filename)}catch{missing.push({theme:row.theme,engine:row.browser_engine,viewport:row.viewport,surface:row.surface,state:row.state,path:row.screenshot,reason:'screenshot missing'});continue}
  const hash=crypto.createHash('sha256').update(bytes).digest('hex');
  if(hash!==row.screenshot_sha256){stale.push({theme:row.theme,engine:row.browser_engine,viewport:row.viewport,surface:row.surface,state:row.state,path:row.screenshot,expected:row.screenshot_sha256,actual:hash});continue}
  let current=currentThemeIdentity.get(row.theme);
  if(!current){
    const dir=path.join(portsDir,row.theme);
    const css=await fs.readFile(path.join(dir,'candidate.css')).catch(()=>null);
    const base=await fs.readFile(path.join(dir,'candidate-base.css')).catch(()=>Buffer.alloc(0));
    const source=await fs.readFile(path.join(dir,'candidate.wikidot.source.txt')).catch(()=>fs.readFile(path.join(dir,'candidate.wikidot.txt')).catch(()=>Buffer.alloc(0)));
    if(!css){current={candidate_sha256:null,candidate_source_sha256:null};}
    else {
      const {candidateSha}=candidateIdentity(css,base,knownThemeIdentities.get(row.theme)??new Set());
      current={candidate_sha256:candidateSha,candidate_source_sha256:crypto.createHash('sha256').update(source).digest('hex')};
    }
    currentThemeIdentity.set(row.theme,current);
  }
  if(row.candidate_sha256!==current.candidate_sha256||row.candidate_source_sha256!==current.candidate_source_sha256){stale.push({theme:row.theme,engine:row.browser_engine,viewport:row.viewport,surface:row.surface,state:row.state,path:row.screenshot,reason:'candidate source or CSS identity differs from current port',expected_candidate_sha256:row.candidate_sha256,current_candidate_sha256:current.candidate_sha256,expected_source_sha256:row.candidate_source_sha256,current_source_sha256:current.candidate_source_sha256});continue}
  const group=groups.get(hash)??{screenshot_sha256:hash,screenshot:row.screenshot,byte_length:bytes.length,records:[]};
  group.records.push({theme:row.theme,browser_engine:row.browser_engine,viewport:row.viewport,surface:row.surface,state:row.state,candidate_sha256:row.candidate_sha256,candidate_source_sha256:row.candidate_source_sha256,environment_contract_sha256:row.environment_contract_sha256,action_sequence:row.action_sequence,classification:row.classification,reviewed_after_last_change:row.reviewed_after_last_change});
  groups.set(hash,group);
}
const worklist=[...groups.values()].sort((a,b)=>a.records[0].theme.localeCompare(b.records[0].theme)||a.records[0].browser_engine.localeCompare(b.records[0].browser_engine)||a.records[0].viewport.localeCompare(b.records[0].viewport)||a.records[0].surface.localeCompare(b.records[0].surface));
const result={schema:'theme_lab_visual_review_worklist.v1',generated_at:new Date().toISOString(),source:auditPath,filters:Object.fromEntries(args),rows:worklist.reduce((n,group)=>n+group.records.length,0),unique_images:worklist.length,deduplicated_rows:worklist.reduce((n,group)=>n+group.records.length-1,0),missing,stale,groups:worklist};
if(args.has('summary')){
 const byTheme={};
 for(const group of worklist)for(const row of group.records){const item=byTheme[row.theme]??={rows:0,unique_images:0,unreviewed:0,_hashes:new Set()};item.rows++;item._hashes.add(group.screenshot_sha256);if(!row.reviewed_after_last_change)item.unreviewed++}
 for(const item of Object.values(byTheme)){item.unique_images=item._hashes.size;delete item._hashes}
 result.groups=undefined;
 result.theme_summary=byTheme;
 result.invalid_counts={missing:missing.length,stale:stale.length};
}
console.log(JSON.stringify(result,null,2));
