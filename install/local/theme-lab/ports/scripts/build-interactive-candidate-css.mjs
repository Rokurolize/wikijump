#!/usr/bin/env node
// Materialize an imported theme-page stylesheet plus the candidate's own CSS
// modules from the existing response cache. The port manifest declares the
// source page and tags, so the builder contains no theme-specific selectors.
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractUnconditionalCssModules} from './extract-css-modules.mjs';

const portsDir=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const themes=process.argv.slice(2).filter(arg=>arg.startsWith('--theme=')).map(arg=>arg.slice(8));
const only=new Set(themes);
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const cache=path.join(os.homedir(),'.cache/wikijump/theme-lab');
const entries=await fs.readdir(portsDir,{withFileTypes:true});
const results=[];
for(const entry of entries){
  if(!entry.isDirectory()||only.size&&!only.has(entry.name))continue;
  const dir=path.join(portsDir,entry.name);
  let manifest;try{manifest=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'))}catch{continue}
  const config=manifest.interactive_acceptance?.theme_source;
  if(!config)continue;
  const tags=config.active_tags??[];
  const upstream=await fs.readFile(path.join(dir,config.path),'utf8');
  const candidatePath=path.join(dir,'candidate.wikidot.source.txt');
  const candidate=await fs.readFile(candidatePath,'utf8');
  const candidateTags=config.candidate_tags??[];
  const sourceCss=[extractUnconditionalCssModules(upstream,{activeTags:tags}),extractUnconditionalCssModules(candidate,{activeTags:candidateTags})].join('\n\n');
  const sourcePath=path.join(dir,'candidate-source.css');
  await fs.writeFile(sourcePath,sourceCss);
  const outputPath=path.join(dir,'candidate.css');
  const assetsPath=path.join(portsDir,'shared-replay-assets');
  const assetReceiptPath=path.join(dir,'assets.json');
  const freezeArgs=[path.join(portsDir,'scripts/freeze-css.py'),'--input',sourcePath,'--output',outputPath,'--assets',assetsPath,'--receipt',assetReceiptPath,'--base-url',manifest.reference_url,'--cache',cache];
  if(manifest.flattened_css_transforms)freezeArgs.push('--transforms',path.join(dir,manifest.flattened_css_transforms));
  const command=spawnSync('python3',freezeArgs,{encoding:'utf8'});
  if(command.stdout)process.stdout.write(command.stdout);
  if(command.stderr)process.stderr.write(command.stderr);
  if(command.status!==0)throw new Error(`${entry.name}: freeze-css exited ${command.status}`);
  const cssBytes=await fs.readFile(outputPath);
  const assets=JSON.parse(await fs.readFile(assetReceiptPath,'utf8'));
  manifest.interactive_acceptance.resolved_theme_css={source_path:config.path,source_sha256:digest(Buffer.from(upstream)),active_tags:tags,candidate_source_sha256:digest(Buffer.from(candidate)),candidate_active_tags:candidateTags,css_source_path:path.relative(dir,sourcePath),candidate_css_sha256:digest(cssBytes),asset_receipt_path:path.relative(dir,assetReceiptPath),assets:assets.assets.length,imports:assets.imports.length,localization_transforms:assets.localization_transforms?.length??0,localization_transform_manifest:assets.localization_transform_manifest??null,missing:assets.missing.length,external_requests_during_build:0};
  await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  results.push({theme:entry.name,css_sha256:digest(cssBytes),bytes:cssBytes.length,assets:assets.assets.length,imports:assets.imports.length,missing:assets.missing.length,external_requests:0});
}
console.log(JSON.stringify({themes:results},null,2));
