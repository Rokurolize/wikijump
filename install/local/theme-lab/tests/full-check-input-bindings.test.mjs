import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import {fullCheckInputBindings,currentPackageFullCheckInputBindings} from '../src/full-check-input-bindings.mjs';

const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

test('full-check bindings canonicalize object key order but preserve semantic array order',()=>{
  const left=fullCheckInputBindings({
    selectors:['#a','#b'],
    surfaceContract:{schema:'theme_lab_surface_contract.v1',strict:true,custom_selectors:[{id:'x',selector:'.x',viewports:['mobile']}],reviewed_exceptions:[]},
    sourceStructure:{sha256:'a'.repeat(64)},
    pageAssets:[{filename:'x.png',sha256:'b'.repeat(64)}],
    referenceUrl:'https://example.test/theme',
  });
  const reordered=fullCheckInputBindings({
    referenceUrl:'https://example.test/theme',
    pageAssets:[{sha256:'b'.repeat(64),filename:'x.png'}],
    sourceStructure:{sha256:'a'.repeat(64)},
    surfaceContract:{reviewed_exceptions:[],custom_selectors:[{viewports:['mobile'],selector:'.x',id:'x'}],strict:true,schema:'theme_lab_surface_contract.v1'},
    selectors:['#a','#b'],
  });
  assert.equal(left.sha256,reordered.sha256);
  assert.notEqual(left.sha256,fullCheckInputBindings({...left,selectors:['#b','#a']}).sha256);
});

test('current package bindings change when any maintained full-check input changes',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-full-check-bindings-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const ports=path.join(root,'ports'),dir=path.join(ports,'example');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(ports,'shared-acceptance-selectors.txt'),'#page-content\n');
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({reference_url:'https://example.test/theme'}));
  const first=currentPackageFullCheckInputBindings(root,'example');

  fs.appendFileSync(path.join(ports,'shared-acceptance-selectors.txt'),'.extra\n');
  const selectors=currentPackageFullCheckInputBindings(root,'example');assert.notEqual(selectors.sha256,first.sha256);

  fs.writeFileSync(path.join(dir,'surface-contract.json'),JSON.stringify({schema:'theme_lab_surface_contract.v1',strict:true,custom_selectors:[{id:'extra',selector:'.extra'}],reviewed_exceptions:[]}));
  const surface=currentPackageFullCheckInputBindings(root,'example');assert.notEqual(surface.sha256,selectors.sha256);

  fs.writeFileSync(path.join(dir,'acceptance-structure.json'),JSON.stringify({schema:'theme_lab_source_owned_structure.v1',authority:'SOURCE_THEME'}));
  const structure=currentPackageFullCheckInputBindings(root,'example');assert.notEqual(structure.sha256,surface.sha256);

  const pageAsset=Buffer.from('maintained page asset'),pageAssetSha=digest(pageAsset),pageAssetFile=`${pageAssetSha}.png`;
  fs.mkdirSync(path.join(ports,'shared-replay-assets'),{recursive:true});fs.writeFileSync(path.join(ports,'shared-replay-assets',pageAssetFile),pageAsset);
  fs.mkdirSync(path.join(dir,'page-assets'),{recursive:true});fs.writeFileSync(path.join(dir,'page-assets','example.png'),pageAsset);
  fs.writeFileSync(path.join(dir,'page-assets.json'),JSON.stringify({assets:[{filename:'example.png',asset_file:pageAssetFile,sha256:pageAssetSha}]}));
  const assets=currentPackageFullCheckInputBindings(root,'example');assert.notEqual(assets.sha256,structure.sha256);

  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({reference_url:'https://example.test/other-theme'}));
  const reference=currentPackageFullCheckInputBindings(root,'example');assert.notEqual(reference.sha256,assets.sha256);
});

test('current package bindings reject stale page-asset bytes even when the manifest is unchanged',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-page-asset-currentness-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const ports=path.join(root,'ports'),dir=path.join(ports,'example'),pool=path.join(ports,'shared-replay-assets'),published=path.join(dir,'page-assets');
  fs.mkdirSync(pool,{recursive:true});fs.mkdirSync(published,{recursive:true});
  fs.writeFileSync(path.join(ports,'shared-acceptance-selectors.txt'),'#page-content\n');
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({reference_url:'https://example.test/theme'}));
  const bytes=Buffer.from('page attachment'),assetSha=digest(bytes),assetFile=`${assetSha}.png`;
  fs.writeFileSync(path.join(pool,assetFile),bytes);fs.writeFileSync(path.join(published,'example.png'),bytes);
  fs.writeFileSync(path.join(dir,'page-assets.json'),JSON.stringify({assets:[{filename:'example.png',asset_file:assetFile,sha256:assetSha}]}));
  assert.doesNotThrow(()=>currentPackageFullCheckInputBindings(root,'example'));
  fs.writeFileSync(path.join(pool,assetFile),'corrupt shared bytes');
  assert.throws(()=>currentPackageFullCheckInputBindings(root,'example'),/shared page asset is missing or stale/u);
  fs.writeFileSync(path.join(pool,assetFile),bytes);fs.writeFileSync(path.join(published,'example.png'),'corrupt publishable bytes');
  assert.throws(()=>currentPackageFullCheckInputBindings(root,'example'),/publishable page asset is missing or stale/u);
});

test('current package bindings reject package input symlinks escaping maintained roots',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-full-check-symlink-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-full-check-outside-'));
  t.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true})});
  const ports=path.join(root,'ports'),dir=path.join(ports,'example');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(ports,'shared-acceptance-selectors.txt'),'#page-content\n');
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({reference_url:'https://example.test/theme'}));
  const outsideSelectors=path.join(outside,'selectors.txt');fs.writeFileSync(outsideSelectors,'.outside\n');fs.symlinkSync(outsideSelectors,path.join(dir,'acceptance-selectors.txt'));
  assert.throws(()=>currentPackageFullCheckInputBindings(root,'example'),/acceptance selectors escapes package/u);
});

test('current package bindings reject a package directory symlink outside ports',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-full-check-package-dir-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-full-check-package-outside-'));t.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true})});
  const ports=path.join(root,'ports'),external=path.join(outside,'example');fs.mkdirSync(ports,{recursive:true});fs.mkdirSync(external,{recursive:true});
  fs.writeFileSync(path.join(ports,'shared-acceptance-selectors.txt'),'#page-content\n');fs.writeFileSync(path.join(external,'manifest.json'),JSON.stringify({reference_url:'https://example.test/theme'}));fs.symlinkSync(external,path.join(ports,'example'));
  assert.throws(()=>currentPackageFullCheckInputBindings(root,'example'),/package directory escapes ports root/u);
});

test('package selector whitespace normalizes to the exact selector list consumed by the CLI',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-selector-binding-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const ports=path.join(root,'ports'),dir=path.join(ports,'example');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(ports,'shared-acceptance-selectors.txt'),'  #page-content  \n\n .side-block\n');
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({source_url:'https://example.test/theme'}));
  const whitespace=currentPackageFullCheckInputBindings(root,'example');
  fs.writeFileSync(path.join(ports,'shared-acceptance-selectors.txt'),'#page-content\n.side-block\n');
  const normalized=currentPackageFullCheckInputBindings(root,'example');
  assert.equal(whitespace.sha256,normalized.sha256);
});
