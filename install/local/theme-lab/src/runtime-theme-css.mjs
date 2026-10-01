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

function removeExactModule(css,moduleCss){
  const body=moduleCss.trim();
  if(!body)return {css,removed:false};
  const index=css.indexOf(body);
  if(index<0||css.indexOf(body,index+body.length)>=0)return {css,removed:false};
  return {css:`${css.slice(0,index)}${css.slice(index+body.length)}`.replace(/\n{3,}/gu,'\n\n'),removed:true};
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
  let removed=0;
  let unmatched=0;
  for(const module of pageModules){
    if(runtimeIndexes.has(module.index))continue;
    const result=removeExactModule(css,module.css);
    css=result.css;
    if(result.removed)removed+=1;
    else unmatched+=1;
  }
  return {css,removed_showcase_modules:removed,unmatched_showcase_modules:unmatched};
}
