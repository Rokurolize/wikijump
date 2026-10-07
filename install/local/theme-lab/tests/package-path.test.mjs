import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {prepareCanonicalChildOutputDirectory,prepareContainedOutputDirectory,prepareContainedOutputFile,resolveContainedPathWithoutSymlinks,resolveExistingContainedDirectory,resolveExistingContainedFileWithoutSymlinks,resolveExistingPackageDirectory,resolveExistingPackageFile} from '../src/package-path.mjs';

test('package files stay inside their package, including through symlinks',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-package-path-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pkg=path.join(root,'package'),other=path.join(root,'other');fs.mkdirSync(path.join(pkg,'nested'),{recursive:true});fs.mkdirSync(other);
  fs.writeFileSync(path.join(pkg,'nested','source.txt'),'inside');fs.writeFileSync(path.join(other,'source.txt'),'outside');
  assert.equal(resolveExistingPackageFile(pkg,'nested/source.txt'),path.join(pkg,'nested','source.txt'));
  assert.throws(()=>resolveExistingPackageFile(pkg,'../other/source.txt'),/escapes package/u);
  assert.throws(()=>resolveExistingPackageFile(pkg,path.join(other,'source.txt')),/relative package path/u);
  fs.symlinkSync(path.join(other,'source.txt'),path.join(pkg,'linked-source.txt'));
  assert.throws(()=>resolveExistingPackageFile(pkg,'linked-source.txt'),/escapes package/u);
});

test('contained directories reject lexical and symlink escapes',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-contained-dir-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-contained-outside-'));t.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true})});
  fs.mkdirSync(path.join(root,'inside'));fs.mkdirSync(path.join(outside,'dir'));fs.symlinkSync(path.join(outside,'dir'),path.join(root,'linked'));
  assert.equal(resolveExistingContainedDirectory(root,'inside'),path.join(root,'inside'));
  assert.throws(()=>resolveExistingContainedDirectory(root,'../escape'),/escapes root/u);
  assert.throws(()=>resolveExistingContainedDirectory(root,'linked'),/escapes root/u);
});

test('package directories must be single contained children of the ports root',t=>{
  const ports=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-ports-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-package-outside-'));t.after(()=>{fs.rmSync(ports,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true})});
  fs.mkdirSync(path.join(ports,'valid'));fs.mkdirSync(path.join(outside,'external'));fs.symlinkSync(path.join(outside,'external'),path.join(ports,'linked'));
  assert.equal(resolveExistingPackageDirectory(ports,'valid'),path.join(ports,'valid'));
  assert.throws(()=>resolveExistingPackageDirectory(ports,'../escape'),/invalid package name/u);
  assert.throws(()=>resolveExistingPackageDirectory(ports,'linked'),/escapes ports root/u);
});

test('contained outputs reject symlinked parent directories outside the root',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-output-root-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-output-outside-'));t.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true})});
  fs.mkdirSync(path.join(outside,'dir'));fs.symlinkSync(path.join(outside,'dir'),path.join(root,'linked'));
  assert.throws(()=>prepareContainedOutputDirectory(root,'linked/new-dir'),/escapes root/u);
  assert.throws(()=>prepareContainedOutputFile(root,'linked/result.json'),/escapes root/u);
  assert.equal(prepareContainedOutputDirectory(root,'inside/new-dir'),path.join(root,'inside/new-dir'));
  assert.equal(prepareContainedOutputFile(root,'inside/result.json'),path.join(root,'inside/result.json'));
});

test('contained output files reject an existing symlink target',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-output-file-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-output-file-outside-'));t.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true})});
  const external=path.join(outside,'result.json');fs.writeFileSync(external,'outside');fs.symlinkSync(external,path.join(root,'result.json'));
  assert.throws(()=>prepareContainedOutputFile(root,'result.json'),/must not be a symlink/u);
  assert.equal(fs.readFileSync(external,'utf8'),'outside');
});

test('canonical child outputs reject aliases, sibling names, and symlinked children',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-canonical-output-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const expected=path.join(root,'fixture');
  assert.equal(prepareCanonicalChildOutputDirectory(root,'fixture',expected),expected);
  assert.throws(()=>prepareCanonicalChildOutputDirectory(root,'fixture',path.join(root,'other')),/must be the canonical child/u);
  fs.rmSync(expected,{recursive:true,force:true});fs.mkdirSync(path.join(root,'actual'));fs.symlinkSync(path.join(root,'actual'),expected);
  assert.throws(()=>prepareCanonicalChildOutputDirectory(root,'fixture',expected),/must not be a symlink/u);
});

test('symlink-free contained files reject both final and parent symlinks',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-nosymlink-read-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'actual'));fs.writeFileSync(path.join(root,'actual','audit.json'),'{}');
  assert.equal(resolveExistingContainedFileWithoutSymlinks(root,'actual/audit.json'),path.join(root,'actual','audit.json'));
  fs.symlinkSync(path.join(root,'actual','audit.json'),path.join(root,'linked.json'));
  assert.throws(()=>resolveExistingContainedFileWithoutSymlinks(root,'linked.json'),/must not traverse symlinks/u);
  fs.symlinkSync(path.join(root,'actual'),path.join(root,'linked-dir'));
  assert.throws(()=>resolveExistingContainedFileWithoutSymlinks(root,'linked-dir/audit.json'),/must not traverse symlinks/u);
});

test('symlink-free contained paths allow missing leaves but reject escapes',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'theme-lab-nosymlink-path-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'inside'));
  assert.equal(resolveContainedPathWithoutSymlinks(root,'inside/missing.png'),path.join(root,'inside','missing.png'));
  assert.throws(()=>resolveContainedPathWithoutSymlinks(root,'../outside.png'),/escapes root/u);
  fs.symlinkSync(path.join(root,'inside'),path.join(root,'linked'));
  assert.throws(()=>resolveContainedPathWithoutSymlinks(root,'linked/missing.png'),/must not traverse symlinks/u);
});
