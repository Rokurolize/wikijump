import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const testDir=path.dirname(fileURLToPath(import.meta.url));
const themeLabDir=path.resolve(testDir,'..');
const wrapper=path.join(themeLabDir,'ports/scripts/capture-theme-matrix.mjs');
const canonical=path.join(themeLabDir,'ports/interactive-visual-fixture/capture-theme-matrix.mjs');

function help(script,cwd){
  return spawnSync(process.execPath,[script,'--help'],{cwd,encoding:'utf8'});
}

function invoke(script,cwd,args){
  return spawnSync(process.execPath,[script,...args],{cwd,encoding:'utf8'});
}

test('discoverable matrix entrypoint delegates to the canonical runner from any cwd',()=>{
  const canonicalResult=help(canonical,themeLabDir);
  const wrapperFromPackage=help(wrapper,themeLabDir);
  const wrapperFromRoot=help(wrapper,path.resolve(themeLabDir,'../../..'));
  assert.equal(canonicalResult.status,0,canonicalResult.stderr);
  assert.equal(wrapperFromPackage.status,0,wrapperFromPackage.stderr);
  assert.equal(wrapperFromRoot.status,0,wrapperFromRoot.stderr);
  assert.equal(wrapperFromPackage.stdout,canonicalResult.stdout);
  assert.equal(wrapperFromRoot.stdout,canonicalResult.stdout);
  assert.match(wrapperFromRoot.stdout,/--themes=a,b/u);
  assert.match(wrapperFromRoot.stdout,/--transport=built\|dev/u);
  assert.match(wrapperFromRoot.stdout,/--anonymous/u);
});

test('matrix entrypoint rejects invalid CLI arguments before starting a runtime',()=>{
  const cwd=path.resolve(themeLabDir,'../../..');
  for(const [args,pattern] of [
    [['--theme=bedrock','--theme=basalt'],/duplicate option/u],
    [['--wat'],/unknown argument: --wat/u],
    [['--themes=,'],/themes must be non-empty and unique/u],
    [['--themes=bedrock,bedrock'],/themes must be non-empty and unique/u],
    [['--theme=not-a-theme'],/requested theme is not registered/u],
    [['--theme=bedrock','--state='],/states must be non-empty/u],
    [['--theme=bedrock','--themes=basalt'],/exactly one of --theme or --themes is required/u],
    [['--theme=bedrock','--jobs=0'],/--jobs must be an integer from 1 to 9/u],
    [['--theme=bedrock','--transport=bogus'],/--transport must be built or dev/u]
  ]){
    const result=invoke(wrapper,cwd,args);
    assert.notEqual(result.status,0,`unexpected success for ${args.join(' ')}`);
    assert.match(result.stderr,pattern);
  }
});
