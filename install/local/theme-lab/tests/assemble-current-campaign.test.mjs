import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {assembleCurrentCampaign} from '../scripts/assemble-current-campaign.mjs';

const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
test('assembler indexes exact current artifacts without manufacturing review or acceptance fields',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-assemble-'));
 try{
  const write=(relative,contents)=>{const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,contents);return relative;};
  write('ports/adaptation-authority.json',JSON.stringify({packages:{fixture:{source_file:'source.txt'}}}));
  for(const relative of ['ports/fixture/candidate.css','ports/fixture/source.txt','ports/fixture/candidate.wikidot.txt','ports/current-acceptance/fixture/accepted-result.json','ports/current-acceptance/fixture/browser-audit.json','ports/current-acceptance/fixture/visual-review.json','sigma10-migration/current-campaign/accepted-result.json','sigma10-migration/current-campaign/browser-audit.json'])write(relative,relative);
  const output=assembleCurrentCampaign(root);
  const document=JSON.parse(fs.readFileSync(path.join(root,output.path),'utf8'));
  assert.equal(document.schema,'theme_lab_current_campaign_acceptance.v1');
  assert.equal(document.packages.length,1);
  assert.equal(document.packages[0].receipt.sha256,digest(Buffer.from('ports/current-acceptance/fixture/accepted-result.json')));
  assert.equal(document.packages[0].visual_review.sha256,digest(Buffer.from('ports/current-acceptance/fixture/visual-review.json')));
  assert.equal(document.migration.browser_audit.sha256,digest(Buffer.from('sigma10-migration/current-campaign/browser-audit.json')));
  assert.equal(Object.hasOwn(document,'reviewer'),false);
  assert.equal(Object.hasOwn(document.migration,'status'),false);
  const audit=path.join(root,document.migration.browser_audit.path);
  fs.writeFileSync(audit+'.gz',gzipSync(fs.readFileSync(audit)));
  const compressedOutput=assembleCurrentCampaign(root);
  const compressed=JSON.parse(fs.readFileSync(path.join(root,compressedOutput.path))).migration.browser_audit;
  assert.equal(compressed.encoding,'gzip');
  assert.equal(compressed.uncompressed_sha256,document.migration.browser_audit.sha256);
  assert.equal(compressed.sha256,digest(fs.readFileSync(audit+'.gz')));
  fs.writeFileSync(audit+'.gz',gzipSync(Buffer.from('different native evidence')));
  assert.throws(()=>assembleCurrentCampaign(root),/differs from native evidence/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('assembler fails closed when a current artifact is missing',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-assemble-missing-'));
 try{
  fs.mkdirSync(path.join(root,'ports'),{recursive:true});
  fs.writeFileSync(path.join(root,'ports/adaptation-authority.json'),JSON.stringify({packages:{fixture:{}}}));
  assert.throws(()=>assembleCurrentCampaign(root),/ENOENT/);
  assert.equal(fs.existsSync(path.join(root,'current-campaign-acceptance.json')),false);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('assembler rejects a maintained source file outside its package',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-assemble-source-escape-'));
 try{
  const write=(relative,contents)=>{const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,contents);};
  write('ports/adaptation-authority.json',JSON.stringify({packages:{fixture:{source_file:'../other/source.txt'}}}));
  write('ports/fixture/candidate.css','css');write('ports/fixture/candidate.wikidot.txt','preview');write('ports/other/source.txt','other source');
  for(const relative of ['ports/current-acceptance/fixture/accepted-result.json','ports/current-acceptance/fixture/browser-audit.json','ports/current-acceptance/fixture/visual-review.json','sigma10-migration/current-campaign/accepted-result.json','sigma10-migration/current-campaign/browser-audit.json'])write(relative,relative);
  assert.throws(()=>assembleCurrentCampaign(root),/source file escapes package/u);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('assembler rejects a maintained package ledger symlink escaping Theme Lab',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-assemble-ledger-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-assemble-ledger-outside-'));
 try{
  fs.mkdirSync(path.join(root,'ports'),{recursive:true});
  const ledger=path.join(outside,'adaptation-authority.json');fs.writeFileSync(ledger,JSON.stringify({packages:{fixture:{}}}));
  fs.symlinkSync(ledger,path.join(root,'ports/adaptation-authority.json'));
  assert.throws(()=>assembleCurrentCampaign(root),/Campaign input escapes root/u);
  assert.equal(fs.existsSync(path.join(root,'current-campaign-acceptance.json')),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true})}
});

test('assembler output cannot traverse a symlinked directory outside Theme Lab',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-assemble-output-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-assemble-output-outside-'));
 try{
  fs.mkdirSync(path.join(root,'ports'),{recursive:true});fs.symlinkSync(outside,path.join(root,'linked-output'));
  assert.throws(()=>assembleCurrentCampaign(root,{output:'linked-output/current.json'}),/Campaign output must be current-campaign-acceptance\.json/u);
  assert.equal(fs.existsSync(path.join(outside,'current.json')),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true})}
});

test('assembler writes only the canonical current campaign index path',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-assemble-canonical-output-'));
 try{
  assert.throws(()=>assembleCurrentCampaign(root,{output:'evidence/current-campaign-acceptance.json'}),/Campaign output must be current-campaign-acceptance\.json/u);
  assert.equal(fs.existsSync(path.join(root,'evidence/current-campaign-acceptance.json')),false);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
