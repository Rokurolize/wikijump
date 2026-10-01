import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root='/home/roku/.devspace/worktrees/theme-final-audit/install/local/theme-lab';
const {createSession}=await import(path.join(root,'src/session-server.mjs'));
const {ReferenceCache}=await import(path.join(root,'src/reference-cache.mjs'));
const {loadChromium}=await import(path.join(root,'src/browser-lab.mjs'));
const cache=new ReferenceCache({fetchImpl:()=>{throw new Error('OFFLINE SOURCE PROBE: acquisition forbidden')}});
const browser=await loadChromium().launch({headless:true});
const session=createSession({browser,referenceAssets:cache});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const out=[];
const sources=JSON.parse(fs.readFileSync('/tmp/theme-semantic-authority/hidden-search-source-plan.json')).filter(x=>x.theme==='jakstyle');
const viewports={desktop:{width:1440,height:1000},laptop:{width:1024,height:900}};
try{
 for(const source of sources){ for(const [viewport,size] of Object.entries(viewports)){
  const {theme,url}=source;
  const loaded=await session.loadReference({url,offline:true});
  const p=session.pages.reference;
  await p.setViewportSize(size);
  await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(300);
  const query=await p.locator('#search-top-box-input').evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {display:s.display,visibility:s.visibility,width:r.width,height:r.height,value:e.value}});
  const initially=query;
  await p.locator('#search-top-box-form input[type=submit]').focus();
  const after_focus=await p.locator('#search-top-box-input').evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {display:s.display,visibility:s.visibility,width:r.width,height:r.height,value:e.value}});
  const button=await p.locator('#search-top-box-form input[type=submit]').evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {display:s.display,visibility:s.visibility,width:r.width,height:r.height}});
  const handler=await p.evaluate(()=>({search:typeof WIKIDOT?.page?.listeners?.search==='function'?WIKIDOT.page.listeners.search.toString():null,events:typeof YAHOO?.util?.Event?.getListeners==='function'?YAHOO.util.Event.getListeners(document.querySelector('#search-top-box-form'),'submit')?.map(e=>({type:e.type,fn:e.fn?.toString()})):null}));
  let navigation=null;
  const intercept=async route=>{if(route.request().isNavigationRequest()){navigation=new URL(route.request().url()).pathname;return route.abort('blockedbyclient')}return route.continue()};
  await p.route('**/search:site/**',intercept);
  let action_error=null;try{if(await p.locator('#search-top-box-form input[type=submit]').isVisible())await p.locator('#search-top-box-form input[type=submit]').click({timeout:5000,noWaitAfter:true})}catch(error){action_error=error.message.split('\n')[0]}
  await p.waitForTimeout(150);
  const m=await cache.load();out.push({theme,url,viewport,viewport_size:size,source_sha256:source.source_sha256,loaded,query,after_focus,button,handler,navigation,action_error,original_html_sha256:m.urls[url].digest,replay_entry:loaded.entry,snapshot_sha256:sha(JSON.stringify(m.snapshots[url])),public_writes:0,external_requests_sent:0});
  fs.writeFileSync('/tmp/theme-semantic-authority/frozen-search-probes-jakstyle.json',JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({theme,viewport,query,after_focus,button,navigation,action_error,handler_bound:!!handler.events?.length}));
 }}
 fs.writeFileSync('/tmp/theme-semantic-authority/frozen-search-probes-jakstyle.json',JSON.stringify(out,null,2)+'\n');
}finally{for(const p of Object.values(session.pages))await p?.context().close();for(const r of session.replays.values())await r.close();await browser.close()}
