#!/usr/bin/env node
// Resolve explicitly declared runtime theme stylesheet entrypoints from the
// existing content-addressed acquisition cache. This is an offline build step:
// missing cache entries fail closed instead of triggering a network request.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractCssReferences, rewriteCssReferences} from '../src/reference-cache.mjs';

const portsDir=path.dirname(fileURLToPath(import.meta.url));
const selected=new Set(process.argv.slice(2).filter(arg=>arg.startsWith('--theme=')).map(arg=>arg.slice(8)));
const cacheRoot=path.join(os.homedir(),'.cache/wikijump/theme-lab');
const cacheManifest=JSON.parse(await fs.readFile(path.join(cacheRoot,'manifest.json'),'utf8'));
const byUrl=new Map();
for(const [url,entry] of Object.entries(cacheManifest.urls)){
  byUrl.set(new URL(url).href,entry);
  if(entry.final_url)byUrl.set(new URL(entry.final_url).href,entry);
}
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function cacheEntry(url){
  const parsed=new URL(url);const exact=byUrl.get(parsed.href);if(exact)return exact;
  parsed.hash='';return byUrl.get(parsed.href);
}
async function cachedBytes(url){
  const entry=cacheEntry(url);
  if(!entry)throw new Error(`No captured cache object for stylesheet dependency ${url}`);
  const file=path.join(cacheRoot,'objects',entry.digest.slice(0,2),entry.digest);
  const bytes=await fs.readFile(file);
  if(digest(bytes)!==entry.digest)throw new Error(`Cache content hash mismatch for ${url}`);
  return {entry,bytes};
}
function assetExtension(url){
  const extension=path.extname(new URL(url).pathname).toLowerCase();
  if(!/^\.[a-z0-9]{2,5}$/u.test(extension))throw new Error(`Cannot classify cached stylesheet asset ${url}`);
  return extension;
}
async function resolveStylesheet(url,seen,assets,depth=0){
  if(depth>8)throw new Error(`CSS import depth exceeded at ${url}`);
  const {entry,bytes}=await cachedBytes(url);
  if(!/text\/css/iu.test(entry.content_type??''))throw new Error(`Declared theme stylesheet is not CSS: ${url}`);
  if(seen.has(entry.digest))return '';
  seen.add(entry.digest);
  const baseUrl=entry.final_url??url;
  let css=bytes.toString('utf8').replace(/^\s*@charset\s+["'][^"']+["']\s*;\s*/iu,'');
  const imports=extractCssReferences(css,baseUrl).imports;
  const importPattern=/@import\s+(?:url\(\s*)?["']?([^"')]+)["']?\s*\)?([^;]*);/giu;
  const replacements=[];
  let match;
  while((match=importPattern.exec(css))!==null){
    const importUrl=new URL(match[1],baseUrl).href;
    if(!imports.some(item=>item.url===importUrl))continue;
    const imported=await resolveStylesheet(importUrl,seen,assets,depth+1);
    const media=match[2].trim();
    const body=media?`@media ${media}{${imported}}`:imported;
    replacements.push({raw:match[0],body});
  }
  for(const replacement of replacements)css=css.replace(replacement.raw,replacement.body);
  const refs=extractCssReferences(css,baseUrl);
  const localByUrl=new Map();
  for(const assetRef of refs.assets){
    if(/^\/[0-9a-f]{64}\.[a-z0-9]{2,5}$/iu.test(assetRef.raw))continue;
    const cached=await cachedBytes(assetRef.url);
    const extension=assetExtension(assetRef.url);
    const name=`${cached.entry.digest}.${extension.slice(1)}`;
    const target=path.join(portsDir,'shared-replay-assets',name);
    await fs.mkdir(path.dirname(target),{recursive:true});
    try{const existing=await fs.readFile(target);if(digest(existing)!==cached.entry.digest)throw new Error(`Existing shared asset hash mismatch: ${name}`)}catch(error){if(error.code!=='ENOENT')throw error;await fs.writeFile(target,cached.bytes)}
    const absolute=new URL(assetRef.url);absolute.hash='';
    localByUrl.set(assetRef.url,`/${name}`);
    localByUrl.set(absolute.href,`/${name}`);
    assets.set(name,{path:`install/local/theme-lab/ports/shared-replay-assets/${name}`,sha256:cached.entry.digest,source_url:assetRef.url,bytes:cached.bytes.length});
  }
  css=rewriteCssReferences(css,baseUrl,localByUrl);
  return css;
}

const themeDirs=await fs.readdir(portsDir,{withFileTypes:true});
const results=[];
for(const item of themeDirs){
  if(!item.isDirectory()||selected.size&&!selected.has(item.name))continue;
  const dir=path.join(portsDir,item.name);let manifest;
  try{manifest=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'))}catch{continue}
  const entrypoints=manifest.interactive_acceptance?.active_stylesheets??[];
  if(!entrypoints.length)continue;
  const seen=new Set(),assets=new Map(),parts=[];
  for(const item of entrypoints){parts.push(await resolveStylesheet(item.url,seen,assets))}
  const css=parts.join('\n');const cssSha=digest(Buffer.from(css));
  await fs.writeFile(path.join(dir,'candidate-base.css'),css);
  manifest.interactive_acceptance.resolved_stylesheet={
    path:`install/local/theme-lab/ports/${item.name}/candidate-base.css`,
    sha256:cssSha,
    css_objects:[...seen].sort(),
    assets:[...assets.values()].sort((a,b)=>a.path.localeCompare(b.path)),
    network_during_resolution:0,
  };
  await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const receiptPath=path.join(dir,'receipt.json');
  try{const receipt=JSON.parse(await fs.readFile(receiptPath,'utf8'));receipt.candidate_base_css_path=manifest.interactive_acceptance.resolved_stylesheet.path;receipt.candidate_base_css_sha256=cssSha;receipt.candidate_base_css_network_requests=0;await fs.writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n')}catch(error){if(error.code!=='ENOENT')throw error}
  results.push({theme:item.name,sha256:cssSha,bytes:Buffer.byteLength(css),css_objects:seen.size,assets:assets.size,network_requests:0});
}
console.log(JSON.stringify({themes:results.length,results}));
