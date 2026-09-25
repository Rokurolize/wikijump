#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const tokens=/@@|\[\[code(?:\s+[^\]]*)?\]\]|\[\[\/code\]\]|\[\[iftags(?:\s+[^\]]+)?\]\]|\[\[\/iftags\]\]|\[\[ift\{[^}]+\}gs(?:\s+[^\]]+)?\]\]|\[\[\/ift\{[^}]+\}gs\]\]|\[\[module\s+CSS\]\]|\[\[\/module\]\]/giu;

export function extractUnconditionalCssModules(source,{activeTags=[]}={}){
  const output=[];
  const tags=new Set(activeTags.map(tag=>String(tag).toLowerCase()));
  const conditions=[];
  let inCode=false;
  let inEscapedCode=false;
  let moduleStart=-1;
  for(const match of source.matchAll(tokens)){
    const token=match[0].toLowerCase();
    const at=match.index;
    if(token==='@@'){inEscapedCode=!inEscapedCode;continue;}
    if(token.startsWith('[[code')){inCode=true;continue;}
    if(token==='[[/code]]'){inCode=false;continue;}
    if(inCode||inEscapedCode)continue;
    if(token==='[[iftags]]'||token.startsWith('[[iftags ')){
      const expression=token.slice('[[iftags'.length,-2).trim();
      const terms=expression.split(/\s+/u).filter(Boolean);
      const active=terms.length>0&&terms.every(term=>{
        if(term.startsWith('+'))return tags.has(term.slice(1));
        if(term.startsWith('-'))return !tags.has(term.slice(1));
        return false;
      });
      conditions.push(active);continue;
    }
    if(token.startsWith('[[ift{')){conditions.push(false);continue;}
    if(token==='[[/iftags]]'||token.startsWith('[[/ift{')){conditions.pop();continue;}
    if(token==='[[module css]]'){moduleStart=match.index+match[0].length;continue;}
    if(token==='[[/module]]'&&moduleStart>=0){
      if(conditions.every(Boolean))output.push(source.slice(moduleStart,at));
      moduleStart=-1;
    }
  }
  if(moduleStart>=0)throw new Error('Unterminated [[module CSS]] block');
  if(!output.length)throw new Error('No unconditional CSS modules found');
  return output.join('\n\n').trim()+'\n';
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  const value=name=>{const i=args.indexOf(name);if(i<0||!args[i+1])throw new Error(`missing ${name} <path>`);return args[i+1]};
  const input=value('--input');
  const output=value('--output');
  const tagIndex=args.indexOf('--tags');
  const activeTags=tagIndex>=0?(args[tagIndex+1]??'').split(',').filter(Boolean):[];
  const css=extractUnconditionalCssModules(await fs.readFile(input,'utf8'),{activeTags});
  await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.writeFile(output,css);
  console.log(JSON.stringify({input,output,active_tags:activeTags,bytes:Buffer.byteLength(css)}));
}
