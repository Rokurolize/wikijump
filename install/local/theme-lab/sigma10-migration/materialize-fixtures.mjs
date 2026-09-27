#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const sourceManifest=JSON.parse(await fs.readFile(path.join(root,'source-manifest.json'),'utf8'));
const fixtureDir=path.join(root,'fixtures');
const sharedAssetsDir=path.resolve(root,'../ports/shared-replay-assets');
const write=process.argv.includes('--write');
if(process.argv.length>3||(process.argv.length===3&&!write))throw new Error('Usage: materialize-fixtures.mjs [--write]');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const staticAssets={
 'https://scp-jp.github.io/files/util/common/media/nav/side/black.png':{
  sha256:'4f8c6d416f09671777934e57bc67fb52ccc97145dc6f1869e628d9ffd7d8f6e7',
  asset_file:'4f8c6d416f09671777934e57bc67fb52ccc97145dc6f1869e628d9ffd7d8f6e7.png',
  source_identity:'pseudo-scp-jp:sigma-10:nav:side'
 }
};
const interwikiStubs={
 'interwiki.scp-jp.org/interwikiFrame.html?lang={$lang}&community={$community}&pagename=%%name%%':{
  source_identity:'pseudo-scp-jp:sigma-10:nav:interwiki',
  role:'visible interwiki frame',
  data_url:'data:text/html,%3C!doctype%20html%3E%3Chtml%20lang=ja%3E%3Cbody%3E%3C/body%3E%3C/html%3E'
 },
 'interwiki.scp-jp.org/styleFrame.html?priority={$priority}&theme={$theme}&css={$css}':{
  source_identity:'scp-jp:component:interwiki-style',
  role:'hidden style propagation frame',
  data_url:'data:text/html,%3C!doctype%20html%3E%3Chtml%20lang=ja%3E%3Cbody%3E%3C/body%3E%3C/html%3E'
 }
};
const slugs={
 'pseudo-scp-jp:sigma-10:main':'run-owned:sigma10-main',
 'pseudo-scp-jp:sigma-10:nav:side':'run-owned:sigma10-nav-side',
 'pseudo-scp-jp:sigma-10:nav:top':'run-owned:sigma10-nav-top',
 'pseudo-scp-jp:sigma-10:nav:interwiki':'run-owned:sigma10-nav-interwiki',
 'pseudo-scp-jp:sigma-10:credit:start':'run-owned:sigma10-credit-start',
 'pseudo-scp-jp:sigma-10:credit:otherwise-start':'run-owned:sigma10-credit-otherwise-start',
 'pseudo-scp-jp:sigma-10:credit:otherwise-end':'run-owned:sigma10-credit-otherwise-end',
 'pseudo-scp-jp:sigma-10:credit:end':'run-owned:sigma10-credit-end',
 'scp-jp:component:interwiki-style':'run-owned:sigma10-interwiki-style',
};
const transformations=[];
const fixtures=[];
for(const [identity,slug] of Object.entries(slugs)){
 const source=sourceManifest.pages[identity];
 if(!source)throw new Error(`missing frozen source: ${identity}`);
 const sourceBytes=await fs.readFile(path.join(root,source.file));
 if(sha(sourceBytes)!==source.sha256)throw new Error(`source hash mismatch: ${identity}`);
 let content=sourceBytes.toString('utf8');
 for(const [dependency,replacement] of Object.entries(slugs)){
  const marker=`[[include :${dependency}`;
  if(!content.includes(marker))continue;
  content=content.replaceAll(marker,`[[include ${replacement}`);
  transformations.push({fixture:slug,kind:'local-include',source_identity:dependency,replacement});
 }
 for(const [url,asset] of Object.entries(staticAssets)){
  if(asset.source_identity!==identity||!content.includes(url))continue;
  const bytes=await fs.readFile(path.join(sharedAssetsDir,asset.asset_file));
  if(sha(bytes)!==asset.sha256)throw new Error(`fixture static asset hash mismatch: ${url}`);
  content=content.replaceAll(url,`/${asset.asset_file}`);
  transformations.push({fixture:slug,kind:'local-static-asset',source_url:url,asset_file:asset.asset_file,sha256:asset.sha256});
 }
 for(const [authority,stub] of Object.entries(interwikiStubs)){
  if(stub.source_identity!==identity)continue;
  const marker=`//${authority}`;
  if(!content.includes(marker))throw new Error(`expected frozen Interwiki contract not found: ${authority}`);
  content=content.replaceAll(marker,stub.data_url);
  transformations.push({fixture:slug,kind:'bounded-runtime-stub',authority,role:stub.role,data_url:stub.data_url,content_data:'empty document; no live links or CSS are fabricated'});
 }
 if(identity==='pseudo-scp-jp:sigma-10:nav:interwiki'||identity==='scp-jp:component:interwiki-style'){
  if(!content.includes('[[embed]]')||!content.includes('[[/embed]]'))throw new Error(`frozen Interwiki embed block changed: ${identity}`);
  content=content.replaceAll('[[embed]]','[[html]]\n').replaceAll('[[/embed]]','\n[[/html]]\n');
  transformations.push({fixture:slug,kind:'local-isolated-html-block',source_identity:identity,reason:'Replace the deprecated remote embed wrapper with Wikidot HTML-block syntax for the empty local contract document; preserve the frozen public source separately.'});
 }
 if(identity==='pseudo-scp-jp:sigma-10:nav:interwiki'){
  const opening='[[module ListPages range="." limit="1"]]';
  if(!content.includes(opening)||!content.includes('[[/module]]'))throw new Error('expected frozen Interwiki page-name expansion wrapper not found');
  content=content.replace(opening,'').replace('[[/module]]','');
  transformations.push({fixture:slug,kind:'local-interwiki-frame-contract',source_identity:identity,reason:'The frozen ListPages range expansion has no local page match; omit only that data lookup and retain the frame wrapper/placement. Remote page-name link data remains external.'});
 }
 if(identity==='pseudo-scp-jp:sigma-10:nav:top'){
  const marker='[[include :mkn:secret:top]]';
  if(!content.includes(marker))throw new Error('private pseudo-site include changed');
  content=content.replace(marker,'[!-- Private pseudo-site include omitted: mkn:secret:top has no public source. --]');
  transformations.push({fixture:slug,kind:'private-include-omitted',source_identity:'mkn:secret:top'});
 }
 const file=`${slug.replaceAll(':','-')}.wikidot.txt`;
 const bytes=Buffer.from(content);
 fixtures.push({slug,title:slug==='run-owned:sigma10-main'?'SCP-173':`Sigma-10 fixture: ${slug}`,source_identity:identity,source_sha256:source.sha256,file:`fixtures/${file}`,sha256:sha(bytes)});
 if(write){await fs.mkdir(fixtureDir,{recursive:true});await fs.writeFile(path.join(fixtureDir,file),bytes)}
 else if(sha(await fs.readFile(path.join(fixtureDir,file)))!==sha(bytes))throw new Error(`materialized fixture drift: ${slug}`);
}
const manifest={schema:'theme_lab_sigma10_fixtures.v1',source_manifest_sha256:sha(await fs.readFile(path.join(root,'source-manifest.json'))),fixtures,transformations,static_assets:staticAssets,external_runtime_contracts:sourceManifest.external_runtime_contracts,interwiki_stubs:interwikiStubs};
const manifestBytes=Buffer.from(`${JSON.stringify(manifest,null,2)}\n`);
if(write)await fs.writeFile(path.join(root,'fixture-manifest.json'),manifestBytes);
else if(sha(await fs.readFile(path.join(root,'fixture-manifest.json')))!==sha(manifestBytes))throw new Error('fixture manifest drift');
console.log(JSON.stringify({mode:write?'write':'check',fixtures:fixtures.length,transformations:transformations.length,manifest_sha256:sha(manifestBytes)}));
