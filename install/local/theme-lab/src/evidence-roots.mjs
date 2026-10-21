import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {resolveExistingContainedFile,resolveExistingContainedFileWithoutSymlinks} from './package-path.mjs';

// Authority evidence is resolved from two roots that share relative paths:
// the checkout-local ports directory and a shared, verified cache that holds
// the evidence a clean checkout does not carry (docs/agents/theme-lab.md).
// The cache root is the directory that contains `authority-evidence/`.
// WIKIJUMP_THEME_EVIDENCE_ROOT overrides it; an empty value disables the cache.
export function sharedEvidenceRoot(env=process.env){
  const override=env.WIKIJUMP_THEME_EVIDENCE_ROOT;
  if(override!==undefined)return override===''?null:path.resolve(override);
  const data=env.XDG_DATA_HOME||path.join(os.homedir(),'.local','share');
  return path.join(data,'wikijump','theme-lab-evidence');
}

// Only the default checkout root falls back. A caller that supplies its own
// root (tests, isolated runs) gets exactly that root unless it also names a
// shared root explicitly (null disables the fallback).
export function evidenceRoots(root,defaultRoot,sharedRoot){
  const shared=sharedRoot!==undefined?sharedRoot:(root===defaultRoot?sharedEvidenceRoot():null);
  const roots=[{dir:root,strict:false}];
  if(shared&&fs.existsSync(shared)&&fs.realpathSync(shared)!==fs.realpathSync(root))roots.push({dir:shared,strict:true});
  return roots;
}

const missing=error=>error?.code==='ENOENT'||error?.code==='ENOTDIR';

// Returns {file,root,bytes} for the first root whose file matches
// expectedSha256. Unsafe paths (traversal, absolute, symlink escape) throw
// immediately and never fall back. A missing or hash-mismatching file falls
// through to the next root; if no root matches, a mismatch is reported in
// preference to a missing file.
export function resolveEvidenceFile(roots,relative,label,expectedSha256){
  if(!/^[a-f0-9]{64}$/u.test(expectedSha256??''))throw new Error(`${label}: missing expected sha256`);
  let mismatch=null,absent=null;
  for(const {dir,strict} of roots){
    let file;
    try{
      file=(strict?resolveExistingContainedFileWithoutSymlinks:resolveExistingContainedFile)(dir,relative,label);
    }catch(error){
      if(!missing(error))throw error;
      absent??=error;
      continue;
    }
    const bytes=fs.readFileSync(file);
    if(crypto.createHash('sha256').update(bytes).digest('hex')===expectedSha256)return {file,root:dir,bytes};
    mismatch??=new Error(`stale authority evidence: ${relative}`);
  }
  throw mismatch??absent;
}
