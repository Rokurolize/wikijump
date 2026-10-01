#!/usr/bin/env node
import {measureTitleTextIntersections} from '../../src/title-text-intersections.mjs';
import {exerciseHeaderSearch} from '../../src/search-control-action.mjs';
import {runtimeSurfaceContractSha} from '../../src/browser-runtime-contract.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {candidateIdentity} from '../scripts/candidate-identity.mjs';
import {measureTitleComposition} from '../../src/title-composition.mjs';
import {scopedRunContractSha,captureRunContractIsCurrent} from '../../src/scoped-run-contract.mjs';
import {storeContentAddressedScreenshot} from '../scripts/content-addressed-screenshot.mjs';
import {compactAuditRecord,compactSupersededRecord} from '../scripts/capture-audit-records.mjs';
import {withAuditLock} from '../scripts/audit-lock.mjs';
import {applyExactVisualReviewReuseToRows,verifyExactReviewSources} from '../scripts/visual-review-reuse.mjs';
import {topFixedNavigationInset} from './top-fixed-navigation-inset.mjs';
import {loadCandidateStructure} from '../../src/candidate-structure.mjs';
import {interactiveAcceptanceFixture} from '../../src/interactive-acceptance-fixture.mjs';
import {openSidebar,closeSidebar,sidebarIsClosed,sidebarOccupiesViewport} from '../../src/sidebar-interaction.mjs';
import {activateNavigationControl,expandMobileTopSubmenu,expandTabletTopNavigation,hasRenderedSubmenuGeometry} from '../../src/navigation-interaction.mjs';
import {dedupeCssLayers} from '../../src/css-layers.mjs';
import {resolveRunContractPath as resolveBoundRunContractPath} from '../../src/run-contract-path.mjs';

const packageDir=path.dirname(fileURLToPath(import.meta.url));
const portsDir=path.resolve(packageDir,'..');
const themeLabDir=path.resolve(portsDir,'..');
const browserRequire=createRequire(path.resolve(packageDir,'../../../../../framerail/package.json'));
const {chromium,firefox,webkit}=browserRequire('@playwright/test');
const themeArg=process.argv.find(x=>x.startsWith('--theme='))?.slice(8);
const themesArg=process.argv.find(x=>x.startsWith('--themes='))?.slice(9);
const engineArg=process.argv.find(x=>x.startsWith('--engine='))?.slice(9)??'chromium';
const viewportArg=process.argv.find(x=>x.startsWith('--viewport='))?.slice(11)??'desktop';
const stateArg=process.argv.find(x=>x.startsWith('--state='))?.slice(8);
const transportOriginArg=process.argv.find(x=>x.startsWith('--transport-origin='))?.slice(19);
const runContractArg=process.argv.find(x=>x.startsWith('--run-contract='))?.slice(15);
const stateArgs=stateArg!==undefined?new Set(stateArg.split(',')):null;
const forceCapture=process.argv.includes('--force');
const anonymousArg=process.argv.includes('--anonymous');
const defaultConcurrency={chromium:6,firefox:4,webkit:6}[engineArg]??4;
const concurrencyArg=Number(process.argv.find(x=>x.startsWith('--concurrency='))?.slice(14)??defaultConcurrency);
const acceptedArgs=new Set(['--force','--anonymous','--help','--dump-contracts']);
for(const arg of process.argv.slice(2)){if(acceptedArgs.has(arg)||/^--(?:theme|themes|engine|viewport|state|concurrency|transport-origin|run-contract)=/u.test(arg))continue;throw new Error(`unknown argument: ${arg}; use --help for usage`)}
if(process.argv.includes('--help')){console.log('Usage: capture-interactive.mjs [--engine=chromium|firefox|webkit] [--viewport=desktop|laptop|tablet|mobile|narrow-mobile] [--theme=slug|--themes=slug,slug] [--state=surface.state,...] [--concurrency=1..8] [--transport-origin=https://host:port] [--run-contract=/path/to/contract.json] [--anonymous] [--force]');process.exit(0)}
if(!Number.isInteger(concurrencyArg)||concurrencyArg<1||concurrencyArg>8)throw new Error('--concurrency must be an integer from 1 to 8');
if(engineArg!=='chromium'&&!['desktop','mobile'].includes(viewportArg)){
 console.log(JSON.stringify({engine:engineArg,viewport:viewportArg,records:0,captured:0,skipped:true,reason:'Firefox/WebKit core acceptance is scoped to canonical desktop and mobile; the 320px policy-boundary matrix is Chromium-only.'}));
 process.exit(0);
}
// The task-owned acceptance origin is the seeded local development site, whose
// administrator defaults are also used by the existing verification import
// helpers. Keep operator-provided private inputs authoritative when present.
const verificationAdminEmail=process.env.WIKIDOT_VERIFY_ADMIN_EMAIL;
const verificationAdminPassword=process.env.WIKIDOT_VERIFY_ADMIN_PASS;
if(!anonymousArg&&(!verificationAdminEmail||!verificationAdminPassword))throw new Error('Authenticated visual capture requires WIKIDOT_VERIFY_ADMIN_EMAIL and WIKIDOT_VERIFY_ADMIN_PASS from a local-only environment file');
const defaultInteractionViewports=['desktop','mobile'];
const runContractPath=runContractArg?path.resolve(runContractArg):path.join(packageDir,'acceptance-run-contract.json');
const runContractBytes=await fs.readFile(runContractPath);
const runContract=JSON.parse(runContractBytes);
const runContractSha=crypto.createHash('sha256').update(runContractBytes).digest('hex');
const runContractDir=path.dirname(runContractPath);
const artifactNamespace=runContract.artifact_namespace??'';
const migrationFixture=runContract.migration_fixture??null;
if(migrationFixture&&['main_slug','top_slug','side_slug'].some(key=>!/^run-owned:sigma10-[a-z0-9-]+$/u.test(migrationFixture[key]??'')))throw new Error('invalid migration fixture slug');
if(runContractArg&&(!artifactNamespace||artifactNamespace.split('/').some(segment=>!/^[a-z0-9-]+$/u.test(segment))))throw new Error('custom run contract needs a valid isolated artifact namespace');
const resolveRunContractPath=(relative,label)=>{
 return resolveBoundRunContractPath(themeLabDir,runContractDir,relative,label);
};
const savedComponentCss=runContract.saved_component_css ? await fs.readFile(resolveRunContractPath(runContract.saved_component_css.path,'saved component CSS'),'utf8') : '';
if(savedComponentCss && crypto.createHash('sha256').update(savedComponentCss).digest('hex')!==runContract.saved_component_css.sha256)throw new Error('saved component CSS identity differs from run contract');
const headerFixture=runContract.header_fixture ? await fs.readFile(resolveRunContractPath(runContract.header_fixture.path,'header fixture'),'utf8') : null;
if(headerFixture && crypto.createHash('sha256').update(headerFixture).digest('hex')!==runContract.header_fixture.sha256)throw new Error('header fixture identity differs from run contract');
const sidebarFixture=runContract.sidebar_fixture ? await fs.readFile(resolveRunContractPath(runContract.sidebar_fixture.path,'sidebar fixture'),'utf8') : null;
if(sidebarFixture && crypto.createHash('sha256').update(sidebarFixture).digest('hex')!==runContract.sidebar_fixture.sha256)throw new Error('sidebar fixture identity differs from run contract');
const interwikiFixture=runContract.interwiki_fixture ? await fs.readFile(resolveRunContractPath(runContract.interwiki_fixture.path,'Interwiki fixture'),'utf8') : null;
if(interwikiFixture && crypto.createHash('sha256').update(interwikiFixture).digest('hex')!==runContract.interwiki_fixture.sha256)throw new Error('Interwiki fixture identity differs from run contract');
const navigationFixture=runContract.navigation_fixture ? await fs.readFile(resolveRunContractPath(runContract.navigation_fixture.path,'navigation fixture'),'utf8') : null;
if(navigationFixture && crypto.createHash('sha256').update(navigationFixture).digest('hex')!==runContract.navigation_fixture.sha256)throw new Error('navigation fixture identity differs from run contract');
const baselineReplacementPath=runContract.baseline_theme?.replacement_css_path
 ? resolveRunContractPath(runContract.baseline_theme.replacement_css_path,'baseline replacement CSS')
 : null;
const baselineReplacementCss=baselineReplacementPath?await fs.readFile(baselineReplacementPath,'utf8'):'';
const baselineReplacementSha=baselineReplacementCss
 ? crypto.createHash('sha256').update(baselineReplacementCss).digest('hex')
 : null;
if(runContract.baseline_theme?.replacement_css_sha256&&runContract.baseline_theme.replacement_css_sha256!==baselineReplacementSha)throw new Error('baseline replacement CSS hash differs from the run contract');
if(runContractArg&&baselineReplacementPath&&!/^[0-9a-f]{64}$/u.test(runContract.baseline_theme?.replacement_css_sha256??''))throw new Error('custom baseline replacement CSS needs a SHA-256 binding');
const runtimeBaselineStylesheetHref=runContract.baseline_theme?.runtime_stylesheet_href??runContract.baseline_theme?.stylesheet_href;
if(typeof runtimeBaselineStylesheetHref!=='string'||!runtimeBaselineStylesheetHref)throw new Error('run contract baseline theme needs a runtime stylesheet href');
const viewports=runContract.viewports;
if(!viewports[viewportArg])throw new Error(`unknown viewport ${viewportArg}`);
const logicalOrigin='https://scpaiueouiuiuiui.wikijump.localhost:18443';
if(runContract.target_site.origin!==logicalOrigin)throw new Error('acceptance run contract origin does not match the fixture target');
const origin=transportOriginArg?new URL(transportOriginArg).origin:logicalOrigin;
const transportUrl=new URL(origin);
if(transportUrl.protocol!=='https:'||transportUrl.hostname!=='scpaiueouiuiuiui.wikijump.localhost')throw new Error('transport origin must be HTTPS on the authorized local authoring hostname');
const base=`${origin}/run-owned%3Atheme-lab-visual-acceptance-imported-20260924`;
const historyBase=`${origin}/run-owned%3Atheme-lab-visual-history-20260924`;
const registry={chromium,firefox,webkit};
if(!registry[engineArg])throw new Error(`unknown engine ${engineArg}`);
if(!runContract.browser_engines.includes(engineArg))throw new Error(`engine ${engineArg} is not in the acceptance run contract`);
const campaign=JSON.parse(await fs.readFile(path.join(portsDir,'en-theme-campaign.json'),'utf8'));
const currentCampaign=runContract.schema==='scp_jp_sigma10_migration_run.v1';
if(currentCampaign){
 const ledger=JSON.parse(await fs.readFile(path.join(portsDir,'adaptation-authority.json'),'utf8'));
 const expected=[...Object.keys(ledger.packages).sort(),'sigma10-baseline'].sort();
 const inventory=runContract.current_candidate_inventory??[];
 if(inventory.length!==expected.length||inventory.map(row=>row.package).sort().join('\0')!==expected.join('\0'))throw new Error('Sigma-10 current contract must enumerate every maintained package and the baseline');
 if(JSON.stringify(Object.keys(runContract.additional_candidates??{}).sort())!==JSON.stringify(expected))throw new Error('Sigma-10 capture candidates differ from the explicit current inventory');
 if(runContract.frozen_sigma10_authority?.schema!=='theme_lab_frozen_sigma10_authority.v1'||!runContract.frozen_sigma10_authority.source_manifest_sha256)throw new Error('Sigma-10 capture needs frozen source authority bindings');
 for(const binding of Object.values(runContract.frozen_sigma10_authority.artifacts??{})){
  const bytes=await fs.readFile(resolveRunContractPath(binding.path,'frozen Sigma-10 authority'));
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==binding.sha256)throw new Error(`frozen Sigma-10 authority changed: ${binding.path}`);
 }
 const sourceManifestBytes=await fs.readFile(resolveRunContractPath(runContract.frozen_sigma10_authority.source_manifest,'Sigma-10 source manifest'));
 if(crypto.createHash('sha256').update(sourceManifestBytes).digest('hex')!==runContract.frozen_sigma10_authority.source_manifest_sha256)throw new Error('Sigma-10 source manifest differs from frozen authority');
 const sourceManifest=JSON.parse(sourceManifestBytes);
 for(const [identity,page] of Object.entries(sourceManifest.pages??{})){
  const bytes=await fs.readFile(resolveRunContractPath(`../${page.file}`,'frozen Sigma-10 source page'));
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==page.sha256)throw new Error(`frozen Sigma-10 source changed: ${identity}`);
 }
 const saved=JSON.parse(await fs.readFile(resolveRunContractPath('saved-credit-component.json','saved Credit cascade')));
 if(JSON.stringify(saved.cascade)!==JSON.stringify(runContract.saved_component_css?.cascade))throw new Error('saved Credit cascade differs from the current run contract');
}
const extraCandidates=new Map(Object.entries(runContract.additional_candidates??{}).map(([name,value])=>{
 if(!/^[a-z0-9-]+$/u.test(name))throw new Error(`invalid additional candidate name: ${name}`);
 const relative=typeof value==='string'?value:value?.directory;
 if(typeof relative!=='string'||!relative)throw new Error(`additional candidate ${name} needs a directory`);
 const directory=resolveRunContractPath(relative,`additional candidate directory for ${name}`);
 return [name,directory];
}));
const allThemes=['dear-dictator',...campaign.themes.map(x=>x.slug.replace(/^theme:/u,'')),...extraCandidates.keys()];
if(!currentCampaign&&[...extraCandidates.keys()].some(name=>name==='dear-dictator'||campaign.themes.some(x=>x.slug===`theme:${name}`)))throw new Error('additional candidate collides with an accepted campaign theme');
const themes=themeArg?[themeArg]:themesArg?themesArg.split(',').filter(Boolean):allThemes;
if(themes.some(theme=>!allThemes.includes(theme)))throw new Error('requested theme is not registered in the campaign or run contract');
const themeDirectory=theme=>extraCandidates.get(theme)??path.join(portsDir,theme);
const fixtureHashCache=new Map();
async function fixtureContractSha(spec){
 const variant=spec.fixtureSlug?.endsWith('credit-no-rate-20260924')?'fixture-no-rate.wikidot.txt':spec.fixtureSlug?.endsWith('credit-heritage-20260924')?'fixture-heritage.wikidot.txt':null;
 const pageSource=variant??(spec.surface==='page.history'?'history-fixture.wikidot.txt':'fixture.wikidot.txt');
 // Key only the page and include documents that are rendered by this state.
 // The former package-wide hash let a credit fixture edit invalidate every
 // theme/state and cause blanket replays. Candidate, action, runtime, asset,
 // actor, engine and viewport contracts remain separately bound below.
 const names=[pageSource,'nav-top.wikidot.txt','nav-side.wikidot.txt','nav-interwiki.wikidot.txt'];
 if(spec.surface==='page.backlinks')names.push('backlink-fixture.wikidot.txt');
 const hash=crypto.createHash('sha256').update('theme-lab-fixture-state.v2\0');
 for(const name of [...new Set(names)].sort()){
  let digest=fixtureHashCache.get(name);
  if(!digest){digest=crypto.createHash('sha256').update(await fs.readFile(path.join(packageDir,name))).digest('hex');fixtureHashCache.set(name,digest)}
  hash.update(name);hash.update('\0');hash.update(digest);
 }
 if(migrationFixture){
  const manifestBytes=await fs.readFile(resolveRunContractPath(runContract.fixture_contract.identity_manifest,'migration fixture manifest'));
  hash.update(crypto.createHash('sha256').update(manifestBytes).digest('hex'));
  const manifest=JSON.parse(manifestBytes);
  for(const slug of [migrationFixture.main_slug,migrationFixture.top_slug,migrationFixture.side_slug]){
   const fixture=manifest.fixtures?.find(item=>item.slug===slug);
   if(!fixture)throw new Error(`migration fixture is absent from manifest: ${slug}`);
   const bytes=await fs.readFile(resolveRunContractPath(fixture.file,`migration fixture ${slug}`));
   const actual=crypto.createHash('sha256').update(bytes).digest('hex');
   if(actual!==fixture.sha256)throw new Error(`migration fixture drift: ${slug}`);
   hash.update(slug);hash.update('\0');hash.update(actual);
  }
 }
 return hash.digest('hex');
}
async function expandMoreOptions(page){
 const more=page.locator('#more-options-button');
 if(!(await more.textContent())?.trim().startsWith('-'))await more.click();
 await page.waitForFunction(()=>document.querySelector('#more-options-button')?.textContent?.trim().startsWith('-'));
 await page.locator('#page-options-bottom-2').waitFor({state:'visible'});
}
async function revealPagePane(page){
 const fixedTop=await page.evaluate(topFixedNavigationInset);
 const firstToolbar=page.locator('#page-options-bottom');
 const target=await firstToolbar.count()?firstToolbar:page.locator('#action-area');
 const targetTop=await target.evaluate(element=>element.getBoundingClientRect().top+window.scrollY);
 // Keep the first page-options row visible together with the inline pane. The
 // shared mobile shell now lets its menu control scroll with the header, so
 // only retain an inset when a theme has an independently fixed control.
 const desiredTop=fixedTop>0?fixedTop+12:12;
 await page.evaluate(({top,desired})=>window.scrollTo({top:top-desired,behavior:'instant'}),{top:targetTop,desired:desiredTop});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function revealBelowFixedMobileNavigation(page,selectorOrLocator){
 const fixedTop=await page.evaluate(topFixedNavigationInset);
 const target=typeof selectorOrLocator==='string'?page.locator(selectorOrLocator):selectorOrLocator;
 const targetTop=await target.evaluate(element=>element.getBoundingClientRect().top+window.scrollY);
 const viewportHeight=page.viewportSize()?.height??0;
 const documentHeight=await page.evaluate(()=>document.documentElement.scrollHeight);
 const wanted=targetTop-fixedTop-12;
 const maxScroll=Math.max(0,documentHeight-viewportHeight-fixedTop-12);
 await page.evaluate(top=>window.scrollTo({top,behavior:'instant'}),Math.max(0,Math.min(wanted,maxScroll)));
 if(fixedTop>0){const top=await target.evaluate(element=>element.getBoundingClientRect().top);const correction=Math.max(0,fixedTop+12-top);if(correction)await page.evaluate(offset=>window.scrollBy({top:-offset,behavior:'instant'}),correction)}
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function settleFiniteVisualTransitions(page){return page.evaluate(async()=>{const running=document.getAnimations({subtree:true}).filter(animation=>animation.playState==='running'&&Number.isFinite(animation.effect?.getTiming().iterations));for(const animation of running){try{animation.finish()}catch{}}await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return running.length})}
async function parkPointer(page,_viewport){await page.mouse.move(-16,-16)}
function shouldParkPointer(spec){return !/(?:hover|pointerover|expanded)/iu.test(spec.state)&&spec.surface!=='nav.mobile-top'&&spec.surface!=='shell.footer-license'}
async function waitForSvelteClickHandler(page,selector){
 await page.waitForFunction(selector=>{
  const element=document.querySelector(selector);if(!element)return false;
  const eventsSymbol=Object.getOwnPropertySymbols(element).find(symbol=>symbol.description==='events');
  const handlers=eventsSymbol?element[eventsSymbol]:null;return typeof handlers?.click==='function';
 },selector,{timeout:10000});
}
async function gotoFixture(page,url){
 let lastError;
 for(let attempt=0;attempt<3;attempt++){
  try{return await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000})}
  catch(error){
   lastError=error;
   const transient=/interrupted by another navigation|NS_BINDING_ABORTED|net::ERR_ABORTED/iu.test(error.message);
   if(!transient||attempt===2)throw error;
   await page.waitForTimeout(50*(attempt+1)).catch(()=>{});
  }
 }
 throw lastError;
}
// The migration shell (#top-bar/#side-bar) is rendered by the Svelte layout from
// view data, so a single post-load innerHTML mutation races hydration and can be
// silently clobbered back to the site's own navigation. Fetch the source-derived
// fixtures and keep re-applying the substitution until it survives a quiet
// window; a substitution that never stabilizes is a hard failure rather than a
// capture that quietly measures the wrong shell.
async function injectMigrationShell(page,fixture){
 // Svelte finishes hydrating the shell roughly a second after DOMContentLoaded.
 // Waiting for a delegated Svelte handler proves hydration is complete; when a
 // surface has no such control, a settled document is the fallback barrier.
 const hydrated=await page.waitForFunction(()=>{
  for(const selector of ['#history-button','#page-options-bottom','#search-top-box-form input[type="submit"]','#side-bar .collapsible-block-link']){
   const element=document.querySelector(selector);if(!element)continue;
   const symbol=Object.getOwnPropertySymbols(element).find(candidate=>candidate.description==='events');
   if(symbol&&typeof element[symbol]?.click==='function')return true;
  }
  return false;
 },null,{timeout:12000}).then(()=>true).catch(()=>false);
 if(!hydrated)await page.waitForFunction(()=>document.readyState==='complete',null,{timeout:12000}).catch(()=>{});
 await page.evaluate(async fixture=>{
  // The local development runtime can restart mid-run; retry transient non-OK
  // responses rather than recording an environment flap as a migration finding.
  const fetchFixture=async slug=>{
   let lastStatus=0;
   for(let attempt=0;attempt<5;attempt++){
    const response=await fetch(`/${encodeURIComponent(slug)}`,{cache:'no-store'});
    if(response.ok)return response;
    lastStatus=response.status;
    await new Promise(resolve=>setTimeout(resolve,600*(attempt+1)));
   }
   throw new Error(`migration navigation fixture ${slug} returned ${lastStatus}`);
  };
  const payloads=[];
  for(const [slug,selector] of [[fixture.top_slug,'#top-bar'],[fixture.side_slug,'#side-bar']]){
   const response=await fetchFixture(slug);
   const html=new DOMParser().parseFromString(await response.text(),'text/html');
   const source=html.querySelector('#page-content');
   if(!source)throw new Error(`migration navigation fixture lacks ${selector}`);
   payloads.push([selector,source.innerHTML]);
  }
  const apply=()=>{for(const [selector,html] of payloads){const target=document.querySelector(selector);if(!target)throw new Error(`migration shell target absent: ${selector}`);if(target.innerHTML!==html)target.innerHTML=html}};
  apply();
  await new Promise((resolve,reject)=>{
   let lastMutation=performance.now();
   const observer=new MutationObserver(()=>{lastMutation=performance.now();apply()});
   for(const [selector] of payloads)observer.observe(document.querySelector(selector),{childList:true,subtree:true,characterData:true});
   const deadline=performance.now()+2000;
   const tick=()=>{
    if(performance.now()-lastMutation>=400){observer.disconnect();resolve();return}
    if(performance.now()>deadline){observer.disconnect();reject(new Error('migration shell injection did not stabilize'));return}
    requestAnimationFrame(tick);
   };
   requestAnimationFrame(tick);
  });
 },fixture);
}
const hydrationIndependentStates=new Set([
 'page.normal|settled',
 'shell.search|typed-focused','shell.search|compact-submit',
 'nav.desktop-top|submenu-hover','nav.desktop-top|keyboard-focus',
 'nav.mobile-top|submenu-expanded','nav.sidebar|open','nav.sidebar|closed-after-open',
 'page.options|default',
 'shell.footer-license|scrolled-bottom','shell.interwiki|visible','shell.login|account-hover',
 'content.link|hovered','content.link|focused','content.rating|focused',
 'credit.default|normal','credit.view|open','credit.view|scrolled-bottom',
 'credit.otherwise|open','credit.otherwise|scrolled-bottom','credit.otherwise|back-control-click','credit.otherwise|back-to-view',
 'credit.close-back|restored'
]);
const requiresSvelteHydration=spec=>!spec.surface.startsWith('credit.variant.')&&!hydrationIndependentStates.has(`${spec.surface}|${spec.state}`);
async function setMigrationCreditTarget(page,target){
 await page.evaluate(hash=>{location.hash=hash},`#${target}`);
 await page.waitForFunction(id=>document.querySelector(id)?.matches(':target'),`#${target}`);
}
async function openCreditView(page){
 if(migrationFixture){await setMigrationCreditTarget(page,'u-credit-view');return}
 await page.locator('.creditButton a').first().click();
 await page.waitForFunction(()=>location.hash==='#u-credit-view');
}
async function openCreditOtherwise(page){
 if(migrationFixture){await setMigrationCreditTarget(page,'u-credit-otherwise');return}
 await page.locator('.creditButton a').first().click();
 await page.getByText('その他のライセンス',{exact:true}).first().click();
 await page.waitForFunction(()=>location.hash==='#u-credit-otherwise');
}
async function visualDiagnostics(page,surface){
 const selectors=surface==='dialog.generic'?['#odialog-shader','#odialog-container','#odialog-container .owindow.error','#odialog-container .owindow.error .content','#odialog-container .owindow.error #modal-title','.button-bar','.button-close-message','.page-rate-widget-box','#u-credit-view']:surface.startsWith('credit.')?['#content-wrap','#main-content','#page-content','#action-area','#side-bar','.mobile-top-bar','#u-credit-view .modalcontainer','#u-credit-view .modalbox','#u-credit-view .page-rate-widget-box','#u-credit-view .page-rate-widget-box .rate-points','#u-credit-view .page-rate-widget-box .rateup','#u-credit-view .page-rate-widget-box .ratedown','#u-credit-view .page-rate-widget-box .cancel','#u-credit-otherwise .modalcontainer','#u-credit-otherwise .modalbox','#u-credit-otherwise .modalbox .credit.otherwise','#u-credit-otherwise .modalbox .credit-back','#u-credit-otherwise .modalbox .credit-back a[href="#u-credit-view"]','.page-rate-widget-box','.creditRate','.rate-box-with-credit-button','.creditButton','.creditButton a']:surface.startsWith('page.history')?['.revision-list','.page-history','.page-history tbody tr.revision-header','.page-history tbody tr.revision-row','.page-history .revision-diff','.revision-diff','.revision-diff .revision-diff-line','.page-source']:surface.startsWith('page.source')?['#action-area','#page-options-bottom','#page-options-bottom-2','.page-source','.action-area-close','.mobile-top-bar .open-menu a']:surface.startsWith('page.files')?['.file-list-scroll','.file-list','.file-row']:surface.startsWith('nav.')?['#top-bar','#top-bar .top-bar','#top-bar .top-bar a','.mobile-top-bar','.mobile-top-bar a','#side-bar','#side-bar .close-menu','#side-bar .side-block','#side-bar .collapsible-block-link','#side-bar .collapsible-block-unfolded']:surface.startsWith('shell.')?['#login-status','#footer','#license-area','.scpnet-interwiki-frame']:surface.startsWith('page.edit')?['#action-area','textarea.editor-wikitext','textarea[name="wikitext"]','#edit-page-comments']:surface==='page.normal'?['#content-wrap','#main-content','#page-title','#page-content','#action-area','#side-bar','#header','#header h1','#header h2','#extra-div-1','#extra-div-2','#search-top-box','#search-top-box-form','#search-top-box-input','#login-status','.mobile-top-bar','.yui-navset','.yui-navset .yui-nav a','.yui-navset .yui-nav a em','.yui-navset .yui-content']:['#action-area','#page-title','#page-content','.page-rate-widget-box'];
 if(surface==='shell.interwiki')selectors.push('.scpnet-interwiki-wrapper','iframe.html-block-iframe');
 const result=await page.evaluate(selectors=>{
  const rectOf=e=>{const r=e.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}};
  const describe=selector=>{const e=document.querySelector(selector);if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);const pseudo=which=>{const p=getComputedStyle(e,which);return{content:p.content,display:p.display,position:p.position,color:p.color,background_color:p.backgroundColor,font_size:p.fontSize,line_height:p.lineHeight,text_shadow:p.textShadow,transform:p.transform,top:p.top,left:p.left,width:p.width,height:p.height}};return{text:(e.innerText??'').trim().replace(/\s+/gu,' ').slice(0,180),value:typeof e.value==='string'?e.value.slice(0,240):null,children:[...e.children].slice(0,8).map(child=>({tag:child.tagName,id:child.id,class:typeof child.className==='string'?child.className:'',text:(child.innerText??'').trim().replace(/\s+/gu,' ').slice(0,90),rect:rectOf(child),font:getComputedStyle(child).fontFamily,position:getComputedStyle(child).position,transform:getComputedStyle(child).transform,before:getComputedStyle(child,'::before').content,after:getComputedStyle(child,'::after').content})),rect:rectOf(e),display:s.display,visibility:s.visibility,opacity:s.opacity,position:s.position,z_index:s.zIndex,pointer_events:s.pointerEvents,position:s.position,color:s.color,background_color:s.backgroundColor,background_image:s.backgroundImage,background_position:s.backgroundPosition,background_size:s.backgroundSize,font_family:s.fontFamily,font_size:s.fontSize,font_weight:s.fontWeight,line_height:s.lineHeight,letter_spacing:s.letterSpacing,text_shadow:s.textShadow,text_stroke:`${s.webkitTextStrokeWidth} ${s.webkitTextStrokeColor}`,text_fill:s.webkitTextFillColor,filter:s.filter,white_space:s.whiteSpace,overflow_wrap:s.overflowWrap,word_break:s.wordBreak,overflow_x:s.overflowX,grid_template_columns:s.gridTemplateColumns,grid_column:`${s.gridColumnStart} / ${s.gridColumnEnd}`,scroll_width:e.scrollWidth,client_width:e.clientWidth,scroll_height:e.scrollHeight,client_height:e.clientHeight,before:pseudo('::before'),after:pseudo('::after')}};
  const historyInstances=[...document.querySelectorAll('.page-history')].map(table=>({rect:rectOf(table),rows:[...table.querySelectorAll('tbody tr')].map(row=>{const style=getComputedStyle(row);return{class_name:row.className,text:(row.innerText??'').trim().replace(/\s+/gu,' ').slice(0,120),rect:rectOf(row),display:style.display,visibility:style.visibility,opacity:style.opacity,position:style.position,cells:[...row.children].map(cell=>{const cs=getComputedStyle(cell),before=getComputedStyle(cell,'::before');return{class_name:cell.className,text:(cell.innerText??'').trim().replace(/\s+/gu,' ').slice(0,80),rect:rectOf(cell),color:cs.color,background_color:cs.backgroundColor,font_size:cs.fontSize,line_height:cs.lineHeight,display:cs.display,grid_area:cs.gridArea,grid_columns:cs.gridTemplateColumns,before:{content:before.content,color:before.color,background_color:before.backgroundColor,display:before.display,font_size:before.fontSize}}})}})}));
  const headerChildren=[...document.querySelector('#header')?.children??[]].map(element=>{const style=getComputedStyle(element);return{tag:element.tagName,id:element.id,class_name:typeof element.className==='string'?element.className:'',text:(element.innerText??'').trim().replace(/\s+/gu,' ').slice(0,80),rect:rectOf(element),display:style.display,position:style.position,float:style.float,order:style.order,margin:style.margin}});
  const title=document.querySelector('#page-title')?.getBoundingClientRect();const titleOverlaps=title?[...document.querySelectorAll('body *')].filter(e=>e.id!=='page-title'&&e.children.length===0&&(e.innerText??e.textContent??'').trim()).map(e=>({e,r:e.getBoundingClientRect(),s:getComputedStyle(e)})).filter(({r})=>r.width>0&&r.height>0&&r.left<title.right&&r.right>title.left&&r.top<title.bottom&&r.bottom>title.top).slice(0,16).map(({e,r,s})=>({tag:e.tagName,id:e.id,class:typeof e.className==='string'?e.className:'',text:(e.innerText??e.textContent??'').trim().replace(/\s+/gu,' ').slice(0,80),rect:rectOf(e),position:s.position,z:s.zIndex,color:s.color,background:s.backgroundColor,ancestors:[e.parentElement,e.parentElement?.parentElement,e.parentElement?.parentElement?.parentElement].filter(Boolean).map(p=>({tag:p.tagName,id:p.id,class:typeof p.className==='string'?p.className:'',rect:rectOf(p),position:getComputedStyle(p).position,z:getComputedStyle(p).zIndex}))})):[];
  const headerText=[...document.querySelectorAll('#header *')].filter(e=>e.children.length===0&&(e.innerText??e.textContent??'').trim()).slice(0,20).map(e=>({tag:e.tagName,id:e.id,class:typeof e.className==='string'?e.className:'',text:(e.innerText??e.textContent??'').trim().replace(/\s+/gu,' ').slice(0,80),rect:rectOf(e),color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor,ancestors:[e.parentElement,e.parentElement?.parentElement].filter(Boolean).map(p=>({tag:p.tagName,id:p.id,class:typeof p.className==='string'?p.className:'',rect:rectOf(p)}))}));
  // Horizontal-overflow evidence must catch two distinct failure modes: an
  // element whose border box crosses the viewport (box overflow) and an
  // element whose content overflows its own box while the box itself stays
  // inside the viewport (content overflow, often caused by unbreakable text or
  // a min-width child). Only checking rect.right misses the second mode even
  // though it is what expands document.scrollWidth. Rank by the furthest
  // reachable edge so the culprit appears first.
  const documentClientWidth=document.documentElement.clientWidth;
  const horizontalOverflow=[...document.querySelectorAll('body *')].map(element=>{const rect=element.getBoundingClientRect();return{element,rect,selfOverflow:Math.max(0,element.scrollWidth-element.clientWidth),reachableRight:Math.max(rect.right,rect.left+element.scrollWidth)}}).filter(({element,rect,selfOverflow})=>{if(rect.width<=0&&rect.height<=0)return false;if(getComputedStyle(element).display==='none')return false;return rect.right>documentClientWidth+1||selfOverflow>1}).sort((a,b)=>b.reachableRight-a.reachableRight).slice(0,24).map(({element,rect,selfOverflow,reachableRight})=>{const style=getComputedStyle(element);return{tag:element.tagName,id:element.id,class:typeof element.className==='string'?element.className:'',rect:rectOf(element),right_overflow:Math.round(rect.right-documentClientWidth),self_overflow:selfOverflow,reachable_right:Math.round(reachableRight),position:style.position,display:style.display,visibility:style.visibility,white_space:style.whiteSpace,overflow_x:style.overflowX,min_width:style.minWidth,width:style.width,text:(element.innerText??'').trim().replace(/\s+/gu,' ').slice(0,80)}});
  return{viewport:{width:innerWidth,client_width:documentClientWidth,height:innerHeight,scroll_x:window.scrollX,scroll_y:window.scrollY,document_width:document.documentElement.scrollWidth,body_width:document.body.scrollWidth},elements:Object.fromEntries(selectors.map(selector=>[selector,describe(selector)])),historyInstances,titleOverlaps,headerText,headerChildren,horizontalOverflow}
 },selectors);return{...result,topFixedNavigationInset:await page.evaluate(topFixedNavigationInset)}
}
const states=[
  {surface:'page.normal',state:'settled',viewports:Object.keys(viewports),action:async()=>{}},
  {surface:'content.tabview',state:'second-tab-selected',viewports:['desktop','mobile','narrow-mobile'],action:async p=>{const tab=p.getByText('詳細',{exact:true}).first();await tab.scrollIntoViewIfNeeded();await tab.click();await p.getByText('別のタブへ移動できます。',{exact:true}).waitFor({state:'visible'});await revealBelowFixedMobileNavigation(p,'.yui-navset')}} ,
  {surface:'content.collapsible',state:'expanded',viewports:['desktop','mobile','narrow-mobile'],action:async p=>{const toggle=p.locator('#page-content .collapsible-block-link').first();await toggle.scrollIntoViewIfNeeded();const parent=toggle.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " collapsible-block ")][1]');const unfolded=parent.locator(':scope > .collapsible-block-unfolded');if(await unfolded.evaluate(e=>getComputedStyle(e).display==='none')){await toggle.focus();await toggle.press('Enter')}await unfolded.waitFor({state:'visible'});if(await p.evaluate(()=>innerWidth<=600))await revealBelowFixedMobileNavigation(p,unfolded)}},
  {surface:'shell.search',state:'typed-focused',viewports:['desktop','laptop','tablet'],action:async p=>{await waitForSvelteClickHandler(p,'#history-button');await exerciseHeaderSearch(p,p.__themeLabSearchSourceAuthority)}},
  {surface:'shell.search',state:'compact-submit',viewports:['mobile','narrow-mobile'],action:async p=>{await p.locator('#search-top-box-form input[type="submit"]').waitFor({state:'visible'})}},
  {surface:'nav.desktop-top',state:'submenu-hover',viewports:['desktop'],action:async p=>{const item=p.locator('#top-bar li').filter({has:p.locator('ul')}).first();await item.scrollIntoViewIfNeeded();await item.locator('a').first().hover()}},
  {surface:'nav.tablet-top',state:'active-navigation-expanded',viewports:['tablet'],action:expandTabletTopNavigation},
  {surface:'nav.mobile-top',state:'submenu-expanded',viewports:['mobile','narrow-mobile'],action:expandMobileTopSubmenu},
  {surface:'nav.sidebar',state:'open',viewports:['mobile','narrow-mobile'],action:async p=>{await openSidebar(p);await p.locator('#side-bar').scrollIntoViewIfNeeded()}},
  {surface:'nav.sidebar',state:'closed-after-open',viewports:['mobile','narrow-mobile'],action:async p=>{const openHash=await openSidebar(p);await closeSidebar(p,openHash)}},
  {surface:'nav.sidebar',state:'open-submenu',viewports:['mobile','narrow-mobile'],action:async p=>{await openSidebar(p);const toggle=p.locator('#side-bar .collapsible-block-link').first();if(!(await toggle.count())){/* The frozen Sigma-10 SCP-JP sidebar has no collapsible block; the state degrades to the open sidebar rather than inventing an interaction. */await p.locator('#side-bar .side-block').first().waitFor({state:'visible'});return}await toggle.click();await p.locator('#side-bar .collapsible-block-unfolded').waitFor()}},
  {surface:'credit.default',state:'normal',viewports:['desktop','mobile','narrow-mobile'],action:async()=>{}},
   {surface:'credit.view',state:'open',viewports:['desktop','mobile','narrow-mobile'],action:openCreditView},
   {surface:'credit.otherwise',state:'open',viewports:['desktop','mobile','narrow-mobile'],action:openCreditOtherwise},
   {surface:'credit.close-back',state:'restored',viewports:['desktop','mobile','narrow-mobile'],action:async p=>{if(migrationFixture)await setMigrationCreditTarget(p,'u-credit-view');else{await p.locator('.creditButton a').first().click();await p.waitForFunction(()=>location.hash==='#u-credit-view')}await p.goBack();await p.waitForFunction(()=>location.hash!=='#u-credit-view')}},
  {surface:'page.options',state:'default',viewports:['desktop','mobile','narrow-mobile'],action:async p=>{await p.locator('#page-options-bottom').scrollIntoViewIfNeeded();if(await p.evaluate(()=>innerWidth<=600))await revealBelowFixedMobileNavigation(p,'#page-options-bottom')}},
  {surface:'page.options',state:'more-expanded',viewports:['desktop','mobile','narrow-mobile'],action:async p=>{await expandMoreOptions(p);await p.locator('#page-options-bottom-2').scrollIntoViewIfNeeded();if(await p.evaluate(()=>innerWidth<=600))await revealBelowFixedMobileNavigation(p,'#page-options-bottom-2')}},
  {surface:'page.tags',state:'open',viewports:['desktop','mobile','narrow-mobile'],action:async p=>{await p.locator('#tags-button').click();await revealPagePane(p);await p.locator('#action-area input[type="text"]').first().waitFor({state:'visible'})}},
  {surface:'page.history',state:'list',viewports:['desktop','mobile','narrow-mobile'],action:async p=>{await p.locator('#history-button').click();await p.locator('.page-history tr[id^="revision-row-"]').first().waitFor();await revealPagePane(p)}},
  {surface:'page.history',state:'revision-row-hovered',viewports:['desktop','mobile','narrow-mobile'],action:async p=>{await p.locator('#history-button').click();const row=p.locator('.page-history tr[id^="revision-row-"]').first();await row.waitFor();await revealPagePane(p);await row.hover()}},
  {surface:'page.history',state:'diff',viewports:['desktop','mobile','narrow-mobile'],action:async p=>{await p.locator('#history-button').click();await p.locator('#revision-diff-from').waitFor();await p.locator('.revision-diff-controls button').last().click();await p.waitForFunction(()=>!!document.querySelector('.revision-diff')||!!document.querySelector('.revision-diff-panel p')||!!document.querySelector('#odialog-container .owindow'));await revealPagePane(p);const diff=p.locator('.revision-diff');if(await diff.count()){if(await p.evaluate(()=>innerWidth<=600))await revealBelowFixedMobileNavigation(p,'.revision-diff');else await diff.scrollIntoViewIfNeeded()}}},
  {surface:'page.source',state:'open',viewports:['desktop','mobile','narrow-mobile'],action:async p=>{await expandMoreOptions(p);await p.locator('#view-source-button').click();await p.locator('.page-source').waitFor();await revealPagePane(p)}},
  {surface:'page.files',state:'list',viewports:['desktop','mobile','narrow-mobile'],action:async p=>{await p.locator('#files-button').click();await p.locator('.file-list').waitFor();await p.locator('.file-row').filter({hasText:'theme-lab-visual-fixture_日本語長名'}).waitFor({state:'visible'});await revealPagePane(p)}},
  {surface:'page.files',state:'horizontal-actions',viewports:['mobile','narrow-mobile'],action:async p=>{await p.locator('#files-button').click();await p.locator('.file-row').filter({hasText:'theme-lab-visual-fixture_日本語長名'}).waitFor({state:'visible'});await revealPagePane(p);await p.locator('.file-list-scroll').evaluate(e=>e.scrollLeft=e.scrollWidth)}},
  {surface:'shell.footer-license',state:'scrolled-bottom',viewports:['desktop','mobile','narrow-mobile'],action:async p=>{const license=p.locator('#license-area');await license.waitFor({state:'visible'});await license.evaluate(e=>e.scrollIntoView({block:'end',behavior:'instant'}));await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await p.locator('#footer').waitFor({state:'visible'})}},
  {surface:'shell.interwiki',state:'visible',viewports:['desktop','mobile','narrow-mobile'],action:async p=>{const wrapper=p.locator('.scpnet-interwiki-wrapper').first();await wrapper.waitFor({state:'attached'});const frame=wrapper.locator('iframe.html-block-iframe').first();await frame.waitFor({state:'attached'});const contract=await p.evaluate(()=>{const wrapper=document.querySelector('.scpnet-interwiki-wrapper');const frame=wrapper?.querySelector('iframe.html-block-iframe');if(!wrapper||!frame)return null;const box=frame.getBoundingClientRect();return{wrapper_present:true,wrapper_display:getComputedStyle(wrapper).display,wrapper_rect:(()=>{const r=wrapper.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})(),frame_present:true,frame_display:getComputedStyle(frame).display,frame_rect:{x:box.x,y:box.y,width:box.width,height:box.height},document_width:document.documentElement.scrollWidth,viewport_width:innerWidth}});if(!contract)throw new Error('local Interwiki wrapper/frame contract is absent');await p.evaluate(value=>{window.__themeLabActionContractObservation=value;window.__themeLabActionTrace??=[];window.__themeLabActionTrace.push({type:'local-interwiki-contract'})},contract);await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}},
  {surface:'page.backlinks',state:'list',viewports:['desktop','mobile'],action:async p=>{await expandMoreOptions(p);await p.locator('#backlinks-button').click();await p.getByText('SCP-JP Theme Lab Backlink Fixture',{exact:true}).waitFor();await revealPagePane(p)}},
  {surface:'page.parent',state:'pane',viewports:['desktop','mobile'],action:async p=>{await expandMoreOptions(p);const parentsResponse=p.waitForResponse(response=>response.url().includes('?/parentGet')&&response.request().method()==='POST',{timeout:10000});await p.locator('#parent-page-button').click();await p.locator('#page-parent .page-parent-new-parents').waitFor({state:'visible'});const response=await parentsResponse;if(!response.ok())throw new Error(`parent lookup returned HTTP ${response.status()}`);await p.locator('#page-parent .page-parent-actions, #page-parent .buttons').first().waitFor({state:'visible'});await revealPagePane(p);await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}},
  {surface:'page.edit',state:'editor',viewports:['desktop','mobile'],action:async p=>{await expandMoreOptions(p);await revealPagePane(p);const edit=p.locator('#edit-button');await edit.scrollIntoViewIfNeeded();await edit.click();await p.locator('textarea').first().waitFor({state:'visible'});await revealPagePane(p)}},
  {surface:'page.rename',state:'confirm-pane',viewports:['desktop','mobile'],action:async p=>{await expandMoreOptions(p);await p.locator('#rename-move-button').click();const pane=p.locator('#page-move');await pane.waitFor({state:'visible'});await pane.locator('.buttons, .page-move-actions').first().waitFor({state:'visible'});await revealBelowFixedMobileNavigation(p,'.page-move-header')}},
  {surface:'page.delete',state:'confirm-pane',viewports:['desktop','mobile'],action:async p=>{await expandMoreOptions(p);await p.locator('#delete-button').click();const pane=p.locator('#page-delete');await pane.waitFor({state:'visible'});await pane.locator('.buttons, .page-delete-actions').first().waitFor({state:'visible'});await revealBelowFixedMobileNavigation(p,'.page-delete-header')}},
];
for(const variant of [
 {id:'no-rate',slug:'run-owned:theme-lab-visual-credit-no-rate-20260924'},
 {id:'heritage',slug:'run-owned:theme-lab-visual-credit-heritage-20260924'}
]){
 states.push(
  {surface:`credit.variant.${variant.id}`,state:'default',fixtureSlug:variant.slug,viewports:['desktop','mobile'],action:async()=>{}},
  {surface:`credit.variant.${variant.id}`,state:'view',fixtureSlug:variant.slug,viewports:['desktop','mobile'],action:async p=>{const entry=p.locator('.creditButton a:visible').first();await entry.click();await p.waitForFunction(()=>location.hash==='#u-credit-view')}}
 );
}
states.push(
 {surface:'shell.login',state:'account-hover',viewports:['desktop'],action:async p=>{const wrapper=p.locator('#login-status');const status=await wrapper.isVisible()?wrapper:p.locator('#account-topbutton');await status.waitFor({state:'visible'});const box=await status.boundingBox();await status.hover({position:{x:Math.min(8,Math.max(1,box?.width??8)),y:Math.min(5,Math.max(1,box?.height??5))}});const menu=wrapper.locator('#account-options');if(await menu.count())await menu.waitFor({state:'visible'})}},
 {surface:'nav.desktop-top',state:'keyboard-focus',viewports:['desktop'],action:async p=>{await p.locator('#top-bar a').first().focus()}},
 {surface:'content.link',state:'hovered',viewports:['desktop','mobile'],action:async p=>{const link=p.locator('a[href="#fixture-link"]');await link.scrollIntoViewIfNeeded();await link.hover();if(await p.evaluate(()=>innerWidth<=600))await revealBelowFixedMobileNavigation(p,'a[href="#fixture-link"]')}},
 {surface:'content.link',state:'focused',viewports:['desktop','mobile'],action:async p=>{const link=p.locator('a[href="#fixture-link"]');await link.scrollIntoViewIfNeeded();await link.focus();if(await p.evaluate(()=>innerWidth<=600))await revealBelowFixedMobileNavigation(p,'a[href="#fixture-link"]')}},
 {surface:'content.rating',state:'focused',viewports:['desktop','mobile'],action:async p=>{await p.locator('.page-rate-widget-box a').first().focus()}},
 {surface:'page.tags',state:'input-focused',viewports:['desktop','mobile'],action:async p=>{await p.locator('#tags-button').click();await revealPagePane(p);await p.locator('#action-area input[type="text"]').first().focus()}},
  {surface:'credit.view',state:'scrolled-bottom',viewports:['desktop','mobile'],action:async p=>{await openCreditView(p);await p.locator('#u-credit-view .modalbox:visible').last().evaluate(e=>e.scrollTop=e.scrollHeight)}},
  {surface:'credit.otherwise',state:'scrolled-bottom',viewports:['desktop','mobile','narrow-mobile'],action:async p=>{await openCreditOtherwise(p);const copy=p.locator('#u-credit-otherwise .modalbox .credit.otherwise');await copy.evaluate(e=>e.scrollTop=e.scrollHeight);await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}},
 {surface:'credit.otherwise',state:'back-control-click',viewports:['desktop','mobile','narrow-mobile'],action:async p=>{await p.locator('.creditButton a').first().click();await p.getByText('その他のライセンス',{exact:true}).first().click();await p.waitForFunction(()=>location.hash==='#u-credit-otherwise');const copy=p.locator('#u-credit-otherwise .modalbox .credit.otherwise');await copy.evaluate(e=>e.scrollTop=e.scrollHeight);const back=p.locator('#u-credit-otherwise .modalbox .credit-back a[href="#u-credit-view"]');if(await back.isVisible())await back.click();else await p.goBack();await p.waitForFunction(()=>location.hash==='#u-credit-view')}},
  {surface:'credit.otherwise',state:'back-to-view',viewports:['desktop','mobile'],action:async p=>{await openCreditOtherwise(p);await p.goBack();await p.waitForFunction(()=>location.hash==='#u-credit-view')}},
 {surface:'page.source',state:'closed',viewports:['desktop','mobile'],action:async p=>{await expandMoreOptions(p);await p.locator('#view-source-button').click();await p.locator('.page-source').waitFor();await revealPagePane(p);await p.locator('.action-area-close').click();await p.locator('.page-source').waitFor({state:'detached'})}},
 {surface:'page.history',state:'historical-source',action:async p=>{await p.locator('#history-button').click();await p.locator('.page-history tr[id^="revision-row-"] .optionstd a').filter({hasText:/^S$/u}).first().click();await p.locator('#history-subarea .page-source').waitFor();await revealPagePane(p)}}
);
states.push(
 {surface:'dialog.generic',state:'edit-permission-error',viewports:['desktop','mobile','narrow-mobile'],guest:true,action:async p=>{await expandMoreOptions(p);await p.locator('#edit-button').click();await p.locator('#odialog-container .owindow.error').waitFor({state:'visible'})}},
 {surface:'dialog.generic',state:'close-button',viewports:['desktop','mobile','narrow-mobile'],guest:true,action:async p=>{await expandMoreOptions(p);await p.locator('#edit-button').click();await p.locator('#odialog-container .owindow.error').waitFor({state:'visible'});await p.locator('.button-close-message').click();await p.locator('#odialog-container .owindow.error').waitFor({state:'detached'})}},
 {surface:'dialog.generic',state:'escape-close',viewports:['desktop','mobile','narrow-mobile'],guest:true,action:async p=>{await expandMoreOptions(p);await p.locator('#edit-button').click();await p.locator('#odialog-container .owindow.error').waitFor({state:'visible'});await p.keyboard.press('Escape');await p.locator('#odialog-container .owindow.error').waitFor({state:'detached'})}}
);
// Chromium owns the full interaction matrix. Cross-engine work is a stable
// core-state smoke contract; running every pane in every engine multiplies
// fixture navigation and timeout exposure without expanding the required
// compatibility evidence.
const crossEngineCoreStates=new Set(['page.normal|settled','credit.view|open','page.history|list','page.source|open','nav.sidebar|open','nav.sidebar|open-submenu','shell.interwiki|visible']);
const engineStates=engineArg==='chromium'?states:states.filter(spec=>crossEngineCoreStates.has(`${spec.surface}|${spec.state}`));
if(stateArgs){
 const knownStates=new Set(states.map(spec=>`${spec.surface}.${spec.state}`));
 for(const state of stateArgs){
  if(!state.trim())throw new Error('states must be non-empty');
  if(!knownStates.has(state))throw new Error(`unknown capture state: ${state}`);
 }
}
let webkitProxyBlocked=0;let webkitProxy=null;
if(engineArg==='webkit'){
 // Playwright's WebKit request routing cancels SvelteKit's Vite module loads
 // even when the route matcher excludes the local origin. A loopback-only
 // rejecting proxy keeps localhost direct and refuses every public CONNECT
 // before the browser can send an external request.
 webkitProxy=http.createServer((_request,response)=>{webkitProxyBlocked++;response.writeHead(403);response.end()});
 webkitProxy.on('connect',(_request,socket)=>{webkitProxyBlocked++;socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')});
 await new Promise((resolve,reject)=>{webkitProxy.once('error',reject);webkitProxy.listen(0,'127.0.0.1',resolve)});
}
const engine=registry[engineArg];let browser=null;
const records=[];
let authenticatedStorage=null;let authBootstrapMs=0;let authBootstrapBlocked=0;let authBrowser=null;
try{
browser=await engine.launch({headless:true,...(webkitProxy?{proxy:{server:`http://127.0.0.1:${webkitProxy.address().port}`,bypass:'*.localhost,localhost,127.0.0.1'}}:{})});
if(!anonymousArg){const authStartedAt=performance.now();if(engineArg==='webkit')authBrowser=await chromium.launch({headless:true});const authContext=await (authBrowser??browser).newContext({ignoreHTTPSErrors:true});await authContext.route('**/*',async route=>{if(new URL(route.request().url()).origin===origin){await route.continue();return}authBootstrapBlocked++;await route.abort('blockedbyclient')});const authPage=await authContext.newPage();await authPage.goto(`${origin}/-/login`,{waitUntil:'domcontentloaded'});await authPage.locator('.auth-name-or-email').fill(verificationAdminEmail);await authPage.locator('.auth-password').fill(verificationAdminPassword);await authPage.locator('#login button[type=submit]').click();await authPage.waitForFunction(()=>!document.querySelector('#login'),null,{timeout:15000});authenticatedStorage=await authContext.storageState();await authContext.close();if(authBrowser)await authBrowser.close();authBootstrapMs=Math.round(performance.now()-authStartedAt)}
const auditPath=process.env.THEME_LAB_INTERACTIVE_AUDIT_PATH
 ? path.resolve(process.env.THEME_LAB_INTERACTIVE_AUDIT_PATH)
 : runContract.audit_path
   ? resolveRunContractPath(runContract.audit_path,'interactive audit path')
   : path.join(portsDir,'interactive-visual-audit.json');
if(runContractArg&&(auditPath===path.join(portsDir,'interactive-visual-audit.json')||!auditPath.startsWith(runContractDir+path.sep)))throw new Error('custom run contract audit must stay below its contract directory and separate from accepted evidence');
await fs.mkdir(path.dirname(auditPath),{recursive:true});
const auditShardDir=process.env.THEME_LAB_AUDIT_SHARD_DIR
 ? path.resolve(process.env.THEME_LAB_AUDIT_SHARD_DIR)
 : null;
const repoRoot=path.resolve(packageDir,'../../../../../');
const localInterwikiStubHtml='<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;min-width:0;min-height:1px}</style></head><body><div class="side-block" data-theme-lab-empty-interwiki-replay></div><div id="resizer-container"></div></body></html>';
async function fulfillInterwikiReplay(route,url){
 if(url.origin!==origin||!/^\/-\/wikidot-interwiki\/(?:interwikiFrame|styleFrame)\.html$/u.test(url.pathname))return false;
 const body=url.pathname.endsWith('/interwikiFrame.html')?localInterwikiStubHtml:'<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body></body></html>';
 await route.fulfill({status:200,contentType:'text/html; charset=utf-8',headers:{'cache-control':'no-store'},body});
 return true;
}
const runtimeSurfaceContracts=Object.fromEntries([...new Set(engineStates.map(spec=>spec.surface))].map(surface=>[surface,runtimeSurfaceContractSha(repoRoot,surface,viewportArg)]));
const applicabilityContract=states.map(spec=>{const applicable=spec.viewports??defaultInteractionViewports;const reason=spec.surface==='page.normal'?'Baseline appearance is required at all five defined form factors.':applicable.includes('narrow-mobile')?'This state exercises a phone-only interaction and the SCP-JP 320px boundary; the wide shell has a separate desktop state.':applicable.includes('mobile')&&applicable.includes('desktop')?'Detailed interaction is checked at canonical desktop and representative mobile; laptop/tablet use the normal-page baseline and controls explicitly scoped to their breakpoint.':applicable.includes('tablet')?'This is a breakpoint-specific desktop navigation state; other pointer states are covered at the canonical desktop width.':'This state belongs to the listed shell form factor; alternate form factors have a distinct state or normal-page baseline.';return{surface:spec.surface,state:spec.state,applicable_viewports:applicable,not_applicable_reason:reason}}).concat([{surface:'page.history',state:'comments-column-scroll',applicable_viewports:[],not_applicable_reason:'The retained Wikidot History evidence is an AMC fragment and does not establish whether mobile History scrolls or reflows; this layout remains unclassified.'}]);
const maintainedBrowserContract=JSON.parse(await fs.readFile(path.join(themeLabDir,'fixtures/browser-acceptance-states.json'),'utf8'));
if(JSON.stringify(applicabilityContract)!==JSON.stringify(maintainedBrowserContract.states))throw new Error('Browser state applicability differs from maintained acceptance contract');
function actionContractDependencies(spec){
 const actionSource=spec.action.toString();
 return{
  waitForSvelteClickHandler:actionSource.includes('waitForSvelteClickHandler'),
  revealPagePane:actionSource.includes('revealPagePane'),
  revealBelowFixedMobileNavigation:actionSource.includes('revealBelowFixedMobileNavigation'),
  topFixedNavigationInset:actionSource.includes('revealPagePane')||actionSource.includes('revealBelowFixedMobileNavigation'),
  expandMoreOptions:actionSource.includes('expandMoreOptions'),
  settleFiniteVisualTransitions:spec.surface.startsWith('nav.'),
  visualDiagnostics:true
 };
}
function actionContractFor(spec,{legacy=false}={}){
 const retainPointer=/(?:hover|pointerover|expanded)/iu.test(spec.state)||spec.surface==='nav.mobile-top';
 const actionSource=spec.action.toString();
 const dependencies=actionContractDependencies(spec);
 const contract={
  action:{surface:spec.surface,state:spec.state,fixture:spec.fixtureSlug??null,guest:!!spec.guest,source:actionSource},
  expandMobileTopSubmenu:actionSource.includes('expandMobileTopSubmenu')?expandMobileTopSubmenu.toString():null,
  expandTabletTopNavigation:actionSource.includes('expandTabletTopNavigation')?expandTabletTopNavigation.toString():null,
  navigationActivation:actionSource.includes('expandMobileTopSubmenu')||actionSource.includes('expandTabletTopNavigation')?activateNavigationControl.toString():null,
  renderedSubmenuGeometry:actionSource.includes('expandMobileTopSubmenu')||actionSource.includes('expandTabletTopNavigation')?hasRenderedSubmenuGeometry.toString():null,
  waitForSvelteClickHandler:dependencies.waitForSvelteClickHandler?waitForSvelteClickHandler.toString():null,
  revealPagePane:dependencies.revealPagePane?revealPagePane.toString():null,
  revealBelowFixedMobileNavigation:dependencies.revealBelowFixedMobileNavigation?revealBelowFixedMobileNavigation.toString():null,
  expandMoreOptions:dependencies.expandMoreOptions?expandMoreOptions.toString():null,
  settleFiniteVisualTransitions:dependencies.settleFiniteVisualTransitions?settleFiniteVisualTransitions.toString():null,
  parkPointer:retainPointer?null:spec.surface==='shell.footer-license'?'leave-pointer-unmoved-for-bottom-links':parkPointer.toString(),
  visualDiagnostics:visualDiagnostics.toString()
 };
 if(dependencies.topFixedNavigationInset)contract.topFixedNavigationInset=topFixedNavigationInset.toString();
 if(actionSource.includes('openSidebar')){contract.openSidebar=openSidebar.toString();contract.sidebarOccupiesViewport=sidebarOccupiesViewport.toString()}
 if(actionSource.includes('closeSidebar')){contract.closeSidebar=closeSidebar.toString();contract.sidebarIsClosed=sidebarIsClosed.toString();contract.sidebarOccupiesViewport=sidebarOccupiesViewport.toString()}
 if(actionSource.includes('exerciseHeaderSearch'))contract.exerciseHeaderSearch=exerciseHeaderSearch.toString();
 if(!legacy)delete contract.visualDiagnostics;
 return crypto.createHash('sha256').update(JSON.stringify(contract)).digest('hex');
}
if(process.argv.includes('--dump-contracts')){console.log(JSON.stringify({schema:'scp_jp_interactive_capture_contracts.v2',browser_engine:engineArg,browser_version:browser.version(),run_contract_sha256:runContractSha,runtime_surface_contracts:runtimeSurfaceContracts,states:await Promise.all(states.map(async spec=>({surface:spec.surface,state:spec.state,fixture_slug:spec.fixtureSlug??null,fixture_contract_sha256:await fixtureContractSha(spec),guest:!!spec.guest,applicable_viewports:spec.viewports??defaultInteractionViewports,action_contract_sha256:actionContractFor(spec),legacy_action_contract_sha256:actionContractFor(spec,{legacy:true}),action_contract_dependencies:actionContractDependencies(spec)})))},null,2));await browser.close();if(authBrowser)await authBrowser.close();process.exit(0)}
async function mapLimit(items,limit,mapper){let next=0;const workers=Array.from({length:Math.min(limit,items.length)},(_,workerIndex)=>async()=>{while(true){const index=next++;if(index>=items.length)return;await mapper(items[index],index,workerIndex)}});await Promise.all(workers.map(worker=>worker()))}
let initialAuditDocument={};try{initialAuditDocument=JSON.parse(await fs.readFile(auditPath,'utf8'))}catch{}
const priorRows=initialAuditDocument.records??[];
const priorRowsByKey=new Map(priorRows.map(row=>[`${row.theme}|${row.browser_engine}|${row.viewport}|${row.surface}|${row.state}`,row]));
const priorRowsByTheme=new Map();
const priorRowsByScope=new Map();
for(const row of priorRows){
 const byTheme=priorRowsByTheme.get(row.theme)??[];byTheme.push(row);priorRowsByTheme.set(row.theme,byTheme);
 const scope=`${row.theme}|${row.browser_engine}|${row.viewport}`;
 const rows=priorRowsByScope.get(scope)??[];rows.push(row);priorRowsByScope.set(scope,rows);
}
const priorReviewRows=[...(initialAuditDocument.superseded_records??[]),...priorRows];
const priorReviewRowsByTheme=new Map();
for(const row of priorReviewRows){const rows=priorReviewRowsByTheme.get(row.theme)??[];rows.push(row);priorReviewRowsByTheme.set(row.theme,rows)}
const rowKey=row=>`${row.theme}|${row.browser_engine}|${row.viewport}|${row.surface}|${row.state}`;
async function writeAuditShard(batch,theme){
 const reviewReuseCount=applyExactVisualReviewReuseToRows(batch,await verifyExactReviewSources(priorReviewRowsByTheme.get(theme)??[],batch,portsDir));
 const validStates=new Set(
  engineStates
   .filter(spec=>(spec.viewports??defaultInteractionViewports).includes(viewportArg))
   .map(spec=>`${spec.surface}|${spec.state}`)
 );
 const removeKeys=new Set(batch.map(rowKey));
 if(!stateArgs){
  for(const row of priorRowsByScope.get(`${theme}|${engineArg}|${viewportArg}`)??[]){
   if(!validStates.has(`${row.surface}|${row.state}`))removeKeys.add(rowKey(row));
  }
 }
 const superseded=[];
 for(const next of batch){
  const row=priorRowsByKey.get(rowKey(next));
  if(!row)continue;
  if(
   row.screenshot_sha256===next.screenshot_sha256&&
   row.candidate_sha256===next.candidate_sha256&&
   row.candidate_source_sha256===next.candidate_source_sha256&&
   row.environment_contract_sha256===next.environment_contract_sha256&&
   row.capture_state_action_contract_sha256===next.capture_state_action_contract_sha256
  )continue;
  let historicalScreenshotStatus='no-path';
  if(row.screenshot){
   try{
    const bytes=await fs.readFile(path.join(portsDir,row.screenshot));
    historicalScreenshotStatus=crypto.createHash('sha256').update(bytes).digest('hex')===row.screenshot_sha256?'valid':'hash-mismatch';
   }catch(error){historicalScreenshotStatus=error.code==='ENOENT'?'missing':'unreadable'}
  }
  superseded.push(compactSupersededRecord({...row,superseded_at:new Date().toISOString(),historical_screenshot_valid:historicalScreenshotStatus==='valid',historical_screenshot_status:historicalScreenshotStatus}));
 }
 const shard={
  schema:'theme_lab_interactive_audit_delta.v1',
  theme,engine:engineArg,viewport:viewportArg,
  remove_keys:[...removeKeys],
  records:batch.map(compactAuditRecord),
  superseded_records:superseded,
  visual_review_reuse_updates:reviewReuseCount,
  document_patch:{
   schema:'scp_jp_interactive_visual_audit.v1',fixture_url:base,viewport:viewports[viewportArg],
   auth_bootstrap_blocked:authBootstrapBlocked,
   engine_scope:{chromium:'full interaction state inventory',firefox:'core states: normal page, credit view, History list, Source, and mobile sidebar open/expanded',webkit:'core states: normal page, credit view, History list, Source, and mobile sidebar open/expanded; Safari compatibility proxy, not Safari'},
   state_applicability:applicabilityContract
  }
 };
 await fs.mkdir(auditShardDir,{recursive:true});
 const safeTheme=theme.replace(/[^a-z0-9_-]+/giu,'_');
 const destination=path.join(auditShardDir,`${safeTheme}__${engineArg}__${viewportArg}.json`);
 const temporary=`${destination}.${process.pid}.tmp`;
 await fs.writeFile(temporary,JSON.stringify(shard)+'\n');await fs.rename(temporary,destination);
 return {reviewReuseCount,auditLockWaitMs:0};
}
async function persistBatch(batch,theme){
 if(auditShardDir)return writeAuditShard(batch,theme);
 const lockStarted=performance.now();
 return withAuditLock(auditPath,async()=>{
  const auditLockWaitMs=Math.round(performance.now()-lockStarted);
  let previousDocument={};
  try{previousDocument=JSON.parse(await fs.readFile(auditPath,'utf8'))}
  catch(error){if(error.code!=='ENOENT')throw error}
  const previous=previousDocument.records??[];
  const priorReviewRows=[...(previousDocument.superseded_records??[]),...previous];
  const reviewReuseCount=applyExactVisualReviewReuseToRows(batch,await verifyExactReviewSources(priorReviewRows,batch,portsDir));
  const nextByKey=new Map(batch.map(row=>[`${row.theme}|${row.browser_engine}|${row.viewport}|${row.surface}|${row.state}`,row]));
  const keys=new Set(nextByKey.keys());
  const validStates=new Set(
   engineStates
    .filter(spec=>(spec.viewports??defaultInteractionViewports).includes(viewportArg))
    .map(spec=>`${spec.surface}|${spec.state}`)
  );
  const superseded=[];
  for(const row of previous){
   const key=`${row.theme}|${row.browser_engine}|${row.viewport}|${row.surface}|${row.state}`;
   if(!keys.has(key))continue;
   const next=nextByKey.get(key);
   if(
    row.screenshot_sha256===next.screenshot_sha256 &&
    row.candidate_sha256===next.candidate_sha256 &&
    row.candidate_source_sha256===next.candidate_source_sha256 &&
    row.environment_contract_sha256===next.environment_contract_sha256 &&
    row.capture_state_action_contract_sha256===next.capture_state_action_contract_sha256
   )continue;
   let historicalScreenshotStatus='no-path';
   if(row.screenshot){
    try{
     const bytes=await fs.readFile(path.join(portsDir,row.screenshot));
     historicalScreenshotStatus=crypto.createHash('sha256').update(bytes).digest('hex')===row.screenshot_sha256?'valid':'hash-mismatch';
    }catch(error){
     historicalScreenshotStatus=error.code==='ENOENT'?'missing':'unreadable';
    }
   }
   superseded.push({
    ...row,
    superseded_at:new Date().toISOString(),
    historical_screenshot_valid:historicalScreenshotStatus==='valid',
    historical_screenshot_status:historicalScreenshotStatus
   });
  }
  const retained=previous.filter(row=>{
   const key=`${row.theme}|${row.browser_engine}|${row.viewport}|${row.surface}|${row.state}`;
   if(keys.has(key))return false;
   if(!stateArgs&&row.theme===theme&&row.browser_engine===engineArg&&row.viewport===viewportArg){
    return validStates.has(`${row.surface}|${row.state}`);
   }
   return true;
  });
  // Rows already present in the audit have already crossed the compaction
  // boundary. Re-compacting them on every writer pass both burns CPU on the
  // ~5k-row audit and is lossy because compact diagnostics intentionally use
  // a smaller field vocabulary than fresh browser diagnostics.
  const merged=[...retained,...batch.map(compactAuditRecord)];
  const compactHistory=[
   ...(previousDocument.superseded_records??[]),
   ...superseded.map(compactSupersededRecord)
  ];
  const nextDocument={
   ...previousDocument,
   schema:'scp_jp_interactive_visual_audit.v1',
   updated_at:new Date().toISOString(),
   fixture_url:base,
   viewport:viewports[viewportArg],
   network_policy:{
    external_requests_sent:merged.reduce((n,row)=>n+(row.external_requests_sent??0),0),
    external_requests_blocked_during_auth:authBootstrapBlocked,
    external_requests_blocked_during_states:merged.reduce((n,row)=>n+(row.external_requests_blocked??0),0)
   },
   engine_scope:{
    chromium:'full interaction state inventory',
    firefox:'core states: normal page, credit view, History list, Source, and mobile sidebar open/expanded',
    webkit:'core states: normal page, credit view, History list, Source, and mobile sidebar open/expanded; Safari compatibility proxy, not Safari'
   },
   state_applicability:applicabilityContract,
   records:merged,
   superseded_records:compactHistory,
   visual_review_reuse_updates:(previousDocument.visual_review_reuse_updates??0)+reviewReuseCount
  };
  const tempPath=`${auditPath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath,JSON.stringify(nextDocument)+'\n');
  await fs.rename(tempPath,auditPath);
  return {reviewReuseCount,auditLockWaitMs};
 });
}
 const localAssetPathCache=new Map();const fileShaCache=new Map();const dataUrlCache=new Map();
 for(const theme of themes){
 const themeRecords=[];
  const dir=themeDirectory(theme);const cssPath=path.join(dir,'candidate.css');
  const searchAuthorityPath=`evidence/search-controls-20261001/${theme}.json`;
  const searchAuthorityBytes=await fs.readFile(path.join(themeLabDir,searchAuthorityPath)).catch(()=>null);
  const searchSourceAuthority=searchAuthorityBytes?{path:searchAuthorityPath,sha256:crypto.createHash('sha256').update(searchAuthorityBytes).digest('hex')}:null;
  const candidateStructure=await loadCandidateStructure(dir);
  let css;try{css=await fs.readFile(cssPath,'utf8')}catch(error){throw new Error(`cannot read candidate.css for ${theme}`,{cause:error})}
  const baseCss=await fs.readFile(path.join(dir,'candidate-base.css'),'utf8').catch(()=> '');
  const runtimeSupportCss=await fs.readFile(path.join(packageDir,'runtime-asset-replay.css'),'utf8');
  const baseCssSha=baseCss?crypto.createHash('sha256').update(baseCss).digest('hex'):null;
  // Preserve the historical CSS-only identity for ordinary candidates. Themes
  // with an additional frozen base stylesheet bind both inputs into the key.
  // This avoids invalidating every pre-base capture merely because the key
  // representation changed, while still invalidating the Site base replay.
  const knownThemeIdentities=new Set((priorRowsByTheme.get(theme)??[]).map(row=>row.candidate_sha256));
  const {candidateSha}=candidateIdentity(css,baseCss,knownThemeIdentities);
  const candidateSourceBytes=await fs.readFile(path.join(dir,'candidate.wikidot.source.txt')).catch(()=>fs.readFile(path.join(dir,'candidate.wikidot.txt')).catch(()=>Buffer.alloc(0)));
  const candidateSourceSha=crypto.createHash('sha256').update(candidateSourceBytes).digest('hex');
  const expectedIdentity=runContract.additional_candidates?.[theme];
  if(currentCampaign&&(!expectedIdentity||expectedIdentity.candidate_sha256!==candidateSha||expectedIdentity.source_sha256!==candidateSourceSha))throw new Error(`${theme}: candidate identity differs from the frozen Sigma-10 campaign contract`);
  const assetNamePattern=/[0-9a-f]{64}\.(?:css|svg|png|jpe?g|webp|woff2?|ttf|otf|eot)/giu;
  const referencedAssetNames=new Set(`${runtimeSupportCss}\n${baselineReplacementCss}\n${baseCss}\n${css}\n${candidateSourceBytes.toString('utf8')}`.match(assetNamePattern)??[]);
  const assetDependencies=[];
  const localAssetPath=async name=>{const cacheKey=`${theme}\0${name}`;if(localAssetPathCache.has(cacheKey))return localAssetPathCache.get(cacheKey);let resolved=null;for(const candidate of [path.join(portsDir,'shared-replay-assets',name),path.join(dir,'page-assets',name)]){try{await fs.access(candidate);resolved=candidate;break}catch{}}localAssetPathCache.set(cacheKey,resolved);return resolved};
  const visitedCss=new Set();
  for(const name of referencedAssetNames){
   if(!name.endsWith('.css')||visitedCss.has(name))continue;
   visitedCss.add(name);
   const file=await localAssetPath(name);
   if(!file)continue;
   for(const nested of (await fs.readFile(file,'utf8')).match(assetNamePattern)??[])referencedAssetNames.add(nested);
  }
  const fileSha=async file=>{if(!file)return null;if(fileShaCache.has(file))return fileShaCache.get(file);const digest=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');fileShaCache.set(file,digest);return digest};
  for(const name of [...referencedAssetNames].sort()){const assetPath=await localAssetPath(name);assetDependencies.push({name,sha256:await fileSha(assetPath),status:assetPath?'local-cache':'missing'})}
  const assetDependencySha=crypto.createHash('sha256').update(JSON.stringify(assetDependencies)).digest('hex');
  const assetMimeType=ext=>({'.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf','.eot':'application/vnd.ms-fontobject'})[ext.toLowerCase()]??'application/octet-stream';
  const dataUrlFor=async file=>{if(dataUrlCache.has(file))return dataUrlCache.get(file);const value=`data:${assetMimeType(path.extname(file))};base64,${(await fs.readFile(file)).toString('base64')}`;dataUrlCache.set(file,value);return value};
  const applicable=engineStates.filter(spec=>(spec.viewports??defaultInteractionViewports).includes(viewportArg)&&(!stateArgs||stateArgs.has(`${spec.surface}.${spec.state}`)));
  const preflight=new Map();
  for(const spec of applicable){
   const key=`${theme}|${engineArg}|${viewportArg}|${spec.surface}|${spec.state}`;const old=priorRowsByKey.get(key);const fixtureSha=await fixtureContractSha(spec);const stateActionContract=actionContractFor(spec);const scopedContractSha=scopedRunContractSha(runContract,{theme,viewport:viewportArg,browser_engine:engineArg});const environmentInputs={fixtureSha,site:runContract.target_site,transportOrigin:origin,baselineTheme:runContract.baseline_theme,browserEngine:engineArg,browserVersion:browser.version(),viewportName:viewportArg,viewportSize:viewports[viewportArg],assetDependencySha,...(candidateStructure?{candidate_structure_sha256:candidateStructure.sha256}:{})};const environmentContractSha=crypto.createHash('sha256').update(JSON.stringify({scopedContractSha,...environmentInputs})).digest('hex');const legacyEnvironmentSha=crypto.createHash('sha256').update(JSON.stringify({runContractSha,...environmentInputs})).digest('hex');let reusable=false;
   if(!forceCapture&&old&&old.candidate_sha256===candidateSha&&old.candidate_source_sha256===candidateSourceSha&&old.asset_dependency_sha256===assetDependencySha&&old.fixture_contract_sha256===fixtureSha&&captureRunContractIsCurrent(old,runContract,runContractSha)&&(old.environment_contract_sha256===environmentContractSha||old.run_contract_sha256===runContractSha&&old.environment_contract_sha256===legacyEnvironmentSha)&&(old.action_contract_observation?.mode!=='source-hidden-submit'||JSON.stringify(old.action_contract_observation.source_authority)===JSON.stringify(searchSourceAuthority))&&old.capture_state_action_contract_sha256===(old.capture_action_model==='theme_lab_action_contract.v3'?stateActionContract:actionContractFor(spec,{legacy:true}))&&old.runtime_surface_contract_sha256===runtimeSurfaceContracts[spec.surface]&&old.browser_version===browser.version()&&old.session_state===(anonymousArg||spec.guest?'logged_out':'administrator')&&old.screenshot&&!old.failure&&old.external_requests_sent===0&&Array.isArray(old.asset_failures)&&old.asset_failures.length===0&&Array.isArray(old.page_errors)&&old.page_errors.length===0&&!old.unconfirmed_items?.some(x=>x.startsWith('action/capture failed'))){try{const oldBytes=await fs.readFile(path.join(portsDir,old.screenshot));reusable=crypto.createHash('sha256').update(oldBytes).digest('hex')===old.screenshot_sha256}catch{}}
   preflight.set(`${spec.surface}|${spec.state}`,{old,reusable,fixtureSha,stateActionContract,environmentContractSha,scopedContractSha});
  }
  const freshStates=applicable.filter(spec=>!preflight.get(`${spec.surface}|${spec.state}`).reusable);
  if(freshStates.length===0){for(const spec of applicable){const old=preflight.get(`${spec.surface}|${spec.state}`).old;records.push(old);themeRecords.push(old)}console.log(JSON.stringify({progress:`${themes.indexOf(theme)+1}/${themes.length}`,theme,records:themeRecords.length,captured:themeRecords.filter(r=>r.screenshot).length,reused:themeRecords.length,failed_actions:0,asset_setup:'skipped-all-states-reused',audit_write:'skipped-no-changes'}));continue}
  const externalPageAssetData=new Map();
  if(engineArg==='webkit')for(const manifestName of ['assets.json','page-assets.json']){
   let manifest;try{manifest=JSON.parse(await fs.readFile(path.join(dir,manifestName),'utf8'))}catch{continue}
   for(const item of manifest.assets??[]){const name=item.asset_file??`${item.sha256}${path.extname(item.original_url??item.filename??'')||'.bin'}`;const file=await localAssetPath(name);if(!file)continue;const value=await dataUrlFor(file);for(const url of [item.original_url,item.final_url,item.acquired_from,...(item.source_urls??[])])if(url){try{externalPageAssetData.set(new URL(url).href,value)}catch{}}}
  }
  let browserCss=css;let browserBaseCss=baseCss;let browserBaselineCss=baselineReplacementCss;let browserSupportCss=runtimeSupportCss;const assetRequests=[];
  if(engineArg==='webkit'){
   for(const name of referencedAssetNames){if(name.endsWith('.css'))continue;const file=await localAssetPath(name);if(!file)continue;const value=await dataUrlFor(file);const escaped=name.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');const expression=new RegExp(`url\\((\\s*)(["']?)/?${escaped}\\2(\\s*)\\)`,'giu');browserCss=browserCss.replace(expression,`url("${value}")`);browserBaseCss=browserBaseCss.replace(expression,`url("${value}")`);browserBaselineCss=browserBaselineCss.replace(expression,`url("${value}")`);browserSupportCss=browserSupportCss.replace(expression,`url("${value}")`);assetRequests.push({name,status:'embedded-local'})}
  }
  const context=await browser.newContext({viewport:viewports[viewportArg],ignoreHTTPSErrors:true,...(authenticatedStorage?{storageState:authenticatedStorage}:{})});
  if(engineArg==='webkit')await context.route('**/-/wikidot-interwiki/*.html*',async route=>{if(!await fulfillInterwikiReplay(route,new URL(route.request().url())))await route.continue()});
  if(engineArg==='webkit')await context.route(/\/[0-9a-f]{64}\.[a-z0-9]+(?:[?#]|$)/iu,async route=>{const name=decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)??'');const file=await localAssetPath(name);if(!file){assetRequests.push({name,status:'missing'});await route.abort('blockedbyclient');return}assetRequests.push({name,status:'replayed-local'});await route.fulfill({path:file,contentType:assetMimeType(path.extname(name))})});
  let externalCount=0;if(engineArg!=='webkit'){await context.route('**/*',async route=>{const url=new URL(route.request().url());if(await fulfillInterwikiReplay(route,url))return;if(url.origin!==origin){externalCount++;await route.abort('blockedbyclient');return}const name=decodeURIComponent(url.pathname.split('/').at(-1)??'');if(/^[0-9a-f]{64}\.[a-z0-9]+$/iu.test(name)){const assetPath=await localAssetPath(name);if(assetPath){assetRequests.push({name,status:'replayed-local'});await route.fulfill({path:assetPath,contentType:assetMimeType(path.extname(name))});return}assetRequests.push({name,status:'missing'})}await route.continue()})}
  // Reuse one browser page per capture worker in Chromium/Firefox. WebKit is
  // intentionally fresh-page-per-state: measured reuse can race a late
  // SvelteKit navigation with the next page.goto(), while fresh pages remove
  // that failure and are also faster at the tested 6-way concurrency.
  const reuseWorkerPages=engineArg!=='webkit';
  const workerPages=new Map();const guestWorkerPages=new Map();let guestContextPromise=null;let pagesCreated=0;
  const installActionTrace=async page=>{page.setDefaultTimeout(5000);page.setDefaultNavigationTimeout(12000);await page.addInitScript(()=>{window.__themeLabActionTrace=[];const record=event=>{const target=event.target instanceof Element?event.target:null;if(!target)return;const label=(target.innerText||target.getAttribute('aria-label')||target.getAttribute('value')||'').trim().replace(/\s+/gu,' ').slice(0,96);window.__themeLabActionTrace.push({type:event.type,target:target.id?`#${target.id}`:target.tagName.toLowerCase()+(target.classList.length?'.'+[...target.classList].slice(0,3).join('.'):''),label})};for(const type of ['click','focusin','input','change','pointerover','mouseover','pointerdown'])document.addEventListener(type,record,true);document.addEventListener('scroll',event=>{const target=event.target instanceof Element?event.target:null;if(target)window.__themeLabActionTrace.push({type:'scroll',target:target.id?`#${target.id}`:target.className?.toString?.().split(' ')[0]||target.tagName.toLowerCase()})},true)})};
  const guestContext=async()=>{if(!guestContextPromise)guestContextPromise=(async()=>{const value=await browser.newContext({viewport:viewports[viewportArg],ignoreHTTPSErrors:true});await value.route('**/*',async route=>{const url=new URL(route.request().url());if(await fulfillInterwikiReplay(route,url))return;if(url.origin!==origin){externalCount++;await route.abort('blockedbyclient');return}const name=decodeURIComponent(url.pathname.split('/').at(-1)??'');if(/^[0-9a-f]{64}\.[a-z0-9]+$/iu.test(name)){const assetPath=await localAssetPath(name);if(assetPath){assetRequests.push({name,status:'replayed-local'});await route.fulfill({path:assetPath,contentType:assetMimeType(path.extname(name))});return}assetRequests.push({name,status:'missing'});}await route.continue()});return value})();return guestContextPromise};
  const workerPage=async(workerIndex,guest)=>{const pool=guest?guestWorkerPages:workerPages;if(reuseWorkerPages){const existing=pool.get(workerIndex);if(existing&&!existing.isClosed())return existing}const pageContext=guest?await guestContext():context;const page=await pageContext.newPage();await installActionTrace(page);if(reuseWorkerPages)pool.set(workerIndex,page);pagesCreated++;return page};
  
  const captureState=async(spec,_index,workerIndex)=>{
   const {old,reusable,fixtureSha,stateActionContract,environmentContractSha,scopedContractSha}=preflight.get(`${spec.surface}|${spec.state}`);
   if(reusable){records.push(old);themeRecords.push(old);return}
    // Migration shell and base-credit states exercise Sigma-10's saved page
    // markup. Keep explicitly named variant fixtures separate: those are
    // historical diagnostics, not substitutes for the current credit source.
    const effectiveFixtureSlug=interactiveAcceptanceFixture(spec,migrationFixture);
   const externalBefore=engineArg==='webkit'?webkitProxyBlocked:externalCount;const page=await workerPage(workerIndex,!!spec.guest);page.__themeLabSearchSourceAuthority=searchSourceAuthority;const stateStartedAt=performance.now();const phaseDurations={navigation:0,hydration:0,action:0,visual_settle:0,paint_and_capture:0};const errors=[];const pageErrorHandler=e=>errors.push(e.message);page.on('pageerror',pageErrorHandler);
   let shot=null,actionError=null,settledAnimationsFinished=0,baselineThemeHref=null;const actionResponses=[];const responseHandler=async response=>{if(response.url().includes('?/revisionDiff')){let body='';try{body=await response.text()}catch{}let type='unknown',errorMessage=null;try{const envelope=JSON.parse(body);type=envelope.type??type;if(type==='failure'){const detail=JSON.parse(envelope.data);errorMessage=Array.isArray(detail)?detail[1]??null:null}}catch{}actionResponses.push({status:response.status(),type,error_message:errorMessage})}};page.on('response',responseHandler);
   try{
    const fixtureUrl=effectiveFixtureSlug?`${origin}/${encodeURIComponent(effectiveFixtureSlug)}`:(spec.surface==='page.history'?historyBase:base);
    let phaseStartedAt=performance.now();await page.goto('about:blank');await gotoFixture(page,fixtureUrl);if(candidateStructure)await page.locator('#page-content').evaluate((element,html)=>element.insertAdjacentHTML('afterbegin',html),candidateStructure.html);phaseDurations.navigation=Math.round(performance.now()-phaseStartedAt);if(migrationFixture)await injectMigrationShell(page,migrationFixture);if(navigationFixture){await page.waitForFunction(()=>{const e=document.querySelector('#history-button');return e&&Object.getOwnPropertySymbols(e).some(s=>s.description==='events'&&typeof e[s]?.click==='function')},null,{timeout:15000});await page.locator('#top-bar').evaluate((e,html)=>{e.innerHTML=html},navigationFixture)}if(headerFixture)await page.locator('#header').evaluate((e,html)=>{const t=document.createElement('template');t.innerHTML=html;for(const tag of ['h1','h2'])e.querySelector(tag).replaceWith(t.content.querySelector(tag).cloneNode(true))},headerFixture);if(sidebarFixture)await page.locator('#side-bar').evaluate((e,html)=>{e.innerHTML=html},sidebarFixture);if(interwikiFixture)await page.locator('#side-bar').evaluate((e,html)=>{e.querySelectorAll('.scpnet-interwiki-wrapper').forEach(node=>node.remove());e.insertAdjacentHTML('beforeend',html)},interwikiFixture);if(engineArg==='webkit'&&externalPageAssetData.size){const imageResults=await page.evaluate(async mappings=>{const lookup=new Map(mappings);const results=[];for(const image of document.images){let source;try{source=new URL(image.currentSrc||image.src,location.href).href}catch{continue}if(new URL(source).origin===location.origin)continue;const data=lookup.get(source);if(!data)continue;image.src=data;try{await image.decode();results.push({source,status:'embedded-local'})}catch{results.push({source,status:'decode-failed'})}}return results},[...externalPageAssetData]);assetRequests.push(...imageResults.map(result=>({name:result.source,status:result.status})))}baselineThemeHref=await page.locator(`link[rel="stylesheet"][href="${runtimeBaselineStylesheetHref}"]`).getAttribute('href').catch(()=>null);if(!baselineThemeHref)throw new Error(`runtime base-theme stylesheet differs from the acceptance contract (${runContract.baseline_theme.name})`);if(baselineReplacementCss)await page.locator('link[rel="stylesheet"][href="'+runtimeBaselineStylesheetHref+'"]').evaluate(link=>{link.disabled=true;link.media='not all'});const styleNonce=await page.locator('script[nonce],style[nonce]').first().getAttribute('nonce').catch(()=>null);await page.evaluate(({css,nonce})=>{if(document.querySelector('[data-theme-lab-acceptance-styles]'))throw new Error('acceptance CSS already applied');const style=document.createElement('style');style.setAttribute('data-theme-lab-acceptance-styles','');if(nonce)style.nonce=nonce;style.textContent=css;document.head.append(style)},{css:dedupeCssLayers([browserSupportCss,browserBaselineCss,browserBaseCss,browserCss,savedComponentCss]).join('\n'),nonce:styleNonce});
    // Only states that exercise Svelte-owned controls need the delegated
    // click-handler barrier. Static/anchor/CSS states are server-rendered and
    // can proceed after DOMContentLoaded + candidate CSS injection; forcing
    // them to wait for an unrelated History button made high-concurrency runs
    // contend on hydration and erased most of the parallel speedup.
    phaseStartedAt=performance.now();if(requiresSvelteHydration(spec))await waitForSvelteClickHandler(page,'#history-button');else await page.locator('#page-content').waitFor({state:'attached'});phaseDurations.hydration=Math.round(performance.now()-phaseStartedAt);
    phaseStartedAt=performance.now();await spec.action(page);if(shouldParkPointer(spec))await parkPointer(page,viewports[viewportArg]);phaseDurations.action=Math.round(performance.now()-phaseStartedAt);
    // Hash/DOM assertions can become true before theme CSS transitions settle.
    phaseStartedAt=performance.now();settledAnimationsFinished=spec.surface.startsWith('nav.')?await settleFiniteVisualTransitions(page):0;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));phaseDurations.visual_settle=Math.round(performance.now()-phaseStartedAt);
    const stateKey=`${spec.surface.replaceAll('.','-')}-${spec.state}-${viewportArg}`;const screenshotBytes=await page.screenshot({fullPage:false,animations:'disabled'});shot=await storeContentAddressedScreenshot({portsDir,theme,engine:engineArg,viewport:viewportArg,stateKey,bytes:screenshotBytes,artifactNamespace});phaseDurations.paint_and_capture=Math.round(performance.now()-phaseStartedAt);
   }catch(error){
    actionError=error.message;
    // Preserve the actual failed/partially-open interaction state. A missing
    // screenshot made previous failures impossible to visually diagnose.
    try{
     await page.waitForTimeout(200);
     const stateKey=`${spec.surface.replaceAll('.','-')}-${spec.state}-${viewportArg}-failed`;
     const screenshotBytes=await page.screenshot({fullPage:false,animations:'disabled'});
     shot=await storeContentAddressedScreenshot({portsDir,theme,engine:engineArg,viewport:viewportArg,stateKey,bytes:screenshotBytes,artifactNamespace});
    }catch{}
   }
   const actionSequence=await page.evaluate(()=>window.__themeLabActionTrace??[]).catch(()=>[]);const actionContractObservation=await page.evaluate(()=>window.__themeLabActionContractObservation??null).catch(()=>null);const diagnostics=await visualDiagnostics(page,spec.surface).catch(()=>null);
   const titleCompositionMeasurement=await page.evaluate(measureTitleComposition).catch(()=>null);
   const titleTextMeasurement=titleCompositionMeasurement?.overlaps.some(item=>item.effectively_visible)?await page.evaluate(measureTitleTextIntersections,titleCompositionMeasurement.overlaps).catch(()=>null):null;
   if(!actionError&&actionResponses.some(response=>response.type==='failure'||response.status>=400||response.error_message))actionError='action response reported failure';
   const record={theme,...(candidateStructure?{candidate_structure_sha256:candidateStructure.sha256}:{}),session_state:anonymousArg||spec.guest?'logged_out':'administrator',target_site:runContract.target_site.slug,transport_origin:origin,locale:runContract.target_site.locale,baseline_theme:runContract.baseline_theme.name,baseline_theme_css_href:baselineReplacementPath?runContract.baseline_theme.replacement_css_path:baselineThemeHref,baseline_theme_css_sha256:baselineReplacementSha,runtime_baseline_theme_css_href:baselineThemeHref,baseline_theme_mode:baselineReplacementCss?'replacement':'runtime',browser_engine:engineArg,browser_version:browser.version(),viewport:viewportArg,viewport_size:viewports[viewportArg],surface:spec.surface,state:spec.state,fixture:effectiveFixtureSlug??'run-owned:theme-lab-visual-acceptance-imported-20260924',candidate_source_sha256:candidateSourceSha,base_css_path:baseCss?'candidate-base.css':null,base_css_sha256:baseCssSha,asset_dependency_sha256:assetDependencySha,asset_dependencies:assetDependencies,fixture_contract_sha256:fixtureSha,run_contract_sha256:runContractSha,environment_contract_sha256:environmentContractSha,capture_state_action_contract_sha256:stateActionContract,settled_animations_finished:settledAnimationsFinished,runtime_surface_contract_sha256:runtimeSurfaceContracts[spec.surface],duration_ms:Math.round(performance.now()-stateStartedAt),phase_durations_ms:phaseDurations,action_sequence:actionSequence,action_contract_observation:actionContractObservation,screenshot:shot?.path??null,screenshot_sha256:shot?.sha256??null,candidate_sha256:candidateSha,visual_diagnostics:diagnostics,classification:'UNCONFIRMED',visual_findings:[],intentional_differences:[],unconfirmed_items:actionError?[`action/capture failed: ${actionError}`]:['screenshot captured but awaiting image review'],reviewed_after_last_change:false,external_requests_sent:0,external_requests_blocked:(engineArg==='webkit'?webkitProxyBlocked:externalCount)-externalBefore,asset_failures:assetRequests.filter(x=>['missing','decode-failed'].includes(x.status)),page_errors:errors,action_responses:actionResponses};record.decision_authority='SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY';record.port_conclusion_eligible=false;records.push(record);themeRecords.push(record);
   record.title_composition_measurement=titleCompositionMeasurement;record.title_composition_contract_sha256=crypto.createHash('sha256').update(measureTitleComposition.toString()).digest('hex');if(titleTextMeasurement){record.title_text_measurement=titleTextMeasurement;record.title_text_contract_sha256=crypto.createHash('sha256').update(measureTitleTextIntersections.toString()).digest('hex')}
   record.scoped_run_contract_sha256=scopedContractSha;record.capture_action_model='theme_lab_action_contract.v3';record.visual_diagnostics_contract_sha256=crypto.createHash('sha256').update(visualDiagnostics.toString()).digest('hex');
   if(actionError)record.failure=actionError;
   page.off('pageerror',pageErrorHandler);page.off('response',responseHandler);if(reuseWorkerPages)await page.goto('about:blank').catch(()=>{});if(!reuseWorkerPages)await page.close();
  };
  await mapLimit(applicable,concurrencyArg,captureState);
  await context.close();if(guestContextPromise)await (await guestContextPromise).close();
  // Cached rows are an unlocked startup snapshot. Only newly captured rows
  // may replace the latest audit; a concurrent reviewer owns cached rows.
  const freshKeys=new Set(freshStates.map(spec=>`${spec.surface}|${spec.state}`));
  const {reviewReuseCount,auditLockWaitMs}=await persistBatch(themeRecords.filter(row=>freshKeys.has(`${row.surface}|${row.state}`)),theme);console.log(JSON.stringify({progress:`${themes.indexOf(theme)+1}/${themes.length}`,theme,records:themeRecords.length,captured:themeRecords.filter(r=>r.screenshot).length,review_reused:reviewReuseCount,audit_lock_wait_ms:auditLockWaitMs,failed_actions:themeRecords.filter(r=>r.unconfirmed_items?.some(x=>x.startsWith('action/capture failed'))).length,pages_created:pagesCreated}));
 }
}finally{await browser?.close();if(authBrowser)await authBrowser.close();if(webkitProxy){webkitProxy.closeAllConnections();await new Promise(resolve=>webkitProxy.close(resolve))}}
console.log(JSON.stringify({engine:engineArg,viewport:viewportArg,themes:themes.length,records:records.length,captured:records.filter(r=>r.screenshot).length,unconfirmed:records.filter(r=>r.classification==='UNCONFIRMED').length,blocked_external:records.reduce((n,r)=>n+(r.external_requests_blocked??0),0),asset_failures:records.reduce((n,r)=>n+(r.asset_failures?.length??0),0),auth_bootstrap_ms:authBootstrapMs,auth_external_blocked:authBootstrapBlocked,concurrency:concurrencyArg}));
