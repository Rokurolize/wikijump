import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  SURFACE_CONTRACT_SCHEMA,
  analyzeThemeSurfaceUsage,
  issuesFromCustomSelectorCoverage,
  normalizeSurfaceContract,
} from '../src/theme-surface-contract.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');

test('surface analysis discovers runtime surfaces from theme CSS rather than palette names',()=>{
  const css=`
    #header h1 a { font-size: 2rem; }
    @media (max-width: 767px) { #side-bar { background: #999; } }
    .mobile-top-bar > ul > li > ul { max-width: 100vw; }
    .page-rate-widget-box { filter: grayscale(1); }
    .creditButton a { color: white; }
    .yui-navset { filter: grayscale(1); }
  `;
  const result=analyzeThemeSurfaceUsage(css,'auto');
  assert.deepEqual(result.surfaces.map(row=>row.id),[
    'shell.header','nav.mobile-top','nav.sidebar','content.rating','content.credit','content.tabview'
  ]);
  const sidebar=result.surfaces.find(row=>row.id==='nav.sidebar');
  assert.equal(sidebar.responsive,true);
  assert.ok(sidebar.at_contexts.some(row=>row.startsWith('@media')));
});

test('surface analysis covers article links and page actions for unrelated theme structures',()=>{
  const css=`
    #page-title { letter-spacing: .08em; }
    #page-content { max-width: 52rem; }
    a:visited { color: rebeccapurple; }
    #page-options-bottom a { border-radius: .25rem; }
    .creditButton a { text-decoration: none; }
  `;
  const ids=new Set(analyzeThemeSurfaceUsage(css,'auto').surfaces.map(row=>row.id));
  for(const id of ['content.article','content.links','page.actions','content.credit']){
    assert.ok(ids.has(id),`missing ${id}`);
  }
});

test('surface contract validates custom selectors and fails closed on missing coverage',()=>{
  const contract=normalizeSurfaceContract({
    schema:SURFACE_CONTRACT_SCHEMA,
    strict:true,
    custom_selectors:[{id:'theme.heading-flicker',selector:'h2 .flickering',viewports:['desktop','mobile'],reason:'source hub uses the themed heading'}]
  });
  assert.equal(contract.custom_selectors.length,1);
  const issues=issuesFromCustomSelectorCoverage([
    {id:'theme.heading-flicker',selector:'h2 .flickering',viewport:'desktop',count:1,error:null},
    {id:'theme.heading-flicker',selector:'h2 .flickering',viewport:'mobile',count:0,error:null},
  ],true);
  assert.equal(issues.length,1);
  assert.equal(issues[0].severity,'error');
  assert.equal(issues[0].kind,'custom_surface_selector_missing');
  assert.equal(issues[0].viewport,'mobile');
});

test('FR example automatically declares the general runtime surfaces learned from staff comparison',()=>{
  const css=fs.readFileSync(path.join(root,'ports/quand-le-soleil-se-couche/candidate-template.css'),'utf8');
  const ids=new Set(analyzeThemeSurfaceUsage(css,'auto').surfaces.map(row=>row.id));
  for(const id of ['shell.header','nav.mobile-top','nav.sidebar','content.rating','content.credit','content.tabview']){
    assert.ok(ids.has(id),`missing ${id}`);
  }
});

test('surface analyzer accepts every frozen EN campaign candidate CSS',()=>{
  const campaign=JSON.parse(fs.readFileSync(path.join(root,'ports/en-theme-campaign.json'),'utf8'));
  assert.equal(campaign.themes.length,34);
  for(const theme of campaign.themes){
    const packageDir=path.resolve(root,'../../..',theme.port_package_path);
    const css=fs.readFileSync(path.join(packageDir,'candidate.css'),'utf8');
    const result=analyzeThemeSurfaceUsage(css,'auto');
    assert.equal(result.schema,SURFACE_CONTRACT_SCHEMA,theme.slug);
    assert.ok(Array.isArray(result.surfaces),theme.slug);
  }
});

test('surface contract rejects duplicate or unsupported custom selector definitions',()=>{
  assert.throws(()=>normalizeSurfaceContract({
    schema:SURFACE_CONTRACT_SCHEMA,
    custom_selectors:[{id:'x',selector:'.x'},{id:'x',selector:'.y'}]
  }),/duplicate custom selector/u);
  assert.throws(()=>normalizeSurfaceContract({
    schema:SURFACE_CONTRACT_SCHEMA,
    custom_selectors:[{id:'x',selector:'.x',viewports:['watch']}]
  }),/unsupported viewports/u);
  assert.throws(()=>normalizeSurfaceContract({
    schema:SURFACE_CONTRACT_SCHEMA,
    reviewed_exceptions:[{kind:'surface_text_color_changed_on_image_background'}]
  }),/requires rationale/u);
});

test('surface contract retains reviewed exceptions as explicit evidence rather than disabling strict mode',()=>{
  const contract=normalizeSurfaceContract({
    schema:SURFACE_CONTRACT_SCHEMA,
    strict:true,
    reviewed_exceptions:[{
      kind:'surface_text_color_changed_on_image_background',
      surface:'content.links',
      selector:'#page-content a[href]',
      rationale:'Source theme deliberately uses this palette and paired screenshots were reviewed.'
    }]
  });
  assert.equal(contract.strict,true);
  assert.equal(contract.reviewed_exceptions.length,1);
  assert.match(contract.reviewed_exceptions[0].rationale,/paired screenshots/u);
});
