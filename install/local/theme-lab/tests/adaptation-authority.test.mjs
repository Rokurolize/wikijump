import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateAuthority, assertPublishablePackage, verifyEvidence, PUBLISHABLE_AUTHORITIES} from '../src/adaptation-authority.mjs';
import {viewportEscape, closedDrawerBounds} from '../src/viewport-bounds.mjs';
import {removeNamedBlock} from '../scripts/wikidot-adaptation-ab.mjs';

test('adaptation authority rejects absent, local-only, synthetic and unbound evidence',()=>{
  const row={marker:'repair'};
  assert.throws(()=>validateAuthority(row),/authority/);
  assert.throws(()=>validateAuthority({...row,authority:'LOCAL_TARGET_ACCEPTANCE_ONLY'}),/authority/);
  assert.throws(()=>validateAuthority({...row,authority:'TARGET_WIKIDOT_CERTIFIED'}),/lacks evidence/);
  for(const authority of ['SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY','SYNTHETIC_FIXTURE_ONLY']) {
    assert.throws(()=>validateAuthority({...row,authority:'TARGET_WIKIDOT_CERTIFIED',evidence:[{path:'receipt.json',sha256:'a'.repeat(64),decision_authority:authority}]}),/cannot authorize/);
  }
  assert.equal(validateAuthority({...row,authority:'NONPUBLISHABLE_QUARANTINE'}).authority,'NONPUBLISHABLE_QUARANTINE');
  assert.equal(PUBLISHABLE_AUTHORITIES.has('NONPUBLISHABLE_QUARANTINE'),false);
});

test('both edges fail navigation acceptance even when document width equals viewport',()=>{
  assert.equal(viewportEscape({left:-127.5,right:200},390).pass,false);
  assert.equal(viewportEscape({left:0,right:410},390).pass,false);
  assert.equal(viewportEscape({left:0,right:390},390).pass,true);
  // Fractional CSS box edges can overshoot by half a pixel after layout
  // rounding; tolerate that while still rejecting a larger viewport escape.
  assert.equal(viewportEscape({left:19.5,right:390.5},390).pass,true);
  assert.equal(viewportEscape({left:19.5,right:391.01},390).pass,false);
  assert.equal(viewportEscape({left:NaN,right:390},390).pass,false);
});

test('named A/B removal preserves the distinct next header block',()=>{
  const css='/* SCP-JP navigation: menu */\n.menu {right:2rem}\n/* internal rationale */\n.link {width:100%}\n/* SCP-JP header: Space */\n#header {display:grid}';
  const without=removeNamedBlock(css,'SCP-JP navigation: menu');
  assert.doesNotMatch(without,/right:2rem/);
  assert.match(without,/#header \{display:grid\}/);
  assert.throws(()=>removeNamedBlock(css,'missing'),/missing/);
});

test('closed drawer authority requires nonempty geometry wholly outside the viewport',()=>{
  const rect={left:-218,right:0,width:218,height:844};
  assert.equal(closedDrawerBounds(rect,390).pass,true);
  assert.equal(viewportEscape(rect,390).pass,false);
  assert.equal(closedDrawerBounds({...rect,right:64},390).pass,false);
  assert.equal(closedDrawerBounds({...rect,width:0},390).pass,false);
  assert.equal(closedDrawerBounds({...rect,height:0},390).pass,false);
  assert.equal(closedDrawerBounds({...rect,left:NaN},390).pass,false);
});

test('drawer authority cannot substitute another state or omit required open proof',()=>{
  const ports=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../ports');
  const ledger=JSON.parse(fs.readFileSync(path.join(ports,'adaptation-authority.json'),'utf8'));
  const row=ledger.packages.wikifot.blocks.find(block=>block.scope?.states?.includes('sidebar-closed'));
  assert.ok(row);
  assert.throws(()=>verifyEvidence([{...row,scope:{...row.scope,states:['normal']}}],ports),/wrong authority state coverage/);
  assert.throws(()=>verifyEvidence([{...row,evidence:row.evidence.slice(0,1)}],ports),/incomplete authority state coverage/);
});

test('all publishable package inputs and generated artifacts have authority',()=>{
  const ports=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../ports');
  const ledger=JSON.parse(fs.readFileSync(path.join(ports,'adaptation-authority.json'),'utf8'));
  assert.equal(Object.keys(ledger.packages).length,36);
  for(const name of Object.keys(ledger.packages)) {
    assert.equal(assertPublishablePackage(name,{checkOutputs:true}).without_authority,0);
  }
});

test('publishable package authority cannot bind an input outside the package',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-authority-root-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'theme-authority-outside-'));
  try{
    const name='fixture',dir=path.join(root,name);fs.mkdirSync(dir,{recursive:true});
    const input='/* source */\n',source='[[module CSS]]\n/* source */\n[[/module]]\n',inputSha=crypto.createHash('sha256').update(input).digest('hex');
    const outsideInput=path.join(outside,'candidate-input.css');fs.writeFileSync(outsideInput,input);fs.symlinkSync(outsideInput,path.join(dir,'candidate-input.css'));fs.writeFileSync(path.join(dir,'source.txt'),source);
    fs.writeFileSync(path.join(root,'adaptation-authority.json'),JSON.stringify({packages:{fixture:{source_file:'source.txt',inputs:{'candidate-input.css':inputSha},blocks:[{marker:'source',origin:'preserved-source',authority:'NONPUBLISHABLE_QUARANTINE',sha256:inputSha}]}}}));
    assert.throws(()=>assertPublishablePackage(name,{portsRoot:root}),/adaptation input escapes package/u);
  }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});}
});

test('historical module cleanup preserves original bases or an explicitly pinned JP rebase',async()=>{
  const {splitMaintainableCandidate}=await import('../ports/scripts/prepare-maintainable-sources.mjs');
  const ports=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../ports');
  const ledger=JSON.parse(fs.readFileSync(path.join(ports,'adaptation-authority.json'),'utf8'));
  const reviewedJpRebases={
    'al-slop':'ef64c472fbc4c6add75121aa68283f72d21823b9e7915c493c6c891bac559b70',
    'space':'72ef4e7545f439aa9d8a330c566a9489980eafa02cd8e08cff327b7171b3d6aa',
    'flopstyle-dark':'541622cca25acbb968a463e89f4b1465092b1658088c499211a479af6ca1021f',
    'inkblot':'a934ded09f94f4f6ece53627d01d18c84ee1bc500c98a032ecd7ed949a955917',
  };
  let checked=0;
  for(const [name,pkg] of Object.entries(ledger.packages)) {
    if(!pkg.blocks.some(row=>row.origin==='historical-source-module'))continue;
    const dir=path.join(ports,name),manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
    const classification=manifest.maintenance_classification?JSON.parse(fs.readFileSync(path.join(dir,manifest.maintenance_classification),'utf8')):{};
    const historical=fs.readFileSync(path.join(dir,pkg.historical_candidate.source),'utf8');
    const {base}=splitMaintainableCandidate(historical,{unmarkedAdaptations:classification.unmarked_adaptation_modules??[]});
    const authorityBase=fs.readFileSync(path.join(dir,'maintenance/authority-base.wikidot.txt'),'utf8');
    if(reviewedJpRebases[name])assert.equal(crypto.createHash('sha256').update(authorityBase).digest('hex'),reviewedJpRebases[name],`${name}: reviewed JP rebase changed`);
    else assert.equal(authorityBase,base,name);
    checked++;
  }
  assert.equal(checked,34);
});
