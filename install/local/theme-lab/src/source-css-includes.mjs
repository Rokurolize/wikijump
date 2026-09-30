import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {extractUnconditionalCssModules} from '../ports/scripts/extract-css-modules.mjs';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export async function sourceCssIncludes(directory){
 let spec;try{spec=JSON.parse(await fs.readFile(path.join(directory,'source-css-includes.json'),'utf8'))}catch(error){if(error.code==='ENOENT')return null;throw error}
 if(spec.schema!=='theme_lab_source_css_includes.v1'||spec.authority!=='RUNTIME_INDEPENDENT'||!spec.includes?.length)throw new Error('Unsupported source CSS include resolution');
 const read=async name=>{const file=path.resolve(directory,name);if(!file.startsWith(path.resolve(directory)+path.sep))throw new Error('Include source escapes package');return fs.readFile(file,'utf8')};
 const candidate=await read(spec.candidate_source);
 const upstream=await read(spec.upstream_source);
 const css=[];
 for(const include of spec.includes){
  const hasInclude=text=>text.split('\n').some(line=>/^\[\[include\s/iu.test(line.trim())&&line.includes(include.locator));
  if(!hasInclude(candidate)||!hasInclude(upstream))throw new Error('Source include locator is absent from preserved source');
  const source=await read(include.source.path);if(sha(source)!==include.source.sha256)throw new Error('Stale include source');
  const blocks=[...source.matchAll(/\[\[code\s+type="css"\]\]([\s\S]*?)\[\[\/code\]\]/giu)];
  const block=blocks[include.code_index-1];
  if(include.kind!=='unconditional-modules'&&!block)throw new Error('Missing source CSS code block');
  let input=include.kind==='unconditional-modules'?extractUnconditionalCssModules(source):block[1].trim()+'\n';for(const [key,value] of Object.entries(include.parameters??{})){
   if(![candidate,upstream].every(text=>text.split('\n').some(line=>/^\[\[include\s/iu.test(line.trim())&&line.includes(include.locator)&&line.includes(`${key}=${value}`))))throw new Error('Unbound source include parameter');
   input=input.replaceAll('{$'+key+'}',value);
  }
  if(sha(input)!==include.css.sha256||input!==await read(include.css.path))throw new Error('Source include CSS differs from frozen source');
  css.push(input);
 }
 return css.join('\n');
}
