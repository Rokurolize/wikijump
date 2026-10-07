import {extractCssModules} from '../ports/scripts/extract-css-modules.mjs';

// Publication inputs sometimes predate the maintained source module inventory.
// An explicit input repair can recover its default modules without retaining
// theme-page examples or resolving unsupported include-parameter expressions.
export function materializeDefaultCss(source,{sourcePageTags=[]}={}){
  const modules=extractCssModules(source,{activeTags:[]});
  if(!modules.length){
    // A source can deliberately inherit the site theme on articles and carry
    // CSS only for its tagged showcase. Require every executable module to be
    // accounted for by those page tags; unresolved guards and literal-only
    // inputs cannot authorize an empty publication stylesheet.
    const pageModules=extractCssModules(source,{activeTags:sourcePageTags});
    const inventory=extractCssModules(source,{activeTags:sourcePageTags,includeInactive:true});
    if(!pageModules.length||pageModules.length!==inventory.length)throw new Error('No active default publication CSS modules');
  }
  return {modules,css:modules.map(row=>row.css.trim()).filter(Boolean).join('\n\n')+'\n'};
}

export function candidatePageTags(manifest,source=''){
  const explicit=manifest?.interactive_acceptance?.theme_source?.candidate_tags;
  if(Array.isArray(explicit)&&explicit.length)return explicit;
  const jpTags=manifest?.source_identity?.jp?.tags;
  if(Array.isArray(jpTags)&&jpTags.length)return jpTags;
  if(/\[\[iftags\s+[^\]]*\+テーマ(?:\s|\]\])/iu.test(source))return ['テーマ'];
  if(/\[\[iftags\s+[^\]]*\+theme(?:\s|\]\])/iu.test(source))return ['theme'];
  return [];
}

function leadingImports(css){
  let end=0,cursor=0;
  while(cursor<css.length){
    if(/\s/u.test(css[cursor])){cursor+=1;continue;}
    if(css.startsWith('/*',cursor)){
      const close=css.indexOf('*/',cursor+2);if(close<0)break;
      cursor=close+2;continue;
    }
    if(!css.startsWith('@import',cursor)||! /\s/u.test(css[cursor+7]??''))break;
    const semicolon=css.indexOf(';',cursor+8);if(semicolon<=cursor+8)break;
    cursor=semicolon+1;end=cursor;
  }
  return css.slice(0,end);
}

function removeExactModule(css,moduleCss,protectedPrefix){
  const body=moduleCss.trim();
  if(!body)return {css,removed:false};
  const index=css.indexOf(body);
  if(index<0||css.indexOf(body,index+body.length)>=0)return {css,removed:false};
  // Leading imports are the preserved deliverable's dependency chain. A theme
  // page can conditionally load that chain alongside its presentation styles;
  // excluding presentation must not strip the theme's own base stylesheet.
  const preserve=css.startsWith(protectedPrefix)&&index<protectedPrefix.length
    ? css.slice(index,Math.min(index+body.length,protectedPrefix.length)):'';
  return {css:`${css.slice(0,index)}${preserve}${css.slice(index+body.length)}`,removed:true};
}

function removeTrailingTruncatedModule(css,moduleCss,protectedPrefix){
  const body=moduleCss.trim();
  const trimmed=css.trimEnd();
  if(!body||!trimmed)return {css,removed:false};
  // Historical authority migration preserved a few concatenated stylesheet
  // artifacts whose final showcase module lost only its closing braces. Treat
  // that as the same source-backed module only when the candidate ends with a
  // unique prefix and every missing source byte is a closing brace/whitespace.
  let matched=0;
  const max=Math.min(body.length,trimmed.length);
  for(let n=max;n>0;n--){
    if(trimmed.endsWith(body.slice(0,n))){matched=n;break;}
  }
  if(!matched||matched===body.length||!/^[}\s]+$/u.test(body.slice(matched)))return {css,removed:false};
  const prefix=body.slice(0,matched);
  const index=trimmed.lastIndexOf(prefix);
  if(index<0||trimmed.indexOf(prefix)!==index||index+prefix.length!==trimmed.length)return {css,removed:false};
  const preserve=css.startsWith(protectedPrefix)&&index<protectedPrefix.length?css.slice(index,Math.min(trimmed.length,protectedPrefix.length)):'';
  return {css:`${(trimmed.slice(0,index)+preserve).trimEnd()}\n`,removed:true};
}

// Theme pages often carry presentation-only CSS under [[iftags +theme]] or
// [[iftags +テーマ]]. Generic acceptance fixtures represent articles using the
// reusable theme, not the theme/showcase page itself. Remove only source-backed
// module bytes that are active for the source page tags but inactive for a
// tagless article. If historical materialization transformed a module so it is
// no longer an exact match, leave it untouched rather than guessing.
export function genericRuntimeThemeCss({candidateInput,candidateSource,candidateTags=[]}){
  // Real included-theme rendering resolves an absent include variable at the
  // default dynamic boundary. Keep source/publication extraction conservative;
  // only this runtime model opts into that evidenced Wikidot behavior.
  const pageModules=extractCssModules(candidateSource,{activeTags:candidateTags,resolveUnboundIncludeVariables:true});
  const runtimeModules=extractCssModules(candidateSource,{activeTags:[],resolveUnboundIncludeVariables:true});
  const runtimeIndexes=new Set(runtimeModules.map(row=>row.index));
  const pageIndexes=new Set(pageModules.map(row=>row.index));
  let css=candidateInput;
  const protectedPrefix=leadingImports(candidateInput);
  let removed=0;
  let removedTruncated=0;
  let unmatched=0;
  let removedComments=0;
  let unmatchedComments=0;
  // Old flattened inputs can contain imports from commented optional variants
  // and modules under inactive parameter guards. Bind multiplicity to source:
  // duplicate text is removable only when every source occurrence is inactive
  // and the flattened input has exactly that many occurrences.
  const inactiveByBody=new Map();
  for(const module of extractCssModules(candidateSource,{activeTags:[],includeCommented:true,includeInactive:true}).filter(row=>row.owner==='wikidot-comment'||row.owner==='inactive-iftags'&&!pageIndexes.has(row.index))){
    const body=module.css.trim();if(body)inactiveByBody.set(body,(inactiveByBody.get(body)??0)+1);
  }
  const activeBodies=new Set(runtimeModules.map(row=>row.css.trim()));
  for(const [body,sourceCount] of inactiveByBody){
    const positions=[];
    for(let index=css.indexOf(body);index>=0;index=css.indexOf(body,index+body.length))positions.push(index);
    if(!positions.length)continue;
    if(activeBodies.has(body)||positions.length!==sourceCount){unmatchedComments+=sourceCount;continue;}
    for(const index of positions.reverse())css=css.slice(0,index)+css.slice(index+body.length);
    removedComments+=sourceCount;
  }
  for(const module of pageModules){
    if(runtimeIndexes.has(module.index))continue;
    const result=removeExactModule(css,module.css,protectedPrefix);
    if(result.removed){css=result.css;removed+=1;continue;}
    const truncated=removeTrailingTruncatedModule(css,module.css,protectedPrefix);
    css=truncated.css;
    if(truncated.removed)removedTruncated+=1;
    else unmatched+=1;
  }
  return {css,removed_showcase_modules:removed,removed_truncated_showcase_modules:removedTruncated,unmatched_showcase_modules:unmatched,removed_inactive_source_modules:removedComments,unmatched_inactive_source_modules:unmatchedComments};
}
