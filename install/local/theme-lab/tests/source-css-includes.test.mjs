import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {sourceCssIncludes} from '../src/source-css-includes.mjs';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
test('binds source include CSS and rejects altered CSS or escaped documentation examples',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'theme-source-includes-'));try{
 const source='[[module CSS show="true"]] .source { color: red; } [[/module]]',css='.source { color: red; }\n',include='[[include :scp-wiki:component:example]]';
 const spec={schema:'theme_lab_source_css_includes.v1',authority:'RUNTIME_INDEPENDENT',candidate_source:'candidate.txt',upstream_source:'upstream.txt',includes:[{locator:'component:example',kind:'unconditional-modules',source:{path:'component.txt',sha256:sha(source)},css:{path:'component.css',sha256:sha(css)}}]};
 await Promise.all(Object.entries({'candidate.txt':include,'upstream.txt':include,'component.txt':source,'component.css':css,'source-css-includes.json':JSON.stringify(spec)}).map(([name,value])=>fs.writeFile(path.join(dir,name),value)));
 assert.equal(await sourceCssIncludes(dir),css);await fs.writeFile(path.join(dir,'component.css'),'.changed{}');await assert.rejects(sourceCssIncludes(dir),/differs from frozen source/);await fs.writeFile(path.join(dir,'component.css'),css);await fs.writeFile(path.join(dir,'upstream.txt'),'@@'+include+'@@');await assert.rejects(sourceCssIncludes(dir),/absent from preserved source/);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
