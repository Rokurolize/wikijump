#!/usr/bin/env node
// Index completed current artifacts by exact bytes. This script creates no
// acceptance decision or review provenance; check-campaign-completion remains
// the authority for whether the indexed evidence is sufficient.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const defaultRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

export function assembleCurrentCampaign(root,{output='current-campaign-acceptance.json'}={}) {
  const absoluteRoot=path.resolve(root);
  const readJson=relative=>JSON.parse(fs.readFileSync(path.join(absoluteRoot,relative),'utf8'));
  const bind=relative=>{
    const absolute=path.resolve(absoluteRoot,relative);
    if(!absolute.startsWith(absoluteRoot+path.sep))throw new Error(`Artifact escapes Theme Lab: ${relative}`);
    const bytes=fs.readFileSync(absolute);
    return {path:path.relative(absoluteRoot,absolute),sha256:sha(bytes)};
  };
  const ledger=readJson('ports/adaptation-authority.json');
  const names=Object.keys(ledger.packages??{}).sort();
  if(!names.length)throw new Error('Maintained package inventory is empty');
  const packages=names.map(name=>{
    const directory=`ports/current-acceptance/${name}`;
    return {package:name,
      inputs:{css:bind(`ports/${name}/candidate.css`),source:bind(`ports/${name}/${ledger.packages[name].source_file??'candidate.wikidot.source.txt'}`),preview:bind(`ports/${name}/candidate.wikidot.txt`)},
      receipt:bind(`${directory}/accepted-result.json`),
      browser_audit:bind(`${directory}/browser-audit.json`)};
  });
  const migrationDirectory='sigma10-migration/current-campaign';
  const migration={receipt:bind(`${migrationDirectory}/accepted-result.json`),browser_audit:bind(`${migrationDirectory}/browser-audit.json`)};
  const document={schema:'theme_lab_current_campaign_acceptance.v1',packages,migration};
  const target=path.resolve(absoluteRoot,output);
  if(!target.startsWith(absoluteRoot+path.sep))throw new Error('Output must remain inside Theme Lab');
  fs.mkdirSync(path.dirname(target),{recursive:true});
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
