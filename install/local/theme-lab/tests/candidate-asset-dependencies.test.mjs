import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import {candidateAssetDependencyState} from '../src/candidate-asset-dependencies.mjs';

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

test('candidate asset dependency state follows nested content-addressed CSS with stable ordering',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-assets-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const ports=path.join(root,'ports'),theme=path.join(ports,'example'),shared=path.join(ports,'shared-replay-assets');
  fs.mkdirSync(path.join(theme,'page-assets'),{recursive:true});fs.mkdirSync(shared,{recursive:true});
  const nestedName='a'.repeat(64)+'.css',imageName='b'.repeat(64)+'.png',fontName='c'.repeat(64)+'.woff2';
  fs.writeFileSync(path.join(shared,imageName),'image-bytes');
  fs.writeFileSync(path.join(theme,'page-assets',fontName),'font-bytes');
  fs.writeFileSync(path.join(shared,nestedName),`.nested{background:url(${imageName})}@font-face{src:url(${fontName})}`);
  const state=candidateAssetDependencyState({portsDir:ports,themeDir:theme,candidateCss:`@import url(${nestedName});`});
  assert.deepEqual(state.referenced_asset_names,[nestedName,imageName,fontName].sort());
  assert.deepEqual(state.asset_dependencies,[nestedName,imageName,fontName].sort().map(name=>{
    const file=name===fontName?path.join(theme,'page-assets',name):path.join(shared,name);
    return {name,sha256:sha(fs.readFileSync(file)),status:'local-cache'};
  }));
  assert.equal(state.asset_dependency_sha256,sha(Buffer.from(JSON.stringify(state.asset_dependencies))));
});

test('candidate asset dependency state records missing referenced assets fail-closed',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-assets-missing-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const ports=path.join(root,'ports'),theme=path.join(ports,'example');fs.mkdirSync(theme,{recursive:true});
  const missing='d'.repeat(64)+'.svg';
  const state=candidateAssetDependencyState({portsDir:ports,themeDir:theme,candidateSource:`[[image /${missing}]]`});
  assert.deepEqual(state.asset_dependencies,[{name:missing,sha256:null,status:'missing'}]);
});

test('candidate asset dependencies bind package-local ./assets references',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-assets-legacy-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const ports=path.join(root,'ports'),theme=path.join(ports,'example'),assets=path.join(theme,'assets');fs.mkdirSync(assets,{recursive:true});
  fs.writeFileSync(path.join(assets,'header-logo.png'),'legacy-image-bytes');
  const state=candidateAssetDependencyState({portsDir:ports,themeDir:theme,candidateCss:'header{background:url("./assets/header-logo.png")}'});
  assert.deepEqual(state.referenced_asset_names,['header-logo.png']);
  assert.deepEqual(state.asset_dependencies,[{name:'header-logo.png',sha256:sha(Buffer.from('legacy-image-bytes')),status:'local-cache'}]);
});

test('candidate asset dependencies reject symlinks escaping local asset roots',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-assets-symlink-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-assets-outside-'));t.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true})});
  const ports=path.join(root,'ports'),theme=path.join(ports,'example'),shared=path.join(ports,'shared-replay-assets');fs.mkdirSync(theme,{recursive:true});fs.mkdirSync(shared,{recursive:true});
  const name='e'.repeat(64)+'.png',outsideFile=path.join(outside,name);fs.writeFileSync(outsideFile,'external bytes');fs.symlinkSync(outsideFile,path.join(shared,name));
  assert.throws(()=>candidateAssetDependencyState({portsDir:ports,themeDir:theme,candidateCss:`a{background:url(${name})}`}),/escapes root/u);
});
