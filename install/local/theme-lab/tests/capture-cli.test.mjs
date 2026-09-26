import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const testDir=path.dirname(fileURLToPath(import.meta.url));
const capture=path.join(testDir,'../ports/interactive-visual-fixture/capture-interactive.mjs');

function invoke(...args){
 return spawnSync(process.execPath,[capture,...args],{cwd:os.tmpdir(),encoding:'utf8',timeout:20000});
}

test('capture CLI reports usage without requiring a runtime',()=>{
 const result=invoke('--help');
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/--state=surface\.state/u);
 assert.match(result.stdout,/--anonymous/u);
});

test('capture CLI rejects malformed or unknown state selections before launching a browser',()=>{
 for(const [args,pattern] of [
  [['--theme=flopstyle-dark','--anonymous','--state='],/states must be non-empty/u],
  [['--theme=flopstyle-dark','--anonymous','--state=page.normal.settled,'],/states must be non-empty/u],
  [['--theme=flopstyle-dark','--anonymous','--state=not.a.state'],/unknown capture state/u],
  [['--theme=flopstyle-dark','--anonymous','--wat'],/unknown argument/u]
 ]){
  const result=invoke(...args);
  assert.notEqual(result.status,0,`unexpected success for ${args.join(' ')}`);
  assert.match(result.stderr,pattern);
 }
});
