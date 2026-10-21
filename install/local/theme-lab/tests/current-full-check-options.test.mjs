import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import {currentFullCheckBackend,currentFullCheckPaths} from '../src/current-full-check-options.mjs';

const root='/tmp/isolated-theme-lab';
const contract={target_site:{origin:'https://scpaiueouiuiuiui.wikijump.localhost:18443'}};

test('fresh full check follows the contracted transport port and uses distinct evidence namespace',()=>{
 const one=currentFullCheckPaths(root,'basalt','basalt-current-20261019',contract);
 assert.equal(one.fixtureUrl,'https://scpaiueouiuiuiui.wikijump.localhost:18443/run-owned%3Atheme-lab-visual-acceptance-imported-20260924');
 assert.equal(one.artifactsDir,path.join(root,'ports/current-acceptance/basalt/runs/basalt-current-20261019/artifacts'));
 assert.equal(one.rawResultPath,path.join(root,'ports/current-acceptance/basalt/runs/basalt-current-20261019/raw-result.json'));
 assert.notEqual(one.runDir,currentFullCheckPaths(root,'basalt','another-task',contract).runDir);
});

test('fresh full check rejects old default, path traversal and nonlocal transports',()=>{
 for(const id of [undefined,'','../../archive','20261007','A-CAPTURE','a/../../b','a'.repeat(60)])
  assert.throws(()=>currentFullCheckPaths(root,'basalt',id,contract),/run-id/u);
 for(const invalid of ['../basalt','basalt/another','theme:basalt',''])
  assert.throws(()=>currentFullCheckPaths(root,invalid,'basalt-current-20261019',contract),/package/u);
 for(const origin of [
  'https://scp-wiki.wikidot.com:18443',
  'http://scpaiueouiuiuiui.wikijump.localhost:18443',
  'https://scpaiueouiuiuiui.wikijump.localhost',
  'https://username@scpaiueouiuiuiui.wikijump.localhost:18443',
  'https://scpaiueouiuiuiui.wikijump.localhost:18443/other',
  'https://scpaiueouiuiuiui.wikijump.localhost:18443/?bypass=1',
  'https://scpaiueouiuiuiui.wikijump.dev.localhost:18443',
 ]) assert.throws(()=>currentFullCheckPaths(root,'basalt','basalt-current-20261019',{target_site:{origin}}),/origin/u);
});

test('current full check CLI fails before network or output writes without a unique run ID',()=>{
 const script=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../scripts/run-current-full-check.mjs');
 for(const args of [['basalt'],['basalt','--run-id=../historic'],['basalt','--run-id=valid-id','--run-id=another-id']]){
  const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:5000});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/run-id/u);
 }
});

test('full check keeps the shared development backend by default and binds a task backend explicitly',()=>{
 assert.deepEqual(currentFullCheckBackend({}),{containerName:'wikijump-local-development-deepwell-1',rpcUrl:null});
 assert.deepEqual(currentFullCheckBackend({backendProject:'wikijump-theme-lab-basalt-current-20261022',rpcUrl:'http://127.0.0.1:3397/jsonrpc'}),
  {containerName:'wikijump-theme-lab-basalt-current-20261022-deepwell-1',rpcUrl:'http://127.0.0.1:3397/jsonrpc'});
});

test('full check task backend fails closed on partial, shared, remote, or credentialed targets',()=>{
 const project='wikijump-theme-lab-basalt-current-20261022';
 assert.throws(()=>currentFullCheckBackend({backendProject:project}),/together/u);
 assert.throws(()=>currentFullCheckBackend({rpcUrl:'http://127.0.0.1:3397/jsonrpc'}),/together/u);
 for(const bad of ['wikijump-local-development','wikijump-standing','wikijump-theme-lab-A','other'])
  assert.throws(()=>currentFullCheckBackend({backendProject:bad,rpcUrl:'http://127.0.0.1:3397/jsonrpc'}),/task-owned/u,bad);
 for(const rpc of ['http://127.0.0.1:2747/jsonrpc','https://127.0.0.1:3397/jsonrpc','http://10.0.0.5:3397/jsonrpc','http://user:pw@127.0.0.1:3397/jsonrpc','http://127.0.0.1/jsonrpc','http://127.0.0.1:3397/other','http://127.0.0.1:3397/jsonrpc?x=1','nope'])
  assert.throws(()=>currentFullCheckBackend({backendProject:project,rpcUrl:rpc}),/rpc-url|loopback|shared/u,rpc);
});

test('current full check reads the token from the bound backend and forwards its RPC URL to the daemon',()=>{
 const source=fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../scripts/run-current-full-check.mjs'),'utf8');
 assert.match(source,/execFileSync\('docker',\['inspect',backend\.containerName,/u);
 assert.doesNotMatch(source,/'inspect','wikijump-local-development-deepwell-1'/u);
 assert.match(source,/daemonArgs\.push\('--rpc-url',backend\.rpcUrl\)/u);
});
