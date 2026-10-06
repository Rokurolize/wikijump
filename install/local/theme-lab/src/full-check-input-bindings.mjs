import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {normalizeSurfaceContract} from './theme-surface-contract.mjs';
import {resolveExistingContainedFile,resolveExistingPackageDirectory,resolveExistingPackageFile} from './package-path.mjs';

export const FULL_CHECK_INPUT_BINDINGS_SCHEMA='theme_lab_full_check_input_bindings.v1';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(sortValue(value));

function sortValue(value){
  if(Array.isArray(value))return value.map(sortValue);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sortValue(value[key])]));
  return value;
}

export function fullCheckInputBindings({selectors=null,surfaceContract=null,sourceStructure=null,pageAssets=[],referenceUrl=null}={}){
  const normalizedSurface=surfaceContract===null?null:normalizeSurfaceContract(surfaceContract);
  const payload={
    selectors_sha256:sha(canonical(selectors??null)),
    surface_contract_sha256:sha(canonical(normalizedSurface)),
    source_structure_sha256:sourceStructure?.sha256??null,
    page_assets_sha256:sha(canonical(pageAssets??[])),
    reference_url:referenceUrl??null,
  };
  return {schema:FULL_CHECK_INPUT_BINDINGS_SCHEMA,...payload,sha256:sha(canonical(payload))};
}

function readSelectors(text){return text.split('\n').map(line=>line.trim()).filter(Boolean)}
function verifyCurrentPageAssets(ports,dir,name,pageAssets){
  for(const asset of pageAssets){
    if(typeof asset?.filename!=='string'||!asset.filename||path.basename(asset.filename)!==asset.filename||
       typeof asset?.asset_file!=='string'||!asset.asset_file||path.basename(asset.asset_file)!==asset.asset_file||
       !/^[0-9a-f]{64}$/u.test(asset?.sha256??''))throw new Error(`${name}: invalid page asset binding`);
    let shared,published;
    try{shared=resolveExistingContainedFile(path.join(ports,'shared-replay-assets'),asset.asset_file,`${name}: shared page asset`)}catch{throw new Error(`${name}: shared page asset is missing or stale: ${asset.filename}`)}
    try{published=resolveExistingContainedFile(path.join(dir,'page-assets'),asset.filename,`${name}: publishable page asset`)}catch{throw new Error(`${name}: publishable page asset is missing or stale: ${asset.filename}`)}
    let sharedBytes;try{sharedBytes=fs.readFileSync(shared)}catch{throw new Error(`${name}: shared page asset is missing or stale: ${asset.filename}`)}
    if(sha(sharedBytes)!==asset.sha256)throw new Error(`${name}: shared page asset is missing or stale: ${asset.filename}`);
    let publishedBytes;try{publishedBytes=fs.readFileSync(published)}catch{throw new Error(`${name}: publishable page asset is missing or stale: ${asset.filename}`)}
    if(sha(publishedBytes)!==asset.sha256)throw new Error(`${name}: publishable page asset is missing or stale: ${asset.filename}`);
  }
}

export function currentPackageFullCheckInputBindings(root,name){
  const ports=path.join(root,'ports'),dir=resolveExistingPackageDirectory(ports,name,`${name}: package directory`);
  const selectorsPath=fs.existsSync(path.join(dir,'acceptance-selectors.txt'))
    ?resolveExistingPackageFile(dir,'acceptance-selectors.txt',`${name}: acceptance selectors`)
    :resolveExistingContainedFile(ports,'shared-acceptance-selectors.txt','shared acceptance selectors');
  const selectors=readSelectors(fs.readFileSync(selectorsPath,'utf8'));
  const surfacePath=path.join(dir,'surface-contract.json');
  const surfaceContract=fs.existsSync(surfacePath)?JSON.parse(fs.readFileSync(resolveExistingPackageFile(dir,'surface-contract.json',`${name}: surface contract`),'utf8')):'auto';
  const structurePath=path.join(dir,'acceptance-structure.json');
  const sourceStructure=fs.existsSync(structurePath)?{sha256:sha(fs.readFileSync(resolveExistingPackageFile(dir,'acceptance-structure.json',`${name}: acceptance structure`)))}:null;
  const pageAssetsPath=path.join(dir,'page-assets.json');
  const pageAssets=fs.existsSync(pageAssetsPath)?JSON.parse(fs.readFileSync(resolveExistingPackageFile(dir,'page-assets.json',`${name}: page asset manifest`),'utf8')).assets??[]:[];
  verifyCurrentPageAssets(ports,dir,name,pageAssets);
  const manifest=JSON.parse(fs.readFileSync(resolveExistingPackageFile(dir,'manifest.json',`${name}: manifest`),'utf8'));
  const referenceUrl=manifest.reference_url??manifest.source_url??null;
  if(typeof referenceUrl!=='string'||!referenceUrl)throw new Error(`${name}: package manifest lacks a full-check reference URL`);
  return fullCheckInputBindings({selectors,surfaceContract,sourceStructure,pageAssets,referenceUrl});
}
