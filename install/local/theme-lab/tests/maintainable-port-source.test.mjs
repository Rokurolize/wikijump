import assert from 'node:assert/strict';
import test from 'node:test';

import {canonicalExactRuleIdentity,compactExactDuplicateRules,composeMaintainableCandidate,semanticCssIdentity,splitMaintainableCandidate,verifyEquivalentCandidate} from '../ports/scripts/prepare-maintainable-sources.mjs';

test('splits trailing SCP-JP adaptation modules into one maintainable overlay',()=>{
  const source=`[[module CSS]]\n.base { color: black; }\n[[/module]]\nbody\n[[module CSS]]\n/* SCP-JP acceptance repair v9: sample */\n/* Japanese labels need room. */\n.nav { white-space: normal; }\n[[/module]]\n[[module CSS]]\n/* SCP-JP interaction adaptation: keep focus visible. */\n.nav:focus { outline: 2px solid; }\n[[/module]]\n`;
  const result=splitMaintainableCandidate(source);
  assert.equal(result.overlays.length,2);
  assert.doesNotMatch(result.base,/SCP-JP/u);
  assert.doesNotMatch(result.overlayCss,/repair v9/u);
  assert.match(result.overlayCss,/Japanese labels need room/u);
  assert.match(result.overlayCss,/SCP-JP interaction adaptation: keep focus visible/u);
  assert.doesNotThrow(()=>verifyEquivalentCandidate({original:source,base:result.base,rawOverlayCss:result.overlayCss}));
});

test('refuses to move an adaptation ahead of a later ordinary CSS module',()=>{
  const source=`[[module CSS]]/* SCP-JP acceptance: x */ .a{color:red}[[/module]]\n[[module CSS]].later{color:blue}[[/module]]`;
  assert.throws(()=>splitMaintainableCandidate(source),/manual review/u);
});

test('can explicitly classify a legacy unmarked JP module by exact CSS hash',()=>{
  const css='.legacy { color: red; }';
  const source=`[[module CSS]]/* SCP-JP acceptance: first */ .a{color:red}[[/module]]\n[[module CSS]]${css}[[/module]]`;
  const hash='00f550f099537a81f5336f2f47bf3ecbff17c6bfaa61e98dcb6b998e9c53b123';
  const result=splitMaintainableCandidate(source,{unmarkedAdaptations:[{id:'legacy',reason:'legacy JP rule',css_sha256:hash}]});
  assert.equal(result.overlays.length,2);
  assert.equal(result.overlays[1].legacy_unmarked,true);
  assert.equal(result.overlays[1].rationale,'legacy JP rule');
});

test('semantic CSS identity ignores comments and formatting but not strings',()=>{
  assert.equal(semanticCssIdentity('.a { color: red; /* x */ }'),semanticCssIdentity('.a{\n color:red; }'));
  assert.notEqual(semanticCssIdentity('.a{content:"a b"}'),semanticCssIdentity('.a{content:"ab"}'));
});

test('compose emits one final CSS module',()=>{
  assert.equal(composeMaintainableCandidate('body\n','.a{color:red}\n'),'body\n\n[[module CSS]]\n.a{color:red}\n[[/module]]\n');
});

test('compactor removes only earlier exact duplicate rules and preserves canonical cascade',()=>{
  const overlays=[
    {marker:'one',rationale:'first',css:'/* first */\n.a, .b { color: red; }'},
    {marker:'two',rationale:'second',css:'/* second */\n.a { color: red; }\n.c { color: blue; }'},
  ];
  const raw=overlays.map(row=>row.css).join('\n\n');
  const compacted=compactExactDuplicateRules(overlays);
  assert.equal(compacted.removed,1);
  assert.equal(compacted.raw_rule_count,4);
  assert.equal(compacted.canonical_rule_count,3);
  assert.equal(canonicalExactRuleIdentity(raw),canonicalExactRuleIdentity(compacted.css));
  assert.match(compacted.css,/\.b/u);
  assert.match(compacted.css,/\.a/u);
  assert.match(compacted.css,/\.c/u);
});

test('compactor refuses leaf at-rules it cannot reconstruct',()=>{
  assert.throws(()=>compactExactDuplicateRules([{marker:'x',rationale:'x',css:'@font-face { font-family: x; src: url(x.woff2); }'}]),/cannot safely rewrite/u);
});
