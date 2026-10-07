import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from '../src/adaptation-authority.mjs';
import {nativeNavigationDoesNotWorsen} from '../src/native-navigation-attribution.mjs';
const ports=fileURLToPath(new URL('../ports/',import.meta.url));
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/wikidot-adaptation-semantic.json',import.meta.url),'utf8'));
const finalPublicationSet=JSON.parse(fs.readFileSync(path.join(ports,'../publication/final-manual-publication-set.json'),'utf8'));
const ledger=JSON.parse(fs.readFileSync(path.join(ports,'adaptation-authority.json'),'utf8'));
assert.equal(fixture.schema,'theme_lab_compact_semantic_fixture.v2');
assert.equal(fixture.source_tag,'theme-lab-final-acceptance-20261007');
assert.equal(fixture.candidate_set_sha256,finalPublicationSet.candidate_freeze.candidate_set_sha256);

function postFreezeBinding(theme,source) {
  const binding=finalPublicationSet.post_freeze_target_visual_reviews?.find(review=>review.package===theme);
  if(!binding)return null;
  const retained=fixture.post_freeze[theme];
  assert.ok(retained,`${theme}: compact post-freeze binding missing`);
  assert.equal(binding.candidate_set_sha256,fixture.candidate_set_sha256,theme);
  assert.equal(binding.candidate_source_sha256,digest(fs.readFileSync(path.join(ports,theme,'candidate.wikidot.source.txt'))),theme);
  assert.equal(binding.candidate_css_sha256,digest(fs.readFileSync(path.join(ports,theme,'candidate.css'))),theme);
  assert.equal(retained.capture_path,binding.capture_receipt.path.replace(/^ports\//u,''),theme);
  assert.equal(retained.capture_sha256,binding.capture_receipt.sha256,theme);
  assert.equal(retained.visual_review_path,binding.visual_review.path,theme);
  assert.equal(retained.visual_review_sha256,binding.visual_review.sha256,theme);
  assert.equal(retained.candidate_source_sha256,binding.candidate_source_sha256,theme);
  assert.equal(retained.candidate_css_sha256,binding.candidate_css_sha256,theme);
  assert.equal(source.source_path,retained.capture_path,theme);
  assert.equal(source.source_sha256,retained.capture_sha256,theme);
  assert.equal(retained.reviewed_screenshots,source.rows.length,theme);
  return retained;
}

test('compact semantic fixture is traceable to the frozen final campaign',()=>{
  assert.match(fixture.candidate_set_sha256,/^[0-9a-f]{64}$/u);
  for(const section of Object.values(fixture.navigation))assert.match(section.evidence.source_sha256,/^[0-9a-f]{64}$/u);
  for(const section of Object.values(fixture.post_freeze)){
    assert.match(section.capture_sha256,/^[0-9a-f]{64}$/u);
    assert.match(section.visual_review_sha256,/^[0-9a-f]{64}$/u);
  }
});

test('cleaned navigation packages contain or preserve native baseline menu geometry at both mobile widths',()=>{
  for(const theme of ['al-slop','foxtrot','hansarp','pataphysics','quand-le-soleil-se-couche','scpedia','space','paperstack','turbo-vision','sigma']) {
    const corrected=['al-slop','paperstack','turbo-vision'].includes(theme);
    const current=ledger.packages[theme].current_navigation_evidence;
    const compact=fixture.navigation[theme];
    assert.ok(compact,theme);
    if(current){
      assert.deepEqual(compact.ledger_current,{path:current.path,sha256:current.sha256},theme);
      assert.match(current.sha256,/^[0-9a-f]{64}$/u);
    }
    postFreezeBinding(theme,compact.evidence);
    const r=compact.evidence;
    assert.equal(r.public_writes,0);assert.equal(r.external_browser_requests,0);
    const after=r.rows.filter(row=>row.variant==='with');
    const baseline=compact.baseline??null;
    if(baseline){
      assert.deepEqual(compact.ledger_baseline,{path:current.baseline.path,sha256:current.baseline.sha256},theme);
      assert.equal(baseline.public_writes,0);assert.equal(baseline.external_browser_requests,0);
      assert.equal(baseline.url,r.url);assert.equal(baseline.snapshot_entry,r.snapshot_entry);assert.equal(baseline.browser_version,r.browser_version);
      assert.ok(baseline.rows.every(row=>row.css_sha256===digest(Buffer.alloc(0))));
    }
    assert.deepEqual([...new Set(after.map(row=>row.width))],[320,390]);
    assert.equal(after.length,8,theme);
    for(const row of after) {
      assert.equal(row.css_sha256,digest(fs.readFileSync(path.join(ports,theme,'candidate.css'))),theme);
      if(baseline){
        const before=baseline.rows.find(candidate=>candidate.variant==='without'&&candidate.width===row.width&&candidate.state===row.state&&candidate.index===row.index);
        assert.ok(nativeNavigationDoesNotWorsen(row,before),theme);
      }else{
        assert.equal(row.pass,true,theme);
        assert.ok(row.measurement.document_width<=row.width+1,theme);
        assert.ok(row.bounds.every(bound=>bound.pass),theme);
      }
      assert.ok(row.measurement.rows.some(probe=>probe.selector==='a'),theme);
    }
    if(corrected){
      const actual=ledger.packages[theme].blocks.filter(block=>block.authority==='TARGET_WIKIDOT_CERTIFIED'&&(block.scope?.state==='navigation'||block.scope?.states?.includes('navigation'))).map(block=>block.marker).sort();
      const retained=fixture.corrective_need[theme];
      assert.deepEqual(retained.map(row=>row.marker).sort(),actual,theme);
      assert.ok(retained.every(row=>row.need),theme);
    }
  }
});

test('distinct Space header and invisible Turbo masthead retain independent target A/B conclusions',()=>{
  const space=fixture.headers['space-header-complete-source-current'];
  assert.equal(space.all_with_pass,true);
  assert.ok(space.h1_width_320>0);
  const turbo=fixture.headers['turbo-header-complete-source-current'];
  assert.equal(turbo.any_without_fail,true);
  assert.equal(turbo.all_with_pass,true);
});

test('real EN and JP search authority preserves normal, hover and focus behavior',()=>{
  for(const site of ['en','jp'])for(const state of ['normal','search-hover','search-focus']) {
    const r=fixture.search[`${site}:${state}`];
    assert.ok(r);
    for(const row of r.rows) {
      assert.equal(row.state,state);
      assert.equal(row.display,site==='en'?'none':'inline-block');
      if(state==='search-focus')assert.equal(row.focused,site==='jp');
    }
  }
  for(const entry of fs.readdirSync(ports,{withFileTypes:true}).filter(e=>e.isDirectory())) {
    for(const file of ['candidate.css','candidate-source.css','authority-overrides.css']) {
      const cssPath=path.join(ports,entry.name,file);if(!fs.existsSync(cssPath))continue;
      assert.doesNotMatch(fs.readFileSync(cssPath,'utf8'),/SCP-JP interaction adaptation: reveal Sigma/);
    }
  }
});

test('real Sigma-10 return controls fit and saved page suppresses the preview-only notice',()=>{
  const credit=fixture.sigma10.credit;
  assert.deepEqual([...new Set(credit.rows.map(row=>row.width))],[320,390]);
  for(const row of credit.rows){
    assert.equal(row.pass,true);
    assert.equal(row.dom_flags.return_credits,true);
    assert.equal(row.dom_flags.credit_back,false);
  }
  for(const row of fixture.sigma10.saved.rows){
    assert.equal(row.notice_display,'none');
    assert.ok(row.document_width<=row.width+1);
  }
});

test('Flopstyle Dark current Sigma-10 credit acceptance uses the real return component',()=>{
  const current=ledger.packages['flopstyle-dark'].current_sigma10_credit_evidence;
  assert.deepEqual(fixture.flopstyle.ledger_current,current);
  postFreezeBinding('flopstyle-dark',{source_path:fixture.flopstyle.source_path,source_sha256:fixture.flopstyle.source_sha256,rows:fixture.flopstyle.rows});
  const r=fixture.flopstyle;
  assert.equal(r.url,'https://pseudo-scp-jp.wikidot.com/sigma-10:main');
  assert.equal(r.public_writes,0);assert.equal(r.external_browser_requests,0);
  assert.deepEqual([...new Set(r.rows.map(row=>row.width))],[320,390]);
  assert.deepEqual([...new Set(r.rows.map(row=>row.state))],['credit-otherwise']);
  const cssHash=digest(fs.readFileSync(path.join(ports,'flopstyle-dark/candidate.css')));
  const without=r.rows.filter(row=>row.variant==='without'),withTheme=r.rows.filter(row=>row.variant==='with');
  assert.equal(without.length,2);assert.equal(withTheme.length,2);
  for(const row of [...without,...withTheme]){
    assert.equal(row.pass,true,`${row.variant}/${row.width}`);
    assert.equal(row.document_width,row.width,`${row.variant}/${row.width}`);
    assert.equal(row.return_credits,1);assert.equal(row.return_credits_a,1);
    assert.equal(row.dom_flags.return_credits,true);assert.equal(row.dom_flags.credit_back_link,false);
  }
  assert.ok(withTheme.every(row=>row.css_sha256===cssHash));
  assert.ok(without.every(row=>row.css_sha256===digest(Buffer.alloc(0))));
  const fixtureDir=path.join(ports,'interactive-visual-fixture');
  const historical=JSON.parse(fs.readFileSync(path.join(fixtureDir,'fixture-source.json'),'utf8'));
  assert.equal(historical.target_version,'SIGMA9_HISTORICAL_SOURCE_WITH_SYNTHETIC_SUBSTITUTIONS');
  assert.equal(historical.decision_authority,'SYNTHETIC_DIAGNOSTIC_ONLY');
  assert.equal(historical.port_conclusion_eligible,false);
  assert.ok(historical.synthetic_selectors.includes('.credit-back-link'));
  const builder=fs.readFileSync(path.join(fixtureDir,'build-fixture.mjs'),'utf8');
  assert.match(builder,/--target=sigma10[\s\S]*?cannot represent Sigma-10/u);
});
