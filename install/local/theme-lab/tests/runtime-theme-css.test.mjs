import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {candidatePageTags,genericRuntimeThemeCss} from '../src/runtime-theme-css.mjs';

const themeLabDir=path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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
