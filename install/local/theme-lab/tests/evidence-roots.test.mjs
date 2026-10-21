import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {evidenceRoots,resolveEvidenceFile,sharedEvidenceRoot} from '../src/evidence-roots.mjs';
import {verifyEvidence} from '../src/adaptation-authority.mjs';

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

function fixture(){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'theme-evidence-roots-'));
  const local=path.join(base,'local'),shared=path.join(base,'shared');
  fs.mkdirSync(path.join(local,'authority-evidence/proof'),{recursive:true});
  fs.mkdirSync(path.join(shared,'authority-evidence/proof'),{recursive:true});
  const put=(root,rel,text)=>{fs.mkdirSync(path.dirname(path.join(root,rel)),{recursive:true});fs.writeFileSync(path.join(root,rel),text)};
  return {base,local,shared,put,done:()=>fs.rmSync(base,{recursive:true,force:true})};
}
const roots=(f)=>evidenceRoots(f.local,f.local,f.shared);
const rel='authority-evidence/proof/note.txt';

test('a hash-matching checkout-local file is preferred over the shared copy',()=>{
  const f=fixture();
  try{
    f.put(f.local,rel,'local');f.put(f.shared,rel,'local');
    const found=resolveEvidenceFile(roots(f),rel,'authority evidence',sha('local'));
    assert.equal(found.root,f.local);
    assert.ok(found.file.startsWith(fs.realpathSync(f.local)+path.sep));
  }finally{f.done()}
});

test('a file missing from the checkout is served from the shared root',()=>{
  const f=fixture();
  try{
    f.put(f.shared,rel,'shared');
    const found=resolveEvidenceFile(roots(f),rel,'authority evidence',sha('shared'));
    assert.equal(found.root,f.shared);
    assert.equal(found.bytes.toString(),'shared');
  }finally{f.done()}
});

test('a mismatching local file falls back to a matching shared file, and never passes on a mismatch alone',()=>{
  const f=fixture();
  try{
    f.put(f.local,rel,'stale');f.put(f.shared,rel,'good');
    assert.equal(resolveEvidenceFile(roots(f),rel,'authority evidence',sha('good')).root,f.shared);
    f.put(f.shared,rel,'also stale');
    assert.throws(()=>resolveEvidenceFile(roots(f),rel,'authority evidence',sha('good')),/stale authority evidence/u);
    fs.rmSync(path.join(f.shared,rel));
    assert.throws(()=>resolveEvidenceFile(roots(f),rel,'authority evidence',sha('good')),/stale authority evidence/u);
    assert.throws(()=>resolveEvidenceFile(roots(f),rel,'authority evidence','nothex'),/missing expected sha256/u);
  }finally{f.done()}
});

test('unsafe paths are rejected in both roots and never fall back',()=>{
  const f=fixture();
  try{
    f.put(f.shared,rel,'shared');
    f.put(f.base,'outside.txt','shared');
    for(const bad of ['../outside.txt','authority-evidence/../../outside.txt',path.join(f.base,'outside.txt'),'']){
      assert.throws(()=>resolveEvidenceFile(roots(f),bad,'authority evidence',sha('shared')),/escapes root|missing path/u,bad);
    }
    // A symlinked component in the shared cache is refused even though it resolves inside the root.
    fs.mkdirSync(path.join(f.shared,'real'));
    f.put(f.shared,'real/linked.txt','shared');
    fs.symlinkSync(path.join(f.shared,'real'),path.join(f.shared,'alias'));
    assert.throws(()=>resolveEvidenceFile(roots(f),'alias/linked.txt','authority evidence',sha('shared')),/symlinks/u);
    // A local symlink escaping the checkout root throws instead of consulting the shared root.
    fs.symlinkSync(path.join(f.base,'outside.txt'),path.join(f.local,'authority-evidence/proof/escape.txt'));
    f.put(f.shared,'authority-evidence/proof/escape.txt','shared');
    assert.throws(()=>resolveEvidenceFile(roots(f),'authority-evidence/proof/escape.txt','authority evidence',sha('shared')),/escapes root/u);
  }finally{f.done()}
});

test('the shared root applies only to the default root unless named explicitly',()=>{
  const f=fixture();
  const saved=process.env.WIKIJUMP_THEME_EVIDENCE_ROOT,savedXdg=process.env.XDG_DATA_HOME;
  try{
    process.env.WIKIJUMP_THEME_EVIDENCE_ROOT=f.shared;
    assert.equal(sharedEvidenceRoot(),f.shared);
    assert.equal(evidenceRoots(f.local,f.local).length,2);
    assert.equal(evidenceRoots(f.local,path.join(f.base,'other-default')).length,1,'isolated roots get no implicit fallback');
    assert.equal(evidenceRoots(f.local,f.local,null).length,1);
    process.env.WIKIJUMP_THEME_EVIDENCE_ROOT='';
    assert.equal(sharedEvidenceRoot(),null);
    assert.equal(evidenceRoots(f.local,f.local).length,1);
    delete process.env.WIKIJUMP_THEME_EVIDENCE_ROOT;
    process.env.XDG_DATA_HOME=f.base;
    assert.equal(sharedEvidenceRoot(),path.join(f.base,'wikijump','theme-lab-evidence'));
  }finally{
    if(saved===undefined)delete process.env.WIKIJUMP_THEME_EVIDENCE_ROOT;else process.env.WIKIJUMP_THEME_EVIDENCE_ROOT=saved;
    if(savedXdg===undefined)delete process.env.XDG_DATA_HOME;else process.env.XDG_DATA_HOME=savedXdg;
    f.done();
  }
});

function certified(f,rootName,{artifacts}){
  const dir=path.join(f[rootName],'authority-evidence/cert');
  const rows=['without','with'].map(variant=>{
    const shot=`${variant}-shot`,dom=`${variant}-dom`;
    if(artifacts){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,`${variant}.png`),shot);fs.writeFileSync(path.join(dir,`${variant}.html`),dom)}
    return {variant,state:'normal',width:390,pass:variant==='with',css_sha256:'b'.repeat(64),bounds:[{pass:variant==='with'}],measurement:{document_width:390,rows:[{selector:'a'}]},screenshot:`${variant}.png`,screenshot_sha256:sha(shot),dom:`${variant}.html`,dom_sha256:sha(dom)};
  });
  const bytes=JSON.stringify({schema:'theme_lab_wikidot_adaptation_ab.v1',public_writes:0,external_browser_requests:0,url:'https://fixture.wikidot.com/p',site:'fixture.wikidot.com',observed_at:'2026-10-07T00:00:00Z',snapshot:{entry:'/o/x',object_digests:[]},rows});
  fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'receipt.json'),bytes);
  return sha(bytes);
}

test('a receipt resolved from one root validates its artifacts against that same root',()=>{
  const f=fixture();
  try{
    const hash=certified(f,'shared',{artifacts:true});
    const row={marker:'m',authority:'TARGET_WIKIDOT_CERTIFIED',scope:{states:['normal'],viewports:[390],target_url:'https://fixture.wikidot.com/p'},evidence:[{path:'authority-evidence/cert/receipt.json',sha256:hash}]};
    verifyEvidence([row],f.local,{sharedRoot:f.shared});
    // Same receipt bytes locally but without its artifacts: the local root owns the receipt, so no mixing occurs.
    certified(f,'local',{artifacts:false});
    assert.throws(()=>verifyEvidence([row],f.local,{sharedRoot:f.shared}),/ENOENT/u);
    // An isolated root never consults the shared cache.
    fs.rmSync(path.join(f.local,'authority-evidence/cert'),{recursive:true});
    assert.throws(()=>verifyEvidence([row],f.local),/ENOENT/u);
    assert.throws(()=>verifyEvidence([{...row,evidence:[{...row.evidence[0],sha256:'c'.repeat(64)}]}],f.local,{sharedRoot:f.shared}),/stale authority evidence/u);
  }finally{f.done()}
});
