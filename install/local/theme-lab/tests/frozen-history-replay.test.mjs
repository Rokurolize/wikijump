import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadFrozenHistoryReplay,applyFrozenHistoryReplay} from '../src/frozen-history-replay.mjs';
import {verifyFrozenHistoryAuthority,digest} from '../src/adaptation-authority.mjs';
const evidence=fileURLToPath(new URL('./fixtures/native-history/',import.meta.url));
const bindings={pageHistory:{receipt:path.join(evidence,'wikidot-history-source-20261001.json'),response:path.join(evidence,'page-history-response.json'),requestId:'jp-01'},revisionList:{receipt:path.join(evidence,'wikidot-history-parity-20260929.json'),response:path.join(evidence,'revision-list-response.json'),requestId:'jp-02'}};
const url='https://scp-jp.wikidot.com/scp-173';

test('native history replay binds both retained read responses to their page and acquisition bytes',async()=>{
  const rows=await loadFrozenHistoryReplay(bindings,url);
  assert.deepEqual(rows.map(row=>row.pageId),[19439882,19439882]);
  assert.deepEqual(rows.map(row=>row.target),['#action-area','#revision-list']);
  assert.match(rows[1].body,/name="from"/u);
  assert.match(rows[1].body,/name="to"/u);
});

test('native history replay rejects cross-site use, modified response bytes, and mutation-bearing receipts',async()=>{
  await assert.rejects(loadFrozenHistoryReplay(bindings,'https://scp-wiki.wikidot.com/scp-173'),/native acquisition/u);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'theme-native-history-'));
  try{
    const response=path.join(dir,'changed.json');
    await fs.writeFile(response,(await fs.readFile(bindings.pageHistory.response,'utf8'))+'\n');
    await assert.rejects(loadFrozenHistoryReplay({...bindings,pageHistory:{...bindings.pageHistory,response}},url),/native acquisition/u);
    const receipt=path.join(dir,'mutation.json'),data=JSON.parse(await fs.readFile(bindings.pageHistory.receipt,'utf8'));
    data.actor={mutations:1};await fs.writeFile(receipt,JSON.stringify(data));
    await assert.rejects(loadFrozenHistoryReplay({...bindings,pageHistory:{...bindings.pageHistory,receipt}},url),/read-only authority/u);
  }finally{await fs.rm(dir,{recursive:true,force:true})}
});

test('native history insertion rejects a different root page before touching its DOM',async()=>{
  const rows=await loadFrozenHistoryReplay(bindings,url);
  const prior=globalThis.WIKIREQUEST;globalThis.WIKIREQUEST={info:{pageId:19439883}};
  try{await assert.rejects(applyFrozenHistoryReplay({evaluate:async(fn,arg)=>fn(arg)},rows),/root page identity differs/u)}
  finally{if(prior===undefined)delete globalThis.WIKIREQUEST;else globalThis.WIKIREQUEST=prior}
});

test('published History authority refuses hidden geometry and tampered nested responses',async()=>{
  const original=fileURLToPath(new URL('./fixtures/frozen-history-authority/',import.meta.url));
  const receipt=JSON.parse(await fs.readFile(path.join(original,'receipt.json')));
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'theme-native-history-authority-'));
  const directory=path.join(root,'proof');await fs.mkdir(directory);
  try{
    for(const binding of receipt.frozen_history_replay.bindings)for(const key of ['receipt','response'])await fs.copyFile(path.join(original,binding[key]),path.join(directory,binding[key]));
    verifyFrozenHistoryAuthority(receipt,directory,root);
    for(const width of [0,NaN]){
      const hidden=structuredClone(receipt);hidden.rows[0].measurement.rows.find(row=>row.selector==='#revision-list').rect.width=width;
      assert.throws(()=>verifyFrozenHistoryAuthority(hidden,directory,root),/hidden geometry/u);
    }
    const changed=structuredClone(receipt),binding=changed.frozen_history_replay.bindings[1];
    const bytes=Buffer.from((await fs.readFile(path.join(directory,binding.response),'utf8'))+'\n');
    await fs.writeFile(path.join(directory,binding.response),bytes);
    binding.response_sha256=digest(bytes);
    assert.throws(()=>verifyFrozenHistoryAuthority(changed,directory,root),/native acquisition/u);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});
