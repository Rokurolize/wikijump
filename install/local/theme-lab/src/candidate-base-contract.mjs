import crypto from 'node:crypto';
import fs from 'node:fs';

import {resolveExistingPackageFile} from './package-path.mjs';

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

export function currentPackageBaseCss(directory,name) {
  const manifest=JSON.parse(fs.readFileSync(resolveExistingPackageFile(directory,'manifest.json',`${name}: manifest`),'utf8'));
  const declaration=manifest.interactive_acceptance?.resolved_stylesheet??null;
  let file=null;
  try{file=resolveExistingPackageFile(directory,'candidate-base.css',`${name}: candidate base CSS`)}
  catch(error){if(error.code!=='ENOENT')throw error}
  if(!declaration){
    if(file)throw new Error(`${name}: candidate base CSS lacks a resolved stylesheet contract`);
    return null;
  }
  if(!/^[0-9a-f]{64}$/u.test(declaration.sha256??''))throw new Error(`${name}: resolved stylesheet contract lacks a valid SHA-256`);
  if(!file)throw new Error(`${name}: resolved stylesheet contract requires candidate-base.css`);
  const bytes=fs.readFileSync(file);
  if(sha(bytes)!==declaration.sha256)throw new Error(`${name}: candidate base CSS differs from the resolved stylesheet contract`);
  return bytes;
}
