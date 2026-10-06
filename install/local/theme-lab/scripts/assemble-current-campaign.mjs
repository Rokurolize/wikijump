#!/usr/bin/env node
// Index completed current artifacts by exact bytes. This script creates no
// acceptance decision or review provenance; check-campaign-completion remains
// the authority for whether the indexed evidence is sufficient.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {prepareContainedOutputFile,resolveExistingContainedFile,resolveExistingPackageDirectory,resolveExistingPackageFile} from '../src/package-path.mjs';

const defaultRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

export function assembleCurrentCampaign(root,{output='current-campaign-acceptance.json'}={}) {
  const absoluteRoot=path.resolve(root);
  const canonicalOutput=path.join(fs.realpathSync(absoluteRoot),'current-campaign-acceptance.json');
  if(path.resolve(absoluteRoot,output)!==canonicalOutput)throw new Error('Campaign output must be current-campaign-acceptance.json at the Theme Lab root');
  const target=prepareContainedOutputFile(absoluteRoot,output,'Campaign output');
  const readJson=relative=>JSON.parse(fs.readFileSync(resolveExistingContainedFile(absoluteRoot,relative,'Campaign input'),'utf8'));
  const bind=relative=>{
    const absolute=resolveExistingContainedFile(absoluteRoot,relative,'Artifact');
    const bytes=fs.readFileSync(absolute);
    return {path:path.relative(absoluteRoot,absolute),sha256:sha(bytes)};
  };
  const bindAudit=relative=>{
    const compressed=path.join(absoluteRoot,relative+'.gz');
    if(!fs.existsSync(compressed))return bind(relative);
    const bytes=fs.readFileSync(compressed),expanded=gunzipSync(bytes);
    const native=path.join(absoluteRoot,relative);
    if(fs.existsSync(native)&&sha(fs.readFileSync(native))!==sha(expanded))throw new Error(`Compressed audit differs from native evidence: ${relative}`);
    return {...bind(relative+'.gz'),encoding:'gzip',uncompressed_sha256:sha(expanded)};
  };
  const ledger=readJson('ports/adaptation-authority.json');
  const names=Object.keys(ledger.packages??{}).sort();
  if(!names.length)throw new Error('Maintained package inventory is empty');
  const packages=names.map(name=>{
    const directory=`ports/current-acceptance/${name}`;
    const packageDir=resolveExistingPackageDirectory(path.join(absoluteRoot,'ports'),name,`${name}: package directory`),sourceFile=ledger.packages[name].source_file??'candidate.wikidot.source.txt';
    const sourcePath=resolveExistingPackageFile(packageDir,sourceFile,`${name}: source file`);
    return {package:name,
      inputs:{css:bind(`ports/${name}/candidate.css`),source:bind(path.relative(absoluteRoot,sourcePath)),preview:bind(`ports/${name}/candidate.wikidot.txt`)},
      receipt:bind(`${directory}/accepted-result.json`),
      browser_audit:bindAudit(`${directory}/browser-audit.json`),
      visual_review:bind(`${directory}/visual-review.json`)};
  });
  const migrationDirectory='sigma10-migration/current-campaign';
  const migration={receipt:bind(`${migrationDirectory}/accepted-result.json`),browser_audit:bindAudit(`${migrationDirectory}/browser-audit.json`)};
  const document={schema:'theme_lab_current_campaign_acceptance.v1',packages,migration};
  fs.writeFileSync(target,`${JSON.stringify(document,null,2)}\n`);
  return {path:path.relative(absoluteRoot,target),sha256:sha(fs.readFileSync(target)),packages:names.length};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.some(arg=>arg!=='--help')){
    console.error('Usage: node scripts/assemble-current-campaign.mjs');
    process.exit(64);
  }
  if(args.includes('--help'))console.log('Usage: node scripts/assemble-current-campaign.mjs\nBinds current package and Sigma-10 artifacts by exact SHA-256, then writes current-campaign-acceptance.json. It does not create or upgrade acceptance decisions.');
  else try{console.log(JSON.stringify(assembleCurrentCampaign(defaultRoot),null,2));}
  catch(error){console.error(JSON.stringify({status:'incomplete',error:error.message},null,2));process.exitCode=2;}
}
