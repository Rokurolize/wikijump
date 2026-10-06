import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const importPatterns=[
  /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"](\.[^'"]+)['"]/gu,
  /\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/gu,
];
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

function resolveLocal(from,specifier){
  const raw=path.resolve(path.dirname(from),specifier);
  const candidates=path.extname(raw)?[raw]:[raw,`${raw}.mjs`,`${raw}.js`,`${raw}.json`];
  return candidates.find(file=>fs.existsSync(file)&&fs.statSync(file).isFile())??null;
}

export function localModuleClosure(entry,{root=path.dirname(fileURLToPath(entry))}={}){
  const rootPath=fs.realpathSync(root),first=path.resolve(fileURLToPath(entry));
  const pending=[first],seen=new Set(),rows=[];
  while(pending.length){
    const file=pending.pop();
    if(seen.has(file))continue;
    if(file!==rootPath&&!file.startsWith(rootPath+path.sep))throw new Error(`local module dependency escapes contract root: ${file}`);
    const actual=fs.realpathSync(file);
    if(actual!==rootPath&&!actual.startsWith(rootPath+path.sep))throw new Error(`local module dependency escapes contract root: ${file}`);
    seen.add(file);
    const bytes=fs.readFileSync(actual),text=bytes.toString('utf8');
    rows.push({path:path.relative(rootPath,file).replaceAll(path.sep,'/'),sha256:digest(bytes)});
    if(!/\.(?:mjs|js)$/u.test(file))continue;
    for(const pattern of importPatterns){
      pattern.lastIndex=0;
      for(const match of text.matchAll(pattern)){
        const dependency=resolveLocal(file,match[1]);
        if(dependency&&!seen.has(dependency))pending.push(dependency);
      }
    }
  }
  return rows.sort((a,b)=>a.path.localeCompare(b.path));
}

export function localModuleClosureSha256(entry,options){
  return digest(Buffer.from(JSON.stringify(localModuleClosure(entry,options))));
}
