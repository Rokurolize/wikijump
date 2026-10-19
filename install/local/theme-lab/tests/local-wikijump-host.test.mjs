import assert from 'node:assert/strict';
import test from 'node:test';

import {isLocalWikijumpHostname,isSiteLocalWikijumpHostname} from '../src/local-wikijump-host.mjs';

test('standing, task, and development hosts are recognized as local Wikijump hosts',()=>{
  for(const host of ['scp-wiki.wikijump.localhost','scpaiueouiuiuiui.wikijump.localhost','.wikijump.localhost','scpaiueouiuiuiui.wikijump.dev.localhost','.wikijump.dev.localhost','x.wikijump.a.b.localhost'])
    assert.equal(isLocalWikijumpHostname(host),true,host);
});

test('foreign and malformed hosts are rejected',()=>{
  for(const host of ['wikijump.localhost','example.com','scp-wiki.wikijump.localhost.example.com','evilwikijump.localhost','wikijump.dev.localhost',undefined,null,42])
    assert.equal(isLocalWikijumpHostname(host),false,String(host));
});

test('site identity is preserved across both local environments',()=>{
  assert.equal(isSiteLocalWikijumpHostname('scpaiueouiuiuiui.wikijump.localhost','scpaiueouiuiuiui'),true);
  assert.equal(isSiteLocalWikijumpHostname('scpaiueouiuiuiui.wikijump.dev.localhost','scpaiueouiuiuiui'),true);
  assert.equal(isSiteLocalWikijumpHostname('scp-wiki.wikijump.dev.localhost','scpaiueouiuiuiui'),false);
});
