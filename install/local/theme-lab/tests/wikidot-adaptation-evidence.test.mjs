import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {digest} from '../src/adaptation-authority.mjs';
import {nativeNavigationDoesNotWorsen} from '../src/native-navigation-attribution.mjs';
const ports=fileURLToPath(new URL('../ports/',import.meta.url));
const evidence=path.join(ports,'authority-evidence');
const finalPublicationSet=JSON.parse(fs.readFileSync(path.join(ports,'../publication/final-manual-publication-set.json'),'utf8'));
function receipt(name,{allowMissingDom=false}={}) {
  const dir=path.join(evidence,name),r=JSON.parse(fs.readFileSync(path.join(dir,'receipt.json'),'utf8'));
  assert.equal(r.public_writes,0);assert.equal(r.external_browser_requests,0);
  assert.equal(r.site,new URL(r.url).hostname);
  for(const row of r.rows)for(const [file,hash] of [['screenshot','screenshot_sha256'],['dom','dom_sha256']]){
    const attachment=path.join(dir,row[file]);
    if(file==='dom'&&allowMissingDom&&!fs.existsSync(attachment)){assert.match(row[hash],/^[0-9a-f]{64}$/u);continue;}
    assert.equal(digest(fs.readFileSync(attachment)),row[hash]);
  }
  return r;
}
function postFreezeVisualReview(theme) {
  const binding=finalPublicationSet.post_freeze_target_visual_reviews?.find(review=>review.package===theme);
  if(!binding)return null;
  assert.equal(binding.candidate_set_sha256,finalPublicationSet.candidate_freeze.candidate_set_sha256,theme);
  assert.equal(binding.candidate_source_sha256,digest(fs.readFileSync(path.join(ports,theme,'candidate.wikidot.source.txt'))),theme);
  assert.equal(binding.candidate_css_sha256,digest(fs.readFileSync(path.join(ports,theme,'candidate.css'))),theme);
  const receiptPath=path.resolve(ports,'..',binding.capture_receipt.path);
  const visualReviewPath=path.resolve(ports,'..',binding.visual_review.path);
  assert.equal(digest(fs.readFileSync(receiptPath)),binding.capture_receipt.sha256,theme);
  assert.equal(digest(fs.readFileSync(visualReviewPath)),binding.visual_review.sha256,theme);
  const visualReview=JSON.parse(fs.readFileSync(visualReviewPath,'utf8'));
  assert.equal(visualReview.candidate_source_sha256,binding.candidate_source_sha256,theme);
  assert.equal(visualReview.candidate_css_sha256,binding.candidate_css_sha256,theme);
  assert.equal(visualReview.capture_receipt.path,binding.capture_receipt.path.replace(/^ports\//u,''),theme);
  assert.equal(visualReview.capture_receipt.sha256,binding.capture_receipt.sha256,theme);
  const evidenceName=path.dirname(binding.capture_receipt.path.replace(/^ports\/authority-evidence\//u,''));
  const captured=receipt(evidenceName,{allowMissingDom:true});
  assert.equal(visualReview.reviewed_screenshots.length,captured.rows.length,theme);
  for(const screenshot of visualReview.reviewed_screenshots){
    const row=captured.rows.find(candidate=>candidate.variant===screenshot.variant&&candidate.width===screenshot.width&&candidate.state===screenshot.state&&candidate.index===screenshot.index);
    assert.ok(row,`${theme}: reviewed screenshot row missing`);
    assert.equal(screenshot.sha256,row.screenshot_sha256,theme);
    assert.equal(digest(fs.readFileSync(path.join(ports,screenshot.path))),screenshot.sha256,theme);
  }
  return {evidenceName,receipt:captured};
}

test('cleaned navigation packages contain or preserve native baseline menu geometry at both mobile widths',()=>{
  for(const theme of ['al-slop','foxtrot','hansarp','pataphysics','quand-le-soleil-se-couche','scpedia','space','paperstack','turbo-vision','sigma']) {
    const corrected=['al-slop','paperstack','turbo-vision'].includes(theme);
    const ledger=JSON.parse(fs.readFileSync(path.join(ports,'adaptation-authority.json'),'utf8'));
    const current=ledger.packages[theme].current_navigation_evidence;
    if(current)assert.equal(digest(fs.readFileSync(path.join(ports,current.path))),current.sha256);
    const postFreeze=postFreezeVisualReview(theme);
    let evidenceName=current?path.dirname(current.path).replace(/^authority-evidence\//u,''):corrected?theme+'-published-final':'removed-'+theme;
    if(postFreeze)evidenceName=postFreeze.evidenceName;
    const r=postFreeze?.receipt??receipt(evidenceName);
    const after=r.rows.filter(row=>row.variant==='with');
    const baseline=current?.baseline?JSON.parse(fs.readFileSync(path.join(ports,current.baseline.path),'utf8')):null;
    if(baseline){
      assert.equal(digest(fs.readFileSync(path.join(ports,current.baseline.path))),current.baseline.sha256);
      assert.equal(baseline.public_writes,0);assert.equal(baseline.external_browser_requests,0);
      assert.equal(baseline.url,r.url);assert.equal(baseline.snapshot.entry,r.snapshot.entry);assert.equal(baseline.browser_version,r.browser_version);
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
    // Trusted current-control receipts may compare identical current CSS on both sides.
    // Corrective A/B need belongs to each separately bound authority block.
    if(corrected)for(const block of ledger.packages[theme].blocks.filter(block=>block.authority==='TARGET_WIKIDOT_CERTIFIED'&&(block.scope?.state==='navigation'||block.scope?.states?.includes('navigation')))){
      assert.ok(block.evidence.some(binding=>JSON.parse(fs.readFileSync(path.join(ports,binding.path),'utf8')).rows.some(row=>row.variant==='without'&&!row.pass)),theme);
    }
  }
});

test('distinct Space header and invisible Turbo masthead have independent target A/B need',()=>{
  const space=receipt('space-header-complete-source-current');
  assert.ok(space.rows.filter(row=>row.variant==='with').every(row=>row.pass));
  assert.ok(space.rows.find(row=>row.width===320&&row.variant==='with').measurement.header_ink_rects['#header h1'][0].width>0);
  const turbo=receipt('turbo-header-complete-source-current');
  assert.ok(turbo.rows.some(row=>row.variant==='without'&&!row.pass));
  assert.ok(turbo.rows.filter(row=>row.variant==='with').every(row=>row.pass));
});

test('real EN and JP search authority preserves normal, hover and focus behavior',()=>{
  for(const site of ['en','jp'])for(const [suffix,state] of [['-normal','normal'],['-search-hover','search-hover'],['','search-focus']]) {
    const r=receipt('search-'+site+suffix);
    for(const row of r.rows) {
      assert.equal(row.state,state);
      assert.equal(row.measurement.search.display,site==='en'?'none':'inline-block');
      if(state==='search-focus')assert.equal(row.measurement.search.focused,site==='jp');
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
  const r=receipt('sigma-credit-final');
  assert.deepEqual([...new Set(r.rows.map(row=>row.width))],[320,390]);
  for(const row of r.rows) {
    assert.equal(row.pass,true);
    const dom=gunzipSync(fs.readFileSync(path.join(evidence,'sigma-credit-final',row.dom))).toString();
    assert.match(dom,/class="[^"]*\breturn-credits\b/);
    assert.doesNotMatch(dom,/class="[^"]*\bcredit-back\b/);
  }
  for(const row of receipt('sigma-saved-final').rows) {
    const notice=row.measurement.rows.find(probe=>probe.selector==='.creditRate::before');
    assert.equal(notice.style.display,'none');
    assert.ok(row.measurement.document_width<=row.width+1);
  }
});

test('Flopstyle Dark current Sigma-10 credit acceptance uses the real return component',()=>{
  const ledger=JSON.parse(fs.readFileSync(path.join(ports,'adaptation-authority.json'),'utf8'));
  const current=ledger.packages['flopstyle-dark'].current_sigma10_credit_evidence;
  if(current)assert.equal(digest(fs.readFileSync(path.join(ports,current.path))),current.sha256);
  const postFreeze=postFreezeVisualReview('flopstyle-dark');
  const evidenceDirectory=postFreeze?.evidenceName??(current?path.dirname(current.path).replace(/^authority-evidence\//u,''):'flopstyle-dark-sigma10-credit-candidate-current');
  const r=postFreeze?.receipt??receipt(evidenceDirectory);
  assert.equal(r.url,'https://pseudo-scp-jp.wikidot.com/sigma-10:main');
  assert.equal(r.public_writes,0);
  assert.equal(r.external_browser_requests,0);
  assert.deepEqual([...new Set(r.rows.map(row=>row.width))],[320,390]);
  assert.deepEqual([...new Set(r.rows.map(row=>row.state))],['credit-otherwise']);
  const cssHash=digest(fs.readFileSync(path.join(ports,'flopstyle-dark/candidate.css')));
  const without=r.rows.filter(row=>row.variant==='without');
  const withTheme=r.rows.filter(row=>row.variant==='with');
  assert.equal(without.length,2);
  assert.equal(withTheme.length,2);
  for(const row of [...without,...withTheme]) {
    assert.equal(row.pass,true,`${row.variant}/${row.width}`);
    assert.equal(row.measurement.document_width,row.width,`${row.variant}/${row.width}`);
    assert.equal(row.measurement.selector_coverage['.creditRateOtherwiseBottom .return-credits'],1);
    assert.equal(row.measurement.selector_coverage['.creditRateOtherwiseBottom .return-credits a'],1);
    const dom=gunzipSync(fs.readFileSync(path.join(evidence,evidenceDirectory,row.dom))).toString();
    assert.match(dom,/class="[^"]*\breturn-credits\b/u);
    assert.doesNotMatch(dom,/class="[^"]*\bcredit-back-link\b/u);
  }
  assert.ok(withTheme.every(row=>row.css_sha256===cssHash));
  assert.ok(without.every(row=>row.css_sha256===digest(Buffer.alloc(0))));

  // The shared visual fixture is intentionally historical Sigma-9 diagnostic
  // markup. Its synthetic iframe replacement must never own Sigma-10 credit
  // acceptance or authorize a Flopstyle source correction.
  const fixtureDir=path.join(ports,'interactive-visual-fixture');
  const fixture=JSON.parse(fs.readFileSync(path.join(fixtureDir,'fixture-source.json'),'utf8'));
  assert.equal(fixture.target_version,'SIGMA9_HISTORICAL_SOURCE_WITH_SYNTHETIC_SUBSTITUTIONS');
  assert.equal(fixture.decision_authority,'SYNTHETIC_DIAGNOSTIC_ONLY');
  assert.equal(fixture.port_conclusion_eligible,false);
  assert.ok(fixture.synthetic_selectors.includes('.credit-back-link'));
  const builder=fs.readFileSync(path.join(fixtureDir,'build-fixture.mjs'),'utf8');
  assert.match(builder,/--target=sigma10[\s\S]*?cannot represent Sigma-10/u);
});
