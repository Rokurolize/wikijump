#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const sourceManifest=JSON.parse(await fs.readFile(path.join(root,'source-manifest.json'),'utf8'));
const fixtureDir=path.join(root,'fixtures');
const write=process.argv.includes('--write');
if(process.argv.length>3||(process.argv.length===3&&!write))throw new Error('Usage: materialize-fixtures.mjs [--write]');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
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
const manifest={schema:'theme_lab_sigma10_fixtures.v1',source_manifest_sha256:sha(await fs.readFile(path.join(root,'source-manifest.json'))),fixtures,transformations,external_runtime_contracts:sourceManifest.external_runtime_contracts};
const manifestBytes=Buffer.from(`${JSON.stringify(manifest,null,2)}\n`);
if(write)await fs.writeFile(path.join(root,'fixture-manifest.json'),manifestBytes);
else if(sha(await fs.readFile(path.join(root,'fixture-manifest.json')))!==sha(manifestBytes))throw new Error('fixture manifest drift');
console.log(JSON.stringify({mode:write?'write':'check',fixtures:fixtures.length,transformations:transformations.length,manifest_sha256:sha(manifestBytes)}));
