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
import {viewportEscape} from '../src/viewport-bounds.mjs';

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
  state = 'navigation', selectors = ['#header'], executablePath = '/usr/bin/google-chrome'}) {
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
      if (state === 'search-hover') await page.locator('#search-top-box-form').hover();
      const count = state === 'navigation' ? await page.locator('.mobile-top-bar > ul > li').evaluateAll(nodes => nodes.filter(n => n.querySelector(':scope > ul')).length) : 1;
      if (!count) throw new Error('real Wikidot mobile submenu contract missing');
      for (let index=0; index<count; index++) {
        const measurement = await page.evaluate(({state,index,selectors}) => {
          let submenu = null;
          if (state === 'navigation') {
            const parents = [...document.querySelectorAll('.mobile-top-bar > ul > li')].filter(n=>n.querySelector(':scope > ul'));
            submenu = parents[index].querySelector(':scope > ul');
            for (const node of parents.map(n=>n.querySelector(':scope > ul'))) node.style.removeProperty('display');
            // Visibility only: preserves the real menu's sizing/positioning.
            submenu.style.setProperty('display','block','important');
            submenu.style.setProperty('visibility','visible','important');
            submenu.style.setProperty('opacity','1','important');
          }
          const input = document.querySelector('#search-top-box-input');
          if (state === 'credit-otherwise') location.hash='u-credit-otherwise';
          if (state === 'search-focus' && input) { input.focus(); input.value='Theme Lab'; }
          const probes = submenu ? [submenu,...submenu.querySelectorAll('li, a')].map(el=>({el,selector:el===submenu?'submenu':el.tagName.toLowerCase(),pseudo:null})) : selectors.flatMap(selector=>{
            const match=selector.match(/^(.*?)(::before|::after)$/u),base=match?.[1]??selector,pseudo=match?.[2]??null;
            return [...document.querySelectorAll(base)].map(el=>({el,selector,pseudo}));
          });
          const overlaps=[];
          if(state==='header-title-search') {
            // The form wrapper can include empty positioning space. Compare
            // visible controls, rather than treating transparent space as ink.
            const searches=[...document.querySelectorAll('#search-top-box-form input')]
              .filter(el=>getComputedStyle(el).display!=='none')
              .map(el=>el.getBoundingClientRect());
            for(const selector of ['#header h1','#header h2']) {
              const title=document.querySelector(selector)?.getBoundingClientRect();
              for (const search of searches) if(title) {
                const width=Math.min(search.right,title.right)-Math.max(search.left,title.left);
                const height=Math.min(search.bottom,title.bottom)-Math.max(search.top,title.top);
                if(width>1&&height>1)overlaps.push({title:selector,control:'#search-top-box',width,height});
              }
            }
          }
          return {document_width:document.documentElement.scrollWidth, viewport_width:document.documentElement.clientWidth,overlaps,
            selector_coverage:submenu?null:Object.fromEntries(selectors.map(selector=>[selector,probes.filter(p=>p.selector===selector).length])),
            rows:probes.map(({el,selector,pseudo})=>({selector,pseudo,text:el.textContent.trim(),rect:el.getBoundingClientRect().toJSON(),
              style:Object.fromEntries(['display','visibility','content','background-size','width','min-width','left','right','white-space'].map(p=>[p,getComputedStyle(el,pseudo).getPropertyValue(p)]))})),
            search:input?{display:getComputedStyle(input).display,focused:document.activeElement===input}:null};
        }, {state,index,selectors});
        const bounds = measurement.rows.map(row=>viewportEscape(row.rect, width));
        const stem = `${variant}-${width}-${state}-${index}`;
        const screenshot = `${stem}.png`, dom = `${stem}.html.gz`;
        await page.screenshot({path:path.join(outputDir,screenshot)});
        await fs.writeFile(path.join(outputDir,dom),gzipSync(await page.content(),{level:9}));
        rows.push({variant,width,state,index,css_sha256:sha256Hex(sourceCss),measurement,bounds,
          pass:measurement.document_width<=width+1 && bounds.every(row=>row.pass) && measurement.overlaps.length===0 && (!measurement.selector_coverage || Object.values(measurement.selector_coverage).every(count=>count>0)),
          screenshot, screenshot_sha256:sha256Hex(await fs.readFile(path.join(outputDir,screenshot))),
          dom, dom_sha256:sha256Hex(await fs.readFile(path.join(outputDir,dom)))});
      }
      await context.close();
    }
    const receipt = {schema:'theme_lab_wikidot_adaptation_ab.v1',url,site:new URL(url).hostname,
      observed_at:snapshot.created_at, measured_at:new Date().toISOString(),snapshot,
      browser_version:browser.version(),browser_sha256:sha256Hex(await fs.readFile(executablePath)),
      acquisition,public_writes:0,external_browser_requests:0,blocked_requests:blocked,rows};
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
    selectors:args.includes('--selectors')?value('--selectors').split(','):undefined,
    widths:args.includes('--widths')?value('--widths').split(',').map(Number):undefined});
  console.log(JSON.stringify({rows:result.rows.length,with_pass:result.rows.filter(r=>r.variant==='with').every(r=>r.pass),public_writes:0}));
}
