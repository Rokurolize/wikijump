import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {extractCssReferences,rewriteCssReferences} from './reference-cache.mjs';
export function materializeFrozenCss(cacheDir,url){
 const manifest=JSON.parse(fs.readFileSync(path.join(cacheDir,'manifest.json'),'utf8'));
 const dependencies=[];const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 function bytesFor(url){
  const row=manifest.urls[url];if(!row)throw new Error(`Frozen stylesheet dependency missing: ${url}`);
  const bytes=fs.readFileSync(path.join(cacheDir,'objects',row.digest.slice(0,2),row.digest));
  if(sha(bytes)!==row.digest)throw new Error(`Frozen stylesheet dependency corrupt: ${url}`);
  dependencies.push({url,sha256:row.digest,observed_at:row.fetched_at});return {row,bytes};
 }
 function cssFor(url,active=new Set()){
  if(active.has(url))throw new Error(`Cyclic frozen stylesheet import: ${url}`);
  const {bytes}=bytesFor(url);let text=bytes.toString('utf8');
  const {imports,assets}=extractCssReferences(text,url);
  for(const item of imports)text=text.replace(item.raw,cssFor(item.url,new Set([...active,url])));
  const map=new Map();for(const item of assets){const {row,bytes}=bytesFor(item.url);map.set(item.url,`data:${row.content_type.split(';')[0]};base64,${bytes.toString('base64')}`)}
  return rewriteCssReferences(text,url,map);
 }
 return {css:cssFor(url)+'\n',dependencies};
}
