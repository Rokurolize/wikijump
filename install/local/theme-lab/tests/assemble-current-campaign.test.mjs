import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {assembleCurrentCampaign} from '../scripts/assemble-current-campaign.mjs';

const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
test('assembler indexes exact current artifacts without manufacturing review or acceptance fields',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-assemble-'));
 try{
  const write=(relative,contents)=>{const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,contents);return relative;};
  write('ports/adaptation-authority.json',JSON.stringify({packages:{fixture:{source_file:'source.txt'}}}));
  for(const relative of ['ports/fixture/candidate.css','ports/fixture/source.txt','ports/fixture/candidate.wikidot.txt','ports/current-acceptance/fixture/accepted-result.json','ports/current-acceptance/fixture/browser-audit.json','sigma10-migration/current-campaign/accepted-result.json','sigma10-migration/current-campaign/browser-audit.json'])write(relative,relative);
  const output=assembleCurrentCampaign(root);
  const document=JSON.parse(fs.readFileSync(path.join(root,output.path),'utf8'));
  assert.equal(document.schema,'theme_lab_current_campaign_acceptance.v1');
  assert.equal(document.packages.length,1);
  assert.equal(document.packages[0].receipt.sha256,digest(Buffer.from('ports/current-acceptance/fixture/accepted-result.json')));
  assert.equal(document.migration.browser_audit.sha256,digest(Buffer.from('sigma10-migration/current-campaign/browser-audit.json')));
  assert.equal(Object.hasOwn(document,'reviewer'),false);
  assert.equal(Object.hasOwn(document.migration,'status'),false);
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
