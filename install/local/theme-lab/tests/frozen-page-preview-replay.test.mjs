import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateFrozenPagePreview} from '../src/frozen-page-preview-replay.mjs';
const receiptBytes=fs.readFileSync(new URL('./fixtures/native-page-preview/receipt.json',import.meta.url));
const responseBytes=fs.readFileSync(new URL('./fixtures/native-page-preview/response.json',import.meta.url));
const url='https://scp-jp.wikidot.com/scp-173';
test('native preview retains anonymous source and response identity',()=>{
  const entry=validateFrozenPagePreview({receiptBytes,responseBytes},url);
  assert.equal((entry.body.match(/<table class="wiki-content-table">/gu)??[]).length,4);
  assert.match(entry.body,/YAHOO.widget.TabView/u);
});
test('native preview refuses mutation, cross-site reuse, source drift and response drift',()=>{
  assert.throws(()=>validateFrozenPagePreview({receiptBytes,responseBytes},'https://scp-wiki.wikidot.com/scp-173'),/native read acquisition/u);
  for(const change of [receipt=>receipt.public_writes=1,receipt=>receipt.actor='authenticated',receipt=>receipt.request.moduleName='edit/PageSaveModule',receipt=>receipt.request.source+='\nchanged']){
    const receipt=JSON.parse(receiptBytes);change(receipt);
    assert.throws(()=>validateFrozenPagePreview({receiptBytes:Buffer.from(JSON.stringify(receipt)),responseBytes},url),/native read acquisition/u);
  }
  assert.throws(()=>validateFrozenPagePreview({receiptBytes,responseBytes:Buffer.concat([responseBytes,Buffer.from('\n')])},url),/native read acquisition/u);
});
