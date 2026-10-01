#!/usr/bin/env node
// Explicit read-only acquisition, followed by offline browser-only A/B.
// No editing UI, module mutations, page saves, or browser-origin POSTs.
import fs from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ReferenceCache, sha256Hex} from '../src/reference-cache.mjs';
import {startReferenceReplay} from '../src/reference-replay.mjs';
import {loadChromium} from '../src/browser-lab.mjs';
import {materializeCandidateCssAssets} from '../src/local-assets.mjs';
import {measureVisibleTextBounds} from '../src/visible-text-bounds.mjs';
import {viewportEscape, closedDrawerBounds} from '../src/viewport-bounds.mjs';
import {activateNavigationControl} from '../src/navigation-interaction.mjs';

async function settleAnimations(page) {
  await page.evaluate(()=>{for(const animation of document.getAnimations())if(Number.isFinite(animation.effect?.getTiming().iterations))try{animation.finish()}catch{}});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}

export function removeNamedBlock(css, name) {
  const comments = [...css.matchAll(/\/\*([\s\S]*?)\*\//gu)];
  const start = comments.findIndex(row => row[1].replace(/\s+/gu, ' ').trim() === name);
  if (start < 0) throw new Error(`adaptation block missing: ${name}`);
  // Each named block is delimited by an authority marker, not an internal
  // rationale comment. Never match selectors or theme names as exceptions.
  const next = comments.slice(start + 1).find(row => /^(?:SCP-JP|Campaign JP|JP runtime)\b/u.test(row[1].trim()));
  return css.slice(0, comments[start].index) + css.slice(next?.index ?? css.length);
}

export async function confineReadOnlyReplay(context, origin, blocked) {
  // WebSockets bypass HTTP route handlers. Close their page-side route before
  // connecting to a server so frozen scripts have no alternate write channel.
  await context.routeWebSocket('**/*', socket => {
    blocked.push({method:'WEBSOCKET',url:socket.url().split('?')[0]});
    socket.close();
  });
  await context.route('**/*', async route => {
    const request=route.request();
    if(request.method()!=='GET' || !request.url().startsWith(origin+'/')) {
      blocked.push({method:request.method(),url:request.url().split('?')[0]});
      return route.abort();
    }
    return route.continue();
  });
}

export async function runAdaptationAB({url, cacheDir, css = '', withoutCss = '',
  removeBlock = null, assetDir, outputDir, acquire = false, widths = [320,390],
  state = 'navigation', computedContract = [], selectors = ['#header'], executablePath = '/usr/bin/google-chrome'}) {
  if (state === 'sidebar-closed' && (selectors.length !== 1 || selectors[0] !== '#side-bar')) throw new Error('sidebar-closed requires exactly #side-bar');
  const measurementSources=await Promise.all([fileURLToPath(import.meta.url),fileURLToPath(new URL('../src/viewport-bounds.mjs',import.meta.url)),fileURLToPath(new URL('../src/navigation-interaction.mjs',import.meta.url))].map(async source=>({source,bytes:await fs.readFile(source)})));
  const cache = new ReferenceCache({cacheDir});
  const barrier=path.join(cache.cacheDir,`adaptation-ab-${sha256Hex(url)}.acquiring`);
  await fs.mkdir(cache.cacheDir,{recursive:true});
  try { await fs.access(barrier); throw new Error(`unfinished reference acquisition: ${barrier}`); }
  catch(error) { if(error.code!=='ENOENT')throw error; }
  const retained=await cache.snapshot(url);
  if(acquire && !retained) await fs.writeFile(barrier,JSON.stringify({url,started_at:new Date().toISOString(),method:'GET',public_writes:0})+'\n',{flag:'wx'});
  const acquisition = await cache.acquire(url, {offline: !acquire});
  const snapshot = await cache.snapshot(url);
  if(acquire && !retained) await fs.unlink(barrier);
  const replay = await startReferenceReplay({cache, rootUrl: url});
  const chromium = loadChromium(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../framerail'));
  const browser = await chromium.launch({headless: true, executablePath});
  await fs.mkdir(outputDir, {recursive: true});
  const rows = [], blocked = [];
  const variants = {without: removeBlock ? removeNamedBlock(css, removeBlock) : withoutCss, with: css};
  try {
    for (const width of widths) for (const [variant, sourceCss] of Object.entries(variants)) {
      const context = await browser.newContext({viewport: {width, height:844}, serviceWorkers:'block'});
      // Only loopback replay GETs are admitted. Original scripts cannot write
      // to any site or acquire an edit lock, even if a frozen script executes.
      await confineReadOnlyReplay(context,replay.origin,blocked);
      const page = await context.newPage();
      await page.goto(replay.entryUrl, {waitUntil:'load'});
      if (sourceCss) await page.addStyleTag({content: assetDir ? await materializeCandidateCssAssets(sourceCss, assetDir) : sourceCss});
      await page.evaluate(() => document.fonts.ready);
      await settleAnimations(page);
      if(['credit-license','credit-otherwise'].includes(state)){
        await page.evaluate(state=>{location.hash=state==='credit-license'?'u-credit-view':'u-credit-otherwise'},state);
        await page.waitForFunction(id=>document.querySelector(id)?.matches(':target'),'#'+(state==='credit-license'?'u-credit-view':'u-credit-otherwise'));
        await page.evaluate(()=>{for(const animation of document.getAnimations()){if(Number.isFinite(animation.effect?.getTiming().iterations))try{animation.finish()}catch{}}});
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      }
      let interactionError=null;
      if(state==='sidebar-open'){try{await page.locator('.mobile-top-bar .open-menu a').click({timeout:3000});await page.waitForFunction(()=>location.hash==='#side-bar',null,{timeout:3000});await page.evaluate(()=>{for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getTiming().iterations))try{a.finish()}catch{}});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}catch(error){interactionError=error.message}}
      if (state === 'search-hover') await page.locator('#search-top-box-form').hover();
      const count = ['navigation','navigation-action'].includes(state)
        ? await page.locator('.mobile-top-bar > ul > li').evaluateAll(nodes => nodes.filter(n => n.querySelector(':scope > ul')).length)
        : state === 'desktop-navigation'
          ? await page.locator('#top-bar .top-bar > ul > li').evaluateAll(nodes => nodes.filter(n => n.querySelector(':scope > ul')).length)
          : 1;
      if (!count) throw new Error(`real Wikidot ${state} submenu contract missing`);
      for (let index=0; index<count; index++) {
        if (state === 'navigation-action') {
          await page.mouse.move(0, 0);
          const item = page.locator('.mobile-top-bar > ul > li:has(> ul)').nth(index);
          interactionError = null;
          try { await activateNavigationControl(page, item.locator(':scope > a').first(), item.locator(':scope > ul')); }
          catch (error) { interactionError = error.message; }
          await settleAnimations(page);
        }
        if(state==='desktop-navigation'){
          interactionError=null;
          try {
          const item=page.locator('#top-bar .top-bar > ul > li:has(> ul)').nth(index);
          await item.hover({timeout:2000});
          await page.waitForFunction(index=>{
            const items=[...document.querySelectorAll('#top-bar .top-bar > ul > li')].filter(row=>row.querySelector(':scope > ul'));
            const submenu=items[index]?.querySelector(':scope > ul');if(!submenu)return false;
            const style=getComputedStyle(submenu),rect=submenu.getBoundingClientRect();
            return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0.99&&rect.width>0&&rect.height>0;
          },index,{timeout:5000});
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          } catch(error) { interactionError=error.message; }
        }
        const headerInk = state==='header-title-search' ? await measureVisibleTextBounds(page,['#header h1','#header h2']) : null;
        const measurement = await page.evaluate(({state,index,selectors,headerInk,computedContract}) => {
          let submenu = null;
          if (state === 'navigation') {
            const parents = [...document.querySelectorAll('.mobile-top-bar > ul > li')].filter(n=>n.querySelector(':scope > ul'));
            submenu = parents[index].querySelector(':scope > ul');
            for (const node of parents.map(n=>n.querySelector(':scope > ul'))) node.style.removeProperty('display');
            // Visibility only: preserves the real menu's sizing/positioning.
            submenu.style.setProperty('display','block','important');
            submenu.style.setProperty('visibility','visible','important');
            submenu.style.setProperty('opacity','1','important');
          } else if (state === 'navigation-action') {
            const parents = [...document.querySelectorAll('.mobile-top-bar > ul > li')].filter(n=>n.querySelector(':scope > ul'));
            submenu = parents[index]?.querySelector(':scope > ul') ?? null;
          } else if (state === 'desktop-navigation') {
            const parents=[...document.querySelectorAll('#top-bar .top-bar > ul > li')].filter(node=>node.querySelector(':scope > ul'));
            submenu=parents[index]?.querySelector(':scope > ul')??null;
          }
          const input = document.querySelector('#search-top-box-input');
          if (state === 'search-focus' && input) { input.focus(); input.value='Theme Lab'; }
          const probes = submenu ? [submenu,...submenu.querySelectorAll('li, a')].map(el=>({el,selector:el===submenu?'submenu':el.tagName.toLowerCase(),pseudo:null})) : selectors.flatMap(selector=>{
            const match=selector.match(/^(.*?)(::before|::after)$/u),base=match?.[1]??selector,pseudo=match?.[2]??null;
            return [...document.querySelectorAll(base)].map(el=>({el,selector,pseudo}));
          });
          const overlaps=[];
          const controlOcclusion=state==='credit-license'?[...document.querySelectorAll('#u-credit-view a[href="#u-credit-otherwise"]')].map(control=>{
            const rect=control.getBoundingClientRect();
            const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
            return{selector:'#u-credit-view a[href="#u-credit-otherwise"]',visible:rect.width>0&&rect.height>0,clickable:hit===control||control.contains(hit),hit:hit?`${hit.tagName}.${hit.className}`:null};
          }):[];
          if(state==='header-title-search') {
            // The form wrapper can include empty positioning space. Compare
            // visible controls, rather than treating transparent space as ink.
            const searches=[...document.querySelectorAll('#search-top-box-form input')]
              .filter(el=>getComputedStyle(el).display!=='none')
              .map(el=>el.getBoundingClientRect());
            for(const selector of ['#header h1','#header h2']) {
              for (const title of headerInk[selector]??[]) for (const search of searches) {
                const width=Math.min(search.right,title.right)-Math.max(search.left,title.left);
                const height=Math.min(search.bottom,title.bottom)-Math.max(search.top,title.top);
                if(width>1&&height>1)overlaps.push({title:selector,control:'#search-top-box',width,height});
              }
            }
          }
          const computed_checks=computedContract.map(check=>{const el=document.querySelector(check.selector);const actual=el?getComputedStyle(el).getPropertyValue(check.property).trim():null;return{...check,actual,pass:actual===check.expected}});
          const scroll_overflow_sources=[...document.querySelectorAll('body *')].filter(element=>element.scrollWidth>element.clientWidth+1).slice(0,30).map(element=>({tag:element.tagName,id:element.id,class_name:typeof element.className==='string'?element.className:'',scroll_width:element.scrollWidth,client_width:element.clientWidth,rect:element.getBoundingClientRect().toJSON(),overflow_x:getComputedStyle(element).overflowX}));
          return {computed_checks,document_width:document.documentElement.scrollWidth, viewport_width:document.documentElement.clientWidth,overlaps,control_occlusion:controlOcclusion,header_ink_rects:headerInk,scroll_overflow_sources,
            overflow_sources:[...document.querySelectorAll('body *')].map(element=>({element,rect:element.getBoundingClientRect()})).filter(({element,rect})=>rect.width>0&&getComputedStyle(element).display!=='none'&&(rect.left < -1||rect.right>innerWidth+1)).slice(0,24).map(({element,rect})=>({tag:element.tagName,id:element.id,class_name:typeof element.className==='string'?element.className:'',rect:rect.toJSON(),parent_id:element.parentElement?.id,box_sizing:getComputedStyle(element).boxSizing,min_width:getComputedStyle(element).minWidth,padding:getComputedStyle(element).padding})),
            selector_coverage:submenu?null:Object.fromEntries(selectors.map(selector=>[selector,probes.filter(p=>p.selector===selector).length])),
            rows:probes.map(({el,selector,pseudo})=>({selector,pseudo,text:el.textContent.trim(),rect:el.getBoundingClientRect().toJSON(),parent_rect:el.parentElement?.getBoundingClientRect().toJSON()??null,scroll_width:el.scrollWidth,client_width:el.clientWidth,
              style:Object.fromEntries(['display','visibility','opacity','position','box-sizing','transform','margin-left','margin-right','padding-left','padding-right','content','background-size','width','min-width','left','right','inset-inline-start','inset-inline-end','white-space'].map(p=>[p,getComputedStyle(el,pseudo).getPropertyValue(p)]))})),
            search:input?{display:getComputedStyle(input).display,focused:document.activeElement===input}:null};
        }, {state,index,selectors,headerInk,computedContract});
        // Compare against the browser's measured layout viewport. The requested
        // emulation width is only an input; Chromium may report a fractional
        // client box after scrollbar/layout rounding.
        const bounds = measurement.rows.map(row=>state==='sidebar-closed'
          ? closedDrawerBounds(row.rect, measurement.viewport_width)
          : viewportEscape(row.rect, measurement.viewport_width));
        const stem = `${variant}-${width}-${state}-${index}`;
        const screenshot = `${stem}.png`, dom = `${stem}.html.gz`;
        await page.screenshot({path:path.join(outputDir,screenshot),animations:'disabled'});
        await fs.writeFile(path.join(outputDir,dom),gzipSync(await page.content(),{level:9}));
        rows.push({variant,width,state,index,css_sha256:sha256Hex(sourceCss),measurement,bounds,
          interaction_error:interactionError,pass:!interactionError && measurement.computed_checks.every(check=>check.pass) && measurement.document_width<=width+1 && bounds.every(row=>row.pass) && measurement.overlaps.length===0 && (state!=='credit-license'||measurement.control_occlusion.length>0&&measurement.control_occlusion.every(control=>control.visible&&control.clickable)) && (!measurement.selector_coverage || Object.values(measurement.selector_coverage).every(count=>count>0)),
          screenshot, screenshot_sha256:sha256Hex(await fs.readFile(path.join(outputDir,screenshot))),
          dom, dom_sha256:sha256Hex(await fs.readFile(path.join(outputDir,dom)))});
      }
      await context.close();
    }
    const archivedSources=[];
    for(const {source,bytes} of measurementSources){
      const file=`measurement-${path.basename(source)}`;
      await fs.writeFile(path.join(outputDir,file),bytes);
      archivedSources.push({path:file,sha256:sha256Hex(bytes)});
    }
    const receipt = {schema:'theme_lab_wikidot_adaptation_ab.v1',url,site:new URL(url).hostname,
      measurement_contract:state==='sidebar-closed'?'existing-drawer-wholly-off-canvas.v1':state==='navigation-action'?'production-navigation-action-and-contained-submenu.v1':'contained-probes.v1',
      measurement_program_sha256:sha256Hex(measurementSources[0].bytes),
      archived_sources:archivedSources,
      observed_at:snapshot.created_at, measured_at:new Date().toISOString(),snapshot,
      browser_version:browser.version(),browser_sha256:sha256Hex(await fs.readFile(executablePath)),
      acquisition,computed_contract:computedContract,public_writes:0,external_browser_requests:0,blocked_requests:blocked,rows};
    await fs.writeFile(path.join(outputDir,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
    return receipt;
  } finally { await browser.close(); await replay.close(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = key => args[args.indexOf(key)+1];
  if (!args.includes('--url') || !args.includes('--output')) throw new Error('requires --url and --output; --acquire only for explicit read-only acquisition');
  const result = await runAdaptationAB({url:value('--url'), outputDir:path.resolve(value('--output')),
    cacheDir:args.includes('--cache')?path.resolve(value('--cache')):undefined,
    acquire:args.includes('--acquire'),css:args.includes('--css')?await fs.readFile(value('--css'),'utf8'):'',
    withoutCss:args.includes('--without-css')?await fs.readFile(value('--without-css'),'utf8'):'',
    removeBlock:args.includes('--remove-block')?value('--remove-block'):null,
    assetDir:args.includes('--assets')?path.resolve(value('--assets')):undefined,
    state:args.includes('--state')?value('--state'):'navigation',
    computedContract:args.includes('--computed-contract')?JSON.parse(await fs.readFile(value('--computed-contract'),'utf8')):[],
    selectors:args.includes('--selectors')?value('--selectors').split(','):undefined,
    widths:args.includes('--widths')?value('--widths').split(',').map(Number):undefined});
  console.log(JSON.stringify({rows:result.rows.length,with_pass:result.rows.filter(r=>r.variant==='with').every(r=>r.pass),public_writes:0}));
}
