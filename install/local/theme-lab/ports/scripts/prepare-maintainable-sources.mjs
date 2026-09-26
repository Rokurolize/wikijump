#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {parseStyleSheet,stripCssComments} from '../../src/css-probe.mjs';
import {extractSCPJPAdaptationBlocks} from '../../src/port-maintenance.mjs';
import {extractUnconditionalCssModules} from './extract-css-modules.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const portsDir=path.dirname(here);
const MODULE_RE=/\[\[module\s+CSS\]\]([\s\S]*?)\[\[\/module\]\]/giu;
const COMMENT_RE=/\/\*([\s\S]*?)\*\//gu;

const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');

function markerMatch(css){
  for(const match of css.matchAll(COMMENT_RE)){
    const normalized=match[1].replace(/\s+/gu,' ').trim();
    if(/^SCP-JP\b/iu.test(normalized))return {...match,normalized};
  }
  return null;
}

function rationaleFor(css,marker){
  const comments=[...css.matchAll(COMMENT_RE)].map(match=>match[1].replace(/\s+/gu,' ').trim()).filter(Boolean);
  const index=comments.indexOf(marker.normalized);
  return comments.slice(index+1).find(comment=>comment!==marker.normalized)??marker.normalized;
}

function cleanOverlayBlock(css,marker){
  const rationale=rationaleFor(css,marker);
  if(rationale===marker.normalized)return css.trim();
  return `${css.slice(0,marker.index)}${css.slice(marker.index+marker[0].length)}`.trim();
}

function collapseWhitespaceOutsideStrings(text){
  let out='';
  let quote=null;
  let pendingSpace=false;
  for(let i=0;i<text.length;i+=1){
    const char=text[i];
    if(quote!==null){
      out+=char;
      if(char==='\\'){
        out+=text[i+1]??'';
        i+=1;
      }else if(char===quote)quote=null;
      continue;
    }
    if(char==='"'||char==="'"){
      if(pendingSpace&&out&&!/\s/u.test(out.at(-1)))out+=' ';
      pendingSpace=false;
      quote=char;
      out+=char;
      continue;
    }
    if(/\s/u.test(char)){
      pendingSpace=true;
      continue;
    }
    if(pendingSpace&&out&&!/\s/u.test(out.at(-1)))out+=' ';
    pendingSpace=false;
    out+=char;
  }
  return out.trim();
}

function stripInsignificantPunctuationWhitespace(text){
  let out='';
  let quote=null;
  const punctuation=new Set(['{','}',':',';',',']);
  for(let i=0;i<text.length;i+=1){
    const char=text[i];
    if(quote!==null){
      out+=char;
      if(char==='\\'){
        out+=text[i+1]??'';
        i+=1;
      }else if(char===quote)quote=null;
      continue;
    }
    if(char==='"'||char==="'"){
      quote=char;
      out+=char;
      continue;
    }
    if(char===' '){
      const previous=out.at(-1)??'';
      const next=text[i+1]??'';
      if(punctuation.has(previous)||punctuation.has(next))continue;
    }
    out+=char;
  }
  return out;
}

export function semanticCssIdentity(css){
  return stripInsignificantPunctuationWhitespace(collapseWhitespaceOutsideStrings(stripCssComments(css)));
}

const UNSUPPORTED_COMPACTION_AT_RULE=/@(?:charset|import|namespace|font-face|(?:-[\w]+-)?keyframes|page|property|counter-style|font-feature-values)\b/iu;

function ruleFingerprint(rule){
  return JSON.stringify([
    rule.atContext??[],
    rule.selector,
    semanticCssIdentity(rule.body??''),
  ]);
}

function indent(text,prefix='  '){
  return text.split('\n').map(line=>`${prefix}${line}`).join('\n');
}

function sameContext(left,right){
  return JSON.stringify(left??[])===JSON.stringify(right??[]);
}

function groupOriginalSelectorRules(rules){
  const groups=[];
  for(const rule of rules){
    const previous=groups.at(-1);
    const bodyIdentity=semanticCssIdentity(rule.body??'');
    if(previous&&sameContext(previous.atContext,rule.atContext)&&previous.prelude===rule.prelude&&previous.bodyIdentity===bodyIdentity){
      previous.selectors.push(rule.selector);
      continue;
    }
    groups.push({
      selectors:[rule.selector],
      prelude:rule.prelude,
      atContext:rule.atContext??[],
      body:rule.body??'',
      bodyIdentity,
    });
  }
  return groups;
}

function renderSelectorGroup(group){
  const body=group.body.trim();
  const selectors=group.selectors.join(',\n');
  return body?`${selectors} {\n${indent(body)}\n}`:`${selectors} {}`;
}

function wrapAtContext(rendered,atContext){
  let result=rendered;
  for(const context of [...atContext].reverse())result=`${context} {\n${indent(result)}\n}`;
  return result;
}

function renderRules(rules){
  const groups=groupOriginalSelectorRules(rules);
  const runs=[];
  for(const group of groups){
    const previous=runs.at(-1);
    if(previous&&sameContext(previous.atContext,group.atContext)){
      previous.groups.push(group);
      continue;
    }
    runs.push({atContext:group.atContext,groups:[group]});
  }
  return runs.map(run=>wrapAtContext(run.groups.map(renderSelectorGroup).join('\n\n'),run.atContext)).join('\n\n');
}

function preservedComments(css){
  const comments=[];
  for(const match of css.matchAll(COMMENT_RE)){
    const comment=match[1].replace(/\s+/gu,' ').trim();
    if(comment&&!comments.includes(comment))comments.push(comment);
  }
  return comments;
}

export function canonicalExactRuleIdentity(css){
  if(UNSUPPORTED_COMPACTION_AT_RULE.test(stripCssComments(css)))throw new Error('JP override contains an at-rule that the exact-rule compactor cannot safely rewrite');
  const rules=parseStyleSheet(css);
  const fingerprints=rules.map(ruleFingerprint);
  const last=new Map();
  fingerprints.forEach((fingerprint,index)=>last.set(fingerprint,index));
  return JSON.stringify(fingerprints.filter((fingerprint,index)=>last.get(fingerprint)===index));
}

export function compactExactDuplicateRules(overlays){
  const entries=[];
  for(const [blockIndex,block] of overlays.entries()){
    if(UNSUPPORTED_COMPACTION_AT_RULE.test(stripCssComments(block.css)))throw new Error(`adaptation block ${block.marker} contains an at-rule the compactor cannot safely rewrite`);
    for(const rule of parseStyleSheet(block.css))entries.push({blockIndex,rule,fingerprint:ruleFingerprint(rule)});
  }
  const last=new Map();
  entries.forEach((entry,index)=>last.set(entry.fingerprint,index));
  const keptByBlock=new Map();
  let removed=0;
  entries.forEach((entry,index)=>{
    if(last.get(entry.fingerprint)!==index){removed+=1;return;}
    const rows=keptByBlock.get(entry.blockIndex)??[];
    rows.push(entry.rule);
    keptByBlock.set(entry.blockIndex,rows);
  });
  const rendered=[];
  for(const [blockIndex,block] of overlays.entries()){
    const rules=keptByBlock.get(blockIndex)??[];
    if(!rules.length)continue;
    const comments=preservedComments(block.css);
    const parts=[];
    if(comments.length)parts.push(comments.map(comment=>`/* ${comment} */`).join('\n'));
    parts.push(renderRules(rules));
    rendered.push(parts.join('\n'));
  }
  const css=rendered.join('\n\n').trim();
  const raw=overlays.map(block=>block.css).filter(Boolean).join('\n\n').trim();
  if(canonicalExactRuleIdentity(raw)!==canonicalExactRuleIdentity(css))throw new Error('exact duplicate compaction changed the canonical JP override rule cascade');
  return {css:css+(css?'\n':''),removed,raw_rule_count:entries.length,canonical_rule_count:entries.length-removed};
}

export function splitMaintainableCandidate(source,{unmarkedAdaptations=[]}={}){
  const unmarkedByHash=new Map(unmarkedAdaptations.map(row=>[row.css_sha256,row]));
  const overlays=[];
  let base='';
  let cursor=0;
  let seenAdaptation=false;
  for(const match of source.matchAll(MODULE_RE)){
    base+=source.slice(cursor,match.index);
    const css=match[1];
    const marker=markerMatch(css);
    const trimmedCss=css.trim();
    const unmarked=marker?null:unmarkedByHash.get(sha256(trimmedCss));
    if(marker||unmarked){
      seenAdaptation=true;
      overlays.push({
        marker:marker?.normalized??`SCP-JP maintenance classification: ${unmarked.id}`,
        rationale:marker?rationaleFor(css,marker):unmarked.reason,
        css:marker?cleanOverlayBlock(css,marker):trimmedCss,
        legacy_unmarked:Boolean(unmarked),
      });
    }else{
      if(seenAdaptation){
        throw new Error('non-adaptation CSS module appears after the first SCP-JP adaptation module; preserving cascade order requires manual review');
      }
      base+=match[0];
    }
    cursor=match.index+match[0].length;
  }
  base+=source.slice(cursor);
  const overlayCss=overlays.map(block=>block.css).filter(Boolean).join('\n\n').trim();
  return {base:base.replace(/\n{4,}/gu,'\n\n\n').trimEnd()+'\n',overlayCss:overlayCss+(overlayCss?'\n':''),overlays};
}

export function composeMaintainableCandidate(base,overlayCss){
  const suffix=overlayCss.trim();
  if(!suffix)return base.trimEnd()+'\n';
  return `${base.trimEnd()}\n\n[[module CSS]]\n${suffix}\n[[/module]]\n`;
}

function inferCandidateTags(source,manifest){
  const explicit=manifest?.interactive_acceptance?.theme_source?.candidate_tags;
  if(Array.isArray(explicit)&&explicit.length)return explicit;
  if(/\[\[iftags\s+[^\]]*\+テーマ(?:\s|\]\])/iu.test(source))return ['テーマ'];
  return [];
}

function extractedCss(source,activeTags){
  return extractUnconditionalCssModules(source,{activeTags});
}

export function verifyEquivalentCandidate({original,base,rawOverlayCss,overlayCss=rawOverlayCss,activeTags=[]}){
  const composed=composeMaintainableCandidate(base,rawOverlayCss);
  const before=semanticCssIdentity(extractedCss(original,activeTags));
  const after=semanticCssIdentity(extractedCss(composed,activeTags));
  if(before!==after)throw new Error('maintainable source composition changed the effective extracted CSS');
  if(canonicalExactRuleIdentity(rawOverlayCss)!==canonicalExactRuleIdentity(overlayCss))throw new Error('compacted JP override changed the canonical rule cascade');
  return {composed,semantic_css_sha256:sha256(before),canonical_override_sha256:sha256(canonicalExactRuleIdentity(overlayCss))};
}

async function exists(file){try{await fs.access(file);return true}catch(error){if(error.code==='ENOENT')return false;throw error}}

async function packageNames(selected){
  if(selected.length)return [...new Set(selected)].sort();
  const entries=await fs.readdir(portsDir,{withFileTypes:true});
  const names=[];
  for(const entry of entries)if(entry.isDirectory()&&await exists(path.join(portsDir,entry.name,'manifest.json')))names.push(entry.name);
  return names.sort();
}

export async function preparePackage(name,{write=false,check=false}={}){
  const dir=path.join(portsDir,name);
  const manifestPath=path.join(dir,'manifest.json');
  const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  const candidatePath=path.join(dir,'candidate.wikidot.source.txt');
  const original=await fs.readFile(candidatePath,'utf8');
  const activeTags=inferCandidateTags(original,manifest);
  let classification={unmarked_adaptation_modules:[]};
  if(manifest.maintenance_classification){
    classification=JSON.parse(await fs.readFile(path.join(dir,manifest.maintenance_classification),'utf8'));
    if(classification.schema_version!==1||!Array.isArray(classification.unmarked_adaptation_modules))throw new Error(`${name}: invalid maintenance classification`);
  }
  const {base,overlayCss:rawOverlayCss,overlays}=splitMaintainableCandidate(original,{unmarkedAdaptations:classification.unmarked_adaptation_modules});
  if(!overlays.length)throw new Error(`${name}: no SCP-JP adaptation CSS modules found`);
  const compacted=compactExactDuplicateRules(overlays);
  const overlayCss=compacted.css;
  const verification=verifyEquivalentCandidate({original,base,rawOverlayCss,overlayCss,activeTags});
  const history=extractSCPJPAdaptationBlocks(original);
  const synthetic=overlays.filter(block=>block.legacy_unmarked).map(block=>({marker:block.marker,rationale:block.rationale,sha256:sha256(block.css),selectors:[],at_contexts:[],legacy_unmarked:true}));
  if(history.length+synthetic.length!==overlays.length)throw new Error(`${name}: adaptation block inventory mismatch (${history.length}+${synthetic.length} != ${overlays.length})`);
  const maintenanceManifest={
    schema_version:1,
    frozen_candidate_source_sha256:sha256(original),
    base_source_sha256:sha256(base),
    raw_jp_overrides_sha256:sha256(rawOverlayCss),
    jp_overrides_sha256:sha256(overlayCss),
    semantic_css_sha256:verification.semantic_css_sha256,
    canonical_override_sha256:verification.canonical_override_sha256,
    adaptation_block_count:overlays.length,
    raw_override_rule_count:compacted.raw_rule_count,
    canonical_override_rule_count:compacted.canonical_rule_count,
    exact_duplicate_rules_removed:compacted.removed,
    active_tags:activeTags,
    equivalence:'base + uncompressed historical JP overlay is comment-free token-identical to the frozen candidate; jp-overrides.css then removes only earlier exact-duplicate selector/context/body rules and has the same canonical rule cascade',
    historical_adaptations:[...history,...synthetic],
  };
  const expectedMaintenanceManifest=JSON.stringify(maintenanceManifest,null,2)+'\n';
  const maintenanceSource={
    base:'maintenance/base.wikidot.txt',
    jp_overrides:'maintenance/jp-overrides.css',
    manifest:'maintenance/manifest.json',
    base_sha256:maintenanceManifest.base_source_sha256,
    jp_overrides_sha256:maintenanceManifest.jp_overrides_sha256,
    semantic_css_sha256:maintenanceManifest.semantic_css_sha256,
    canonical_override_sha256:maintenanceManifest.canonical_override_sha256,
    exact_duplicate_rules_removed:maintenanceManifest.exact_duplicate_rules_removed,
  };
  if(check){
    const maintenanceDir=path.join(dir,'maintenance');
    const actualBase=await fs.readFile(path.join(maintenanceDir,'base.wikidot.txt'),'utf8');
    const actualOverlay=await fs.readFile(path.join(maintenanceDir,'jp-overrides.css'),'utf8');
    const actualManifest=await fs.readFile(path.join(maintenanceDir,'manifest.json'),'utf8');
    if(actualBase!==base)throw new Error(`${name}: maintenance/base.wikidot.txt is stale`);
    if(actualOverlay!==overlayCss)throw new Error(`${name}: maintenance/jp-overrides.css is stale`);
    if(actualManifest!==expectedMaintenanceManifest)throw new Error(`${name}: maintenance/manifest.json is stale`);
    if(JSON.stringify(manifest.maintenance_source??null)!==JSON.stringify(maintenanceSource))throw new Error(`${name}: package maintenance_source binding is stale`);
  }
  if(write){
    const maintenanceDir=path.join(dir,'maintenance');
    await fs.mkdir(maintenanceDir,{recursive:true});
    await fs.writeFile(path.join(maintenanceDir,'base.wikidot.txt'),base);
    await fs.writeFile(path.join(maintenanceDir,'jp-overrides.css'),overlayCss);
    await fs.writeFile(path.join(maintenanceDir,'manifest.json'),expectedMaintenanceManifest);
    manifest.maintenance_source=maintenanceSource;
    await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  }
  return {theme:manifest.slug,adaptation_blocks:overlays.length,base_bytes:Buffer.byteLength(base),override_bytes:Buffer.byteLength(overlayCss),exact_duplicate_rules_removed:compacted.removed,semantic_css_sha256:verification.semantic_css_sha256,write,check};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  const selected=args.filter(arg=>arg.startsWith('--theme=')).map(arg=>arg.slice(8));
  const write=args.includes('--write');
  const check=args.includes('--check');
  if(write&&check)throw new Error('--write and --check are mutually exclusive');
  const results=[];
  const failures=[];
  for(const name of await packageNames(selected)){
    try{results.push(await preparePackage(name,{write,check}))}catch(error){failures.push({theme:name,error:String(error?.message??error)})}
  }
  console.log(JSON.stringify({checked:results.length+failures.length,prepared:results.length,failed:failures.length,write,check,adaptation_blocks:results.reduce((sum,row)=>sum+row.adaptation_blocks,0),exact_duplicate_rules_removed:results.reduce((sum,row)=>sum+row.exact_duplicate_rules_removed,0),failures,results},null,2));
  if(failures.length)process.exitCode=2;
}
