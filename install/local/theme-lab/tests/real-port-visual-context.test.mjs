import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('real port runner supplies the candidate source separately from rendered preview text',()=>{
 const source=fs.readFileSync(new URL('../scripts/real-port-regression.mjs',import.meta.url),'utf8');
 assert.match(source,/const sourceFile=resolveExistingPackageFile/u);
 assert.match(source,/"--source", sourceFile/u);
 assert.match(source,/candidate_source_sha256: sha256\(sourceFile\)/u);
});

test('visual pair result declares cross-document identity comparison as diagnostic-only',()=>{
 const source=fs.readFileSync(new URL('../src/session-server.mjs',import.meta.url),'utf8');
 assert.match(source,/comparison_scope: "cross-document-theme-identity"/u);
 assert.match(source,/pixel_metric_decision_authority: false/u);
 assert.match(source,/bindVisualAcceptance\(visualResult, visualReview, \{css, baseCss, wikitext, source\}\)/u);
});
