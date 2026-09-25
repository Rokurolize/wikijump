#!/usr/bin/env node
// Restore capture metadata from successful screenshot artifacts after an
// interrupted/concurrent manifest writer. This never assigns a visual PASS.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {withAuditLock} from './audit-lock.mjs';

const scriptDir=path.dirname(fileURLToPath(import.meta.url));
const portsDir=path.resolve(scriptDir,'..');
const fixtureDir=path.join(portsDir,'interactive-visual-fixture');
const auditPath=path.join(portsDir,'interactive-visual-audit.json');
const runContract=JSON.parse(await fs.readFile(path.join(fixtureDir,'acceptance-run-contract.json'),'utf8'));
const runContractSha=sha(await fs.readFile(path.join(fixtureDir,'acceptance-run-contract.json')));
const contracts=JSON.parse(await fs.readFile(process.argv[2]??'/tmp/theme-contracts.json','utf8'));
const campaign=JSON.parse(await fs.readFile(path.join(portsDir,'en-theme-campaign.json'),'utf8'));
const themeSlugs=['dear-dictator',...campaign.themes.map(theme=>theme.slug.replace(/^theme:/u,''))];
const crossEngineCore=new Set(['page.normal|settled','credit.view|open','page.history|list','page.source|open','nav.sidebar|open','nav.sidebar|open-submenu']);
const viewports=runContract.viewports;
const previous=JSON.parse(await fs.readFile(auditPath,'utf8'));
const previousUpdatedAt=previous.updated_at??null;
const previousRecords=previous.records??[];
const latestByKey=new Map(previousRecords.map(record=>[key(record),record]));
const stateSpecs=contracts.states;
const recordPrototypes=new Map();
for(const record of previousRecords)if(!recordPrototypes.has(`${record.surface}|${record.state}`))recordPrototypes.set(`${record.surface}|${record.state}`,record);
const engines=['chromium','firefox','webkit'];
const versions=Object.fromEntries(engines.map(engine=>[engine,previousRecords.find(record=>record.browser_engine===engine)?.browser_version??null]));
for(const engine of engines)if(!versions[engine]){
 const require=createRequire(path.resolve(portsDir,'../../../../framerail/package.json'));
 const pw=require('@playwright/test');const browser=await pw[engine].launch({headless:true});versions[engine]=browser.version();await browser.close();
}
const records=[];
const missing=[];
for(const theme of themeSlugs){
 const dir=path.join(portsDir,theme);
 const css=await fs.readFile(path.join(dir,'candidate.css')).catch(()=>null);
 if(!css)continue;
 const cssText=css.toString('utf8');
 const baseCss=await fs.readFile(path.join(dir,'candidate-base.css')).catch(()=>Buffer.alloc(0));
 const source=await fs.readFile(path.join(dir,'candidate.wikidot.source.txt')).catch(()=>fs.readFile(path.join(dir,'candidate.wikidot.txt')).catch(()=>Buffer.alloc(0)));
 const rawCssSha=sha(css);
 const baseCssSha=baseCss.length?sha(baseCss):null;
 const combinedCssSha=sha(Buffer.from(JSON.stringify({baseCssSha,css:cssText})));
 const knownIds=new Set(previousRecords.filter(record=>record.theme===theme).map(record=>record.candidate_sha256));
 const candidateSha=baseCss.length?combinedCssSha:knownIds.has(rawCssSha)?rawCssSha:knownIds.has(combinedCssSha)?combinedCssSha:rawCssSha;
 const sourceSha=sha(source);
 const runtimeSupport=await fs.readFile(path.join(fixtureDir,'runtime-asset-replay.css'),'utf8');
 const referenced=[...new Set(`${runtimeSupport}\n${baseCss.toString('utf8')}\n${cssText}\n${source.toString('utf8')}`.match(/[0-9a-f]{64}\.(?:svg|png|jpe?g|webp|woff2?|ttf|otf|eot)/giu)??[])].sort();
 const assetDependencies=[];
 for(const name of referenced){let asset=null;for(const candidate of [path.join(portsDir,'shared-replay-assets',name),path.join(dir,'page-assets',name)]){try{asset=await fs.readFile(candidate);break}catch{}}assetDependencies.push({name,sha256:asset?sha(asset):null,status:asset?'local-cache':'missing'})}
 const assetSha=sha(Buffer.from(JSON.stringify(assetDependencies)));
 const sourceStat=await fs.stat(path.join(dir,'candidate.wikidot.source.txt')).catch(()=>fs.stat(path.join(dir,'candidate.wikidot.txt')));
 const dependencyMtimes=await Promise.all([
  fs.stat(path.join(dir,'candidate.css')).then(s=>s.mtimeMs),
  baseCss.length?fs.stat(path.join(dir,'candidate-base.css')).then(s=>s.mtimeMs):Promise.resolve(0),
  Promise.resolve(sourceStat).then(s=>s.mtimeMs),
  fs.stat(path.join(fixtureDir,'runtime-asset-replay.css')).then(s=>s.mtimeMs)
 ]);
  for(const engine of engines){
  const engineStates=engine==='chromium'?stateSpecs:stateSpecs.filter(spec=>crossEngineCore.has(`${spec.surface}|${spec.state}`));
  for(const spec of engineStates){
   const engineViewports=engine==='chromium'?spec.applicable_viewports:(spec.surface==='nav.sidebar'?['mobile']:['desktop','mobile']);
   for(const viewport of engineViewports.filter(value=>spec.applicable_viewports.includes(value))){
    const surfaceSlug=spec.surface.replaceAll('.','-');
    const filename=`${surfaceSlug}-${spec.state}-${viewport}.png`;
    const relative=path.join(theme,'artifacts','interactive',engine,viewport,filename);
    const screenshotPath=path.join(portsDir,relative);
    let image;try{image=await fs.readFile(screenshotPath)}catch{missing.push({theme,engine,viewport,surface:spec.surface,state:spec.state,path:relative});continue}
    const screenshotSha=sha(image);
    const old=latestByKey.get(`${theme}|${engine}|${viewport}|${spec.surface}|${spec.state}`);
    const oldValid=old?.screenshot===relative&&old.screenshot_sha256===screenshotSha&&old.candidate_sha256===candidateSha&&old.candidate_source_sha256===sourceSha;
    const imageStat=await fs.stat(screenshotPath);
    const sourceCurrentAtCapture=imageStat.mtimeMs>=Math.max(...dependencyMtimes);
    const envSha=sha(Buffer.from(JSON.stringify({runContractSha,fixtureSha:contracts.fixture_contract_sha256,site:runContract.target_site,baselineTheme:{name:'Sigma-9',stylesheet_href:'/wikidot/styles/sigma-fe5388a32e12.css'},browserEngine:engine,browserVersion:versions[engine],viewportName:viewport,viewportSize:viewports[viewport],assetDependencySha:assetSha})));
    const runtimeSha=contracts.runtime_surface_contracts[spec.surface]??null;
    const prototype=recordPrototypes.get(`${spec.surface}|${spec.state}`);
    const actionSequence=oldValid?old.action_sequence:prototype?.action_sequence?.length?prototype.action_sequence:[{type:'state-action-completed',target:`${spec.surface}.${spec.state}`,evidence:'canonical successful screenshot filename (failed captures use a -failed suffix)'}];
    const visuallyReviewed=oldValid&&old.reviewed_after_last_change===true;
    const classification=visuallyReviewed?old.classification:'UNCONFIRMED';
    const unconfirmed=visuallyReviewed?old.unconfirmed_items:[];
    if(!sourceCurrentAtCapture)unconfirmed.push('screenshot predates a current candidate/runtime dependency; recapture needed');
    if(!visuallyReviewed)unconfirmed.push('restored capture metadata from the screenshot artifact after an audit-writer race; direct image review is still required');
    const record={
     theme,session_state:'administrator',target_site:runContract.target_site.slug,locale:runContract.target_site.locale,
     baseline_theme:'Sigma-9',baseline_theme_css_href:'/wikidot/styles/sigma-fe5388a32e12.css',browser_engine:engine,browser_version:versions[engine],
     viewport,viewport_size:viewports[viewport],surface:spec.surface,state:spec.state,fixture:spec.fixture_slug??'run-owned:theme-lab-visual-acceptance-imported-20260924',
     candidate_source_sha256:sourceCurrentAtCapture?sourceSha:null,base_css_path:baseCss.length?'candidate-base.css':null,base_css_sha256:baseCssSha,asset_dependency_sha256:assetSha,
     fixture_contract_sha256:contracts.fixture_contract_sha256,run_contract_sha256:runContractSha,environment_contract_sha256:envSha,
     capture_state_action_contract_sha256:contracts.states.find(state=>state.surface===spec.surface&&state.state===spec.state)?.action_contract_sha256??null,
     runtime_surface_contract_sha256:runtimeSha,screenshot:relative,screenshot_sha256:screenshotSha,candidate_sha256:sourceCurrentAtCapture?candidateSha:null,
     classification,visual_findings:oldValid?old.visual_findings:[],intentional_differences:oldValid?old.intentional_differences:[],unconfirmed_items:unconfirmed,
     reviewed_after_last_change:visuallyReviewed,external_requests_sent:0,external_requests_blocked:oldValid?old.external_requests_blocked??null:null,
     asset_failures:assetDependencies.filter(asset=>asset.status==='missing').map(asset=>({name:asset.name,status:'missing'})),page_errors:oldValid?old.page_errors:[],
     action_sequence:actionSequence,asset_dependency_count:assetDependencies.length,
     capture_record_reconstructed:!oldValid,source_current_at_capture:sourceCurrentAtCapture,
     visual_diagnostics:oldValid?old.visual_diagnostics:{viewport:{width:viewports[viewport].width,height:viewports[viewport].height},elements:null,history:null}
    };
    records.push(record);
   }
  }
 }
}
const dedup=new Map(records.map(record=>[key(record),record]));
const merged=[...dedup.values()].sort((a,b)=>a.theme.localeCompare(b.theme)||a.browser_engine.localeCompare(b.browser_engine)||a.viewport.localeCompare(b.viewport)||a.surface.localeCompare(b.surface)||a.state.localeCompare(b.state));
let output;
await withAuditLock(auditPath,async()=>{
 const latest=JSON.parse(await fs.readFile(auditPath,'utf8'));
 if((latest.updated_at??null)!==previousUpdatedAt)throw new Error('interactive visual audit changed while reconciliation was running; rerun reconciliation against the current audit instead of overwriting newer capture/review evidence');
 output={...latest,schema:'scp_jp_interactive_visual_audit.v1',updated_at:new Date().toISOString(),fixture_url:`${runContract.target_site.origin}/run-owned%3Atheme-lab-visual-acceptance-imported-20260924`,network_policy:{external_requests_sent:0,external_requests_blocked_during_auth:null,external_requests_blocked_during_states:null,policy:'all historic browser sessions used pre-send request blocking; per-row counter unavailable for reconstructed rows'},engine_scope:{chromium:'full interaction state inventory',firefox:'core states only',webkit:'core states only; Safari compatibility proxy, not Safari'},reconciliation:{reason:'Screenshot-derived reconstruction after an accidental concurrent non-atomic audit write; no row is promoted to visual PASS by this process',reconstructed_rows:merged.filter(record=>record.capture_record_reconstructed).length,source_stale_rows:merged.filter(record=>!record.source_current_at_capture).length,missing_expected_states:missing},records:merged};
 const temp=`${auditPath}.${process.pid}.tmp`;await fs.writeFile(temp,JSON.stringify(output)+'\n');await fs.rename(temp,auditPath);
});
console.log(JSON.stringify({themes:themeSlugs.length,records:merged.length,reconstructed:output.reconciliation.reconstructed_rows,stale:output.reconciliation.source_stale_rows,missing:missing.length,classification_counts:merged.reduce((count,record)=>(count[record.classification]=(count[record.classification]??0)+1,count),{})},null,2));

function sha(value){return crypto.createHash('sha256').update(value).digest('hex')}
function key(record){return`${record.theme}|${record.browser_engine}|${record.viewport}|${record.surface}|${record.state}`}
