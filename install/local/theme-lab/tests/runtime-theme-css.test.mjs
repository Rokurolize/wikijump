import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractCssModules} from '../ports/scripts/extract-css-modules.mjs';
import {candidatePageTags,genericRuntimeThemeCss,materializeDefaultCss} from '../src/runtime-theme-css.mjs';

const themeLabDir=path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('explicit default materialization retains active modules in source order',()=>{
  const source='[[iftags +theme]][[module CSS]].demo{color:red}[[/module]][[/iftags]]\n[[module CSS]]@import url(base.css);[[/module]]\n[[iftags -theme]][[module CSS]].article{color:teal}[[/module]][[/iftags]]';
  assert.equal(materializeDefaultCss(source).css,'@import url(base.css);\n\n.article{color:teal}\n');
  const plain='[[module CSS]].first{color:blue}[[/module]][!-- [[module CSS]].optional{color:red}[[/module]] --][[module CSS]].last{color:green}[[/module]]';
  assert.equal(materializeDefaultCss(plain).css,'.first{color:blue}\n\n.last{color:green}\n');
});

test('default materialization refuses literals and unresolved-only modules',()=>{
  assert.throws(()=>materializeDefaultCss('@@[[module CSS]].literal{}[[/module]]@@'),/No active/);
  assert.throws(()=>materializeDefaultCss('[[iftags]][[/ift{$optional}gs]][[module CSS]].optional{}[[/module]][[/iftags]]'),/No active/);
});

test('a fully accounted tagged showcase can inherit the site theme on tagless articles',()=>{
  const source='[[iftags +theme]][[module CSS]].color{color:red}[[/module]][[/iftags]]';
  assert.deepEqual(materializeDefaultCss(source,{sourcePageTags:['theme']}),{modules:[],css:'\n'});
  assert.throws(()=>materializeDefaultCss(source,{sourcePageTags:['other']}),/No active/);
  const unresolved=source+'[[ift{$variant}gs +theme]][[module CSS]].unknown{}[[/module]][[/ift{$variant}gs]]';
  assert.throws(()=>materializeDefaultCss(unresolved,{sourcePageTags:['theme']}),/No active/);
  assert.throws(()=>materializeDefaultCss('@@[[module CSS]].literal{}[[/module]]@@',{sourcePageTags:['theme']}),/No active/);
});

test('default runtime excludes an optional import owned by a Wikidot comment',()=>{
 const source='[[module CSS]]@import url(base.css);[[/module]]\n[!-- {$variant}]\n[[module CSS]]@import url(optional.css);[[/module]]\n[!-- --]\n[[module CSS]].article{color:teal}[[/module]]';
 const result=genericRuntimeThemeCss({candidateSource:source,candidateInput:'@import url(base.css);\n@import url(optional.css);\n.article{color:teal}'});
 assert.equal(result.css,'@import url(base.css);\n\n.article{color:teal}');
 assert.equal(result.removed_inactive_source_modules,1);
 assert.equal(result.unmatched_inactive_source_modules,0);
});

test('ambiguous commented stylesheet occurrences stay actionable',()=>{
 const result=genericRuntimeThemeCss({candidateSource:'[!-- [[module CSS]]@import url(optional.css);[[/module]] --]',candidateInput:'@import url(optional.css);\n@import url(optional.css);'});
 assert.equal(result.removed_inactive_source_modules,0);
 assert.equal(result.unmatched_inactive_source_modules,1);
 assert.equal(result.css,'@import url(optional.css);\n@import url(optional.css);');
});

test('unresolved parameterized closing tag cannot enable a default-disabled variant',()=>{
 const source='[[iftags]][[/ift{$variant}gs]]\n[[iftags -theme]][[module CSS]].variant{color:purple}[[/module]][[/iftags]][[/iftags]]\n[[module CSS]]@import url(default.css);[[/module]]';
 const result=genericRuntimeThemeCss({candidateSource:source,candidateInput:'.variant{color:purple}\n@import url(default.css);',candidateTags:['theme']});
 assert.equal(result.css,'\n@import url(default.css);');
 assert.equal(result.removed_inactive_source_modules,1);
});

test('runtime model applies the default include-variable boundary while publication extraction stays conservative',()=>{
 const source='[[ift{$item}gs +theme]][[module CSS]].default-on{display:none}[[/module]][[iftags]][[module CSS]].opt-in{color:black}[[/module]][[/iftags]][[/ift{$item}gs]]';
 assert.equal(extractCssModules(source).length,0);
 const result=genericRuntimeThemeCss({candidateInput:'.default-on{display:none}\n.opt-in{color:black}',candidateSource:source,candidateTags:[]});
 assert.equal(result.css,'.default-on{display:none}\n');
 assert.equal(result.removed_inactive_source_modules,1);
});

test('Basalt default include runtime keeps module 5 and leaves opt-in iftags imports inactive',()=>{
 const source=fs.readFileSync(path.join(themeLabDir,'ports','basalt','candidate.wikidot.source.txt'),'utf8');
 const modules=extractCssModules(source,{activeTags:[],resolveUnboundIncludeVariables:true});
 const imports=modules.map(row=>row.css.match(/theme%3Abasalt\/(\d)/u)?.[1]).filter(Boolean);
 assert.deepEqual(imports,['1','5']);
});

test('duplicate default-disabled modules are removed only with matching source multiplicity',()=>{
 const module='[[module CSS]].variant{color:purple}[[/module]]';
 const source='[!-- '+module+' '+module+' --]';
 const result=genericRuntimeThemeCss({candidateSource:source,candidateInput:'.variant{color:purple}\n.variant{color:purple}'});
 assert.equal(result.css,'\n');
 assert.equal(result.removed_inactive_source_modules,2);
 assert.equal(result.unmatched_inactive_source_modules,0);
 const extra=genericRuntimeThemeCss({candidateSource:source,candidateInput:'.variant{color:purple}\n.variant{color:purple}\n.variant{color:purple}'});
 assert.equal(extra.removed_inactive_source_modules,0);
 assert.equal(extra.unmatched_inactive_source_modules,2);
});

test('generic runtime drops exact theme-page-only CSS while preserving reusable CSS',()=>{
  const source=`[[module CSS]].base { color: black; }[[/module]]
[[iftags +テーマ]][[module CSS]].showcase { display: none !important; }[[/module]][[/iftags]]`;
  const candidateInput='.base { color: black; }\n.showcase { display: none !important; }\n';
  const result=genericRuntimeThemeCss({candidateInput,candidateSource:source,candidateTags:['テーマ']});
  assert.match(result.css,/\.base \{ color: black; \}/u);
  assert.doesNotMatch(result.css,/showcase/u);
  assert.equal(result.removed_showcase_modules,1);
  assert.equal(result.unmatched_showcase_modules,0);
});

test('generic runtime leaves transformed showcase CSS untouched instead of guessing',()=>{
  const source='[[iftags +theme]][[module CSS]].showcase { display: none; }[[/module]][[/iftags]]';
  const candidateInput='.showcase{display:none}\n';
  const result=genericRuntimeThemeCss({candidateInput,candidateSource:source,candidateTags:['theme']});
  assert.equal(result.css,candidateInput);
  assert.equal(result.removed_showcase_modules,0);
  assert.equal(result.unmatched_showcase_modules,1);
});

test('generic runtime leaves duplicate exact text untouched when its source occurrence is ambiguous',()=>{
  const source='[[module CSS]].same { color: red; }[[/module]][[iftags +theme]][[module CSS]].same { color: red; }[[/module]][[/iftags]]';
  const candidateInput='.same { color: red; }\n.same { color: red; }\n';
  const result=genericRuntimeThemeCss({candidateInput,candidateSource:source,candidateTags:['theme']});
  assert.equal(result.css,candidateInput);
  assert.equal(result.removed_showcase_modules,0);
  assert.equal(result.unmatched_showcase_modules,1);
});

test('generic runtime removes a trailing showcase module truncated only by closing braces',()=>{
  const source='[[module CSS]].base { color: black; }[[/module]][[iftags +theme]][[module CSS]]@media(max-width:1px){.showcase{display:none}}[[/module]][[/iftags]]';
  const candidateInput='.base { color: black; }\n@media(max-width:1px){.showcase{display:none\n';
  const result=genericRuntimeThemeCss({candidateInput,candidateSource:source,candidateTags:['theme']});
  assert.equal(result.css,'.base { color: black; }\n');
  assert.equal(result.removed_showcase_modules,0);
  assert.equal(result.removed_truncated_showcase_modules,1);
  assert.equal(result.unmatched_showcase_modules,0);
});

test('truncated showcase removal rejects transformed text and duplicate prefixes',()=>{
  const source='[[iftags +theme]][[module CSS]].showcase{display:none}[[/module]][[/iftags]]';
  for(const candidateInput of ['.showcase{display:non','.showcase{display:none\n.showcase{display:none']){
    const result=genericRuntimeThemeCss({candidateInput,candidateSource:source,candidateTags:['theme']});
    assert.equal(result.css,candidateInput);
    assert.equal(result.removed_truncated_showcase_modules,0);
    assert.equal(result.unmatched_showcase_modules,1);
  }
});

test('generic runtime preserves leading theme dependencies loaded by the showcase guard',()=>{
  const imports='@import url("base.css");\n@import url("theme.css");';
  const source=`[[iftags +theme]][[module CSS]]${imports}\n.showcase{display:none}[[/module]][[/iftags]][[module CSS]].article{color:red}[[/module]]`;
  const result=genericRuntimeThemeCss({candidateInput:imports+'\n.showcase{display:none}\n.article{color:red}',candidateSource:source,candidateTags:['theme']});
  assert.equal(result.css,imports+'\n.article{color:red}');
  assert.equal(result.removed_showcase_modules,1);
  assert.equal(result.unmatched_showcase_modules,0);
});

test('candidate page tags prefer explicit metadata, then retained JP tags, then source inference',()=>{
  assert.deepEqual(candidatePageTags({interactive_acceptance:{theme_source:{candidate_tags:['custom']}}},'[[iftags +テーマ]]'),['custom']);
  assert.deepEqual(candidatePageTags({source_identity:{jp:{tags:['en','テーマ']}}},'[[iftags +theme]]'),['en','テーマ']);
  assert.deepEqual(candidatePageTags({},'[[iftags +テーマ]][[/iftags]]'),['テーマ']);
  assert.deepEqual(candidatePageTags({},'[[iftags +theme]][[/iftags]]'),['theme']);
});

test('Pataphysics generic runtime excludes its theme-page-only heritage suppression',()=>{
  const dir=path.join(themeLabDir,'ports','pataphysics');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  const candidateSource=fs.readFileSync(path.join(dir,'candidate.wikidot.source.txt'),'utf8');
  const candidateInput=fs.readFileSync(path.join(dir,'candidate-input.css'),'utf8');
  const candidateTags=candidatePageTags(manifest,candidateSource);
  const result=genericRuntimeThemeCss({candidateInput,candidateSource,candidateTags});
  assert.deepEqual(candidateTags,['en','テーマ']);
  assert.equal(result.removed_showcase_modules,1);
  assert.equal(result.unmatched_showcase_modules,0);
  assert.doesNotMatch(result.css,/\.heritage-wrap\s*\{\s*display\s*:\s*none\s*!important/iu);
  assert.doesNotMatch(result.css,/#page-content\s+\.heritage-rating-module\s*\{\s*display\s*:\s*none/iu);
});

test('showcase import preservation scans repeated comments without backtracking',()=>{
 const comments='/*'+ '*//*'.repeat(12000)+'*/';
 const module='@import url(base.css);\n.showcase{display:none}';
 const result=genericRuntimeThemeCss({candidateInput:comments+'\n'+module,candidateSource:'[[iftags +テーマ]]\n[[module CSS]]\n'+module+'\n[[/module]]\n[[/iftags]]',candidateTags:['テーマ']});
 assert.equal(result.removed_showcase_modules,1);
 assert.equal(result.css,comments+'\n@import url(base.css);');
});
