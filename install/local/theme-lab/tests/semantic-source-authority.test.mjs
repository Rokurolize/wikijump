import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {planBrowserAcceptance} from '../src/semantic-browser-acceptance.mjs';
import {semanticSourceReferenceHtmlSha,validateSemanticSourceAuthority} from '../src/semantic-source-authority.mjs';

test('hidden search alternatives require current source visibility, navigation, viewport and exact retained artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-search-source-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-search-outside-'));
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const url = 'https://scp-wiki.wikidot.com/theme:example', sourceHash = 'a'.repeat(64);
  const size = {width: 1440, height: 1000}, html = '<form>source fixture</form>';
  try {
    fs.mkdirSync(path.join(root, 'ports/example'), {recursive: true});
    fs.writeFileSync(path.join(root, 'ports/example/manifest.json'), JSON.stringify({reference_url: url, en_source_sha256: sourceHash}));
    fs.writeFileSync(path.join(root, 'source.html'), html);
    fs.writeFileSync(path.join(root, 'measurement.mjs'), 'source measurement fixture');
    const document = {schema: 'theme_lab_wikidot_search_control.v1', theme: 'example', source_url: url, source_sha256: sourceHash,
      public_writes: 0, external_requests_sent: 0, offline: true, original_html_sha256: sha(html), replay_entry: '/o/' + sha(html),
      artifacts: [{path: 'source.html', sha256: sha(html)}], measurement_programs: [{path: 'measurement.mjs', sha256: sha('source measurement fixture')}],
      source_measurements: [{viewport: 'desktop', viewport_size: size, source_sha256: sourceHash, original_html_sha256: sha(html), loaded: {offline: true},
        after_focus: {display: 'none', value: 'Search this site'}, navigation: '/search:site/q/Search%20this%20site',
        handler: {search: 'native submit', events: [{type: 'submit', fn: 'native submit'}]}}]};
    const audit = {records: [{theme: 'example', viewport: 'desktop', viewport_size: size}]};
    const save = () => {
      const bytes = JSON.stringify(document); fs.writeFileSync(path.join(root, 'receipt.json'), bytes);
      audit.records[0].action_contract_observation = {mode: 'source-hidden-submit', source_authority: {path: 'receipt.json', sha256: sha(bytes)}};
    };
    save(); assert.deepEqual(validateSemanticSourceAuthority(root, audit), []);
    document.source_measurements[0].after_focus.display = 'block'; save(); assert.ok(validateSemanticSourceAuthority(root, audit).length);
    document.source_measurements[0].after_focus.display = 'none';
    document.source_measurements[0].navigation = '/search:site/q/other'; save(); assert.ok(validateSemanticSourceAuthority(root, audit).length);
    document.source_measurements[0].navigation = '/search:site/q/Search%20this%20site';
    document.external_requests_sent = 1; save(); assert.ok(validateSemanticSourceAuthority(root, audit).length);
    document.external_requests_sent = 0; save();
    fs.writeFileSync(path.join(root, 'source.html'), 'changed source'); assert.ok(validateSemanticSourceAuthority(root, audit).length);
    fs.writeFileSync(path.join(root,'source.html'),html);const manifestPath=path.join(root,'ports/example/manifest.json'),outside=path.join(outsideRoot,'manifest.json');fs.copyFileSync(manifestPath,outside);fs.rmSync(manifestPath);fs.symlinkSync(outside,manifestPath);
    assert.ok(validateSemanticSourceAuthority(root,audit).some(value=>value.includes('escapes root')));
  } finally {fs.rmSync(root, {recursive: true, force: true});fs.rmSync(outsideRoot,{recursive:true,force:true});}
});

test('retained unmodified source captures are reusable; patched or mutating captures are not source oracles', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-source-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-source-outside-'));
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const source = 'a'.repeat(64), html = 'b'.repeat(64), image = 'c'.repeat(64), rootHtml='d'.repeat(64);
  const url = 'https://scp-wiki.wikidot.com/theme:example';
  try {
    fs.mkdirSync(path.join(root, 'ports/example'), {recursive: true});
    fs.writeFileSync(path.join(root, 'ports/example/manifest.json'), JSON.stringify({reference_url: url, en_source_sha256: source}));
    const audit = {records: [{theme: 'example', viewport: 'desktop', viewport_size: {width: 1440, height: 1000}, surface: 'page.normal', state: 'settled'}]};
    const question = planBrowserAcceptance(audit).visual_questions[0];
    const receipt = {schema: 'theme_lab_wikidot_adaptation_ab.v1', url, public_writes: 0, external_browser_requests: 0,
      snapshot: {replay_complete: true, entry: '/o/' + rootHtml},
      rows: [{variant: 'without', width: 1440, css_sha256: sha(''), dom_sha256: html, screenshot_sha256: image}]};
    const save = () => {
      const bytes = JSON.stringify(receipt); fs.writeFileSync(path.join(root, 'source-capture.json'), bytes);
      audit.semantic_reviews = {[question.id]: {source_url: url, source_snapshot: {sha256: source}, source_html: {sha256: html}, source_rendering: {sha256: image},
        source_rendering_receipt: {path: 'source-capture.json', sha256: sha(bytes)}}};
    };
    save(); assert.deepEqual(validateSemanticSourceAuthority(root, audit), []);
    assert.equal(semanticSourceReferenceHtmlSha(root,audit,'example'),rootHtml);
    const outside=path.join(outsideRoot,'source-capture.json'),inside=path.join(root,'source-capture.json');fs.copyFileSync(inside,outside);fs.symlinkSync(outside,path.join(root,'linked-source-capture.json'));
    audit.semantic_reviews[question.id].source_rendering_receipt={path:'linked-source-capture.json',sha256:sha(fs.readFileSync(outside))};
    assert.ok(validateSemanticSourceAuthority(root,audit).some(value=>value.includes('escapes root')));
    assert.throws(()=>semanticSourceReferenceHtmlSha(root,audit,'example'),/escapes root/u);
    audit.semantic_reviews[question.id].source_rendering_receipt={path:'source-capture.json',sha256:sha(fs.readFileSync(inside))};
    for (const [key, value] of [['public_writes', 1], ['external_browser_requests', 1]]) {
      receipt[key] = value; save(); assert.ok(validateSemanticSourceAuthority(root, audit).length); receipt[key] = 0;
    }
    receipt.rows[0].css_sha256 = sha('candidate diagnostic CSS'); save(); assert.ok(validateSemanticSourceAuthority(root, audit).length);
    receipt.rows[0].css_sha256 = sha(''); receipt.rows[0].variant = 'with'; save(); assert.ok(validateSemanticSourceAuthority(root, audit).length);
  } finally {fs.rmSync(root, {recursive: true, force: true});fs.rmSync(outsideRoot,{recursive:true,force:true});}
});

test('responsive source identity requires an oracle for every named viewport', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-responsive-source-'));
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const source = 'a'.repeat(64), html = 'b'.repeat(64), desktop = 'c'.repeat(64), mobile = 'd'.repeat(64);
  const url = 'https://scp-wiki.wikidot.com/theme:example';
  try {
    fs.mkdirSync(path.join(root, 'ports/example'), {recursive: true});
    fs.writeFileSync(path.join(root, 'ports/example/manifest.json'), JSON.stringify({reference_url: url, en_source_sha256: source}));
    const audit = {records: ['desktop', 'mobile'].map(viewport => ({theme: 'example', viewport, surface: 'page.normal', state: 'settled'}))};
    const question = planBrowserAcceptance(audit).visual_questions[0];
    const receipt = {result: {reference_identity: {source_url: url, original_html_sha256: html,
      replay_entry: '/o/' + html, snapshot_sha256: 'e'.repeat(64), offline: true},
      visual: {viewports: {desktop: {reference_screenshot_sha256: desktop}, mobile: {reference_screenshot_sha256: mobile}}}}};
    const bytes = JSON.stringify(receipt);
    fs.writeFileSync(path.join(root, 'source-capture.json'), bytes);
    const rendering = image => ({source_html: {sha256: html}, source_rendering: {sha256: image}, source_rendering_receipt: {path: 'source-capture.json', sha256: sha(bytes)}});
    const review = {source_url: url, source_snapshot: {sha256: source}, ...rendering(desktop)};
    audit.semantic_reviews = {[question.id]: review};
    assert.ok(validateSemanticSourceAuthority(root, audit).length);
    review.source_renderings = {desktop: rendering(desktop), mobile: rendering(desktop)};
    assert.ok(validateSemanticSourceAuthority(root, audit).length);
    review.source_renderings.mobile = rendering(mobile);
    assert.deepEqual(validateSemanticSourceAuthority(root, audit), []);
    delete review.source_renderings.desktop;
    assert.ok(validateSemanticSourceAuthority(root, audit).length);
  } finally {fs.rmSync(root, {recursive: true, force: true});}
});

test('a native target-baseline search proof applies only to its exact current migration baseline',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'baseline-search-authority-')),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),write=(name,value)=>{fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),value)},binding=name=>({path:name,sha256:sha(fs.readFileSync(path.join(root,name)))});
 try{
 const source='Frozen native Sigma-10 source',css='#search-top-box-input{display:none}',html='Native source HTML',program='Executed source measurement',url='https://pseudo-scp-jp.wikidot.com/sigma-10:main';
 write('sigma10-migration/sources/main.wikidot.txt',source);write('sigma10-migration/sigma10-offline.css',css);write('source.html',html);write('measurement.mjs',program);
 write('sigma10-migration/source-manifest.json',JSON.stringify({pages:{'pseudo-scp-jp:sigma-10:main':{source_url:url,sha256:sha(source),file:'sources/main.wikidot.txt'}}}));
 write('sigma10-migration/current-campaign/run-contract.json',JSON.stringify({schema:'scp_jp_sigma10_migration_run.v1',target_site:{slug:'scpaiueouiuiuiui'},baseline_theme:{replacement_css_sha256:sha(css)}}));
 const size={width:1440,height:1000},document={schema:'theme_lab_wikidot_baseline_search_control.v1',source_url:url,source_sha256:sha(source),source_snapshot:binding('sigma10-migration/sources/main.wikidot.txt'),target_baseline:{name:'Sigma-10',css:binding('sigma10-migration/sigma10-offline.css'),source_manifest:binding('sigma10-migration/source-manifest.json'),run_contract_path:'sigma10-migration/current-campaign/run-contract.json'},public_writes:0,external_requests_sent:0,offline:true,original_html_sha256:sha(html),replay_entry:'/o/'+sha(html),artifacts:[binding('source.html')],measurement_programs:[binding('measurement.mjs')],source_measurements:[{viewport:'desktop',viewport_size:size,source_sha256:sha(source),original_html_sha256:sha(html),loaded:{offline:true},after_focus:{display:'none',value:'サイト検索'},navigation:'/search:site/q/'+encodeURIComponent('サイト検索'),handler:{search:'native search',events:[{type:'submit',fn:'native search'}]}}]};
 const row={theme:'example',viewport:'desktop',viewport_size:size,target_site:'scpaiueouiuiuiui',baseline_theme:'Sigma-10',baseline_theme_mode:'replacement',baseline_theme_css_sha256:sha(css)},audit={records:[row]};
 const save=()=>{write('receipt.json',JSON.stringify(document));row.action_contract_observation={mode:'source-hidden-submit',source_authority:binding('receipt.json')}};save();assert.deepEqual(validateSemanticSourceAuthority(root,audit),[]);
 row.baseline_theme='Sigma-9';assert.ok(validateSemanticSourceAuthority(root,audit).length);row.baseline_theme='Sigma-10';row.target_site='scp-jp';assert.ok(validateSemanticSourceAuthority(root,audit).length);row.target_site='scpaiueouiuiuiui';row.baseline_theme_css_sha256='a'.repeat(64);assert.ok(validateSemanticSourceAuthority(root,audit).length);row.baseline_theme_css_sha256=sha(css);
 write('sigma10-migration/sigma10-offline.css',css+' changed');assert.ok(validateSemanticSourceAuthority(root,audit).length);write('sigma10-migration/sigma10-offline.css',css);
 write('sigma10-migration/sources/main.wikidot.txt',source+' changed');assert.ok(validateSemanticSourceAuthority(root,audit).length);write('sigma10-migration/sources/main.wikidot.txt',source);
 document.target_baseline.source_manifest.path='source.html';save();assert.ok(validateSemanticSourceAuthority(root,audit).length);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
