#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {parseStyleSheet,stripCssComments} from '../../src/css-probe.mjs';
import {analyzeOverrideCascade,extractSCPJPAdaptationBlocks,parseCssDeclarations} from '../../src/port-maintenance.mjs';
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

function matchingBrace(css,open){
  let depth=0,quote=null,inComment=false;
  for(let i=open;i<css.length;i+=1){const c=css[i],n=css[i+1]??'';
    if(inComment){if(c==='*'&&n==='/'){inComment=false;i+=1}continue}
    if(quote!==null){if(c==='\\')i+=1;else if(c===quote)quote=null;continue}
    if(c==='/'&&n==='*'){inComment=true;i+=1;continue}
    if(c==='"'||c==="'"){quote=c;continue}
    if(c==='{')depth+=1;else if(c==='}'&&(depth-=1)===0)return i;
  }
  throw new Error('unclosed CSS block in JP override');
}

export function locateRuleBodies(css){
  const parsed=parseStyleSheet(css),located=[];
  function scan(start,end,contexts=[]){
    let preludeStart=start,quote=null,inComment=false,paren=0,bracket=0;
    for(let i=start;i<end;i+=1){const c=css[i],n=css[i+1]??'';
      if(inComment){if(c==='*'&&n==='/'){inComment=false;i+=1}continue}
      if(quote!==null){if(c==='\\')i+=1;else if(c===quote)quote=null;continue}
      if(c==='/'&&n==='*'){inComment=true;i+=1;continue}
      if(c==='"'||c==="'"){quote=c;continue}
      if(c==='(')paren+=1;else if(c===')')paren-=1;else if(c==='[')bracket+=1;else if(c===']')bracket-=1;
      if(c===';'&&paren===0&&bracket===0){preludeStart=i+1;continue}
      if(c!=='{'||paren!==0||bracket!==0)continue;
      const close=matchingBrace(css,i),prelude=css.slice(preludeStart,i).trim(),cleanPrelude=stripCssComments(prelude).trim();
      if(/^@(media|supports|container|layer|document|starting-style)\b/iu.test(cleanPrelude))scan(i+1,close,[...contexts,cleanPrelude]);
      else if(!cleanPrelude.startsWith('@')){
        const selectorCount=parseStyleSheet(`${cleanPrelude} {}`).length;
        for(let index=0;index<selectorCount;index+=1)located.push({start:i+1,end:close,contexts,prelude:cleanPrelude,ruleStart:preludeStart,blockEnd:close+1});
      }
      i=close;preludeStart=close+1;
    }
  }
  scan(0,css.length);
  return located;
}

function declarationParts(body){
  const parts=[];let start=0,quote=null,inComment=false,paren=0,bracket=0;
  for(let i=0;i<body.length;i+=1){const c=body[i],n=body[i+1]??'';
    if(inComment){if(c==='*'&&n==='/'){inComment=false;i+=1}continue}
    if(quote!==null){if(c==='\\')i+=1;else if(c===quote)quote=null;continue}
    if(c==='/'&&n==='*'){inComment=true;i+=1;continue}
    if(c==='"'||c==="'"){quote=c;continue}
    if(c==='(')paren+=1;else if(c===')')paren-=1;else if(c==='[')bracket+=1;else if(c===']')bracket-=1;
    if(c===';'&&paren===0&&bracket===0){parts.push({start,end:i+1,raw:body.slice(start,i+1)});start=i+1}
  }
  if(start<body.length)parts.push({start,end:body.length,raw:body.slice(start)});
  return parts;
}

export function canonicalizeShadowedDeclarations(css){
  const rules=parseStyleSheet(css),ranges=locateRuleBodies(css),audit=analyzeOverrideCascade(css),eligible=new Map(),decisions=[],fallbackComments=new Map();
  if(ranges.length!==rules.length||ranges.some((range,index)=>JSON.stringify(range.contexts)!==JSON.stringify(rules[index].atContext??[])))throw new Error('CSS source ranges do not align with parsed selector and at-rule contexts');
  const declarationRowsByRule=rules.map(rule=>declarationParts(rule.body??'').flatMap(part=>parseCssDeclarations(part.raw).map(declaration=>({part,declaration}))));
  for(const conflict of audit.conflicts){
    const winnerOccurrence=[...conflict.occurrences].reverse().find(row=>row.rule_index===conflict.winner.rule_index&&row.value===conflict.winner.value&&row.important===conflict.winner.important);
    const intrinsicFallback=/^(?:height|min-height|max-height|block-size|min-block-size|max-block-size)$/iu.test(conflict.property)&&/^(?:max-content|fit-content(?:\(.+\))?)$/iu.test(conflict.winner.value);
    const displayFallback=conflict.property==='display'&&/^(?:flow-root|inline-flex)$/iu.test(conflict.winner.value);
    const fallbackOccurrence=(intrinsicFallback||displayFallback)
      ?[...conflict.occurrences].reverse().find(row=>row!==winnerOccurrence&&row.important===conflict.winner.important&&(
        intrinsicFallback&&!/^(?:max-content|fit-content(?:\(.+\))?)$/iu.test(row.value)
        ||displayFallback&&(conflict.winner.value==='flow-root'?row.value==='block':row.value==='inline-block')
      ))
      :null;
    const key=JSON.stringify([conflict.at_context,conflict.selector,conflict.property]);
    const fallbackRationale=fallbackOccurrence
      ?intrinsicFallback?`Keep ${fallbackOccurrence.value} before ${conflict.winner.value} so engines that reject the intrinsic sizing keyword retain the established header sizing.`:`Keep ${fallbackOccurrence.value} before ${conflict.winner.value} as the display fallback for engines without ${conflict.winner.value} support.`
      :null;
    decisions.push({key,selector:conflict.selector,at_context:conflict.at_context,property:conflict.property,winner:conflict.winner.value,status:fallbackOccurrence?'intentional-fallback':'resolved-canonical',rationale:fallbackRationale,removed:0,fallback_retained:fallbackOccurrence?1:0});
    if(fallbackOccurrence){const row=ranges[fallbackOccurrence.rule_index],ruleKey=`${row.ruleStart}:${row.blockEnd}`,comments=fallbackComments.get(ruleKey)??new Set();comments.add(`/* SCP-JP compatibility fallback: ${fallbackRationale} */`);fallbackComments.set(ruleKey,comments)}
    for(const occurrence of conflict.occurrences){
      if(occurrence===winnerOccurrence)continue;
      if(occurrence===fallbackOccurrence)continue;
      const range=ranges[occurrence.rule_index],declarationRows=declarationRowsByRule[occurrence.rule_index];
      const part=declarationRows[occurrence.declaration_index]?.part;
      if(!part||part.raw.includes('/*'))continue;
      const declaration=parseCssDeclarations(part.raw)[0];
      if(!declaration||declaration.property!==conflict.property)continue;
      const ruleKey=`${range.ruleStart}:${range.blockEnd}`,byRule=eligible.get(ruleKey)??new Map(),indexes=byRule.get(occurrence.rule_index)??new Set();
      indexes.add(occurrence.declaration_index);byRule.set(occurrence.rule_index,indexes);eligible.set(ruleKey,byRule);
      const decision=decisions.at(-1);decision.removed+=1;
    }
  }
  const physical=new Map();
  ranges.forEach((range,index)=>{const key=`${range.ruleStart}:${range.blockEnd}`,rows=physical.get(key)??[];rows.push(index);physical.set(key,rows)});
  const replacements=[];let removed=0;
  for(const [key,indexes] of physical){
    const byRule=eligible.get(key)??new Map();if(!byRule.size&&!fallbackComments.has(key))continue;
    const sets=indexes.map(index=>byRule.get(index)??new Set()),serialized=sets.map(set=>JSON.stringify([...set].sort((a,b)=>a-b)));
    const range=ranges[indexes[0]],rawPrelude=css.slice(range.ruleStart,range.start),cleanPrelude=stripCssComments(rawPrelude).trim(),allSelectors=parseStyleSheet(`${cleanPrelude} {}`).map(rule=>rule.selector);
    if(allSelectors.length!==indexes.length)throw new Error('selector-list source split disagrees with stylesheet parser');
    if(serialized.every(value=>value===serialized[0])){
      const declarationRows=declarationRowsByRule[indexes[0]];
      const removals=[...sets[0]].map(declarationIndex=>declarationRows[declarationIndex]?.part).filter(Boolean);
      const body=rules[indexes[0]].body??'';
      let nextBody=body;
      for(const part of removals.sort((a,b)=>b.start-a.start)){
        const leading=part.raw.match(/^\s*/u)?.[0].length??0;
        nextBody=nextBody.slice(0,part.start+leading)+nextBody.slice(part.end);
      }
      const annotations=[...(fallbackComments.get(key)??[])];
      if(nextBody!==body||annotations.length)replacements.push({start:range.ruleStart,end:range.blockEnd,text:`${annotations.length?`${annotations.join('\n')}\n`:''}${rawPrelude}${nextBody}}`});
      removed+=removals.length;
    }else{
      const comments=[...rawPrelude.matchAll(COMMENT_RE)].map(match=>match[0]);
      const annotations=[...(fallbackComments.get(key)??[])];
      const prefix=[...annotations,...comments].length?`${[...annotations,...comments].join('\n')}\n`:'';
      const rendered=[];
      for(const [position,index] of indexes.entries()){
        const body=rules[index].body??'',declarationRows=declarationRowsByRule[index];
        const removals=[...(sets[position]??[])].map(declarationIndex=>declarationRows[declarationIndex]?.part).filter(Boolean);
        let nextBody=body;
        for(const part of removals.sort((a,b)=>b.start-a.start)){
          const leading=part.raw.match(/^\s*/u)?.[0].length??0;
          nextBody=nextBody.slice(0,part.start+leading)+nextBody.slice(part.end);
        }
        removed+=removals.length;
        rendered.push(`${rules[index].selector} {${nextBody}}`);
      }
      replacements.push({start:range.ruleStart,end:range.blockEnd,text:`${prefix}${rendered.join('\n')}`});
    }
  }
  let result=css;
  for(const row of replacements.sort((a,b)=>b.start-a.start))result=result.slice(0,row.start)+row.text+result.slice(row.end);
  let remainingRules,remainingRanges;
  try{remainingRules=parseStyleSheet(result);remainingRanges=locateRuleBodies(result)}catch(error){throw new Error(`${error.message}; rewritten CSS=${result}`)}
  const remainingPhysical=new Map();
  remainingRanges.forEach((range,index)=>{const key=`${range.ruleStart}:${range.blockEnd}`,rows=remainingPhysical.get(key)??[];rows.push(index);remainingPhysical.set(key,rows)});
  const emptyRuleRemovals=[];
  for(const indexes of remainingPhysical.values()){
    const range=remainingRanges[indexes[0]],empty=indexes.every(index=>(remainingRules[index].body??'').trim()==='');
    if(empty)emptyRuleRemovals.push({start:range.ruleStart,end:range.blockEnd});
  }
  for(const row of emptyRuleRemovals.sort((a,b)=>b.start-a.start))result=result.slice(0,row.start)+result.slice(row.end);
  const before=new Map(),after=new Map();
  const identity=source=>{const map=new Map();for(const [ruleIndex,rule] of parseStyleSheet(source).entries()){for(const declaration of parseCssDeclarations(rule.body??'')){const key=JSON.stringify([rule.atContext??[],rule.selector,declaration.property]);const rows=map.get(key)??[];rows.push(declaration);map.set(key,rows)}}return map};
  for(const [key,rows] of identity(css))before.set(key,rows);
  for(const [key,rows] of identity(result))after.set(key,rows);
  for(const key of new Set([...before.keys(),...after.keys()])){
    const rows=before.get(key)??[],next=after.get(key)??[];
    const winner=list=>{const imp=list.filter(row=>row.important);return (imp.length?imp:list).at(-1)};
    if(JSON.stringify(winner(rows)??null)!==JSON.stringify(winner(next)??null))throw new Error(`same-value declaration compaction changed an exact selector/context/property winner: ${key}`);
  }
  return {css:result,removed,empty_rules_removed:emptyRuleRemovals.length,decisions};
}

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

function declarationWinnerIdentity(css){
  const winners=new Map();
  for(const rule of parseStyleSheet(css))for(const declaration of parseCssDeclarations(rule.body??'')){
    const key=JSON.stringify([rule.atContext??[],rule.selector,declaration.property]);
    const rows=winners.get(key)??[];rows.push(declaration);winners.set(key,rows);
  }
  return JSON.stringify([...winners].map(([key,rows])=>{
    const important=rows.filter(row=>row.important),winner=(important.length?important:rows).at(-1);
    return [key,winner.value,winner.important];
  }).sort(([a],[b])=>a.localeCompare(b)));
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

function normalizeMaintenanceRationales(css){
  const replacements=[
    [/Follow-up image review:/gu,'SCP-JP compatibility:'],
    [/Follow-up image review found/gu,'SCP-JP compatibility requires'],
    [/Cross-engine mobile image review:/gu,'SCP-JP mobile compatibility:'],
    [/Narrow-mobile visual review:/gu,'SCP-JP narrow-mobile compatibility:'],
    [/Direct mobile image review:/gu,'SCP-JP mobile compatibility:'],
    [/Direct Files and policy-surface image review:/gu,'SCP-JP Files and policy-surface compatibility:'],
    [/Image-reviewed 320px repair:/gu,'SCP-JP 320px compatibility:'],
    [/Image-reviewed tabview repair:/gu,'SCP-JP tabview compatibility:'],
    [/Direct desktop screenshot finding:/gu,'SCP-JP desktop compatibility:'],
    [/Tablet screenshot:/gu,'SCP-JP tablet compatibility:'],
    [/Full-resolution post-shell review:/gu,'SCP-JP mobile compatibility:'],
    [/Full-resolution after-image identifies the clipped duplicate as/gu,'The duplicate wordmark is emitted by'],
    [/The v52 full-resolution expanded-action after-image showed that older two-ID rules still won for pale Backlinks and disabled Delete controls\./gu,'The expanded page actions use pale surfaces for Backlinks and disabled Delete controls.'],
    [/SCP-JP interactive visual review repair v1: inkblot source panes/gu,'SCP-JP compatibility: use a readable monospace face in source editors.'],
    [/SCP-JP mobile search fix v11:/gu,'SCP-JP mobile search compatibility:'],
    [/Direct after-image review:/gu,'SCP-JP compatibility:'],
    [/Follow-up 320px image review:/gu,'SCP-JP 320px compatibility:'],
    [/Follow-up vision review:/gu,'SCP-JP tablet compatibility:'],
    [/Vision review:/gu,'SCP-JP credit-dialog compatibility:'],
    [/Image review found/gu,'The current runtime shows'],
    [/Direct mobile screenshot finding:/gu,'SCP-JP mobile compatibility:'],
    [/The phone screenshot clips/gu,'At phone widths,'],
    [/The 390px and 320px after-images confirmed the list wrapped but the topbar retained a fixed-height box, leaving its open menu over the page heading\./gu,'At 390px and 320px the list wraps while the top bar retains a fixed-height box, allowing its open menu to cover the page heading.'],
    [/SCP-JP interactive visual acceptance repair:/gu,'SCP-JP compatibility:'],
    [/SCP-JP interactive acceptance:/gu,'SCP-JP interaction compatibility:'],
    [/SCP-JP credit acceptance:/gu,'SCP-JP credit compatibility:'],
    [/SCP-JP interactive acceptance:/gu,'SCP-JP interaction compatibility:'],
    [/mobile navigation readability revision \d+/giu,'mobile navigation readability'],
    [/SCP-JP mobile-header adaptation revision \d+: keep the search wrapper itself in flow; changing only its form leaves the theme's absolutely positioned parent overlaying the Japanese title\./gu,'SCP-JP mobile-header compatibility: keep the search wrapper itself in flow so its absolutely positioned parent does not cover the localized title.'],
    [/SCP-JP interactive visual acceptance repair: keep opened Night Rush mobile submenu within the viewport\./gu,'Keep the expanded Night Rush mobile submenu within the viewport.'],
    [/SCP-JP interactive visual acceptance repair: restore Night Rush masthead flow at tablet widths\./gu,'At tablet widths, let the Night Rush masthead follow the localized title and subtitle in normal flow.'],
  ];
  return replacements.reduce((text,[pattern,replacement])=>text.replace(pattern,replacement),css).replace(/[\t ]+(?=\r?$)/gmu,'');
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
  const requiredIncludes=source=>[...source.matchAll(/\[\[include\b[^\]]*\]\]/giu)].map(match=>match[0].replace(/\s+/gu,' ').trim());
  if(JSON.stringify(requiredIncludes(original))!==JSON.stringify(requiredIncludes(composed)))throw new Error('maintainable source composition changed the ordered include list');
  if(declarationWinnerIdentity(rawOverlayCss)!==declarationWinnerIdentity(overlayCss))throw new Error('canonical JP override changed an exact selector/context/property winner');
  return {composed,semantic_css_sha256:sha256(before),canonical_override_sha256:sha256(canonicalExactRuleIdentity(overlayCss)),ordered_include_sha256:sha256(JSON.stringify(requiredIncludes(composed)))};
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
  const exactCompacted=compactExactDuplicateRules(overlays);
  const declarationCompacted=canonicalizeShadowedDeclarations(exactCompacted.css);
  declarationCompacted.css=normalizeMaintenanceRationales(declarationCompacted.css);
  const overlayCss=declarationCompacted.css;
  const verification=verifyEquivalentCandidate({original,base,rawOverlayCss,overlayCss,activeTags});
  const finalSource=composeMaintainableCandidate(base,overlayCss);
  const finalSourceSha256=sha256(finalSource);
  const history=extractSCPJPAdaptationBlocks(original);
  const beforeDeclarationFindings=analyzeOverrideCascade(exactCompacted.css).conflicts;
  const beforeDeclarationFindingsByKey=new Map(beforeDeclarationFindings.map(finding=>[JSON.stringify([finding.at_context,finding.selector,finding.property]),finding]));
  const afterDeclarationFindings=new Map(analyzeOverrideCascade(overlayCss).conflicts.map(finding=>[JSON.stringify([finding.at_context,finding.selector,finding.property]),finding]));
  const declarationReviews={};
  for(const decision of declarationCompacted.decisions){
    const before=beforeDeclarationFindingsByKey.get(decision.key);
    const remaining=afterDeclarationFindings.get(decision.key);
    const removedConflicts=(before?.shadowed_conflicting_count??0)-(remaining?.shadowed_conflicting_count??0);
    const status=remaining?(decision.status==='intentional-fallback'?'intentional-fallback':'unresolved'):'resolved-canonical';
    declarationReviews[decision.key]={
      status,
      rationale:status==='intentional-fallback'?decision.rationale:status==='resolved-canonical'
        ?`Removed ${removedConflicts} obsolete conflicting declaration(s) and ${decision.removed} same-value duplicate(s); the retained exact-key winner is unchanged.`
        :`Canonicalization removed ${removedConflicts} conflicting declaration(s), but ${remaining.shadowed_conflicting_count} conflicting declaration(s) remain and need review.`,
      conflicting_declarations_consolidated:removedConflicts,
      same_value_declarations_removed:decision.removed,
      fallback_declarations_retained:status==='intentional-fallback'?decision.fallback_retained:0,
    };
  }
  for(const finding of beforeDeclarationFindings){
    if(!finding.redundant_same_value_count)continue;
    const key=JSON.stringify([finding.at_context,finding.selector,finding.property]);
    const remaining=afterDeclarationFindings.get(key);
    const removed=finding.redundant_same_value_count-(remaining?.redundant_same_value_count??0);
    if(removed===0||declarationReviews[key])continue;
    declarationReviews[key]={
      status:remaining?'unresolved':'resolved-canonical',
      rationale:remaining
        ?`Removed ${removed} repeated declaration(s) with identical property/value/selector/context; ${remaining.redundant_same_value_count} same-value repetition(s) and ${remaining.shadowed_conflicting_count} conflicting declaration(s) remain for review.`
        :`Removed ${removed} repeated declaration(s) with identical property/value/selector/context. A later identical declaration remains and the exact-key winner is unchanged.`,
      redundant_declarations_removed:removed,
    };
  }
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
    final_source:'maintenance/final.wikidot.txt',
    final_source_sha256:finalSourceSha256,
    final_source_inputs:{base_sha256:sha256(base),jp_overrides_sha256:sha256(overlayCss)},
    ordered_include_sha256:verification.ordered_include_sha256,
    declaration_reviews:declarationReviews,
    adaptation_block_count:overlays.length,
    raw_override_rule_count:exactCompacted.raw_rule_count,
    canonical_override_rule_count:exactCompacted.canonical_rule_count,
    exact_duplicate_rules_removed:exactCompacted.removed,
    redundant_same_value_declarations_removed:declarationCompacted.removed,
    empty_rules_removed:declarationCompacted.empty_rules_removed,
    active_tags:activeTags,
    equivalence:'base + uncompressed historical JP overlay is comment-free token-identical to the frozen candidate; canonical jp-overrides.css removes exact duplicate rules, same-value redundancies, and shadowed declarations classified as superseded while preserving documented syntax fallbacks, then proves exact-key declaration winners unchanged',
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
    final_source:maintenanceManifest.final_source,
    final_source_sha256:maintenanceManifest.final_source_sha256,
    exact_duplicate_rules_removed:maintenanceManifest.exact_duplicate_rules_removed,
    redundant_same_value_declarations_removed:maintenanceManifest.redundant_same_value_declarations_removed,
    empty_rules_removed:maintenanceManifest.empty_rules_removed,
  };
  if(check){
    const maintenanceDir=path.join(dir,'maintenance');
    const actualBase=await fs.readFile(path.join(maintenanceDir,'base.wikidot.txt'),'utf8');
    const actualOverlay=await fs.readFile(path.join(maintenanceDir,'jp-overrides.css'),'utf8');
    const actualManifest=await fs.readFile(path.join(maintenanceDir,'manifest.json'),'utf8');
    const actualFinalSource=await fs.readFile(path.join(maintenanceDir,'final.wikidot.txt'),'utf8');
    if(actualBase!==base)throw new Error(`${name}: maintenance/base.wikidot.txt is stale`);
    if(actualOverlay!==overlayCss)throw new Error(`${name}: maintenance/jp-overrides.css is stale`);
    if(actualManifest!==expectedMaintenanceManifest)throw new Error(`${name}: maintenance/manifest.json is stale`);
    if(actualFinalSource!==finalSource)throw new Error(`${name}: maintenance/final.wikidot.txt is stale`);
    if(JSON.stringify(manifest.maintenance_source??null)!==JSON.stringify(maintenanceSource))throw new Error(`${name}: package maintenance_source binding is stale`);
  }
  if(write){
    const maintenanceDir=path.join(dir,'maintenance');
    await fs.mkdir(maintenanceDir,{recursive:true});
    await fs.writeFile(path.join(maintenanceDir,'base.wikidot.txt'),base);
    await fs.writeFile(path.join(maintenanceDir,'jp-overrides.css'),overlayCss);
    await fs.writeFile(path.join(maintenanceDir,'manifest.json'),expectedMaintenanceManifest);
    await fs.writeFile(path.join(maintenanceDir,'final.wikidot.txt'),finalSource);
    manifest.maintenance_source=maintenanceSource;
    await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  }
  return {theme:manifest.slug,adaptation_blocks:overlays.length,base_bytes:Buffer.byteLength(base),override_bytes:Buffer.byteLength(overlayCss),exact_duplicate_rules_removed:exactCompacted.removed,redundant_same_value_declarations_removed:declarationCompacted.removed,empty_rules_removed:declarationCompacted.empty_rules_removed,semantic_css_sha256:verification.semantic_css_sha256,write,check};
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
  console.log(JSON.stringify({checked:results.length+failures.length,prepared:results.length,failed:failures.length,write,check,adaptation_blocks:results.reduce((sum,row)=>sum+row.adaptation_blocks,0),exact_duplicate_rules_removed:results.reduce((sum,row)=>sum+row.exact_duplicate_rules_removed,0),redundant_same_value_declarations_removed:results.reduce((sum,row)=>sum+row.redundant_same_value_declarations_removed,0),empty_rules_removed:results.reduce((sum,row)=>sum+row.empty_rules_removed,0),failures,results},null,2));
  if(failures.length)process.exitCode=2;
}
