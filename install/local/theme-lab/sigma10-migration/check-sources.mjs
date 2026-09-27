#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
if(process.argv.length>2&&!process.argv.includes('--check'))throw new Error('usage: node check-sources.mjs --check');
const manifest=JSON.parse(await fs.readFile(path.join(here,'source-manifest.json'),'utf8'));
if(manifest.schema!=='theme_lab_sigma10_sources.v1')throw new Error('invalid Sigma-10 source manifest');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const normalizedInclude=value=>value.trim().replace(/^:/u,'').toLowerCase();
const stripComments=source=>source.replace(/\[!--[\s\S]*?--\]/gu,'');
const includePattern=/\[\[include\s+([^\]|\s]+)/giu;

for(const [identity,entry] of Object.entries(manifest.pages)){
  const bytes=await fs.readFile(path.join(here,entry.file));
  if(bytes.length!==entry.bytes||sha(bytes)!==entry.sha256)throw new Error(`Sigma-10 source snapshot differs: ${identity}`);
  const source=stripComments(bytes.toString('utf8'));
  const actual=[...source.matchAll(includePattern)].map(match=>normalizedInclude(match[1])).sort();
  const unresolved=(manifest.excluded_or_unresolved??[])
    .filter(item=>item.referenced_by===identity&&item.owner!=='no-action-commented-source')
    .map(item=>normalizedInclude(item.identity));
  const expected=[...(entry.include_dependencies??[]).map(normalizedInclude),...unresolved].sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error(`Sigma-10 transitive include graph changed: ${identity}`);
}

for(const item of manifest.history??[]){
  const bytes=await fs.readFile(path.join(here,item.file));
  if(sha(bytes)!==item.sha256)throw new Error(`Sigma-10 historical source bytes differ: ${item.file}`);
}

for(const contract of manifest.external_runtime_contracts??[]){
  const entry=manifest.pages[contract.source];
  if(!entry)throw new Error(`external runtime contract has no frozen source: ${contract.source}`);
  const source=await fs.readFile(path.join(here,entry.file),'utf8');
  const authority=new URL(contract.url_template.replaceAll('{$lang}','jp').replaceAll('{$community}','scp').replaceAll('%%name%%','fixture').replaceAll('{$priority}','0').replaceAll('{$theme}','https://example.invalid/theme.css').replaceAll('{$css}',''));
  const embeddedUrls=[...source.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/giu)].map(match=>match[1]);
  const referencesAuthority=embeddedUrls.some(value=>{
    try{
      const parsed=new URL(value,'https://fixture.invalid');
      return parsed.hostname===authority.hostname&&parsed.pathname===authority.pathname;
    }catch{return false}
  });
  if(authority.protocol!=='https:'||authority.hostname!=='interwiki.scp-jp.org'||authority.username||authority.password||authority.port||!referencesAuthority)throw new Error(`external runtime contract changed: ${contract.source}`);
}

console.log(JSON.stringify({
  mode:'check',
  pages:Object.keys(manifest.pages).length,
  unresolved_or_excluded:(manifest.excluded_or_unresolved??[]).length,
  external_runtime_contracts:(manifest.external_runtime_contracts??[]).length,
}));
