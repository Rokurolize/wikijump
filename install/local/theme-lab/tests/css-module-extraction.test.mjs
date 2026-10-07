import test from 'node:test';
import assert from 'node:assert/strict';
import {extractCssModules,extractUnconditionalCssModules} from '../ports/scripts/extract-css-modules.mjs';

test('keeps unconditional CSS modules and drops conditional variants and examples',()=>{
  const source=`
[[code type="CSS"]]
@import url(https://example.invalid/documentation.css);
[[/code]]
>[[ift{$dark}gs -theme]]
[[module CSS]]
@import url(https://example.invalid/dark.css);
[[/module]]
>[[/ift{$dark}gs]]
[[module CSS]]
@import url(https://example.invalid/base.css);
[[/module]]
[[module CSS]]
.localized { color: #222; }
[[/module]]`;
  const css=extractUnconditionalCssModules(source);
  assert.match(css,/base\.css/u);
  assert.match(css,/localized/u);
  assert.doesNotMatch(css,/documentation\.css|dark\.css/u);
});

test('drops nested conditionals and preserves later base modules',()=>{
  const source=`[[module CSS]].base { color: black; }[[/module]]
[[iftags +theme]]
>[[ift{$variant}gs]]
[[module CSS]].variant { color: yellow; }[[/module]]
>[[/ift{$variant}gs]]
[[/iftags]]
[[module CSS]].jp { color: navy; }[[/module]]`;
  const css=extractUnconditionalCssModules(source);
  assert.match(css,/\.base/u);
  assert.match(css,/\.jp/u);
  assert.doesNotMatch(css,/\.variant/u);
});

test('evaluates iftags against the frozen source page tags',()=>{
  const source=`[[iftags +theme -archive]]
[[module css]]@import url(https://example.invalid/active.css);[[/module]]
[[/iftags]]
[[iftags +archive]]
[[module css]]@import url(https://example.invalid/archive.css);[[/module]]
[[/iftags]]`;
  const css=extractUnconditionalCssModules(source,{activeTags:['theme','_cc']});
  assert.match(css,/active\.css/u);
  assert.doesNotMatch(css,/archive\.css/u);
  assert.throws(()=>extractUnconditionalCssModules(source),/No unconditional CSS modules/u);
});

test('ignores Wikidot-looking tokens inside CSS comments and strings',()=>{
  const source=`[[module CSS]]
/* Historical note mentions [[iftags]] but must not open a Wikidot condition. */
.a::before { content: "[[/module]] [[iftags +archive]]"; }
[[/module]]
[[module CSS]].later { color: green; }[[/module]]`;
  const css=extractUnconditionalCssModules(source);
  assert.match(css,/Historical note mentions \[\[iftags\]\]/u);
  assert.match(css,/content: "\[\[\/module\]\] \[\[iftags \+archive\]\]"/u);
  assert.match(css,/\.later/u);
});

test('ignores escaped Wikidot CSS-module examples in localized documentation',()=>{
  const source=`Use {{[[module CSS]]}} in a copied example.\n[[module CSS]].live { color: navy; }[[/module]]`;
  const css=extractUnconditionalCssModules(source);
  assert.match(css,/\.live/u);
  assert.doesNotMatch(css,/copied example/u);
});

test('extracts attributed CSS modules while excluding commented and escaped examples',()=>{
 const source='[!-- [[module CSS]] .wrong{} [[/module]] --]\n@@[[module CSS show="true"]] .escaped{} [[/module]]@@\n[[module CSS show="true"]] .actual{} [[/module]]';
 assert.equal(extractUnconditionalCssModules(source),'.actual{}\n');
});

test('runtime extraction may unwrap an absent include variable without activating its empty iftags child',()=>{
 const source='[[ift{$item}gs +theme]][[module CSS]].default-on{display:none}[[/module]][[iftags]][[module CSS]].opt-in{color:black}[[/module]][[/iftags]][[/ift{$item}gs]]';
 assert.deepEqual(extractCssModules(source).map(row=>row.css),[]);
 const runtime=extractCssModules(source,{activeTags:[],resolveUnboundIncludeVariables:true});
 assert.equal(runtime.length,1);
 assert.match(runtime[0].css,/default-on/u);
 assert.doesNotMatch(runtime[0].css,/opt-in/u);
});
