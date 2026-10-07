import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {extractUnconditionalCssModules} from '../ports/scripts/extract-css-modules.mjs';
import {resolveExistingPackageFile} from './package-path.mjs';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export async function sourceCssIncludes(directory){
 let spec;try{spec=JSON.parse(await fs.readFile(path.join(directory,'source-css-includes.json'),'utf8'))}catch(error){if(error.code==='ENOENT')return null;throw error}
 if(spec.schema!=='theme_lab_source_css_includes.v1'||spec.authority!=='RUNTIME_INDEPENDENT'||!spec.includes?.length)throw new Error('Unsupported source CSS include resolution');
 const read=async name=>fs.readFile(resolveExistingPackageFile(directory,name,'Include source'),'utf8');
 const candidate=await read(spec.candidate_source);
 const upstream=await read(spec.upstream_source);
 const css=[];
 const directives=text=>text.split(/\r?\n/u).map(line=>line.trim()).filter(line=>/^\[\[include\s/iu.test(line));
 const matching=(text,locator)=>directives(text).filter(line=>{
  const page=line.slice('[[include'.length,-2).trim().split(/\s+/u)[0];
  return page===locator||page.endsWith(`:${locator}`);
 });
 const includeKeys=new Set();
 for(const include of spec.includes){
  if(typeof include.locator!=='string'||!include.locator)throw new Error('Invalid source include locator');
  if(includeKeys.has(include.locator))throw new Error('Duplicate source include resolution');
  includeKeys.add(include.locator);
  const candidateIncludes=matching(candidate,include.locator),upstreamIncludes=matching(upstream,include.locator);
  if(candidateIncludes.length!==1||upstreamIncludes.length!==1)throw new Error('Source include locator must occur exactly once in preserved source');
  const source=await read(include.source.path);if(sha(source)!==include.source.sha256)throw new Error('Stale include source');
  const blocks=[...source.matchAll(/\[\[code\s+type="css"\]\]([\s\S]*?)\[\[\/code\]\]/giu)];
  const block=blocks[include.code_index-1];
  if(include.kind!=='unconditional-modules'&&!block)throw new Error('Missing source CSS code block');
  let input=include.kind==='unconditional-modules'?extractUnconditionalCssModules(source):block[1].trim()+'\n';for(const [key,value] of Object.entries(include.parameters??{})){
   const binds=(line)=>line.slice('[[include'.length,-2).trim().split(/\s+/u).includes(`${key}=${value}`);
   if(!binds(candidateIncludes[0])||!binds(upstreamIncludes[0]))throw new Error('Unbound source include parameter');
   input=input.replaceAll('{$'+key+'}',value);
  }
  if(sha(input)!==include.css.sha256||input!==await read(include.css.path))throw new Error('Source include CSS differs from frozen source');
  css.push(input);
 }
 return css.join('\n');
}
