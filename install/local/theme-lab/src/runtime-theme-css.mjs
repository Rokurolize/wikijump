import {extractCssModules} from '../ports/scripts/extract-css-modules.mjs';

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
  let prefix='';
  while(true){const match=css.slice(prefix.length).match(/^(?:\s|\/\*[\s\S]*?\*\/)*@import\s[^;]+;/u);if(!match)break;prefix+=match[0];}
  return prefix;
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
  const pageModules=extractCssModules(candidateSource,{activeTags:candidateTags});
  const runtimeModules=extractCssModules(candidateSource,{activeTags:[]});
  const runtimeIndexes=new Set(runtimeModules.map(row=>row.index));
  let css=candidateInput;
  const protectedPrefix=leadingImports(candidateInput);
  let removed=0;
  let removedTruncated=0;
  let unmatched=0;
  for(const module of pageModules){
    if(runtimeIndexes.has(module.index))continue;
    const result=removeExactModule(css,module.css,protectedPrefix);
    if(result.removed){css=result.css;removed+=1;continue;}
    const truncated=removeTrailingTruncatedModule(css,module.css,protectedPrefix);
    css=truncated.css;
    if(truncated.removed)removedTruncated+=1;
    else unmatched+=1;
  }
  return {css,removed_showcase_modules:removed,removed_truncated_showcase_modules:removedTruncated,unmatched_showcase_modules:unmatched};
}
