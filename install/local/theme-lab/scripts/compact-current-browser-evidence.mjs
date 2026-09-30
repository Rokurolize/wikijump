#!/usr/bin/env node
// Preserve the exact pre-compaction document in a hash-bound compressed archive.
// Screenshots, safety results, measured geometry and current identities stay intact.
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import {gzipSync} from 'node:zlib';import {fileURLToPath} from 'node:url';
import {withAuditLock} from '../ports/scripts/audit-lock.mjs';import {compactComputedResources} from '../ports/scripts/capture-audit-records.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const file=path.resolve(process.argv[2]??'');
if(!['ports/current-acceptance/','sigma10-migration/current-campaign/'].some(prefix=>file.startsWith(path.join(root,prefix))))throw new Error('Only current campaign diagnostic evidence may be compacted');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
await withAuditLock(file,async()=>{
 const original=await fs.readFile(file),data=JSON.parse(original);
 const dir=path.join(path.dirname(file),'archives');await fs.mkdir(dir,{recursive:true});
 const archived=gzipSync(original,{level:9}),archive=path.join(dir,sha(original)+'.json.gz');await fs.writeFile(archive,archived,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error});
 data.records=(data.records??[]).map(row=>({...row,visual_diagnostics:compactComputedResources(row.visual_diagnostics)}));
 data.source_archives=[...(data.source_archives??[]),{path:path.relative(root,archive),sha256:sha(archived),uncompressed_sha256:sha(original),bytes:original.length,reason:'Exact pre-compaction evidence; inline computed image bytes are represented by their content digest in the current document.'}];
 const temporary=file+'.compact.tmp';await fs.writeFile(temporary,JSON.stringify(data)+'\n');await fs.rename(temporary,file);
 console.log(JSON.stringify({records:data.records.length,original_bytes:original.length,compacted_bytes:(await fs.stat(file)).size,archive:path.relative(root,archive)}));
});
