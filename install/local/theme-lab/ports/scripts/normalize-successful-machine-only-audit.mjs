#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {mergeInteractiveAuditShards,writeInteractiveAuditDelta} from './audit-shard-merge.mjs';

const scriptDir=path.dirname(fileURLToPath(import.meta.url));
const portsDir=path.resolve(scriptDir,'..');
const themeLabDir=path.resolve(portsDir,'..');
const auditArg=process.argv.find(value=>value.startsWith('--audit='))?.slice(8);
for(const arg of process.argv.slice(2))if(!arg.startsWith('--audit='))throw new Error(`unknown argument: ${arg}`);
const auditPath=path.resolve(auditArg??path.join(portsDir,'current-acceptance/artifacts/interactive-visual-audit.json'));
if(!auditPath.startsWith(themeLabDir+path.sep))throw new Error('audit path must remain inside Theme Lab');
await fs.access(auditPath);
const shardDirectory=path.join(path.dirname(auditPath),`${path.basename(auditPath)}.shards`,`normalize-machine-only-${Date.now()}-${process.pid}`);
await fs.mkdir(shardDirectory,{recursive:true});
try{
 await writeInteractiveAuditDelta(shardDirectory,{
  schema:'theme_lab_interactive_audit_delta.v1',
  theme:'visual-gate-policy',engine:'all',viewport:'all',
  records:[],remove_keys:[],normalize_successful_machine_only_visuals:true,
  document_patch:{schema:'scp_jp_interactive_visual_audit.v1'}
 });
 const result=await mergeInteractiveAuditShards({auditPath,shardDirectory,portsDir});
 console.log(JSON.stringify({audit_path:path.relative(themeLabDir,auditPath),...result}));
}catch(error){
 throw error;
}
