import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ReferenceCache,objectPath} from '../../src/reference-cache.mjs';
import {loadChromium} from '../../src/browser-lab.mjs';
import {startReferenceReplay} from '../../src/reference-replay.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const lab=path.resolve(here,'../..');
const packageDir=path.join(lab,'ports/flopstyle-dark');
const sourceFile=path.join(packageDir,'upstream-en.wikidot.txt');
const sourceBytes=fs.readFileSync(sourceFile);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sourceSha=sha(sourceBytes);
const manifest=JSON.parse(fs.readFileSync(path.join(packageDir,'manifest.json'),'utf8'));
const sourceIdentity=manifest.source_identity.en;
const sourceUrl=manifest.source_url??manifest.reference_url;
if(sourceIdentity.revisions!==401||sourceIdentity.sha256!==sourceSha||manifest.en_source_sha256!==sourceSha)
  throw new Error('Flopstyle source input is not the maintained EN revision 401 identity');

const cacheDir=path.join(here,'replay-cache');
const barrierPath=path.join(here,'acquisition-barrier.json');
if(fs.existsSync(barrierPath))throw new Error('A prior source acquisition barrier remains; inspect its run before retrying');
fs.mkdirSync(here,{recursive:true});
const writeDurably=(file,bytes)=>{fs.mkdirSync(path.dirname(file),{recursive:true});const fd=fs.openSync(file,'w',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}};
writeDurably(barrierPath,Buffer.from(JSON.stringify({schema:'theme_lab_external_acquisition_barrier.v1',url:sourceUrl,source_sha256:sourceSha,started_at:new Date().toISOString(),status:'acquiring'},null,2)+'\n'));

const cache=new ReferenceCache({cacheDir});
let acquisition;
try {
  acquisition=await cache.acquire(sourceUrl,{offline:false});
  const cacheManifest=await cache.load();
  for(const digest of cacheManifest.snapshots[sourceUrl].object_digests){
    const file=path.join(cacheDir,objectPath(digest));
    const fd=fs.openSync(file,'r');try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
  }
  for(const file of [cache.manifestPath,path.dirname(cache.manifestPath)]){
    try{const fd=fs.openSync(file,fs.statSync(file).isDirectory()?'r':'r');try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}}catch{}
  }
  fs.unlinkSync(barrierPath);
} catch(error) {
  throw new Error(`Source acquisition failed; durable barrier retained at ${barrierPath}: ${error.message}`);
}

const cacheManifest=await cache.load();
const snapshot=cacheManifest.snapshots[sourceUrl];
const rootDigest=cacheManifest.urls[sourceUrl].digest;
const localCodeUrl='https://scp-wiki.wdfiles.com/local--code/theme%3Aflopstyle-dark/2';
const localCodeRecord=cacheManifest.urls[localCodeUrl];
if(!localCodeRecord)throw new Error('Current source replay did not acquire active local-code/2');
const localCodePath=path.join(cacheDir,objectPath(localCodeRecord.digest));
const localCodeBytes=fs.readFileSync(localCodePath);
const localCodeText=localCodeBytes.toString('utf8');
const activeRule=localCodeText.match(/\.top-bar::before\s*\{[^}]*\}/su)?.[0]??'';
if(!/top:\s*-.4em\s*;/u.test(activeRule)||/top:\s*-.5em\s*;/u.test(activeRule))
  throw new Error('Live Flopstyle local-code/2 did not contain the rev401 .top-bar::before top value');
const retainedLocalCodePath=path.join(here,'upstream-local-code-2-rev401.css');
fs.copyFileSync(localCodePath,retainedLocalCodePath);
if(sha(fs.readFileSync(retainedLocalCodePath))!==localCodeRecord.digest)throw new Error('Current local-code/2 source failed its digest check');
const rootObject=path.join(cacheDir,objectPath(rootDigest));
const sourceHtmlDir=path.join(lab,'ports/current-acceptance/source-oracles/objects',rootDigest.slice(0,2));
fs.mkdirSync(sourceHtmlDir,{recursive:true});
const sourceHtmlPath=path.join(sourceHtmlDir,rootDigest);
fs.copyFileSync(rootObject,sourceHtmlPath);
if(sha(fs.readFileSync(sourceHtmlPath))!==rootDigest)throw new Error('Current source HTML object failed digest check');

const chromium=loadChromium();
const browser=await chromium.launch({headless:true});
const replay=await startReferenceReplay({cache,rootUrl:sourceUrl});
const viewportRows={
  'narrow-mobile':{width:320,height:844},
  mobile:{width:390,height:844},
  tablet:{width:768,height:1024},
  laptop:{width:1024,height:900},
  desktop:{width:1440,height:1000},
};
const actionViewportRows={desktop:{width:1440,height:1000},laptop:{width:1024,height:900},tablet:{width:768,height:1024}};
const screenshots={};
const sourceMeasurements=[];
const actionPaths=[];
let browserBlockedExternalAttempts=0;
const browserBlockedExternalUrls=[];
const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:viewportRows.desktop});
const page=await context.newPage();
await page.route('**/*',async route=>{
  const requestUrl=route.request().url();
  let parsed;try{parsed=new URL(requestUrl)}catch{return route.abort('blockedbyclient')}
  if(parsed.pathname.startsWith('/search:site/')){actionPaths.push(parsed.pathname);return route.abort('blockedbyclient')}
  if(parsed.hostname==='127.0.0.1'||parsed.hostname==='localhost'||parsed.hostname==='::1')return route.continue();
  browserBlockedExternalAttempts+=1;
  if(browserBlockedExternalUrls.length<300&&!browserBlockedExternalUrls.includes(requestUrl))browserBlockedExternalUrls.push(requestUrl);
  return route.abort('blockedbyclient');
});
await page.goto(replay.entryUrl,{waitUntil:'domcontentloaded',timeout:30000});
await page.waitForLoadState('load',{timeout:30000}).catch(()=>{});
await page.waitForTimeout(800);
for(const [viewport,size] of Object.entries(viewportRows)){
  await page.setViewportSize(size);
  await page.waitForTimeout(150);
  const output=path.join(lab,'ports/current-acceptance/source-oracles/renderings',`flopstyle-dark-rev401-${viewport}.png`);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  const bytes=await page.screenshot({path:output,fullPage:false,animations:'disabled'});
  screenshots[viewport]={path:path.relative(lab,output),sha256:sha(bytes),width:size.width,height:size.height};
}

for(const [viewport,size] of Object.entries(actionViewportRows)){
  await page.goto(replay.entryUrl,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForLoadState('load',{timeout:30000}).catch(()=>{});
  await page.setViewportSize(size);
  await page.waitForTimeout(300);
  const query=await page.locator('#search-top-box-input').evaluate(element=>{const style=getComputedStyle(element),rect=element.getBoundingClientRect();return{display:style.display,visibility:style.visibility,width:rect.width,height:rect.height,value:element.value}});
  await page.locator('#search-top-box-form input[type=submit]').focus();
  const afterFocus=await page.locator('#search-top-box-input').evaluate(element=>{const style=getComputedStyle(element),rect=element.getBoundingClientRect();return{display:style.display,visibility:style.visibility,width:rect.width,height:rect.height,value:element.value}});
  const button=await page.locator('#search-top-box-form input[type=submit]').evaluate(element=>{const style=getComputedStyle(element),rect=element.getBoundingClientRect();return{display:style.display,visibility:style.visibility,width:rect.width,height:rect.height}});
  const handler=await page.evaluate(()=>({search:typeof WIKIDOT?.page?.listeners?.search==='function'?WIKIDOT.page.listeners.search.toString():null,events:typeof YAHOO?.util?.Event?.getListeners==='function'?YAHOO.util.Event.getListeners(document.querySelector('#search-top-box-form'),'submit')?.map(event=>({type:event.type,fn:event.fn?.toString()})):null}));
  const beforeActions=actionPaths.length;
  let actionError=null;
  try{if(await page.locator('#search-top-box-form input[type=submit]').isVisible())await page.locator('#search-top-box-form input[type=submit]').click({timeout:2500,noWaitAfter:true})}
  catch(error){if(actionPaths.length===beforeActions)actionError=error.message.split('\n')[0]}
  await page.waitForTimeout(150);
  const capturedPath=actionPaths.at(-1)??null;
  sourceMeasurements.push({theme:'flopstyle-dark',url:sourceUrl,viewport,viewport_size:size,source_sha256:sourceSha,loaded:{root_url:sourceUrl,entry:snapshot.entry,asset_count:acquisition.asset_count,external_requests:acquisition.external_requests,cache_hits:acquisition.cache_hits,failed_asset_count:acquisition.failed_asset_count,failed_assets:acquisition.failed_assets,offline:true,browser_blocked_external_attempts:browserBlockedExternalAttempts,browser_blocked_external_urls:browserBlockedExternalUrls},query,after_focus:afterFocus,button,handler,navigation:capturedPath,action_error:actionError,original_html_sha256:rootDigest,replay_entry:snapshot.entry,snapshot_sha256:sha(Buffer.from(JSON.stringify(snapshot))),browser_navigation_requests:actionPaths.slice(beforeActions)});
}

await context.close();
await replay.close();
await browser.close();

const programBytes=fs.readFileSync(fileURLToPath(import.meta.url));
const programSha=sha(programBytes);
const relativeObject=digest=>path.relative(lab,path.join(cacheDir,objectPath(digest)));
const artifacts=[{path:path.relative(lab,sourceHtmlPath),sha256:rootDigest,content_type:cacheManifest.objects[rootDigest]?.content_type??'text/html; charset=utf-8'},{path:path.relative(lab,retainedLocalCodePath),sha256:localCodeRecord.digest,content_type:localCodeRecord.content_type??'text/css; charset=utf-8'},...snapshot.object_digests.map(digest=>({path:relativeObject(digest),sha256:digest,content_type:cacheManifest.objects[digest]?.content_type??'application/octet-stream'}))];
const measurementProgram={path:path.relative(lab,fileURLToPath(import.meta.url)),sha256:programSha};
const fixtureHtml={path:path.relative(lab,sourceHtmlPath),sha256:rootDigest};
const referenceIdentity={source_url:sourceUrl,original_html_sha256:rootDigest,replay_entry:snapshot.entry,snapshot_sha256:sha(Buffer.from(JSON.stringify(snapshot))),offline:true};
const renderReceipts={};
for(const [viewport,shot] of Object.entries(screenshots)){
  const receipt={schema:'theme_lab_source_rendering_receipt.v1',source_url:sourceUrl,source_snapshot:{path:'ports/flopstyle-dark/upstream-en.wikidot.txt',sha256:sourceSha},frozen_html:fixtureHtml,reference_identity:referenceIdentity,viewport,viewport_size:{width:shot.width,height:shot.height},visual:{viewports:{[viewport]:{reference_screenshot_sha256:shot.sha256}}},result:{reference_identity:referenceIdentity,visual:{viewports:{[viewport]:{reference_screenshot_sha256:shot.sha256}}}}};
  const receiptPath=path.join(lab,'ports/current-acceptance/source-oracles/rendering-receipts',`flopstyle-dark-rev401-${viewport}.json`);
  fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n');
  renderReceipts[viewport]={path:path.relative(lab,receiptPath),sha256:sha(fs.readFileSync(receiptPath))};
}

const firstAttemptPath=path.join(here,'attempts/flopstyle-dark-attempt-1-inconclusive.json');
const firstAttempt=fs.existsSync(firstAttemptPath)?JSON.parse(fs.readFileSync(firstAttemptPath,'utf8')):null;
const firstAttemptBound=firstAttempt?.source_sha256===sourceSha&&firstAttempt?.original_html_sha256===rootDigest&&firstAttempt?.snapshot_sha256===referenceIdentity.snapshot_sha256;
const sourceFetch={root_url:sourceUrl,source_revision:sourceIdentity.revisions,source_sha256:sourceSha,external_requests:firstAttemptBound?firstAttempt.acquisition.external_requests:acquisition.external_requests,asset_count:snapshot.assets,failed_asset_count:snapshot.failed_assets,failed_assets:snapshot.failed_asset_details??[],snapshot_created_at:snapshot.created_at,active_local_code_2:{url:localCodeUrl,revision:401,source_sha256:localCodeRecord.digest,source_path:path.relative(lab,retainedLocalCodePath),bytes:localCodeBytes.length,fetched_at:localCodeRecord.fetched_at,selector:'.top-bar::before',property:'top',observed_value:'-.4em'},initial_probe_receipt:firstAttemptBound?{path:path.relative(lab,firstAttemptPath),sha256:sha(fs.readFileSync(firstAttemptPath))}:null};
const document={schema:'theme_lab_wikidot_search_control.v1',theme:'flopstyle-dark',source_url:sourceUrl,source_sha256:sourceSha,source_revision:sourceIdentity.revisions,source_updated_at:sourceIdentity.updated_at,observed_at:new Date().toISOString(),public_writes:0,external_requests_sent:0,offline:true,browser_engine:'chromium',browser_version:browser.version(),original_html_sha256:rootDigest,replay_entry:snapshot.entry,snapshot_sha256:referenceIdentity.snapshot_sha256,cache_manifest_sha256:sha(fs.readFileSync(cache.manifestPath)),acquisition:sourceFetch,browser_replay:{external_requests_sent:0,blocked_external_attempts:browserBlockedExternalAttempts,blocked_external_urls:browserBlockedExternalUrls},artifacts,scope:'Current EN revision 401 source control observation; source HTML and required resources were acquired into a durable content-addressed replay, then browser action and viewports were captured offline. Third-party analytics, advertising, and interwiki frame requests were intercepted before network transmission.',source_measurements:sourceMeasurements,measurement_programs:[measurementProgram],source_renderings:screenshots,source_rendering_receipts:renderReceipts};
const receiptPath=path.join(here,'flopstyle-dark.json');
fs.writeFileSync(receiptPath,JSON.stringify(document,null,2)+'\n');
const summary={status:sourceMeasurements.length===3&&sourceMeasurements.every(row=>row.navigation==='/search:site/q/'+encodeURIComponent(row.after_focus.value)&&row.action_error===null&&(row.after_focus.display==='none'||row.after_focus.visibility==='hidden'||row.after_focus.width===0||row.after_focus.height===0))?'pass':'inconclusive',source_revision:sourceIdentity.revisions,source_sha256:sourceSha,source_html_sha256:rootDigest,replay_entry:snapshot.entry,snapshot_sha256:referenceIdentity.snapshot_sha256,active_local_code_2_sha256:localCodeRecord.digest,active_top_rule:activeRule.match(/top:\s*[^;]+/u)?.[0]??null,acquisition_external_requests:sourceFetch.external_requests,asset_count:snapshot.assets,failed_assets:snapshot.failed_assets,blocked_external_attempts:browserBlockedExternalAttempts,blocked_external_unique_urls:browserBlockedExternalUrls.length,action_measurements:sourceMeasurements.length,source_renderings:Object.keys(screenshots).length,receipt:path.relative(lab,receiptPath),receipt_sha256:sha(fs.readFileSync(receiptPath))};
console.log(JSON.stringify(summary,null,2));
if(summary.status!=='pass')process.exitCode=2;
