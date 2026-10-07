#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

import {framerailSourceFingerprintSync} from '../../../src/framerail-source-fingerprint.mjs';
import {assertDeepwellRuntimeIdentity,deepwellRuntimeIdentityFromHeaders,readRunningDeepwellRuntimeIdentity,requireDeepwellRuntimeIdentity} from '../../../src/deepwell-runtime-identity.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const themeLab=path.resolve(here,'../../../');
const ports=path.join(themeLab,'ports');
const repo=path.resolve(here,'../../../../../../');
const corpusRoot='/home/roku/src/Rokurolize/scp-wiki-translation/corpus';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const captureRunnerSha=sha(fs.readFileSync(fileURLToPath(import.meta.url)));
const args=process.argv.slice(2);
const value=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]??null};
const scenario=value('--scenario');
const baseline=value('--baseline');
const engineName=value('--engine')??'chromium';
if(!['combined','collapsible'].includes(scenario))throw new Error('--scenario must be combined or collapsible');
if(!['sigma9','sigma10'].includes(baseline))throw new Error('--baseline must be sigma9 or sigma10');
if(!['chromium','firefox','webkit'].includes(engineName))throw new Error('--engine must be chromium, firefox, or webkit');

const authorityPath=path.join(here,'authority.json');
const authority=JSON.parse(fs.readFileSync(authorityPath,'utf8'));
function assertFile(file,expected,label){const bytes=fs.readFileSync(file);const actual=sha(bytes);if(actual!==expected)throw new Error(`${label} SHA mismatch: ${actual} != ${expected}`);return bytes}
for(const row of authority.pages){
 const source=path.join(here,row.snapshot_path);
 assertFile(source,row.source_sha256,`${row.slug} retained source`);
 const currentDir=path.join(corpusRoot,'jp','pages',row.slug);
 const meta=JSON.parse(fs.readFileSync(path.join(currentDir,'meta.json'),'utf8'));
 const current=JSON.parse(fs.readFileSync(path.join(currentDir,'current.json'),'utf8'));
 const entity=fs.readFileSync(path.join(currentDir,'entity_id.txt'),'utf8').trim();
 const liveBytes=fs.readFileSync(path.join(currentDir,'source.wikidot.txt'));
 if(meta.revisions!==row.revision||meta.updated_at!==row.updated_at||entity!==row.entity_id||current.entity_id!==row.entity_id||sha(liveBytes)!==row.source_sha256)throw new Error(`${row.slug}: shared current corpus identity changed; refresh scenario authority first`);
}
const intent=authority.source_intent_review;
if(!intent||intent.reviewed_at!=='2026-10-06')throw new Error('BHL toggle source-intent review is missing or stale');
const englishDir=path.join(corpusRoot,'en','pages',intent.english_current.slug);
const englishMeta=JSON.parse(fs.readFileSync(path.join(englishDir,'meta.json'),'utf8'));
const englishCurrent=JSON.parse(fs.readFileSync(path.join(englishDir,'current.json'),'utf8'));
const englishEntity=fs.readFileSync(path.join(englishDir,'entity_id.txt'),'utf8').trim();
const englishSourceBytes=fs.readFileSync(path.join(englishDir,'source.wikidot.txt'));
const englishSource=englishSourceBytes.toString('utf8');
const jpToggleSource=fs.readFileSync(path.join(here,'sources/component--toggle-sidebar-bhl.wikidot.txt'),'utf8');
const jpCollapsibleSource=fs.readFileSync(path.join(here,'sources/component--collapsible-sidebar.wikidot.txt'),'utf8');
if(englishMeta.revisions!==intent.english_current.revision||englishMeta.updated_at!==intent.english_current.updated_at||englishEntity!==intent.english_current.entity_id||englishCurrent.entity_id!==intent.english_current.entity_id||sha(englishSourceBytes)!==intent.english_current.source_sha256)throw new Error('English BHL toggle current-source identity changed; refresh the source-intent review');
if(!englishSource.includes('toggled via a corner button')||!englishSource.includes('functions via hovering rather than clicking')||!jpToggleSource.includes('コーナーボタンで開閉')||!jpToggleSource.includes('クリックではなくホバーで機能'))throw new Error('Current EN/JP source descriptions no longer support the recorded button-versus-hover distinction');
if(!jpCollapsibleSource.includes('ホバー'))throw new Error('Current JP collapsible-sidebar source no longer records hover behavior');
const collapsibleMeta=JSON.parse(fs.readFileSync(path.join(corpusRoot,'jp/pages/component:collapsible-sidebar/meta.json'),'utf8'));
const childMeta=JSON.parse(fs.readFileSync(path.join(corpusRoot,'jp/pages/fragment:collapsible-sidebar-bhl/meta.json'),'utf8'));
if(collapsibleMeta.children!==1||childMeta.parent_fullname!=='component:collapsible-sidebar'||!childMeta.tags.includes('フラグメント'))throw new Error('ListPages parent/child result for the collapsible BHL fragment is not unique/current');
const candidateDir=path.resolve(here,'..');
const candidateSourcePath=path.join(candidateDir,'candidate.wikidot.source.txt');
const candidateCssPath=path.join(candidateDir,'candidate.css');
const candidateSourceSha=sha(assertFile(candidateSourcePath,authority.candidate.source_sha256,'current BHL candidate source'));
const candidateCssSha=sha(assertFile(candidateCssPath,authority.candidate.css_sha256,'current BHL candidate CSS'));
if(authority.pages.find(row=>row.slug==='theme:black-highlighter-theme')?.revision!==74)throw new Error('BHL scenario is not bound to JP revision 74');
const framerailSha=framerailSourceFingerprintSync(repo);
if(framerailSha!==authority.framerail.fingerprint_sha256)throw new Error(`Framerail fingerprint changed after .close-menu fix: ${framerailSha}`);
const expectedBackendRuntimeIdentity=requireDeepwellRuntimeIdentity(authority.backend_runtime_identity,'BHL option authority');
const runningBackendRuntimeIdentity=readRunningDeepwellRuntimeIdentity(repo).identity;
assertDeepwellRuntimeIdentity(expectedBackendRuntimeIdentity,runningBackendRuntimeIdentity,'running local Deepwell before BHL option capture');

function pageSource(slug){const row=authority.pages.find(x=>x.slug===slug);return fs.readFileSync(path.join(here,row.snapshot_path),'utf8')}
function shownCssModule(slug,sourceOverride=null){
 const source=sourceOverride??pageSource(slug);
 const matches=[...source.matchAll(/\[\[module CSS\s+show="true"\]\]([\s\S]*?)\[\[\/module\]\]/giu)];
 if(matches.length!==1)throw new Error(`${slug}: expected one documentation CSS module, found ${matches.length}`);
 return matches[0][1].replace(/^\s*\n/u,'').replace(/\n\s*$/u,'').replace(/^\s*@import\s+url\([^\n]*\);?\s*$/gimu,'');
}
function activeCssModule(slug,sourceOverride=null){
 const source=sourceOverride??pageSource(slug);
 const matches=[...source.matchAll(/\[\[module CSS\]\]([\s\S]*?)\[\[\/module\]\]/giu)].filter(match=>match[1].includes('.creditModule'));
 if(matches.length!==1)throw new Error(`${slug}: expected one component-specific active CSS module, found ${matches.length}`);
 return matches[0][1].replace(/^\s*\n/u,'').replace(/\n\s*$/u,'').replace(/^\s*@import\s+url\([^\n]*\);?\s*$/gimu,'');
}
function makeOptionCssBlocks(){
 if(scenario==='combined')return [
  '/* centered-header-bhl JP rev3; source SHA '+authority.pages.find(x=>x.slug==='component:centered-header-bhl').source_sha256+' */\n'+shownCssModule('component:centered-header-bhl'),
  (()=>{
   const row=authority.option_candidates.find(x=>x.slug==='component:toggle-sidebar-bhl');
   const page=authority.pages.find(x=>x.slug==='component:toggle-sidebar-bhl');
   const source=row?fs.readFileSync(path.join(here,row.source_path),'utf8'):pageSource(page.slug);
   if(row&&(sha(source)!==row.source_sha256||row.derived_from_source_sha256!==page.source_sha256))throw new Error(`${row.slug} option candidate provenance/hash mismatch`);
   return `/* ${page.slug} JP rev${page.revision}; source SHA ${row?.source_sha256??page.source_sha256} */\n${shownCssModule(page.slug,source)}`;
  })(),
  (()=>{
   const page=authority.pages.find(x=>x.slug==='component:bhl-dark-sidebar');
   const row=authority.option_candidates.find(x=>x.slug===page.slug);
   const source=row?fs.readFileSync(path.resolve(here,row.source_path),'utf8'):pageSource(page.slug);
   if(row&&(sha(source)!==row.source_sha256||row.derived_from_source_sha256!==page.source_sha256))throw new Error(`${row.slug} option candidate provenance/hash mismatch`);
   const activeCss=activeCssModule(page.slug,source);
   const style0=fs.readFileSync(path.resolve(here,page.stylesheet.path),'utf8');
   return `/* ${page.slug} JP rev${page.revision}; ${row?'candidate':'source'} SHA ${row?.source_sha256??page.source_sha256}; style0 SHA ${page.stylesheet.sha256} */\n${activeCss}\n${style0}`;
  })(),
 ];
 const fragment=pageSource('fragment:collapsible-sidebar-bhl');
 const fragmentCss=[...fragment.matchAll(/\[\[module CSS\]\]([\s\S]*?)\[\[\/module\]\]/giu)].map(x=>x[1].replace(/^\s*@import\s+url\([^\n]*\);?\s*$/gimu,'').trim()).filter(Boolean).join('\n');
 return [
  '/* collapsible-sidebar JP rev4; source SHA '+authority.pages.find(x=>x.slug==='component:collapsible-sidebar').source_sha256+' */',
  shownCssModule('component:collapsible-sidebar'),
  '/* dynamic ListPages child fragment:collapsible-sidebar-bhl JP rev5; source SHA '+authority.pages.find(x=>x.slug==='fragment:collapsible-sidebar-bhl').source_sha256+'; its only CSS imports are the already-bound BHL base */',
  fragmentCss,
 ].filter(Boolean);
}
const optionCssBlocks=makeOptionCssBlocks();
const optionCss=optionCssBlocks.join('\n\n');
const cssDir=path.join(here,'styles');fs.mkdirSync(cssDir,{recursive:true});
const optionCssPath=path.join(cssDir,`${scenario}-publication-blocks-v21.css`);
if(fs.existsSync(optionCssPath)&&fs.readFileSync(optionCssPath,'utf8')!==optionCss)throw new Error(`${path.basename(optionCssPath)} changed; retain the prior bytes and version a new scenario stylesheet`);
fs.writeFileSync(optionCssPath,optionCss);
const optionCssSha=sha(Buffer.from(optionCss));

const assetRoot=path.join(ports,'shared-replay-assets');
const themeAssets=JSON.parse(fs.readFileSync(path.join(candidateDir,'assets.json'),'utf8'));
function mime(ext){return({'.ttf':'font/ttf','.woff':'font/woff','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'})[ext]??'application/octet-stream'}
function embedLocalAssets(css,label){
 return css.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/giu,(whole,quote,raw)=>{
  const url=raw.trim();if(/^(?:data:|#)/iu.test(url))return whole;
  let name=path.basename(url);
  if(/^https?:\/\//iu.test(url)||url.startsWith('//')){
   const absolute=url.startsWith('//')?`https:${url}`:url;
   const entry=themeAssets.assets.find(row=>row.original_url===absolute||row.final_url===absolute);
   const retained=authority.external_assets?.find(row=>row.url===absolute);
   if(!entry&&!retained)throw new Error(`${label}: external asset has no retained authority: ${absolute}`);
   const assetSha=entry?.sha256??retained.sha256;
   const assetType=entry?.content_type??retained.content_type;
   name=`${assetSha}${path.extname(new URL(absolute).pathname)}`;
   const assetPath=entry?path.join(assetRoot,name):path.resolve(here,retained.path);
   const bytes=fs.readFileSync(assetPath);if(sha(bytes)!==assetSha)throw new Error(`${label}: retained external asset SHA mismatch: ${absolute}`);
   return `url("data:${assetType};base64,${bytes.toString('base64')}")`;
  }
  if(!/^[0-9a-f]{64}\.[a-z0-9]+$/iu.test(name))throw new Error(`${label}: unexpected non-content-addressed URL ${url}`);
  const file=path.join(assetRoot,name);if(!fs.existsSync(file))throw new Error(`${label}: missing local asset ${name}`);
  const bytes=fs.readFileSync(file);if(name.slice(0,64)!==sha(bytes))throw new Error(`${label}: corrupt local asset ${name}`);
  return `url("data:${mime(path.extname(name))};base64,${bytes.toString('base64')}")`;
 });
}
const browserCandidateCss=embedLocalAssets(fs.readFileSync(candidateCssPath,'utf8'),'BHL candidate CSS');
const baselineFile=baseline==='sigma9'?path.join(themeLab,'fixtures/scp-jp-sigma9-offline.css'):path.join(themeLab,'sigma10-migration/sigma10-offline.css');
const baselineCss=embedLocalAssets(fs.readFileSync(baselineFile,'utf8'),`${baseline} baseline CSS`);
const browserOptionCssBlocks=optionCssBlocks.map((css,index)=>embedLocalAssets(css,`BHL option CSS block ${index+1}`));
const baselineSha=sha(fs.readFileSync(baselineFile));

const stateSets={
 combined:{
  chromium:[
   ['centered-desktop','desktop'],['centered-mobile','mobile'],['centered-narrow','narrow-mobile'],
   ['toggle-rest','desktop'],['toggle-corner-button-open','desktop'],['toggle-hover-after-button-open','desktop'],['toggle-keyboard-focus-open','desktop'],
   ['toggle-mobile-target-open','mobile'],['toggle-mobile-close-menu','mobile'],['toggle-narrow-target-open','narrow-mobile'],
   ['dark-normal','desktop'],['dark-hover','desktop'],['dark-keyboard-focus','desktop'],['dark-current','desktop'],
   ['dark-mobile-normal','mobile'],['dark-mobile-keyboard-focus','mobile'],['dark-mobile-current','mobile'],
   ['dark-mobile-hover','mobile'],
  ],
  interaction:[['toggle-corner-button-open','desktop'],['toggle-hover-after-button-open','desktop'],['toggle-keyboard-focus-open','desktop']],
 },
 collapsible:{
  chromium:[['collapsible-rest','desktop'],['collapsible-hover-expanded','desktop'],['collapsible-keyboard-focus-expanded','desktop'],['collapsible-nested-entry','desktop'],['collapsible-closed','desktop'],['collapsible-mobile','mobile'],['collapsible-narrow-mobile','narrow-mobile']],
  interaction:[['collapsible-hover-expanded','desktop'],['collapsible-keyboard-focus-expanded','desktop'],['collapsible-nested-entry','desktop']],
 }
};
let states=engineName==='chromium'?stateSets[scenario].chromium:stateSets[scenario].interaction;
if(engineName!=='chromium'&&scenario==='combined')states=[...states,['toggle-mobile-target-open','mobile'],['toggle-mobile-close-menu','mobile']];
const stateFilter=value('--state');
if(stateFilter){
 const selected=new Set(stateFilter.split(',').map(state=>state.trim()).filter(Boolean));
 if(!selected.size||stateFilter.split(',').some(state=>!state.trim()))throw new Error('--state needs one or more comma-separated non-empty state names');
 const unavailable=[...selected].filter(state=>!states.some(([available])=>available===state));
 if(unavailable.length)throw new Error(`requested state(s) are unavailable for ${scenario}/${engineName}: ${unavailable.join(', ')}`);
 states=states.filter(([state])=>selected.has(state));
}
const baselineAlias=baseline==='sigma9'?'Sigma-9':'Sigma-10';
const runDir=path.join(here,'runs');fs.mkdirSync(runDir,{recursive:true});
const outPath=path.join(runDir,`${scenario}-${baseline}-${engineName}.json`);

const browserRequire=createRequire(path.join(repo,'framerail/package.json'));
const {chromium,firefox,webkit}=browserRequire('@playwright/test');
const browserType={chromium,firefox,webkit}[engineName];
const browserEnv=engineName==='webkit'?{...process.env,http_proxy:'',https_proxy:'',HTTP_PROXY:'',HTTPS_PROXY:'',all_proxy:'',ALL_PROXY:'',no_proxy:'*',NO_PROXY:'*'}:process.env;
const browser=await browserType.launch({headless:true,env:browserEnv});
const origin=authority.framerail.runtime_origin;
if(origin!=='https://scpaiueouiuiuiui.wikijump.localhost:3395')throw new Error('BHL scenario capture must use the current task-owned Framerail runtime');
const context=await browser.newContext({ignoreHTTPSErrors:true});
let blockedExternal=0;
await context.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.origin!==origin){blockedExternal++;await route.abort('blockedbyclient');return}
 if(/^\/-\/wikidot-interwiki\/(?:interwikiFrame|styleFrame)\.html$/u.test(url.pathname)){
  const body='<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;min-width:0;min-height:1px}</style></head><body><div class="side-block"></div><div id="resizer-container"></div></body></html>';
  await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body});return;
 }
 await route.continue();
});
const rows=[];
const targetUrl=`${origin}/run-owned%3Atheme-lab-visual-acceptance-imported-20260924`;
function rgba(s){const m=s.match(/rgba?\(([^)]+)\)/u);if(!m)return null;const a=m[1].split(/[,/ ]+/u).filter(Boolean).map(Number);return a.length>=3?[a[0],a[1],a[2],a[3]??1]:null}
function luminance(c){const f=x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4};return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2])}
function contrast(a,b){const l1=luminance(a),l2=luminance(b);return(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)}
async function currentLink(page){return page.locator('#side-bar .menu-item a').first()}
async function waitCss(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}
async function addStyleAtDocumentEnd(page,content,label){await page.evaluate(({content,label})=>{const style=document.createElement('style');style.dataset.themeLabScenario=label;style.textContent=content;document.body.append(style)}, {content,label})}
async function visibleSidebarOpener(page){
 const links=page.locator('a[href="#side-bar"]');
 for(let i=0;i<await links.count();i++){const link=links.nth(i);if(await link.isVisible())return link;}
 throw new Error('the current visible mobile :target sidebar control is missing');
}
async function openToggleWithCornerButton(page){
 const button=page.locator('#side-bar > .close-menu');
 await button.waitFor({state:'visible',timeout:5000});
 const href=await button.getAttribute('href');
 await button.click({timeout:5000});
 await page.waitForFunction(()=>{
  const side=document.querySelector('#side-bar');
  return !!side&&(side.matches(':focus-within')||side.matches(':target')||side.getBoundingClientRect().left>=-1);
 },null,{timeout:5000});
 await page.waitForTimeout(750);
 return {type:'click-desktop-corner-button',selector:'#side-bar > .close-menu',href};
}
async function openMobileSidebarByTarget(page){
 if(await page.evaluate(()=>location.hash==='#side-bar'))return;
 const opener=await visibleSidebarOpener(page);await opener.click();
 await page.waitForFunction(()=>location.hash==='#side-bar');await page.waitForTimeout(650);
}
async function sidebarData(page){return page.evaluate(()=>{const e=document.querySelector('#side-bar');if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{x:r.x,y:r.y,width:r.width,height:r.height,left:s.left,transform:s.transform,position:s.position,display:s.display,background:s.backgroundColor}})}
async function assertions(page,state,viewport){
 return page.evaluate(({state,viewport})=>{
  const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
  const h1=document.querySelector('#header h1'),h2=document.querySelector('#header h2'),header=document.querySelector('#header');
  const title=rect(h1),subtitle=rect(h2),headerBox=rect(header);
  const center=(r)=>r?r.left+r.width/2:null;
  const h1Style=h1?getComputedStyle(h1):null,h2Style=h2?getComputedStyle(h2):null;
  const centerHeader={h1_display:h1Style?.display??null,h2_display:h2Style?.display??null,h1_justify:h1Style?.justifyContent??null,h2_justify:h2Style?.justifyContent??null,h1_center_delta:title?Math.abs(center(title)-center(headerBox)):null,h2_center_delta:subtitle?Math.abs(center(subtitle)-center(headerBox)):null,h1_rect:title,h2_rect:subtitle,header_rect:headerBox,header:!!title&&!!subtitle};
  const side=document.querySelector('#side-bar'),sideRect=rect(side),sideCss=side?getComputedStyle(side):null;
  const close=document.querySelector('#side-bar > .close-menu');
  const closeStyle=close?getComputedStyle(close):null;
  const closeBox=rect(close);
  const current=document.querySelector('#side-bar .bhl-option-current');
  const currentStyle=current?getComputedStyle(current):null;
  const currentData=current?{color:currentStyle.color,backgroundColor:currentStyle.backgroundColor,outlineColor:currentStyle.outlineColor,outlineStyle:currentStyle.outlineStyle,rect:rect(current),ariaCurrent:current.getAttribute('aria-current')}:null;
  const link=document.querySelector('#side-bar .bhl-option-state-link');
  const linkStyle=link?getComputedStyle(link):null;
  const mobile=innerWidth<769;
  const content=document.querySelector('#main-content');
  const contentRect=rect(content);
  const centerPoint=contentRect?{x:Math.min(innerWidth-2,Math.max(1,contentRect.left+Math.min(contentRect.width/2,20))),y:Math.min(innerHeight-2,Math.max(1,contentRect.top+Math.min(contentRect.height/2,20)))}:null;
  const hit=centerPoint?document.elementFromPoint(centerPoint.x,centerPoint.y):null;
  const allRules=[];const visit=rules=>{for(const rule of [...rules]){if(rule.selectorText?.includes('#side-bar:focus-within'))allRules.push({selector:rule.selectorText,css:rule.cssText});if(rule.cssRules?.length)visit(rule.cssRules);}};for(const sheet of [...document.styleSheets]){try{visit(sheet.cssRules)}catch{}}
  const sideRules=[];const visitSide=rules=>{for(const rule of [...rules]){if(rule.selectorText?.includes('#side-bar'))sideRules.push({selector:rule.selectorText,sidebarBg:rule.style?.getPropertyValue('--sidebar-bg-color')??'',background:rule.style?.getPropertyValue('background-color')??'',left:rule.style?.getPropertyValue('left')??''});if(rule.cssRules?.length)visitSide(rule.cssRules);}};for(const sheet of [...document.styleSheets]){try{visitSide(sheet.cssRules)}catch{}}
  // The source-defined desktop sidebar is off-canvas at rest; require both
  // an on-screen origin and real sidebar width for an open-state observation.
  const isOpen=sideRect?sideRect.left>=-2&&sideRect.width>28:false;
  const isClosed=sideRect?sideRect.width<=28||sideRect.right<=12:false;
  const target=side?.matches(':target')??false;
  const active=document.activeElement;
  const focusWithin=!!side&&side.contains(active);
  const focusWithinCss=!!side&&side.matches(':focus-within');
  const activeFocus={tag:active?.tagName??null,id:active?.id??null,className:typeof active?.className==='string'?active.className:'',tabIndex:active?.tabIndex??null,href:active?.getAttribute?.('href')??null};
  const matchedFocusLeftRules=[];const visitFocus=rules=>{for(const rule of [...rules]){if(rule.selectorText?.includes('#side-bar:focus-within')&&rule.style?.getPropertyValue('left')){const matched=rule.selectorText.split(',').map(s=>s.trim()).filter(s=>{try{return side?.matches(s)}catch{return false}});if(matched.length)matchedFocusLeftRules.push({selector:rule.selectorText,matched,left:rule.style.getPropertyValue('left'),priority:rule.style.getPropertyPriority('left')})}if(rule.cssRules?.length)visitFocus(rule.cssRules)}};for(const sheet of [...document.styleSheets]){try{visitFocus(sheet.cssRules)}catch{}}
  const nested=document.querySelector('#side-bar .collapsible-block-unfolded-link a, #side-bar .collapsible-block-content a');
  const edgeX=window.__themeLabPointerX??3,edgeHit=document.elementFromPoint(Math.min(edgeX,innerWidth-1),Math.round(innerHeight*.45));
  const linkRect=rect(link);
  const horizontalOverflowElements=document.documentElement.scrollWidth>innerWidth+1?[...document.querySelectorAll('body *')].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),ancestors=[];for(let p=e.parentElement;p&&ancestors.length<6;p=p.parentElement){const pr=p.getBoundingClientRect(),ps=getComputedStyle(p);ancestors.push({tag:p.tagName,id:p.id,className:typeof p.className==='string'?p.className:'',right:pr.right,overflowX:ps.overflowX,scrollWidth:p.scrollWidth,clientWidth:p.clientWidth})}return{tag:e.tagName,id:e.id,className:typeof e.className==='string'?e.className:'',right:r.right,left:r.left,top:r.top,width:r.width,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,overflowX:s.overflowX,text:(e.textContent??'').trim().slice(0,64),ancestors}}).filter(e=>e.right>innerWidth+1).sort((a,b)=>b.right-a.right).slice(0,12):[];
  const creditModules=[...document.querySelectorAll('.creditModule')].slice(0,4).map(e=>{const s=getComputedStyle(e),r=rect(e),p=e.parentElement,ps=p?getComputedStyle(p):null;return{rect:r,display:s.display,position:s.position,width:s.width,maxWidth:s.maxWidth,boxSizing:s.boxSizing,left:s.left,right:s.right,margin:s.margin,parent:p?{tag:p.tagName,id:p.id,className:typeof p.className==='string'?p.className:'',rect:rect(p),display:ps.display,position:ps.position,width:ps.width}:null}});
  return{viewport:{width:innerWidth,height:innerHeight,scroll_width:document.documentElement.scrollWidth},horizontalOverflowElements,creditModules,header:centerHeader,sidebar:{...sideRect,inline_style:side?.getAttribute('style'),left_css:sideCss?.left,transform:sideCss?.transform,position:sideCss?.position,display:sideCss?.display,pointerEvents:sideCss?.pointerEvents,hovered:side?.matches(':hover')??false,edgeHit:{x:edgeX,tag:edgeHit?.tagName??null,id:edgeHit?.id??null,className:typeof edgeHit?.className==='string'?edgeHit.className:''},background:sideCss?.backgroundColor,darkVariables:side?{sidebarBg:getComputedStyle(side).getPropertyValue('--sidebar-bg-color').trim(),darkMenu:getComputedStyle(side).getPropertyValue('--swatch-menubg-dark-color').trim(),linkText:getComputedStyle(side).getPropertyValue('--sidebar-links-text').trim()}:null,sideRules,isOpen,isClosed,isTarget:target,focusWithin,focusWithinCss,activeFocus,matchedFocusLeftRules,focusRuleCount:allRules.length,closeMenu:{present:!!close,display:closeStyle?.display,visibility:closeStyle?.visibility,pointerEvents:closeStyle?.pointerEvents,rect:closeBox},nestedEntryPresent:!!nested},link:{normal:{color:linkStyle?.color,backgroundColor:linkStyle?.backgroundColor,display:linkStyle?.display,visibility:linkStyle?.visibility,rect:linkRect},current:currentData,focused:!!link&&active===link,hovered:!!link&&link.matches(':hover')},contentHit:{point:centerPoint,tag:hit?.tagName??null,id:hit?.id??null,inSidebar:!!side&&side.contains(hit)},state};
 },{state,viewport});
}
async function captureOne([state,viewportName]){
 const viewport=({desktop:{width:1280,height:900},mobile:{width:390,height:844},'narrow-mobile':{width:320,height:740}})[viewportName];
 const page=await context.newPage({viewport});
 await page.setViewportSize(viewport);
 const blockedBefore=blockedExternal;
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const response=await page.goto(targetUrl,{waitUntil:'domcontentloaded',timeout:30000});
 if(response?.status()!==200)throw new Error(`target runtime returned HTTP ${response?.status()}`);
 const runtimeSourceHeader=await response.headerValue(authority.framerail.runtime_source_header);
 if(runtimeSourceHeader!==framerailSha)throw new Error(`target runtime source fingerprint differs: ${runtimeSourceHeader??'missing'} != ${framerailSha}`);
 const backendRuntimeIdentity=deepwellRuntimeIdentityFromHeaders(response.headers());
 assertDeepwellRuntimeIdentity(expectedBackendRuntimeIdentity,backendRuntimeIdentity,'BHL option browser navigation response');
 await page.locator('#header h1').waitFor({state:'visible',timeout:15000});
 await page.locator('#side-bar').waitFor({state:'attached',timeout:15000});
 await page.waitForTimeout(350);
 const baselineLink=page.locator('link[rel="stylesheet"][href="/wikidot/styles/sigma-fe5388a32e12.css"]');
 if(await baselineLink.count())await baselineLink.evaluate(e=>{e.disabled=true;e.media='not all'});
 else throw new Error('expected current runtime Sigma stylesheet was not found');
 await addStyleAtDocumentEnd(page,baselineCss,'baseline');
 await addStyleAtDocumentEnd(page,browserCandidateCss,'candidate');
 for(let i=0;i<browserOptionCssBlocks.length;i++)await addStyleAtDocumentEnd(page,browserOptionCssBlocks[i],`option-${i+1}`);
 const optionStyleTag=page.locator(`style[data-theme-lab-scenario="option-${browserOptionCssBlocks.length}"]`);
 await page.evaluate(()=>{
  const sidebar=document.querySelector('#side-bar');
  const links=sidebar?.querySelectorAll('.menu-item a')??[];
  if(links.length){links[0].classList.add('bhl-option-current');links[0].setAttribute('aria-current','page');links[0].setAttribute('data-bhl-option-fixture','current');}
  const target=links[1]??links[0];if(target)target.classList.add('bhl-option-state-link');
 });
 await waitCss(page);
 let action={type:state};
 let actionError=null;
 try {
 if(state==='centered-desktop'||state==='centered-mobile'||state==='centered-narrow'){
  // Keep the browser's default pointer position from accidentally opening the
  // BHL toggle during the responsive header composition observation.
  await page.mouse.move(Math.round(viewport.width*.75),Math.round(viewport.height*.5));
  await page.waitForTimeout(800);
  action={type:'settled-header-composition'};
 }else if(state==='toggle-rest'){
  await page.mouse.move(Math.round(viewport.width*.75),Math.round(viewport.height*.5));await page.waitForTimeout(750);
  action=await page.evaluate(()=>({type:'rest',hash:location.hash}));
 }else if(state==='toggle-corner-button-open'){
  action=await openToggleWithCornerButton(page);
 }else if(state==='toggle-hover-after-button-open'){
  const buttonAction=await openToggleWithCornerButton(page);
  const link=page.locator('#side-bar .menu-item a').first();
  await link.waitFor({state:'visible',timeout:5000});
  await link.hover();
  await page.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur());
  await page.waitForTimeout(750);
  action={type:'corner-button-open-then-pointer-hover-link-after-blur',button:buttonAction,link_selector:'#side-bar .menu-item a:first-of-type'};
 }else if(state==='collapsible-hover-expanded'){
  const y=Math.round(viewport.height*.45);let hitX=null;const tried=[];
  for(let x=0;x<32;x++){
   await page.mouse.move(x,y);await page.waitForTimeout(50);
   const sample=await page.evaluate(({x,y})=>{const side=document.querySelector('#side-bar'),hit=document.elementFromPoint(x,y);return{x,hovered:side?.matches(':hover')??false,hit_id:hit?.id??null,hit_class:typeof hit?.className==='string'?hit.className:'',side_rect:side?{left:side.getBoundingClientRect().left,right:side.getBoundingClientRect().right}:null}},{x,y});tried.push(sample);
   if(sample.hovered){hitX=x;break;}
  }
  if(hitX!==null){await page.waitForTimeout(800);await page.evaluate(x=>window.__themeLabPointerX=x,hitX);}
  action={type:'pointer-hover-at-sidebar-edge',x:hitX,y,tried_xs:tried,hover_established:hitX!==null};
 }else if(state==='toggle-keyboard-focus-open'||state==='collapsible-keyboard-focus-expanded'){
  if(state==='toggle-keyboard-focus-open'){
   await page.mouse.move(Math.round(viewport.width*.75),Math.round(viewport.height*.5));await page.waitForTimeout(750);let tabs=0;
   for(;tabs<100;tabs++){await page.keyboard.press('Tab');if(await page.locator('#side-bar').evaluate(e=>e.contains(document.activeElement)))break;}
   await page.waitForFunction(()=>{const side=document.querySelector('#side-bar');return !!side&&side.matches(':focus-within')&&side.getBoundingClientRect().left>=-1},null,{timeout:5000});action={type:'keyboard-tab-from-document-into-sidebar',tab_steps:tabs+1};
  }else{
   const link=page.locator('#side-bar .menu-item a').first();await link.focus();await page.keyboard.press('Tab');await page.waitForTimeout(750);
   action={type:'focus-sidebar-link-then-keyboard-tab'};
  }
 }else if(state==='toggle-mobile-target-open'||state==='toggle-narrow-target-open'){
  const menu=await visibleSidebarOpener(page);
  await menu.waitFor({state:'visible',timeout:5000});await menu.click();await page.waitForFunction(()=>location.hash==='#side-bar');await page.waitForTimeout(750);
  action={type:'click-mobile-open-menu',selector:await menu.getAttribute('href')};
 }else if(state==='toggle-mobile-close-menu'){
  const menu=await visibleSidebarOpener(page);
  await menu.click();await page.waitForFunction(()=>location.hash==='#side-bar');
  const close=page.locator('#side-bar > .close-menu');await close.waitFor({state:'visible'});await close.click();await page.waitForFunction(()=>location.hash!=='#side-bar');await page.waitForTimeout(750);
  action={type:'click-close-menu',href:await close.getAttribute('href')};
 }else if(state==='dark-normal'||state==='dark-mobile-normal'){
  if(state==='dark-mobile-normal')await openMobileSidebarByTarget(page);else{await openToggleWithCornerButton(page);const side=await sidebarData(page);await page.mouse.move(Math.max(5,side.x+side.width-5),Math.round(viewport.height*.8));await page.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur());await page.waitForTimeout(250);}
  action={type:state==='dark-mobile-normal'?'mobile-target-open-pointer-off-links':'corner-button-open-then-pointer-on-blank-area-and-blur'};
 }else if(state==='dark-hover'||state==='dark-mobile-hover'){
  if(state==='dark-mobile-hover')await openMobileSidebarByTarget(page);else await openToggleWithCornerButton(page);
  await page.locator('#side-bar .bhl-option-state-link').hover();if(state==='dark-hover')await page.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur());await waitCss(page);action={type:state==='dark-mobile-hover'?'mobile-target-open-then-pointer-hover-link':'corner-button-open-then-pointer-hover-link-and-blur'};
 }else if(state==='dark-keyboard-focus'||state==='dark-mobile-keyboard-focus'){
  if(state==='dark-mobile-keyboard-focus')await openMobileSidebarByTarget(page);else{await openToggleWithCornerButton(page);const close=page.locator('#side-bar > .close-menu');await close.focus();await page.keyboard.press('Tab');await page.waitForTimeout(750);}
  const current=page.locator('#side-bar .bhl-option-current');await current.focus();await page.keyboard.press('Tab');await waitCss(page);action={type:'keyboard-tab-link-focus'};
 }else if(state==='dark-current'||state==='dark-mobile-current'){
  if(state==='dark-mobile-current')await openMobileSidebarByTarget(page);else await openToggleWithCornerButton(page);
  action={type:'aria-current-page-and-current-class'};
 }else if(state==='collapsible-rest'){
  action={type:'collapsed-at-rest'};
 }else if(state==='collapsible-nested-entry'){
  await page.locator('#side-bar .menu-item a').first().focus();await page.waitForTimeout(750);
  const block=page.locator('#side-bar .collapsible-block').first();
  if(await block.count()){
   const toggle=block.locator('.collapsible-block-link').first();
   if(await toggle.count())await toggle.click();
   const nested=block.locator('.collapsible-block-unfolded .collapsible-block-content a').first();
   await nested.waitFor({state:'visible',timeout:5000});await nested.focus();await page.waitForTimeout(750);
  }
  action={type:'open-sidebar-nested-entry'};
 }else if(state==='collapsible-closed'){
  await page.mouse.move(Math.round(viewport.width*.75),Math.round(viewport.height*.5));
  await page.locator('#main-content').focus().catch(()=>{});await page.waitForTimeout(750);
  action={type:'pointer-and-focus-outside-sidebar'};
 }else if(state==='collapsible-mobile'||state==='collapsible-narrow-mobile'){
  action={type:'mobile-no-overlay-non-interference'};
 }
 } catch(error) { actionError=error instanceof Error?error.message:String(error); }
 const observed=await assertions(page,state,viewport);
 const failures=[];
 if(observed.viewport.scroll_width>observed.viewport.width+1)failures.push('horizontal overflow');
 if(!observed.sidebar.closeMenu.present)failures.push('current Framerail .close-menu node absent');
 if(state.startsWith('centered-')){
  if(observed.header.h1_display!=='flex'||observed.header.h2_display!=='flex'||observed.header.h1_justify!=='center'||observed.header.h2_justify!=='center'||observed.header.h1_center_delta>4||observed.header.h2_center_delta>4)failures.push('centered title/subtitle composition failed');
 }
 if(state==='toggle-rest'&&!observed.sidebar.isClosed)failures.push('toggle sidebar is not closed at rest');
 if((state==='toggle-corner-button-open'||state==='toggle-hover-after-button-open'||state==='toggle-keyboard-focus-open'||state==='collapsible-hover-expanded'||state==='collapsible-keyboard-focus-expanded'||state==='collapsible-nested-entry')&&!observed.sidebar.isOpen)failures.push('sidebar did not expand in requested interaction state');
 if(state==='toggle-corner-button-open'&&(!observed.sidebar.focusWithin||!observed.sidebar.focusWithinCss))failures.push('corner-button activation did not leave CSS focus-within on the opened sidebar');
 if(state==='toggle-hover-after-button-open'&&(!observed.sidebar.hovered||observed.sidebar.focusWithin||observed.sidebar.focusWithinCss))failures.push('hover after corner-button open was not observed independently of focus');
 if(state==='toggle-hover-after-button-open'&&(observed.link.normal.visibility!=='visible'||observed.link.normal.display==='none'||observed.link.normal.rect?.right<=0))failures.push('toggle sidebar menu link is not visually available in the hover-maintained state');
if(state==='dark-normal'&&(observed.sidebar.focusWithin||observed.sidebar.focusWithinCss||observed.link.hovered||observed.link.focused))failures.push('dark-sidebar normal link state is not free of link hover/focus');
if(state==='dark-hover'&&(!observed.sidebar.hovered||observed.sidebar.focusWithin||observed.sidebar.focusWithinCss||!observed.link.hovered))failures.push('dark-sidebar hover state is not independent of focus');
 if(state==='toggle-keyboard-focus-open'&&(!observed.sidebar.focusWithin||!observed.sidebar.focusWithinCss))failures.push('keyboard focus did not remain within the sidebar CSS focus-within state');
 if(actionError)failures.push(`interaction action failed: ${actionError}`);
 if(state.includes('target-open')&&(!observed.sidebar.isTarget||!observed.sidebar.isOpen))failures.push('mobile :target open state failed');
 if(state==='toggle-mobile-close-menu'&&(observed.sidebar.isTarget||!observed.sidebar.isClosed))failures.push('.close-menu did not close the mobile target sidebar');
 if((state==='collapsible-mobile'||state==='collapsible-narrow-mobile')&&observed.sidebar.isOpen)failures.push('desktop collapsible controller interferes with the closed mobile sidebar');
 if(state==='collapsible-nested-entry'&&!observed.sidebar.nestedEntryPresent)failures.push('nested sidebar entry missing');
 if(state.startsWith('dark-')&&(!observed.link.current||!observed.link.normal.color))failures.push('dark sidebar link-state fixture missing');
 if((state==='dark-keyboard-focus'||state==='dark-mobile-keyboard-focus')&&!observed.link.focused)failures.push('keyboard focus did not reach the dark-sidebar test link');
 if(state.startsWith('dark-')){
  const expectedDark=observed.sidebar.darkVariables?.darkMenu?.split(',').map(Number);
  const actualBg=rgba(observed.sidebar.background);
  const linkColor=rgba(observed.link.normal.color);
  if(!expectedDark||!actualBg||expectedDark.some((v,i)=>v!==actualBg[i]))failures.push('dark sidebar background does not match the dark menu swatch');
  if(!linkColor||!actualBg||contrast(linkColor,actualBg)<4.5)failures.push('dark sidebar link text contrast is below 4.5:1');
 }
 if(scenario==='combined'&&['toggle-corner-button-open','toggle-hover-after-button-open','toggle-keyboard-focus-open','toggle-mobile-target-open','toggle-narrow-target-open'].includes(state)){
  const expectedDark=observed.sidebar.darkVariables?.darkMenu?.split(',').map(Number);
  const actualBg=rgba(observed.sidebar.background);
  const linkColor=rgba(observed.link.normal.color);
  if(!expectedDark||!actualBg||expectedDark.some((v,i)=>v!==actualBg[i]))failures.push('combined dark-sidebar background does not match the dark menu swatch in toggle open state');
  if(!linkColor||!actualBg||contrast(linkColor,actualBg)<4.5)failures.push('combined toggle/dark-sidebar link text contrast is below 4.5:1');
 }
 if((state==='dark-hover'||state==='dark-mobile-hover')&&!observed.link.hovered)failures.push('pointer hover did not reach the dark-sidebar link');
 if((state==='dark-current'||state==='dark-mobile-current')&&observed.link.current.ariaCurrent!=='page')failures.push('current sidebar link is not marked as the current page');
 if(state.startsWith('collapsible-mobile')||state==='collapsible-narrow-mobile'){
  if(observed.contentHit.inSidebar)failures.push('hidden sidebar overlays the main-content hit target');
 }
 const screenshotDir=path.join(here,'captures',baseline,engineName);fs.mkdirSync(screenshotDir,{recursive:true});
 const screenshotPath=path.join(screenshotDir,`${scenario}-${state}-${viewportName}.png`);
 await page.screenshot({path:screenshotPath,fullPage:false,animations:'disabled'});
 const screenshotSha=sha(fs.readFileSync(screenshotPath));
 const optionSheetDetails=await optionStyleTag.evaluate(e=>{try{const matches=[];const visit=rules=>{for(const r of [...rules]){if(r.selectorText?.includes('#side-bar'))matches.push({selector:r.selectorText,decl:r.style?.getPropertyValue('--sidebar-bg-color')??'',text:r.cssText.slice(0,500)});if(r.cssRules?.length)visit(r.cssRules)}};visit(e.sheet.cssRules);return{text_length:e.textContent.length,rule_count:e.sheet.cssRules.length,first_rules:Array.from(e.sheet.cssRules).slice(0,8).map(r=>r.cssText.slice(0,300)),matching_side_rules:matches.slice(-10),contains_dark_rule:e.textContent.includes('--sidebar-bg-color: var(--swatch-menubg-dark-color)')}}catch(error){return{error:String(error)}}});
 const row={scenario,baseline:baselineAlias,browser_engine:engineName,browser_version:browser.version(),viewport:viewportName,viewport_size:viewport,state,action,action_error:actionError,capture_runner_sha256:captureRunnerSha,option_stylesheet_rule_count:await optionStyleTag.evaluate(e=>{try{return e.sheet?.cssRules.length??-1}catch{return-2}}),option_stylesheet_details:optionSheetDetails,observation:observed,assertion_failures:failures,external_requests_sent:0,external_requests_blocked:blockedExternal-blockedBefore,screenshot:screenshotPath,screenshot_sha256:screenshotSha,candidate:{source_sha256:candidateSourceSha,css_sha256:candidateCssSha},option_candidates:authority.option_candidates??[],option_css_sha256:optionCssSha,source_authority_sha256:sha(fs.readFileSync(authorityPath)),framerail_fingerprint_sha256:framerailSha,framerail_runtime_origin:origin,framerail_response_source_sha256:runtimeSourceHeader,backend_runtime_identity:backendRuntimeIdentity,backend_runtime_identity_sha256:backendRuntimeIdentity.identity_sha256,page_errors:errors};
 rows.push(row);await page.close();
}
try{
 for(const state of states)await captureOne(state);
}finally{await context.close();await browser.close()}
const base={schema:'theme_lab_bhl_option_targeted_capture.v1',scenario,baseline:baselineAlias,browser_engine:engineName,browser_version:rows[0]?.browser_version??null,source_authority_sha256:sha(fs.readFileSync(authorityPath)),candidate_source_sha256:candidateSourceSha,candidate_css_sha256:candidateCssSha,option_css_sha256:optionCssSha,framerail_fingerprint_sha256:framerailSha,framerail_runtime_origin:origin,framerail_response_source_sha256:rows[0]?.framerail_response_source_sha256??null,backend_runtime_identity:expectedBackendRuntimeIdentity,backend_runtime_identity_sha256:expectedBackendRuntimeIdentity.identity_sha256,rows};
const receipt={...base,receipt_sha256:sha(Buffer.from(JSON.stringify(base)))};
fs.writeFileSync(outPath,JSON.stringify(receipt,null,2)+'\n');
process.stdout.write(JSON.stringify({scenario,baseline,engine:engineName,rows:rows.length,passed:rows.filter(r=>!r.assertion_failures.length).length,failed:rows.filter(r=>r.assertion_failures.length).map(r=>({state:r.state,failures:r.assertion_failures})),external_requests_blocked:blockedExternal,framerail_fingerprint_sha256:framerailSha,receipt:outPath})+'\n');
