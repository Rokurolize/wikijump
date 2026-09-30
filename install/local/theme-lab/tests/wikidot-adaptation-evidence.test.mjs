import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {digest} from '../src/adaptation-authority.mjs';
const ports=fileURLToPath(new URL('../ports/',import.meta.url));
const evidence=path.join(ports,'authority-evidence');
function receipt(name) {
  const dir=path.join(evidence,name),r=JSON.parse(fs.readFileSync(path.join(dir,'receipt.json'),'utf8'));
  assert.equal(r.public_writes,0);assert.equal(r.external_browser_requests,0);
  assert.equal(r.site,new URL(r.url).hostname);
  for(const row of r.rows)for(const [file,hash] of [['screenshot','screenshot_sha256'],['dom','dom_sha256']])assert.equal(digest(fs.readFileSync(path.join(dir,row[file]))),row[hash]);
  return r;
}

test('all nine cleaned navigation packages fit every menu/link at both mobile widths',()=>{
  for(const theme of ['al-slop','foxtrot','hansarp','pataphysics','quand-le-soleil-se-couche','scpedia','space','paperstack','turbo-vision']) {
    const corrected=['al-slop','paperstack','turbo-vision'].includes(theme);
    const ledger=JSON.parse(fs.readFileSync(path.join(ports,'adaptation-authority.json'),'utf8'));
    const current=ledger.packages[theme].current_navigation_evidence;
    if(current)assert.equal(digest(fs.readFileSync(path.join(ports,current.path))),current.sha256);
    const r=receipt(current?path.dirname(current.path).replace(/^authority-evidence\//u,''):corrected?theme+'-published-final':'removed-'+theme);
    const after=r.rows.filter(row=>row.variant==='with');
    assert.deepEqual([...new Set(after.map(row=>row.width))],[320,390]);
    assert.equal(after.length,8,theme);
    for(const row of after) {
      assert.equal(row.css_sha256,digest(fs.readFileSync(path.join(ports,theme,'candidate.css'))),theme);
      assert.equal(row.pass,true,theme);
      assert.ok(row.measurement.document_width<=row.width+1,theme);
      assert.ok(row.bounds.every(bound=>bound.pass),theme);
      assert.ok(row.measurement.rows.some(probe=>probe.selector==='a'),theme);
    }
    if(corrected)assert.ok(r.rows.some(row=>row.variant==='without'&&!row.pass),theme);
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
  const r=receipt('flopstyle-dark-sigma10-credit-candidate-current');
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
    const dom=gunzipSync(fs.readFileSync(path.join(evidence,'flopstyle-dark-sigma10-credit-candidate-current',row.dom))).toString();
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
