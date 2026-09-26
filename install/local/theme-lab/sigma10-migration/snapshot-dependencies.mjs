#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  assertFetchableUrl,
  assertPublicDns,
  extractCssReferences,
  rewriteCssReferences,
} from '../src/reference-cache.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const sharedAssetsDir=path.resolve(here,'../ports/shared-replay-assets');
const manifestPath=path.join(here,'dependency-manifest.json');
const outputPath=path.join(here,'sigma10-offline.css');
const refresh=process.argv.includes('--refresh');
const check=process.argv.includes('--check');
if(refresh===check)throw new Error('use exactly one of --refresh or --check');

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const extension=(url,type)=>{
  const pathname=new URL(url).pathname;
  const ext=path.extname(pathname).toLowerCase();
  if(ext&&ext.length<=8)return ext;
  if(/text\/css/iu.test(type??''))return '.css';
  if(/font\/woff2/iu.test(type??''))return '.woff2';
  if(/font\/woff/iu.test(type??''))return '.woff';
  if(/image\/png/iu.test(type??''))return '.png';
  if(/image\/svg/iu.test(type??''))return '.svg';
  return '.bin';
};

async function composeSource(){
  const enBytes=await fs.readFile(path.join(here,'sources/en-sigma.css'));
  const jpBytes=await fs.readFile(path.join(here,'sources/jp-localization.css'));
  if(sha(enBytes)!=='fa5a62082d48c54c807a2060efb3e34a383b3e87de5060d648f9550dc12351c1')throw new Error('frozen upstream Sigma-10 CSS differs from repository provenance');
  if(sha(jpBytes)!=='cf4ea3edd7a619cb0a581c4d4f7e9e3cb3668b243c9646759072ecf56f242e9d')throw new Error('frozen JP Sigma-10 localization differs from repository provenance');
  const en=enBytes.toString('utf8');
  const jp=jpBytes.toString('utf8');
  return `${en.replaceAll('cdn.scpwiki.com/theme/en','scp-jp.github.io')}\n${jp}`;
}

const sigmaRepository={
  url:'https://github.com/KanekoLiku/sigma',
  commit:'2bfcb97451695d99e8d056c3ac40ec954e005636',
  upstream_url:'https://github.com/scpwiki/sigma',
  upstream_commit:'84d8171abbeb5cc0b4e6c2f80ef553e08a053359',
};
const cssSources={
  upstream_sigma_css:{path:'sources/en-sigma.css',sha256:'fa5a62082d48c54c807a2060efb3e34a383b3e87de5060d648f9550dc12351c1',source_repository:sigmaRepository.upstream_url,source_commit:sigmaRepository.upstream_commit,source_path:'sigma.css'},
  jp_localization_css:{path:'sources/jp-localization.css',sha256:'cf4ea3edd7a619cb0a581c4d4f7e9e3cb3668b243c9646759072ecf56f242e9d',source_repository:sigmaRepository.url,source_commit:sigmaRepository.commit,source_path:'localization.css'},
};
const repoAssets=new Map([
  ['https://scp-jp.github.io/sigma/fonts/RedactRect.woff2',{sha256:'b432066558f2c1a3e79c8e97607d966c8db473f4a8f6521f79bcfb16c9d8bd23',source_path:'origin/fonts/RedactRect.woff2'}],
  ['https://scp-jp.github.io/sigma/fonts/Sans-Normalcy.woff2',{sha256:'e837f75abd3f971413d6edbd30a04937f656d06fd7ee95e7953368ef3454f254',source_path:'origin/fonts/Sans-Normalcy.woff2'}],
  ['https://scp-jp.github.io/sigma/images/body_bg.png',{sha256:'aa602c40276279d9b8e782b8c4d1e466d51e5349dbe55d1756db93976584bcab',source_path:'origin/images/body_bg.png'}],
  ['https://scp-jp.github.io/sigma/images/body_bg.svg',{sha256:'4c67b34b1b269e3a78976d3fee315d9b21d4695cdf880d25aa737f1608367a0f',source_path:'origin/images/body_bg.svg'}],
  ['https://scp-jp.github.io/sigma/images/header-logo.svg',{sha256:'fcd9f75940109475f878f0702d7eb0e1c55cd461369244c86203bb032b6dbe31',source_path:'origin/images/header-logo.svg'}],
  ['https://scp-jp.github.io/sigma/images/header-logo-pride.svg',{sha256:'134bc6fe6bb5d5661ee2bbef71cc79c19c079a4190a3887dab5fd84c0ea5d924',source_path:'origin/images/header-logo-pride.svg'}],
  ['https://scp-jp.github.io/sigma/images/header-logo-trans.svg',{sha256:'944ac8846fa9acae5e95f116f94e5ae066e9755e2482701a4951bbe09f437a7e',source_path:'origin/images/header-logo-trans.svg'}],
]);

function assetName(digest,url,type){return `${digest}${extension(url,type)}`}
function sharedHref(name){return `/${name}`}

async function verifyRepoAssets(){
  const verified={};
  for(const [url,metadata] of repoAssets){
    const name=assetName(metadata.sha256,url);
    const bytes=await fs.readFile(path.join(sharedAssetsDir,name));
    if(sha(bytes)!==metadata.sha256)throw new Error(`Sigma-10 repository asset hash mismatch: ${url}`);
    verified[url]={...metadata,asset_file:name,bytes:bytes.length,source_repository:sigmaRepository.upstream_url,source_commit:sigmaRepository.upstream_commit};
  }
  return verified;
}

async function refreshDependencies(rootCss){
  await fs.mkdir(sharedAssetsDir,{recursive:true});
  const repositoryAssets=await verifyRepoAssets();
  const entries=new Map();
  const active=new Set();
  const fetchOne=async url=>{
    if(repositoryAssets[url])return {url,local:sharedHref(repositoryAssets[url].asset_file),repository_asset:true};
    if(entries.has(url))return entries.get(url);
    if(active.has(url))throw new Error(`cyclic Sigma-10 CSS dependency is not supported: ${url}`);
    active.add(url);
    assertFetchableUrl(url);
    await assertPublicDns(url);
    const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(15_000)});
    if(!response.ok)throw new Error(`Sigma-10 dependency fetch failed (${response.status}): ${url}`);
    const finalUrl=response.url;
    const contentType=response.headers.get('content-type')??'application/octet-stream';
    const original=Buffer.from(await response.arrayBuffer());
    if(original.length>8*1024*1024)throw new Error(`Sigma-10 dependency exceeds 8 MiB: ${url}`);
    let stored=original;
    const childUrls=[];
    if(/text\/css/iu.test(contentType)||/\.css(?:$|[?#])/iu.test(finalUrl)){
      const text=original.toString('utf8');
      const {imports,assets}=extractCssReferences(text,finalUrl);
      const localMap=new Map();
      for(const child of [...imports,...assets]){
        const entry=await fetchOne(child.url);
        childUrls.push(child.url);
        localMap.set(child.url,entry.repository_asset?entry.local:sharedHref(entry.asset_file));
      }
      stored=Buffer.from(rewriteCssReferences(text,finalUrl,localMap));
    }
    const storedSha=sha(stored);
    const assetFile=assetName(storedSha,finalUrl,contentType);
    await fs.writeFile(path.join(sharedAssetsDir,assetFile),stored);
    const entry={url,final_url:finalUrl,content_type:contentType,source_sha256:sha(original),source_bytes:original.length,stored_sha256:storedSha,stored_bytes:stored.length,asset_file:assetFile,dependencies:[...new Set(childUrls)].sort()};
    entries.set(url,entry);active.delete(url);return entry;
  };
  const {imports,assets}=extractCssReferences(rootCss,'https://sigma10.local/root.css');
  const rootMap=new Map(Object.entries(repositoryAssets).map(([url,metadata])=>[url,sharedHref(metadata.asset_file)]));
  for(const item of [...imports,...assets]){
    const entry=await fetchOne(item.url);
    rootMap.set(item.url,entry.repository_asset?entry.local:sharedHref(entry.asset_file));
  }
  const output=rewriteCssReferences(rootCss,'https://sigma10.local/root.css',rootMap);
  const manifest={
    schema:'theme_lab_sigma10_dependencies.v2',
    acquired_at:new Date().toISOString(),
    sigma_repository:sigmaRepository,
    css_sources:cssSources,
    root_source_sha256:sha(Buffer.from(rootCss)),
    offline_css_sha256:sha(Buffer.from(output)),
    repository_assets:repositoryAssets,
    entries:Object.fromEntries([...entries].sort(([a],[b])=>a.localeCompare(b))),
  };
  await fs.writeFile(outputPath,output);
  await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}

async function checkSnapshot(rootCss){
  const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  if(manifest.schema!=='theme_lab_sigma10_dependencies.v2')throw new Error('invalid Sigma-10 dependency manifest');
  if(JSON.stringify(manifest.sigma_repository)!==JSON.stringify(sigmaRepository))throw new Error('Sigma-10 repository provenance is stale');
  if(JSON.stringify(manifest.css_sources)!==JSON.stringify(cssSources))throw new Error('Sigma-10 CSS source provenance is stale');
  if(manifest.root_source_sha256!==sha(Buffer.from(rootCss)))throw new Error('Sigma-10 root CSS snapshot is stale');
  const repositoryAssets=await verifyRepoAssets();
  for(const [url,metadata] of Object.entries(repositoryAssets)){
    if(JSON.stringify(manifest.repository_assets?.[url])!==JSON.stringify(metadata))throw new Error(`Sigma-10 repository asset provenance is stale: ${url}`);
  }
  const rootMap=new Map(Object.entries(repositoryAssets).map(([url,metadata])=>[url,sharedHref(metadata.asset_file)]));
  for(const [url,entry] of Object.entries(manifest.entries)){
    if(!/^[0-9a-f]{64}\.[a-z0-9]+$/u.test(entry.asset_file??''))throw new Error(`invalid Sigma-10 shared replay asset identity: ${url}`);
    const bytes=await fs.readFile(path.join(sharedAssetsDir,entry.asset_file));
    if(sha(bytes)!==entry.stored_sha256)throw new Error(`Sigma-10 dependency hash mismatch: ${url}`);
    if(!Array.isArray(entry.dependencies)||entry.dependencies.some(child=>!manifest.entries[child]&&!manifest.repository_assets?.[child]))throw new Error(`Sigma-10 dependency edge is unresolved: ${url}`);
    rootMap.set(url,sharedHref(entry.asset_file));
  }
  const output=rewriteCssReferences(rootCss,'https://sigma10.local/root.css',rootMap);
  if(sha(Buffer.from(output))!==manifest.offline_css_sha256)throw new Error('Sigma-10 offline CSS identity is stale');
  if(await fs.readFile(outputPath,'utf8')!==output)throw new Error('sigma10-offline.css is stale');
  return manifest;
}

await verifyRepoAssets();
const rootCss=await composeSource();
const manifest=refresh?await refreshDependencies(rootCss):await checkSnapshot(rootCss);
console.log(JSON.stringify({mode:refresh?'refresh':'check',dependencies:Object.keys(manifest.entries).length,root_source_sha256:manifest.root_source_sha256,offline_css_sha256:manifest.offline_css_sha256}));
