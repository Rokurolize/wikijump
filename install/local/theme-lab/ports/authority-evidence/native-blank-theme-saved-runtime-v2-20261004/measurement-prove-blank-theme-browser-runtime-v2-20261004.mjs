import fs from'node:fs/promises';import crypto from'node:crypto';
import{loadBrowser,launchBrowser,openPage}from'/home/roku/.devspace/worktrees/theme-final-audit/install/local/theme-lab/src/browser-lab.mjs';
const privateDir='/tmp/theme-semantic-authority/blank-theme-development-proof-v2-20261004';
const saved=JSON.parse(await fs.readFile(privateDir+'/saved-runtime-proof.json')),built=JSON.parse(await fs.readFile(privateDir+'/framerail-build-identity.json')),rows=(await fs.readFile('/tmp/theme-semantic-authority/blank-theme-browser-runtime-v2-20261004.log','utf8')).split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
if(rows.length!==14||rows.some(row=>!['chromium','firefox'].includes(row.engine)))throw Error('Expected exactly the completed Chromium/Firefox cells');
for(const row of rows){if(crypto.createHash('sha256').update(await fs.readFile(privateDir+'/'+row.screenshot)).digest('hex')!==row.screenshot_sha256)throw Error('Retained cell changed');}
const origin='https://'+saved.site+'.wikijump.localhost:3397';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
for(const engine of ['webkit']){
 const browser=await launchBrowser({chromium:loadBrowser(engine),engine});
 try{
  for(const item of saved.rows){
   const page=await openPage(browser,{url:origin+'/'+item.slug,localOnly:true,viewport:{width:390,height:844}});
   const response=await page.reload({waitUntil:'networkidle'});
   if(response.status()!==200||response.headers()['x-theme-lab-runtime-source-sha']!==built.source_sha256)throw Error('Wrong active browser runtime');
   const observation=await page.evaluate(()=>({links:[...document.querySelectorAll('link[rel=stylesheet]')].map(e=>e.getAttribute('href')),source_style:[...document.querySelectorAll('style')].map(e=>e.textContent).filter(s=>s.includes('blank-theme-proof')),body:document.querySelector('#page-content')?.textContent??'',site_theme_links:document.querySelectorAll('link[data-wikidot-site-theme]').length}));
   const base=observation.links.some(s=>s.includes('/wikidot/styles/wikidot-base-')),rating=observation.links.some(s=>s.includes('/wikidot/styles/pagerate-')),sigma=observation.links.some(s=>s.includes('/wikidot/styles/sigma-'));
   if(!base||!rating||sigma===item.saved_blank_theme||!observation.body.includes('Theme preview boundary probe.')||item.saved_blank_theme&&observation.site_theme_links||item.id==='styled-blank'&&!observation.source_style.some(s=>s.includes('#123456')))throw Error('Stylesheet boundary mismatch '+engine+' '+item.id);
   const screenshot=engine+'-'+item.id+'.png';await page.screenshot({path:privateDir+'/'+screenshot,fullPage:true});
   rows.push({engine,browser_version:browser.version(),case:item.id,saved_blank_theme:item.saved_blank_theme,source_sha256:built.source_sha256,base_preserved:base,pagerate_preserved:rating,sigma_present:sigma,site_theme_links:observation.site_theme_links,source_css_preserved:item.id!=='styled-blank'||observation.source_style.some(s=>s.includes('#123456')),screenshot,screenshot_sha256:sha(await fs.readFile(privateDir+'/'+screenshot))});console.log(JSON.stringify(rows.at(-1)));await page.context().close();
  }
 }finally{await browser.close();}
}
await fs.writeFile(privateDir+'/browser-runtime-proof.json',JSON.stringify({schema:'theme_lab_blank_theme_browser_runtime.v1',origin,runtime_source_sha256:built.source_sha256,public_writes:0,rows},null,2)+'\n');
